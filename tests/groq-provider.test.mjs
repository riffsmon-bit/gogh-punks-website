import test from "node:test";
import assert from "node:assert/strict";
import { GroqArtBrokerProvider, GROQ_ART_BROKER_MODEL } from "../broker/src/v4/ai/groq.mjs";
import { verifyGroqGateway } from "../scripts/check-groq-gateway.mjs";

const secret = "gsk_test_gogh_free_only";
const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
const payload = (content = "Hello.") => ({ id: "test-groq-response", model: GROQ_ART_BROKER_MODEL,
  choices: [{ finish_reason: "stop", message: { content } }],
  usage: { prompt_tokens: 15, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 3 } } });
const provider = fetchImpl => new GroqArtBrokerProvider({ modelId: GROQ_ART_BROKER_MODEL,
  environment: { GROQ_API_KEY: secret }, fetchImpl });

test("Groq binds a server key to one reviewed model and endpoint; no prompt-supplied tools or route", async () => {
  const p = provider(async (url, request) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    assert.equal(request.redirect, "error");
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(body).sort(), ["include_reasoning", "max_completion_tokens", "messages", "model", "reasoning_effort", "stream"]);
    assert.equal(body.model, GROQ_ART_BROKER_MODEL); assert.equal(body.include_reasoning, false);
    assert.equal(body.reasoning_effort, "low"); assert.equal(body.stream, false);
    return new Response(JSON.stringify(payload()));
  });
  const result = await p.chat({ prompt: "Hello", model: "other", tools: [{ name: "transfer" }], endpoint: "https://evil.invalid" });
  assert.equal(result.provider, "GROQ"); assert.equal(result.modelId, GROQ_ART_BROKER_MODEL);
  assert.deepEqual(result.usage, { inputTokens: 15, outputTokens: 20, cachedInputTokens: 3 });
  assert.equal(p.getCapabilities().tools, false); assert.equal(p.getCapabilities().images, false);
  assert.deepEqual(await p.healthCheck(), { ok: true, code: "CONFIGURED" });
});

test("Groq sends strict JSON Schema and only exposes a parsed draft", async () => {
  const p = provider(async (_, request) => {
    assert.deepEqual(JSON.parse(request.body).response_format, { type: "json_schema", json_schema: {
      name: "gogh_art_broker_result", strict: true, schema } });
    return new Response(JSON.stringify(payload('{"answer":"draft only"}')));
  });
  const result = await p.interpretIntent({ prompt: "Make a draft", schema });
  assert.deepEqual(result.value, { answer: "draft only" });
  assert.equal(Object.hasOwn(result, "transaction"), false);
});

test("Groq rejects other models and credential-bearing or arbitrary endpoints before network", () => {
  for (const modelId of ["groq/compound", "openai/gpt-oss-120b", "auto", "", "openai/gpt-oss-20b\n"]) {
    assert.throws(() => new GroqArtBrokerProvider({ modelId }), /not reviewed/);
  }
  for (const endpoint of ["https://api.groq.com.evil.invalid/openai/v1/chat/completions",
    "https://user:pass@api.groq.com/openai/v1/chat/completions", "http://api.groq.com/openai/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions?key=secret"]) {
    assert.throws(() => new GroqArtBrokerProvider({ modelId: GROQ_ART_BROKER_MODEL, endpoint }), /endpoint is invalid/);
  }
});

test("Groq missing key reports unconfigured and cannot start inference", async () => {
  const p = new GroqArtBrokerProvider({ modelId: GROQ_ART_BROKER_MODEL, environment: {},
    fetchImpl() { throw Error("MUST_NOT_FETCH"); } });
  assert.deepEqual(await p.healthCheck(), { ok: false, code: "NOT_CONFIGURED" });
  await assert.rejects(p.chat({ prompt: "Hello" }), { code: "PROVIDER_NOT_CONFIGURED" });
});

for (const [status, code] of [[400, "PROVIDER_INPUT_REJECTED"], [401, "PROVIDER_AUTHENTICATION_FAILED"],
  [402, "PROVIDER_CREDIT_LIMIT"], [403, "PROVIDER_ACCESS_DENIED"], [422, "PROVIDER_INPUT_REJECTED"], [429, "PROVIDER_RATE_LIMIT"]]) {
  test(`Groq HTTP ${status} returns a sanitized terminal limit or configuration error`, async () => {
    let calls = 0;
    const p = provider(async () => { calls++; return new Response(secret, { status }); });
    await assert.rejects(p.chat({ prompt: "Hello" }), error => error.code === code
      && error.httpStatus === status && !error.retryable && !error.message.includes(secret));
    assert.equal(calls, 1);
  });
}

test("Groq transient outage remains bounded and retryable through the existing router", async () => {
  await assert.rejects(provider(async () => new Response("unavailable", { status: 503 })).chat({ prompt: "Hello" }),
    error => error.code === "PROVIDER_REQUEST_FAILED" && error.retryable);
});

test("Groq rejects incomplete, wrong-model, tool-call, refusal, malformed and ambiguous answers", async () => {
  const bad = [
    { ...payload(), model: "other" },
    { ...payload(), choices: [...payload().choices, ...payload().choices] },
    { ...payload(), choices: [{ finish_reason: "stop", message: { content: "ok", tool_calls: [{ id: "transfer" }] } }] },
    { ...payload(), choices: [{ finish_reason: "stop", message: { content: "ok", refusal: "no" } }] },
    { ...payload(), choices: [{ finish_reason: null, message: { content: "ok" } }] },
  ];
  for (const value of bad) await assert.rejects(provider(async () => new Response(JSON.stringify(value))).chat({ prompt: "Hello" }),
    { code: "INVALID_PROVIDER_RESPONSE" });
  await assert.rejects(provider(async () => new Response(JSON.stringify({ ...payload(), choices: [{
    finish_reason: "length", message: { content: '{"answer":"looks valid"}' } }] }))).interpretIntent({ prompt: "Hello", schema }),
  { code: "PROVIDER_OUTPUT_INCOMPLETE" });
  await assert.rejects(provider(async () => new Response(JSON.stringify(payload("not JSON")))).interpretIntent({ prompt: "Hello", schema }),
    { code: "INVALID_STRUCTURED_OUTPUT" });
});

test("Groq fixed probe cannot spend before explicit free-plan verification", async () => {
  const result = await verifyGroqGateway({ environment: { GROQ_API_KEY: secret }, fetchImpl() { throw Error("MUST_NOT_FETCH"); } });
  assert.equal(result.code, "FREE_PLAN_VERIFICATION_REQUIRED"); assert.equal(result.probes.length, 0);
});

test("Groq fixed probe verifies both actual responses without claiming deployed runtime readiness", async () => {
  let calls = 0;
  const result = await verifyGroqGateway({ environment: { GROQ_API_KEY: secret }, freePlanVerified: true,
    fetchImpl: async (_, request) => { calls++;
      const structured = JSON.parse(request.body).response_format;
      return new Response(JSON.stringify(payload(structured ? '{"ok":true,"provider":"GROQ","walletAuthority":"NONE"}' : "GOGH_READY")));
    } });
  assert.equal(calls, 2); assert.equal(result.status, "ADAPTER_LIVE_VERIFIED");
  assert.equal(result.productionRuntimeVerified, false); assert.equal(result.publicTransactions, 0);
});
