import assert from "node:assert/strict";
import test, { after } from "node:test";
import { handleV2AiCheck } from "../netlify/functions/broker-v2-ai-check.mjs";

const secret = "connection-check-only-test-credential";
const originalSiteUrl = process.env.SITE_URL;
process.env.SITE_URL = "https://goghpunks.xyz";
after(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});
const environment = { GOGH_V2_AI_CHECK_TOKEN: secret,
  GOOGLE_GEMINI_BASE_URL: "https://goghpunks.xyz/.netlify/ai/",
  NETLIFY_AI_GATEWAY_URL: "https://goghpunks.xyz/.netlify/ai/" };
function request({ token = secret, body = { action: "check" }, origin = "https://goghpunks.xyz" } = {}) {
  return new Request("https://goghpunks.xyz/api/v2/admin/ai/check", { method: "POST",
    headers: { authorization: `Bearer ${token}`, origin, "content-type": "application/json" },
    body: JSON.stringify(body) });
}

test("AI connection check denies unauthenticated, cross-origin and arbitrary-prompt requests before using a provider", async () => {
  let calls = 0;
  for (const input of [{ token: "wrong" }, { origin: "https://attacker.example" },
    { body: { action: "check", prompt: "Spend money" } }]) {
    const response = await handleV2AiCheck(request(input), { environment,
      createRuntime: () => { calls++; throw Error("must not run"); } });
    assert.ok([400, 401, 403].includes(response.status));
  }
  assert.equal(calls, 0);
});

test("AI connection check verifies fixed chat and structured probes without returning credentials or model content", async () => {
  const calls = [];
  const response = await handleV2AiCheck(request(), { environment,
    createRuntime: () => ({ router: { run: async (...args) => {
      calls.push(args);
      return { provider: "GEMINI", text: "GOGH_CONNECTION_OK", value: { answer: "PIXEL_ART" } };
    } } }) });
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.code, "AI_CONNECTION_VERIFIED");
  assert.deepEqual(calls.map(call => call[0]), ["CHAT", "CLASSIFY_ART"]);
  assert.ok(calls.every(call => call[1].maxOutputTokens === 256));
  assert.equal(body.walletAuthority, "NONE"); assert.equal(body.transactionSubmitted, false);
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.equal(JSON.stringify(body).includes("GOGH_CONNECTION_OK"), false);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("provider or usage-recording failure remains unverified and never exposes its raw error", async () => {
  const response = await handleV2AiCheck(request(), { environment,
    createRuntime: () => ({ router: { run: async task => {
      if (task === "CLASSIFY_ART") throw Error(`database error ${secret}`);
      return { provider: "GEMINI", text: "GOGH_CONNECTION_OK" };
    } } }) });
  const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.checks[0].verified, true);
  assert.equal(body.checks[1].verified, false); assert.equal(JSON.stringify(body).includes(secret), false);
});
