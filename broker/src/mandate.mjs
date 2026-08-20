import {
  BROKER_MODES,
  ROBINHOOD,
  normalizeAddress,
} from "./config.mjs";

const MINT_TYPES = new Set([
  "MINT",
  "FREE_MINT",
  "EDITION",
  "ALLOWLIST_MINT",
  "COLLECTION_DROP",
]);

const UNKNOWN_MINT_MODES = new Set(["IGNORE", "SCOUT_ONLY", "OWNER_APPROVAL"]);

function boolean(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function amount(value, field, fallback = "0") {
  try {
    const parsed = BigInt(value ?? fallback);
    if (parsed < 0n) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError(`${field} must be a non-negative integer amount`);
  }
}

function integer(value, field, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function addressList(value, field) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an address array`);
  return Object.freeze([...new Set(value.map((entry) => normalizeAddress(entry, field)))]);
}

function settings(input, camel, snake) {
  return input?.[camel] ?? input?.[snake] ?? {};
}

function field(input, camel, snake, fallback) {
  return input?.[camel] ?? input?.[snake] ?? fallback;
}

/**
 * Fail-closed, per-Punk Art Mandate used by Scout. A missing owner mandate can
 * inspect mint signals, but it never expresses a desire to spend or execute.
 */
export function normalizeArtMandate(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Art Mandate must be an object");
  }
  const economic = settings(input, "economicSettings", "economic_settings");
  const risk = settings(input, "riskSettings", "risk_settings");
  const artistic = settings(input, "artisticPreferences", "artistic_preferences");
  const permissions = settings(input, "mintPermissions", "marketplace_permissions");
  const mode = String(field(input, "mode", "mode", "SCOUT"));
  if (!BROKER_MODES.includes(mode)) throw new TypeError("Art Mandate mode is invalid");
  const unknownMintMode = String(field(risk, "unknownMintMode", "unknown_mint_mode", "SCOUT_ONLY"));
  if (!UNKNOWN_MINT_MODES.has(unknownMintMode)) {
    throw new TypeError("unknownMintMode must be IGNORE, SCOUT_ONLY, or OWNER_APPROVAL");
  }

  const tokenId = amount(field(input, "tokenId", "token_id", "0"), "tokenId");
  const configuredByValue = field(input, "configuredBy", "configured_by", null);
  const chainId = Number(field(input, "chainId", "chain_id", ROBINHOOD.chainId));
  if (chainId !== ROBINHOOD.chainId) {
    throw new TypeError(`Art Mandate chainId must be ${ROBINHOOD.chainId}`);
  }
  const collection = normalizeAddress(
      field(input, "collection", "collection_address", ROBINHOOD.canonicalCollection),
      "mandate collection",
    );
  if (collection !== ROBINHOOD.canonicalCollection) {
    throw new TypeError("Art Mandate must belong to the canonical Gogh Punks collection");
  }
  return Object.freeze({
    chainId,
    collection,
    tokenId,
    version: integer(field(input, "version", "version", 0), "version", 0, 0, Number.MAX_SAFE_INTEGER),
    mode,
    configuredBy: configuredByValue
      ? normalizeAddress(configuredByValue, "configuredBy")
      : null,
    economicSettings: Object.freeze({
      inspectMints: boolean(field(economic, "inspectMints", "inspect_mints", true), "inspectMints", true),
      allowFreeMints: boolean(field(economic, "allowFreeMints", "allow_free_mints", false), "allowFreeMints"),
      allowPaidMints: boolean(field(economic, "allowPaidMints", "allow_paid_mints", false), "allowPaidMints"),
      maxMintPriceWei: amount(field(economic, "maxMintPriceWei", "max_mint_price_wei", "0"), "maxMintPriceWei"),
      dailyBudgetWei: amount(field(economic, "dailyBudgetWei", "daily_budget_wei", "0"), "dailyBudgetWei"),
      weeklyBudgetWei: amount(field(economic, "weeklyBudgetWei", "weekly_budget_wei", "0"), "weeklyBudgetWei"),
      minimumReserveWei: amount(field(economic, "minimumReserveWei", "minimum_reserve_wei", "0"), "minimumReserveWei"),
      maxMintsPerDay: integer(
        field(economic, "maxMintsPerDay", "max_mints_per_day", 0),
        "maxMintsPerDay",
        0,
        0,
        10_000,
      ),
    }),
    riskSettings: Object.freeze({
      unknownMintMode,
      maxContractRiskScore: integer(
        field(risk, "maxContractRiskScore", "max_contract_risk_score", 40),
        "maxContractRiskScore",
        40,
        0,
        100,
      ),
    }),
    artisticPreferences: Object.freeze({
      minimumTasteMatch: integer(
        field(artistic, "minimumTasteMatch", "minimum_taste_match", 60),
        "minimumTasteMatch",
        60,
        0,
        100,
      ),
      dimensions: Object.freeze({ ...(field(artistic, "dimensions", "dimensions", {})) }),
    }),
    mintPermissions: Object.freeze({
      approvedMintContracts: addressList(
        field(permissions, "approvedMintContracts", "approved_mint_contracts", []),
        "approvedMintContracts",
      ),
      approvedCollections: addressList(
        field(permissions, "approvedCollections", "approved_collections", []),
        "approvedCollections",
      ),
      blockedCollections: addressList(
        field(permissions, "blockedCollections", "blocked_collections", []),
        "blockedCollections",
      ),
    }),
  });
}

function opportunityField(opportunity, camel, snake, fallback = null) {
  return opportunity?.[camel] ?? opportunity?.[snake] ?? fallback;
}

/**
 * Evaluate whether a Punk is interested in a mint. This result is advisory.
 * `autonomousEligible` is true only when the caller supplies evidence that the
 * independently enforced on-chain controls are all active and validated.
 */
export function evaluateMintInterest({ mandate, opportunity, recommendation, controls = {} }) {
  const normalized = normalizeArtMandate(mandate);
  const opportunityType = String(opportunityField(opportunity, "opportunityType", "opportunity_type", ""));
  if (!MINT_TYPES.has(opportunityType)) {
    return Object.freeze({ applicable: false, decision: "NOT_APPLICABLE", wantsToJoin: false, autonomousEligible: false, reasons: Object.freeze([]) });
  }

  const collection = normalizeAddress(
    opportunityField(opportunity, "collection", "collection_address"),
    "mint collection",
  );
  const metadata = opportunity?.metadata ?? {};
  const scores = recommendation?.scores ?? opportunity?.scores ?? {};
  const riskLabel = opportunityField(opportunity, "riskLabel", "risk_label", "UNKNOWN");
  const riskScore = Number(scores.contractRiskScore ?? 100);
  const tasteMatch = Number(scores.tasteMatch ?? 0);
  const priceStatus = String(metadata.mintPriceStatus ?? "UNKNOWN");
  const price = amount(
    opportunityField(opportunity, "expectedPrice", "expected_price", opportunity?.mintPrice ?? "0"),
    "mint price",
  );
  const isFree = priceStatus === "KNOWN" && BigInt(price) === 0n;
  const approvedCollection = normalized.mintPermissions.approvedCollections.includes(collection);
  const mintContractValue = metadata.mintContract ?? opportunityField(opportunity, "venue", "marketplace_address", collection);
  const mintContract = normalizeAddress(mintContractValue, "mint contract");
  const approvedMintContract = normalized.mintPermissions.approvedMintContracts.includes(mintContract);
  const blocked = normalized.mintPermissions.blockedCollections.includes(collection);
  const reasons = [];

  if (!normalized.economicSettings.inspectMints) reasons.push("Mint scouting is disabled for this Punk");
  if (blocked) reasons.push("Collection is blocked by this Punk's owner");
  if (priceStatus !== "KNOWN") reasons.push("Mint price and callable phase are not verified");
  if (riskLabel === "UNKNOWN") reasons.push("Contract risk is unknown");
  if (Number.isFinite(riskScore) && riskScore > normalized.riskSettings.maxContractRiskScore) {
    reasons.push("Contract risk exceeds this Punk's mandate");
  }
  if (!Number.isFinite(tasteMatch) || tasteMatch < normalized.artisticPreferences.minimumTasteMatch) {
    reasons.push("Taste Match is below this Punk's threshold");
  }
  if (isFree && !normalized.economicSettings.allowFreeMints) reasons.push("Free mints are not enabled");
  if (!isFree && priceStatus === "KNOWN" && !normalized.economicSettings.allowPaidMints) {
    reasons.push("Paid mints are not enabled");
  }
  if (
    !isFree
    && priceStatus === "KNOWN"
    && BigInt(price) > BigInt(normalized.economicSettings.maxMintPriceWei)
  ) reasons.push("Mint price exceeds this Punk's ceiling");
  if (normalized.economicSettings.maxMintsPerDay === 0) {
    reasons.push("This Punk's daily mint count is zero");
  }
  if (
    !isFree
    && priceStatus === "KNOWN"
    && (
      BigInt(price) > BigInt(normalized.economicSettings.dailyBudgetWei)
      || BigInt(price) > BigInt(normalized.economicSettings.weeklyBudgetWei)
    )
  ) reasons.push("Mint price exceeds this Punk's configured budget");

  const evidenceKnown = priceStatus === "KNOWN" && riskLabel !== "UNKNOWN";
  const preferencePasses = normalized.economicSettings.inspectMints
    && !blocked
    && evidenceKnown
    && Number.isFinite(riskScore)
    && riskScore <= normalized.riskSettings.maxContractRiskScore
    && Number.isFinite(tasteMatch)
    && tasteMatch >= normalized.artisticPreferences.minimumTasteMatch
    && normalized.economicSettings.maxMintsPerDay > 0
    && (isFree
      ? normalized.economicSettings.allowFreeMints
      : normalized.economicSettings.allowPaidMints
        && BigInt(price) <= BigInt(normalized.economicSettings.maxMintPriceWei)
        && BigInt(price) <= BigInt(normalized.economicSettings.dailyBudgetWei)
        && BigInt(price) <= BigInt(normalized.economicSettings.weeklyBudgetWei));

  const onchainGuards = controls.autonomousMintFeatureEnabled === true
    && controls.agentAuthorized === true
    && controls.adapterApproved === true
    && controls.onchainPolicyValidated === true
    && controls.budgetAndReserveValidated === true;
  const autonomousEligible = preferencePasses
    && normalized.mode === "AUTONOMOUS"
    && approvedCollection
    && approvedMintContract
    && onchainGuards;

  let decision = "IGNORE";
  if (preferencePasses) decision = autonomousEligible ? "AUTONOMOUS_POLICY_ELIGIBLE" : "OWNER_APPROVAL_REQUIRED";
  else if (normalized.economicSettings.inspectMints && !blocked) {
    decision = !evidenceKnown || normalized.riskSettings.unknownMintMode !== "IGNORE"
      ? "RESEARCH"
      : "WATCH";
  }

  return Object.freeze({
    applicable: true,
    decision,
    wantsToJoin: preferencePasses,
    ownerApprovalRequired: preferencePasses && !autonomousEligible,
    autonomousEligible,
    priceStatus,
    price,
    isFree,
    approvedCollection,
    approvedMintContract,
    reasons: Object.freeze(reasons),
  });
}
