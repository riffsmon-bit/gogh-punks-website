import {
  ArtBrokerAIProvider, ArtBrokerProviderError, assertProviderTask, boundedPrompt,
  exactHttpsEndpoint, providerJsonRequest, providerResult, providerSecret, strictSchema,
} from "./provider.mjs";

function generatedText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.filter((part) => typeof part?.text === "string")
    .map((part) => part.text).join("");
  return text || null;
}

function geminiBaseUrl(environment) {
  const direct = "https://generativelanguage.googleapis.com";
  const configured = environment.GOOGLE_GEMINI_BASE_URL;
  if (configured === undefined) return direct;
  const normalize = value => {
    if (typeof value !== "string" || !value || value !== value.trim()) {
      throw new TypeError("Gemini base URL is invalid");
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || url.search || url.hash || !["/", "/.netlify/ai", "/.netlify/ai/"].includes(url.pathname)
      || value !== url.href && `${value}/` !== url.href) {
      throw new TypeError("Gemini base URL is invalid");
    }
    return url.href.replace(/\/$/, "");
  };
  const base = normalize(configured);
  if (base === direct) return base;
  // Netlify injects both values into Functions. Bind the provider URL to that
  // platform gateway, rather than accepting an arbitrary credential destination.
  if (!base.endsWith("/.netlify/ai")
    || base !== normalize(environment.NETLIFY_AI_GATEWAY_URL)) {
    throw new TypeError("Gemini base URL does not match the Netlify AI Gateway");
  }
  return base;
}

export class GeminiArtBrokerProvider extends ArtBrokerAIProvider {
  constructor({ modelId, fetchImpl = fetch, environment = process.env, timeoutMs = 20_000,
    endpoint }) {
    super("GEMINI");
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 160) {
      throw new TypeError("model ID is invalid");
    }
    this.modelId = modelId.trim(); this.fetchImpl = fetchImpl;
    this.environment = environment; this.timeoutMs = timeoutMs;
    const base = geminiBaseUrl(environment);
    const { origin, pathname } = new URL(base);
    const prefix = pathname === "/" ? "" : pathname;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(this.modelId)) {
      throw new TypeError("model ID is invalid");
    }
    this.endpoint = exactHttpsEndpoint(
      endpoint ?? `${base}/v1beta/models/${this.modelId}:generateContent`, origin,
      `${prefix}/v1beta/models/${this.modelId}:generateContent`);
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
    const body = {
      system_instruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens, thinkingConfig: { thinkingLevel: "low" },
        ...(schema ? { responseFormat: { text: { mimeType: "application/json", schema } } } : {}) },
    };
    const { payload, latencyMs } = await providerJsonRequest({ fetchImpl: this.fetchImpl,
      url: this.endpoint, timeoutMs: this.timeoutMs,
      headers: { "x-goog-api-key": secret, "content-type": "application/json" }, body });
    const text = generatedText(payload);
    if (typeof text !== "string") {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "Gemini returned no usable output.");
    }
    return providerResult({ provider: this.provider, modelId: this.modelId, task, text,
      structured: Boolean(schema), requestId: payload.responseId, latencyMs,
      usage: { inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
        cachedInputTokens: payload.usageMetadata?.cachedContentTokenCount } });
  }
}
