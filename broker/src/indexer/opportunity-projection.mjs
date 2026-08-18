import { ROBINHOOD } from "../config.mjs";
import { decodeSeaportActivityLog } from "../discovery/seaport-activity.mjs";
import { normalizeOpportunity } from "../opportunity.mjs";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;

function scoreSnapshot(opportunity) {
  return Object.freeze({
    artScore: opportunity.artScore,
    marketScore: opportunity.marketScore,
    creatorScore: opportunity.creatorScore,
    liquidityScore: opportunity.liquidityScore,
    contractRiskScore: opportunity.contractRiskScore,
    tasteMatch: opportunity.tasteMatch,
    collectionScore: opportunity.collectionScore,
  });
}

/**
 * Convert confirmed raw indexer logs into rebuildable Scout projections.
 * A completed marketplace settlement is historical evidence only: it never
 * creates an executable quote, proposal, approval, or autonomous permission.
 */
export function projectScoutLog({ chainId, stream, record, observedAt = new Date() }) {
  try {
    if (BigInt(chainId) !== BigInt(ROBINHOOD.chainId)) return null;
  } catch {
    return null;
  }
  if (stream !== "seaport_activity") return null;
  if (!HASH_PATTERN.test(record?.blockHash ?? "")) return null;

  let sourceBlockNumber;
  let sourceBlockTimestamp;
  try {
    sourceBlockNumber = BigInt(record.blockNumber);
    if (sourceBlockNumber < 0n) return null;
    const timestampSeconds = BigInt(record.blockTimestamp);
    if (timestampSeconds < 0n || timestampSeconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    sourceBlockTimestamp = new Date(Number(timestampSeconds) * 1_000);
    if (Number.isNaN(sourceBlockTimestamp.getTime())) return null;
  } catch {
    return null;
  }

  const indexedAt = new Date(observedAt);
  if (Number.isNaN(indexedAt.getTime())) return null;
  const decoded = decodeSeaportActivityLog(record, sourceBlockTimestamp);
  if (!decoded) return null;
  const opportunity = normalizeOpportunity(decoded, observedAt);
  if (
    opportunity.metadata.historicalSaleSignal !== true
    || opportunity.metadata.actionableListing !== false
    || opportunity.recommendation !== "RESEARCH"
  ) return null;

  const metadata = Object.freeze({
    ...opportunity.metadata,
    historicalSalePrice: opportunity.salePrice,
    historicalSaleCurrency: opportunity.currency,
    recommendation: opportunity.recommendation,
    indexedAt: indexedAt.toISOString(),
    sourceBlockTimestamp: sourceBlockTimestamp.toISOString(),
    analysisStatus: Object.freeze({
      art: "PENDING",
      taste: "PENDING",
      creator: "PENDING",
      market: "PENDING",
      liquidity: "PENDING",
      collection: "PENDING",
      contract: "PENDING",
    }),
  });

  return Object.freeze({
    collection: Object.freeze({
      chainId: opportunity.chainId,
      address: opportunity.collection,
      standard: opportunity.metadata.assetStandard,
      firstSeenBlock: sourceBlockNumber.toString(),
      evidence: Object.freeze({
        seaportSettlementObserved: true,
        readOnlyScoutSource: true,
        sourceTransactionHash: opportunity.metadata.transactionHash,
      }),
    }),
    opportunity: Object.freeze({
      ...opportunity,
      // Historical settlement prices are evidence, not active executable quotes.
      expectedPrice: "0",
      maximumPrice: "0",
      supply: Object.freeze({
        totalSupply: opportunity.totalSupply,
        mintedSupply: opportunity.mintedSupply,
        holderCount: opportunity.holderCount,
      }),
      scores: scoreSnapshot(opportunity),
      metadata,
      scoutable: true,
      autonomousExecutionEligible: false,
      canonical: true,
      sourceBlockNumber: sourceBlockNumber.toString(),
      sourceBlockHash: record.blockHash.toLowerCase(),
      sourceBlockTimestamp: sourceBlockTimestamp.toISOString(),
      sourceTransactionHash: opportunity.metadata.transactionHash,
      sourceLogIndex: opportunity.metadata.logIndex,
    }),
  });
}
