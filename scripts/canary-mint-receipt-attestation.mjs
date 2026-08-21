import { createHash } from "node:crypto";
import { decodeEventLog, keccak256 } from "viem";
import { ROBINHOOD, normalizeAddress } from "../broker/src/config.mjs";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import {
  validateCanaryExecutionArtifactEnvelope,
  validateCanaryExecutionReceiptEvidence,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import {
  buildOwnerDirectFreeMintExecutionArtifact,
  canonicalSha256,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";
import { LIVE_APPROVAL_PREFLIGHT_ABIS } from "./canary-approval-live-preflight.mjs";
import {
  dualCanaryMintRead,
  establishCanaryMintConfirmedPin,
  recheckCanaryMintBlock,
  validateCanaryMintRpcDependencies,
} from "./canary-mint-rpc-helper.mjs";

export const CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA =
  "GOGH_OWNER_DIRECT_CANARY_MINT_RECEIPT_ATTESTATION_V1";
export const CANARY_MINT_RECEIPT_PASS = "READ_ONLY_MINT_RECEIPT_PASS";
export const DEFAULT_CANARY_MINT_CONFIRMATIONS = 20;
export const CANARY_MINT_MAX_PIN_AGE_SECONDS = 300;
export const CANARY_MINT_MAX_ATTESTATION_SECONDS = 120;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const EMPTY_CODE = "0x";
const MINT_SELECTOR = "0x40c10f19";
const CORE_NAMES = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_NAMES = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);
const EIP1967_SLOTS = Object.freeze({
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
});

const transferEvent = {
  type: "event", name: "Transfer", inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
};
const erc721ReceivedEvent = {
  type: "event", name: "ERC721Received", inputs: [
    { name: "collection", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "from", type: "address", indexed: true },
    { name: "operator", type: "address", indexed: false },
    { name: "state", type: "uint256", indexed: false },
  ],
};
const acquisitionExecutedEvent = LIVE_APPROVAL_PREFLIGHT_ABIS.accountActivityEventAbi
  .find((item) => item.name === "AcquisitionExecuted");
const acquisitionConsumedEvent = LIVE_APPROVAL_PREFLIGHT_ABIS.policyMutationEventAbi
  .find((item) => item.name === "AcquisitionPolicyConsumed");

const erc721Abi = Object.freeze([
  { type: "function", name: "minted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getApproved", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "punkAccountRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "punkAccount", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "controllingPunkTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canaryTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
]);
const adapterAbi = Object.freeze([
  ...LIVE_APPROVAL_PREFLIGHT_ABIS.mintAdapterAbi,
  { type: "function", name: "canaryCollection", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "boundAccount", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "boundTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
]);
const policyUsageAbi = Object.freeze([
  {
    type: "function", name: "usage", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }], outputs: [{
      type: "tuple", components: [
        { name: "dayBucket", type: "uint64" }, { name: "weekBucket", type: "uint64" },
        { name: "acquisitionsToday", type: "uint32" }, { name: "spentToday", type: "uint256" },
        { name: "spentThisWeek", type: "uint256" },
      ],
    }],
  },
]);

export class CanaryMintReceiptAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryMintReceiptAttestationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryMintReceiptAttestationError(code, message);
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
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_PROTOTYPE", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("UNKNOWN_FIELD", `${label} has a symbol field`);
  }
  if (array && (keys.length !== value.length + 1
    || keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
    fail("INVALID_SCHEMA", `${label} must be a dense plain array`);
  }
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable
      || !Object.hasOwn(descriptor, "value")) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not an enumerable data field`);
    }
    assertJsonData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function snapshot(value, label, maximumBytes = 24_000_000) {
  assertJsonData(value, label);
  let cloned;
  try { cloned = structuredClone(value); } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy or uncloneable value`);
  }
  assertJsonData(cloned, `${label} snapshot`);
  let serialized;
  try { serialized = canonicalJson(cloned); } catch {
    fail("INVALID_SCHEMA", `${label} is not canonical JSON data`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("INPUT_TOO_LARGE", `${label} exceeds its size limit`);
  }
  return JSON.parse(serialized);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("UNKNOWN_FIELD", `${label} fields do not match the canonical schema`);
  }
}

function own(value, key, label) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    fail("INVALID_RPC_RESPONSE", `${label} is missing`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
    fail("INVALID_RPC_RESPONSE", `${label}.${String(key)} is not an own data field`);
  }
  return descriptor.value;
}

function optionalOwn(value, key, label) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    fail("INVALID_RPC_RESPONSE", `${label} is missing`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
    fail("INVALID_RPC_RESPONSE", `${label}.${String(key)} is not an own data field`);
  }
  return descriptor.value;
}

function tuple(value, name, index, label) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    fail("INVALID_RPC_RESPONSE", `${label} is not a tuple`);
  }
  if (Object.hasOwn(value, name)) return own(value, name, label);
  if (Object.hasOwn(value, index)) return own(value, index, label);
  fail("INVALID_RPC_RESPONSE", `${label}.${name} is missing`);
}

function uint(value, label) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  fail("INVALID_INTEGER", `${label} must be an unsigned integer`);
}

function address(value, label, { zero = false } = {}) {
  let normalized;
  try { normalized = normalizeAddress(value, label); } catch {
    fail("INVALID_ADDRESS", `${label} must be an EVM address`);
  }
  if (!zero && normalized === ZERO_ADDRESS) fail("ZERO_ADDRESS", `${label} cannot be zero`);
  return normalized;
}

function bytes32(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be bytes32`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === ZERO_WORD) fail("ZERO_HASH", `${label} cannot be zero`);
  return normalized;
}

function hex(value, label, { empty = true } = {}) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)
    || (!empty && value === "0x")) {
    fail("INVALID_HEX", `${label} must be canonical byte-aligned hex`);
  }
  return value.toLowerCase();
}

function same(actual, expected, code, label) {
  const left = typeof actual === "bigint" ? actual.toString()
    : typeof actual === "string" ? actual.toLowerCase() : actual;
  const right = typeof expected === "bigint" ? expected.toString()
    : typeof expected === "string" ? expected.toLowerCase() : expected;
  if (left !== right) fail(code, `${label} differs from the reviewed value`);
}

function bool(value, expected, label) {
  if (value !== expected) fail("STATE_MISMATCH", `${label} must be ${expected}`);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function canonicalCanaryMintAttestationSha256(value) {
  const safe = snapshot(value, "mint attestation hash input");
  return `0x${createHash("sha256").update(canonicalJson(safe)).digest("hex")}`;
}

function normalizeLog(log, label) {
  const topics = own(log, "topics", label);
  if (!Array.isArray(topics) || Object.getPrototypeOf(topics) !== Array.prototype
    || topics.length < 1 || topics.length > 4) {
    fail("INVALID_LOG", `${label}.topics is malformed`);
  }
  const removed = optionalOwn(log, "removed", label);
  if (removed === true) fail("REMOVED_LOG", `${label} is marked removed`);
  if (removed !== undefined && removed !== false) {
    fail("INVALID_LOG", `${label}.removed must be false or omitted`);
  }
  return {
    address: address(own(log, "address", label), `${label}.address`),
    blockHash: bytes32(own(log, "blockHash", label), `${label}.blockHash`),
    blockNumber: uint(own(log, "blockNumber", label), `${label}.blockNumber`),
    data: hex(own(log, "data", label), `${label}.data`),
    logIndex: uint(own(log, "logIndex", label), `${label}.logIndex`),
    removed: false,
    topics: topics.map((topic, index) => bytes32(topic, `${label}.topics[${index}]`, { zero: true })),
    transactionHash: bytes32(own(log, "transactionHash", label), `${label}.transactionHash`),
    transactionIndex: uint(own(log, "transactionIndex", label), `${label}.transactionIndex`),
  };
}

function transactionView(transaction) {
  return {
    hash: bytes32(own(transaction, "hash", "transaction"), "transaction.hash"),
    from: address(own(transaction, "from", "transaction"), "transaction.from"),
    to: address(own(transaction, "to", "transaction"), "transaction.to"),
    value: uint(own(transaction, "value", "transaction"), "transaction.value"),
    input: hex(own(transaction, "input", "transaction"), "transaction.input", { empty: false }),
    blockHash: bytes32(own(transaction, "blockHash", "transaction"), "transaction.blockHash"),
    blockNumber: uint(own(transaction, "blockNumber", "transaction"), "transaction.blockNumber"),
    transactionIndex: uint(own(transaction, "transactionIndex", "transaction"),
      "transaction.transactionIndex"),
    nonce: uint(own(transaction, "nonce", "transaction"), "transaction.nonce"),
  };
}

function receiptView(receipt) {
  const logs = own(receipt, "logs", "receipt");
  if (!Array.isArray(logs) || Object.getPrototypeOf(logs) !== Array.prototype
    || logs.length !== 4 || Reflect.ownKeys(logs).length !== 5) {
    fail("UNEXPECTED_RECEIPT_LOGS", "mint receipt must contain exactly four dense logs");
  }
  const contractAddress = own(receipt, "contractAddress", "receipt");
  if (contractAddress !== null) fail("INVALID_RECEIPT", "mint receipt cannot create a contract");
  const status = own(receipt, "status", "receipt");
  if (status !== "success" && status !== 1 && status !== 1n && status !== "0x1") {
    fail("FAILED_TRANSACTION", "mint transaction receipt is not successful");
  }
  return {
    transactionHash: bytes32(own(receipt, "transactionHash", "receipt"),
      "receipt.transactionHash"),
    from: address(own(receipt, "from", "receipt"), "receipt.from"),
    to: address(own(receipt, "to", "receipt"), "receipt.to"),
    blockHash: bytes32(own(receipt, "blockHash", "receipt"), "receipt.blockHash"),
    blockNumber: uint(own(receipt, "blockNumber", "receipt"), "receipt.blockNumber"),
    transactionIndex: uint(own(receipt, "transactionIndex", "receipt"),
      "receipt.transactionIndex"),
    status: "success",
    contractAddress,
    logs: logs.map((log, index) => normalizeLog(log, `receipt.logs[${index}]`)),
  };
}

function blockWithTransactionsView(block) {
  const transactions = own(block, "transactions", "receipt block");
  if (!Array.isArray(transactions) || Object.getPrototypeOf(transactions) !== Array.prototype) {
    fail("INVALID_BLOCK", "receipt block transactions are missing");
  }
  return {
    number: uint(own(block, "number", "receipt block"), "receipt block.number"),
    hash: bytes32(own(block, "hash", "receipt block"), "receipt block.hash"),
    parentHash: bytes32(own(block, "parentHash", "receipt block"), "receipt block.parentHash"),
    timestamp: uint(own(block, "timestamp", "receipt block"), "receipt block.timestamp"),
    transactions: transactions.map((item, index) => {
      if (typeof item === "string") return bytes32(item, `receipt block.transactions[${index}]`);
      return bytes32(own(item, "hash", `receipt block.transactions[${index}]`),
        `receipt block.transactions[${index}].hash`);
    }),
  };
}

async function dualReadContract(clients, request, label) {
  return dualCanaryMintRead(clients, label, (client) => client.readContract(request));
}

async function dualCode(clients, target, blockNumber, expectedHash, label) {
  const code = await dualCanaryMintRead(clients, `${label} runtime`, async (client) => (
    hex((await client.getCode({ address: target, blockNumber })) ?? EMPTY_CODE,
      `${label} runtime`)
  ));
  if (code === EMPTY_CODE) fail("MISSING_CODE", `${label} has no runtime code`);
  const observed = keccak256(code).toLowerCase();
  same(observed, expectedHash, "CODE_HASH_MISMATCH", `${label} runtime hash`);
  return observed;
}

async function dualNoProxySlots(clients, target, blockNumber, label) {
  const values = {};
  await Promise.all(Object.entries(EIP1967_SLOTS).map(async ([name, slot]) => {
    const value = await dualCanaryMintRead(clients, `${label} ${name} proxy slot`, async (client) => {
      const observed = await client.getStorageAt({ address: target, slot, blockNumber });
      if (observed === undefined || observed === null || observed === "0x") return ZERO_WORD;
      const normalized = hex(observed, `${label} ${name} proxy slot`);
      if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
        fail("INVALID_STORAGE", `${label} ${name} proxy slot is not bytes32`);
      }
      return normalized;
    });
    if (value !== ZERO_WORD) fail("PROXY_DETECTED", `${label} has a nonzero EIP-1967 ${name} slot`);
    values[name] = value;
  }));
  return freeze(values);
}

function requireTuple(value, expectations, label) {
  for (const [name, index, expected] of expectations) {
    const actual = tuple(value, name, index, label);
    if (typeof expected === "bigint") same(uint(actual, `${label}.${name}`), expected,
      "STATE_MISMATCH", `${label}.${name}`);
    else if (typeof expected === "string" && expected.startsWith("0x")
      && expected.length === 42) same(address(actual, `${label}.${name}`, { zero: true }), expected,
      "STATE_MISMATCH", `${label}.${name}`);
    else same(actual, expected, "STATE_MISMATCH", `${label}.${name}`);
  }
}

async function readRuntimeAndProxyState(clients, expected, blockNumber, label) {
  const entries = [
    ...CORE_NAMES.map((name) => [name, expected.core.contracts[name].address,
      expected.core.contracts[name].runtimeBytecodeHash]),
    ["CanonicalERC6551Registry", ROBINHOOD.canonicalERC6551Registry,
      ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash],
    ["PunkAccount", expected.execution.to, expected.execution.hashes.punkAccountRuntimeCode],
    ["GoghOneShotCanaryArt", expected.execution.collection,
      expected.execution.hashes.collectionRuntimeCode],
    ["GoghOneShotCanaryMintAdapter", expected.execution.adapter,
      expected.execution.hashes.adapterRuntimeCode],
  ];
  const output = {};
  await Promise.all(entries.map(async ([name, target, runtimeHash]) => {
    output[name] = {
      address: target,
      runtimeCodeHash: await dualCode(clients, target, blockNumber, runtimeHash,
        `${label} ${name}`),
      eip1967Slots: await dualNoProxySlots(clients, target, blockNumber, `${label} ${name}`),
    };
  }));
  return freeze(output);
}

async function readExactSecurityState(clients, expected, blockNumber, blockTimestamp, label) {
  const { execution, core, configBundle } = expected;
  const account = execution.to;
  const owner = execution.from;
  const policy = core.contracts.BrokerPolicyModule.address;
  const agentRegistry = core.contracts.ArtAgentRegistry.address;
  const adapterRegistry = core.contracts.ArtAdapterRegistry.address;
  const accountRegistry = core.contracts.GoghPunkAccountRegistry.address;
  const implementation = core.contracts.GoghPunkAccountV1.address;
  const collection = execution.collection;
  const adapter = execution.adapter;
  const tokenId = BigInt(execution.tokenId);
  const punkTokenId = BigInt(execution.punkTokenId);
  const accountAbi = LIVE_APPROVAL_PREFLIGHT_ABIS.accountAbi;
  const policyAbi = [...LIVE_APPROVAL_PREFLIGHT_ABIS.policyAbi, ...policyUsageAbi];
  const adapterRegistryAbi = LIVE_APPROVAL_PREFLIGHT_ABIS.adapterRegistryAbi;

  const requests = {
    punkOwner: [ROBINHOOD.canonicalCollection, LIVE_APPROVAL_PREFLIGHT_ABIS.punkAbi,
      "ownerOf", [punkTokenId]],
    accountOwner: [account, accountAbi, "owner", []],
    accountToken: [account, accountAbi, "token", []],
    accountCanonical: [account, accountAbi, "isCanonicalGoghPunkAccount", []],
    accountPolicy: [account, accountAbi, "policyModule", []],
    accountAgents: [account, accountAbi, "agentRegistry", []],
    accountAdapters: [account, accountAbi, "adapterRegistry", []],
    nonce: [account, accountAbi, "acquisitionNonce", []],
    state: [account, accountAbi, "state", []],
    registryChain: [accountRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.accountRegistryAbi,
      "ROBINHOOD_CHAIN_ID", []],
    registryCollection: [accountRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.accountRegistryAbi,
      "GOGH_PUNKS", []],
    registryCanonical: [accountRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.accountRegistryAbi,
      "CANONICAL_ERC6551_REGISTRY", []],
    registryImplementation: [accountRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.accountRegistryAbi,
      "implementation", []],
    registryAccount: [accountRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.accountRegistryAbi,
      "account", [punkTokenId]],
    canonicalAccount: [ROBINHOOD.canonicalERC6551Registry,
      LIVE_APPROVAL_PREFLIGHT_ABIS.canonicalRegistryAbi, "account",
      [implementation, core.accountSalt, BigInt(ROBINHOOD.chainId),
        ROBINHOOD.canonicalCollection, punkTokenId]],
    policyPaused: [policy, policyAbi, "globallyPaused", []],
    policyOwner: [policy, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi, "owner", []],
    policyPendingOwner: [policy, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi, "pendingOwner", []],
    features: [policy, policyAbi, "featureFlags", []],
    policyState: [policy, policyAbi, "policy", [account]],
    effectiveMode: [policy, policyAbi, "effectiveMode", [account]],
    mintControls: [policy, policyAbi, "mintControls", [account]],
    adapterAllowed: [policy, policyAbi, "approvedAdapters", [account, adapter]],
    mintAllowed: [policy, policyAbi, "approvedMintContracts", [account, collection]],
    collectionAllowed: [policy, policyAbi, "approvedCollections", [account, collection]],
    collectionDenied: [policy, policyAbi, "deniedCollections", [account, collection]],
    selectorAllowed: [policy, policyAbi, "approvedSelectors", [account, MINT_SELECTOR]],
    selectorDenied: [policy, policyAbi, "deniedSelectors", [account, MINT_SELECTOR]],
    currencyPolicy: [policy, policyAbi, "currencyPolicy", [account, ZERO_ADDRESS]],
    venueMaximum: [policy, policyAbi, "venueCurrencyMaximum", [account, collection, ZERO_ADDRESS]],
    usage: [policy, policyAbi, "usage", [account, ZERO_ADDRESS]],
    acquisitionUsage: [policy, policyAbi, "acquisitionUsage", [account]],
    adapterRegistryPaused: [adapterRegistry, adapterRegistryAbi, "globallyPaused", []],
    adapterRegistryOwner: [adapterRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi, "owner", []],
    adapterRegistryPendingOwner: [adapterRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi,
      "pendingOwner", []],
    agentRegistryPaused: [agentRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.agentRegistryAbi,
      "globallyPaused", []],
    agentRegistryOwner: [agentRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi, "owner", []],
    agentRegistryPendingOwner: [agentRegistry, LIVE_APPROVAL_PREFLIGHT_ABIS.ownerAbi,
      "pendingOwner", []],
    adapterRecord: [adapterRegistry, adapterRegistryAbi, "adapterRecord", [adapter]],
    adapterKind: [adapter, adapterAbi, "kind", []],
    adapterVenue: [adapter, adapterAbi, "venue", []],
    adapterCollection: [adapter, adapterAbi, "collection", []],
    adapterSelector: [adapter, adapterAbi, "mintSelector", []],
    adapterStandard: [adapter, adapterAbi, "assetStandard", []],
    adapterCanaryCollection: [adapter, adapterAbi, "canaryCollection", []],
    adapterBoundAccount: [adapter, adapterAbi, "boundAccount", []],
    adapterBoundTokenId: [adapter, adapterAbi, "boundTokenId", []],
    artMinted: [collection, erc721Abi, "minted", []],
    artOwner: [collection, erc721Abi, "ownerOf", [tokenId]],
    artBalance: [collection, erc721Abi, "balanceOf", [account]],
    artApproved: [collection, erc721Abi, "getApproved", [tokenId]],
    artOperatorApproval: [collection, erc721Abi, "isApprovedForAll", [account, adapter]],
    artRegistry: [collection, erc721Abi, "punkAccountRegistry", []],
    artAccount: [collection, erc721Abi, "punkAccount", []],
    artPunkTokenId: [collection, erc721Abi, "controllingPunkTokenId", []],
    artTokenId: [collection, erc721Abi, "canaryTokenId", []],
  };
  const values = Object.fromEntries(await Promise.all(Object.entries(requests).map(
    async ([name, [target, abi, functionName, args]]) => [name, await dualReadContract(clients, {
      address: target, abi, functionName, args, blockNumber,
    }, `${label} ${name}`)],
  )));

  same(address(values.punkOwner, `${label} Punk owner`), owner, "OWNER_MISMATCH",
    `${label} Punk owner`);
  same(address(values.accountOwner, `${label} account owner`), owner, "OWNER_MISMATCH",
    `${label} account owner`);
  requireTuple(values.accountToken, [
    ["chainId", 0, BigInt(ROBINHOOD.chainId)],
    ["tokenContract", 1, ROBINHOOD.canonicalCollection],
    ["tokenId", 2, punkTokenId],
  ], `${label} account footer`);
  bool(values.accountCanonical, true, `${label} canonical account`);
  same(address(values.accountPolicy, `${label} account policy`), policy, "WIRING_MISMATCH",
    `${label} account policy`);
  same(address(values.accountAgents, `${label} account agents`), agentRegistry,
    "WIRING_MISMATCH", `${label} account agents`);
  same(address(values.accountAdapters, `${label} account adapters`), adapterRegistry,
    "WIRING_MISMATCH", `${label} account adapters`);
  same(uint(values.nonce, `${label} nonce`), 1n, "NONCE_MISMATCH", `${label} nonce`);
  same(uint(values.state, `${label} state`), expected.postMintState,
    "ACCOUNT_STATE_MISMATCH", `${label} state`);

  same(uint(values.registryChain, `${label} registry chain`), BigInt(ROBINHOOD.chainId),
    "REGISTRY_MISMATCH", `${label} registry chain`);
  same(address(values.registryCollection, `${label} registry collection`),
    ROBINHOOD.canonicalCollection, "REGISTRY_MISMATCH", `${label} registry collection`);
  same(address(values.registryCanonical, `${label} canonical registry`),
    ROBINHOOD.canonicalERC6551Registry, "REGISTRY_MISMATCH", `${label} canonical registry`);
  same(address(values.registryImplementation, `${label} implementation`), implementation,
    "REGISTRY_MISMATCH", `${label} registry implementation`);
  same(address(values.registryAccount, `${label} registry account`), account,
    "ACCOUNT_DERIVATION_MISMATCH", `${label} registry account`);
  same(address(values.canonicalAccount, `${label} canonical account derivation`), account,
    "ACCOUNT_DERIVATION_MISMATCH", `${label} canonical account derivation`);

  bool(values.policyPaused, false, `${label} policy pause`);
  bool(values.adapterRegistryPaused, false, `${label} adapter registry pause`);
  bool(values.agentRegistryPaused, false, `${label} agent registry pause`);
  for (const name of ["policyOwner", "adapterRegistryOwner", "agentRegistryOwner"]) {
    same(address(values[name], `${label} ${name}`), expected.guardian,
      "GUARDIAN_MISMATCH", `${label} ${name}`);
  }
  for (const name of [
    "policyPendingOwner", "adapterRegistryPendingOwner", "agentRegistryPendingOwner",
  ]) {
    same(address(values[name], `${label} ${name}`, { zero: true }), ZERO_ADDRESS,
      "PENDING_OWNER", `${label} ${name}`);
  }
  requireTuple(values.features, [
    ["scoutMode", 0, true], ["approvalPurchases", 1, true],
    ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
    ["unknownCollectionExecution", 4, false], ["selling", 5, false],
    ["autonomousSelling", 6, false],
  ], `${label} features`);
  const policyConfig = tuple(values.policyState, "config", 0, `${label} policy`);
  requireTuple(values.policyState, [
    ["configuredBy", 1, owner], ["version", 2, 11n],
    ["permissionGeneration", 3, 1n], ["accountPaused", 4, false],
  ], `${label} policy`);
  requireTuple(policyConfig, [
    ["mode", 0, 2], ["maxSpendPerTransaction", 1, 0n], ["maxSpendPerDay", 2, 0n],
    ["maxSpendPerWeek", 3, 0n], ["maxMintPrice", 4, 0n],
    ["maxSecondaryPurchasePrice", 5, 0n], ["minimumNativeReserve", 6, 0n],
    ["maxAcquisitionsPerDay", 7, 1], ["maxIntentAge", 8, 120],
    ["maxSlippageBps", 9, 0], ["requireCollectionAllowlist", 10, true],
    ["allowUnknownCollections", 11, false],
  ], `${label} policy config`);
  same(uint(values.effectiveMode, `${label} effective mode`), 2n, "POLICY_MISMATCH",
    `${label} effective mode`);
  requireTuple(values.mintControls, [
    ["ownerApprovedMints", 0, true], ["autonomousFreeMints", 1, false],
    ["autonomousPaidMints", 2, false],
  ], `${label} mint controls`);
  for (const [name, expectedValue] of [
    ["adapterAllowed", true], ["mintAllowed", true], ["collectionAllowed", true],
    ["collectionDenied", false], ["selectorAllowed", true], ["selectorDenied", false],
  ]) bool(values[name], expectedValue, `${label} ${name}`);
  requireTuple(values.currencyPolicy, [
    ["allowed", 0, true], ["maxSpendPerTransaction", 1, 0n],
    ["maxSpendPerDay", 2, 0n], ["maxSpendPerWeek", 3, 0n],
    ["maxMintPrice", 4, 0n], ["maxSecondaryPurchasePrice", 5, 0n],
  ], `${label} currency policy`);
  same(uint(values.venueMaximum, `${label} venue maximum`), 0n, "POLICY_MISMATCH",
    `${label} venue maximum`);

  const dayBucket = blockTimestamp / 86_400n;
  const weekBucket = blockTimestamp / 604_800n;
  const receiptDayBucket = expected.receiptTimestamp / 86_400n;
  const expectedAcquisitions = dayBucket === receiptDayBucket ? 1n : 0n;
  requireTuple(values.usage, [
    ["dayBucket", 0, dayBucket], ["weekBucket", 1, weekBucket],
    ["acquisitionsToday", 2, expectedAcquisitions], ["spentToday", 3, 0n],
    ["spentThisWeek", 4, 0n],
  ], `${label} usage`);
  requireTuple(values.acquisitionUsage, [
    ["dayBucket", 0, dayBucket], ["acquisitionsToday", 1, expectedAcquisitions],
  ], `${label} acquisition usage`);

  const commitment = configBundle.review.adapterRegistrationCommitment;
  requireTuple(values.adapterRecord, [
    ["kind", 0, 1], ["active", 1, true], ["venue", 2, collection],
    ["adapterCodeHash", 3, execution.hashes.adapterRuntimeCode],
    ["venueCodeHash", 4, execution.hashes.collectionRuntimeCode],
    ["versionHash", 5, commitment.versionHash], ["metadataHash", 6, commitment.metadataHash],
  ], `${label} adapter record`);
  same(uint(values.adapterKind, `${label} adapter kind`), 1n, "ADAPTER_MISMATCH",
    `${label} adapter kind`);
  same(address(values.adapterVenue, `${label} adapter venue`), collection,
    "ADAPTER_MISMATCH", `${label} adapter venue`);
  same(address(values.adapterCollection, `${label} adapter collection`), collection,
    "ADAPTER_MISMATCH", `${label} adapter collection`);
  same(hex(values.adapterSelector, `${label} adapter selector`), MINT_SELECTOR,
    "ADAPTER_MISMATCH", `${label} adapter selector`);
  same(uint(values.adapterStandard, `${label} adapter standard`), 0n,
    "ADAPTER_MISMATCH", `${label} adapter standard`);
  same(address(values.adapterCanaryCollection, `${label} adapter canary collection`), collection,
    "ADAPTER_MISMATCH", `${label} adapter canary collection`);
  same(address(values.adapterBoundAccount, `${label} adapter account`), account,
    "ADAPTER_MISMATCH", `${label} adapter account`);
  same(uint(values.adapterBoundTokenId, `${label} adapter token`), tokenId,
    "ADAPTER_MISMATCH", `${label} adapter token`);

  bool(values.artMinted, true, `${label} art minted`);
  same(address(values.artOwner, `${label} art owner`), account, "NFT_STATE_MISMATCH",
    `${label} art owner`);
  same(uint(values.artBalance, `${label} art balance`), 1n, "NFT_STATE_MISMATCH",
    `${label} art balance`);
  same(address(values.artApproved, `${label} art approval`, { zero: true }), ZERO_ADDRESS,
    "NFT_APPROVAL_MISMATCH", `${label} art approval`);
  bool(values.artOperatorApproval, false, `${label} art operator approval`);
  same(address(values.artRegistry, `${label} art registry`), accountRegistry,
    "CANARY_BINDING_MISMATCH", `${label} art registry`);
  same(address(values.artAccount, `${label} art account`), account,
    "CANARY_BINDING_MISMATCH", `${label} art account`);
  same(uint(values.artPunkTokenId, `${label} art Punk token`), punkTokenId,
    "CANARY_BINDING_MISMATCH", `${label} art Punk token`);
  same(uint(values.artTokenId, `${label} art token`), tokenId,
    "CANARY_BINDING_MISMATCH", `${label} art token`);

  const ownerCode = await dualCanaryMintRead(clients, `${label} owner code`, async (client) => (
    hex((await client.getCode({ address: owner, blockNumber })) ?? EMPTY_CODE,
      `${label} owner code`)
  ));
  if (ownerCode !== EMPTY_CODE) {
    fail("OWNER_NOT_EOA", `${label} current owner is not the reviewed EOA path`);
  }
  const nativeBalance = await dualCanaryMintRead(clients, `${label} account native balance`,
    (client) => client.getBalance({ address: account, blockNumber }));
  const runtimes = await readRuntimeAndProxyState(clients, expected, blockNumber, label);
  return freeze({
    blockNumber: blockNumber.toString(), blockTimestamp: blockTimestamp.toString(),
    owner, ownerType: "EOA_CURRENT_OWNER_ONLY", acquisitionNonce: "1",
    accountState: expected.postMintState.toString(), nativeBalance: uint(nativeBalance,
      `${label} native balance`).toString(),
    policy: { version: "11", permissionGeneration: "1", mode: "APPROVAL_REQUIRED",
      globallyPaused: false, accountPaused: false, acquisitionsToday: expectedAcquisitions.toString(),
      spentToday: "0", spentThisWeek: "0" },
    nft: { collection, tokenId: tokenId.toString(), owner: account, accountBalance: "1",
      approved: ZERO_ADDRESS, adapterApprovedForAll: false, minted: true },
    runtime: runtimes,
  });
}

function decodeExactEvent(log, event, expectedName, label) {
  let decoded;
  try { decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics, strict: true }); }
  catch { fail("UNEXPECTED_EVENT", `${label} is not the exact ${expectedName} event`); }
  if (decoded.eventName !== expectedName) {
    fail("UNEXPECTED_EVENT", `${label} is not ${expectedName}`);
  }
  return decoded.args;
}

function verifyReceiptLogs(receipt, expected) {
  const [consumedLog, transferLog, receivedLog, executedLog] = receipt.logs;
  const emitters = [expected.policy, expected.execution.collection,
    expected.execution.to, expected.execution.to];
  for (let index = 0; index < receipt.logs.length; index += 1) {
    const log = receipt.logs[index];
    same(log.address, emitters[index], "UNEXPECTED_LOG_EMITTER", `receipt log ${index} emitter`);
    same(log.transactionHash, expected.transactionHash, "RECEIPT_MISMATCH",
      `receipt log ${index} transaction`);
    same(log.blockHash, expected.receiptBlockHash, "RECEIPT_MISMATCH",
      `receipt log ${index} block hash`);
    same(log.blockNumber, expected.receiptBlockNumber, "RECEIPT_MISMATCH",
      `receipt log ${index} block number`);
    same(log.transactionIndex, expected.transactionIndex, "RECEIPT_MISMATCH",
      `receipt log ${index} transaction index`);
    if (index > 0 && log.logIndex !== receipt.logs[index - 1].logIndex + 1n) {
      fail("LOG_ORDER_MISMATCH", "receipt logs are not contiguous and ordered by logIndex");
    }
  }

  const consumed = decodeExactEvent(consumedLog, acquisitionConsumedEvent,
    "AcquisitionPolicyConsumed", "receipt log 0");
  same(address(consumed.account, "consumed account"), expected.execution.to,
    "EVENT_MISMATCH", "consumed account");
  same(bytes32(consumed.opportunityId, "consumed opportunity"), expected.execution.opportunityId,
    "EVENT_MISMATCH", "consumed opportunity");
  same(address(consumed.currency, "consumed currency", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "consumed currency");
  for (const [field, wanted] of [["amount", 0n], ["spentToday", 0n],
    ["spentThisWeek", 0n], ["acquisitionsToday", 1n], ["policyVersion", 11n]]) {
    same(uint(consumed[field], `consumed ${field}`), wanted, "EVENT_MISMATCH",
      `consumed ${field}`);
  }
  bool(consumed.ownerApproved, true, "consumed owner approval");

  const transfer = decodeExactEvent(transferLog, transferEvent, "Transfer", "receipt log 1");
  same(address(transfer.from, "mint transfer from", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "mint transfer from");
  same(address(transfer.to, "mint transfer to"), expected.execution.to,
    "EVENT_MISMATCH", "mint transfer to");
  same(uint(transfer.tokenId, "mint transfer token"), BigInt(expected.execution.tokenId),
    "EVENT_MISMATCH", "mint transfer token");

  const received = decodeExactEvent(receivedLog, erc721ReceivedEvent,
    "ERC721Received", "receipt log 2");
  same(address(received.collection, "received collection"), expected.execution.collection,
    "EVENT_MISMATCH", "received collection");
  same(uint(received.tokenId, "received token"), BigInt(expected.execution.tokenId),
    "EVENT_MISMATCH", "received token");
  same(address(received.from, "received from", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "received from");
  same(address(received.operator, "received operator"), expected.execution.to,
    "EVENT_MISMATCH", "received operator");
  same(uint(received.state, "received state"), expected.cleanState + 1n,
    "EVENT_MISMATCH", "received state");

  const executed = decodeExactEvent(executedLog, acquisitionExecutedEvent,
    "AcquisitionExecuted", "receipt log 3");
  const addressFields = [
    ["executor", expected.execution.from], ["collection", expected.execution.collection],
    ["adapter", expected.execution.adapter], ["venue", expected.execution.venue],
    ["currency", ZERO_ADDRESS],
  ];
  for (const [field, wanted] of addressFields) {
    same(address(executed[field], `executed ${field}`, { zero: field === "currency" }), wanted,
      "EVENT_MISMATCH", `executed ${field}`);
  }
  same(bytes32(executed.opportunityId, "executed opportunity"),
    expected.execution.opportunityId, "EVENT_MISMATCH", "executed opportunity");
  same(bytes32(executed.reasoningHash, "executed reasoning"), expected.execution.reasoningHash,
    "EVENT_MISMATCH", "executed reasoning");
  for (const [field, wanted] of [["opportunityType", 2n], ["assetStandard", 0n],
    ["tokenId", BigInt(expected.execution.tokenId)], ["assetAmount", 1n], ["price", 0n],
    ["policyVersion", 11n], ["nonce", 0n], ["state", expected.postMintState]]) {
    same(uint(executed[field], `executed ${field}`), wanted, "EVENT_MISMATCH",
      `executed ${field}`);
  }
  bool(executed.ownerApproved, true, "executed owner approval");

  return freeze({
    AcquisitionPolicyConsumed: { emitter: consumedLog.address,
      logIndex: consumedLog.logIndex.toString(), account: expected.execution.to,
      opportunityId: expected.execution.opportunityId, currency: ZERO_ADDRESS, amount: "0",
      spentToday: "0", spentThisWeek: "0", acquisitionsToday: "1",
      ownerApproved: true, policyVersion: "11" },
    Transfer: { emitter: transferLog.address, logIndex: transferLog.logIndex.toString(),
      from: ZERO_ADDRESS, to: expected.execution.to, tokenId: expected.execution.tokenId },
    ERC721Received: { emitter: receivedLog.address, logIndex: receivedLog.logIndex.toString(),
      collection: expected.execution.collection, tokenId: expected.execution.tokenId,
      from: ZERO_ADDRESS, operator: expected.execution.to,
      state: (expected.cleanState + 1n).toString() },
    AcquisitionExecuted: { emitter: executedLog.address,
      logIndex: executedLog.logIndex.toString(), executor: expected.execution.from,
      opportunityId: expected.execution.opportunityId, collection: expected.execution.collection,
      opportunityType: "FREE_MINT", assetStandard: "ERC721", adapter: expected.execution.adapter,
      venue: expected.execution.venue, tokenId: expected.execution.tokenId, assetAmount: "1",
      currency: ZERO_ADDRESS, price: "0", ownerApproved: true,
      reasoningHash: expected.execution.reasoningHash, policyVersion: "11", nonce: "0",
      state: expected.postMintState.toString() },
  });
}

async function verifyNoLogs(clients, request, label, permittedTransaction) {
  const logs = await dualCanaryMintRead(clients, label, async (client) => {
    const observed = await client.getLogs(request);
    if (!Array.isArray(observed) || Object.getPrototypeOf(observed) !== Array.prototype) {
      fail("INVALID_RPC_RESPONSE", `${label} did not return a plain log array`);
    }
    return observed.map((log, index) => normalizeLog(log, `${label}[${index}]`));
  });
  const unexpected = permittedTransaction ? logs.filter((log) => !(
    log.blockNumber === permittedTransaction.blockNumber
      && log.blockHash === permittedTransaction.blockHash
      && log.transactionHash === permittedTransaction.hash
      && log.transactionIndex === permittedTransaction.transactionIndex
  )) : logs;
  if (unexpected.length !== 0) {
    fail("POST_MINT_MUTATION", `${label} contains unexpected activity`);
  }
}

function validateAndBindArtifacts(inputValue) {
  const input = snapshot(inputValue, "mint receipt attestation input");
  exactKeys(input, [
    "proposalArtifact", "liveAttestation", "coreManifest", "canaryManifest",
    "configBundleArtifact", "configurationEvidenceArtifact", "executionArtifact",
    "executionReceiptEvidence",
  ], "mint receipt attestation input");
  const generatedAt = uint(input.executionArtifact?.generatedAt, "execution generatedAt");
  if (generatedAt > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_TIME", "execution generatedAt exceeds safe precision");
  }
  let rebuilt;
  try {
    rebuilt = buildOwnerDirectFreeMintExecutionArtifact({
      proposalArtifact: input.proposalArtifact,
      liveAttestation: input.liveAttestation,
      coreManifest: input.coreManifest,
      canaryManifest: input.canaryManifest,
      configBundleArtifact: input.configBundleArtifact,
      configurationEvidenceArtifact: input.configurationEvidenceArtifact,
    }, { nowSeconds: Number(generatedAt) });
  } catch (error) {
    fail(error?.code ?? "UPSTREAM_ARTIFACT_INVALID",
      error?.message ?? "upstream artifacts cannot rebuild the execution artifact");
  }
  if (canonicalJson(rebuilt) !== canonicalJson(input.executionArtifact)) {
    fail("EXECUTION_ARTIFACT_MISMATCH",
      "execution artifact is not the exact deterministic rebuild of all upstream artifacts");
  }
  let execution;
  let receiptEvidence;
  try {
    execution = validateCanaryExecutionArtifactEnvelope(input.executionArtifact);
    receiptEvidence = validateCanaryExecutionReceiptEvidence(
      input.executionReceiptEvidence,
      input.executionArtifact,
    );
    const coreAdoption = requireVerifiedManifestAdoption(input.coreManifest, CORE_NAMES);
    const canaryAdoption = requireVerifiedManifestAdoption(input.canaryManifest, CANARY_NAMES);
    same(sourceVerificationCanonicalSha256(coreAdoption),
      execution.hashes.coreSourceVerificationAdoption, "SOURCE_VERIFICATION_MISMATCH",
      "core source-verification adoption");
    same(sourceVerificationCanonicalSha256(canaryAdoption),
      execution.hashes.canarySourceVerificationAdoption, "SOURCE_VERIFICATION_MISMATCH",
      "canary source-verification adoption");
  } catch (error) {
    fail(error?.code ?? "UPSTREAM_ARTIFACT_INVALID",
      error?.message ?? "upstream receipt evidence is invalid");
  }
  const transactionHash = receiptEvidence.evidence.transaction.hash;
  const cleanState = uint(input.canaryManifest?.provenanceGate?.cleanPreconfigurationState
    ?.accountState, "clean preconfiguration account state");
  const postMintState = cleanState + 2n;
  const core = {
    accountSalt: bytes32(input.coreManifest.accountSalt, "core account salt", { zero: true }),
    contracts: Object.fromEntries(CORE_NAMES.map((name) => {
      const record = input.coreManifest.contracts[name];
      return [name, {
        address: address(record.address, `core ${name} address`),
        runtimeBytecodeHash: bytes32(record.runtimeBytecodeHash,
          `core ${name} runtime hash`),
      }];
    })),
  };
  const evidenceHashes = {
    coreManifestSha256: canonicalSha256(input.coreManifest),
    canaryManifestSha256: canonicalSha256(input.canaryManifest),
    coreSourceVerificationAdoptionSha256:
      execution.hashes.coreSourceVerificationAdoption,
    canarySourceVerificationAdoptionSha256:
      execution.hashes.canarySourceVerificationAdoption,
    proposalSha256: canonicalSha256(input.proposalArtifact.proposal),
    proposalArtifactSha256: canonicalSha256(input.proposalArtifact),
    configBundleReviewKeccak256: input.configBundleArtifact.bundleHash,
    configBundleArtifactSha256: canonicalSha256(input.configBundleArtifact),
    configurationReceiptEvidenceSha256:
      input.configurationEvidenceArtifact.evidenceHash,
    configurationReceiptEvidenceArtifactSha256:
      canonicalSha256(input.configurationEvidenceArtifact),
    liveAttestationSha256: canonicalSha256(input.liveAttestation),
    executionArtifactSha256: canonicalSha256(input.executionArtifact),
    executionReceiptEvidenceSha256: receiptEvidence.evidenceSha256,
    executionReceiptEvidenceArtifactSha256:
      canonicalSha256(input.executionReceiptEvidence),
  };
  const upstream = receiptEvidence.evidence.upstreamHashes;
  const comparisons = {
    coreManifestSha256: upstream.coreManifestSha256,
    canaryManifestSha256: upstream.canaryManifestSha256,
    coreSourceVerificationAdoptionSha256: upstream.coreSourceVerificationAdoptionSha256,
    canarySourceVerificationAdoptionSha256: upstream.canarySourceVerificationAdoptionSha256,
    proposalSha256: upstream.proposalSha256,
    proposalArtifactSha256: upstream.proposalArtifactSha256,
    configBundleReviewKeccak256: upstream.configBundleReviewKeccak256,
    configBundleArtifactSha256: upstream.configBundleArtifactSha256,
    configurationReceiptEvidenceSha256: upstream.configurationReceiptEvidenceSha256,
    configurationReceiptEvidenceArtifactSha256:
      upstream.configurationReceiptEvidenceArtifactSha256,
    liveAttestationSha256: upstream.liveAttestationSha256,
    executionArtifactSha256: receiptEvidence.evidence.executionArtifactSha256,
  };
  for (const [name, expectedHash] of Object.entries(comparisons)) {
    same(evidenceHashes[name], expectedHash, "EVIDENCE_HASH_MISMATCH", name);
  }
  return {
    input, execution, receiptEvidence, transactionHash, cleanState, postMintState, core,
    configBundle: input.configBundleArtifact, evidenceHashes,
    guardian: address(input.coreManifest.protocolGuardian, "core protocol guardian"),
  };
}

function validateSerializedState(state, expected, label, expectedAcquisitions) {
  exactKeys(state, [
    "blockNumber", "blockTimestamp", "owner", "ownerType", "acquisitionNonce",
    "accountState", "nativeBalance", "policy", "nft", "runtime",
  ], label);
  uint(state.blockNumber, `${label}.blockNumber`);
  uint(state.blockTimestamp, `${label}.blockTimestamp`);
  same(address(state.owner, `${label}.owner`), expected.execution.from,
    "OWNER_MISMATCH", `${label}.owner`);
  same(state.ownerType, "EOA_CURRENT_OWNER_ONLY", "BOUNDARY_MISMATCH", `${label}.ownerType`);
  same(uint(state.acquisitionNonce, `${label}.acquisitionNonce`), 1n,
    "NONCE_MISMATCH", `${label}.acquisitionNonce`);
  same(uint(state.accountState, `${label}.accountState`), expected.postMintState,
    "ACCOUNT_STATE_MISMATCH", `${label}.accountState`);
  uint(state.nativeBalance, `${label}.nativeBalance`);
  exactKeys(state.policy, [
    "version", "permissionGeneration", "mode", "globallyPaused", "accountPaused",
    "acquisitionsToday", "spentToday", "spentThisWeek",
  ], `${label}.policy`);
  same(state.policy.version, "11", "POLICY_MISMATCH", `${label}.policy.version`);
  same(state.policy.permissionGeneration, "1", "POLICY_MISMATCH",
    `${label}.policy.permissionGeneration`);
  same(state.policy.mode, "APPROVAL_REQUIRED", "POLICY_MISMATCH", `${label}.policy.mode`);
  bool(state.policy.globallyPaused, false, `${label}.policy.globallyPaused`);
  bool(state.policy.accountPaused, false, `${label}.policy.accountPaused`);
  same(state.policy.acquisitionsToday, expectedAcquisitions, "POLICY_MISMATCH",
    `${label}.policy.acquisitionsToday`);
  same(state.policy.spentToday, "0", "POLICY_MISMATCH", `${label}.policy.spentToday`);
  same(state.policy.spentThisWeek, "0", "POLICY_MISMATCH", `${label}.policy.spentThisWeek`);
  exactKeys(state.nft, [
    "collection", "tokenId", "owner", "accountBalance", "approved",
    "adapterApprovedForAll", "minted",
  ], `${label}.nft`);
  same(address(state.nft.collection, `${label}.nft.collection`), expected.execution.collection,
    "NFT_STATE_MISMATCH", `${label}.nft.collection`);
  same(state.nft.tokenId, expected.execution.tokenId, "NFT_STATE_MISMATCH",
    `${label}.nft.tokenId`);
  same(address(state.nft.owner, `${label}.nft.owner`), expected.execution.to,
    "NFT_STATE_MISMATCH", `${label}.nft.owner`);
  same(state.nft.accountBalance, "1", "NFT_STATE_MISMATCH", `${label}.nft.accountBalance`);
  same(address(state.nft.approved, `${label}.nft.approved`, { zero: true }), ZERO_ADDRESS,
    "NFT_APPROVAL_MISMATCH", `${label}.nft.approved`);
  bool(state.nft.adapterApprovedForAll, false, `${label}.nft.adapterApprovedForAll`);
  bool(state.nft.minted, true, `${label}.nft.minted`);
  const runtimeNames = [
    ...CORE_NAMES, "CanonicalERC6551Registry", "PunkAccount",
    "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
  ];
  exactKeys(state.runtime, runtimeNames, `${label}.runtime`);
  const runtimeExpected = {
    ...Object.fromEntries(CORE_NAMES.map((name) => [name, {
      address: expected.core.contracts[name].address,
      hash: expected.core.contracts[name].runtimeBytecodeHash,
    }])),
    CanonicalERC6551Registry: { address: ROBINHOOD.canonicalERC6551Registry,
      hash: ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash },
    PunkAccount: { address: expected.execution.to,
      hash: expected.execution.hashes.punkAccountRuntimeCode },
    GoghOneShotCanaryArt: { address: expected.execution.collection,
      hash: expected.execution.hashes.collectionRuntimeCode },
    GoghOneShotCanaryMintAdapter: { address: expected.execution.adapter,
      hash: expected.execution.hashes.adapterRuntimeCode },
  };
  for (const name of runtimeNames) {
    const record = state.runtime[name];
    exactKeys(record, ["address", "runtimeCodeHash", "eip1967Slots"],
      `${label}.runtime.${name}`);
    same(address(record.address, `${label}.runtime.${name}.address`),
      runtimeExpected[name].address, "CODE_HASH_MISMATCH", `${label}.runtime.${name}.address`);
    same(bytes32(record.runtimeCodeHash, `${label}.runtime.${name}.runtimeCodeHash`),
      runtimeExpected[name].hash, "CODE_HASH_MISMATCH",
      `${label}.runtime.${name}.runtimeCodeHash`);
    exactKeys(record.eip1967Slots, Object.keys(EIP1967_SLOTS),
      `${label}.runtime.${name}.eip1967Slots`);
    for (const slot of Object.keys(EIP1967_SLOTS)) {
      same(bytes32(record.eip1967Slots[slot], `${label}.${name}.${slot}`, { zero: true }),
        ZERO_WORD, "PROXY_DETECTED", `${label}.runtime.${name}.${slot}`);
    }
  }
}

export function validateCanaryMintReceiptAttestationArtifact(attestationValue, inputValue) {
  const attestation = snapshot(attestationValue, "mint receipt attestation artifact");
  const expected = validateAndBindArtifacts(inputValue);
  exactKeys(attestation, [
    "schema", "status", "chainId", "evidenceHashes", "transaction", "receipt",
    "confirmedPin", "events", "preMintState", "postMintState", "confirmedState",
    "continuity", "sourceVerification", "safetyBoundary",
  ], "mint receipt attestation artifact");
  if (attestation.schema !== CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA
    || attestation.status !== CANARY_MINT_RECEIPT_PASS || attestation.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_ATTESTATION", "mint receipt attestation identity is wrong");
  }
  exactKeys(attestation.evidenceHashes, Object.keys(expected.evidenceHashes), "evidenceHashes");
  if (canonicalJson(attestation.evidenceHashes) !== canonicalJson(expected.evidenceHashes)) {
    fail("EVIDENCE_HASH_MISMATCH", "mint attestation evidence hashes differ from upstream artifacts");
  }
  exactKeys(attestation.transaction, [
    "hash", "from", "to", "value", "data", "dataKeccak256", "nonce",
  ], "transaction");
  same(bytes32(attestation.transaction.hash, "transaction.hash"), expected.transactionHash,
    "TRANSACTION_MISMATCH", "transaction.hash");
  same(address(attestation.transaction.from, "transaction.from"), expected.execution.from,
    "OWNER_MISMATCH", "transaction.from");
  same(address(attestation.transaction.to, "transaction.to"), expected.execution.to,
    "TRANSACTION_MISMATCH", "transaction.to");
  same(uint(attestation.transaction.value, "transaction.value"), 0n,
    "NONZERO_PAYMENT", "transaction.value");
  same(hex(attestation.transaction.data, "transaction.data", { empty: false }),
    expected.execution.data, "CALLDATA_MISMATCH", "transaction.data");
  same(bytes32(attestation.transaction.dataKeccak256, "transaction.dataKeccak256"),
    expected.execution.dataKeccak256, "CALLDATA_HASH_MISMATCH", "transaction.dataKeccak256");
  uint(attestation.transaction.nonce, "transaction.nonce");

  exactKeys(attestation.receipt, [
    "status", "blockNumber", "blockHash", "blockTimestamp", "parentBlockHash",
    "transactionIndex", "logCount", "firstLogIndex", "lastLogIndex",
  ], "receipt");
  if (attestation.receipt.status !== "success" || attestation.receipt.logCount !== 4) {
    fail("INVALID_RECEIPT", "mint receipt status/log count is wrong");
  }
  const receiptNumber = uint(attestation.receipt.blockNumber, "receipt.blockNumber");
  const receiptHash = bytes32(attestation.receipt.blockHash, "receipt.blockHash");
  const receiptTimestamp = uint(attestation.receipt.blockTimestamp, "receipt.blockTimestamp");
  bytes32(attestation.receipt.parentBlockHash, "receipt.parentBlockHash");
  const transactionIndex = uint(attestation.receipt.transactionIndex,
    "receipt.transactionIndex");
  const firstLogIndex = uint(attestation.receipt.firstLogIndex, "receipt.firstLogIndex");
  const lastLogIndex = uint(attestation.receipt.lastLogIndex, "receipt.lastLogIndex");
  if (lastLogIndex !== firstLogIndex + 3n) {
    fail("LOG_ORDER_MISMATCH", "serialized mint log indexes are not contiguous");
  }
  const timing = expected.execution.artifact.reviewedAcquisition.timing;
  if (receiptTimestamp < BigInt(timing.createdAt) || receiptTimestamp > BigInt(timing.expiresAt)) {
    fail("STALE_EXECUTION", "serialized receipt timestamp is outside intent validity");
  }

  exactKeys(attestation.confirmedPin, [
    "number", "hash", "timestamp", "confirmations", "primaryHead", "secondaryHead",
    "headSkew", "checkedAt", "maximumAgeSeconds", "providerOrigins", "providerIndependence",
  ], "confirmedPin");
  const pinNumber = uint(attestation.confirmedPin.number, "confirmedPin.number");
  bytes32(attestation.confirmedPin.hash, "confirmedPin.hash");
  const pinTimestamp = uint(attestation.confirmedPin.timestamp, "confirmedPin.timestamp");
  const pinConfirmations = uint(attestation.confirmedPin.confirmations,
    "confirmedPin.confirmations");
  const primaryHead = uint(attestation.confirmedPin.primaryHead, "confirmedPin.primaryHead");
  const secondaryHead = uint(attestation.confirmedPin.secondaryHead, "confirmedPin.secondaryHead");
  const headSkew = uint(attestation.confirmedPin.headSkew, "confirmedPin.headSkew");
  const checkedAt = uint(attestation.confirmedPin.checkedAt, "confirmedPin.checkedAt");
  if (pinConfirmations < 12n || pinConfirmations > 128n || receiptNumber > pinNumber
    || pinTimestamp < receiptTimestamp || primaryHead - pinNumber < pinConfirmations
    || secondaryHead - pinNumber < pinConfirmations || headSkew > 8n) {
    fail("UNCONFIRMED_RECEIPT", "serialized confirmed pin is inconsistent");
  }
  const minimumHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const expectedSkew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (pinNumber !== minimumHead - pinConfirmations || headSkew !== expectedSkew) {
    fail("UNCONFIRMED_RECEIPT", "serialized pin math does not match both chain heads");
  }
  if (attestation.confirmedPin.maximumAgeSeconds !== CANARY_MINT_MAX_PIN_AGE_SECONDS
    || pinTimestamp > checkedAt + 30n
    || checkedAt - pinTimestamp > BigInt(CANARY_MINT_MAX_PIN_AGE_SECONDS)) {
    fail("STALE_RPC_PIN", "serialized confirmed pin lacks bounded wall-clock freshness");
  }
  if (!Array.isArray(attestation.confirmedPin.providerOrigins)
    || attestation.confirmedPin.providerOrigins.length !== 2
    || new Set(attestation.confirmedPin.providerOrigins).size !== 2) {
    fail("DUPLICATE_RPC", "serialized provider origins are not distinct");
  }
  for (const [index, origin] of attestation.confirmedPin.providerOrigins.entries()) {
    let url;
    try { url = new URL(origin); } catch { fail("INVALID_RPC_ORIGINS", `provider origin ${index}`); }
    if (url.protocol !== "https:" || url.origin !== origin || url.pathname !== "/"
      || url.username || url.password || url.search || url.hash) {
      fail("INVALID_RPC_ORIGINS", `provider origin ${index} is not canonical HTTPS`);
    }
  }
  const registrableDomain = (origin) => {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return hostname;
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    const compound = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
    const lastTwo = labels.slice(-2).join(".");
    return compound.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
  };
  if (registrableDomain(attestation.confirmedPin.providerOrigins[0])
    === registrableDomain(attestation.confirmedPin.providerOrigins[1])) {
    fail("DUPLICATE_RPC", "serialized providers use the same registrable domain");
  }
  same(attestation.confirmedPin.providerIndependence,
    "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS", "RPC_BOUNDARY_MISMATCH",
    "confirmedPin.providerIndependence");

  exactKeys(attestation.events, [
    "AcquisitionPolicyConsumed", "Transfer", "ERC721Received", "AcquisitionExecuted",
  ], "events");
  const eventKeys = {
    AcquisitionPolicyConsumed: ["emitter", "logIndex", "account", "opportunityId", "currency",
      "amount", "spentToday", "spentThisWeek", "acquisitionsToday", "ownerApproved",
      "policyVersion"],
    Transfer: ["emitter", "logIndex", "from", "to", "tokenId"],
    ERC721Received: ["emitter", "logIndex", "collection", "tokenId", "from", "operator", "state"],
    AcquisitionExecuted: ["emitter", "logIndex", "executor", "opportunityId", "collection",
      "opportunityType", "assetStandard", "adapter", "venue", "tokenId", "assetAmount",
      "currency", "price", "ownerApproved", "reasoningHash", "policyVersion", "nonce", "state"],
  };
  for (const [name, keys] of Object.entries(eventKeys)) exactKeys(attestation.events[name], keys,
    `events.${name}`);
  const eventIndexes = ["AcquisitionPolicyConsumed", "Transfer", "ERC721Received",
    "AcquisitionExecuted"].map((name) => uint(attestation.events[name].logIndex,
    `events.${name}.logIndex`));
  for (let index = 0; index < 4; index += 1) {
    same(eventIndexes[index], firstLogIndex + BigInt(index), "LOG_ORDER_MISMATCH",
      `events index ${index}`);
  }
  same(address(attestation.events.AcquisitionPolicyConsumed.emitter, "policy event emitter"),
    expected.core.contracts.BrokerPolicyModule.address, "EVENT_MISMATCH", "policy event emitter");
  same(address(attestation.events.Transfer.emitter, "Transfer emitter"), expected.execution.collection,
    "EVENT_MISMATCH", "Transfer emitter");
  same(address(attestation.events.ERC721Received.emitter, "received emitter"), expected.execution.to,
    "EVENT_MISMATCH", "received emitter");
  same(address(attestation.events.AcquisitionExecuted.emitter, "executed emitter"),
    expected.execution.to, "EVENT_MISMATCH", "executed emitter");
  const consumed = attestation.events.AcquisitionPolicyConsumed;
  same(address(consumed.account, "consumed account"), expected.execution.to,
    "EVENT_MISMATCH", "consumed account");
  same(bytes32(consumed.opportunityId, "consumed opportunity"), expected.execution.opportunityId,
    "EVENT_MISMATCH", "consumed opportunity");
  same(address(consumed.currency, "consumed currency", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "consumed currency");
  for (const [field, wanted] of [["amount", "0"], ["spentToday", "0"],
    ["spentThisWeek", "0"], ["acquisitionsToday", "1"], ["policyVersion", "11"]]) {
    same(consumed[field], wanted, "EVENT_MISMATCH", `consumed ${field}`);
  }
  bool(consumed.ownerApproved, true, "consumed ownerApproved");
  same(attestation.events.Transfer.tokenId, expected.execution.tokenId, "EVENT_MISMATCH",
    "Transfer tokenId");
  same(address(attestation.events.Transfer.from, "Transfer from", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "Transfer from");
  same(address(attestation.events.Transfer.to, "Transfer to"), expected.execution.to,
    "EVENT_MISMATCH", "Transfer to");
  const received = attestation.events.ERC721Received;
  same(address(received.collection, "received collection"), expected.execution.collection,
    "EVENT_MISMATCH", "received collection");
  same(received.tokenId, expected.execution.tokenId, "EVENT_MISMATCH", "received tokenId");
  same(address(received.from, "received from", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "received from");
  same(address(received.operator, "received operator"), expected.execution.to,
    "EVENT_MISMATCH", "received operator");
  same(received.state, (expected.cleanState + 1n).toString(), "EVENT_MISMATCH",
    "received state");
  const executed = attestation.events.AcquisitionExecuted;
  same(address(executed.executor, "executed executor"), expected.execution.from,
    "EVENT_MISMATCH", "executed executor");
  same(executed.opportunityId, expected.execution.opportunityId,
    "EVENT_MISMATCH", "executed opportunity");
  same(address(executed.collection, "executed collection"), expected.execution.collection,
    "EVENT_MISMATCH", "executed collection");
  same(executed.opportunityType, "FREE_MINT", "EVENT_MISMATCH", "executed opportunityType");
  same(executed.assetStandard, "ERC721", "EVENT_MISMATCH", "executed assetStandard");
  same(address(executed.adapter, "executed adapter"), expected.execution.adapter,
    "EVENT_MISMATCH", "executed adapter");
  same(address(executed.venue, "executed venue"), expected.execution.venue,
    "EVENT_MISMATCH", "executed venue");
  same(executed.tokenId, expected.execution.tokenId, "EVENT_MISMATCH", "executed tokenId");
  same(executed.assetAmount, "1", "EVENT_MISMATCH", "executed assetAmount");
  same(address(executed.currency, "executed currency", { zero: true }), ZERO_ADDRESS,
    "EVENT_MISMATCH", "executed currency");
  same(executed.price, "0", "EVENT_MISMATCH", "executed price");
  bool(executed.ownerApproved, true, "executed ownerApproved");
  same(executed.reasoningHash, expected.execution.reasoningHash,
    "EVENT_MISMATCH", "executed reasoning");
  same(executed.policyVersion, "11", "EVENT_MISMATCH", "executed policyVersion");
  same(executed.nonce, "0", "EVENT_MISMATCH", "executed nonce");
  same(executed.state, expected.postMintState.toString(),
    "EVENT_MISMATCH", "executed state");

  exactKeys(attestation.preMintState, [
    "blockNumber", "blockHash", "minted", "accountNftBalance", "accountNativeBalance",
  ], "preMintState");
  same(uint(attestation.preMintState.blockNumber, "preMintState.blockNumber"), receiptNumber - 1n,
    "BLOCK_ANCESTRY_MISMATCH", "preMintState.blockNumber");
  same(bytes32(attestation.preMintState.blockHash, "preMintState.blockHash"),
    attestation.receipt.parentBlockHash, "BLOCK_ANCESTRY_MISMATCH", "preMintState.blockHash");
  bool(attestation.preMintState.minted, false, "preMintState.minted");
  same(attestation.preMintState.accountNftBalance, "0", "PRESTATE_MISMATCH",
    "preMintState.accountNftBalance");
  uint(attestation.preMintState.accountNativeBalance, "preMintState.accountNativeBalance");
  validateSerializedState(attestation.postMintState, expected, "postMintState", "1");
  const confirmedAcquisitions = pinTimestamp / 86_400n === receiptTimestamp / 86_400n
    ? "1" : "0";
  validateSerializedState(attestation.confirmedState, expected, "confirmedState",
    confirmedAcquisitions);
  same(uint(attestation.postMintState.blockNumber, "postMintState.blockNumber"), receiptNumber,
    "STATE_MISMATCH", "postMintState.blockNumber");
  same(uint(attestation.postMintState.blockTimestamp, "postMintState.blockTimestamp"),
    receiptTimestamp, "STATE_MISMATCH", "postMintState.blockTimestamp");
  same(uint(attestation.confirmedState.blockNumber, "confirmedState.blockNumber"), pinNumber,
    "STATE_MISMATCH", "confirmedState.blockNumber");
  same(uint(attestation.confirmedState.blockTimestamp, "confirmedState.blockTimestamp"),
    pinTimestamp, "STATE_MISMATCH", "confirmedState.blockTimestamp");
  same(attestation.preMintState.accountNativeBalance, attestation.postMintState.nativeBalance,
    "NATIVE_BALANCE_CHANGED", "pre/post native balance");
  same(attestation.postMintState.nativeBalance, attestation.confirmedState.nativeBalance,
    "NATIVE_BALANCE_CHANGED", "post/confirmed native balance");

  exactKeys(attestation.continuity, [
    "priorEvidenceStatus", "priorLatestExecutionBlock",
    "noControllingPunkTransfersThroughConfirmedPin",
    "noUnexpectedScannedProtocolEventsThroughConfirmedPin",
    "unrelatedDirectTokenReceiptsChecked", "receiptAndConfirmedBlocksRechecked",
  ], "continuity");
  same(attestation.continuity.priorEvidenceStatus,
    "CONFIGURATION_AND_EXECUTION_PREFLIGHT_CHAIN_BOUND", "CONTINUITY_MISMATCH",
    "continuity.priorEvidenceStatus");
  same(attestation.continuity.priorLatestExecutionBlock,
    expected.execution.artifact.confirmedEvidence.latestExecutionCheck.number,
    "CONTINUITY_MISMATCH", "continuity.priorLatestExecutionBlock");
  for (const name of ["noControllingPunkTransfersThroughConfirmedPin",
    "noUnexpectedScannedProtocolEventsThroughConfirmedPin",
    "receiptAndConfirmedBlocksRechecked"]) {
    bool(attestation.continuity[name], true, `continuity.${name}`);
  }
  bool(attestation.continuity.unrelatedDirectTokenReceiptsChecked, false,
    "continuity.unrelatedDirectTokenReceiptsChecked");
  exactKeys(attestation.sourceVerification, [
    "status", "coreAdoptionSha256", "canaryAdoptionSha256",
  ], "sourceVerification");
  same(attestation.sourceVerification.status, "VERIFIED_MANIFEST_ADOPTIONS_HASH_BOUND",
    "SOURCE_VERIFICATION_MISMATCH", "sourceVerification.status");
  same(attestation.sourceVerification.coreAdoptionSha256,
    expected.evidenceHashes.coreSourceVerificationAdoptionSha256,
    "SOURCE_VERIFICATION_MISMATCH", "sourceVerification.coreAdoptionSha256");
  same(attestation.sourceVerification.canaryAdoptionSha256,
    expected.evidenceHashes.canarySourceVerificationAdoptionSha256,
    "SOURCE_VERIFICATION_MISMATCH", "sourceVerification.canaryAdoptionSha256");
  exactKeys(attestation.safetyBoundary, [
    "readOnly", "transactionAuthorized", "signingPerformed", "submissionPerformed",
    "chainWritePerformed", "deploymentPerformed", "walletMethodsPresent",
  ], "safetyBoundary");
  for (const name of ["transactionAuthorized", "signingPerformed", "submissionPerformed",
    "chainWritePerformed", "deploymentPerformed", "walletMethodsPresent"]) {
    bool(attestation.safetyBoundary[name], false, `safetyBoundary.${name}`);
  }
  bool(attestation.safetyBoundary.readOnly, true, "safetyBoundary.readOnly");
  return freeze(attestation);
}

function sampleClock(clock, label) {
  let observed;
  try { observed = clock(); } catch {
    fail("INVALID_TIME", `${label} could not be sampled`);
  }
  if (!Number.isSafeInteger(observed) || observed < 0) {
    fail("INVALID_TIME", `${label} must be a safe Unix timestamp`);
  }
  return BigInt(observed);
}

function requireFreshPin(pinTimestamp, checkedAt) {
  if (pinTimestamp > checkedAt + 30n
    || checkedAt - pinTimestamp > BigInt(CANARY_MINT_MAX_PIN_AGE_SECONDS)) {
    fail("STALE_RPC_PIN", "confirmed dual-RPC pin is more than five minutes from real time");
  }
}

export async function attestCanaryMintReceipt(
  inputValue,
  dependencyValue,
  optionValue = {},
  clock = () => Math.floor(Date.now() / 1_000),
) {
  const options = snapshot(optionValue, "mint receipt attestation options", 10_000);
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "confirmations")
    || Object.keys(options).length > 1) {
    fail("UNKNOWN_FIELD",
      "mint receipt attestation options may contain only confirmations");
  }
  if (typeof clock !== "function") fail("INVALID_TIME", "attestation clock must be a function");
  const confirmations = options.confirmations ?? DEFAULT_CANARY_MINT_CONFIRMATIONS;
  const startedAt = sampleClock(clock, "attestation start time");
  const expected = validateAndBindArtifacts(inputValue);
  const clients = validateCanaryMintRpcDependencies(dependencyValue);
  const pin = await establishCanaryMintConfirmedPin(clients, confirmations);
  requireFreshPin(pin.timestamp, startedAt);

  const [transaction, receipt] = await Promise.all([
    dualCanaryMintRead(clients, "mint transaction", async (client) => transactionView(
      await client.getTransaction({ hash: expected.transactionHash }),
    )),
    dualCanaryMintRead(clients, "mint transaction receipt", async (client) => receiptView(
      await client.getTransactionReceipt({ hash: expected.transactionHash }),
    )),
  ]);
  same(transaction.hash, expected.transactionHash, "TRANSACTION_MISMATCH", "transaction hash");
  same(transaction.from, expected.execution.from, "OWNER_MISMATCH", "transaction sender");
  same(transaction.to, expected.execution.to, "TRANSACTION_MISMATCH", "transaction destination");
  same(transaction.value, 0n, "NONZERO_PAYMENT", "transaction value");
  same(transaction.input, expected.execution.data, "CALLDATA_MISMATCH", "transaction calldata");
  same(keccak256(transaction.input), expected.execution.dataKeccak256,
    "CALLDATA_HASH_MISMATCH", "transaction calldata hash");
  same(receipt.transactionHash, transaction.hash, "RECEIPT_MISMATCH", "receipt transaction hash");
  same(receipt.from, transaction.from, "RECEIPT_MISMATCH", "receipt sender");
  same(receipt.to, transaction.to, "RECEIPT_MISMATCH", "receipt destination");
  for (const [field, actual, wanted] of [
    ["block hash", receipt.blockHash, transaction.blockHash],
    ["block number", receipt.blockNumber, transaction.blockNumber],
    ["transaction index", receipt.transactionIndex, transaction.transactionIndex],
  ]) same(actual, wanted, "RECEIPT_MISMATCH", field);
  if (receipt.blockNumber === 0n || receipt.blockNumber > pin.number) {
    fail("UNCONFIRMED_RECEIPT", "mint receipt is not inside the confirmed chain prefix");
  }
  if (pin.primaryHead - receipt.blockNumber < BigInt(pin.confirmations)
    || pin.secondaryHead - receipt.blockNumber < BigInt(pin.confirmations)) {
    fail("UNCONFIRMED_RECEIPT", "mint receipt lacks the required confirmations on both RPCs");
  }
  const receiptBlock = await dualCanaryMintRead(clients, "mint receipt block", async (client) => (
    blockWithTransactionsView(await client.getBlock({
      blockNumber: receipt.blockNumber,
      includeTransactions: true,
    }))
  ));
  same(receiptBlock.number, receipt.blockNumber, "RECEIPT_MISMATCH", "receipt block number");
  same(receiptBlock.hash, receipt.blockHash, "RECEIPT_MISMATCH", "receipt block hash");
  if (receipt.transactionIndex >= BigInt(receiptBlock.transactions.length)
    || receiptBlock.transactions[Number(receipt.transactionIndex)] !== transaction.hash) {
    fail("TRANSACTION_NOT_IN_BLOCK", "mint transaction is not at the receipt transaction index");
  }
  const createdAt = BigInt(expected.execution.artifact.reviewedAcquisition.timing.createdAt);
  const expiresAt = BigInt(expected.execution.artifact.reviewedAcquisition.timing.expiresAt);
  if (receiptBlock.timestamp < createdAt || receiptBlock.timestamp > expiresAt) {
    fail("STALE_EXECUTION", "mint was mined outside the reviewed intent validity window");
  }
  expected.receiptBlockHash = receipt.blockHash;
  expected.receiptBlockNumber = receipt.blockNumber;
  expected.transactionIndex = receipt.transactionIndex;
  expected.receiptTimestamp = receiptBlock.timestamp;
  expected.policy = expected.core.contracts.BrokerPolicyModule.address;
  const events = verifyReceiptLogs(receipt, expected);

  const parentBlock = await dualCanaryMintRead(clients, "mint parent block", async (client) => {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber - 1n,
      includeTransactions: false });
    return { number: uint(own(block, "number", "mint parent block"), "parent number"),
      hash: bytes32(own(block, "hash", "mint parent block"), "parent hash"),
      timestamp: uint(own(block, "timestamp", "mint parent block"), "parent timestamp") };
  });
  same(receiptBlock.parentHash, parentBlock.hash, "BLOCK_ANCESTRY_MISMATCH",
    "receipt block parent hash");
  const [preMinted, preBalance, beforeNativeBalance, receiptNativeBalance] = await Promise.all([
    dualReadContract(clients, { address: expected.execution.collection, abi: erc721Abi,
      functionName: "minted", blockNumber: parentBlock.number }, "pre-mint minted flag"),
    dualReadContract(clients, { address: expected.execution.collection, abi: erc721Abi,
      functionName: "balanceOf", args: [expected.execution.to], blockNumber: parentBlock.number },
    "pre-mint NFT balance"),
    dualCanaryMintRead(clients, "pre-mint native balance", (client) => client.getBalance({
      address: expected.execution.to, blockNumber: parentBlock.number })),
    dualCanaryMintRead(clients, "receipt native balance", (client) => client.getBalance({
      address: expected.execution.to, blockNumber: receipt.blockNumber })),
  ]);
  bool(preMinted, false, "pre-mint minted flag");
  same(uint(preBalance, "pre-mint NFT balance"), 0n, "PRESTATE_MISMATCH",
    "pre-mint NFT balance");
  same(uint(beforeNativeBalance, "pre-mint native balance"),
    uint(receiptNativeBalance, "receipt native balance"), "NATIVE_BALANCE_CHANGED",
    "Punk Account native balance across zero-cost mint");

  const postMintState = await readExactSecurityState(
    clients, expected, receipt.blockNumber, receiptBlock.timestamp, "receipt state",
  );
  const confirmedState = await readExactSecurityState(
    clients, expected, pin.number, pin.timestamp, "confirmed state",
  );
  same(confirmedState.nativeBalance, postMintState.nativeBalance, "NATIVE_BALANCE_CHANGED",
    "post-mint confirmed native balance");

  const latestExecutionBlock = BigInt(
    expected.execution.artifact.confirmedEvidence.latestExecutionCheck.number,
  );
  if (latestExecutionBlock > receipt.blockNumber) {
    fail("EVIDENCE_ORDER_MISMATCH", "execution preflight block follows the mint receipt");
  }
  await verifyNoLogs(clients, {
    address: ROBINHOOD.canonicalCollection,
    event: LIVE_APPROVAL_PREFLIGHT_ABIS.punkTransferEvent,
    args: { tokenId: BigInt(expected.execution.punkTokenId) },
    fromBlock: latestExecutionBlock + 1n,
    toBlock: pin.number,
  }, "controlling Punk ownership continuity");
  const permittedMint = {
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionIndex: receipt.transactionIndex,
    hash: transaction.hash,
  };
  const isolationAddresses = [
    [expected.execution.to, "execution-to-pin Punk Account isolation"],
    [expected.policy, "execution-to-pin policy isolation"],
    [expected.core.contracts.ArtAdapterRegistry.address,
      "execution-to-pin adapter-registry isolation"],
    [expected.core.contracts.ArtAgentRegistry.address,
      "execution-to-pin agent-registry isolation"],
    [expected.execution.collection, "execution-to-pin canary NFT isolation"],
  ];
  await Promise.all(isolationAddresses.map(([target, label]) => verifyNoLogs(clients, {
    address: target, fromBlock: latestExecutionBlock + 1n, toBlock: pin.number,
  }, label, permittedMint)));

  await Promise.all([
    recheckCanaryMintBlock(clients, {
      number: receiptBlock.number, hash: receiptBlock.hash, timestamp: receiptBlock.timestamp,
    }, "mint receipt block"),
    recheckCanaryMintBlock(clients, pin, "confirmed pin"),
  ]);

  const checkedAt = sampleClock(clock, "attestation closing time");
  if (checkedAt < startedAt) {
    fail("CLOCK_ROLLBACK", "attestation clock moved backwards during the read-only run");
  }
  if (checkedAt - startedAt > BigInt(CANARY_MINT_MAX_ATTESTATION_SECONDS)) {
    fail("ATTESTATION_TIMEOUT", "read-only mint receipt attestation exceeded two minutes");
  }
  requireFreshPin(pin.timestamp, checkedAt);

  const result = freeze({
    schema: CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
    status: CANARY_MINT_RECEIPT_PASS,
    chainId: ROBINHOOD.chainId,
    evidenceHashes: expected.evidenceHashes,
    transaction: {
      hash: transaction.hash, from: transaction.from, to: transaction.to,
      value: transaction.value.toString(), data: transaction.input,
      dataKeccak256: keccak256(transaction.input).toLowerCase(),
      nonce: transaction.nonce.toString(),
    },
    receipt: {
      status: "success", blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash, blockTimestamp: receiptBlock.timestamp.toString(),
      parentBlockHash: receiptBlock.parentHash,
      transactionIndex: receipt.transactionIndex.toString(), logCount: 4,
      firstLogIndex: receipt.logs[0].logIndex.toString(),
      lastLogIndex: receipt.logs[3].logIndex.toString(),
    },
    confirmedPin: {
      number: pin.number.toString(), hash: pin.hash, timestamp: pin.timestamp.toString(),
      confirmations: pin.confirmations, primaryHead: pin.primaryHead.toString(),
      secondaryHead: pin.secondaryHead.toString(), headSkew: pin.headSkew.toString(),
      checkedAt: checkedAt.toString(), maximumAgeSeconds: CANARY_MINT_MAX_PIN_AGE_SECONDS,
      providerOrigins: clients.origins,
      providerIndependence: "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS",
    },
    events,
    preMintState: {
      blockNumber: parentBlock.number.toString(), blockHash: parentBlock.hash,
      minted: false, accountNftBalance: "0",
      accountNativeBalance: uint(beforeNativeBalance, "pre-mint native balance").toString(),
    },
    postMintState,
    confirmedState,
    continuity: {
      priorEvidenceStatus: "CONFIGURATION_AND_EXECUTION_PREFLIGHT_CHAIN_BOUND",
      priorLatestExecutionBlock: latestExecutionBlock.toString(),
      noControllingPunkTransfersThroughConfirmedPin: true,
      noUnexpectedScannedProtocolEventsThroughConfirmedPin: true,
      unrelatedDirectTokenReceiptsChecked: false,
      receiptAndConfirmedBlocksRechecked: true,
    },
    sourceVerification: {
      status: "VERIFIED_MANIFEST_ADOPTIONS_HASH_BOUND",
      coreAdoptionSha256: expected.evidenceHashes.coreSourceVerificationAdoptionSha256,
      canaryAdoptionSha256: expected.evidenceHashes.canarySourceVerificationAdoptionSha256,
    },
    safetyBoundary: {
      readOnly: true, transactionAuthorized: false, signingPerformed: false,
      submissionPerformed: false, chainWritePerformed: false, deploymentPerformed: false,
      walletMethodsPresent: false,
    },
  });
  return validateCanaryMintReceiptAttestationArtifact(result, inputValue);
}

export const CANARY_MINT_RECEIPT_ABIS = Object.freeze({
  erc721Abi, adapterAbi, policyUsageAbi, transferEvent, erc721ReceivedEvent,
  acquisitionExecutedEvent, acquisitionConsumedEvent,
});
