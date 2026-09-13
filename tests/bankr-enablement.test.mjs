import test from "node:test";
import assert from "node:assert/strict";
import { BankrArtBrokerProvider } from "../broker/src/v4/ai/bankr.mjs";
import { checkBankrGateway } from "../scripts/check-bankr-gateway.mjs";

const secret = "bk_test_dedicated_gateway_only";
const environment = { BANKR_LLM_KEY: secret, BANKR_API_KEY: "bk_test_legacy", GOGH_BANKR_MODEL: "gpt-5-nano" };
const reply = { choices: [{ finish_reason: "stop", message: { content: "Hello." } }] };
const json = value => new Response(JSON.stringify(value));

test("Bankr uses the dedicated gateway credential and ignores untrusted request controls", async () => {
  const provider = new BankrArtBrokerProvider({ environment, modelId: environment.GOGH_BANKR_MODEL,
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://llm.bankr.bot/v1/chat/completions");
      assert.equal(request.headers["x-api-key"], secret);
      assert.equal(request.redirect, "error");
      const body = JSON.parse(request.body);
      assert.equal(body.model, "gpt-5-nano");
      assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model"]);
      return json(reply);
    } });
  assert.equal((await provider.chat({ prompt: "Hello", tools: ["transfer"], model: "expensive", endpoint: "https://evil.invalid" })).text, "Hello.");
  assert.equal(provider.getCapabilities().tools, false);
  assert.equal(provider.getCapabilities().images, false);
  assert.deepEqual(await provider.healthCheck(), { ok: true, code: "CONFIGURED" });
});

test("Bankr legacy gateway credential remains supported", async () => {
  const provider = new BankrArtBrokerProvider({ environment: { BANKR_API_KEY: secret }, modelId: "gpt-5-nano",
    fetchImpl: async (_, request) => { assert.equal(request.headers["x-api-key"], secret); return json(reply); } });
  assert.equal((await provider.chat({ prompt: "Hello" })).text, "Hello.");
});

test("invalid configured dedicated credential never falls back to broader credential", async () => {
  let requests = 0;
  const provider = new BankrArtBrokerProvider({ environment: { ...environment, BANKR_LLM_KEY: " " }, modelId: "gpt-5-nano",
    fetchImpl: async () => { requests++; return json(reply); } });
  await assert.rejects(provider.chat({ prompt: "Hello" }), { code: "PROVIDER_NOT_CONFIGURED" });
  assert.equal(requests, 0);
});

for (const modelId of ["auto", "bankr:auto", "bankr/gpt-5-nano", "x\ny", "", "a".repeat(180)]) {
  test(`Bankr refuses noncatalog model format ${JSON.stringify(modelId)}`, () => {
    assert.throws(() => new BankrArtBrokerProvider({ modelId, environment }), /model ID is invalid/);
  });
}

for (const [status, code] of [[401, "PROVIDER_AUTHENTICATION_FAILED"], [402, "PROVIDER_CREDIT_LIMIT"], [403, "PROVIDER_ACCESS_DENIED"]]) {
  test(`Bankr HTTP ${status} is terminal, sanitized and never tops up`, async () => {
    let requests = 0;
    const provider = new BankrArtBrokerProvider({ environment, modelId: "gpt-5-nano", fetchImpl: async () => {
      requests++; return new Response(secret, { status });
    } });
    await assert.rejects(provider.chat({ prompt: "Hello" }), error => error.code === code && !error.retryable
      && error.httpStatus === status && !error.message.includes(secret));
    assert.equal(requests, 1);
  });
}

test("Bankr rejects tool requests even with a completed-looking text answer", async () => {
  const provider = new BankrArtBrokerProvider({ environment, modelId: "gpt-5-nano", fetchImpl: async () => json({
    choices: [{ finish_reason: "stop", message: { content: "Done.", tool_calls: [{ function: { name: "transfer" } }] } }],
  }) });
  await assert.rejects(provider.chat({ prompt: "Hello" }), { code: "INVALID_PROVIDER_RESPONSE" });
});

const catalog = { data: [{ id: "gpt-5-nano", output_modalities: ["text"] }] };
const balance = { object: "credit_balance", effectiveBalanceUsd: 5 };
const fixture = ({ credits = balance, models = catalog } = {}) => {
  const requests = [];
  return { requests, fetchImpl: async (url, init) => {
    requests.push({ url, method: init.method });
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.headers["x-api-key"], secret);
    if (url === "https://llm.bankr.bot/v1/models") return json(models);
    if (url === "https://llm.bankr.bot/v1/credits") return json(credits);
    throw Error("UNAUTHORIZED_ENDPOINT");
  } };
};

test("Bankr preflight uses two fixed reads and never promotes readiness without inference proof", async () => {
  const f = fixture(), result = await checkBankrGateway({ environment, fetchImpl: f.fetchImpl });
  assert.equal(result.status, "PRECHECK_PASSED");
  assert.equal(result.code, "LIVE_INFERENCE_CHECK_REQUIRED");
  assert.equal(result.chatVerified, false); assert.equal(result.structuredOutputVerified, false);
  assert.equal(result.inferenceRequests, 0); assert.equal(result.publicTransactions, 0);
  assert.equal(result.walletAuthority, "NONE"); assert.equal(f.requests.length, 2);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

for (const [name, credits, code] of [
  ["no credits", { ...balance, effectiveBalanceUsd: 0 }, "PROVIDER_CREDIT_LIMIT"],
  ["daily limit", { ...balance, dailyBudget: { remainingUsd: 0, exceeded: true, windowHours: 24 } }, "PROVIDER_DAILY_LIMIT"],
  ["unknown budget", { ...balance, dailyBudget: {} }, "INVALID_PROVIDER_RESPONSE"],
  ["unknown effective credits", { object: "credit_balance", balanceUsd: 5 }, "INVALID_PROVIDER_RESPONSE"],
]) test(`Bankr preflight stops on ${name}`, async () => {
  const f = fixture({ credits }), result = await checkBankrGateway({ environment, fetchImpl: f.fetchImpl });
  assert.equal(result.status, "NOT_READY"); assert.equal(result.code, code);
});

test("Bankr preflight does not mistake an image-only model or absent model for usable chat", async () => {
  for (const models of [{ data: [] }, { data: [{ id: "gpt-5-nano", output_modalities: ["image"] }] }]) {
    const f = fixture({ models }), result = await checkBankrGateway({ environment, fetchImpl: f.fetchImpl });
    assert.equal(result.code, "MODEL_NOT_AVAILABLE"); assert.equal(f.requests.length, 1);
  }
});

test("Bankr preflight without config sends no network request", async () => {
  const result = await checkBankrGateway({ environment: {}, fetchImpl: () => { throw Error("MUST_NOT_FETCH"); } });
  assert.equal(result.code, "PROVIDER_NOT_CONFIGURED");
});

test("Bankr preflight cancels a hung stream at its overall deadline", async () => {
  let cancelled = false;
  const result = await checkBankrGateway({ environment, timeoutMs: 20,
    fetchImpl: async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } })) });
  assert.equal(result.code, "PROVIDER_TIMEOUT"); assert.equal(cancelled, true);
});

test("Bankr preflight does not leak provider or transport errors", async () => {
  for (const fetchImpl of [async () => { throw Error(secret); }, async () => new Response(secret, { status: 401 })]) {
    const result = await checkBankrGateway({ environment, fetchImpl });
    assert.equal(result.status, "NOT_READY"); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
