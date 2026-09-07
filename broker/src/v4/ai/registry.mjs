const PROVIDERS = new Set(["GEMINI", "OPENAI", "ANTHROPIC", "XAI", "BANKR"]);
const CAPABILITIES = ["supportsImages", "supportsTools", "supportsStructuredOutput"];

function registryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("model entry is invalid");
  const provider = String(value.provider ?? "").toUpperCase();
  if (!PROVIDERS.has(provider)) throw new TypeError("model provider is invalid");
  const key = String(value.registryKey ?? "");
  const modelId = String(value.modelId ?? "");
  const displayName = String(value.displayName ?? "");
  if (!/^[a-z0-9:_-]{3,128}$/.test(key) || !modelId || modelId.length > 160
    || !displayName || displayName.length > 160) throw new TypeError("model identity is invalid");
  const capabilities = Object.fromEntries(CAPABILITIES.map((name) => {
    if (typeof value.capabilities?.[name] !== "boolean") throw new TypeError("model capabilities are invalid");
    return [name, value.capabilities[name]];
  }));
  const tier = (name) => Number.isInteger(value[name]) && value[name] >= 1 && value[name] <= 5
    ? value[name] : (() => { throw new TypeError(`${name} is invalid`); })();
  if (!Number.isInteger(value.fallbackPriority) || value.fallbackPriority < 1
    || value.fallbackPriority > 100 || typeof value.enabled !== "boolean") {
    throw new TypeError("model routing metadata is invalid");
  }
  const costRate = (name) => value[name] === null || value[name] === undefined ? null
    : Number.isSafeInteger(value[name]) && value[name] >= 0 ? value[name]
      : (() => { throw new TypeError(`${name} is invalid`); })();
  return Object.freeze({ registryKey: key, provider, modelId, displayName,
    capabilities: Object.freeze(capabilities), costTier: tier("costTier"), speedTier: tier("speedTier"),
    enabled: value.enabled, fallbackPriority: value.fallbackPriority,
    inputCostMicrousdPerMillionTokens: costRate("inputCostMicrousdPerMillionTokens"),
    outputCostMicrousdPerMillionTokens: costRate("outputCostMicrousdPerMillionTokens") });
}

function configuredCost(environment, provider, direction) {
  const name = `GOGH_${provider}_${direction}_COST_USD_PER_MILLION_TOKENS`;
  const raw = environment[name]?.trim();
  if (!raw) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) throw new TypeError(`${name} is invalid`);
  const [whole, fraction = ""] = raw.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt((fraction || "0").padEnd(6, "0"));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${name} is invalid`);
  return Number(value);
}

export class ArtBrokerModelRegistry {
  constructor(entries) {
    if (!Array.isArray(entries) || entries.length > 100) throw new TypeError("model registry is invalid");
    this.entries = Object.freeze(entries.map(registryEntry));
    if (new Set(this.entries.map(({ registryKey }) => registryKey)).size !== this.entries.length) {
      throw new TypeError("model registry keys must be unique");
    }
  }

  enabled() { return this.entries.filter((entry) => entry.enabled); }
  get(registryKey) { return this.entries.find((entry) => entry.registryKey === registryKey) ?? null; }
  publicView() {
    return this.entries.map(({ modelId: _modelId, ...entry }) => Object.freeze(entry));
  }
}

export function modelRegistryFromEnvironment(environment = process.env) {
  const definitions = [
    ["GEMINI", "GOGH_GEMINI_MODEL", "gemini:auto", "Gemini", 1, 5],
    ["OPENAI", "GOGH_OPENAI_MODEL", "openai:auto", "GPT", 2, 4],
    ["ANTHROPIC", "GOGH_ANTHROPIC_MODEL", "anthropic:auto", "Claude", 3, 3],
    ["XAI", "GOGH_XAI_MODEL", "xai:auto", "Grok", 3, 3],
    ["BANKR", "GOGH_BANKR_MODEL", "bankr:auto", "Bankr Routed", 2, 4],
  ];
  return new ArtBrokerModelRegistry(definitions.filter(([, variable]) => (
    typeof environment[variable] === "string" && environment[variable].trim()
  )).map(([provider, variable, registryKey, displayName, costTier, speedTier], index) => ({
    provider, registryKey, displayName, modelId: environment[variable].trim(), costTier, speedTier,
    capabilities: { supportsImages: true, supportsTools: false, supportsStructuredOutput: true },
    enabled: true, fallbackPriority: index + 1,
    inputCostMicrousdPerMillionTokens: configuredCost(environment, provider, "INPUT"),
    outputCostMicrousdPerMillionTokens: configuredCost(environment, provider, "OUTPUT"),
  })));
}
