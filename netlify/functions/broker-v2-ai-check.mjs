import { getDatabase } from "@netlify/database";
import { json, readJson } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { verifyAdminBearer } from "./_shared/v2-session.mjs";
import { requireV2StrategyOrigin } from "./broker-v2-strategy.mjs";

const schema = Object.freeze({ type: "object", additionalProperties: false,
  properties: { answer: { type: "string", enum: ["PIXEL_ART"] } }, required: ["answer"] });
const headers = { "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store" };

// Operator-only, fixed probes: no owner impersonation, arbitrary prompts, wallet
// requests, strategy changes or access to a Punk's conversations.
export async function handleV2AiCheck(request, { environment = process.env,
  createRuntime = () => createDatabaseBackedGoghIntelligence(getDatabase().pool, environment),
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, headers);
  try {
    requireV2StrategyOrigin(request);
    // This dedicated credential grants access only to this connection check.
    verifyAdminBearer(request, { GOGH_V2_ADMIN_TOKEN: environment.GOGH_V2_AI_CHECK_TOKEN });
    const body = await readJson(request, 256);
    if (!body || Object.keys(body).length !== 1 || body.action !== "check") {
      return json({ ok: false, code: "INVALID_AI_CHECK" }, 400, headers);
    }
    const { router } = createRuntime();
    const context = { ownerFingerprint: "OPERATOR_AI_CONNECTION_CHECK", punkTokenId: "0" };
    const probes = await Promise.allSettled([
      router.run("CHAT", { instructions: "Reply with GOGH_CONNECTION_OK only.",
        prompt: "Check the connection.", maxOutputTokens: 256 }, context),
      router.run("CLASSIFY_ART", { instructions: "Return only the requested JSON object.",
        prompt: "Classify pixel art. Return answer PIXEL_ART.", schema, maxOutputTokens: 256 }, context),
    ]);
    const checks = probes.map((probe, index) => {
      const result = probe.status === "fulfilled" ? probe.value : null;
      const verified = Boolean(result && (index === 0
        ? result.text?.trim() === "GOGH_CONNECTION_OK" : result.value?.answer === "PIXEL_ART"));
      return { kind: index === 0 ? "CHAT" : "STRUCTURED_OUTPUT", verified,
        provider: result?.provider ?? null,
        code: verified ? "PASS" : probe.status === "rejected"
          ? "PROVIDER_OR_USAGE_CHECK_FAILED" : "INVALID_PROBE_RESPONSE" };
    });
    const ok = checks.every(check => check.verified);
    return json({ ok, code: ok ? "AI_CONNECTION_VERIFIED" : "AI_CONNECTION_CHECK_FAILED",
      gatewayConfigured: Boolean(environment.GOOGLE_GEMINI_BASE_URL && environment.NETLIFY_AI_GATEWAY_URL),
      checks, walletAuthority: "NONE", transactionSubmitted: false }, ok ? 200 : 503, headers);
  } catch (error) { return v2Failure(error); }
}

export default handleV2AiCheck;
export const config = { path: "/api/v2/admin/ai/check", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain"], windowLimit: 4, windowSize: 60,
} };
