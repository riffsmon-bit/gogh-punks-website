import { AnthropicArtBrokerProvider } from "./anthropic.mjs";
import { BankrArtBrokerProvider } from "./bankr.mjs";
import { OpenAIArtBrokerProvider } from "./openai.mjs";
import { modelRegistryFromEnvironment } from "./registry.mjs";
import { GoghIntelligenceRouter } from "./router.mjs";
import { XAIArtBrokerProvider } from "./xai.mjs";

export function createGoghIntelligenceRuntime({ environment = process.env, fetchImpl = fetch,
  quota, usage } = {}) {
  const registry = modelRegistryFromEnvironment(environment);
  const providers = {};
  for (const entry of registry.enabled()) {
    const options = { modelId: entry.modelId, environment, fetchImpl };
    if (entry.provider === "OPENAI") providers[entry.registryKey] = new OpenAIArtBrokerProvider(options);
    else if (entry.provider === "ANTHROPIC") providers[entry.registryKey] = new AnthropicArtBrokerProvider(options);
    else if (entry.provider === "XAI") providers[entry.registryKey] = new XAIArtBrokerProvider(options);
    else if (entry.provider === "BANKR") providers[entry.registryKey] = new BankrArtBrokerProvider(options);
  }
  return Object.freeze({ registry, providers,
    router: new GoghIntelligenceRouter({ registry, providers, quota, usage }) });
}
