import { createHash } from "node:crypto";
import { ROBINHOOD } from "../config.mjs";
import { evaluateMintInterest, normalizeArtMandate } from "../mandate.mjs";
import { PUNK_PERSONAS, tasteMatch } from "../personas.mjs";
import { recommendOpportunity } from "../recommendation/engine.mjs";

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
    boundedScore(scores.artConfidence)
    + boundedScore(scores.marketConfidence)
    + boundedScore(scores.contractRiskConfidence)
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

export function buildScoutRecommendation({
  tokenId,
  personaKey,
  opportunity,
  mandate = null,
}) {
  const canonicalTokenId = validTokenId(tokenId);
  const persona = PUNK_PERSONAS[personaKey];
  if (!persona) throw new TypeError(`Unknown Scout persona ${personaKey}`);
  if (!opportunity?.id) throw new TypeError("Scout opportunity ID is required");

  const scores = opportunity.scores ?? {};
  const metadata = opportunity.metadata ?? {};
  const dimensions = metadata.collectionSignals?.art?.dimensions ?? {};
  const hasTasteEvidence = Object.keys(dimensions).length > 0;
  const match = hasTasteEvidence ? tasteMatch(persona, dimensions) : 0;
  const riskLabel = opportunity.risk_label ?? opportunity.riskLabel ?? "UNKNOWN";
  const scoredRecommendation = recommendOpportunity({
    artScore: boundedScore(scores.artScore),
    tasteMatch: match,
    creatorScore: boundedScore(scores.creatorScore),
    marketScore: boundedScore(scores.marketScore),
    liquidityScore: boundedScore(scores.liquidityScore),
    collectionScore: boundedScore(scores.collectionScore),
    contractRiskScore: boundedScore(scores.contractRiskScore, 100),
    confidence: evidenceConfidence(scores),
    riskLabel,
  });
  const actionable = metadata.actionableListing !== false && metadata.actionableMint !== false;
  const recommendation = actionable
    ? scoredRecommendation
    : Object.freeze({
      ...scoredRecommendation,
      recommendation: "RESEARCH",
      explanation: `${scoredRecommendation.explanation} This is an observed historical or mint signal, not a verified executable opportunity.`,
    });

  const evidenceNote = hasTasteEvidence
    ? "Taste Match is derived from bounded on-chain metadata heuristics."
    : "Taste evidence is unavailable, so no Taste Match was inferred.";
  const explanation = `${recommendation.explanation} ${evidenceNote}`;
  const normalizedMandate = normalizeArtMandate(mandate ?? {
    tokenId: canonicalTokenId,
    mode: "SCOUT",
  });
  if (normalizedMandate.tokenId !== canonicalTokenId) {
    throw new TypeError("Art Mandate token ID does not match the Scout Punk");
  }
  const mintInterest = evaluateMintInterest({
    mandate: normalizedMandate,
    opportunity,
    recommendation,
  });
  const identity = `${ROBINHOOD.chainId}:${ROBINHOOD.canonicalCollection}:${canonicalTokenId}`;
  const versionKey = metadata.collectionSignals?.analyzerVersion ?? "analysis-unavailable";
  const mandateHash = hashBytes32(JSON.stringify(normalizedMandate));
  const recommendationId = deterministicUuid(
    `recommendation:${identity}:${opportunity.id}:${personaKey}:${versionKey}:${mandateHash}:${SCOUT_RECOMMENDER_VERSION}`,
  );
  const publicDetail = Object.freeze({
    mode: "SCOUT",
    personaKey,
    personaName: persona.name,
    recommendation: recommendation.recommendation,
    scores: recommendation.scores,
    explanation,
    disclaimer: recommendation.disclaimer,
    opportunityId: String(opportunity.id),
    evidenceStatus: Object.freeze({
      taste: hasTasteEvidence ? "HEURISTIC" : "UNAVAILABLE",
      contract: metadata.analysisStatus?.contract ?? "UNAVAILABLE",
      art: metadata.analysisStatus?.art ?? "UNAVAILABLE",
      market: metadata.analysisStatus?.market ?? "UNAVAILABLE",
      liquidity: metadata.analysisStatus?.liquidity ?? "UNAVAILABLE",
    }),
    mintInterest,
    mandateVersion: normalizedMandate.version || null,
    mandateHash,
  });
  const reasoningHash = hashBytes32(JSON.stringify(publicDetail));

  return Object.freeze({
    id: recommendationId,
    decisionId: deterministicUuid(`decision:${recommendationId}`),
    tokenId: canonicalTokenId,
    opportunityId: String(opportunity.id),
    personaKey,
    recommendation: recommendation.recommendation,
    scores: recommendation.scores,
    explanation,
    policyVersion: normalizedMandate.version || null,
    reasoningHash,
    agentVersionHash: SCOUT_RECOMMENDER_VERSION_HASH,
    publicDetail,
  });
}
