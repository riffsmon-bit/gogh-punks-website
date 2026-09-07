import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

export class BankrArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint = "https://llm.bankr.bot/v1/chat/completions" }) {
    super("BANKR");
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 160) {
      throw new TypeError("model ID is invalid");
    }
    this.modelId = modelId.trim(); this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    this.endpoint = exactHttpsEndpoint(endpoint, "https://llm.bankr.bot", "/v1/chat/completions");
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: true, tools: false,
      routed: true, tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART",
        "SUMMARIZE_COLLECTION", "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION",
        "EXTRACT_PROJECT_DATA", "SUMMARIZE_RISK", "CHAT"]) });
  }

  async healthCheck() {
    try { providerSecret(this.environment, "BANKR_API_KEY"); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input) {
    assertProviderTask(task);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const body = { model: this.modelId, max_tokens: Number.isInteger(input?.maxOutputTokens)
      && input.maxOutputTokens >= 32 && input.maxOutputTokens <= 8_192
      ? input.maxOutputTokens : 1_024,
    messages: [
      { role: "system", content: boundedPrompt(input?.instructions ??
        "You are Gogh Intelligence. Return concise art-broker analysis. Never authorize transactions.",
      "instructions", 12_000) },
      { role: "user", content: boundedPrompt(input?.prompt) },
    ] };
    if (schema) body.response_format = { type: "json_schema", json_schema: {
      name: "gogh_art_broker_result", strict: true, schema } };
    const secret = providerSecret(this.environment, "BANKR_API_KEY");
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: this.timeoutMs,
      headers: { "x-api-key": secret, "content-type": "application/json" }, body });
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens } });
  }
}
