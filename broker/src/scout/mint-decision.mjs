import { createHash } from "node:crypto";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { buildScoutRecommendation } from "./recommendation.mjs";
import { canonicalJson, parseCanonicalJson } from "./canonical-json.mjs";

const MINT_TYPES = new Set([
  "MINT",
  "FREE_MINT",
  "EDITION",
  "ALLOWLIST_MINT",
  "COLLECTION_DROP",
]);
const MAX_PUNKS = 100;
const MAX_UINT256 = (1n << 256n) - 1n;
const PUNK_FIELDS = new Set([
  "tokenId",
  "account",
  "expectedOwner",
  "personaKey",
  "mandate",
  "controls",
]);
const MANDATE_FIELDS = new Set([
  "chainId", "collection", "tokenId", "version", "mode", "configuredBy",
  "economicSettings", "riskSettings", "artisticPreferences", "mintPermissions",
]);
const ECONOMIC_FIELDS = new Set([
  "inspectMints", "allowFreeMints", "allowPaidMints", "maxMintPriceWei",
  "dailyBudgetWei", "weeklyBudgetWei", "minimumReserveWei", "maxMintsPerDay",
]);
const RISK_FIELDS = new Set([
  "unknownMintMode", "maxContractRiskScore",
]);
const ARTISTIC_FIELDS = new Set([
  "minimumTasteMatch", "dimensions",
]);
const PERMISSION_FIELDS = new Set([
  "approvedMintContracts", "approvedCollections", "blockedCollections",
]);
const CONTROL_FIELDS = new Set([
  "acquisitionsToday", "spentTodayWei", "spentThisWeekWei", "accountBalanceWei",
  "proposalSupported", "targetInspectionValidated", "ownerMandateCurrent",
  "policySnapshotValidated", "expectedOwner",
]);

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function allowedKeys(value, allowed, label) {
  plainObject(value, label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${String(key)}`);
    }
  }
}

function validateDecisionInputSchemas(punk, index) {
  allowedKeys(punk.mandate, MANDATE_FIELDS, `punks[${index}].mandate`);
  const economic = punk.mandate.economicSettings;
  const risk = punk.mandate.riskSettings;
  const artistic = punk.mandate.artisticPreferences;
  const permissions = punk.mandate.mintPermissions;
  if (economic !== undefined) allowedKeys(economic, ECONOMIC_FIELDS, `punks[${index}].mandate.economicSettings`);
  if (risk !== undefined) allowedKeys(risk, RISK_FIELDS, `punks[${index}].mandate.riskSettings`);
  if (artistic !== undefined) allowedKeys(artistic, ARTISTIC_FIELDS, `punks[${index}].mandate.artisticPreferences`);
  if (permissions !== undefined) allowedKeys(permissions, PERMISSION_FIELDS, `punks[${index}].mandate.mintPermissions`);
  allowedKeys(punk.controls, CONTROL_FIELDS, `punks[${index}].controls`);
}

function validateCanonicalOpportunitySchema(opportunity) {
  const forbiddenAliases = [
    "opportunity_type",
    "chain_id",
    "collection_address",
    "token_id",
    "expected_price",
    "max_price",
    "maximum_price",
    "currency_address",
    "risk_label",
    "marketplace_address",
    "mintPrice",
  ];
  for (const alias of forbiddenAliases) {
    if (Object.hasOwn(opportunity, alias)) {
      throw new TypeError(`opportunity must use canonical field names; ${alias} is unsupported`);
    }
  }
  if (opportunity.metadata !== undefined) {
    plainObject(opportunity.metadata, "opportunity.metadata");
    if (Object.hasOwn(opportunity.metadata, "asset_standard")) {
      throw new TypeError("opportunity.metadata must use canonical assetStandard");
    }
  }
  if (opportunity.scores !== undefined) {
    plainObject(opportunity.scores, "opportunity.scores");
    if (Object.hasOwn(opportunity.scores, "contract_risk_score")) {
      throw new TypeError("opportunity.scores must use canonical contractRiskScore");
    }
  }
}

function hashCanonical(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function tokenId(value) {
  try {
    let parsed;
    if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) parsed = BigInt(value);
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) parsed = BigInt(value);
    else throw new TypeError();
    if (parsed < 0n || parsed > MAX_UINT256) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError("Punk tokenId must be a non-negative integer");
  }
}

/**
 * Runs the same mint opportunity independently through each Punk's mandate.
 * This proof is local and read-only: it never contacts an RPC, signs, submits,
 * persists, or enables execution.
 */
export function buildPerPunkMintDecisions({ opportunity, punks }) {
  opportunity = parseCanonicalJson(canonicalJson(opportunity));
  punks = parseCanonicalJson(canonicalJson(punks));
  plainObject(opportunity, "opportunity");
  validateCanonicalOpportunitySchema(opportunity);
  const opportunityType = String(opportunity.opportunityType ?? opportunity.opportunity_type ?? "");
  if (!MINT_TYPES.has(opportunityType)) throw new TypeError("opportunity must be a mint type");
  if (typeof opportunity.id !== "string" || opportunity.id.length === 0 || opportunity.id.length > 512) {
    throw new TypeError("opportunity.id must be a non-empty string of at most 512 characters");
  }
  if (!Array.isArray(punks) || punks.length === 0 || punks.length > MAX_PUNKS) {
    throw new TypeError(`punks must contain between 1 and ${MAX_PUNKS} entries`);
  }

  const seen = new Set();
  const seenAccounts = new Set();
  const normalizedPunks = punks.map((punk, index) => {
    plainObject(punk, `punks[${index}]`);
    for (const key of Reflect.ownKeys(punk)) {
      if (typeof key !== "string" || !PUNK_FIELDS.has(key)) {
        throw new TypeError(`Unsupported punks[${index}] field ${String(key)}`);
      }
    }
    for (const required of PUNK_FIELDS) {
      if (!Object.hasOwn(punk, required)) throw new TypeError(`punks[${index}].${required} is required`);
    }
    validateDecisionInputSchemas(punk, index);
    const canonicalTokenId = tokenId(punk.tokenId);
    if (seen.has(canonicalTokenId)) throw new TypeError(`Duplicate Punk tokenId ${canonicalTokenId}`);
    seen.add(canonicalTokenId);
    const account = normalizeAddress(punk.account, `punks[${index}].account`);
    const expectedOwner = normalizeAddress(punk.expectedOwner, `punks[${index}].expectedOwner`);
    if (/^0x0{40}$/.test(account) || /^0x0{40}$/.test(expectedOwner)) {
      throw new TypeError(`punks[${index}] account and expectedOwner must be nonzero`);
    }
    if (seenAccounts.has(account)) throw new TypeError(`Duplicate supplied Punk Account ${account}`);
    seenAccounts.add(account);
    plainObject(punk.controls, `punks[${index}].controls`);
    if (
      Object.hasOwn(punk.controls, "expectedOwner")
      && normalizeAddress(punk.controls.expectedOwner, `punks[${index}].controls.expectedOwner`) !== expectedOwner
    ) throw new TypeError(`punks[${index}] expectedOwner evidence conflicts`);
    return {
      ...punk,
      tokenId: canonicalTokenId,
      account,
      expectedOwner,
      controls: { ...punk.controls, expectedOwner },
    };
  }).sort((left, right) => {
    const a = BigInt(left.tokenId);
    const b = BigInt(right.tokenId);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const decisions = normalizedPunks.map((punk) => {
    const result = buildScoutRecommendation({
      tokenId: punk.tokenId,
      personaKey: punk.personaKey,
      opportunity,
      mandate: punk.mandate,
      decisionControls: punk.controls,
    });
    return {
      punkTokenId: punk.tokenId,
      punk: {
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        tokenId: punk.tokenId,
        account: punk.account,
        expectedOwner: punk.expectedOwner,
        accountEvidence: "SUPPLIED_UNVERIFIED_LOCAL",
        expectedOwnerEvidence: "SUPPLIED_UNVERIFIED_LOCAL",
      },
      recommendationId: result.id,
      decisionId: result.decisionId,
      decision: result.mintDecision,
      scores: result.scores,
      explanation: result.explanation,
      reasoningHash: result.reasoningHash,
      policyVersion: result.policyVersion,
      mandateHash: result.publicDetail.mandateHash,
      controlsHash: hashCanonical(punk.controls),
      mintInterest: result.publicDetail.mintInterest,
      tasteProfileSource: result.publicDetail.tasteProfileSource,
      personaTasteMatch: result.publicDetail.personaTasteMatch,
      mandateTasteMatch: result.publicDetail.mandateTasteMatch,
    };
  });
  const artifact = {
    schema: "GOGH_LOCAL_PER_PUNK_MINT_DECISIONS_V1",
    mode: "READ_ONLY_LOCAL",
    opportunityId: opportunity.id,
    opportunityHash: hashCanonical(opportunity),
    opportunityType,
    decisions,
    security: {
      executionEnabled: false,
      autonomyEnabled: false,
      signingPerformed: false,
      submissionPerformed: false,
      chainWritePerformed: false,
      rpcPerformed: false,
      persistencePerformed: false,
      identityEvidence: "SUPPLIED_UNVERIFIED_LOCAL",
    },
  };
  const decisionHash = hashCanonical(artifact);
  return deepFreeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    decisionHash,
    artifact,
  });
}
