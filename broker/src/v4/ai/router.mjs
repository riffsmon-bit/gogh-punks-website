import { ArtBrokerProviderError, assertProviderTask } from "./provider.mjs";

const HIGH_CAPABILITY_TASKS = new Set(["EXTRACT_PROJECT_DATA", "SUMMARIZE_RISK"]);
export const PROVIDER_PREFERENCES = Object.freeze(["AUTO", "GEMINI", "OPENAI", "ANTHROPIC", "XAI", "BANKR"]);
export function providerPreference(value = "AUTO") {
  if (!PROVIDER_PREFERENCES.includes(value)) throw new TypeError("provider preference is invalid");
  return value;
}
const timeoutError = () => new ArtBrokerProviderError("AI_REQUEST_TIMEOUT",
  "The intelligence request took too long. Try again shortly.");

export class GoghIntelligenceRouter {
  constructor({ registry, providers, quota, usage, deadlineMs = 20_000, attemptTimeoutMs = 10_000 }) {
    if (!registry || !providers || typeof providers !== "object") throw new TypeError("router input is invalid");
    if (![deadlineMs, attemptTimeoutMs].every(x => Number.isInteger(x) && x >= 1_000 && x <= 30_000)) {
      throw new TypeError("router deadline is invalid");
    }
    this.registry = registry; this.providers = providers;
    this.quota = quota ?? { consume: async () => true };
    this.usage = usage ?? { record: async () => {} };
    this.deadlineMs = deadlineMs; this.attemptTimeoutMs = attemptTimeoutMs;
  }

  candidates(task, preference = "AUTO") {
    assertProviderTask(task);
    const preferred = providerPreference(preference) === "AUTO" ? null : preference;
    return this.registry.enabled().filter((entry) => !preferred || entry.provider === preferred)
      .sort((left, right) => {
        const capabilityWeight = HIGH_CAPABILITY_TASKS.has(task) ? -1 : 1;
        return capabilityWeight * (left.costTier - right.costTier)
          || right.speedTier - left.speedTier || left.fallbackPriority - right.fallbackPriority;
      });
  }

  async run(task, input, context = {}) {
    const candidates = this.candidates(task, context.preference);
    if (!candidates.length) throw new ArtBrokerProviderError("GOGH_INTELLIGENCE_UNAVAILABLE",
      "Gogh Intelligence is temporarily unavailable.");
    const controller = new AbortController();
    const started = performance.now();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, this.deadlineMs);
    });
    const remaining = () => Math.floor(this.deadlineMs - (performance.now() - started));
    const checkDeadline = () => {
      if (controller.signal.aborted || remaining() < 1) throw timeoutError();
    };
    const run = async () => {
      const failures = [];
      for (const entry of candidates) {
        const provider = this.providers[entry.registryKey];
        if (!provider) continue;
        checkDeadline();
        // Every network attempt has its own committed reservation, including fallback.
        // A timeout/crash may already have incurred provider cost: never release it.
        const reservation = await this.quota.consume({ task, registryKey: entry.registryKey,
          provider: entry.provider, ownerFingerprint: context.ownerFingerprint, punkTokenId: context.punkTokenId });
        if (!reservation) throw new ArtBrokerProviderError("AI_QUOTA_EXCEEDED",
          "Your Punk's AI request limit was reached. Try again later.");
        checkDeadline();
        let result;
        let failure;
        try {
          result = await provider.invoke(task, input, { signal: controller.signal,
            timeoutMs: Math.min(this.attemptTimeoutMs, remaining()) });
        } catch (error) { failure = error; }
        // Usage failures are terminal. Do not reinterpret accounting failure as a
        // provider failure or generate a second paid answer after a successful one.
        await this.usage.record({ ...(result ?? { provider: entry.provider, modelId: entry.modelId, task }),
          registryKey: entry.registryKey, reservationId: typeof reservation === "string" ? reservation : null,
          ownerFingerprint: context.ownerFingerprint, punkTokenId: context.punkTokenId,
          resultCode: failure ? failure?.code ?? "PROVIDER_FAILED" : "OK" });
        checkDeadline();
        if (!failure) return Object.freeze({ ...result, registryKey: entry.registryKey });
        failures.push(failure?.code ?? "PROVIDER_FAILED");
        if (!(failure instanceof ArtBrokerProviderError) || !failure.retryable) throw failure;
      }
      throw new ArtBrokerProviderError("GOGH_INTELLIGENCE_UNAVAILABLE",
        "Gogh Intelligence is temporarily unavailable.", { cause: failures });
    };
    try { return await Promise.race([run(), deadline]); }
    finally { clearTimeout(timer); controller.abort(); }
  }
}
