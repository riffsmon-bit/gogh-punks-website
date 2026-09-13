/** @typedef {'INTERPRET_INTENT' | 'CLASSIFY_ART' | 'SUMMARIZE_COLLECTION' |
 * 'EXPLAIN_OPPORTUNITY' | 'EXPLAIN_SIMULATION' | 'EXTRACT_PROJECT_DATA' |
 * 'SUMMARIZE_RISK' | 'CHAT'} ArtBrokerAITask */
/** @typedef {{prompt: string, instructions?: string, schema?: Record<string, unknown>,
 * maxOutputTokens?: number}} ArtBrokerAIInput */
/** @type {ReadonlyArray<ArtBrokerAITask>} */
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
  const startedAt = performance.now();
  const maximumBytes = 2_000_000;
  let response;
  let reader;
  let complete = false;
  const cancelBody = () => {
    // Cancellation is best effort: a broken upstream must not delay the deadline.
    try { Promise.resolve(reader ? reader.cancel() : response?.body?.cancel?.()).catch(() => {}); }
    catch { /* A locked or already closed stream needs no further cleanup. */ }
  };
  const timeoutError = () => new ArtBrokerProviderError("PROVIDER_TIMEOUT",
    "The intelligence provider timed out.", { retryable: true });
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeoutMs);
  });
  const request = async () => {
    response = await fetchImpl(url, {
      method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
      redirect: "error",
    });
    if (controller.signal.aborted) { cancelBody(); throw timeoutError(); }
    // Error pages are frequently HTML or empty. Their status still determines
    // fallback, and their untrusted bodies are neither buffered nor reflected.
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ArtBrokerProviderError("PROVIDER_REQUEST_FAILED",
        "The intelligence provider could not complete the request.", { retryable, httpStatus: response.status });
    }
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > maximumBytes) {
      throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE", "The intelligence response was too large.");
    }
    let text = "";
    if (response.body) {
      if (typeof response.body.getReader !== "function") {
        throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE",
          "The intelligence provider returned an unreadable response.");
      }
      reader = response.body.getReader();
      // Fixed storage also bounds memory when the upstream sends tiny chunks.
      const bytes = Buffer.alloc(maximumBytes);
      let size = 0;
      try {
        for (;;) {
          if (controller.signal.aborted) throw timeoutError();
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw timeoutError();
          if (done) break;
          if (!(value instanceof Uint8Array)) {
            throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE",
              "The intelligence provider returned an unreadable response.");
          }
          if (value.byteLength > maximumBytes - size) {
            throw new ArtBrokerProviderError("PROVIDER_RESPONSE_TOO_LARGE",
              "The intelligence response was too large.");
          }
          bytes.set(value, size);
          size += value.byteLength;
        }
        text = bytes.subarray(0, size).toString("utf8");
      } finally {
        try { reader.releaseLock(); } catch { /* Cleanup must not replace the provider error. */ }
        reader = null;
      }
    }
    let payload;
    try { payload = JSON.parse(text); } catch {
      throw new ArtBrokerProviderError("INVALID_PROVIDER_RESPONSE", "The intelligence provider returned invalid JSON.");
    }
    return { payload, latencyMs: Math.round(performance.now() - startedAt) };
  };
  try {
    // Native fetch observes AbortSignal. Racing also bounds injected transports
    // whose fetch or stream reader fails to honor it.
    const result = await Promise.race([request(), deadline]);
    complete = true;
    return result;
  } catch (error) {
    if (error instanceof ArtBrokerProviderError) throw error;
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    throw new ArtBrokerProviderError(timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
      timedOut ? "The intelligence provider timed out." : "The intelligence provider is unavailable.",
      { retryable: true });
  } finally {
    clearTimeout(timeout);
    if (!complete) { controller.abort(); cancelBody(); }
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
  /**
   * @param {ArtBrokerAITask} _task
   * @param {ArtBrokerAIInput} _input
   * @returns {Promise<ReturnType<typeof providerResult>>}
   */
  invoke(_task, _input) { throw new Error("invoke() must be implemented"); }
  interpretIntent(input) { return this.invoke("INTERPRET_INTENT", input); }
  classifyArt(input) { return this.invoke("CLASSIFY_ART", input); }
  summarizeCollection(input) { return this.invoke("SUMMARIZE_COLLECTION", input); }
  explainOpportunity(input) { return this.invoke("EXPLAIN_OPPORTUNITY", input); }
  explainSimulation(input) { return this.invoke("EXPLAIN_SIMULATION", input); }
  extractProjectData(input) { return this.invoke("EXTRACT_PROJECT_DATA", input); }
  summarizeRisk(input) { return this.invoke("SUMMARIZE_RISK", input); }
  chat(input) { return this.invoke("CHAT", input); }
}
