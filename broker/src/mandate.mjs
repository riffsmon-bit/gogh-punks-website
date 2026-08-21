import {
  BROKER_MODES,
  ROBINHOOD,
  normalizeAddress,
} from "./config.mjs";
import { TASTE_DIMENSIONS } from "./personas.mjs";

const MINT_TYPES = new Set([
  "MINT",
  "FREE_MINT",
  "EDITION",
  "ALLOWLIST_MINT",
  "COLLECTION_DROP",
]);

const UNKNOWN_MINT_MODES = new Set(["IGNORE", "SCOUT_ONLY", "OWNER_APPROVAL"]);
const RISK_LABELS = new Set(["LOWER_RISK", "MEDIUM_RISK", "HIGHER_RISK", "UNKNOWN"]);

function boolean(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function amount(value, field, fallback = "0") {
  try {
    const candidate = value ?? fallback;
    let parsed;
    if (typeof candidate === "bigint") parsed = candidate;
    else if (typeof candidate === "number" && Number.isSafeInteger(candidate)) parsed = BigInt(candidate);
    else if (typeof candidate === "string" && /^(0|[1-9]\d*)$/.test(candidate)) parsed = BigInt(candidate);
    else throw new TypeError();
    if (parsed < 0n) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError(`${field} must be a non-negative integer amount`);
  }
}

function integer(value, field, fallback, minimum, maximum) {
  const candidate = value ?? fallback;
  const parsed = typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : typeof candidate === "string" && /^(0|[1-9]\d*)$/.test(candidate)
      ? Number(candidate)
      : Number.NaN;
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

function tasteDimensions(value) {
  if (value === undefined || value === null) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("artisticPreferences.dimensions must be an object");
  }
  const allowed = new Set(TASTE_DIMENSIONS);
  const normalized = {};
  for (const [dimension, rawWeight] of Object.entries(value)) {
    if (!allowed.has(dimension)) throw new TypeError(`Unknown Taste Profile dimension ${dimension}`);
    const weight = rawWeight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new TypeError(`${dimension} weight must be between 0 and 100`);
    }
    normalized[dimension] = weight;
  }
  return Object.freeze(normalized);
}

function settings(input, camel, snake) {
  if (input && Object.hasOwn(input, camel) && input[camel] !== undefined && input[camel] !== null) {
    return input[camel];
  }
  if (input && Object.hasOwn(input, snake) && input[snake] !== undefined && input[snake] !== null) {
    return input[snake];
  }
  return {};
}

function field(input, camel, snake, fallback) {
  if (input && Object.hasOwn(input, camel) && input[camel] !== undefined && input[camel] !== null) {
    return input[camel];
  }
  if (input && Object.hasOwn(input, snake) && input[snake] !== undefined && input[snake] !== null) {
    return input[snake];
  }
  return fallback;
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
  const configuredByCamelValue = Object.hasOwn(input, "configuredBy") ? input.configuredBy : null;
  const configuredBySnakeValue = Object.hasOwn(input, "configured_by") ? input.configured_by : null;
  const configuredByCamel = configuredByCamelValue === undefined || configuredByCamelValue === null
    ? null
    : normalizeAddress(configuredByCamelValue, "configuredBy");
  const configuredBySnake = configuredBySnakeValue === undefined || configuredBySnakeValue === null
    ? null
    : normalizeAddress(configuredBySnakeValue, "configured_by");
  if (configuredByCamel && configuredBySnake && configuredByCamel !== configuredBySnake) {
    throw new TypeError("configuredBy aliases conflict");
  }
  const configuredByValue = configuredByCamel ?? configuredBySnake;
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
    configuredBy: configuredByValue,
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
      dimensions: tasteDimensions(field(artistic, "dimensions", "dimensions", {})),
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
  if (opportunity && Object.hasOwn(opportunity, camel) && opportunity[camel] !== undefined && opportunity[camel] !== null) {
    return opportunity[camel];
  }
  if (opportunity && Object.hasOwn(opportunity, snake) && opportunity[snake] !== undefined && opportunity[snake] !== null) {
    return opportunity[snake];
  }
  return fallback;
}

function decisionPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${fieldName} cannot contain symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !Object.hasOwn(descriptors[key], "value"))) {
    throw new TypeError(`${fieldName} cannot contain accessors`);
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROPOSAL_GATES = Object.freeze([
  "proposalSupported",
  "targetInspectionValidated",
  "ownerMandateCurrent",
  "policySnapshotValidated",
]);

function optionalUsageAmount(controls, fieldName) {
  if (!Object.hasOwn(controls, fieldName)) return null;
  return BigInt(amount(controls[fieldName], fieldName));
}

function optionalUsageInteger(controls, fieldName) {
  if (!Object.hasOwn(controls, fieldName)) return null;
  return integer(controls[fieldName], fieldName, 0, 0, Number.MAX_SAFE_INTEGER);
}

function frozenResult(value) {
  return Object.freeze({
    ...value,
    executionEnabled: false,
    autonomyEnabled: false,
    autonomousEligible: false,
    reasons: Object.freeze(value.reasons),
  });
}

function resolveAliases(input, aliases, fieldName, normalize, fallback) {
  const supplied = aliases
    .filter((alias) => Object.hasOwn(input, alias) && input[alias] !== undefined && input[alias] !== null)
    .map((alias) => ({ alias, value: normalize(input[alias]) }));
  if (supplied.length === 0) return normalize(fallback);
  if (supplied.some(({ value }) => value !== supplied[0].value)) {
    throw new TypeError(`${fieldName} aliases conflict`);
  }
  return supplied[0].value;
}

/**
 * Canonicalizes all decision-critical opportunity aliases once and rejects any
 * conflicting representation before recommendation scoring or mandate checks.
 */
export function normalizeMintOpportunityDecisionEvidence(opportunity) {
  decisionPlainObject(opportunity, "mint opportunity");
  const opportunityType = resolveAliases(
    opportunity,
    ["opportunityType", "opportunity_type"],
    "opportunityType",
    (value) => String(value),
    "",
  );
  if (!MINT_TYPES.has(opportunityType)) return Object.freeze({ ...opportunity, opportunityType });
  if (
    !Object.hasOwn(opportunity, "chainId")
    && !Object.hasOwn(opportunity, "chain_id")
  ) throw new TypeError("mint opportunity chainId is required");
  const chainId = resolveAliases(
    opportunity,
    ["chainId", "chain_id"],
    "chainId",
    (value) => {
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
      if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
      }
      throw new TypeError("chainId must be a canonical non-negative safe integer");
    },
    null,
  );
  if (chainId !== ROBINHOOD.chainId) {
    throw new TypeError(`mint opportunity chainId must be ${ROBINHOOD.chainId}`);
  }
  const collection = resolveAliases(
    opportunity,
    ["collection", "collection_address"],
    "collection",
    (value) => normalizeAddress(value, "mint collection"),
    null,
  );
  const expectedPrice = resolveAliases(
    opportunity,
    ["expectedPrice", "expected_price", "mintPrice"],
    "expectedPrice",
    (value) => amount(value, "mint price"),
    "0",
  );
  const metadata = Object.hasOwn(opportunity, "metadata") ? (opportunity.metadata ?? {}) : {};
  decisionPlainObject(metadata, "mint opportunity metadata");
  const tokenIdEntries = ["tokenId", "token_id"]
    .filter((alias) => Object.hasOwn(opportunity, alias) && opportunity[alias] !== undefined && opportunity[alias] !== null)
    .map((alias) => amount(opportunity[alias], "mint tokenId"));
  if (tokenIdEntries.length > 1 && !tokenIdEntries.every((value) => value === tokenIdEntries[0])) {
    throw new TypeError("tokenId aliases conflict");
  }
  const canonicalTokenId = tokenIdEntries[0];
  const assetStandardEntries = ["assetStandard", "asset_standard"]
    .filter((alias) => Object.hasOwn(metadata, alias) && metadata[alias] !== undefined && metadata[alias] !== null)
    .map((alias) => String(metadata[alias]));
  if (
    assetStandardEntries.length > 1
    && !assetStandardEntries.every((value) => value === assetStandardEntries[0])
  ) throw new TypeError("assetStandard aliases conflict");
  const assetStandard = assetStandardEntries[0];
  const maxPriceInputs = { ...opportunity };
  if (Object.hasOwn(metadata, "maxPrice") && metadata.maxPrice !== undefined && metadata.maxPrice !== null) {
    maxPriceInputs.metadataMaxPrice = metadata.maxPrice;
  }
  const maxPrice = resolveAliases(
    maxPriceInputs,
    ["maxPrice", "max_price", "maximum_price", "metadataMaxPrice"],
    "maxPrice",
    (value) => amount(value, "maximum mint price"),
    expectedPrice,
  );
  const currencyInputs = { ...opportunity };
  if (Object.hasOwn(metadata, "currency") && metadata.currency !== undefined && metadata.currency !== null) {
    currencyInputs.metadataCurrency = metadata.currency;
  }
  const currency = resolveAliases(
    currencyInputs,
    ["currency", "currency_address", "metadataCurrency"],
    "currency",
    (value) => normalizeAddress(value, "mint currency"),
    ZERO_ADDRESS,
  );
  const riskLabel = resolveAliases(
    opportunity,
    ["riskLabel", "risk_label"],
    "riskLabel",
    (value) => String(value),
    "UNKNOWN",
  );
  const venueInputs = { ...opportunity };
  if (Object.hasOwn(metadata, "mintContract") && metadata.mintContract !== undefined && metadata.mintContract !== null) {
    venueInputs.metadataMintContract = metadata.mintContract;
  }
  const venue = resolveAliases(
    venueInputs,
    ["venue", "marketplace_address", "metadataMintContract"],
    "mint venue",
    (value) => normalizeAddress(value, "mint venue"),
    collection,
  );
  const scores = Object.hasOwn(opportunity, "scores") ? (opportunity.scores ?? {}) : {};
  decisionPlainObject(scores, "mint opportunity scores");
  const riskScoreEntries = ["contractRiskScore", "contract_risk_score"]
    .filter((alias) => Object.hasOwn(scores, alias) && scores[alias] !== undefined && scores[alias] !== null)
    .map((alias) => scores[alias]);
  if (
    riskScoreEntries.length > 1
    && !riskScoreEntries.every((value) => Object.is(value, riskScoreEntries[0]))
  ) throw new TypeError("contractRiskScore aliases conflict");
  const riskScore = riskScoreEntries.length === 0 ? undefined : riskScoreEntries[0];
  const canonicalScores = { ...scores };
  delete canonicalScores.contract_risk_score;
  if (riskScore !== undefined) canonicalScores.contractRiskScore = riskScore;
  else delete canonicalScores.contractRiskScore;
  const canonicalMetadata = { ...metadata, mintContract: venue };
  if (assetStandard !== undefined) canonicalMetadata.assetStandard = assetStandard;
  delete canonicalMetadata.asset_standard;
  delete canonicalMetadata.maxPrice;
  delete canonicalMetadata.currency;
  const canonical = {
    ...opportunity,
    chainId,
    opportunityType,
    collection,
    expectedPrice,
    maxPrice,
    currency,
    riskLabel,
    venue,
    scores: canonicalScores,
    metadata: canonicalMetadata,
  };
  if (canonicalTokenId !== undefined) canonical.tokenId = canonicalTokenId;
  for (const alias of [
    "opportunity_type",
    "chain_id",
    "collection_address",
    "token_id",
    "expected_price",
    "mintPrice",
    "max_price",
    "maximum_price",
    "currency_address",
    "risk_label",
    "marketplace_address",
  ]) delete canonical[alias];
  return Object.freeze(canonical);
}

/**
 * Deterministically evaluates a mint against one Punk's mandate. This local
 * result can only IGNORE, WATCH, RECOMMEND, or prepare for owner review via
 * PROPOSE. It never authorizes execution or autonomous spending.
 */
export function evaluateMintInterest({ mandate, opportunity, recommendation, controls = {} }) {
  const normalized = normalizeArtMandate(mandate);
  if (!controls || typeof controls !== "object" || Array.isArray(controls)) {
    throw new TypeError("mint decision controls must be an object");
  }
  const canonicalOpportunity = normalizeMintOpportunityDecisionEvidence(opportunity);
  const opportunityType = String(canonicalOpportunity.opportunityType);
  if (!MINT_TYPES.has(opportunityType)) {
    return frozenResult({
      applicable: false,
      decision: "NOT_APPLICABLE",
      wantsToJoin: false,
      ownerApprovalRequired: false,
      reasons: [],
    });
  }

  const collection = canonicalOpportunity.collection;
  const metadata = Object.hasOwn(canonicalOpportunity, "metadata")
    ? (canonicalOpportunity.metadata ?? {})
    : {};
  const scores = recommendation && Object.hasOwn(recommendation, "scores")
    ? recommendation.scores
    : Object.hasOwn(canonicalOpportunity, "scores")
      ? canonicalOpportunity.scores
      : {};
  const riskLabel = canonicalOpportunity.riskLabel;
  const evidenceScores = Object.hasOwn(canonicalOpportunity, "scores")
    ? (canonicalOpportunity.scores ?? {})
    : {};
  const rawRiskScore = Object.hasOwn(evidenceScores, "contractRiskScore")
    ? evidenceScores.contractRiskScore
    : Object.hasOwn(evidenceScores, "contract_risk_score")
      ? evidenceScores.contract_risk_score
      : undefined;
  const riskScore = rawRiskScore;
  const riskLabelValid = RISK_LABELS.has(riskLabel);
  const riskScoreValid = rawRiskScore !== undefined
    && rawRiskScore !== null
    && typeof riskScore === "number"
    && Number.isFinite(riskScore)
    && riskScore >= 0
    && riskScore <= 100;
  const tasteMatch = Number(scores.tasteMatch ?? 0);
  const priceStatus = String(
    Object.hasOwn(metadata, "mintPriceStatus") ? (metadata.mintPriceStatus ?? "UNKNOWN") : "UNKNOWN",
  );
  const expectedPrice = amount(
    canonicalOpportunity.expectedPrice,
    "mint price",
  );
  const maxPrice = amount(
    canonicalOpportunity.maxPrice,
    "maximum mint price",
  );
  const price = BigInt(maxPrice);
  const expected = BigInt(expectedPrice);
  const isFree = priceStatus === "KNOWN" && expected === 0n && price === 0n;
  const approvedCollection = normalized.mintPermissions.approvedCollections.includes(collection);
  const mintContractValue = canonicalOpportunity.venue;
  const mintContract = normalizeAddress(mintContractValue, "mint contract");
  const approvedMintContract = normalized.mintPermissions.approvedMintContracts.includes(mintContract);
  const blocked = normalized.mintPermissions.blockedCollections.includes(collection);
  const currencyValue = canonicalOpportunity.currency;
  const currency = normalizeAddress(currencyValue, "mint currency");
  const nativeCurrency = currency === ZERO_ADDRESS;
  const actionable = Object.hasOwn(metadata, "actionableMint") && metadata.actionableMint === true;
  const reasons = [];

  if (normalized.mode === "DISABLED") reasons.push("The Art Broker is disabled for this Punk");
  if (!normalized.economicSettings.inspectMints) reasons.push("Mint scouting is disabled for this Punk");
  if (blocked) reasons.push("Collection is blocked by this Punk's owner");
  if (!actionable) reasons.push("The mint is not a verified actionable opportunity");
  if (priceStatus !== "KNOWN") reasons.push("Mint price and callable phase are not verified");
  if (!riskLabelValid) reasons.push("Contract risk label is invalid");
  else if (riskLabel === "UNKNOWN") reasons.push("Contract risk is unknown");
  if (!riskScoreValid) reasons.push("A finite contract risk score between 0 and 100 is required");
  if (price < expected) reasons.push("Maximum mint price is below the expected mint price");
  if (!nativeCurrency) reasons.push("Only native-currency mint budgets are supported by this decision proof");
  if (riskScoreValid && riskScore > normalized.riskSettings.maxContractRiskScore) {
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
    && price > BigInt(normalized.economicSettings.maxMintPriceWei)
  ) reasons.push("Mint price exceeds this Punk's ceiling");
  if (normalized.economicSettings.maxMintsPerDay === 0) {
    reasons.push("This Punk's daily mint count is zero");
  }
  const acquisitionsToday = optionalUsageInteger(controls, "acquisitionsToday");
  const spentToday = optionalUsageAmount(controls, "spentTodayWei");
  const spentThisWeek = optionalUsageAmount(controls, "spentThisWeekWei");
  const accountBalance = optionalUsageAmount(controls, "accountBalanceWei");
  const dailyBudget = BigInt(normalized.economicSettings.dailyBudgetWei);
  const weeklyBudget = BigInt(normalized.economicSettings.weeklyBudgetWei);
  const minimumReserve = BigInt(normalized.economicSettings.minimumReserveWei);
  let usagePasses = true;
  if (normalized.economicSettings.maxMintsPerDay > 0) {
    if (acquisitionsToday === null) {
      reasons.push("Today's acquisition count is unavailable");
      usagePasses = false;
    } else if (acquisitionsToday >= normalized.economicSettings.maxMintsPerDay) {
      reasons.push("This Punk has reached its daily mint count");
      usagePasses = false;
    }
  }
  if (dailyBudget > 0n) {
    if (spentToday === null) {
      reasons.push("Today's spend usage is unavailable");
      usagePasses = false;
    } else if (spentToday > dailyBudget || price > dailyBudget - spentToday) {
      reasons.push("Mint price exceeds this Punk's remaining daily budget");
      usagePasses = false;
    }
  } else if (price > 0n) {
    reasons.push("This Punk has no paid daily budget");
    usagePasses = false;
  }
  if (weeklyBudget > 0n) {
    if (spentThisWeek === null) {
      reasons.push("This week's spend usage is unavailable");
      usagePasses = false;
    } else if (spentThisWeek > weeklyBudget || price > weeklyBudget - spentThisWeek) {
      reasons.push("Mint price exceeds this Punk's remaining weekly budget");
      usagePasses = false;
    }
  } else if (price > 0n) {
    reasons.push("This Punk has no paid weekly budget");
    usagePasses = false;
  }
  if (minimumReserve > 0n || price > 0n) {
    if (accountBalance === null) {
      reasons.push("Punk Account balance is unavailable for reserve validation");
      usagePasses = false;
    } else if (accountBalance < price || accountBalance - price < minimumReserve) {
      reasons.push("Mint would violate this Punk's minimum reserve");
      usagePasses = false;
    }
  }

  const evidenceKnown = actionable
    && priceStatus === "KNOWN"
    && riskLabelValid
    && riskLabel !== "UNKNOWN"
    && riskScoreValid
    && nativeCurrency
    && price >= expected;
  const expectedOwner = !Object.hasOwn(controls, "expectedOwner") || controls.expectedOwner === undefined
    ? null
    : normalizeAddress(controls.expectedOwner, "expectedOwner decision evidence");
  const ownerMandateMatchesExpectedOwner = expectedOwner !== null
    && expectedOwner !== ZERO_ADDRESS
    && normalized.configuredBy !== null
    && normalized.configuredBy !== ZERO_ADDRESS
    && normalized.configuredBy === expectedOwner;
  if (
    normalized.mode !== "DISABLED"
    && normalized.economicSettings.inspectMints
    && !ownerMandateMatchesExpectedOwner
  ) reasons.push("Mandate configuredBy does not match the exact expected current owner");
  const preferencePasses = normalized.mode !== "DISABLED"
    && normalized.economicSettings.inspectMints
    && !blocked
    && evidenceKnown
    && riskScoreValid
    && riskScore <= normalized.riskSettings.maxContractRiskScore
    && Number.isFinite(tasteMatch)
    && tasteMatch >= normalized.artisticPreferences.minimumTasteMatch
    && normalized.economicSettings.maxMintsPerDay > 0
    && usagePasses
    && ownerMandateMatchesExpectedOwner
    && (isFree
      ? normalized.economicSettings.allowFreeMints
      : normalized.economicSettings.allowPaidMints
        && price <= BigInt(normalized.economicSettings.maxMintPriceWei));

  const proposalEvidencePasses = PROPOSAL_GATES.every(
    (gate) => Object.hasOwn(controls, gate) && controls[gate] === true,
  );
  if (preferencePasses && normalized.mode === "APPROVAL_REQUIRED") {
    if (!approvedCollection) reasons.push("Collection is not approved for an owner-review proposal");
    if (!approvedMintContract) reasons.push("Mint contract is not approved for an owner-review proposal");
    if (!proposalEvidencePasses) reasons.push("Owner-review proposal evidence is incomplete");
  }

  let decision;
  if (
    normalized.mode === "DISABLED"
    || !normalized.economicSettings.inspectMints
    || blocked
  ) {
    decision = "IGNORE";
  } else if (!evidenceKnown) {
    decision = normalized.riskSettings.unknownMintMode === "IGNORE" ? "IGNORE" : "WATCH";
  } else if (!preferencePasses) {
    decision = "WATCH";
  } else if (
    normalized.mode === "APPROVAL_REQUIRED"
    && approvedCollection
    && approvedMintContract
    && proposalEvidencePasses
    && ownerMandateMatchesExpectedOwner
  ) {
    decision = "PROPOSE";
  } else {
    decision = "RECOMMEND";
  }

  if (reasons.length === 0) reasons.push("Mint satisfies this Punk's current read-only Art Mandate checks");

  return frozenResult({
    applicable: true,
    decision,
    wantsToJoin: decision === "RECOMMEND" || decision === "PROPOSE",
    ownerApprovalRequired: decision === "PROPOSE",
    priceStatus,
    price: price.toString(),
    expectedPrice,
    maxPrice: price.toString(),
    isFree,
    actionable,
    currency,
    approvedCollection,
    approvedMintContract,
    remainingUsageValidated: usagePasses,
    proposalEvidenceValidated: proposalEvidencePasses,
    ownerMandateMatchesExpectedOwner,
    reasons,
  });
}
