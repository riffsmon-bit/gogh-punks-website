import { pathToFileURL } from "node:url";
import { bankrModelId, bankrProviderSecret, bankrRequestError } from "../broker/src/v4/ai/bankr.mjs";
import { ArtBrokerProviderError } from "../broker/src/v4/ai/provider.mjs";

// Operator preflight only: no inference, user prompts, signing, top-ups or
// arbitrary URLs. Real chat + structured proof still uses the quota-backed
// authenticated /api/v2/admin/ai-check route after configuration review.
export async function checkBankrGateway({ environment = process.env, fetchImpl = fetch,
  timeoutMs = 8_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw new TypeError("invalid timeout");
  const summary = { schema: "GOGH_BANKR_GATEWAY_PREFLIGHT_V1", checkedAt: new Date().toISOString(),
    status: "NOT_READY", authenticated: false, catalogVerified: false, selectedModelPresent: false,
    creditsVerified: false, hasAvailableCredits: false, dailyBudgetPermitsRequest: null,
    chatVerified: false, structuredOutputVerified: false, walletAuthority: "NONE",
    inferenceRequests: 0, publicTransactions: 0, autoTopUpChanged: false };
  let secret, modelId;
  try { secret = bankrProviderSecret(environment); }
  catch { return { ...summary, code: "PROVIDER_NOT_CONFIGURED" }; }
  try { modelId = bankrModelId(environment.GOGH_BANKR_MODEL); }
  catch { return { ...summary, code: "MODEL_NOT_CONFIGURED" }; }

  const controller = new AbortController();
  let timer, activeReader;
  const timeoutError = () => new ArtBrokerProviderError("PROVIDER_TIMEOUT", "Bankr check timed out.");
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeoutMs);
  });
  const read = async path => {
    const response = await fetchImpl(`https://llm.bankr.bot${path}`, {
      method: "GET", headers: { "x-api-key": secret, accept: "application/json" },
      signal: controller.signal, redirect: "error",
    });
    if (!response.ok) {
      Promise.resolve(response.body?.cancel?.()).catch(() => {});
      throw bankrRequestError(new ArtBrokerProviderError("PROVIDER_REQUEST_FAILED", "Bankr read failed.",
        { httpStatus: response.status }));
    }
    const maximumBytes = 1_000_000;
    if (Number(response.headers?.get?.("content-length")) > maximumBytes) {
      Promise.resolve(response.body?.cancel?.()).catch(() => {});
      throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE", "Bankr response too large.");
    }
    if (controller.signal.aborted) {
      Promise.resolve(response.body?.cancel?.()).catch(() => {});
      throw timeoutError();
    }
    if (!response.body?.getReader) throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no JSON.");
    const reader = response.body.getReader();
    activeReader = reader;
    const bytes = Buffer.alloc(maximumBytes);
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw timeoutError();
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength > maximumBytes - size) {
          throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE", "Bankr response too large.");
        }
        bytes.set(value, size); size += value.byteLength;
      }
      try { return JSON.parse(bytes.subarray(0, size).toString("utf8")); }
      catch { throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned invalid JSON."); }
    } finally {
      Promise.resolve(reader.cancel()).catch(() => {});
      try { reader.releaseLock(); } catch { /* Timeout may still have a pending read. */ }
      activeReader = null;
    }
  };
  try {
    return await Promise.race([(async () => {
      const catalog = await read("/v1/models");
      if (!Array.isArray(catalog?.data) || catalog.data.length > 1_000) {
        throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no model list.");
      }
      summary.authenticated = true; summary.catalogVerified = true;
      const model = catalog.data.find(entry => entry?.id === modelId);
      summary.selectedModelPresent = Boolean(model && (model.output_modalities === undefined
        || Array.isArray(model.output_modalities) && model.output_modalities.includes("text")));
      if (!summary.selectedModelPresent) return { ...summary, code: "MODEL_NOT_AVAILABLE" };
      const credits = await read("/v1/credits");
      if (credits?.object !== "credit_balance" || typeof credits.effectiveBalanceUsd !== "number"
        || !Number.isFinite(credits.effectiveBalanceUsd) || credits.effectiveBalanceUsd < 0) {
        throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no verified credit balance.");
      }
      summary.creditsVerified = true;
      summary.hasAvailableCredits = credits.effectiveBalanceUsd > 0;
      const budget = credits.dailyBudget;
      if (budget !== undefined && (!budget || typeof budget.exceeded !== "boolean"
        || typeof budget.remainingUsd !== "number" || !Number.isFinite(budget.remainingUsd)
        || budget.remainingUsd < 0 || budget.windowHours !== 24)) {
        throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no verified spending limit.");
      }
      summary.dailyBudgetPermitsRequest = budget === undefined || !budget.exceeded && budget.remainingUsd > 0;
      return { ...summary,
        status: summary.hasAvailableCredits && summary.dailyBudgetPermitsRequest ? "PRECHECK_PASSED" : "NOT_READY",
        code: !summary.hasAvailableCredits ? "PROVIDER_CREDIT_LIMIT" : !summary.dailyBudgetPermitsRequest
          ? "PROVIDER_DAILY_LIMIT" : "LIVE_INFERENCE_CHECK_REQUIRED" };
    })(), deadline]);
  } catch (error) {
    // Upstream bodies and arbitrary transport errors can include keys or URLs.
    // Only locally constructed stable codes leave this operator tool.
    return { ...summary, code: error instanceof ArtBrokerProviderError ? error.code : "PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer); controller.abort();
    try { Promise.resolve(activeReader?.cancel()).catch(() => {}); } catch { /* Best effort. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkBankrGateway();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PRECHECK_PASSED") process.exitCode = 1;
}
