import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { GroqArtBrokerProvider, GROQ_ART_BROKER_MODEL } from "../broker/src/v4/ai/groq.mjs";

// Exactly two fixed text probes; never accepts holder prompts, tools or URLs.
// Production readiness additionally requires the deployed quota-backed admin
// probe. This operator check verifies the actual adapter before enabling it.
export async function verifyGroqGateway({ environment = process.env, fetchImpl = fetch,
  freePlanVerified = false } = {}) {
  const result = { schema: "GOGH_GROQ_FIXED_PROVIDER_PROBE_V1", checkedAt: new Date().toISOString(),
    provider: "GROQ", modelId: GROQ_ART_BROKER_MODEL, status: "NOT_READY", freePlanVerified,
    accountBillingChanged: false, walletAuthority: "NONE", publicTransactions: 0, probes: [] };
  if (!freePlanVerified) return { ...result, code: "FREE_PLAN_VERIFICATION_REQUIRED" };
  const provider = new GroqArtBrokerProvider({ modelId: GROQ_ART_BROKER_MODEL, environment, fetchImpl, timeoutMs: 10_000 });
  if (!(await provider.healthCheck()).ok) return { ...result, code: "PROVIDER_NOT_CONFIGURED" };
  const schema = { type: "object", properties: { ok: { type: "boolean", enum: [true] },
    provider: { type: "string", enum: ["GROQ"] }, walletAuthority: { type: "string", enum: ["NONE"] } },
  required: ["ok", "provider", "walletAuthority"], additionalProperties: false };
  for (const [task, input] of [
    ["CHAT", { instructions: "This is a fixed connection check. Reply exactly GOGH_READY. Do not use tools.",
      prompt: "Reply GOGH_READY.", maxOutputTokens: 512 }],
    ["INTERPRET_INTENT", { instructions: "This is a fixed structured-output check. Return only the requested JSON object. No tools.",
      prompt: 'Return {"ok":true,"provider":"GROQ","walletAuthority":"NONE"}.', schema, maxOutputTokens: 512 }],
  ]) {
    try {
      const response = await provider.invoke(task, input);
      if (task === "CHAT") assert.equal(response.text.trim(), "GOGH_READY");
      else assert.deepEqual(response.value, { ok: true, provider: "GROQ", walletAuthority: "NONE" });
      result.probes.push({ task, status: "PASS", actualModel: response.modelId, latencyMs: response.latencyMs,
        usage: response.usage });
    } catch (error) {
      // Never reflect transport bodies, response text, or arbitrary exception messages.
      const allowed = new Set(["PROVIDER_NOT_CONFIGURED", "PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_CREDIT_LIMIT",
        "PROVIDER_ACCESS_DENIED", "PROVIDER_RATE_LIMIT", "PROVIDER_INPUT_REJECTED", "PROVIDER_TIMEOUT",
        "PROVIDER_REQUEST_FAILED", "INVALID_PROVIDER_RESPONSE", "INVALID_STRUCTURED_OUTPUT", "PROVIDER_OUTPUT_INCOMPLETE"]);
      result.probes.push({ task, status: "FAIL", code: allowed.has(error?.code) ? error.code : "PROBE_FAILED" });
      return result;
    }
  }
  return { ...result, status: "ADAPTER_LIVE_VERIFIED", productionRuntimeVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowed = args.every(x => x === "--free-plan-verified" || x === "--keychain" || x.startsWith("--output="));
  if (!allowed) throw Error("UNSUPPORTED_PROBE_OPTION");
  const environment = { ...process.env };
  try {
    if (args.includes("--keychain")) environment.GROQ_API_KEY = (await promisify(execFile)("security", [
      "find-generic-password", "-s", "Gogh Punks Groq API Key", "-a", "riffs.mon@gmail.com", "-w",
    ], { timeout: 10_000, maxBuffer: 4_096 })).stdout.trim();
    const result = await verifyGroqGateway({ environment, freePlanVerified: args.includes("--free-plan-verified") });
    const output = args.find(x => x.startsWith("--output="))?.slice("--output=".length);
    if (output) await writeFile(output, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "ADAPTER_LIVE_VERIFIED") process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: "NOT_READY", code: "SAFE_PROBE_SETUP_FAILED", secretValuesPrinted: false }));
    process.exitCode = 1;
  }
}
