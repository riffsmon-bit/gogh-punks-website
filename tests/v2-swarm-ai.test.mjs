import assert from "node:assert/strict";
import { inspect } from "node:util";
import test from "node:test";

import { BankrArtBrokerProvider } from "../broker/src/v4/ai/bankr.mjs";
import { AnthropicArtBrokerProvider } from "../broker/src/v4/ai/anthropic.mjs";
import { OpenAIArtBrokerProvider } from "../broker/src/v4/ai/openai.mjs";
import { XAIArtBrokerProvider } from "../broker/src/v4/ai/xai.mjs";
import { providerJsonRequest } from "../broker/src/v4/ai/provider.mjs";
import { ArtBrokerModelRegistry } from "../broker/src/v4/ai/registry.mjs";
import { GoghIntelligenceRouter } from "../broker/src/v4/ai/router.mjs";
import { interpretPunkCollectingIntent } from "../broker/src/v4/ai/intent-interpreter.mjs";
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";

const MAXIMUM = 2_000_000;
const SECRET = "mock-provider-credential-never-public";
const request = (fetchImpl, options = {}) => providerJsonRequest({ fetchImpl,
  url: "https://example.invalid/model", headers: { authorization: SECRET }, body: {}, ...options });
const checkError = (code, retryable = false) => error => {
  assert.equal(error.code, code);
  assert.equal(error.retryable, retryable);
  assert.doesNotMatch(inspect(error), new RegExp(SECRET));
  return true;
};

function streamed(chunks, { status = 200, declared, close = true } = {}) {
  let cursor = 0;
  const state = { reads: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      state.reads++;
      if (cursor < chunks.length) controller.enqueue(chunks[cursor++]);
      else if (close) controller.close();
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { state, response: new Response(body, { status,
    headers: declared === undefined ? {} : { "content-length": String(declared) } }) };
}

test("provider byte limit accepts its exact boundary and preserves split UTF-8", async () => {
  const encoded = Buffer.from(JSON.stringify({ answer: `🎨${"x".repeat(MAXIMUM - 17)}` }));
  assert.equal(encoded.byteLength, MAXIMUM);
  const { response } = streamed([encoded.subarray(0, 13), encoded.subarray(13, 14),
    encoded.subarray(14)]);
  const result = await request(async () => response);
  assert.equal(result.payload.answer, `🎨${"x".repeat(MAXIMUM - 17)}`);
  assert.ok(Number.isInteger(result.latencyMs));
});

test("declared oversized provider response is cancelled without reading it", async () => {
  const { response, state } = streamed([Buffer.from(SECRET)], { declared: MAXIMUM + 1 });
  let signal;
  await assert.rejects(request(async (_, options) => { signal = options.signal; return response; }),
    checkError("PROVIDER_RESPONSE_TOO_LARGE"));
  assert.equal(state.reads, 0);
  assert.equal(state.cancelled, true);
  assert.equal(signal.aborted, true);
});

for (const declared of [undefined, 1, "invalid"]) {
  test(`chunked provider overflow is stopped with content-length ${declared}`, async () => {
    const { response, state } = streamed([
      Buffer.alloc(MAXIMUM, 32), Buffer.from("!"), Buffer.from(SECRET),
    ], { declared });
    await assert.rejects(request(async () => response), checkError("PROVIDER_RESPONSE_TOO_LARGE"));
    assert.equal(state.reads, 2);
    assert.equal(state.cancelled, true);
  });
}

test("provider counts UTF-8 bytes instead of characters", async () => {
  const text = JSON.stringify({ answer: "🎨".repeat(500_000) });
  assert.ok(text.length < MAXIMUM);
  assert.ok(Buffer.byteLength(text) > MAXIMUM);
  await assert.rejects(request(async () => new Response(text)),
    checkError("PROVIDER_RESPONSE_TOO_LARGE"));
});

for (const status of [400, 401, 408, 429, 503]) {
  test(`HTTP ${status} retains retry classification without reading error body`, async () => {
    const { response, state } = streamed([Buffer.from(`<html>${SECRET}</html>`)],
      { status, declared: MAXIMUM * 10 });
    await assert.rejects(request(async () => response), error => {
      checkError("PROVIDER_REQUEST_FAILED", [408, 429, 503].includes(status))(error);
      assert.equal(error.httpStatus, status);
      return true;
    });
    assert.equal(state.reads, 0);
    assert.equal(state.cancelled, true);
  });
}

test("successful empty or malformed JSON stays a terminal invalid response", async () => {
  for (const response of [new Response(null), new Response(""), new Response(`<html>${SECRET}</html>`)]) {
    await assert.rejects(request(async () => response), checkError("INVALID_PROVIDER_RESPONSE"));
  }
});

test("a text-only transport cannot bypass the streaming byte limit", async () => {
  let read = false;
  await assert.rejects(request(async () => ({ ok: true, status: 200,
    text: async () => { read = true; return '{}'; } })), checkError("INVALID_PROVIDER_RESPONSE"));
  assert.equal(read, false);
});

test("transport and stream errors redact raw causes and remain retryable", async () => {
  await assert.rejects(request(async () => { throw Error(`Authorization: ${SECRET}`); }),
    checkError("PROVIDER_UNAVAILABLE", true));
  const body = new ReadableStream({ pull(controller) { controller.error(Error(SECRET)); } });
  await assert.rejects(request(async () => new Response(body)), checkError("PROVIDER_UNAVAILABLE", true));
});

test("deadline bounds a transport that ignores AbortSignal and cancels a late body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveFetch;
  let signal;
  const pending = request(async (_, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveFetch = resolve; });
  }, { timeoutMs: 1_000 });
  const rejection = assert.rejects(pending, checkError("PROVIDER_TIMEOUT", true));
  t.mock.timers.tick(1_000);
  await rejection;
  assert.equal(signal.aborted, true);
  const { response, state } = streamed([Buffer.from(SECRET)]);
  resolveFetch(response);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.cancelled, true);
  assert.equal(state.reads, 0);
});

test("deadline bounds a stalled reader even if cancellation never settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  let beginRead;
  const reading = new Promise(resolve => { beginRead = resolve; });
  const pending = request(async () => ({ ok: true, status: 200,
    body: { getReader: () => ({
      read: () => { beginRead(); return new Promise(() => {}); },
      cancel: () => { cancelled = true; return new Promise(() => {}); },
      releaseLock: () => {},
    }) },
  }), { timeoutMs: 1_000 });
  const rejection = assert.rejects(pending, checkError("PROVIDER_TIMEOUT", true));
  await reading;
  t.mock.timers.tick(1_000);
  await rejection;
  assert.equal(cancelled, true);
});

function routerFixture(openaiFetch) {
  const registry = new ArtBrokerModelRegistry([
    { registryKey: "openai:fast", provider: "OPENAI", modelId: "mock-a", displayName: "GPT",
      capabilities: { supportsImages: true, supportsTools: false, supportsStructuredOutput: true },
      costTier: 1, speedTier: 5, enabled: true, fallbackPriority: 1 },
    { registryKey: "bankr:route", provider: "BANKR", modelId: "mock-b", displayName: "Gateway",
      capabilities: { supportsImages: true, supportsTools: false, supportsStructuredOutput: true },
      costTier: 2, speedTier: 4, enabled: true, fallbackPriority: 2 },
  ]);
  const state = { fallbackCalls: 0, records: [] };
  const router = new GoghIntelligenceRouter({ registry,
    providers: {
      "openai:fast": new OpenAIArtBrokerProvider({ modelId: "mock-a", fetchImpl: openaiFetch,
        environment: { OPENAI_API_KEY: SECRET } }),
      "bankr:route": new BankrArtBrokerProvider({ modelId: "mock-b",
        environment: { BANKR_API_KEY: SECRET }, fetchImpl: async () => {
          state.fallbackCalls++;
          return new Response(JSON.stringify({ choices: [{ message: { content: "Reviewed draft only." } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 } }));
        } }),
    }, usage: { record: async value => state.records.push(value) } });
  return { router, state };
}

test("AUTO can recover from an HTML service outage without recording its body", async () => {
  const { router, state } = routerFixture(async () => new Response(`<html>${SECRET}</html>`, { status: 503 }));
  const result = await router.run("CHAT", { prompt: "What is my mission?" }, { punkTokenId: "93" });
  assert.equal(result.provider, "BANKR");
  assert.equal(state.fallbackCalls, 1);
  assert.deepEqual(state.records.map(value => value.resultCode), ["PROVIDER_REQUEST_FAILED", "OK"]);
  assert.equal(state.records[0].usage, undefined);
  assert.doesNotMatch(JSON.stringify(state.records), new RegExp(SECRET));
  assert.equal(Object.hasOwn(result, "transaction"), false);
});

test("malformed successful output does not broaden retry or fallback authority", async () => {
  const { router, state } = routerFixture(async () => new Response("not JSON"));
  await assert.rejects(router.run("CHAT", { prompt: "What is my mission?" }),
    checkError("INVALID_PROVIDER_RESPONSE"));
  assert.equal(state.fallbackCalls, 0);
  assert.deepEqual(state.records.map(value => value.resultCode), ["INVALID_PROVIDER_RESPONSE"]);
});

test("structured streamed output remains a draft and cannot change Punk identity", async () => {
  const now = new Date("2026-09-13T15:00:00Z");
  const currentIntent = defaultAskIntent({ punkTokenId: "93",
    expectedOwner: "0x1111111111111111111111111111111111111111",
    punkWallet: "0x2222222222222222222222222222222222222222" }, now);
  let proposed = currentIntent;
  const { router } = routerFixture(async () => new Response(JSON.stringify({ output: [
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(proposed) }] },
  ] })));
  const result = await interpretPunkCollectingIntent({ router, message: "Keep my current settings.",
    currentIntent, context: { punkTokenId: "93" }, now });
  assert.equal(result.economicPermissionsActivated, false);
  assert.deepEqual(result.intent, currentIntent);
  proposed = { ...currentIntent, punkTokenId: "1753" };
  await assert.rejects(interpretPunkCollectingIntent({ router, message: "Keep my current settings.",
    currentIntent, context: { punkTokenId: "93" }, now }), /changed immutable Punk identity/);
});

const STRUCTURED_SCHEMA = { type: "object", properties: { answer: { type: "string" } },
  required: ["answer"], additionalProperties: false };
const VALID_JSON = '{"answer":"This is valid JSON but generation may be incomplete."}';
const cases = [
  { name: "OpenAI", Provider: OpenAIArtBrokerProvider, secretName: "OPENAI_API_KEY",
    payload: marker => ({ status: marker, output: [{ type: "message", status: "completed",
      content: [{ type: "output_text", text: VALID_JSON }] }] }),
    incomplete: ["incomplete"], other: ["in_progress", "queued", "cancelled", "failed"], complete: ["completed"] },
  { name: "xAI", Provider: XAIArtBrokerProvider, secretName: "XAI_API_KEY",
    payload: marker => ({ status: marker, output: [{ type: "message", status: "completed",
      content: [{ type: "output_text", text: VALID_JSON }] }] }),
    incomplete: ["incomplete"], other: ["in_progress"], complete: ["completed"] },
  { name: "Anthropic", Provider: AnthropicArtBrokerProvider, secretName: "ANTHROPIC_API_KEY",
    payload: marker => ({ stop_reason: marker, content: [{ type: "text", text: VALID_JSON }] }),
    incomplete: ["max_tokens", "model_context_window_exceeded"], other: ["tool_use", "pause_turn", "refusal"],
    complete: ["end_turn", "stop_sequence"] },
  { name: "Bankr", Provider: BankrArtBrokerProvider, secretName: "BANKR_API_KEY",
    payload: marker => ({ choices: [{ finish_reason: marker, message: { content: VALID_JSON } }] }),
    incomplete: ["length"], other: ["tool_calls", "function_call", "content_filter"], complete: ["stop"] },
];

for (const entry of cases) {
  test(`${entry.name} refuses explicitly unfinished chat and valid-looking structured output`, async () => {
    let marker;
    const provider = new entry.Provider({ modelId: "mock-model", environment: { [entry.secretName]: SECRET },
      fetchImpl: async () => new Response(JSON.stringify(entry.payload(marker))) });
    for (marker of [...entry.incomplete, ...entry.other]) {
      const code = entry.incomplete.includes(marker) ? "PROVIDER_OUTPUT_INCOMPLETE" : "INVALID_PROVIDER_RESPONSE";
      await assert.rejects(provider.chat({ prompt: "Say hello." }), checkError(code));
      await assert.rejects(provider.interpretIntent({ prompt: "Draft only.", schema: STRUCTURED_SCHEMA }),
        checkError(code));
    }
    for (marker of entry.complete) {
      assert.deepEqual((await provider.interpretIntent({ prompt: "Draft only.", schema: STRUCTURED_SCHEMA })).value,
        JSON.parse(VALID_JSON));
    }
  });
}

test("Responses message-level incomplete status rejects otherwise completed envelope", async () => {
  const provider = new OpenAIArtBrokerProvider({ modelId: "mock-model", environment: { OPENAI_API_KEY: SECRET },
    fetchImpl: async () => new Response(JSON.stringify({ status: "completed", output: [
      { type: "message", status: "completed", content: [{ type: "output_text", text: "A completed preamble." }] },
      { type: "message", status: "incomplete", content: [{ type: "output_text", text: VALID_JSON }] },
    ] })) });
  await assert.rejects(provider.chat({ prompt: "Say hello." }), checkError("PROVIDER_OUTPUT_INCOMPLETE"));
});

test("incomplete output stays terminal instead of triggering more paid generation", async () => {
  const { router, state } = routerFixture(async () => new Response(JSON.stringify({ status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "message", content: [{ type: "output_text", text: VALID_JSON }] }],
  })));
  await assert.rejects(router.run("INTERPRET_INTENT", { prompt: "Draft only.", schema: STRUCTURED_SCHEMA }),
    checkError("PROVIDER_OUTPUT_INCOMPLETE"));
  assert.equal(state.fallbackCalls, 0);
  assert.deepEqual(state.records.map(value => value.resultCode), ["PROVIDER_OUTPUT_INCOMPLETE"]);
});
