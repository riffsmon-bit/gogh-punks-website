import { createHash } from "node:crypto";
import { decodeEventLog, keccak256 } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { LIVE_APPROVAL_PREFLIGHT_ABIS } from "./canary-approval-live-preflight.mjs";
import { validateCanaryMintRpcDependencies } from "./canary-mint-rpc-helper.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const EXPECTED_POLICY_VERSION = 20n;
const EXPECTED_PERMISSION_GENERATION = 1n;
const EXPECTED_ACQUISITION_NONCE = 1n;
const EXPECTED_ACCOUNT_STATE = 2n;
const MAX_TEARDOWN_AGE_SECONDS = 6 * 60 * 60;
const MAX_LATEST_BLOCK_AGE_SECONDS = 5 * 60;
const MAX_HEAD_SKEW = 3n;
const TEARDOWN_CALL_COUNT = 11;
const ONE_SHOT_MINT_SELECTOR = "0x40c10f19";
const EXPECTED_TEARDOWN_IDS = Object.freeze([
  "TEARDOWN_GUARDIAN_01_DISABLE_APPROVAL_PURCHASES",
  "TEARDOWN_OWNER_01_PAUSE_ACCOUNT",
  "TEARDOWN_OWNER_02_CONFIGURE_DISABLED",
  "TEARDOWN_GUARDIAN_02_DISABLE_ADAPTER",
  "TEARDOWN_OWNER_03_DISABLE_ALL_MINT_CONTROLS",
  "TEARDOWN_OWNER_04_DENY_SELECTOR",
  "TEARDOWN_OWNER_05_REVOKE_ADAPTER",
  "TEARDOWN_OWNER_06_REVOKE_MINT_VENUE",
  "TEARDOWN_OWNER_07_DENY_COLLECTION",
  "TEARDOWN_OWNER_08_DISABLE_CURRENCY",
  "TEARDOWN_OWNER_09_KEEP_ZERO_VENUE_MAXIMUM",
]);
const EXPECTED_TEARDOWN_FUNCTIONS = Object.freeze([
  "setFeatureFlags", "setAccountPaused", "configurePolicy", "setAdapterActive",
  "setMintControls", "setSelectorPermission", "setAdapterPermission", "setVenuePermission",
  "setCollectionPermission", "setCurrencyPolicy", "setVenueCurrencyMaximum",
]);
const EIP1967_SLOTS = Object.freeze({
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
});

export const CANARY_FINAL_TEARDOWN_ATTESTATION_SCHEMA =
  "GOGH_OWNER_DIRECT_CANARY_FINAL_TEARDOWN_ATTESTATION_V1";
export const CANARY_FINAL_TEARDOWN_PASS = "READ_ONLY_FINAL_TEARDOWN_PASS";
export const DEFAULT_CANARY_TEARDOWN_CONFIRMATIONS = 20;

const {
  ownerAbi,
  punkAbi,
  accountRegistryAbi,
  canonicalRegistryAbi,
  accountAbi,
  policyAbi,
  adapterRegistryAbi,
  agentRegistryAbi,
  mintAdapterAbi,
  policyMutationEventAbi,
  adapterMutationEventAbi,
  agentMutationEventAbi,
  accountActivityEventAbi,
  punkTransferEvent,
} = LIVE_APPROVAL_PREFLIGHT_ABIS;

const erc721Abi = [{
  type: "function", name: "ownerOf", stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }],
}, {
  type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
}, {
  type: "function", name: "getApproved", stateMutability: "view",
  inputs: [{ type: "uint256" }], outputs: [{ type: "address" }],
}, {
  type: "function", name: "isApprovedForAll", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }],
}, {
  type: "function", name: "minted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }],
}];

export class CanaryTeardownFinalAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryTeardownFinalAttestationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryTeardownFinalAttestationError(
    code,
    `READ-ONLY final teardown attestation failed: ${message}`,
  );
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} has an unsafe number`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("INVALID_SCHEMA", `${label} is not acyclic JSON data`);
  }
  seen.add(value);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_SCHEMA", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("INVALID_SCHEMA", `${label} has a symbol field`);
  }
  if (isArray) {
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      fail("INVALID_SCHEMA", `${label} has an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
    }
  }
  for (const key of keys) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label}.${key} is not enumerable data`);
    }
    assertJsonData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalRpcValue(value, label, seen = new Set()) {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `bigint:${value}`;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return canonicalJson(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_RPC_RESPONSE", `${label} has an unsafe number`);
    return `number:${value}`;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not acyclic RPC data`);
  }
  seen.add(value);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_RPC_RESPONSE", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("INVALID_RPC_RESPONSE", `${label} has a symbol field`);
  }
  if (isArray) {
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      fail("INVALID_RPC_RESPONSE", `${label} has an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_RPC_RESPONSE", `${label} has an array hole`);
    }
  }
  const parts = keys.filter((key) => key !== "length").sort().map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_RPC_RESPONSE", `${label}.${key} is not enumerable data`);
    }
    return `${JSON.stringify(key)}:${canonicalRpcValue(descriptor.value, `${label}.${key}`, seen)}`;
  });
  seen.delete(value);
  return isArray ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
}

function snapshot(value, label) {
  assertJsonData(value, label);
  let copy;
  try {
    copy = structuredClone(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} may not contain a Proxy`);
  }
  assertJsonData(copy, `${label} snapshot`);
  const encoded = canonicalJson(copy);
  if (Buffer.byteLength(encoded, "utf8") > 8_000_000) {
    fail("INVALID_SCHEMA", `${label} exceeds its canonical size limit`);
  }
  return JSON.parse(encoded);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} fields do not match the canonical schema`);
  }
}

function address(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is not an address`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function bytes32(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} is not bytes32`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_WORD) fail("INVALID_HASH", `${label} is zero`);
  return normalized;
}

function uint(value, label) {
  if ((typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    && !(typeof value === "bigint" && value >= 0n)) {
    fail("INVALID_INTEGER", `${label} is not an unsigned integer`);
  }
  return BigInt(value);
}

function same(actual, expected, code, label) {
  const left = typeof actual === "bigint" ? actual.toString()
    : typeof actual === "string" ? actual.toLowerCase() : actual;
  const right = typeof expected === "bigint" ? expected.toString()
    : typeof expected === "string" ? expected.toLowerCase() : expected;
  if (left !== right) fail(code, `${label} does not match`);
}

function field(value, name, index) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  if (Object.hasOwn(value, name)) return value[name];
  if (Object.hasOwn(value, index)) return value[index];
  return undefined;
}

function requireTuple(value, expected, label) {
  for (const [name, index, wanted] of expected) {
    same(field(value, name, index), wanted, "FINAL_STATE_MISMATCH", `${label}.${name}`);
  }
}

function rpcUint(value, label) {
  if ((typeof value !== "bigint" || value < 0n)
    && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not an unsigned RPC integer`);
  }
  return BigInt(value);
}

function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateCanaryFinalTeardownTiming({
  nowSeconds,
  mintBlockTimestamp,
  latestBlockTimestamp,
}) {
  const now = uint(nowSeconds, "timing nowSeconds");
  const mint = uint(mintBlockTimestamp, "timing mintBlockTimestamp");
  const latest = uint(latestBlockTimestamp, "timing latestBlockTimestamp");
  if (now < mint || now - mint > BigInt(MAX_TEARDOWN_AGE_SECONDS)) {
    fail("STALE_TEARDOWN", "real time is outside the six-hour canary teardown window");
  }
  if (latest < mint || latest > now + 30n
    || (now > latest && now - latest > BigInt(MAX_LATEST_BLOCK_AGE_SECONDS))) {
    fail("STALE_TEARDOWN", "latest common block is stale, predates mint, or is in the future");
  }
  return Object.freeze({ now, mint, latest });
}

function clientIdentity(client) {
  if (!client || typeof client !== "object") return undefined;
  const ownData = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
  };
  const transport = ownData(client, "transport");
  if (transport && typeof transport === "object") {
    const direct = ownData(transport, "url");
    if (direct !== undefined) return direct;
    const nested = ownData(transport, "value");
    if (nested && typeof nested === "object") {
      const url = ownData(nested, "url");
      if (url !== undefined) return url;
    }
  }
  return ownData(client, "name") ?? ownData(client, "uid");
}

function assertClient(client, label) {
  for (const method of [
    "getChainId", "getBlockNumber", "getBlock", "getCode", "getStorageAt", "readContract",
    "getTransaction", "getTransactionReceipt", "getLogs",
  ]) {
    if (typeof client?.[method] !== "function") fail("INVALID_CLIENT", `${label}.${method} is required`);
  }
}

async function dual(label, primaryClient, secondaryClient, operation) {
  let primary;
  let secondary;
  try {
    [primary, secondary] = await Promise.all([
      operation(primaryClient), operation(secondaryClient),
    ]);
  } catch (error) {
    fail("LIVE_READ_FAILED", `${label}: ${error?.shortMessage ?? error?.message ?? "read failed"}`);
  }
  if (canonicalRpcValue(primary, `${label}.primary`)
    !== canonicalRpcValue(secondary, `${label}.secondary`)) {
    fail("RPC_DISAGREEMENT", `${label} differs between independent clients`);
  }
  return primary;
}

async function dualRead(primaryClient, secondaryClient, blockNumber, request, label) {
  return dual(label, primaryClient, secondaryClient, (client) => client.readContract({
    ...request,
    blockNumber,
  }));
}

async function establishPinnedBlock(primaryClient, secondaryClient, confirmations) {
  const [primaryHead, secondaryHead] = await Promise.all([
    primaryClient.getBlockNumber(), secondaryClient.getBlockNumber(),
  ]).catch((error) => fail("LIVE_READ_FAILED", error?.message ?? "cannot read chain heads"));
  if (typeof primaryHead !== "bigint" || primaryHead < 0n
    || typeof secondaryHead !== "bigint" || secondaryHead < 0n) {
    fail("INVALID_BLOCK", "chain heads are invalid");
  }
  const skew = primaryHead > secondaryHead ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("RPC_HEAD_SKEW", "independent RPC heads differ by more than three blocks");
  const number = (primaryHead < secondaryHead ? primaryHead : secondaryHead) - BigInt(confirmations);
  if (number < 0n) fail("UNCONFIRMED_BLOCK", "chain head is below confirmation depth");
  const block = await dual("confirmed pin", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: number }));
  same(rpcUint(block?.number, "confirmed pin number"), number, "INVALID_BLOCK", "confirmed pin number");
  const hash = bytes32(block?.hash, "confirmed pin hash");
  const timestamp = rpcUint(block?.timestamp, "confirmed pin timestamp");
  return { number, hash, timestamp, primaryHead, secondaryHead, skew };
}

async function establishLatest(primaryClient, secondaryClient) {
  const [primaryHead, secondaryHead] = await Promise.all([
    primaryClient.getBlockNumber(), secondaryClient.getBlockNumber(),
  ]).catch((error) => fail("LIVE_READ_FAILED", error?.message ?? "cannot read latest chain heads"));
  if (typeof primaryHead !== "bigint" || typeof secondaryHead !== "bigint"
    || primaryHead < 0n || secondaryHead < 0n) fail("INVALID_BLOCK", "latest heads are invalid");
  const skew = primaryHead > secondaryHead ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("RPC_HEAD_SKEW", "latest RPC heads differ by more than three blocks");
  const number = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const block = await dual("latest common block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: number }));
  same(rpcUint(block?.number, "latest block number"), number, "INVALID_BLOCK", "latest block number");
  return {
    number,
    hash: bytes32(block?.hash, "latest block hash"),
    timestamp: rpcUint(block?.timestamp, "latest block timestamp"),
    primaryHead,
    secondaryHead,
    skew,
  };
}

async function recheckBlock(primaryClient, secondaryClient, block, label) {
  const closing = await dual(`${label} recheck`, primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: block.number }));
  same(rpcUint(closing?.number, `${label} number`), block.number,
    "BLOCK_CHANGED", `${label} number`);
  same(bytes32(closing?.hash, `${label} hash`), block.hash, "BLOCK_CHANGED", `${label} hash`);
  same(rpcUint(closing?.timestamp, `${label} timestamp`), block.timestamp,
    "BLOCK_CHANGED", `${label} timestamp`);
}

async function assertCode(primaryClient, secondaryClient, blockNumber, target, expectedHash, label) {
  const code = await dual(`${label} runtime code`, primaryClient, secondaryClient,
    async (client) => (await client.getCode({ address: target, blockNumber })) ?? "0x");
  if (typeof code !== "string" || code === "0x") fail("MISSING_CODE", `${label} has no runtime code`);
  const actual = keccak256(code).toLowerCase();
  same(actual, expectedHash, "CODE_HASH_MISMATCH", `${label} runtime code hash`);
  return actual;
}

async function rejectProxy(primaryClient, secondaryClient, blockNumber, target, label) {
  for (const [name, slot] of Object.entries(EIP1967_SLOTS)) {
    const stored = await dual(`${label} ${name} slot`, primaryClient, secondaryClient,
      (client) => client.getStorageAt({ address: target, slot, blockNumber }));
    same(bytes32(stored ?? ZERO_WORD, `${label} ${name} slot`, { allowZero: true }), ZERO_WORD,
      "PROXY_UNSUPPORTED", `${label} ${name} slot`);
  }
}

function decodeKnownEvent(log, abi, label) {
  if (!log || typeof log !== "object"
    || (Object.hasOwn(log, "removed") && log.removed !== false)) {
    fail("INVALID_RECEIPT", `${label} is missing or removed`);
  }
  try {
    return decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
  } catch {
    fail("UNEXPECTED_EVENT", `${label} is not a recognized exact protocol event`);
  }
}

function blockTransactionHash(value, label) {
  if (typeof value === "string") return bytes32(value, label);
  if (value && typeof value === "object") return bytes32(value.hash, label);
  fail("TRANSACTION_NOT_IN_BLOCK", `${label} is not a transaction hash or object`);
}

async function verifyTransactionInBlock({
  primaryClient,
  secondaryClient,
  blockNumber,
  blockHash,
  transactionIndex,
  transactionHash,
  label,
}) {
  const block = await dual(`${label} block inclusion`, primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber, includeTransactions: true }));
  same(rpcUint(block?.number, `${label} block number`), blockNumber,
    "TRANSACTION_NOT_IN_BLOCK", `${label} block number`);
  same(bytes32(block?.hash, `${label} block hash`), blockHash,
    "TRANSACTION_NOT_IN_BLOCK", `${label} block hash`);
  if (!Array.isArray(block?.transactions)
    || transactionIndex >= BigInt(block.transactions.length)) {
    fail("TRANSACTION_NOT_IN_BLOCK", `${label} transaction index is absent from its block`);
  }
  same(blockTransactionHash(block.transactions[Number(transactionIndex)],
    `${label} included transaction hash`), transactionHash,
  "TRANSACTION_NOT_IN_BLOCK", `${label} included transaction hash`);
  return block;
}

function eventArg(decoded, name) {
  return decoded?.args?.[name];
}

function sameEventArg(decoded, name, expected, label) {
  same(eventArg(decoded, name), expected, "TEARDOWN_EVENT_MISMATCH", `${label}.${name}`);
}

function assertExpectedTeardownEvent(index, decoded, context) {
  const { account, owner, adapter, venue, collection, selector } = context.scope;
  const expectations = [
    ["FeatureFlagsChanged", {}],
    ["AccountPauseChanged", { account, owner, paused: true, version: 12n }],
    ["PolicyConfigured", { account, owner, version: 13n, mode: 0 }],
    ["AdapterStatusChanged", { adapter, active: false }],
    ["MintControlsChanged", {
      account, owner, ownerApprovedMints: false, autonomousFreeMints: false,
      autonomousPaidMints: false, policyVersion: 14n,
    }],
    ["SelectorPermissionChanged", { account, selector, allowed: false, denied: true }],
    ["AdapterPermissionChanged", { account, adapter, allowed: false }],
    ["VenuePermissionChanged", { account, venue, kind: 1, allowed: false }],
    ["CollectionPermissionChanged", { account, collection, allowed: false, denied: true }],
    ["CurrencyPolicyChanged", { account, currency: ZERO_ADDRESS }],
    ["VenueCurrencyMaximumChanged", { account, venue, currency: ZERO_ADDRESS, maximum: 0n }],
  ];
  const [name, args] = expectations[index];
  if (decoded.eventName !== name) {
    fail("TEARDOWN_EVENT_MISMATCH",
      `teardown call ${index + 1} emitted ${decoded.eventName}, expected ${name}`);
  }
  for (const [arg, expected] of Object.entries(args)) {
    sameEventArg(decoded, arg, expected, `teardown event ${index + 1}`);
  }
  if (index === 0) {
    requireTuple(eventArg(decoded, "flags"), [
      ["scoutMode", 0, true], ["approvalPurchases", 1, false],
      ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
      ["unknownCollectionExecution", 4, false], ["selling", 5, false],
      ["autonomousSelling", 6, false],
    ], "teardown feature flags event");
  }
  if (index === 9) {
    requireTuple(eventArg(decoded, "policy"), [
      ["allowed", 0, false], ["maxSpendPerTransaction", 1, 0n],
      ["maxSpendPerDay", 2, 0n], ["maxSpendPerWeek", 3, 0n],
      ["maxMintPrice", 4, 0n], ["maxSecondaryPurchasePrice", 5, 0n],
    ], "teardown currency policy event");
  }
}

function logIdentity(log) {
  return {
    address: address(log.address, "log address"),
    blockHash: bytes32(log.blockHash, "log block hash"),
    blockNumber: rpcUint(log.blockNumber, "log block number").toString(),
    transactionHash: bytes32(log.transactionHash, "log transaction hash"),
    transactionIndex: rpcUint(log.transactionIndex, "log transaction index").toString(),
    logIndex: rpcUint(log.logIndex, "log index").toString(),
    data: typeof log.data === "string" ? log.data.toLowerCase()
      : fail("INVALID_RECEIPT", "log data is invalid"),
    topics: Array.isArray(log.topics) ? log.topics.map((topic) => topic.toLowerCase())
      : fail("INVALID_RECEIPT", "log topics are invalid"),
  };
}

function compareLogPosition(left, right) {
  for (const key of ["blockNumber", "transactionIndex", "logIndex"]) {
    const a = BigInt(left[key]);
    const b = BigInt(right[key]);
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function afterMintPosition(log, mint) {
  const block = rpcUint(log.blockNumber, "interval log block");
  const index = rpcUint(log.transactionIndex, "interval log transaction index");
  return block > mint.blockNumber || (block === mint.blockNumber && index > mint.transactionIndex);
}

function validateContext(contextValue) {
  const context = snapshot(contextValue, "teardown attestation context");
  exactKeys(context, ["evidenceHashes", "scope", "infrastructure", "contracts", "mintTransaction",
    "mintReceipt", "teardownPlan", "teardownEvidence"], "context");
  exactKeys(context.evidenceHashes, [
    "coreManifest", "canaryManifest", "coreSourceVerificationAdoption",
    "canarySourceVerificationAdoption", "configBundleReviewKeccak256", "configBundleArtifact",
    "configurationReceiptEvidence", "configurationReceiptEvidenceArtifact",
    "executionReceiptEvidence", "executionReceiptEvidenceArtifact",
    "mintReceiptAttestationArtifact", "teardownReceiptEvidence",
    "teardownReceiptEvidenceArtifact",
  ], "context.evidenceHashes");
  const evidenceHashes = {};
  for (const [name, value] of Object.entries(context.evidenceHashes)) {
    evidenceHashes[name] = bytes32(value, `context.evidenceHashes.${name}`);
  }
  exactKeys(context.scope,
    ["punkTokenId", "account", "owner", "adapter", "venue", "collection", "selector", "artTokenId",
      "adapterVersionHash", "adapterMetadataHash"],
    "context.scope");
  const scope = {
    punkTokenId: uint(context.scope.punkTokenId, "Punk token ID"),
    account: address(context.scope.account, "Punk Account"),
    owner: address(context.scope.owner, "current Punk owner"),
    adapter: address(context.scope.adapter, "canary adapter"),
    venue: address(context.scope.venue, "canary venue"),
    collection: address(context.scope.collection, "canary collection"),
    selector: typeof context.scope.selector === "string" ? context.scope.selector.toLowerCase() : "",
    artTokenId: uint(context.scope.artTokenId, "canary art token ID"),
    adapterVersionHash: bytes32(context.scope.adapterVersionHash, "adapter version hash"),
    adapterMetadataHash: bytes32(context.scope.adapterMetadataHash, "adapter metadata hash"),
  };
  if (!/^0x[0-9a-f]{8}$/.test(scope.selector) || scope.selector !== ONE_SHOT_MINT_SELECTOR) {
    fail("INVALID_SCOPE", "canary selector is not the pinned one-shot mint selector");
  }
  same(scope.venue, scope.collection, "INVALID_SCOPE", "canary venue and collection");
  exactKeys(context.infrastructure,
    ["canonicalCollection", "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
      "accountSalt"], "context.infrastructure");
  const infrastructure = {
    canonicalCollection: address(context.infrastructure.canonicalCollection,
      "canonical collection"),
    canonicalERC6551Registry: address(context.infrastructure.canonicalERC6551Registry,
      "canonical ERC-6551 registry"),
    canonicalERC6551RegistryRuntimeCodeHash: bytes32(
      context.infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical ERC-6551 registry runtime hash",
    ),
    accountSalt: bytes32(context.infrastructure.accountSalt, "account salt", { allowZero: true }),
  };
  same(infrastructure.canonicalCollection, ROBINHOOD.canonicalCollection,
    "NONCANONICAL_COLLECTION", "canonical collection");
  same(infrastructure.canonicalERC6551Registry, ROBINHOOD.canonicalERC6551Registry,
    "WIRING_MISMATCH", "canonical ERC-6551 registry");
  same(infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
    "CODE_HASH_MISMATCH", "canonical ERC-6551 registry runtime hash");
  same(infrastructure.accountSalt, ZERO_WORD, "WIRING_MISMATCH", "account salt");
  exactKeys(context.contracts, [
    "guardian", "adapterRegistry", "agentRegistry", "policyModule", "accountImplementation",
    "accountRegistry", "account", "adapter", "venue",
  ], "context.contracts");
  const contracts = { guardian: address(context.contracts.guardian, "protocol guardian") };
  for (const name of ["adapterRegistry", "agentRegistry", "policyModule", "accountImplementation",
    "accountRegistry", "account", "adapter", "venue"]) {
    exactKeys(context.contracts[name], ["address", "runtimeCodeHash", "deploymentBlock"],
      `context.contracts.${name}`);
    contracts[name] = {
      address: address(context.contracts[name].address, `${name} address`),
      runtimeCodeHash: bytes32(context.contracts[name].runtimeCodeHash, `${name} runtime hash`),
      deploymentBlock: uint(context.contracts[name].deploymentBlock, `${name} deployment block`),
    };
  }
  same(contracts.account.address, scope.account, "INVALID_SCOPE", "account address");
  same(contracts.adapter.address, scope.adapter, "INVALID_SCOPE", "adapter address");
  same(contracts.venue.address, scope.venue, "INVALID_SCOPE", "venue address");
  exactKeys(context.mintTransaction,
    ["hash", "from", "to", "value", "data", "dataKeccak256"], "context.mintTransaction");
  const mintTransaction = {
    hash: bytes32(context.mintTransaction.hash, "mint transaction hash"),
    from: address(context.mintTransaction.from, "mint transaction sender"),
    to: address(context.mintTransaction.to, "mint transaction destination"),
    value: uint(context.mintTransaction.value, "mint transaction value"),
    data: typeof context.mintTransaction.data === "string"
      && /^0x(?:[0-9a-fA-F]{2})+$/.test(context.mintTransaction.data)
      ? context.mintTransaction.data.toLowerCase()
      : fail("INVALID_MINT_TRANSACTION", "mint transaction calldata is malformed"),
    dataKeccak256: bytes32(context.mintTransaction.dataKeccak256,
      "mint transaction calldata hash"),
  };
  same(mintTransaction.from, scope.owner, "INVALID_MINT_TRANSACTION", "mint sender");
  same(mintTransaction.to, scope.account, "INVALID_MINT_TRANSACTION", "mint destination");
  same(mintTransaction.value, 0n, "INVALID_MINT_TRANSACTION", "mint value");
  same(keccak256(mintTransaction.data), mintTransaction.dataKeccak256,
    "INVALID_MINT_TRANSACTION", "mint calldata hash");
  exactKeys(context.mintReceipt,
    ["transactionHash", "blockNumber", "blockHash", "transactionIndex", "blockTimestamp"],
    "context.mintReceipt");
  const mintReceipt = {
    transactionHash: bytes32(context.mintReceipt.transactionHash, "mint transaction hash"),
    blockNumber: uint(context.mintReceipt.blockNumber, "mint receipt block number"),
    blockHash: bytes32(context.mintReceipt.blockHash, "mint receipt block hash"),
    transactionIndex: uint(context.mintReceipt.transactionIndex, "mint receipt transaction index"),
    blockTimestamp: uint(context.mintReceipt.blockTimestamp, "mint receipt block timestamp"),
  };
  same(mintReceipt.transactionHash, mintTransaction.hash,
    "INVALID_MINT_RECEIPT", "mint receipt transaction hash");
  if (mintReceipt.blockNumber === 0n) fail("INVALID_MINT_RECEIPT", "mint receipt block is zero");
  if (!Array.isArray(context.teardownPlan) || context.teardownPlan.length !== TEARDOWN_CALL_COUNT) {
    fail("INVALID_TEARDOWN_PLAN", "teardown plan must contain exactly eleven calls");
  }
  if (!Array.isArray(context.teardownEvidence)
    || context.teardownEvidence.length !== TEARDOWN_CALL_COUNT) {
    fail("INVALID_TEARDOWN_EVIDENCE", "teardown evidence must contain exactly eleven hashes");
  }
  const seen = new Set([mintReceipt.transactionHash]);
  const teardownPlan = context.teardownPlan.map((call, index) => {
    exactKeys(call, ["id", "order", "role", "from", "to", "valueWei", "functionName", "calldata"],
      `context.teardownPlan[${index}]`);
    if (call.order !== index + 1 || call.role !== (index === 0 || index === 3
      ? "GUARDIAN" : "CURRENT_PUNK_OWNER") || call.valueWei !== "0"
      || call.from.toLowerCase() !== (call.role === "GUARDIAN" ? contracts.guardian : scope.owner)
      || call.to.toLowerCase() !== (index === 3 ? contracts.adapterRegistry.address
        : contracts.policyModule.address)
      || typeof call.calldata !== "string" || !/^0x[0-9a-fA-F]+$/.test(call.calldata)) {
      fail("INVALID_TEARDOWN_PLAN", `teardown call ${index + 1} is not canonical`);
    }
    if (call.id !== EXPECTED_TEARDOWN_IDS[index]
      || call.functionName !== EXPECTED_TEARDOWN_FUNCTIONS[index]) {
      fail("INVALID_TEARDOWN_PLAN", `teardown call ${index + 1} identity is not canonical`);
    }
    const evidence = context.teardownEvidence[index];
    exactKeys(evidence, ["id", "order", "hash"], `context.teardownEvidence[${index}]`);
    if (evidence.id !== call.id || evidence.order !== call.order) {
      fail("INVALID_TEARDOWN_EVIDENCE", `teardown evidence ${index + 1} is not plan-bound`);
    }
    const hash = bytes32(evidence.hash, `teardown transaction ${index + 1} hash`);
    if (seen.has(hash)) fail("DUPLICATE_TRANSACTION", "teardown/mint transaction hash is reused");
    seen.add(hash);
    return { ...call, from: call.from.toLowerCase(), to: call.to.toLowerCase(),
      calldata: call.calldata.toLowerCase(), hash };
  });
  return {
    evidenceHashes, scope, infrastructure, contracts, mintTransaction, mintReceipt, teardownPlan,
  };
}

async function verifyTeardownReceipts({ context, primaryClient, secondaryClient, pinned }) {
  const guardianCode = await dual("guardian runtime code", primaryClient, secondaryClient,
    async (client) => (await client.getCode({
      address: context.contracts.guardian,
      blockNumber: pinned.number,
    })) ?? "0x");
  const guardianIsContract = guardianCode !== "0x";
  const expectedLogs = [];
  const receiptBlocks = new Map();
  let previous = { block: context.mintReceipt.blockNumber, index: context.mintReceipt.transactionIndex };
  for (let index = 0; index < context.teardownPlan.length; index += 1) {
    const planned = context.teardownPlan[index];
    const indirectGuardian = planned.role === "GUARDIAN" && guardianIsContract;
    const transaction = await dual(`teardown transaction ${index + 1}`,
      primaryClient, secondaryClient, (client) => client.getTransaction({ hash: planned.hash }));
    const receipt = await dual(`teardown receipt ${index + 1}`,
      primaryClient, secondaryClient,
      (client) => client.getTransactionReceipt({ hash: planned.hash }));
    same(bytes32(transaction?.hash, `teardown transaction ${index + 1} hash`), planned.hash,
      "TEARDOWN_TRANSACTION_MISMATCH", `teardown transaction ${index + 1} hash`);
    const transactionFrom = address(transaction?.from, `teardown transaction ${index + 1} sender`);
    same(address(transaction?.to, `teardown transaction ${index + 1} destination`),
      indirectGuardian ? context.contracts.guardian : planned.to,
      "TEARDOWN_TRANSACTION_MISMATCH", `teardown transaction ${index + 1} destination`);
    if (!indirectGuardian) {
      same(transactionFrom, planned.from, "TEARDOWN_TRANSACTION_MISMATCH",
        `teardown transaction ${index + 1} sender`);
      same(typeof transaction.input === "string" ? transaction.input.toLowerCase() : transaction.input,
        planned.calldata, "TEARDOWN_TRANSACTION_MISMATCH", `teardown transaction ${index + 1} calldata`);
    }
    same(rpcUint(transaction?.value, `teardown transaction ${index + 1} value`), 0n,
      "TEARDOWN_TRANSACTION_MISMATCH", `teardown transaction ${index + 1} value`);
    same(transaction?.chainId, ROBINHOOD.chainId, "WRONG_CHAIN",
      `teardown transaction ${index + 1} chain ID`);
    if (receipt?.status !== "success") {
      fail("TEARDOWN_RECEIPT_FAILED", `teardown receipt ${index + 1} did not succeed`);
    }
    same(bytes32(receipt.transactionHash, `teardown receipt ${index + 1} transaction hash`),
      planned.hash, "TEARDOWN_RECEIPT_MISMATCH", `teardown receipt ${index + 1} hash`);
    same(address(receipt.from, `teardown receipt ${index + 1} sender`), transactionFrom,
      "TEARDOWN_RECEIPT_MISMATCH", `teardown receipt ${index + 1} sender`);
    same(address(receipt.to, `teardown receipt ${index + 1} destination`),
      indirectGuardian ? context.contracts.guardian : planned.to,
      "TEARDOWN_RECEIPT_MISMATCH", `teardown receipt ${index + 1} destination`);
    const blockNumber = rpcUint(receipt.blockNumber, `teardown receipt ${index + 1} block`);
    const transactionIndex = rpcUint(receipt.transactionIndex,
      `teardown receipt ${index + 1} transaction index`);
    const blockHash = bytes32(receipt.blockHash, `teardown receipt ${index + 1} block hash`);
    if (blockNumber > pinned.number || blockNumber < context.mintReceipt.blockNumber
      || (blockNumber === previous.block && transactionIndex <= previous.index)
      || blockNumber < previous.block) {
      fail("TEARDOWN_ORDER_MISMATCH", "teardown transactions are not strictly after mint and ordered");
    }
    previous = { block: blockNumber, index: transactionIndex };
    if (planned.role === "GUARDIAN") {
      const receiptGuardianCode = await dual(`guardian code at teardown ${index + 1}`,
        primaryClient, secondaryClient,
        async (client) => (await client.getCode({
          address: context.contracts.guardian,
          blockNumber,
        })) ?? "0x");
      same(receiptGuardianCode, guardianCode, "GUARDIAN_TYPE_CHANGED",
        `guardian runtime at teardown ${index + 1}`);
    }
    same(rpcUint(transaction.blockNumber, `teardown transaction ${index + 1} block`), blockNumber,
      "TEARDOWN_RECEIPT_MISMATCH", `teardown transaction ${index + 1} block`);
    same(bytes32(transaction.blockHash, `teardown transaction ${index + 1} block hash`), blockHash,
      "TEARDOWN_RECEIPT_MISMATCH", `teardown transaction ${index + 1} block hash`);
    same(rpcUint(transaction.transactionIndex, `teardown transaction ${index + 1} index`),
      transactionIndex, "TEARDOWN_RECEIPT_MISMATCH", `teardown transaction ${index + 1} index`);
    const inclusionBlock = await verifyTransactionInBlock({
      primaryClient,
      secondaryClient,
      blockNumber,
      blockHash,
      transactionIndex,
      transactionHash: planned.hash,
      label: `teardown transaction ${index + 1}`,
    });
    const inclusionTimestamp = rpcUint(inclusionBlock?.timestamp,
      `teardown block ${index + 1} timestamp`);
    const priorBlock = receiptBlocks.get(blockNumber.toString());
    if (priorBlock) {
      same(priorBlock.hash, blockHash, "TEARDOWN_RECEIPT_MISMATCH",
        `teardown block ${index + 1} repeated hash`);
      same(priorBlock.timestamp, inclusionTimestamp, "TEARDOWN_RECEIPT_MISMATCH",
        `teardown block ${index + 1} repeated timestamp`);
    } else {
      receiptBlocks.set(blockNumber.toString(), {
        number: blockNumber, hash: blockHash, timestamp: inclusionTimestamp,
      });
    }
    const targetContract = index === 3 ? context.contracts.adapterRegistry
      : context.contracts.policyModule;
    await assertCode(primaryClient, secondaryClient, blockNumber,
      targetContract.address, targetContract.runtimeCodeHash,
      `teardown target ${index + 1}`);
    if (!Array.isArray(receipt.logs)) fail("UNEXPECTED_EVENT", `teardown receipt ${index + 1} logs missing`);
    const targetLogs = receipt.logs.filter((log) => (
      typeof log?.address === "string" && log.address.toLowerCase() === planned.to
    ));
    if (targetLogs.length !== 1 || (!indirectGuardian && receipt.logs.length !== 1)) {
      fail("UNEXPECTED_EVENT",
        `teardown receipt ${index + 1} does not contain exactly one target protocol event`);
    }
    const targetLog = targetLogs[0];
    same(bytes32(targetLog.transactionHash, `teardown event ${index + 1} transaction hash`),
      planned.hash, "TEARDOWN_EVENT_MISMATCH", `teardown event ${index + 1} transaction hash`);
    same(bytes32(targetLog.blockHash, `teardown event ${index + 1} block hash`), blockHash,
      "TEARDOWN_EVENT_MISMATCH", `teardown event ${index + 1} block hash`);
    same(rpcUint(targetLog.blockNumber, `teardown event ${index + 1} block`), blockNumber,
      "TEARDOWN_EVENT_MISMATCH", `teardown event ${index + 1} block`);
    same(rpcUint(targetLog.transactionIndex, `teardown event ${index + 1} transaction index`),
      transactionIndex, "TEARDOWN_EVENT_MISMATCH", `teardown event ${index + 1} transaction index`);
    const decoded = decodeKnownEvent(targetLog, index === 3
      ? adapterMutationEventAbi : policyMutationEventAbi, `teardown event ${index + 1}`);
    assertExpectedTeardownEvent(index, decoded, context);
    expectedLogs.push(logIdentity(targetLog));
  }
  return {
    guardianIsContract,
    expectedLogs,
    lastPosition: previous,
    receiptBlocks: [...receiptBlocks.values()],
  };
}

async function verifyMintAnchor({ context, primaryClient, secondaryClient, pinned }) {
  const transaction = await dual("mint anchor transaction", primaryClient, secondaryClient,
    (client) => client.getTransaction({ hash: context.mintReceipt.transactionHash }));
  const receipt = await dual("mint anchor receipt", primaryClient, secondaryClient,
    (client) => client.getTransactionReceipt({ hash: context.mintReceipt.transactionHash }));
  same(bytes32(transaction?.hash, "mint anchor transaction hash"),
    context.mintReceipt.transactionHash, "MINT_RECEIPT_MISMATCH", "mint transaction hash");
  same(bytes32(receipt?.transactionHash, "mint anchor receipt transaction hash"),
    context.mintReceipt.transactionHash, "MINT_RECEIPT_MISMATCH", "mint receipt transaction hash");
  if (receipt?.status !== "success") fail("MINT_RECEIPT_MISMATCH", "mint receipt is not successful");
  same(address(transaction?.from, "mint anchor transaction sender"), context.mintTransaction.from,
    "MINT_RECEIPT_MISMATCH", "mint transaction sender");
  same(address(transaction?.to, "mint anchor transaction destination"), context.mintTransaction.to,
    "MINT_RECEIPT_MISMATCH", "mint transaction destination");
  same(rpcUint(transaction?.value, "mint anchor transaction value"), context.mintTransaction.value,
    "MINT_RECEIPT_MISMATCH", "mint transaction value");
  same(typeof transaction?.input === "string" ? transaction.input.toLowerCase() : transaction?.input,
    context.mintTransaction.data, "MINT_RECEIPT_MISMATCH", "mint transaction calldata");
  same(keccak256(transaction.input), context.mintTransaction.dataKeccak256,
    "MINT_RECEIPT_MISMATCH", "mint transaction calldata hash");
  same(address(receipt?.from, "mint anchor receipt sender"), context.mintTransaction.from,
    "MINT_RECEIPT_MISMATCH", "mint receipt sender");
  same(address(receipt?.to, "mint anchor receipt destination"), context.mintTransaction.to,
    "MINT_RECEIPT_MISMATCH", "mint receipt destination");
  same(rpcUint(transaction?.blockNumber, "mint transaction block"),
    context.mintReceipt.blockNumber, "MINT_RECEIPT_MISMATCH", "mint transaction block");
  same(rpcUint(receipt?.blockNumber, "mint receipt block"),
    context.mintReceipt.blockNumber, "MINT_RECEIPT_MISMATCH", "mint receipt block");
  same(bytes32(transaction?.blockHash, "mint transaction block hash"),
    context.mintReceipt.blockHash, "MINT_RECEIPT_MISMATCH", "mint transaction block hash");
  same(bytes32(receipt?.blockHash, "mint receipt block hash"),
    context.mintReceipt.blockHash, "MINT_RECEIPT_MISMATCH", "mint receipt block hash");
  same(rpcUint(transaction?.transactionIndex, "mint transaction index"),
    context.mintReceipt.transactionIndex, "MINT_RECEIPT_MISMATCH", "mint transaction index");
  same(rpcUint(receipt?.transactionIndex, "mint receipt transaction index"),
    context.mintReceipt.transactionIndex, "MINT_RECEIPT_MISMATCH", "mint receipt transaction index");
  if (context.mintReceipt.blockNumber > pinned.number) {
    fail("UNCONFIRMED_MINT", "mint receipt does not have the required confirmations");
  }
  const block = await verifyTransactionInBlock({
    primaryClient,
    secondaryClient,
    blockNumber: context.mintReceipt.blockNumber,
    blockHash: context.mintReceipt.blockHash,
    transactionIndex: context.mintReceipt.transactionIndex,
    transactionHash: context.mintReceipt.transactionHash,
    label: "mint anchor",
  });
  same(rpcUint(block?.timestamp, "mint anchor block timestamp"),
    context.mintReceipt.blockTimestamp,
    "MINT_RECEIPT_MISMATCH", "mint anchor block timestamp");
}

async function verifyFullInterval({ context, primaryClient, secondaryClient, latest, expectedLogs }) {
  const fromBlock = context.mintReceipt.blockNumber;
  const { policyModule, adapterRegistry, agentRegistry, account } = context.contracts;
  const [policyLogs, adapterLogs, agentLogs, accountLogs, transfers] = await Promise.all([
    dual("post-mint policy interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: policyModule.address, fromBlock, toBlock: latest.number })),
    dual("post-mint adapter interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: adapterRegistry.address, fromBlock, toBlock: latest.number })),
    dual("full selected-account agent history", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: agentRegistry.address,
        fromBlock: agentRegistry.deploymentBlock, toBlock: latest.number })),
    dual("post-mint Punk Account interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: account.address, fromBlock, toBlock: latest.number })),
    dual("post-mint controlling Punk transfers", primaryClient, secondaryClient,
      (client) => client.getLogs({
        address: context.infrastructure.canonicalCollection,
        event: punkTransferEvent,
        args: { tokenId: context.scope.punkTokenId },
        fromBlock,
        toBlock: latest.number,
      })),
  ]);
  for (const value of [policyLogs, adapterLogs, agentLogs, accountLogs, transfers]) {
    if (!Array.isArray(value)) fail("INVALID_RPC_RESPONSE", "event interval is not an array");
  }
  const scanned = [];
  for (const log of policyLogs.filter((item) => afterMintPosition(item, context.mintReceipt))) {
    decodeKnownEvent(log, policyMutationEventAbi, "post-mint policy log");
    scanned.push(logIdentity(log));
  }
  for (const log of adapterLogs.filter((item) => afterMintPosition(item, context.mintReceipt))) {
    const decoded = decodeKnownEvent(log, adapterMutationEventAbi, "post-mint adapter log");
    if (eventArg(decoded, "adapter")?.toLowerCase() === context.scope.adapter
      || ["GlobalAdapterPauseChanged", "OwnershipTransferred"].includes(decoded.eventName)) {
      scanned.push(logIdentity(log));
    }
  }
  const expected = [...expectedLogs].sort(compareLogPosition);
  scanned.sort(compareLogPosition);
  if (canonicalJson(scanned) !== canonicalJson(expected)) {
    fail("UNEXPECTED_MUTATION", "post-mint interval is not exactly the eleven teardown events");
  }
  for (const log of agentLogs) {
    const decoded = decodeKnownEvent(log, agentMutationEventAbi, "agent history log");
    if (eventArg(decoded, "account")?.toLowerCase() === context.scope.account) {
      fail("AGENT_HISTORY_PRESENT", `selected account has ${decoded.eventName} history`);
    }
    if (decoded.eventName === "OwnershipTransferred"
      && eventArg(decoded, "previousOwner")?.toLowerCase() === ZERO_ADDRESS
      && eventArg(decoded, "newOwner")?.toLowerCase() === context.contracts.guardian
      && rpcUint(log.blockNumber, "agent registry deployment ownership block")
        === context.contracts.agentRegistry.deploymentBlock) {
      continue;
    }
    if (["OwnershipTransferred", "GlobalAgentConfigured", "GlobalAgentPauseChanged"]
      .includes(decoded.eventName)) {
      fail("AGENT_HISTORY_PRESENT", `agent registry has unexpected ${decoded.eventName} history`);
    }
  }
  const afterMintAccountLogs = accountLogs.filter((item) => afterMintPosition(item, context.mintReceipt));
  if (afterMintAccountLogs.length !== 0) {
    for (const log of afterMintAccountLogs) {
      decodeKnownEvent(log, accountActivityEventAbi, "post-mint account activity log");
    }
    fail("UNEXPECTED_ACCOUNT_ACTIVITY",
      "a Punk Account-emitted protocol activity event occurred after the mint receipt");
  }
  if (transfers.some((item) => afterMintPosition(item, context.mintReceipt))) {
    fail("OWNERSHIP_CHANGED", "controlling Gogh Punk transferred after the mint receipt");
  }
}

async function verifyFinalState({
  context, primaryClient, secondaryClient, blockNumber, blockTimestamp,
}) {
  const { scope, contracts, infrastructure } = context;
  for (const name of ["adapterRegistry", "agentRegistry", "policyModule", "accountImplementation",
    "accountRegistry", "account", "adapter", "venue"]) {
    await assertCode(primaryClient, secondaryClient, blockNumber, contracts[name].address,
      contracts[name].runtimeCodeHash, name);
    await rejectProxy(primaryClient, secondaryClient, blockNumber, contracts[name].address, name);
  }
  await assertCode(primaryClient, secondaryClient, blockNumber,
    infrastructure.canonicalERC6551Registry,
    infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    "canonical ERC-6551 registry");
  await rejectProxy(primaryClient, secondaryClient, blockNumber,
    infrastructure.canonicalERC6551Registry, "canonical ERC-6551 registry");

  const currentOwner = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: infrastructure.canonicalCollection, abi: punkAbi, functionName: "ownerOf",
      args: [scope.punkTokenId] }, "current Punk owner");
  same(address(currentOwner, "current Punk owner"), scope.owner, "OWNER_MISMATCH", "current Punk owner");
  const ownerCode = await dual("current owner runtime code", primaryClient, secondaryClient,
    async (client) => (await client.getCode({ address: scope.owner, blockNumber })) ?? "0x");
  if (ownerCode !== "0x") fail("OWNER_TYPE_CHANGED", "first owner-direct canary owner is no longer an EOA");

  const footer = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.account, abi: accountAbi, functionName: "token" }, "Punk Account footer");
  requireTuple(footer, [
    ["chainId", 0, BigInt(ROBINHOOD.chainId)],
    ["tokenContract", 1, infrastructure.canonicalCollection],
    ["tokenId", 2, scope.punkTokenId],
  ], "Punk Account footer");
  const accountOwner = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.account, abi: accountAbi, functionName: "owner" }, "Punk Account owner");
  const canonical = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.account, abi: accountAbi, functionName: "isCanonicalGoghPunkAccount" },
    "Punk Account canonical qualification");
  same(address(accountOwner, "Punk Account owner"), scope.owner, "OWNER_MISMATCH", "Punk Account owner");
  same(canonical, true, "ACCOUNT_DERIVATION_MISMATCH", "Punk Account canonical qualification");

  const registryReads = [
    ["implementation", contracts.accountImplementation.address],
    ["accountSalt", infrastructure.accountSalt],
    ["ROBINHOOD_CHAIN_ID", BigInt(ROBINHOOD.chainId)],
    ["GOGH_PUNKS", infrastructure.canonicalCollection],
    ["CANONICAL_ERC6551_REGISTRY", infrastructure.canonicalERC6551Registry],
    ["canonicalRegistry", infrastructure.canonicalERC6551Registry],
  ];
  for (const [functionName, expected] of registryReads) {
    const actual = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: contracts.accountRegistry.address, abi: accountRegistryAbi, functionName },
      `account registry ${functionName}`);
    same(actual, expected, "WIRING_MISMATCH", `account registry ${functionName}`);
  }
  const resolved = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.accountRegistry.address, abi: accountRegistryAbi, functionName: "account",
      args: [scope.punkTokenId] }, "Gogh account derivation");
  const independent = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: infrastructure.canonicalERC6551Registry, abi: canonicalRegistryAbi,
      functionName: "account", args: [contracts.accountImplementation.address,
        infrastructure.accountSalt, BigInt(ROBINHOOD.chainId),
        infrastructure.canonicalCollection, scope.punkTokenId] }, "canonical account derivation");
  same(address(resolved, "Gogh account derivation"), scope.account,
    "ACCOUNT_DERIVATION_MISMATCH", "Gogh account derivation");
  same(address(independent, "canonical account derivation"), scope.account,
    "ACCOUNT_DERIVATION_MISMATCH", "canonical account derivation");
  for (const [functionName, expected] of [
    ["policyModule", contracts.policyModule.address],
    ["agentRegistry", contracts.agentRegistry.address],
    ["adapterRegistry", contracts.adapterRegistry.address],
  ]) {
    for (const [target, label] of [[scope.account, "account"],
      [contracts.accountImplementation.address, "implementation"]]) {
      const actual = await dualRead(primaryClient, secondaryClient, blockNumber,
        { address: target, abi: accountAbi, functionName }, `${label} ${functionName}`);
      same(address(actual, `${label} ${functionName}`), expected,
        "WIRING_MISMATCH", `${label} ${functionName}`);
    }
  }

  for (const [name, target, abi] of [
    ["adapter registry", contracts.adapterRegistry.address, adapterRegistryAbi],
    ["agent registry", contracts.agentRegistry.address, agentRegistryAbi],
    ["policy module", contracts.policyModule.address, policyAbi],
  ]) {
    const guardian = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: target, abi, functionName: "owner" }, `${name} guardian`);
    const pendingOwner = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: target, abi, functionName: "pendingOwner" }, `${name} pending owner`);
    same(address(guardian, `${name} guardian`), contracts.guardian,
      "GUARDIAN_MISMATCH", `${name} guardian`);
    same(address(pendingOwner, `${name} pending owner`, { allowZero: true }), ZERO_ADDRESS,
      "PENDING_OWNERSHIP", `${name} pending owner`);
  }

  const features = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "featureFlags" },
    "final feature flags");
  requireTuple(features, [
    ["scoutMode", 0, true], ["approvalPurchases", 1, false],
    ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
    ["unknownCollectionExecution", 4, false], ["selling", 5, false],
    ["autonomousSelling", 6, false],
  ], "final feature flags");
  for (const [label, target, abi] of [
    ["policy global pause", contracts.policyModule.address, policyAbi],
    ["adapter global pause", contracts.adapterRegistry.address, adapterRegistryAbi],
    ["agent global pause", contracts.agentRegistry.address, agentRegistryAbi],
  ]) {
    const paused = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: target, abi, functionName: "globallyPaused" }, label);
    same(paused, false, "GLOBAL_PAUSE_CHANGED", label);
  }
  const policy = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "policy",
      args: [scope.account] }, "final Punk policy");
  requireTuple(policy, [
    ["configuredBy", 1, scope.owner], ["version", 2, EXPECTED_POLICY_VERSION],
    ["permissionGeneration", 3, EXPECTED_PERMISSION_GENERATION], ["accountPaused", 4, true],
  ], "final Punk policy");
  requireTuple(field(policy, "config", 0), [
    ["mode", 0, 0], ["maxSpendPerTransaction", 1, 0n], ["maxSpendPerDay", 2, 0n],
    ["maxSpendPerWeek", 3, 0n], ["maxMintPrice", 4, 0n],
    ["maxSecondaryPurchasePrice", 5, 0n], ["minimumNativeReserve", 6, 0n],
    ["maxAcquisitionsPerDay", 7, 1], ["maxIntentAge", 8, 120],
    ["maxSlippageBps", 9, 0], ["requireCollectionAllowlist", 10, true],
    ["allowUnknownCollections", 11, false],
  ], "final Punk policy config");
  const effectiveMode = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "effectiveMode",
      args: [scope.account] }, "final effective mode");
  same(effectiveMode, 0, "FINAL_STATE_MISMATCH", "final effective mode");
  const controls = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "mintControls",
      args: [scope.account] }, "final mint controls");
  requireTuple(controls, [
    ["ownerApprovedMints", 0, false], ["autonomousFreeMints", 1, false],
    ["autonomousPaidMints", 2, false],
  ], "final mint controls");
  for (const [functionName, args, expected] of [
    ["approvedAdapters", [scope.account, scope.adapter], false],
    ["approvedMintContracts", [scope.account, scope.venue], false],
    ["approvedCollections", [scope.account, scope.collection], false],
    ["deniedCollections", [scope.account, scope.collection], true],
    ["approvedSelectors", [scope.account, scope.selector], false],
    ["deniedSelectors", [scope.account, scope.selector], true],
  ]) {
    const actual = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: contracts.policyModule.address, abi: policyAbi, functionName, args },
      `final ${functionName}`);
    same(actual, expected, "PERMISSION_MISMATCH", `final ${functionName}`);
  }
  const currency = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "currencyPolicy",
      args: [scope.account, ZERO_ADDRESS] }, "final native currency policy");
  requireTuple(currency, [
    ["allowed", 0, false], ["maxSpendPerTransaction", 1, 0n], ["maxSpendPerDay", 2, 0n],
    ["maxSpendPerWeek", 3, 0n], ["maxMintPrice", 4, 0n],
    ["maxSecondaryPurchasePrice", 5, 0n],
  ], "final native currency policy");
  const venueMaximum = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "venueCurrencyMaximum",
      args: [scope.account, scope.venue, ZERO_ADDRESS] }, "final venue maximum");
  same(venueMaximum, 0n, "PERMISSION_MISMATCH", "final venue maximum");
  const adapter = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.adapterRegistry.address, abi: adapterRegistryAbi,
      functionName: "adapterRecord", args: [scope.adapter] }, "final adapter record");
  requireTuple(adapter, [
    ["kind", 0, 1], ["active", 1, false], ["venue", 2, scope.venue],
    ["adapterCodeHash", 3, contracts.adapter.runtimeCodeHash],
    ["venueCodeHash", 4, contracts.venue.runtimeCodeHash],
    ["versionHash", 5, scope.adapterVersionHash],
    ["metadataHash", 6, scope.adapterMetadataHash],
  ], "final adapter record");
  for (const [functionName, expected] of [
    ["kind", 1], ["venue", scope.venue], ["collection", scope.collection],
    ["mintSelector", scope.selector], ["assetStandard", 0],
  ]) {
    const actual = await dualRead(primaryClient, secondaryClient, blockNumber,
      { address: scope.adapter, abi: mintAdapterAbi, functionName }, `final adapter ${functionName}`);
    same(actual, expected, "ADAPTER_MISMATCH", `final adapter ${functionName}`);
  }
  const nonce = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.account, abi: accountAbi, functionName: "acquisitionNonce" },
    "final acquisition nonce");
  const state = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.account, abi: accountAbi, functionName: "state" }, "final account state");
  same(nonce, EXPECTED_ACQUISITION_NONCE, "NONCE_MISMATCH", "final acquisition nonce");
  same(state, EXPECTED_ACCOUNT_STATE, "ACCOUNT_ACTIVITY_MISMATCH", "final account state");
  const usage = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: contracts.policyModule.address, abi: policyAbi, functionName: "acquisitionUsage",
      args: [scope.account] }, "final acquisition usage");
  const currentDay = blockTimestamp / 86_400n;
  const mintDay = context.mintReceipt.blockTimestamp / 86_400n;
  const expectedAcquisitionsToday = currentDay === mintDay ? 1n : 0n;
  same(uint(field(usage, "dayBucket", 0), "final acquisition day bucket"), currentDay,
    "ACCOUNT_ACTIVITY_MISMATCH", "final acquisition day bucket");
  same(uint(field(usage, "acquisitionsToday", 1), "final acquisitions today"),
    expectedAcquisitionsToday, "ACCOUNT_ACTIVITY_MISMATCH", "final acquisitions today");
  const nftOwner = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.collection, abi: erc721Abi, functionName: "ownerOf", args: [scope.artTokenId] },
    "canary NFT owner");
  same(address(nftOwner, "canary NFT owner"), scope.account, "NFT_OWNER_MISMATCH", "canary NFT owner");
  const nftBalance = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.collection, abi: erc721Abi, functionName: "balanceOf", args: [scope.account] },
    "canary NFT account balance");
  const nftApproval = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.collection, abi: erc721Abi, functionName: "getApproved", args: [scope.artTokenId] },
    "canary NFT approval");
  const operatorApproval = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.collection, abi: erc721Abi, functionName: "isApprovedForAll",
      args: [scope.account, scope.adapter] }, "canary NFT adapter operator approval");
  const minted = await dualRead(primaryClient, secondaryClient, blockNumber,
    { address: scope.collection, abi: erc721Abi, functionName: "minted" }, "canary minted flag");
  same(nftBalance, 1n, "NFT_OWNER_MISMATCH", "canary NFT account balance");
  same(address(nftApproval, "canary NFT approval", { allowZero: true }), ZERO_ADDRESS,
    "NFT_APPROVAL_MISMATCH", "canary NFT approval");
  same(operatorApproval, false, "NFT_APPROVAL_MISMATCH", "canary NFT adapter operator approval");
  same(minted, true, "NFT_OWNER_MISMATCH", "canary minted flag");
  return { acquisitionsToday: expectedAcquisitionsToday };
}

export async function attestCanaryFinalTeardown({
  teardownContext,
  primaryClient,
  secondaryClient,
  endpointOrigins,
  confirmations = 20,
  clock = () => Math.floor(Date.now() / 1_000),
}) {
  validateCanaryMintRpcDependencies({ primaryClient, secondaryClient, endpointOrigins });
  assertClient(primaryClient, "primaryClient");
  assertClient(secondaryClient, "secondaryClient");
  if (primaryClient === secondaryClient) fail("CLIENTS_NOT_INDEPENDENT", "clients are the same object");
  const primaryIdentity = clientIdentity(primaryClient);
  const secondaryIdentity = clientIdentity(secondaryClient);
  if (primaryIdentity && secondaryIdentity && primaryIdentity === secondaryIdentity) {
    fail("CLIENTS_NOT_INDEPENDENT", "clients identify the same RPC origin");
  }
  if (!Number.isSafeInteger(confirmations) || confirmations < 12 || confirmations > 128) {
    fail("INVALID_CONFIRMATIONS", "confirmations must be between 12 and 128");
  }
  if (typeof clock !== "function") fail("INVALID_TIME", "clock is invalid");
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) fail("INVALID_TIME", "clock returned an invalid time");
  const context = validateContext(teardownContext);
  if (BigInt(now) < context.mintReceipt.blockTimestamp
    || BigInt(now) - context.mintReceipt.blockTimestamp > BigInt(MAX_TEARDOWN_AGE_SECONDS)) {
    fail("STALE_TEARDOWN", "real time is outside the six-hour canary teardown window");
  }
  const chainId = await dual("chain ID", primaryClient, secondaryClient,
    (client) => client.getChainId());
  same(chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "live chain ID");
  const pinned = await establishPinnedBlock(primaryClient, secondaryClient, confirmations);
  if (context.mintReceipt.blockNumber > pinned.number) {
    fail("UNCONFIRMED_MINT", "mint receipt does not have the required confirmations");
  }
  const mintBlock = await dual("mint receipt block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: context.mintReceipt.blockNumber }));
  same(bytes32(mintBlock?.hash, "mint receipt block hash"), context.mintReceipt.blockHash,
    "MINT_RECEIPT_MISMATCH", "mint receipt block hash");
  same(rpcUint(mintBlock?.timestamp, "mint receipt block timestamp"),
    context.mintReceipt.blockTimestamp, "MINT_RECEIPT_MISMATCH", "mint receipt block timestamp");
  if (pinned.timestamp < context.mintReceipt.blockTimestamp
    || pinned.timestamp - context.mintReceipt.blockTimestamp > BigInt(MAX_TEARDOWN_AGE_SECONDS)
    || pinned.timestamp > BigInt(now) + 30n) {
    fail("STALE_TEARDOWN", "confirmed teardown evidence is outside the six-hour canary window");
  }
  await verifyMintAnchor({ context, primaryClient, secondaryClient, pinned });
  const receiptHistory = await verifyTeardownReceipts({
    context, primaryClient, secondaryClient, pinned,
  });
  const latest = await establishLatest(primaryClient, secondaryClient);
  if (latest.number < pinned.number || latest.timestamp < pinned.timestamp
    || latest.timestamp - context.mintReceipt.blockTimestamp > BigInt(MAX_TEARDOWN_AGE_SECONDS)) {
    fail("STALE_TEARDOWN", "latest final state is outside the six-hour canary window");
  }
  validateCanaryFinalTeardownTiming({
    nowSeconds: now,
    mintBlockTimestamp: context.mintReceipt.blockTimestamp,
    latestBlockTimestamp: latest.timestamp,
  });
  await verifyFullInterval({
    context, primaryClient, secondaryClient, latest, expectedLogs: receiptHistory.expectedLogs,
  });
  await verifyFinalState({ context, primaryClient, secondaryClient,
    blockNumber: pinned.number, blockTimestamp: pinned.timestamp });
  const latestState = await verifyFinalState({ context, primaryClient, secondaryClient,
    blockNumber: latest.number, blockTimestamp: latest.timestamp });
  for (const [index, block] of receiptHistory.receiptBlocks.entries()) {
    await recheckBlock(primaryClient, secondaryClient, block,
      `teardown receipt block ${index + 1}`);
  }
  await recheckBlock(primaryClient, secondaryClient, pinned, "confirmed pin");
  await recheckBlock(primaryClient, secondaryClient, {
    number: context.mintReceipt.blockNumber,
    hash: context.mintReceipt.blockHash,
    timestamp: context.mintReceipt.blockTimestamp,
  }, "mint receipt block");
  await recheckBlock(primaryClient, secondaryClient, latest, "latest common block");
  const checkedAt = clock();
  if (!Number.isSafeInteger(checkedAt) || checkedAt < now || checkedAt > now + 120) {
    fail("INVALID_TIME", "attestation clock moved unexpectedly");
  }
  validateCanaryFinalTeardownTiming({
    nowSeconds: checkedAt,
    mintBlockTimestamp: context.mintReceipt.blockTimestamp,
    latestBlockTimestamp: latest.timestamp,
  });
  const attestation = {
    schema: CANARY_FINAL_TEARDOWN_ATTESTATION_SCHEMA,
    status: CANARY_FINAL_TEARDOWN_PASS,
    readOnly: true,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    chainId: ROBINHOOD.chainId,
    evidenceHashes: Object.freeze({
      algorithms: Object.freeze({
        canonicalArtifacts: "SHA256_CANONICAL_JSON_V1",
        configBundleReviewKeccak256: "KECCAK256_CANONICAL_JSON_V1",
      }),
      ...context.evidenceHashes,
    }),
    confirmedBlock: Object.freeze({
      number: pinned.number.toString(),
      hash: pinned.hash,
      timestamp: pinned.timestamp.toString(),
      confirmations,
    }),
    latestFinalCheck: Object.freeze({
      number: latest.number.toString(),
      hash: latest.hash,
      timestamp: latest.timestamp.toString(),
      primaryHead: latest.primaryHead.toString(),
      secondaryHead: latest.secondaryHead.toString(),
      headSkew: latest.skew.toString(),
    }),
    punk: Object.freeze({
      tokenId: context.scope.punkTokenId.toString(),
      account: context.scope.account,
      currentOwner: context.scope.owner,
      ownerType: "EOA",
    }),
    acquisition: Object.freeze({
      mintTransactionHash: context.mintReceipt.transactionHash,
      collection: context.scope.collection,
      tokenId: context.scope.artTokenId.toString(),
      nftOwner: context.scope.account,
      acquisitionNonce: EXPECTED_ACQUISITION_NONCE.toString(),
      accountState: EXPECTED_ACCOUNT_STATE.toString(),
      acquisitionsTodayAtLatest: latestState.acquisitionsToday.toString(),
      persistentAcquisitionHistoryProvenByNonceStateAndBoundMintReceipt: true,
    }),
    teardownHistory: Object.freeze({
      status: "EXACT_11_ORDERED_TX_RECEIPTS_AND_TARGET_EVENTS_DUAL_RPC_VERIFIED",
      transactionCount: TEARDOWN_CALL_COUNT,
      guardianExecutionPath: receiptHistory.guardianIsContract
        ? "SAFE_OR_CONTRACT_LOGICAL_CALLER_TARGET_EVENTS_VERIFIED"
        : "DIRECT_GUARDIAN_EOA",
      startsStrictlyAfterMintReceipt: true,
      strictlyOrderedDistinctTransactions: true,
      noExtraRelevantMutationEventsThroughLatest: true,
      noPunkAccountEmittedProtocolActivityAfterMint: true,
      noControllingPunkTransferAfterMint: true,
      noSelectedAccountAgentHistory: true,
      noUnexpectedGlobalAgentRegistryMutationHistory: true,
      completeSafeBatchInspectionStillRequired: receiptHistory.guardianIsContract,
    }),
    finalState: Object.freeze({
      brokerMode: "DISABLED",
      accountPaused: true,
      approvalPurchases: false,
      autonomousPurchases: false,
      autonomousMints: false,
      unknownCollectionExecution: false,
      selling: false,
      autonomousSelling: false,
      adapterActive: false,
      ownerApprovedMints: false,
      autonomousFreeMints: false,
      autonomousPaidMints: false,
      adapterAllowed: false,
      mintVenueAllowed: false,
      collectionAllowed: false,
      collectionDenied: true,
      selectorAllowed: false,
      selectorDenied: true,
      currencyAllowed: false,
      venueMaximumWei: "0",
      policyVersion: EXPECTED_POLICY_VERSION.toString(),
      permissionGeneration: EXPECTED_PERMISSION_GENERATION.toString(),
      policyGloballyPaused: false,
      adapterGloballyPaused: false,
      agentGloballyPaused: false,
    }),
    timing: Object.freeze({
      checkedAt: checkedAt.toString(),
      maximumAgeSeconds: MAX_TEARDOWN_AGE_SECONDS,
      ageFromMintSeconds: (latest.timestamp - context.mintReceipt.blockTimestamp).toString(),
    }),
    limitations: Object.freeze([
      "A Safe guardian receipt proves target-contract authorization and exact target events; every Safe signer must still inspect the complete Safe transaction or batch for unrelated actions.",
      "The ordinary teardown verifies protocol-wide pauses remain false; it does not activate either emergency global pause.",
      "The account-activity interval covers protocol events emitted by the Punk Account; it does not prove the absence of direct token receipts or forced native-currency transfers.",
      "This artifact is read-only evidence and cannot authorize, sign, submit, or reverse a transaction.",
      "The unkeyed attestation SHA-256 detects accidental edits; it does not authenticate the identity of the attestor operator.",
    ]),
  };
  return deepFreeze({
    ...attestation,
    attestationSha256: canonicalSha256(attestation),
  });
}

/**
 * Verifies canonical body integrity only. The hash is unkeyed and does not
 * authenticate the operator or replace a fresh semantic live attestation run.
 */
export function validateCanaryFinalTeardownAttestationHash(artifactValue) {
  const artifact = snapshot(artifactValue, "final teardown attestation artifact");
  if (!Object.hasOwn(artifact, "attestationSha256")) {
    fail("INVALID_ATTESTATION", "final teardown attestation hash is missing");
  }
  const supplied = bytes32(artifact.attestationSha256, "final teardown attestation hash");
  delete artifact.attestationSha256;
  same(supplied, canonicalSha256(artifact), "ATTESTATION_HASH_MISMATCH",
    "final teardown attestation hash");
  if (artifact.schema !== "GOGH_OWNER_DIRECT_CANARY_FINAL_TEARDOWN_ATTESTATION_V1"
    || artifact.status !== "READ_ONLY_FINAL_TEARDOWN_PASS"
    || artifact.readOnly !== true || artifact.transactionAuthorized !== false
    || artifact.signingPerformed !== false || artifact.submissionPerformed !== false
    || artifact.chainWritePerformed !== false) {
    fail("INVALID_ATTESTATION", "artifact is not the canonical read-only final teardown pass");
  }
  return deepFreeze({ ...artifact, attestationSha256: supplied });
}

export const CANARY_FINAL_TEARDOWN_CONSTANTS = Object.freeze({
  expectedPolicyVersion: EXPECTED_POLICY_VERSION,
  expectedPermissionGeneration: EXPECTED_PERMISSION_GENERATION,
  expectedAcquisitionNonce: EXPECTED_ACQUISITION_NONCE,
  expectedAccountState: EXPECTED_ACCOUNT_STATE,
  maximumAgeSeconds: MAX_TEARDOWN_AGE_SECONDS,
  maximumLatestBlockAgeSeconds: MAX_LATEST_BLOCK_AGE_SECONDS,
  callCount: TEARDOWN_CALL_COUNT,
});
