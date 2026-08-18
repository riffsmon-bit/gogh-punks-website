import {
  OPPORTUNITY_TYPES,
  ROBINHOOD,
  assetKey,
  normalizeAddress,
} from "./config.mjs";

const RECOMMENDATIONS = new Set(["IGNORE", "WATCH", "RESEARCH", "RECOMMEND", "COLLECT"]);
const RISK_LABELS = new Set(["LOWER_RISK", "MEDIUM_RISK", "HIGHER_RISK", "UNKNOWN"]);

function finiteScore(value, field) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new TypeError(`${field} must be between 0 and 100`);
  }
  return Math.round(score * 100) / 100;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return number;
}

function amount(value, field) {
  try {
    const parsed = BigInt(value ?? 0);
    if (parsed < 0n) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError(`${field} must be a non-negative integer amount`);
  }
}

export function normalizeOpportunity(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("opportunity must be an object");
  }
  const chainId = Number(input.chainId);
  if (chainId !== ROBINHOOD.chainId) {
    throw new TypeError(`chainId must be ${ROBINHOOD.chainId}`);
  }
  if (!OPPORTUNITY_TYPES.includes(input.opportunityType)) {
    throw new TypeError("unsupported opportunityType");
  }
  const collection = normalizeAddress(input.collection, "collection");
  const currency = normalizeAddress(
    input.currency ?? "0x0000000000000000000000000000000000000000",
    "currency",
  );
  const tokenId = amount(input.tokenId ?? 0, "tokenId");
  const discoveredAt = new Date(input.discoveredAt ?? now);
  if (Number.isNaN(discoveredAt.getTime())) throw new TypeError("invalid discoveredAt");
  const riskLabel = input.riskLabel ?? "UNKNOWN";
  if (!RISK_LABELS.has(riskLabel)) throw new TypeError("invalid riskLabel");
  const recommendation = input.recommendation ?? "RESEARCH";
  if (!RECOMMENDATIONS.has(recommendation)) throw new TypeError("invalid recommendation");

  return Object.freeze({
    id: String(input.id ?? assetKey(chainId, collection, tokenId)),
    chainId,
    collection,
    tokenId,
    source: String(input.source ?? "UNVERIFIED"),
    opportunityType: input.opportunityType,
    creator: input.creator ? normalizeAddress(input.creator, "creator") : null,
    mintPrice: amount(input.mintPrice ?? 0, "mintPrice"),
    salePrice: amount(input.salePrice ?? 0, "salePrice"),
    currency,
    totalSupply: nonNegativeInteger(input.totalSupply ?? 0, "totalSupply"),
    mintedSupply: nonNegativeInteger(input.mintedSupply ?? 0, "mintedSupply"),
    holderCount: nonNegativeInteger(input.holderCount ?? 0, "holderCount"),
    marketplace: input.marketplace
      ? normalizeAddress(input.marketplace, "marketplace")
      : null,
    discoveredAt: discoveredAt.toISOString(),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    artScore: finiteScore(input.artScore ?? 0, "artScore"),
    marketScore: finiteScore(input.marketScore ?? 0, "marketScore"),
    creatorScore: finiteScore(input.creatorScore ?? 0, "creatorScore"),
    liquidityScore: finiteScore(input.liquidityScore ?? 0, "liquidityScore"),
    contractRiskScore: finiteScore(input.contractRiskScore ?? 100, "contractRiskScore"),
    tasteMatch: finiteScore(input.tasteMatch ?? 0, "tasteMatch"),
    collectionScore: finiteScore(input.collectionScore ?? 0, "collectionScore"),
    confidence: finiteScore(input.confidence ?? 0, "confidence"),
    riskLabel,
    recommendation,
  });
}
