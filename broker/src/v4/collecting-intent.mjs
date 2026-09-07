import { createHash } from "node:crypto";

export const PUNK_COLLECTING_INTENT_SCHEMA = "PUNK_COLLECTING_INTENT_V1";
export const PUNK_COLLECTING_INTENT_VERSION = 1;
export const V2_OPERATING_MODES = Object.freeze(["ASK", "ASSIST", "AUTONOMOUS"]);
export const V2_MINT_MODES = Object.freeze(["FREE_ONLY", "PAID_UP_TO_LIMIT"]);
export const V2_ART_STYLES = Object.freeze([
  "ABSTRACT", "AI", "ANIME", "CUTE", "CYBERPUNK", "DARK", "EXPERIMENTAL",
  "GENERATIVE", "HAND_DRAWN", "MINIMAL", "PFP", "PHOTOGRAPHY", "PIXEL_ART",
  "RETRO", "SURREAL", "THREE_D", "VAN_GOGH_INSPIRED", "WEIRD",
]);
export const PUNK_COLLECTING_INTENT_JSON_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    schema: { type: "string", const: PUNK_COLLECTING_INTENT_SCHEMA },
    version: { type: "integer", const: PUNK_COLLECTING_INTENT_VERSION },
    chainId: { type: "integer", const: 4663 },
    punkTokenId: { type: "string" }, expectedOwner: { type: "string" },
    punkWallet: { type: "string" }, operatingMode: { type: "string", enum: V2_OPERATING_MODES },
    mintMode: { type: "string", enum: V2_MINT_MODES }, maxMintPriceWei: { type: "string" },
    maxGasPerMintWei: { type: "string" }, dailyMintLimit: { type: "integer" },
    totalMintLimit: { type: "integer" }, minimumReserveWei: { type: "string" },
    maximumCollectionSupply: { type: ["integer", "null"] },
    preferences: { type: "object", properties: {
      prefer: { type: "array", items: { type: "string", enum: V2_ART_STYLES } },
      avoid: { type: "array", items: { type: "string", enum: V2_ART_STYLES } },
    }, required: ["prefer", "avoid"], additionalProperties: false },
    requiresWebsite: { type: "boolean" }, requiresSocial: { type: "boolean" },
    onlinePresenceRequirement: { type: "string", enum: ["WEBSITE_OR_SOCIAL"] },
    preferredSocialPlatforms: { type: "array", items: { type: "string", enum: ["X", "DISCORD", "FARCASTER"] } },
    blockedContracts: { type: "array", items: { type: "string" } },
    allowedContracts: { type: "array", items: { type: "string" } },
    blockedCollections: { type: "array", items: { type: "string" } },
    allowedAdapters: { type: "array", items: { type: "string" } },
    riskThreshold: { type: "integer" }, requireSimulation: { type: "boolean" },
    expiration: { type: "string", format: "date-time" },
    userSubmittedLinksAllowed: { type: "boolean" }, discoveryEnabled: { type: "boolean" },
  }),
  required: Object.freeze([
    "schema", "version", "chainId", "punkTokenId", "expectedOwner", "punkWallet",
    "operatingMode", "mintMode", "maxMintPriceWei", "maxGasPerMintWei", "dailyMintLimit",
    "totalMintLimit", "minimumReserveWei", "maximumCollectionSupply", "preferences",
    "requiresWebsite", "requiresSocial", "preferredSocialPlatforms", "blockedContracts",
    "allowedContracts", "blockedCollections", "allowedAdapters", "riskThreshold",
    "requireSimulation", "expiration", "userSubmittedLinksAllowed", "discoveryEnabled",
  ]),
  additionalProperties: false,
});

const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  "schema", "version", "chainId", "punkTokenId", "expectedOwner", "punkWallet",
  "operatingMode", "mintMode", "maxMintPriceWei", "maxGasPerMintWei", "dailyMintLimit",
  "totalMintLimit", "minimumReserveWei", "maximumCollectionSupply", "preferences",
  "requiresWebsite", "requiresSocial", "onlinePresenceRequirement",
  "preferredSocialPlatforms", "blockedContracts",
  "allowedContracts", "blockedCollections", "allowedAdapters", "riskThreshold",
  "requireSimulation", "expiration", "userSubmittedLinksAllowed", "discoveryEnabled",
]);
const PREFERENCE_FIELDS = Object.freeze(["prefer", "avoid"]);

function plainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} contains an invalid field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new TypeError(`${label} contains an accessor`);
    }
  }
  return value;
}

function exactFields(value, fields, label) {
  const allowed = new Set(fields);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) throw new TypeError(`${label} has unknown fields`);
}

function address(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function uint(value, label, { maximum = null } = {}) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text)) throw new TypeError(`${label} is invalid`);
  const parsed = BigInt(text);
  if (maximum !== null && parsed > BigInt(maximum)) throw new TypeError(`${label} is too large`);
  return parsed;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

function enumValue(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function strings(values, label, { allowed = null, maximum = 64 } = {}) {
  if (!Array.isArray(values) || values.length > maximum || values.some((item) => (
    typeof item !== "string" || item.length === 0 || item.length > 80
      || (allowed !== null && !allowed.includes(item))
  ))) throw new TypeError(`${label} is invalid`);
  return Object.freeze([...new Set(values)].sort());
}

function addresses(values, label) {
  if (!Array.isArray(values) || values.length > 128) throw new TypeError(`${label} is invalid`);
  return Object.freeze([...new Set(values.map((item) => address(item, label)))].sort());
}

function expiration(value, now, mode) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    throw new TypeError("expiration is invalid");
  }
  const maximum = mode === "AUTONOMOUS" ? 30 : 365;
  if (parsed.getTime() > now.getTime() + maximum * 86_400_000) {
    throw new TypeError("expiration exceeds the operating-mode limit");
  }
  return parsed.toISOString();
}

export function normalizePunkCollectingIntent(value, now = new Date()) {
  const source = plainRecord(value, "collecting intent");
  exactFields(source, TOP_LEVEL_FIELDS, "collecting intent");
  if (!Number.isFinite(new Date(now).getTime())) throw new TypeError("clock is invalid");
  if (source.schema !== PUNK_COLLECTING_INTENT_SCHEMA
    || source.version !== PUNK_COLLECTING_INTENT_VERSION || source.chainId !== 4663) {
    throw new TypeError("collecting intent identity is invalid");
  }
  const operatingMode = enumValue(source.operatingMode, V2_OPERATING_MODES, "operating mode");
  const mintMode = enumValue(source.mintMode, V2_MINT_MODES, "mint mode");
  const maximumPrice = uint(source.maxMintPriceWei, "maximum mint price");
  if (mintMode === "FREE_ONLY" && maximumPrice !== 0n) {
    throw new TypeError("free-only intent cannot authorize a mint price");
  }
  const preferences = plainRecord(source.preferences, "preferences");
  exactFields(preferences, PREFERENCE_FIELDS, "preferences");
  const normalizedPreferences = Object.freeze({
    prefer: strings(preferences.prefer, "preferred styles", { allowed: V2_ART_STYLES }),
    avoid: strings(preferences.avoid, "avoided styles", { allowed: V2_ART_STYLES }),
  });
  if (normalizedPreferences.prefer.some((style) => normalizedPreferences.avoid.includes(style))) {
    throw new TypeError("a style cannot be both preferred and avoided");
  }
  const allowedContracts = addresses(source.allowedContracts, "allowed contract");
  const blockedContracts = addresses(source.blockedContracts, "blocked contract");
  if (allowedContracts.some((item) => blockedContracts.includes(item))) {
    throw new TypeError("a contract cannot be both allowed and blocked");
  }
  const requireSimulation = boolean(source.requireSimulation, "simulation requirement");
  if (operatingMode === "AUTONOMOUS" && !requireSimulation) {
    throw new TypeError("autonomous intent requires simulation");
  }
  const maximumCollectionSupply = source.maximumCollectionSupply === null
    ? null : integer(source.maximumCollectionSupply, "maximum collection supply", 1, 1_000_000_000);
  return Object.freeze({
    schema: PUNK_COLLECTING_INTENT_SCHEMA,
    version: PUNK_COLLECTING_INTENT_VERSION,
    chainId: 4663,
    punkTokenId: uint(source.punkTokenId, "Punk token ID", { maximum: 9_999 }).toString(),
    expectedOwner: address(source.expectedOwner, "expected owner"),
    punkWallet: address(source.punkWallet, "Punk Wallet"),
    operatingMode,
    mintMode,
    maxMintPriceWei: maximumPrice.toString(),
    maxGasPerMintWei: uint(source.maxGasPerMintWei, "maximum gas per mint").toString(),
    dailyMintLimit: integer(source.dailyMintLimit, "daily mint limit", 1, 100),
    totalMintLimit: integer(source.totalMintLimit, "total mint limit", 0, 10_000),
    minimumReserveWei: uint(source.minimumReserveWei, "minimum reserve").toString(),
    maximumCollectionSupply,
    preferences: normalizedPreferences,
    requiresWebsite: boolean(source.requiresWebsite, "website requirement"),
    requiresSocial: boolean(source.requiresSocial, "social requirement"),
    ...(source.onlinePresenceRequirement === undefined ? {} : {
      onlinePresenceRequirement: enumValue(source.onlinePresenceRequirement,
        ["WEBSITE_OR_SOCIAL"], "online presence requirement"),
    }),
    preferredSocialPlatforms: strings(source.preferredSocialPlatforms, "social platforms", {
      allowed: ["X", "DISCORD", "FARCASTER"], maximum: 8,
    }),
    blockedContracts,
    allowedContracts,
    blockedCollections: strings(source.blockedCollections, "blocked collection", { maximum: 128 }),
    allowedAdapters: addresses(source.allowedAdapters, "allowed adapter"),
    riskThreshold: integer(source.riskThreshold, "risk threshold", 0, 100),
    requireSimulation,
    expiration: expiration(source.expiration, new Date(now), operatingMode),
    userSubmittedLinksAllowed: boolean(source.userSubmittedLinksAllowed, "link permission"),
    discoveryEnabled: boolean(source.discoveryEnabled, "discovery setting"),
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function punkCollectingIntentHash(value, now = new Date()) {
  return `0x${createHash("sha256").update(canonical(normalizePunkCollectingIntent(value, now))).digest("hex")}`;
}

export function collectingIntentConfirmation(value, now = new Date()) {
  const intent = normalizePunkCollectingIntent(value, now);
  return Object.freeze({
    title: "YOUR PUNK UNDERSTANDS",
    network: "Robinhood Chain",
    mode: intent.operatingMode,
    mintPrice: intent.mintMode === "FREE_ONLY" ? "Free only" : `Up to ${intent.maxMintPriceWei} wei`,
    lookingFor: intent.preferences.prefer,
    avoids: intent.preferences.avoid,
    requirements: Object.freeze([
      ...(intent.onlinePresenceRequirement === "WEBSITE_OR_SOCIAL"
        ? ["Website or social profile"]
        : [...(intent.requiresWebsite ? ["Website"] : []),
          ...(intent.requiresSocial ? ["Social profile"] : [])]),
      ...(intent.requireSimulation ? ["Simulation"] : []),
      "Security screening",
    ]),
    dailyLimit: intent.dailyMintLimit,
    totalLimit: intent.totalMintLimit,
    maximumGasWei: intent.maxGasPerMintWei,
    minimumReserveWei: intent.minimumReserveWei,
    expiresAt: intent.expiration,
    activationRequired: true,
    intentHash: punkCollectingIntentHash(intent, now),
  });
}

export function defaultAskIntent({ punkTokenId, expectedOwner, punkWallet }, now = new Date()) {
  return normalizePunkCollectingIntent({
    schema: PUNK_COLLECTING_INTENT_SCHEMA,
    version: 1,
    chainId: 4663,
    punkTokenId,
    expectedOwner,
    punkWallet,
    operatingMode: "ASK",
    mintMode: "FREE_ONLY",
    maxMintPriceWei: "0",
    maxGasPerMintWei: "500000000000000",
    dailyMintLimit: 1,
    totalMintLimit: 1,
    minimumReserveWei: "0",
    maximumCollectionSupply: null,
    preferences: { prefer: [], avoid: [] },
    requiresWebsite: false,
    requiresSocial: false,
    preferredSocialPlatforms: [],
    blockedContracts: [],
    allowedContracts: [],
    blockedCollections: [],
    allowedAdapters: [],
    riskThreshold: 30,
    requireSimulation: true,
    expiration: new Date(new Date(now).getTime() + 30 * 86_400_000).toISOString(),
    userSubmittedLinksAllowed: true,
    discoveryEnabled: true,
  }, now);
}
