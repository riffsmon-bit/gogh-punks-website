import { readAutomationV3PunkState } from "./_shared/autonomy-v3-live.mjs";
import { runAutomatedSeaDropV3Worker } from
  "../../scripts/run-automated-seadrop-v3-worker.mjs";
import { isDeployPreview } from "./_shared/automation-v3-production-bridge.mjs";
import { json, PublicError, readJson, requireSameOrigin } from "./_shared/http.mjs";
import {
  assertHostedExecutionEnabled, V1_RETIRED_REASON,
} from "./_shared/broker-migration-state.mjs";

function requireOwnerRunOrigin(request, environment = process.env) {
  if (!isDeployPreview(environment, request.url)) {
    requireSameOrigin(request);
    return;
  }
  let origin = null;
  try { origin = new URL(request.url).origin; } catch { /* rejected below */ }
  if (!origin || request.headers.get("origin") !== origin) {
    throw new PublicError(403, "ORIGIN_REJECTED", "The request origin was rejected.");
  }
}

function exactTokenId(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, "tokenId")
    || typeof body.tokenId !== "string"
    || !/^(?:0|[1-9][0-9]{0,3})$/.test(body.tokenId)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one valid Punk to run now.");
  }
  return body.tokenId;
}

export async function prepareOwnerPaidAutomationV3(body, dependencies = {}) {
  const tokenId = exactTokenId(body);
  const readPunk = dependencies.readPunk ?? readAutomationV3PunkState;
  const runWorker = dependencies.runWorker ?? runAutomatedSeaDropV3Worker;
  const environment = dependencies.environment ?? process.env;
  try {
    assertHostedExecutionEnabled(environment, { now: dependencies.now });
  } catch (error) {
    throw new PublicError(410, error.code ?? V1_RETIRED_REASON, error.message);
  }
  const punk = await readPunk(tokenId);
  if (punk?.tokenId !== tokenId || punk?.created !== true || punk?.active !== true) {
    throw new PublicError(
      409,
      "PUNK_AUTOMATION_INACTIVE",
      `Punk #${tokenId} must be activated before its owner can run an immediate mint.`,
    );
  }
  const result = await runWorker(environment, {
    requestedTokenId: tokenId,
    ownerPaidPlan: true,
    readOnly: true,
  });
  if (result?.status === "OWNER_TRANSACTION_READY" && result?.execution) {
    return Object.freeze({
      ready: true,
      status: result.status,
      tokenId,
      collection: result.collection,
      execution: result.execution,
    });
  }
  return Object.freeze({
    ready: false,
    status: result?.status ?? "NO_ELIGIBLE_TARGETS",
    tokenId,
    collection: null,
    execution: null,
  });
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    }
    requireOwnerRunOrigin(request, process.env);
    const result = await prepareOwnerPaidAutomationV3(await readJson(request, 1_024));
    return json({ ok: true, run: result }, 200, {
      "cache-control": "private, no-store",
      "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error(JSON.stringify({
      event: "AUTOMATION_V3_OWNER_PAID_PREPARATION_FAILED",
      code: typeof error?.code === "string" ? error.code : "FAILED",
    }));
    return json({
      ok: false,
      code: "OWNER_RUN_FAILED_SAFELY",
      message: "The immediate run stopped safely before MetaMask opened.",
    }, 503);
  }
}

export const config = {
  path: "/api/broker/autonomy-v3-owner-run",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 3,
    windowSize: 60,
  },
};
