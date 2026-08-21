import { decodeEventLog, toEventSelector } from "viem";
import { OPPORTUNITY_TYPES, ROBINHOOD, normalizeAddress } from "../config.mjs";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const WORD_PATTERN = /^[0-9a-f]{64}$/i;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ASSET_STANDARDS = Object.freeze(["ERC721", "ERC1155"]);

export const ACCOUNT_ACTIVATION_EVENT_ABI = Object.freeze({
  type: "event",
  name: "GoghPunkAccountActivated",
  anonymous: false,
  inputs: Object.freeze([
    { name: "account", type: "address", indexed: true },
    { name: "chainId", type: "uint256", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "owner", type: "address", indexed: false },
    { name: "implementation", type: "address", indexed: false },
    { name: "implementationVersion", type: "uint256", indexed: false },
  ]),
});

export const ACCOUNT_ACQUISITION_EVENT_ABI = Object.freeze({
  type: "event",
  name: "AcquisitionExecuted",
  anonymous: false,
  inputs: Object.freeze([
    { name: "executor", type: "address", indexed: true },
    { name: "opportunityId", type: "bytes32", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "opportunityType", type: "uint8", indexed: false },
    { name: "assetStandard", type: "uint8", indexed: false },
    { name: "adapter", type: "address", indexed: false },
    { name: "venue", type: "address", indexed: false },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "assetAmount", type: "uint256", indexed: false },
    { name: "currency", type: "address", indexed: false },
    { name: "price", type: "uint256", indexed: false },
    { name: "ownerApproved", type: "bool", indexed: false },
    { name: "reasoningHash", type: "bytes32", indexed: false },
    { name: "policyVersion", type: "uint64", indexed: false },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "state", type: "uint256", indexed: false },
  ]),
});

export const ACCOUNT_ACTIVATION_TOPIC = toEventSelector(ACCOUNT_ACTIVATION_EVENT_ABI);
export const ACCOUNT_ACQUISITION_TOPIC = toEventSelector(ACCOUNT_ACQUISITION_EVENT_ABI);

function staticWords(data, expectedCount) {
  if (typeof data !== "string" || data.length !== 2 + expectedCount * 64) return null;
  const payload = data.slice(2);
  if (!/^[0-9a-f]+$/i.test(payload)) return null;
  return Array.from({ length: expectedCount }, (_, index) => (
    payload.slice(index * 64, (index + 1) * 64)
  ));
}

function uintWord(word, bits = 256) {
  if (!WORD_PATTERN.test(word ?? "")) return null;
  try {
    const value = BigInt(`0x${word}`);
    if (bits < 256 && value >= 1n << BigInt(bits)) return null;
    return value;
  } catch {
    return null;
  }
}

function addressWord(word, { allowZero = false } = {}) {
  if (!/^0{24}[0-9a-f]{40}$/i.test(word ?? "")) return null;
  try {
    const value = normalizeAddress(`0x${word.slice(24)}`);
    return allowZero || value !== ZERO_ADDRESS ? value : null;
  } catch {
    return null;
  }
}

function topicAddress(topic, options) {
  return typeof topic === "string" && HASH_PATTERN.test(topic)
    ? addressWord(topic.slice(2), options)
    : null;
}

function strictTopics(record, signature) {
  if (!Array.isArray(record?.topics) || record.topics.length !== 4) return null;
  if (!record.topics.every((topic) => typeof topic === "string" && HASH_PATTERN.test(topic))) {
    return null;
  }
  return record.topics[0].toLowerCase() === signature ? record.topics : null;
}

function decode(abi, record) {
  try {
    const decoded = decodeEventLog({
      abi: [abi],
      data: record.data,
      topics: record.topics,
      strict: true,
    });
    return decoded.eventName === abi.name ? decoded.args : null;
  } catch {
    return null;
  }
}

export function decodeAccountActivationLog(record) {
  const topics = strictTopics(record, ACCOUNT_ACTIVATION_TOPIC);
  const words = staticWords(record?.data, 4);
  if (!topics || !words) return null;

  const account = topicAddress(topics[1]);
  const chainId = uintWord(topics[2].slice(2));
  const collection = topicAddress(topics[3]);
  const tokenId = uintWord(words[0]);
  const owner = addressWord(words[1]);
  const implementation = addressWord(words[2]);
  const implementationVersion = uintWord(words[3]);
  if (
    !account || chainId !== BigInt(ROBINHOOD.chainId)
    || collection !== ROBINHOOD.canonicalCollection || tokenId === null
    || !owner || !implementation || implementationVersion !== 1n
  ) return null;

  const args = decode(ACCOUNT_ACTIVATION_EVENT_ABI, record);
  if (!args) return null;
  return Object.freeze({
    account,
    chainId: chainId.toString(),
    collection,
    tokenId: tokenId.toString(),
    owner,
    implementation,
    implementationVersion: implementationVersion.toString(),
  });
}

export function decodeAccountAcquisitionLog(record) {
  const topics = strictTopics(record, ACCOUNT_ACQUISITION_TOPIC);
  const words = staticWords(record?.data, 13);
  if (!topics || !words) return null;

  const executor = topicAddress(topics[1]);
  const opportunityId = topics[2].toLowerCase();
  const collection = topicAddress(topics[3]);
  const opportunityTypeIndex = uintWord(words[0], 8);
  const assetStandardIndex = uintWord(words[1], 8);
  const adapter = addressWord(words[2]);
  const venue = addressWord(words[3]);
  const tokenId = uintWord(words[4]);
  const assetAmount = uintWord(words[5]);
  const currency = addressWord(words[6], { allowZero: true });
  const price = uintWord(words[7]);
  const ownerApprovedWord = uintWord(words[8], 8);
  const reasoningHash = `0x${words[9].toLowerCase()}`;
  const policyVersion = uintWord(words[10], 64);
  const nonce = uintWord(words[11]);
  const state = uintWord(words[12]);
  const opportunityType = OPPORTUNITY_TYPES[Number(opportunityTypeIndex)];
  const assetStandard = ASSET_STANDARDS[Number(assetStandardIndex)];
  if (
    !executor || opportunityId === ZERO_HASH || !collection
    || opportunityTypeIndex === null || assetStandardIndex === null
    || !opportunityType || !assetStandard || !adapter || !venue
    || tokenId === null || assetAmount === null || assetAmount === 0n || currency === null
    || price === null || (ownerApprovedWord !== 0n && ownerApprovedWord !== 1n)
    || reasoningHash === ZERO_HASH || policyVersion === null || nonce === null || state === null
    || (assetStandard === "ERC721" && assetAmount !== 1n)
  ) return null;

  const args = decode(ACCOUNT_ACQUISITION_EVENT_ABI, record);
  if (!args) return null;
  const ownerApproved = ownerApprovedWord === 1n;
  return Object.freeze({
    executor,
    opportunityId,
    collection,
    opportunityType,
    assetStandard,
    adapter,
    venue,
    tokenId: tokenId.toString(),
    assetAmount: assetAmount.toString(),
    currency,
    price: price.toString(),
    ownerApproved,
    acquisitionMode: ownerApproved ? "OWNER_APPROVED" : "AUTONOMOUS",
    agent: ownerApproved ? null : executor,
    reasoningHash,
    policyVersion: policyVersion.toString(),
    nonce: nonce.toString(),
    state: state.toString(),
  });
}

function provenance(chainId, record) {
  try {
    if (BigInt(chainId) !== BigInt(ROBINHOOD.chainId)) return null;
    const account = normalizeAddress(record.address, "event emitter");
    if (account === ZERO_ADDRESS || !HASH_PATTERN.test(record.transactionHash ?? "")
      || !HASH_PATTERN.test(record.blockHash ?? "")) return null;
    const blockNumber = BigInt(record.blockNumber);
    const blockTimestamp = BigInt(record.blockTimestamp);
    const logIndex = BigInt(record.logIndex);
    if (
      blockNumber < 0n || blockTimestamp < 0n || logIndex < 0n
      || logIndex > BigInt(Number.MAX_SAFE_INTEGER)
      || blockTimestamp > BigInt(Number.MAX_SAFE_INTEGER)
    ) return null;
    const occurredAt = new Date(Number(blockTimestamp) * 1_000);
    if (Number.isNaN(occurredAt.getTime())) return null;
    return Object.freeze({
      account,
      transactionHash: record.transactionHash.toLowerCase(),
      blockNumber: blockNumber.toString(),
      blockHash: record.blockHash.toLowerCase(),
      blockTimestamp: blockTimestamp.toString(),
      occurredAt: occurredAt.toISOString(),
      logIndex: Number(logIndex),
    });
  } catch {
    return null;
  }
}

export function projectBrokerAccountLog({
  chainId,
  stream,
  record,
  expectedEmitter = null,
  expectedImplementation = null,
}) {
  const source = provenance(chainId, record);
  if (!source) return null;

  if (stream === "account_activations") {
    let emitter;
    try {
      emitter = normalizeAddress(expectedEmitter, "account activation emitter");
    } catch {
      return null;
    }
    if (source.account !== emitter) return null;
    const activation = decodeAccountActivationLog(record);
    if (activation && expectedImplementation !== null) {
      try {
        if (activation.implementation !== normalizeAddress(
          expectedImplementation,
          "account activation implementation",
        )) return null;
      } catch {
        return null;
      }
    }
    return activation
      ? Object.freeze({ kind: "ACCOUNT_ACTIVATION", ...source, ...activation })
      : null;
  }

  if (stream === "account_acquisitions") {
    const acquisition = decodeAccountAcquisitionLog(record);
    return acquisition
      ? Object.freeze({ kind: "ACCOUNT_ACQUISITION", ...source, ...acquisition })
      : null;
  }
  return null;
}
