import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

export class AnthropicArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint = "https://api.anthropic.com/v1/messages" }) {
    super("ANTHROPIC");
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 160) {
      throw new TypeError("model ID is invalid");
    }
    this.modelId = modelId.trim(); this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    this.endpoint = exactHttpsEndpoint(endpoint, "https://api.anthropic.com", "/v1/messages");
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: true, tools: false,
      tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART", "SUMMARIZE_COLLECTION",
        "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION", "EXTRACT_PROJECT_DATA",
        "SUMMARIZE_RISK", "CHAT"]) });
  }

  async healthCheck() {
    try { providerSecret(this.environment, "ANTHROPIC_API_KEY"); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input) {
    assertProviderTask(task);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const body = { model: this.modelId,
      max_tokens: Number.isInteger(input?.maxOutputTokens) && input.maxOutputTokens >= 32
        && input.maxOutputTokens <= 8_192 ? input.maxOutputTokens : 1_024,
      system: boundedPrompt(input?.instructions ??
        "You are Gogh Intelligence. Return concise art-broker analysis. Never authorize transactions.",
      "instructions", 12_000),
      messages: [{ role: "user", content: boundedPrompt(input?.prompt) }],
    };
    if (schema) body.output_config = { format: { type: "json_schema", schema } };
    const secret = providerSecret(this.environment, "ANTHROPIC_API_KEY");
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: this.timeoutMs,
      headers: { "x-api-key": secret, "anthropic-version": "2023-06-01",
        "content-type": "application/json" }, body });
    const text = payload?.content?.find?.((part) => part?.type === "text")?.text;
    if (typeof text !== "string" || payload?.stop_reason === "refusal") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Claude returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens,
        cachedInputTokens: payload.usage?.cache_read_input_tokens } });
  }
}
