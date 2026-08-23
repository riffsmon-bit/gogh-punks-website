import { createHash } from "node:crypto";

import { decodeEventLog, parseAbiItem, toEventSelector } from "viem";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";
import { SEA_DROP } from "../recommendation/automated-seadrop-run-plan.mjs";

export const SEADROP_HINT_INDEX_SCHEMA = "GOGH_SEADROP_PUBLIC_DROP_HINT_INDEX_V1";
export const PUBLIC_DROP_UPDATED_EVENT = parseAbiItem(
  "event PublicDropUpdated(address indexed nftContract, (uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients) publicDrop)",
);
const TOPIC = toEventSelector(PUBLIC_DROP_UPDATED_EVENT);
const MAX_LOGS = 10_000;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch {
    fail("INVALID_JSON", `${label} must be strict canonical JSON`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} has an unsupported field set`);
  }
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical decimal string`);
  }
  return BigInt(value);
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) fail("INVALID_HASH", `${label} must be a nonzero lowercase hash`);
  return value;
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    || /^0x0{40}$/i.test(value)) fail("INVALID_ADDRESS", `${label} must be a nonzero address`);
  return value.toLowerCase();
}

function sha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function order(left, right) {
  const block = decimal(left.blockNumber, "blockNumber") - decimal(right.blockNumber, "blockNumber");
  if (block !== 0n) return block < 0n ? -1 : 1;
  return left.transactionIndex - right.transactionIndex || left.logIndex - right.logIndex;
}

function normalizeLog(value, index, fromBlock, confirmedBlock) {
  const label = `logs[${index}]`;
  exactKeys(value, [
    "address", "blockNumber", "blockHash", "transactionHash", "transactionIndex",
    "logIndex", "removed", "topics", "data",
  ], label);
  if (address(value.address, `${label}.address`) !== SEA_DROP) fail("WRONG_EMITTER", "wrong SeaDrop emitter");
  const blockNumber = decimal(value.blockNumber, `${label}.blockNumber`);
  if (blockNumber < fromBlock || blockNumber > confirmedBlock) fail("OUT_OF_RANGE", `${label} is outside the scan range`);
  hash(value.blockHash, `${label}.blockHash`);
  hash(value.transactionHash, `${label}.transactionHash`);
  if (!Number.isSafeInteger(value.transactionIndex) || value.transactionIndex < 0
    || !Number.isSafeInteger(value.logIndex) || value.logIndex < 0
    || value.removed !== false || !Array.isArray(value.topics) || value.topics.length !== 2
    || value.topics[0] !== TOPIC || typeof value.data !== "string"
    || !/^0x(?:[0-9a-f]{2})*$/.test(value.data)) {
    fail("INVALID_LOG", `${label} is malformed or removed`);
  }
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: [PUBLIC_DROP_UPDATED_EVENT], data: value.data, topics: value.topics, strict: true,
    });
  } catch {
    fail("INVALID_LOG", `${label} does not decode as PublicDropUpdated`);
  }
  if (decoded.eventName !== "PublicDropUpdated") fail("INVALID_LOG", `${label} event is wrong`);
  return {
    ...value,
    collection: address(decoded.args.nftContract, `${label}.collection`),
    drop: {
      mintPriceWei: decoded.args.publicDrop.mintPrice.toString(),
      startTime: decoded.args.publicDrop.startTime.toString(),
      endTime: decoded.args.publicDrop.endTime.toString(),
      maxTotalMintableByWallet: decoded.args.publicDrop.maxTotalMintableByWallet.toString(),
      feeBps: Number(decoded.args.publicDrop.feeBps),
      restrictFeeRecipients: decoded.args.publicDrop.restrictFeeRecipients,
    },
  };
}

export function buildSeaDropPublicDropHintIndex(logValues, optionValue) {
  const logs = snapshot(logValues, "logs");
  const options = snapshot(optionValue, "options");
  if (!Array.isArray(logs) || logs.length > MAX_LOGS) fail("INVALID_LOGS", `logs must contain at most ${MAX_LOGS} entries`);
  exactKeys(options, [
    "chainId", "fromBlock", "confirmedBlock", "confirmedBlockHash", "confirmedBlockTimestamp",
    "checkedAt", "sourceOrigin",
  ], "options");
  if (options.chainId !== 4663 || options.sourceOrigin !== "https://rpc.mainnet.chain.robinhood.com") {
    fail("WRONG_SOURCE", "hint indexing is fixed to the public official Robinhood RPC");
  }
  const fromBlock = decimal(options.fromBlock, "fromBlock");
  const confirmedBlock = decimal(options.confirmedBlock, "confirmedBlock");
  const confirmedBlockTimestamp = decimal(options.confirmedBlockTimestamp, "confirmedBlockTimestamp");
  if (fromBlock > confirmedBlock || confirmedBlock - fromBlock > 100_000n) {
    fail("INVALID_RANGE", "hint range must contain at most 100,000 confirmed blocks");
  }
  hash(options.confirmedBlockHash, "confirmedBlockHash");
  const checkedAtMs = Date.parse(options.checkedAt);
  if (!Number.isFinite(checkedAtMs) || new Date(checkedAtMs).toISOString() !== options.checkedAt) {
    fail("INVALID_TIME", "checkedAt must be canonical UTC ISO");
  }
  const normalized = logs.map((value, index) => normalizeLog(value, index, fromBlock, confirmedBlock));
  normalized.sort(order);
  const latest = new Map();
  for (const log of normalized) latest.set(log.collection, log);
  const candidates = [...latest.values()].filter((log) => (
    log.drop.mintPriceWei === "0"
      && decimal(log.drop.startTime, "drop.startTime") <= confirmedBlockTimestamp
      && decimal(log.drop.endTime, "drop.endTime") >= confirmedBlockTimestamp
      && decimal(log.drop.maxTotalMintableByWallet, "drop.maxTotalMintableByWallet") > 0n
  )).map((log) => Object.freeze({
    collection: log.collection,
    updateBlockNumber: log.blockNumber,
    updateBlockHash: log.blockHash,
    updateTransactionHash: log.transactionHash,
    drop: log.drop,
  }));
  const index = {
    schema: SEADROP_HINT_INDEX_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt: options.checkedAt,
    range: {
      fromBlock: fromBlock.toString(), confirmedBlock: confirmedBlock.toString(),
      confirmedBlockHash: options.confirmedBlockHash,
      confirmedBlockTimestamp: confirmedBlockTimestamp.toString(),
    },
    source: {
      origin: options.sourceOrigin,
      authoritativeExecutionEvidence: false,
      purpose: "DISCOVERY_HINTS_ONLY",
    },
    logCount: normalized.length,
    uniqueUpdatedCollections: latest.size,
    candidates,
    safety: {
      submissionPerformed: false,
      chainStateWritten: false,
      signingPerformed: false,
      candidatesAuthorized: false,
      mandatoryNextGate:
        "DUAL_RPC_RUNTIME_DROP_STATS_POLICY_FEE_RECIPIENT_AND_ACCOUNT_SIMULATION",
    },
  };
  return Object.freeze({ ...index, indexHash: sha256(index) });
}
