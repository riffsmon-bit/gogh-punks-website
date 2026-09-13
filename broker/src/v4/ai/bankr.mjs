import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

// Prefer a gateway-only key. A configured but invalid dedicated key must never
// silently fall back to a broader legacy account credential.
export function bankrProviderSecret(environment) {
  const dedicated = environment?.BANKR_LLM_KEY;
  const name = dedicated !== undefined && dedicated !== null && dedicated !== ""
    ? "BANKR_LLM_KEY" : "BANKR_API_KEY";
  return providerSecret(environment, name);
}

export function bankrModelId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{1,127}(?::(?:zdr|private))?$/i.test(value.trim())
    || /^(?:bankr:)?auto$/i.test(value.trim())) throw new TypeError("Bankr model ID is invalid");
  return value.trim();
}

export function bankrRequestError(error) {
  if (!(error instanceof ArtBrokerProviderError)) return error;
  const status = error.httpStatus;
  const failures = {
    401: ["PROVIDER_AUTHENTICATION_FAILED", "Bankr could not verify the configured key."],
    402: ["PROVIDER_CREDIT_LIMIT", "Bankr's credit balance or daily spending limit has been reached."],
    403: ["PROVIDER_ACCESS_DENIED", "The configured key does not have access to Bankr's model gateway."],
  };
  const failure = failures[status];
  return failure ? new ArtBrokerProviderError(failure[0], failure[1], { httpStatus: status }) : error;
}

export class BankrArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint = "https://llm.bankr.bot/v1/chat/completions" }) {
    super("BANKR");
    this.modelId = bankrModelId(modelId); this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    this.endpoint = exactHttpsEndpoint(endpoint, "https://llm.bankr.bot", "/v1/chat/completions");
  }

  getCapabilities() {
    return Object.freeze({ structuredOutput: true, images: false, tools: false,
      routed: true, tasks: Object.freeze(["INTERPRET_INTENT", "CLASSIFY_ART",
        "SUMMARIZE_COLLECTION", "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION",
        "EXTRACT_PROJECT_DATA", "SUMMARIZE_RISK", "CHAT"]) });
  }

  async healthCheck() {
    try { bankrProviderSecret(this.environment); return { ok: true, code: "CONFIGURED" }; }
    catch { return { ok: false, code: "NOT_CONFIGURED" }; }
  }

  async invoke(task, input, { signal, timeoutMs } = {}) {
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
    const secret = bankrProviderSecret(this.environment);
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: Math.min(this.timeoutMs, timeoutMs ?? this.timeoutMs), signal,
      headers: { "x-api-key": secret, "content-type": "application/json" }, body })
      .catch(error => { throw bankrRequestError(error); });
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new ArtBrokerProviderError("PROVIDER_OUTPUT_INCOMPLETE", "Bankr could not finish the reply.");
    }
    const text = choice?.message?.content;
    if (typeof text !== "string" || choice?.message?.refusal
      || choice?.message?.function_call || choice?.message?.tool_calls?.length
      || choice?.finish_reason && choice.finish_reason !== "stop") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Bankr returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.id, latencyMs,
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens } });
  }
}
