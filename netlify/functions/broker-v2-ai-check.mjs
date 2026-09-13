import { getDatabase } from "@netlify/database";
import { json, readJson } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { verifyAdminBearer } from "./_shared/v2-session.mjs";
import { requireV2StrategyOrigin } from "./broker-v2-strategy.mjs";
import { providerPreference } from "../../broker/src/v4/ai/router.mjs";
import { ArtBrokerProviderError } from "../../broker/src/v4/ai/provider.mjs";

const schema = Object.freeze({ type: "object", additionalProperties: false,
  properties: { answer: { type: "string", enum: ["PIXEL_ART"] } }, required: ["answer"] });
const headers = { "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store" };

const privilegeNames = Object.freeze([
  "usageSelect", "usageInsert", "usageUpdate", "registrySelect", "registryInsert", "registryUpdate",
]);

export async function readV2AiDatabasePrivileges(pool) {
  // Fixed read-only catalog checks on this function's actual injected connection.
  // Neither database identity nor connection details leave the server.
  const result = await pool.query(`SELECT
    COALESCE(has_table_privilege(to_regclass('broker_v2_provider_usage'), 'SELECT'), FALSE) AS "usageSelect",
    COALESCE(has_table_privilege(to_regclass('broker_v2_provider_usage'), 'INSERT'), FALSE) AS "usageInsert",
    COALESCE(has_table_privilege(to_regclass('broker_v2_provider_usage'), 'UPDATE'), FALSE) AS "usageUpdate",
    COALESCE(has_table_privilege(to_regclass('broker_v2_model_registry'), 'SELECT'), FALSE) AS "registrySelect",
    COALESCE(has_table_privilege(to_regclass('broker_v2_model_registry'), 'INSERT'), FALSE) AS "registryInsert",
    COALESCE(has_table_privilege(to_regclass('broker_v2_model_registry'), 'UPDATE'), FALSE) AS "registryUpdate"`);
  return Object.fromEntries(privilegeNames.map(key => [key, result.rows[0]?.[key] === true]));
}

async function boundedPrivileges(readPrivileges) {
  let timer;
  try {
    const value = await Promise.race([readPrivileges(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("AI database privilege check timed out")), 3_000);
    })]);
    return { checked: true, ...Object.fromEntries(privilegeNames.map(key => [key, value?.[key] === true])) };
  } catch {
    return { checked: false, ...Object.fromEntries(privilegeNames.map(key => [key, false])) };
  } finally { clearTimeout(timer); }
}

// Operator-only, fixed probes: no owner impersonation, arbitrary prompts, wallet
// requests, strategy changes or access to a Punk's conversations.
export async function handleV2AiCheck(request, { environment = process.env, pool,
  createRuntime = () => createDatabaseBackedGoghIntelligence(pool ?? getDatabase().pool, environment),
  readPrivileges = () => readV2AiDatabasePrivileges(pool ?? getDatabase().pool),
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, headers);
  try {
    requireV2StrategyOrigin(request);
    // This dedicated credential grants access only to this connection check.
    verifyAdminBearer(request, { GOGH_V2_ADMIN_TOKEN: environment.GOGH_V2_AI_CHECK_TOKEN });
    const body = await readJson(request, 256);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["action", "provider"].includes(key)) || body.action !== "check") {
      return json({ ok: false, code: "INVALID_AI_CHECK" }, 400, headers);
    }
    let preference;
    try { preference = providerPreference(body.provider); } catch {
      return json({ ok: false, code: "INVALID_AI_CHECK" }, 400, headers);
    }
    const databasePrivileges = await boundedPrivileges(readPrivileges);
    if (!databasePrivileges.checked || !privilegeNames.every(key => databasePrivileges[key])) {
      return json({ ok: false, code: "AI_DATABASE_PRIVILEGES_UNAVAILABLE", requestedProvider: preference,
        databasePrivileges, checks: [], walletAuthority: "NONE", transactionSubmitted: false }, 503, headers);
    }
    const { router } = createRuntime();
    const context = { ownerFingerprint: "OPERATOR_AI_CONNECTION_CHECK", punkTokenId: "0", preference };
    const probes = await Promise.allSettled([
      router.run("CHAT", { instructions: "Reply with GOGH_CONNECTION_OK only.",
        prompt: "Check the connection.", maxOutputTokens: 256 }, context),
      router.run("CLASSIFY_ART", { instructions: "Return only the requested JSON object.",
        prompt: "Classify pixel art. Return answer PIXEL_ART.", schema, maxOutputTokens: 256 }, context),
    ]);
    const checks = probes.map((probe, index) => {
      const result = probe.status === "fulfilled" ? probe.value : null;
      const verified = Boolean(result && (preference === "AUTO" || result.provider === preference) && (index === 0
        ? result.text?.trim() === "GOGH_CONNECTION_OK" : result.value?.answer === "PIXEL_ART"));
      const providerError = probe.status === "rejected" && probe.reason instanceof ArtBrokerProviderError
        ? probe.reason : null;
      const safeCodes = ["PROVIDER_REQUEST_FAILED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE",
        "INVALID_PROVIDER_RESPONSE", "INVALID_STRUCTURED_OUTPUT", "PROVIDER_RESPONSE_TOO_LARGE",
        "PROVIDER_NOT_CONFIGURED", "AI_REQUEST_TIMEOUT", "AI_QUOTA_EXCEEDED", "GOGH_INTELLIGENCE_UNAVAILABLE",
        "PROVIDER_INPUT_REJECTED", "PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_CREDIT_LIMIT",
        "PROVIDER_ACCESS_DENIED", "PROVIDER_RATE_LIMIT", "PROVIDER_OUTPUT_INCOMPLETE"];
      return { kind: index === 0 ? "CHAT" : "STRUCTURED_OUTPUT", verified,
        provider: result?.provider ?? null,
        ...(providerError?.httpStatus ? { httpStatus: providerError.httpStatus } : {}),
        code: verified ? "PASS" : probe.status === "rejected"
          ? safeCodes.includes(providerError?.code) ? providerError.code : "PROVIDER_OR_USAGE_CHECK_FAILED"
          : "INVALID_PROBE_RESPONSE" };
    });
    const ok = checks.every(check => check.verified);
    return json({ ok, code: ok ? "AI_CONNECTION_VERIFIED" : "AI_CONNECTION_CHECK_FAILED",
      requestedProvider: preference, databasePrivileges,
      gatewayConfigured: Boolean(environment.NETLIFY_AI_GATEWAY_URL),
      checks, walletAuthority: "NONE", transactionSubmitted: false }, ok ? 200 : 503, headers);
  } catch (error) { return v2Failure(error); }
}

export default handleV2AiCheck;
export const config = { path: "/api/v2/admin/ai/check", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain"], windowLimit: 4, windowSize: 60,
} };
