import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { TRANSFER_TOPIC } from "../discovery/onchain-events.mjs";

const ADDRESS_TOPIC = /^0x0{24}[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_PUNK_TOKEN_ID = 5_016n;

function topicAddress(value) {
  if (typeof value !== "string" || !ADDRESS_TOPIC.test(value)) return null;
  try {
    return normalizeAddress(`0x${value.slice(-40)}`);
  } catch {
    return null;
  }
}

function recordAddress(value) {
  try {
    return normalizeAddress(value);
  } catch {
    return null;
  }
}

function boundedInteger(value, maximum = 9_223_372_036_854_775_807n) {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= maximum ? parsed : null;
  } catch {
    return null;
  }
}

// Canonical collection Transfer logs are ownership state, not Scout opportunities. Keeping this
// projection separate prevents a discovery-ranking change from ever filtering the owner roster.
export function projectPunkOwnershipTransfer({ chainId, stream, record }) {
  if (Number(chainId) !== ROBINHOOD.chainId || stream !== "gogh_punk_transfers"
    || typeof record !== "object" || record === null
    || recordAddress(record.address) !== ROBINHOOD.canonicalCollection
    || !Array.isArray(record.topics) || record.topics.length !== 4
    || record.topics[0]?.toLowerCase() !== TRANSFER_TOPIC
    || record.data !== "0x" || !HASH.test(record.blockHash ?? "")
    || !HASH.test(record.transactionHash ?? "")) return null;

  const from = topicAddress(record.topics[1]);
  const to = topicAddress(record.topics[2]);
  const tokenId = boundedInteger(record.topics[3], MAX_PUNK_TOKEN_ID);
  const blockNumber = boundedInteger(record.blockNumber);
  const logIndex = boundedInteger(record.logIndex, BigInt(Number.MAX_SAFE_INTEGER));
  if (!from || !to || tokenId === null || blockNumber === null || logIndex === null
    || (from === ZERO_ADDRESS && to === ZERO_ADDRESS)) return null;

  return Object.freeze({
    kind: "PUNK_OWNERSHIP_TRANSFER",
    collection: ROBINHOOD.canonicalCollection,
    tokenId: tokenId.toString(),
    from: from === ZERO_ADDRESS ? null : from,
    owner: to === ZERO_ADDRESS ? null : to,
    blockNumber: blockNumber.toString(),
    logIndex: Number(logIndex),
  });
}
