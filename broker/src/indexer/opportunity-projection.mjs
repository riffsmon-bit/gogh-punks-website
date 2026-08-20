import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import {
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
} from "../discovery/onchain-events.mjs";
import { decodeSeaportActivityLog } from "../discovery/seaport-activity.mjs";
import { normalizeOpportunity } from "../opportunity.mjs";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const ADDRESS_TOPIC_PATTERN = /^0x0{24}[0-9a-f]{40}$/i;
const DATA_WORD_PATTERN = /^[0-9a-f]{64}$/i;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function logIndex(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

function topicAddress(value) {
  if (typeof value !== "string" || !ADDRESS_TOPIC_PATTERN.test(value)) return null;
  try {
    return normalizeAddress(`0x${value.slice(-40)}`);
  } catch {
    return null;
  }
}

function uintWord(value) {
  if (typeof value !== "string" || !DATA_WORD_PATTERN.test(value)) return null;
  try {
    return BigInt(`0x${value}`).toString();
  } catch {
    return null;
  }
}

function decodeTransferMint(record, discoveredAt) {
  if (!Array.isArray(record?.topics) || record.topics.length !== 4) return null;
  if (
    typeof record.transactionHash !== "string"
    || !HASH_PATTERN.test(record.transactionHash)
  ) return null;

  let collection;
  try {
    collection = normalizeAddress(record.address, "mint collection");
  } catch {
    return null;
  }
  if (collection === ZERO_ADDRESS) return null;

  const signature = String(record.topics[0]).toLowerCase();
  const index = logIndex(record.logIndex);
  if (index === null) return null;

  let from;
  let to;
  let tokenId;
  let assetAmount;
  let assetStandard;
  let operator = null;
  if (signature === TRANSFER_TOPIC) {
    // Exact ERC-721 Transfer layout. ERC-20 Transfer logs have only three topics.
    if (record.data !== "0x") return null;
    from = topicAddress(record.topics[1]);
    to = topicAddress(record.topics[2]);
    tokenId = uintWord(String(record.topics[3]).slice(2));
    assetAmount = "1";
    assetStandard = "ERC721";
  } else if (signature === TRANSFER_SINGLE_TOPIC) {
    // Exact ERC-1155 TransferSingle layout: operator/from/to plus id and amount.
    operator = topicAddress(record.topics[1]);
    from = topicAddress(record.topics[2]);
    to = topicAddress(record.topics[3]);
    const dataMatch = typeof record.data === "string"
      ? record.data.match(/^0x([0-9a-f]{64})([0-9a-f]{64})$/i)
      : null;
    if (!operator || operator === ZERO_ADDRESS || !dataMatch) return null;
    tokenId = uintWord(dataMatch[1]);
    assetAmount = uintWord(dataMatch[2]);
    assetStandard = "ERC1155";
  } else {
    return null;
  }

  // A mint is the only transfer signal projected here. Burns, ordinary
  // transfers, zero-value editions, and malformed address topics fail closed.
  if (
    !from || !to || tokenId === null || assetAmount === null
    || from !== ZERO_ADDRESS || to === ZERO_ADDRESS || BigInt(assetAmount) === 0n
  ) return null;

  const transactionHash = record.transactionHash.toLowerCase();
  const blockNumber = BigInt(record.blockNumber).toString();
  const opportunity = normalizeOpportunity({
    id: `${ROBINHOOD.chainId}:transfer-mint:${transactionHash}:${index}`,
    chainId: ROBINHOOD.chainId,
    collection,
    tokenId,
    opportunityType: assetStandard === "ERC721" ? "MINT" : "EDITION",
    source: "ROBINHOOD_NFT_TRANSFER_MINT",
    discoveredAt,
    metadata: {
      transactionHash,
      blockNumber,
      logIndex: index,
      observedTransfer: true,
      mintSignal: true,
      priceObserved: false,
      mintPriceStatus: "UNKNOWN",
      actionableMint: false,
      assetStandard,
      assetAmount,
      operator,
      from,
      to,
    },
    riskLabel: "UNKNOWN",
    recommendation: "RESEARCH",
  }, discoveredAt);

  return Object.freeze({ opportunity, collection, assetStandard, transactionHash });
}

function pendingAnalysisStatus() {
  return Object.freeze({
    art: "PENDING",
    taste: "PENDING",
    creator: "PENDING",
    market: "PENDING",
    liquidity: "PENDING",
    collection: "PENDING",
    contract: "PENDING",
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

  if (stream === "nft_transfers") {
    let decoded;
    try {
      decoded = decodeTransferMint(record, sourceBlockTimestamp);
    } catch {
      return null;
    }
    if (!decoded) return null;
    const { opportunity } = decoded;
    const metadata = Object.freeze({
      ...opportunity.metadata,
      recommendation: opportunity.recommendation,
      indexedAt: indexedAt.toISOString(),
      sourceBlockTimestamp: sourceBlockTimestamp.toISOString(),
      analysisStatus: pendingAnalysisStatus(),
    });
    return Object.freeze({
      collection: Object.freeze({
        chainId: opportunity.chainId,
        address: decoded.collection,
        standard: decoded.assetStandard,
        firstSeenBlock: sourceBlockNumber.toString(),
        evidence: Object.freeze({
          mintTransferObserved: true,
          readOnlyScoutSource: true,
          sourceTransactionHash: decoded.transactionHash,
        }),
      }),
      opportunity: Object.freeze({
        ...opportunity,
        // A zero here means no price was observed, never a free or executable mint.
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
        sourceTransactionHash: decoded.transactionHash,
        sourceLogIndex: logIndex(record.logIndex),
      }),
    });
  }

  if (stream !== "seaport_activity") return null;
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
    analysisStatus: pendingAnalysisStatus(),
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
