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

test("Gemini adapter uses the stateless Interactions API and free-tier registry path", async () => {
  let request;
  const provider = new GeminiArtBrokerProvider({ modelId: "gemini-3.8-flash",
    environment: { GEMINI_API_KEY: "server-only-gemini-key" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ id: "int_1", status: "completed", steps: [{ type: "model_output",
        content: [{ type: "text", text: '{"answer":"PIXEL_ART"}' }] }],
      usage: { total_input_tokens: 9, total_output_tokens: 4, total_cached_tokens: 0 } });
    } });
  const result = await provider.classifyArt({ prompt: "classify it", schema: SCHEMA });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(request.options.headers["x-goog-api-key"], "server-only-gemini-key");
  assert.equal(body.store, false);
  assert.equal(body.generation_config.thinking_level, "low");
  assert.equal(body.response_format.mime_type, "application/json");
  assert.deepEqual(result.value, { answer: "PIXEL_ART" });
  assert.equal(JSON.stringify(result).includes("server-only-gemini-key"), false);
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
