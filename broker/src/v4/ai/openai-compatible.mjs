import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

function responseText(payload) {
  if (!Array.isArray(payload?.output)) return null;
  for (const item of payload.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    const part = item.content.find((value) => value?.type === "output_text");
    if (typeof part?.text === "string") return part.text;
  }
  return typeof payload.output_text === "string" ? payload.output_text : null;
}

export class ResponsesArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ provider, modelId, secretName, endpoint, expectedOrigin, fetchImpl = fetch,
    environment = process.env, timeoutMs = 20_000 }) {
    super(provider);
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 160) {
      throw new TypeError("model ID is invalid");
    }
    this.modelId = modelId.trim();
    this.secretName = secretName;
    this.environment = environment;
    this.endpoint = exactHttpsEndpoint(endpoint, expectedOrigin, "/v1/responses");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: true, tools: false,
      tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART", "SUMMARIZE_COLLECTION",
        "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION", "EXTRACT_PROJECT_DATA",
        "SUMMARIZE_RISK", "CHAT"]) });
  }

  async healthCheck() {
    try { providerSecret(this.environment, this.secretName); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input) {
    assertProviderTask(task);
    const prompt = boundedPrompt(input?.prompt);
    const instructions = boundedPrompt(input?.instructions ??
      "You are Gogh Intelligence. Return concise art-broker analysis. Never authorize transactions.",
    "instructions", 12_000);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const maxOutputTokens = Number.isInteger(input?.maxOutputTokens)
      && input.maxOutputTokens >= 32 && input.maxOutputTokens <= 8_192 ? input.maxOutputTokens : 1_024;
    const body = { model: this.modelId, instructions, input: prompt, max_output_tokens: maxOutputTokens,
      store: false };
    if (schema) body.text = { format: { type: "json_schema", name: "gogh_art_broker_result",
      strict: true, schema } };
    const secret = providerSecret(this.environment, this.secretName);
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: this.timeoutMs,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body });
    const text = responseText(payload);
    if (typeof text !== "string") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "The provider response had no output text.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens } });
  }
}
