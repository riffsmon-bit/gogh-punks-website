import {
  ART_BROKER_AI_TASKS, ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

// This adapter is intentionally pinned to the reviewed free-tier text model.
// Adding another model requires checking its limits and strict-schema support.
export const GROQ_ART_BROKER_MODEL = "openai/gpt-oss-20b";

export class GroqArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint = "https://api.groq.com/openai/v1/chat/completions" }) {
    super("GROQ");
    if (modelId !== GROQ_ART_BROKER_MODEL) throw new TypeError("Groq model is not reviewed");
    this.modelId = modelId; this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    this.endpoint = exactHttpsEndpoint(endpoint, "https://api.groq.com", "/openai/v1/chat/completions");
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: false, tools: false,
      tasks: ART_BROKER_AI_TASKS });
  }

  async healthCheck() {
    try { providerSecret(this.environment, "GROQ_API_KEY"); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input, { signal, timeoutMs } = {}) {
    assertProviderTask(task);
    const schema = input?.schema ? strictSchema(input.schema) : null;
    const body = { model: this.modelId,
      max_completion_tokens: Number.isInteger(input?.maxOutputTokens)
        && input.maxOutputTokens >= 32 && input.maxOutputTokens <= 8_192 ? input.maxOutputTokens : 1_024,
      reasoning_effort: "low", include_reasoning: false, stream: false,
      messages: [
        { role: "system", content: boundedPrompt(input?.instructions ??
          "You are Gogh Intelligence. Return concise art-broker analysis. Never authorize transactions.",
        "instructions", 12_000) },
        { role: "user", content: boundedPrompt(input?.prompt) },
      ] };
    if (schema) body.response_format = { type: "json_schema", json_schema: {
      name: "gogh_art_broker_result", strict: true, schema } };
    const secret = providerSecret(this.environment, "GROQ_API_KEY");
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: Math.min(this.timeoutMs, timeoutMs ?? this.timeoutMs), signal,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body })
      .catch(error => {
        if (!(error instanceof ArtBrokerProviderError)) throw error;
        const failures = {
          400: ["PROVIDER_INPUT_REJECTED", "Groq could not accept this request."],
          401: ["PROVIDER_AUTHENTICATION_FAILED", "Groq could not verify the configured key."],
          402: ["PROVIDER_CREDIT_LIMIT", "Groq's account limit has been reached."],
          403: ["PROVIDER_ACCESS_DENIED", "The configured key does not have access to this Groq model."],
          422: ["PROVIDER_INPUT_REJECTED", "Groq could not accept this request."],
          429: ["PROVIDER_RATE_LIMIT", "Groq's free request limit has been reached. Try again later."],
        };
        const failure = failures[error.httpStatus];
        if (failure) throw new ArtBrokerProviderError(failure[0], failure[1], { httpStatus: error.httpStatus });
        throw error;
      });
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new ArtBrokerProviderError("PROVIDER_OUTPUT_INCOMPLETE", "Groq could not finish the reply.");
    }
    if (payload?.model !== this.modelId || payload?.choices?.length !== 1
      || choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string"
      || choice?.message?.refusal || choice?.message?.function_call || choice?.message?.tool_calls?.length) {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Groq returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task,
      text: choice.message.content, structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens } });
  }
}
