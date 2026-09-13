import { AnthropicArtBrokerProvider } from "./anthropic.mjs";
import { BankrArtBrokerProvider } from "./bankr.mjs";
import { GeminiArtBrokerProvider } from "./gemini.mjs";
import { OpenAIArtBrokerProvider } from "./openai.mjs";
import { modelRegistryFromEnvironment } from "./registry.mjs";
import { GoghIntelligenceRouter } from "./router.mjs";
import { XAIArtBrokerProvider } from "./xai.mjs";

import { NetlifyGrokArtBrokerProvider } from "./xai-gateway.mjs";

export function createGoghIntelligenceRuntime({ environment = process.env, fetchImpl = fetch,
  quota, usage } = {}) {
  if (environment.GOGH_XAI_TRANSPORT !== undefined
    && !["DIRECT", "NETLIFY_GATEWAY"].includes(environment.GOGH_XAI_TRANSPORT)) {
    throw new TypeError("xAI transport is invalid");
  }
  const registry = modelRegistryFromEnvironment(environment);
  const providers = {};
  for (const entry of registry.enabled()) {
    const options = { modelId: entry.modelId, environment, fetchImpl };
    if (entry.provider === "GEMINI") providers[entry.registryKey] = new GeminiArtBrokerProvider(options);
    else if (entry.provider === "OPENAI") providers[entry.registryKey] = new OpenAIArtBrokerProvider(options);
    else if (entry.provider === "ANTHROPIC") providers[entry.registryKey] = new AnthropicArtBrokerProvider(options);
    else if (entry.provider === "XAI") providers[entry.registryKey] = environment.GOGH_XAI_TRANSPORT === "NETLIFY_GATEWAY"
      ? new NetlifyGrokArtBrokerProvider(options) : new XAIArtBrokerProvider(options);
    else if (entry.provider === "BANKR") providers[entry.registryKey] = new BankrArtBrokerProvider(options);
  }
  return Object.freeze({ registry, providers,
    router: new GoghIntelligenceRouter({ registry, providers, quota, usage }) });
}
