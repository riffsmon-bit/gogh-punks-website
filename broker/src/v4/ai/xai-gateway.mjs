import { ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  providerJsonRequest, providerResult, providerSecret, strictSchema } from "./provider.mjs";
import { netlifyGatewayEndpoint } from "./gateway.mjs";

// Explicit Netlify/OpenRouter transport for Grok; it is never selected merely
// because a direct xAI credential is absent. No provider tools or wallet inputs.
export class NetlifyGrokArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, environment = process.env, fetchImpl = fetch, timeoutMs = 20_000 }) {
    super("XAI");
    if (typeof modelId !== "string" || !/^x-ai\/grok-[a-z0-9._:-]{1,100}$/.test(modelId)) {
      throw new TypeError("Netlify Grok model identity is invalid");
    }
    this.modelId = modelId; this.environment = environment; this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.endpoint = netlifyGatewayEndpoint(environment, "/v1/chat/completions");
  }
  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: false, tools: false,
      tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART", "SUMMARIZE_COLLECTION",
        "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION", "EXTRACT_PROJECT_DATA", "SUMMARIZE_RISK", "CHAT"]) });
  }
  async healthCheck() {
    try { providerSecret(this.environment, "NETLIFY_AI_GATEWAY_KEY");
      return { ok: true, code: "CONFIGURED", transport: "NETLIFY_OPENROUTER" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED", transport: "NETLIFY_OPENROUTER" }; }
  }
  async invoke(task, input, { signal, timeoutMs } = {}) {
    assertProviderTask(task);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const body = { model: this.modelId, stream: false, max_tokens: Number.isInteger(input?.maxOutputTokens)
      && input.maxOutputTokens >= 32 && input.maxOutputTokens <= 8_192 ? input.maxOutputTokens : 1_024,
      messages: [{ role: "system", content: boundedPrompt(input?.instructions
        ?? "You are Gogh Intelligence. Analyze art concisely. Never authorize transactions.", "instructions", 12_000) },
      { role: "user", content: boundedPrompt(input?.prompt) }] };
    if (schema) body.response_format = { type: "json_schema", json_schema: {
      name: "gogh_art_broker_result", strict: true, schema } };
    const secret = providerSecret(this.environment, "NETLIFY_AI_GATEWAY_KEY");
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, signal, timeoutMs: Math.min(this.timeoutMs, timeoutMs ?? this.timeoutMs),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body });
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === "length") throw new ArtBrokerProviderError("PROVIDER_OUTPUT_INCOMPLETE", "Grok could not finish the reply.");
    if (choice?.finish_reason !== "stop" || choice?.message?.refusal || choice?.message?.tool_calls
      || typeof choice?.message?.content !== "string") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Grok returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task,
      text: choice.message.content, structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens } });
  }
}
