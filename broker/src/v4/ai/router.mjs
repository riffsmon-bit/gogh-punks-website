import { ArtBrokerProviderError, assertProviderTask } from "./provider.mjs";

const HIGH_CAPABILITY_TASKS = new Set(["EXTRACT_PROJECT_DATA", "SUMMARIZE_RISK"]);

export class GoghIntelligenceRouter {
  constructor({ registry, providers, quota, usage }) {
    if (!registry || !providers || typeof providers !== "object") throw new TypeError("router input is invalid");
    this.registry = registry; this.providers = providers;
    this.quota = quota ?? { consume: async () => true };
    this.usage = usage ?? { record: async () => {} };
  }

  candidates(task, preference = "AUTO") {
    assertProviderTask(task);
    const preferred = preference === "AUTO" ? null : preference;
    return this.registry.enabled().filter((entry) => !preferred || entry.provider === preferred)
      .sort((left, right) => {
        const capabilityWeight = HIGH_CAPABILITY_TASKS.has(task) ? -1 : 1;
        return capabilityWeight * (left.costTier - right.costTier)
          || right.speedTier - left.speedTier || left.fallbackPriority - right.fallbackPriority;
      });
  }

  async run(task, input, context = {}) {
    const candidates = this.candidates(task, context.preference ?? "AUTO");
    if (!candidates.length) throw new ArtBrokerProviderError("GOGH_INTELLIGENCE_UNAVAILABLE",
      "Gogh Intelligence is temporarily unavailable.");
    if (!await this.quota.consume({ task, ownerFingerprint: context.ownerFingerprint,
      punkTokenId: context.punkTokenId })) {
      throw new ArtBrokerProviderError("AI_QUOTA_EXCEEDED", "The intelligence request limit was reached.");
    }
    const failures = [];
    for (const entry of candidates) {
      const provider = this.providers[entry.registryKey];
      if (!provider) continue;
      try {
        const result = await provider.invoke(task, input);
        await this.usage.record({ ...result, registryKey: entry.registryKey,
          ownerFingerprint: context.ownerFingerprint, punkTokenId: context.punkTokenId,
          resultCode: "OK" });
        return Object.freeze({ ...result, registryKey: entry.registryKey });
      } catch (error) {
        failures.push(error?.code ?? "PROVIDER_FAILED");
        await this.usage.record({ provider: entry.provider, modelId: entry.modelId,
          registryKey: entry.registryKey, task, ownerFingerprint: context.ownerFingerprint,
          punkTokenId: context.punkTokenId, resultCode: error?.code ?? "PROVIDER_FAILED" });
        if (!(error instanceof ArtBrokerProviderError) || !error.retryable) throw error;
      }
    }
    throw new ArtBrokerProviderError("GOGH_INTELLIGENCE_UNAVAILABLE",
      "Gogh Intelligence is temporarily unavailable.", { cause: failures });
  }
}
