import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicArtBrokerProvider } from "../broker/src/v4/ai/anthropic.mjs";
import { BankrArtBrokerProvider } from "../broker/src/v4/ai/bankr.mjs";
import { GeminiArtBrokerProvider } from "../broker/src/v4/ai/gemini.mjs";
import { OpenAIArtBrokerProvider } from "../broker/src/v4/ai/openai.mjs";
import { ArtBrokerProviderError } from "../broker/src/v4/ai/provider.mjs";
import { ArtBrokerModelRegistry, modelRegistryFromEnvironment } from
  "../broker/src/v4/ai/registry.mjs";
import { GoghIntelligenceRouter } from "../broker/src/v4/ai/router.mjs";
import { answerPunkConversation, buildPunkChatPrompt, isPunkConversationMessage } from
  "../broker/src/v4/ai/punk-chat.mjs";
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { XAIArtBrokerProvider } from "../broker/src/v4/ai/xai.mjs";
import { estimateV2ProviderCostMicrousd } from
  "../netlify/functions/_shared/v2-ai-runtime.mjs";

const SCHEMA = Object.freeze({ type: "object", properties: { answer: { type: "string" } },
  required: ["answer"], additionalProperties: false });
const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-06T18:00:00.000Z");

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}

test("OpenAI adapter uses server-side Responses structured output without storing prompts", async () => {
  let request;
  const provider = new OpenAIArtBrokerProvider({ modelId: "configured-at-runtime",
    environment: { OPENAI_API_KEY: "server-only-openai-key" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ id: "resp_1", output: [{ type: "message", content: [
        { type: "output_text", text: '{"answer":"PIXEL_ART"}' }]}],
      usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } } });
    } });
  const result = await provider.classifyArt({ prompt: "classify it", schema: SCHEMA });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer server-only-openai-key");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(result.value, { answer: "PIXEL_ART" });
  assert.equal(JSON.stringify(result).includes("server-only-openai-key"), false);
});

test("Gemini structured output uses the stateless generateContent JSON schema request", async () => {
  let request;
  const provider = new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
    environment: { GEMINI_API_KEY: "server-only-gemini-key" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ responseId: "resp_1", candidates: [{ content: { parts: [
        { text: '{"answer":"PIXEL_ART"}' }] } }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, cachedContentTokenCount: 0 } });
    } });
  const result = await provider.classifyArt({ prompt: "classify it", schema: SCHEMA });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(request.options.headers["x-goog-api-key"], "server-only-gemini-key");
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseJsonSchema, SCHEMA);
  assert.equal(Object.hasOwn(body, "previous_interaction_id"), false);
  assert.deepEqual(result.value, { answer: "PIXEL_ART" });
  assert.equal(JSON.stringify(result).includes("server-only-gemini-key"), false);
});

test("Gemini chat uses the broadly supported stateless generateContent endpoint", async () => {
  let request;
  const provider = new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
    environment: { GEMINI_API_KEY: "server-only-gemini-key" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ responseId: "resp_1", candidates: [{ content: { parts: [
        { text: "Hood afternoon." },
      ] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 } });
    } });
  const result = await provider.chat({ prompt: "hello", instructions: "Be concise." });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(body.system_instruction.parts[0].text, "Be concise.");
  assert.equal(body.contents[0].parts[0].text, "hello");
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(result.text, "Hood afternoon.");
  assert.equal(result.usage.inputTokens, 8);
});

test('Gemini never publishes a reply cut off by its output limit', async () => {
  const provider = new GeminiArtBrokerProvider({ modelId: 'gemini-3.8-flash',
    environment: { GEMINI_API_KEY: 'test-only' }, fetchImpl: async () => response({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: "I can mint if you" }] } }],
    }) });
  await assert.rejects(provider.chat({ prompt: 'Can you mint this?' }), { code: 'PROVIDER_OUTPUT_INCOMPLETE' });
});

test('Gemini returns only completed answer parts, excluding thought parts', async () => {
  const provider = new GeminiArtBrokerProvider({ modelId: 'gemini-3.8-flash',
    environment: { GEMINI_API_KEY: 'test-only' }, fetchImpl: async () => response({
      candidates: [{ finishReason: 'STOP', content: { parts: [
        { thought: true, text: 'Internal thought summary.' }, { text: 'Review the exact mint first.' },
      ] } }],
    }) });
  assert.equal((await provider.chat({ prompt: 'Can you mint this?' })).text, 'Review the exact mint first.');
});

test('chat reserves room for a complete answer and falls back instead of slicing a sentence', async () => {
  let maximum;
  const result = await answerPunkConversation({ router: { run: async (_, input) => {
    maximum = input.maxOutputTokens; return { provider: 'GEMINI', text: 'unfinished '.repeat(200) };
  } }, message: 'What do you think about pixel art?', intent: defaultAskIntent({ punkTokenId: '93',
    expectedOwner: OWNER, punkWallet: PUNK_WALLET }, NOW), punkTokenId: '93', now: NOW });
  assert.ok(maximum >= 1024); assert.equal(result.providerAvailable, false);
  assert.match(result.reply, /Pixel art rewards/); assert.ok(!result.reply.includes('unfinished'));
});

test("Gemini uses Netlify's injected gateway for chat and structured requests", async () => {
  const gateway = "https://gogh-punks.netlify.app/.netlify/ai/";
  for (const chat of [true, false]) {
    let request;
    const provider = new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
      environment: { GEMINI_API_KEY: "netlify-runtime-only-key",
        GOOGLE_GEMINI_BASE_URL: gateway, NETLIFY_AI_GATEWAY_URL: gateway },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return response(chat
          ? { candidates: [{ content: { parts: [{ text: "Hello from your Punk." }] } }] }
          : { candidates: [{ content: { parts: [{ text: '{"answer":"PIXEL_ART"}' }] } }] });
      } });
    const result = await provider.invoke(chat ? "CHAT" : "CLASSIFY_ART",
      { prompt: "classify it", ...(chat ? {} : { schema: SCHEMA }) });
    assert.equal(request.url, `${gateway}v1beta/models/gemini-3.8-flash:generateContent`);
    assert.equal(request.options.headers["x-goog-api-key"], "netlify-runtime-only-key");
    assert.equal(request.options.redirect, "error");
    assert.equal(JSON.stringify(result).includes("netlify-runtime-only-key"), false);
    if (!chat) assert.deepEqual(result.value, { answer: "PIXEL_ART" });
  }
});

test("Gemini rejects a base URL that could send the credential outside the configured gateway", () => {
  const gateway = "https://gogh-punks.netlify.app/.netlify/ai/";
  for (const base of ["https://attacker.example/.netlify/ai/", "http://gogh-punks.netlify.app/.netlify/ai/",
    "https://user:pass@gogh-punks.netlify.app/.netlify/ai/", `${gateway}?key=leak`, `${gateway}#fragment`,
    "https://gogh-punks.netlify.app/other", "https://gogh-punks.netlify.app:8443/.netlify/ai/",
    "https://gogh-punks.netlify.app/bad/../.netlify/ai/", "", " "]) {
    assert.throws(() => new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
      environment: { GEMINI_API_KEY: "netlify-runtime-only-key", GOOGLE_GEMINI_BASE_URL: base,
        NETLIFY_AI_GATEWAY_URL: gateway } }));
  }
  assert.throws(() => new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
    environment: { GOOGLE_GEMINI_BASE_URL: gateway } }));
});

test("an explicitly configured direct Google base remains supported", () => {
  const provider = new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
    environment: { GOOGLE_GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/" } });
  assert.equal(provider.endpoint,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
});

test("Claude adapter uses Messages output_config and current version header", async () => {
  let request;
  const provider = new AnthropicArtBrokerProvider({ modelId: "runtime-claude",
    environment: { ANTHROPIC_API_KEY: "server-only-claude-key" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ id: "msg_1", stop_reason: "end_turn",
        content: [{ type: "text", text: '{"answer":"SAFE"}' }],
        usage: { input_tokens: 8, output_tokens: 3 } });
    } });
  const result = await provider.summarizeRisk({ prompt: "summarize", schema: SCHEMA });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.options.headers["x-api-key"], "server-only-claude-key");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.deepEqual(result.value, { answer: "SAFE" });
});

test("xAI adapter stays independently configured behind the same provider contract", async () => {
  let url;
  const provider = new XAIArtBrokerProvider({ modelId: "runtime-grok",
    environment: { XAI_API_KEY: "server-only-xai-key" }, fetchImpl: async (value) => {
      url = value;
      return response({ id: "xai_1", output: [{ type: "message", content: [
        { type: "output_text", text: "Punk-like answer" }]}] });
    } });
  assert.equal((await provider.chat({ prompt: "hello" })).text, "Punk-like answer");
  assert.equal(url, "https://api.x.ai/v1/responses");
});

test("Bankr is an LLM gateway only and uses its documented OpenAI-compatible path", async () => {
  let request;
  const provider = new BankrArtBrokerProvider({ modelId: "server-managed-route",
    environment: { BANKR_API_KEY: "server-only-bankr-key" }, fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ id: "bankr_1", choices: [{ message: { content: '{"answer":"WEIRD"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 } });
    } });
  const result = await provider.classifyArt({ prompt: "classify", schema: SCHEMA });
  assert.equal(request.url, "https://llm.bankr.bot/v1/chat/completions");
  assert.equal(request.options.headers["x-api-key"], "server-only-bankr-key");
  assert.deepEqual(result.value, { answer: "WEIRD" });
  assert.equal(Object.hasOwn(result, "wallet"), false);
});

test("registry keeps model IDs server-side and creates no stale defaults", () => {
  const empty = modelRegistryFromEnvironment({});
  assert.deepEqual(empty.enabled(), []);
  const configured = modelRegistryFromEnvironment({ GOGH_OPENAI_MODEL: "current-from-env" });
  assert.equal(configured.enabled()[0].modelId, "current-from-env");
  assert.equal(Object.hasOwn(configured.publicView()[0], "modelId"), false);
  const free = modelRegistryFromEnvironment({ GOGH_GEMINI_MODEL: "gemini-3.8-flash",
    GOGH_GEMINI_INPUT_COST_USD_PER_MILLION_TOKENS: "0",
    GOGH_GEMINI_OUTPUT_COST_USD_PER_MILLION_TOKENS: "0" });
  assert.equal(free.enabled()[0].provider, "GEMINI");
  assert.equal(free.enabled()[0].inputCostMicrousdPerMillionTokens, 0);
});

test("model pricing is server-configured instead of frozen to stale provider prices", () => {
  const registry = modelRegistryFromEnvironment({ GOGH_OPENAI_MODEL: "current-from-env",
    GOGH_OPENAI_INPUT_COST_USD_PER_MILLION_TOKENS: "1.25",
    GOGH_OPENAI_OUTPUT_COST_USD_PER_MILLION_TOKENS: "10" });
  const entry = registry.enabled()[0];
  assert.equal(entry.inputCostMicrousdPerMillionTokens, 1_250_000);
  assert.equal(entry.outputCostMicrousdPerMillionTokens, 10_000_000);
  assert.equal(estimateV2ProviderCostMicrousd(entry, { inputTokens: 1_000,
    outputTokens: 200 }), 3_250);
  assert.equal(estimateV2ProviderCostMicrousd(entry, {}), null);
});

test("AUTO router falls back only after a retryable provider failure and records usage", async () => {
  const registry = new ArtBrokerModelRegistry([
    { registryKey: "openai:fast", provider: "OPENAI", modelId: "a", displayName: "GPT",
      capabilities: { supportsImages: true, supportsTools: false, supportsStructuredOutput: true },
      costTier: 1, speedTier: 5, enabled: true, fallbackPriority: 1 },
    { registryKey: "bankr:route", provider: "BANKR", modelId: "b", displayName: "Bankr Routed",
      capabilities: { supportsImages: true, supportsTools: false, supportsStructuredOutput: true },
      costTier: 2, speedTier: 4, enabled: true, fallbackPriority: 2 },
  ]);
  const records = [];
  const router = new GoghIntelligenceRouter({ registry,
    providers: {
      "openai:fast": { invoke: async () => { throw new ArtBrokerProviderError("TIMEOUT", "timeout", { retryable: true }); } },
      "bankr:route": { invoke: async () => ({ provider: "BANKR", modelId: "b", task: "CHAT",
        text: "ready", value: null, requestId: "2", usage: {}, latencyMs: 2 }) },
    }, usage: { record: async (value) => records.push(value) } });
  const result = await router.run("CHAT", { prompt: "hello" }, { punkTokenId: "119" });
  assert.equal(result.provider, "BANKR");
  assert.deepEqual(records.map(({ resultCode }) => resultCode), ["TIMEOUT", "OK"]);
});

test("provider failures never return a guessed strategy", async () => {
  const provider = new OpenAIArtBrokerProvider({ modelId: "runtime-model",
    environment: { OPENAI_API_KEY: "server-only-openai-key" },
    fetchImpl: async () => response({ error: { message: "busy" } }, 503) });
  await assert.rejects(provider.interpretIntent({ prompt: "go autonomous", schema: SCHEMA }),
    (error) => error.code === "PROVIDER_REQUEST_FAILED" && error.retryable === true);
});

test("Punk conversation is grounded in strategy data and cannot grant wallet authority", async () => {
  const intent = defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
    punkWallet: PUNK_WALLET }, NOW);
  const grounded = buildPunkChatPrompt({ message: "What are we hunting?", intent,
    inspection: { kind: "OPENSEA_COLLECTION", status: "NEEDS_REVIEW" },
    history: [{ role: "OWNER", content: "I like blue pixel art." },
      { role: "PUNK", content: "I will keep that taste in mind." }],
    review: { checkedCount: 3, eligibleCount: 1,
      leadingCollectionName: "Neon Alley", leadingMatchScore: 94 },
    punkTokenId: "93", now: NOW });
  assert.match(grounded.instructions, /Never produce transaction calldata/);
  assert.match(grounded.prompt, /OPENSEA_COLLECTION/);
  assert.match(grounded.prompt, /Neon Alley/);
  assert.match(grounded.prompt, /blue pixel art/);
  assert.doesNotMatch(grounded.prompt, new RegExp(OWNER, "i"));
  assert.doesNotMatch(grounded.prompt, new RegExp(PUNK_WALLET, "i"));
  assert.match(grounded.prompt, /CURRENT_OWNER/);
  assert.match(grounded.prompt, /CANONICAL_PUNK_WALLET/);
  let invocation;
  const response = await answerPunkConversation({ router: { run: async (...args) => {
    invocation = args;
    return { text: "We’re hunting carefully.", provider: "OPENAI", registryKey: "openai:auto" };
  } }, message: "What are we hunting?", intent, punkTokenId: "93", now: NOW });
  assert.equal(invocation[0], "CHAT");
  assert.equal(response.reply, "We’re hunting carefully.");
  assert.equal(response.providerAvailable, true);
  assert.equal(Object.hasOwn(response, "transaction"), false);
});

test("Punk conversation gives an honest useful fallback when no model is configured", async () => {
  const intent = defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
    punkWallet: PUNK_WALLET }, NOW);
  const response = await answerPunkConversation({ router: null,
    message: "Where do I send my agent out?", intent, punkTokenId: "93", now: NOW });
  assert.equal(response.provider, "DETERMINISTIC_FALLBACK");
  assert.match(response.reply, /SEND PUNK OUT/);
  assert.match(response.reply, /cannot mint or sign/);
  assert.equal(isPunkConversationMessage("What do you think about pixel art?"), true);
  assert.equal(isPunkConversationMessage("Find free pixel art for me."), false);
  const balance = await answerPunkConversation({ router: null,
    message: "What is your wallet balance?", intent, punkTokenId: "93", now: NOW,
    punkState: { wallet: PUNK_WALLET, nativeBalanceWei: "200000000000000", activated: true } });
  assert.match(balance.reply, /0\.0002 ETH/);
  assert.match(balance.reply, new RegExp(PUNK_WALLET));
  const scouting = await answerPunkConversation({ router: { run: async () => {
    throw new Error("mission state must not be guessed by a model");
  } }, message: "Are you out minting right now?", intent, punkTokenId: "93", now: NOW,
  review: { checkedCount: 0, eligibleCount: 0,
    leadingCollectionName: null, leadingMatchScore: null,
    missionStatus: "SCOUTING", missionTarget: 6, missionFound: 2,
    missionChecks: 3, missionCheckedOpportunities: 75 } });
  assert.equal(scouting.provider, "DETERMINISTIC_MISSION_STATE");
  assert.match(scouting.reply, /out scouting right now—not minting/);
  assert.match(scouting.reply, /2\/6 mission matches/);
  const discoveries = await answerPunkConversation({ router: null,
    message: "Did you find any matches?", intent, punkTokenId: "93", now: NOW,
    review: { checkedCount: 4, eligibleCount: 1,
      leadingCollectionName: "Neon Alley", leadingMatchScore: 94 } });
  assert.match(discoveries.reply, /4 shared opportunities/);
  assert.match(discoveries.reply, /Neon Alley at 94%/);
  const art = await answerPunkConversation({ router: null,
    message: "What do you think about pixel art?", intent, punkTokenId: "93", now: NOW });
  assert.match(art.reply, /clarity and character/);
  const weth = await answerPunkConversation({ router: null,
    message: "How does WETH work for bids?", intent, punkTokenId: "93", now: NOW });
  assert.match(weth.reply, /Keep native ETH.*gas/);
  const identity = await answerPunkConversation({ router: null,
    message: "Who are you?", intent, punkTokenId: "93", now: NOW });
  assert.match(identity.reply, /Gogh Punk #93/);
});

test("a conversation outage does not claim production is an unconfigured preview", async () => {
  const intent = defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
    punkWallet: PUNK_WALLET }, NOW);
  const response = await answerPunkConversation({ router: { run: async () => {
    throw new Error("provider timeout");
  } }, message: "Tell me something unexpected", intent, punkTokenId: "93", now: NOW });
  assert.equal(response.providerAvailable, false);
  assert.match(response.reply, /couldn’t reach the conversation service/);
  assert.match(response.reply, /quick calls/);
  assert.doesNotMatch(response.reply, /preview|not configured|provider timeout|paused/i);
});
