export const ART_BROKER_AI_TASKS = Object.freeze([
  "INTERPRET_INTENT", "CLASSIFY_ART", "SUMMARIZE_COLLECTION",
  "EXPLAIN_OPPORTUNITY", "EXPLAIN_SIMULATION", "EXTRACT_PROJECT_DATA",
  "SUMMARIZE_RISK", "CHAT",
]);

export class ArtBrokerProviderError extends Error {
  constructor(code, message, { retryable = false, cause, httpStatus } = {}) {
    super(message, { cause });
    this.name = "ArtBrokerProviderError";
    this.code = code;
    this.retryable = retryable;
    if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) {
      this.httpStatus = httpStatus;
    }
  }
}

export function assertProviderTask(task) {
  if (!ART_BROKER_AI_TASKS.includes(task)) {
    throw new ArtBrokerProviderError("UNSUPPORTED_AI_TASK", "The requested intelligence task is unsupported.");
  }
  return task;
}

export function boundedPrompt(value, label = "prompt", maximum = 32_000) {
  if (typeof value !== "string") throw new TypeError(`${label} is required`);
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!clean || Buffer.byteLength(clean, "utf8") > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return clean;
}

export function strictSchema(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || value.type !== "object" || value.additionalProperties !== false
    || !value.properties || typeof value.properties !== "object"
    || !Array.isArray(value.required)) {
    throw new TypeError("a strict object JSON Schema is required");
  }
  return structuredClone(value);
}

export function providerSecret(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || value.trim().length < 8 || value.length > 512) {
    throw new ArtBrokerProviderError("PROVIDER_NOT_CONFIGURED", `${name} is not configured.`);
  }
  return value.trim();
}

export function exactHttpsEndpoint(value, expectedOrigin, expectedPath) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("provider endpoint is invalid"); }
  if (url.origin !== expectedOrigin || url.pathname !== expectedPath || url.search || url.hash
    || url.username || url.password) throw new TypeError("provider endpoint is invalid");
  return url.href;
}

export async function providerJsonRequest({ fetchImpl, url, headers, body, timeoutMs = 20_000 }) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("provider timeout is invalid");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
      redirect: "error",
    });
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 2_000_000) {
      throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE", "The intelligence response was too large.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 2_000_000) {
      throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE", "The intelligence response was too large.");
    }
    let payload;
    try { payload = JSON.parse(text); } catch {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "The intelligence provider returned invalid JSON.");
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ArtBrokerProviderError("PROVIDER_REQUEST_FAILED",
        "The intelligence provider could not complete the request.", { retryable, httpStatus: response.status });
    }
    return { payload, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    if (error instanceof ArtBrokerProviderError) throw error;
    const timedOut = error?.name === "AbortError";
    throw new ArtBrokerProviderError(timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
      timedOut ? "The intelligence provider timed out." : "The intelligence provider is unavailable.",
      { retryable: true, cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function resultText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000_000) {
    throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE",
      "The intelligence provider did not return usable text.");
  }
  return value;
}

export function parseStructuredText(value) {
  const text = resultText(value);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed;
  } catch (error) {
    throw new ArtBrokerProviderError("INVALID_STRUCTURED_OUTPUT",
      "The intelligence provider returned an invalid structured result.", { cause: error });
  }
}

export function providerResult({ provider, modelId, task, text, structured, usage = {},
  requestId = null, latencyMs }) {
  const output = resultText(text);
  const uint = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return Object.freeze({
    provider, modelId, task, text: output,
    value: structured ? Object.freeze(parseStructuredText(output)) : null,
    requestId: typeof requestId === "string" && requestId.length <= 160 ? requestId : null,
    usage: Object.freeze({ inputTokens: uint(usage.inputTokens), outputTokens: uint(usage.outputTokens),
      cachedInputTokens: uint(usage.cachedInputTokens) }),
    latencyMs,
  });
}

export class ArtBrokerAIProvider {
  constructor(provider) {
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(provider)) throw new TypeError("provider identity is invalid");
    this.provider = provider;
  }

  getCapabilities() { throw new Error("getCapabilities() must be implemented"); }
  healthCheck() { throw new Error("healthCheck() must be implemented"); }
  invoke() { throw new Error("invoke() must be implemented"); }
  interpretIntent(input) { return this.invoke("INTERPRET_INTENT", input); }
  classifyArt(input) { return this.invoke("CLASSIFY_ART", input); }
  summarizeCollection(input) { return this.invoke("SUMMARIZE_COLLECTION", input); }
  explainOpportunity(input) { return this.invoke("EXPLAIN_OPPORTUNITY", input); }
  explainSimulation(input) { return this.invoke("EXPLAIN_SIMULATION", input); }
  extractProjectData(input) { return this.invoke("EXTRACT_PROJECT_DATA", input); }
  summarizeRisk(input) { return this.invoke("SUMMARIZE_RISK", input); }
  chat(input) { return this.invoke("CHAT", input); }
}
