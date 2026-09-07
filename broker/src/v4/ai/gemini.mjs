import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

function outputText(payload) {
  if (!Array.isArray(payload?.steps)) return null;
  const parts = [];
  for (const step of payload.steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const content of step.content) {
      if (content?.type === "text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.length ? parts.join("") : null;
}

function generatedText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.filter((part) => typeof part?.text === "string")
    .map((part) => part.text).join("");
  return text || null;
}

export class GeminiArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions" }) {
    super("GEMINI");
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 160) {
      throw new TypeError("model ID is invalid");
    }
    this.modelId = modelId.trim(); this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    this.endpoint = exactHttpsEndpoint(endpoint, "https://generativelanguage.googleapis.com",
      "/v1beta/interactions");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(this.modelId)) {
      throw new TypeError("model ID is invalid");
    }
    this.chatEndpoint = exactHttpsEndpoint(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`,
      "https://generativelanguage.googleapis.com",
      `/v1beta/models/${this.modelId}:generateContent`);
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: true, tools: false,
      tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART", "SUMMARIZE_COLLECTION",
        "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION", "EXTRACT_PROJECT_DATA",
        "SUMMARIZE_RISK", "CHAT"]) });
  }

  async healthCheck() {
    try { providerSecret(this.environment, "GEMINI_API_KEY"); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input) {
    assertProviderTask(task);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const maxOutputTokens = Number.isInteger(input?.maxOutputTokens)
      && input.maxOutputTokens >= 32 && input.maxOutputTokens <= 8_192
      ? input.maxOutputTokens : 1_024;
    const instructions = boundedPrompt(input?.instructions
        ?? "You are Gogh Intelligence. Return concise art-broker analysis. Never authorize transactions.",
      "instructions", 12_000);
    const prompt = boundedPrompt(input?.prompt);
    const secret = providerSecret(this.environment, "GEMINI_API_KEY");
    if (task === "CHAT") {
      const body = {
        system_instruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens,
          thinkingConfig: { thinkingLevel: "low" } },
      };
      const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
        url: this.chatEndpoint, timeoutMs: this.timeoutMs,
        headers: { "x-goog-api-key": secret, "content-type": "application/json" }, body });
      const text = generatedText(payload);
      if (typeof text !== "string") {
        throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE",
          "Gemini returned no usable output.");
      }
      return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
        structured: false, requestId: payload.responseId, latencyMs,
        usage: { inputTokens: payload.usageMetadata?.promptTokenCount,
          outputTokens: payload.usageMetadata?.candidatesTokenCount,
          cachedInputTokens: payload.usageMetadata?.cachedContentTokenCount } });
    }
    const body = { model: this.modelId, store: false,
      system_instruction: instructions,
      input: prompt,
      generation_config: { max_output_tokens: maxOutputTokens, thinking_level: "low" },
    };
    if (schema) body.response_format = { type: "text", mime_type: "application/json", schema };
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: this.timeoutMs,
      headers: { "x-goog-api-key": secret, "content-type": "application/json" }, body });
    const text = outputText(payload);
    if (typeof text !== "string" || !["completed", "incomplete"].includes(payload?.status)) {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE",
        "Gemini returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.total_input_tokens,
        outputTokens: payload.usage?.total_output_tokens,
        cachedInputTokens: payload.usage?.total_cached_tokens } });
  }
}
