import { createHash } from "node:crypto";
import { ROBINHOOD } from "../config.mjs";
import {
  evaluateMintInterest,
  normalizeArtMandate,
  normalizeMintOpportunityDecisionEvidence,
} from "../mandate.mjs";
import { PUNK_PERSONAS, tasteMatch, tasteMatchFromWeights } from "../personas.mjs";
import { recommendOpportunity } from "../recommendation/engine.mjs";
import { canonicalJson } from "./canonical-json.mjs";

export const SCOUT_RECOMMENDER_VERSION = "gogh-scout-recommender-v1";
export const SCOUT_RECOMMENDER_VERSION_HASH = hashBytes32(SCOUT_RECOMMENDER_VERSION);

function hashBytes32(value) {
  return `0x${createHash("sha256").update(String(value)).digest("hex")}`;
}

function deterministicUuid(value) {
  const bytes = createHash("sha256").update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function boundedScore(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

function evidenceConfidence(scores) {
  return Math.round((
    boundedScore(ownValue(scores, "artConfidence", undefined))
    + boundedScore(ownValue(scores, "marketConfidence", undefined))
    + boundedScore(ownValue(scores, "contractRiskConfidence", undefined))
  ) / 3 * 100) / 100;
}

function validTokenId(value) {
  try {
    const tokenId = BigInt(value);
    if (tokenId < 0n) throw new TypeError();
    return tokenId.toString();
  } catch {
    throw new TypeError("Scout token ID must be a non-negative integer");
  }
}

function ownValue(value, key, fallback) {
  return value && Object.hasOwn(value, key) ? value[key] : fallback;
}

export function buildScoutRecommendation({
  tokenId,
  personaKey,
  opportunity,
  mandate = null,
  decisionControls = {},
}) {
  const canonicalTokenId = validTokenId(tokenId);
  const persona = Object.hasOwn(PUNK_PERSONAS, personaKey) ? PUNK_PERSONAS[personaKey] : null;
  if (!persona) throw new TypeError(`Unknown Scout persona ${personaKey}`);
  if (!opportunity || !Object.hasOwn(opportunity, "id") || !opportunity.id) {
    throw new TypeError("Scout opportunity ID is required");
  }
  const normalizedMandate = normalizeArtMandate(mandate ?? {
    tokenId: canonicalTokenId,
    mode: "SCOUT",
  });
  if (normalizedMandate.tokenId !== canonicalTokenId) {
    throw new TypeError("Art Mandate token ID does not match the Scout Punk");
  }

  const decisionOpportunity = normalizeMintOpportunityDecisionEvidence(opportunity);
  const scores = ownValue(decisionOpportunity, "scores", {}) ?? {};
  const metadata = ownValue(decisionOpportunity, "metadata", {}) ?? {};
  const collectionSignals = ownValue(metadata, "collectionSignals", {}) ?? {};
  const artSignals = ownValue(collectionSignals, "art", {}) ?? {};
  const dimensions = ownValue(artSignals, "dimensions", {}) ?? {};
  const hasTasteEvidence = Object.keys(dimensions).length > 0;
  const personaMatch = hasTasteEvidence ? tasteMatch(persona, dimensions) : 0;
  const mandateDimensions = normalizedMandate.artisticPreferences.dimensions;
  const usesMandateTaste = Object.keys(mandateDimensions).length > 0;
  const mandateMatch = hasTasteEvidence && usesMandateTaste
    ? tasteMatchFromWeights(mandateDimensions, dimensions)
    : null;
  const match = mandateMatch ?? personaMatch;
  const riskLabel = decisionOpportunity.riskLabel ?? opportunity.riskLabel ?? opportunity.risk_label ?? "UNKNOWN";
  const scoredRecommendation = recommendOpportunity({
    artScore: boundedScore(ownValue(scores, "artScore", undefined)),
    tasteMatch: match,
    creatorScore: boundedScore(ownValue(scores, "creatorScore", undefined)),
    marketScore: boundedScore(ownValue(scores, "marketScore", undefined)),
    liquidityScore: boundedScore(ownValue(scores, "liquidityScore", undefined)),
    collectionScore: boundedScore(ownValue(scores, "collectionScore", undefined)),
    contractRiskScore: boundedScore(ownValue(scores, "contractRiskScore", undefined), 100),
    confidence: evidenceConfidence(scores),
    riskLabel,
  });
  const listingActionable = ownValue(metadata, "actionableListing", true) !== false;
  const curatorialSignal = listingActionable
    ? scoredRecommendation
    : Object.freeze({
      ...scoredRecommendation,
      recommendation: "RESEARCH",
      explanation: `${scoredRecommendation.explanation} This is an observed historical or mint signal, not a verified executable opportunity.`,
    });

  const evidenceNote = hasTasteEvidence
    ? `Taste Match is derived from bounded on-chain metadata heuristics using the ${usesMandateTaste ? "Punk's Art Mandate" : "selected Punk persona"}.`
    : "Taste evidence is unavailable, so no Taste Match was inferred.";
  const mintInterest = evaluateMintInterest({
    mandate: normalizedMandate,
    opportunity: decisionOpportunity,
    recommendation: scoredRecommendation,
    controls: decisionControls,
  });
  const mintDecision = mintInterest.applicable ? mintInterest.decision : null;
  // The repository's long-standing recommendation enum does not contain
  // PROPOSE. Preserve a compatible curatorial state while keeping the exact,
  // strongly bound mint state in `mintDecision`/`mintInterest`.
  const finalRecommendation = !mintInterest.applicable
    ? curatorialSignal.recommendation
    : mintInterest.decision === "PROPOSE" || mintInterest.decision === "RECOMMEND"
      ? "RECOMMEND"
      : mintInterest.decision;
  const explanation = mintInterest.applicable
    ? `${mintInterest.reasons.join("; ")}. ${evidenceNote}`
    : `${curatorialSignal.explanation} ${evidenceNote}`;
  const identity = `${ROBINHOOD.chainId}:${ROBINHOOD.canonicalCollection}:${canonicalTokenId}`;
  const versionKey = ownValue(collectionSignals, "analyzerVersion", "analysis-unavailable");
  const mandateHash = hashBytes32(canonicalJson(normalizedMandate));
  const recommendationId = deterministicUuid(
    `recommendation:${identity}:${opportunity.id}:${personaKey}:${versionKey}:${mandateHash}:${SCOUT_RECOMMENDER_VERSION}`,
  );
  const publicDetail = Object.freeze({
    mode: normalizedMandate.mode,
    personaKey,
    personaName: persona.name,
    recommendation: finalRecommendation,
    mintDecision,
    scores: scoredRecommendation.scores,
    explanation,
    disclaimer: scoredRecommendation.disclaimer,
    opportunityId: String(opportunity.id),
    evidenceStatus: Object.freeze({
      taste: hasTasteEvidence ? "HEURISTIC" : "UNAVAILABLE",
      contract: ownValue(ownValue(metadata, "analysisStatus", {}), "contract", "UNAVAILABLE"),
      art: ownValue(ownValue(metadata, "analysisStatus", {}), "art", "UNAVAILABLE"),
      market: ownValue(ownValue(metadata, "analysisStatus", {}), "market", "UNAVAILABLE"),
      liquidity: ownValue(ownValue(metadata, "analysisStatus", {}), "liquidity", "UNAVAILABLE"),
    }),
    mintInterest,
    curatorialSignal: Object.freeze({
      recommendation: curatorialSignal.recommendation,
      explanation: curatorialSignal.explanation,
    }),
    tasteProfileSource: usesMandateTaste ? "MANDATE_DIMENSIONS" : "PERSONA",
    personaTasteMatch: personaMatch,
    mandateTasteMatch: mandateMatch,
    mandateVersion: normalizedMandate.version || null,
    mandateHash,
  });
  const reasoningHash = hashBytes32(canonicalJson(publicDetail));

  return Object.freeze({
    id: recommendationId,
    decisionId: deterministicUuid(`decision:${recommendationId}`),
    tokenId: canonicalTokenId,
    opportunityId: String(opportunity.id),
    personaKey,
    recommendation: finalRecommendation,
    mintDecision,
    scores: scoredRecommendation.scores,
    explanation,
    policyVersion: normalizedMandate.version || null,
    reasoningHash,
    agentVersionHash: SCOUT_RECOMMENDER_VERSION_HASH,
    publicDetail,
  });
}
