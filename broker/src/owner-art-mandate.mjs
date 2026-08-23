import { createHash } from "node:crypto";
import { ROBINHOOD } from "./config.mjs";
import { canonicalJson } from "./scout/canonical-json.mjs";

export const OWNER_MANDATE_TOKEN_ID = "1797";
export const OWNER_MANDATE_DIMENSIONS = Object.freeze([
  "pixelArt",
  "generativeArt",
  "oneOfOne",
  "emergingArtists",
  "onChainArt",
  "experimentalNFTs",
]);

const MODES = new Set(["DISABLED", "SCOUT", "APPROVAL_REQUIRED", "AUTONOMOUS"]);
const UNKNOWN_MODES = new Set(["IGNORE", "SCOUT_ONLY", "OWNER_APPROVAL"]);
const MAX_OWNER_MINTS_PER_DAY = 10;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")
    || actual.length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} has an invalid field set`);
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label}.${String(key)} must be an own data field`);
    }
  }
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function normalizeOwnerMandateTokenId(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) {
    throw new TypeError("Art Mandate token must be a canonical Punk ID");
  }
  const tokenId = Number(value);
  if (!Number.isSafeInteger(tokenId) || tokenId < 0 || tokenId > 9_999) {
    throw new TypeError("Art Mandate token is outside the supported Punk range");
  }
  return String(tokenId);
}

export function normalizeOwnerArtMandate(value) {
  exactKeys(value, [
    "chainId", "collection", "tokenId", "mode", "economicSettings",
    "riskSettings", "artisticPreferences",
  ], "Art Mandate");
  if (value.chainId !== ROBINHOOD.chainId) throw new TypeError("Art Mandate chain is invalid");
  if (String(value.collection).toLowerCase() !== ROBINHOOD.canonicalCollection) {
    throw new TypeError("Art Mandate collection is invalid");
  }
  const tokenId = normalizeOwnerMandateTokenId(value.tokenId);
  if (!MODES.has(value.mode)) throw new TypeError("Art Mandate mode is invalid");

  exactKeys(value.economicSettings,
    ["inspectMints", "allowFreeMints", "maxMintsPerDay"], "economicSettings");
  if (typeof value.economicSettings.inspectMints !== "boolean"
    || typeof value.economicSettings.allowFreeMints !== "boolean") {
    throw new TypeError("Art Mandate mint controls must be booleans");
  }
  const maxMintsPerDay = integer(
    value.economicSettings.maxMintsPerDay,
    "maxMintsPerDay",
    0,
    MAX_OWNER_MINTS_PER_DAY,
  );
  if (
    value.mode === "AUTONOMOUS"
    && (
      value.economicSettings.inspectMints !== true
      || value.economicSettings.allowFreeMints !== true
      || maxMintsPerDay < 1
    )
  ) {
    throw new TypeError(
      `Autonomous preference requires mint inspection, free mints, and a daily cap between one and ${MAX_OWNER_MINTS_PER_DAY}`,
    );
  }

  exactKeys(value.riskSettings,
    ["unknownMintMode", "maxContractRiskScore"], "riskSettings");
  if (!UNKNOWN_MODES.has(value.riskSettings.unknownMintMode)) {
    throw new TypeError("unknownMintMode is invalid");
  }
  const maxContractRiskScore = integer(
    value.riskSettings.maxContractRiskScore,
    "maxContractRiskScore",
    0,
    100,
  );

  exactKeys(value.artisticPreferences,
    ["minimumTasteMatch", "dimensions"], "artisticPreferences");
  const minimumTasteMatch = integer(
    value.artisticPreferences.minimumTasteMatch,
    "minimumTasteMatch",
    0,
    100,
  );
  exactKeys(value.artisticPreferences.dimensions,
    OWNER_MANDATE_DIMENSIONS, "artisticPreferences.dimensions");
  const dimensions = Object.fromEntries(OWNER_MANDATE_DIMENSIONS.map((dimension) => [
    dimension,
    integer(value.artisticPreferences.dimensions[dimension], dimension, 0, 100),
  ]));

  return Object.freeze({
    chainId: ROBINHOOD.chainId,
    collection: ROBINHOOD.canonicalCollection,
    tokenId,
    mode: value.mode,
    economicSettings: Object.freeze({
      inspectMints: value.economicSettings.inspectMints,
      allowFreeMints: value.economicSettings.allowFreeMints,
      maxMintsPerDay,
    }),
    riskSettings: Object.freeze({
      unknownMintMode: value.riskSettings.unknownMintMode,
      maxContractRiskScore,
    }),
    artisticPreferences: Object.freeze({
      minimumTasteMatch,
      dimensions: Object.freeze(dimensions),
    }),
  });
}

export function ownerArtMandateSha256(value) {
  const normalized = normalizeOwnerArtMandate(value);
  return `0x${createHash("sha256").update(canonicalJson(normalized)).digest("hex")}`;
}

export function storedOwnerArtMandate(normalized, configuredBy, version) {
  return Object.freeze({
    ...normalized,
    version,
    configuredBy,
    economicSettings: Object.freeze({
      ...normalized.economicSettings,
      allowPaidMints: false,
      maxMintPriceWei: "0",
      dailyBudgetWei: "0",
      weeklyBudgetWei: "0",
      minimumReserveWei: "0",
    }),
    mintPermissions: Object.freeze({
      approvedMintContracts: Object.freeze([]),
      approvedCollections: Object.freeze([]),
      blockedCollections: Object.freeze([]),
    }),
    onchainPolicyVersion: null,
    autonomyRequested: normalized.mode === "AUTONOMOUS",
    autonomyEnabled: false,
  });
}
