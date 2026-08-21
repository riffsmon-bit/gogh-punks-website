import { createHash } from "node:crypto";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  isAddress,
  keccak256,
} from "viem";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

export const ACTIVATION_CHAIN_ID = 4663;
export const ACTIVATION_CANONICAL_COLLECTION =
  "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
export const ACTIVATION_CANONICAL_ERC6551_REGISTRY =
  "0x000000006551c19487814612e58FE06813775758";
export const ACTIVATION_CANONICAL_ERC6551_RUNTIME_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
export const ACTIVATION_REVIEW_SCHEMA = "GOGH_PUNK_ACCOUNT_ACTIVATION_OWNER_REVIEW_V1";
export const ACTIVATION_RECEIPT_SCHEMA = "GOGH_PUNK_ACCOUNT_ACTIVATION_RECEIPT_ATTESTATION_V1";
export const DEFAULT_ACTIVATION_CONFIRMATIONS = 20;
export const MINIMUM_ACTIVATION_CONFIRMATIONS = 12;
export const MAXIMUM_ACTIVATION_CONFIRMATIONS = 256;

const MAX_HEAD_SKEW = 128n;
const MAX_MANIFEST_BYTES = 500_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ZERO_SALT = ZERO_HASH;
const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const ERC6551_CREATION_PREFIX = "3d60ad80600a3d3981f3";
const CORE_CONTRACT_NAMES = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const SAFE_FEATURE_FLAGS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});

const addressOutput = [{ type: "address" }];
const boolOutput = [{ type: "bool" }];
const uintOutput = [{ type: "uint256" }];
const bytes32Output = [{ type: "bytes32" }];
const view = (name, outputs, inputs = []) => ({
  type: "function",
  name,
  stateMutability: "view",
  inputs,
  outputs,
});
const ownableAbi = [view("owner", addressOutput), view("pendingOwner", addressOutput)];
const accountRegistryAbi = [
  view("ROBINHOOD_CHAIN_ID", uintOutput),
  view("GOGH_PUNKS", addressOutput),
  view("CANONICAL_ERC6551_REGISTRY", addressOutput),
  view("canonicalRegistry", addressOutput),
  view("implementation", addressOutput),
  view("accountSalt", bytes32Output),
  view("account", addressOutput, [{ name: "tokenId", type: "uint256" }]),
  view("isAccountCreated", boolOutput, [{ name: "tokenId", type: "uint256" }]),
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "accountAddress", type: "address" }],
  },
];
const canonicalRegistryAbi = [
  view("account", addressOutput, [
    { name: "implementation", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ]),
];
const collectionAbi = [
  view("ownerOf", addressOutput, [{ name: "tokenId", type: "uint256" }]),
];
const policyAbi = [
  ...ownableAbi,
  view("ROBINHOOD_CHAIN_ID", uintOutput),
  view("GOGH_PUNKS", addressOutput),
  view("adapterRegistry", addressOutput),
  view("globallyPaused", boolOutput),
  view("featureFlags", [{
    type: "tuple",
    components: [
      { name: "scoutMode", type: "bool" },
      { name: "approvalPurchases", type: "bool" },
      { name: "autonomousPurchases", type: "bool" },
      { name: "autonomousMints", type: "bool" },
      { name: "unknownCollectionExecution", type: "bool" },
      { name: "selling", type: "bool" },
      { name: "autonomousSelling", type: "bool" },
    ],
  }]),
];
const pauseRegistryAbi = [...ownableAbi, view("globallyPaused", boolOutput)];
const accountImplementationAbi = [
  view("ROBINHOOD_CHAIN_ID", uintOutput),
  view("GOGH_PUNKS", addressOutput),
  view("policyModule", addressOutput),
  view("agentRegistry", addressOutput),
  view("adapterRegistry", addressOutput),
];
const activatedAccountAbi = [
  ...accountImplementationAbi,
  view("owner", addressOutput),
  view("isCanonicalGoghPunkAccount", boolOutput),
  view("token", [
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ]),
  view("state", uintOutput),
  view("acquisitionNonce", uintOutput),
];
const erc6551CreatedEvent = {
  type: "event",
  name: "ERC6551AccountCreated",
  inputs: [
    { name: "account", type: "address", indexed: false },
    { name: "implementation", type: "address", indexed: true },
    { name: "salt", type: "bytes32", indexed: false },
    { name: "chainId", type: "uint256", indexed: false },
    { name: "tokenContract", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
};
const activationEvent = {
  type: "event",
  name: "GoghPunkAccountActivated",
  inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "chainId", type: "uint256", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "owner", type: "address", indexed: false },
    { name: "implementation", type: "address", indexed: false },
    { name: "implementationVersion", type: "uint256", indexed: false },
  ],
};

export class PunkAccountActivationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PunkAccountActivationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PunkAccountActivationError(code, message);
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} contains an unsafe number`);
    return;
  }
  if (!value || typeof value !== "object") {
    fail("INVALID_SCHEMA", `${label} is not JSON data`);
  }
  if (seen.has(value)) fail("INVALID_SCHEMA", `${label} contains a cycle`);
  seen.add(value);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_PROTOTYPE", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
  }
  if (isArray) {
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))
      || keys.length !== value.length + 1) {
      fail("INVALID_SCHEMA", `${label} is not a dense array`);
    }
  }
  for (const key of keys) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not an enumerable data field`);
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

function snapshotJson(value, label, maximumBytes = MAX_MANIFEST_BYTES) {
  assertJsonData(value, label);
  let clone;
  try {
    clone = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy`);
  }
  assertJsonData(clone, `${label} snapshot`);
  const serialized = canonicalJson(clone);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("INPUT_TOO_LARGE", `${label} exceeds ${maximumBytes} bytes`);
  }
  return JSON.parse(serialized);
}

function exactKeys(value, keys, label, { allowNullPrototype = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && !(allowNullPrototype && prototype === null)) {
    fail("INVALID_PROTOTYPE", `${label} must use the ordinary object prototype`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("UNKNOWN_FIELD", `${label} fields do not match the canonical schema`);
  }
}

function sha256Canonical(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function same(actual, expected, code, label) {
  if (actual !== expected) fail(code, `${label} does not match the canonical value`);
}

function normalizeAddress(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact address`);
  }
  const normalized = getAddress(value);
  if (!allowZero && normalized.toLowerCase() === ZERO_ADDRESS) {
    fail("ZERO_ADDRESS", `${label} must not be zero`);
  }
  return normalized;
}

function sameAddress(actual, expected, code, label, options) {
  const normalized = normalizeAddress(actual, label, options);
  if (normalized.toLowerCase() !== expected.toLowerCase()) {
    fail(code, `${label} does not match the canonical address`);
  }
  return normalized;
}

function normalizeHash(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be an exact bytes32 value`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_HASH) fail("ZERO_HASH", `${label} must not be zero`);
  return normalized;
}

function normalizeBytes(value, label, { allowEmpty = false, maximumBytes = 100_000 } = {}) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    fail("INVALID_BYTES", `${label} must be byte-aligned hexadecimal data`);
  }
  const length = (value.length - 2) / 2;
  if ((!allowEmpty && length === 0) || length > maximumBytes) {
    fail("INVALID_BYTES", `${label} length is outside the allowed range`);
  }
  return value.toLowerCase();
}

function parseUint(value, label, { positive = false, jsonSafe = false } = {}) {
  let result;
  try {
    if (typeof value === "bigint") result = value;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      result = BigInt(value);
    } else if (typeof value === "string"
      && (/^(?:0|[1-9]\d*)$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value))) {
      result = BigInt(value);
    } else throw new TypeError();
  } catch {
    fail("INVALID_INTEGER", `${label} must be an unsigned integer`);
  }
  if (result < 0n || (positive && result === 0n) || result >= 2n ** 256n) {
    fail("INVALID_INTEGER", `${label} is outside the allowed range`);
  }
  if (jsonSafe && result > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("UNSAFE_INTEGER", `${label} exceeds the JSON safe-integer range`);
  }
  return result;
}

function confirmations(value) {
  const parsed = parseUint(value ?? DEFAULT_ACTIVATION_CONFIRMATIONS, "confirmations", {
    positive: true,
    jsonSafe: true,
  });
  if (parsed < BigInt(MINIMUM_ACTIVATION_CONFIRMATIONS)
    || parsed > BigInt(MAXIMUM_ACTIVATION_CONFIRMATIONS)) {
    fail(
      "INVALID_CONFIRMATIONS",
      `confirmations must be ${MINIMUM_ACTIVATION_CONFIRMATIONS}-${MAXIMUM_ACTIVATION_CONFIRMATIONS}`,
    );
  }
  return Number(parsed);
}

function normalizeCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_GIT_COMMIT", `${label} must be a full 40-character commit`);
  }
  return value.toLowerCase();
}

function featureTuple(value, label) {
  return {
    scoutMode: rpcBool(tupleField(value, "scoutMode", 0, label), `${label}.scoutMode`),
    approvalPurchases: rpcBool(tupleField(value, "approvalPurchases", 1, label),
      `${label}.approvalPurchases`),
    autonomousPurchases: rpcBool(tupleField(value, "autonomousPurchases", 2, label),
      `${label}.autonomousPurchases`),
    autonomousMints: rpcBool(tupleField(value, "autonomousMints", 3, label),
      `${label}.autonomousMints`),
    unknownCollectionExecution:
      rpcBool(tupleField(value, "unknownCollectionExecution", 4, label),
        `${label}.unknownCollectionExecution`),
    selling: rpcBool(tupleField(value, "selling", 5, label), `${label}.selling`),
    autonomousSelling: rpcBool(tupleField(value, "autonomousSelling", 6, label),
      `${label}.autonomousSelling`),
  };
}

function expectedFeaturesAsRpcTuple() {
  return {
    scoutMode: true,
    approvalPurchases: false,
    autonomousPurchases: false,
    autonomousMints: false,
    unknownCollectionExecution: false,
    selling: false,
    autonomousSelling: false,
  };
}

function constructorAddress(value, expected, label) {
  return sameAddress(value, expected, "CONSTRUCTOR_MISMATCH", label);
}

function validateManifest(value) {
  const manifest = snapshotJson(value, "core manifest");
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "verifiedExternalInfrastructure",
    "accountSalt", "gitCommit", "compiler", "evmVersion", "optimizerRuns", "contracts",
    "featureFlags", "protocolGuardian", "sourceVerificationAdoption", "notes",
  ], "core manifest");
  same(manifest.status, "DEPLOYED", "CORE_NOT_DEPLOYED", "core manifest status");
  exactKeys(manifest.chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "core manifest.chain");
  same(manifest.chain.name, "Robinhood Chain", "WRONG_CHAIN", "chain name");
  same(manifest.chain.chainId, ACTIVATION_CHAIN_ID, "WRONG_CHAIN", "chain ID");
  same(manifest.chain.rpcEnvironmentVariable, "ROBINHOOD_RPC_URL", "WRONG_CHAIN",
    "RPC environment variable");
  same(manifest.chain.explorer, "https://robinhoodchain.blockscout.com", "WRONG_CHAIN",
    "block explorer");
  same(manifest.chain.nativeCurrency, "ETH", "WRONG_CHAIN", "native currency");
  sameAddress(manifest.canonicalCollection, ACTIVATION_CANONICAL_COLLECTION,
    "NONCANONICAL_COLLECTION", "canonical collection");
  sameAddress(manifest.canonicalERC6551Registry, ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    "NONCANONICAL_REGISTRY", "canonical ERC-6551 registry");
  same(normalizeHash(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "canonical registry runtime hash"), ACTIVATION_CANONICAL_ERC6551_RUNTIME_HASH,
  "NONCANONICAL_REGISTRY", "canonical registry runtime hash");
  same(normalizeHash(manifest.accountSalt, "account salt", { allowZero: true }), ZERO_SALT,
    "NONCANONICAL_SALT", "canonical account salt");
  const gitCommit = normalizeCommit(manifest.gitCommit, "manifest git commit");
  same(manifest.compiler, "0.8.34", "BUILD_MISMATCH", "compiler");
  same(manifest.evmVersion, "cancun", "BUILD_MISMATCH", "EVM version");
  same(manifest.optimizerRuns, 500, "BUILD_MISMATCH", "optimizer runs");
  if (typeof manifest.notes !== "string" || manifest.notes.length > 4_000) {
    fail("INVALID_SCHEMA", "manifest notes are malformed");
  }

  exactKeys(manifest.featureFlags, Object.keys(SAFE_FEATURE_FLAGS), "manifest feature flags");
  for (const [name, expected] of Object.entries(SAFE_FEATURE_FLAGS)) {
    same(manifest.featureFlags[name], expected, "UNSAFE_FEATURE_FLAGS", `manifest ${name}`);
  }
  const guardian = normalizeAddress(manifest.protocolGuardian, "protocol guardian");

  let adoption;
  try {
    adoption = requireVerifiedManifestAdoption(manifest, CORE_CONTRACT_NAMES);
  } catch (error) {
    fail(error?.code ?? "UNVERIFIED_MANIFEST",
      error?.message ?? "source verification adoption is invalid");
  }

  exactKeys(manifest.verifiedExternalInfrastructure, ["seaport"],
    "verified external infrastructure");
  const seaport = manifest.verifiedExternalInfrastructure.seaport;
  exactKeys(seaport, [
    "address", "name", "compiler", "deploymentTransaction", "deploymentBlock",
    "runtimeCodeHash", "verificationStatus", "executionApproved",
  ], "Seaport record");
  sameAddress(seaport.address, "0x0000000000000068f116a894984e2db1123eb395",
    "INVALID_INFRASTRUCTURE", "Seaport address");
  same(seaport.name, "Seaport", "INVALID_INFRASTRUCTURE", "Seaport name");
  same(seaport.compiler, "v0.8.24+commit.e11b9ed9", "INVALID_INFRASTRUCTURE",
    "Seaport compiler");
  same(normalizeHash(seaport.deploymentTransaction, "Seaport deployment transaction"),
    "0x4320260396b5fbb69618a9b95de358a865fb6c305d5b5dda35c21452b30ee39d",
    "INVALID_INFRASTRUCTURE", "Seaport deployment transaction");
  same(seaport.deploymentBlock, 605917, "INVALID_INFRASTRUCTURE", "Seaport deployment block");
  same(normalizeHash(seaport.runtimeCodeHash, "Seaport runtime hash"),
    "0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00",
    "INVALID_INFRASTRUCTURE", "Seaport runtime hash");
  same(seaport.verificationStatus, "VERIFIED_READ_ONLY_SCOUT", "INVALID_INFRASTRUCTURE",
    "Seaport verification status");
  same(seaport.executionApproved, false, "INVALID_INFRASTRUCTURE",
    "Seaport execution permission");

  exactKeys(manifest.contracts, CORE_CONTRACT_NAMES, "manifest contracts");
  const contracts = {};
  const addresses = new Set();
  for (const name of CORE_CONTRACT_NAMES) {
    const record = manifest.contracts[name];
    exactKeys(record, [
      "address", "deploymentTransaction", "deploymentBlock", "deployer",
      "implementationVersion", "constructorArguments", "creationBytecodeHash",
      "runtimeBytecodeHash", "gitCommit", "verificationStatus",
    ], `manifest.contracts.${name}`);
    const recordAddress = normalizeAddress(record.address, `${name} address`);
    if (addresses.has(recordAddress.toLowerCase())) {
      fail("DUPLICATE_ADDRESS", `${name} reuses a protocol address`);
    }
    addresses.add(recordAddress.toLowerCase());
    const deployer = normalizeAddress(record.deployer, `${name} deployer`);
    const deploymentTransaction = normalizeHash(record.deploymentTransaction,
      `${name} deployment transaction`);
    const deploymentBlock = parseUint(record.deploymentBlock, `${name} deployment block`, {
      positive: true,
      jsonSafe: true,
    });
    if (!Array.isArray(record.constructorArguments)) {
      fail("INVALID_SCHEMA", `${name} constructorArguments must be an array`);
    }
    same(record.implementationVersion, "1", "VERSION_MISMATCH", `${name} version`);
    same(normalizeCommit(record.gitCommit, `${name} git commit`), gitCommit,
      "BUILD_MISMATCH", `${name} git commit`);
    same(record.verificationStatus, "VERIFIED", "UNVERIFIED_CONTRACT",
      `${name} source verification`);
    contracts[name] = {
      address: recordAddress,
      deploymentTransaction,
      deploymentBlock,
      deployer,
      constructorArguments: [...record.constructorArguments],
      creationBytecodeHash: normalizeHash(record.creationBytecodeHash,
        `${name} creation bytecode hash`),
      runtimeBytecodeHash: normalizeHash(record.runtimeBytecodeHash,
        `${name} runtime bytecode hash`),
    };
  }

  const adapter = contracts.ArtAdapterRegistry.address;
  const agent = contracts.ArtAgentRegistry.address;
  const policy = contracts.BrokerPolicyModule.address;
  const implementation = contracts.GoghPunkAccountV1.address;
  const constructors = {
    ArtAdapterRegistry: [guardian],
    ArtAgentRegistry: [guardian],
    BrokerPolicyModule: [guardian, adapter],
    GoghPunkAccountV1: [policy, agent, adapter],
    GoghPunkAccountRegistry: [implementation, ZERO_SALT],
  };
  for (const name of CORE_CONTRACT_NAMES) {
    const actual = contracts[name].constructorArguments;
    const expected = constructors[name];
    if (actual.length !== expected.length) {
      fail("CONSTRUCTOR_MISMATCH", `${name} constructor argument count is wrong`);
    }
    actual.forEach((item, index) => {
      if (/^0x[0-9a-fA-F]{40}$/.test(expected[index])) {
        constructorAddress(item, expected[index], `${name} constructor argument ${index}`);
      } else {
        same(normalizeHash(item, `${name} constructor argument ${index}`, { allowZero: true }),
          expected[index], "CONSTRUCTOR_MISMATCH", `${name} constructor argument ${index}`);
      }
    });
  }

  return Object.freeze({
    manifest,
    manifestHash: sha256Canonical(manifest),
    contracts: Object.freeze(contracts),
    guardian,
    gitCommit,
    accountSalt: ZERO_SALT,
    sourceVerificationAdoptionHash: sourceVerificationCanonicalSha256(adoption),
  });
}

function method(client, name, label) {
  if (!client || (typeof client !== "object" && typeof client !== "function")) {
    fail("INVALID_CLIENT", `${label} client is missing`);
  }
  let object = client;
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (descriptor) {
      if (descriptor.get || descriptor.set || typeof descriptor.value !== "function") {
        fail("INVALID_CLIENT", `${label}.${name} must be a data-method`);
      }
      return descriptor.value.bind(client);
    }
    object = Object.getPrototypeOf(object);
  }
  fail("INVALID_CLIENT", `${label}.${name} is required`);
}

function providerDomain(hostname) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return hostname;
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const compoundSuffix = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = labels.slice(-2).join(".");
  return compoundSuffix.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function clientsFromDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    fail("INVALID_CLIENT", "dependencies must be an object");
  }
  const keys = Reflect.ownKeys(dependencies);
  if (keys.some((key) => typeof key !== "string")
    || keys.some((key) => !["primaryClient", "secondaryClient", "endpointOrigins"].includes(key))) {
    fail("INVALID_CLIENT", "dependencies contain an unknown field");
  }
  const descriptor = (name) => {
    const item = Object.getOwnPropertyDescriptor(dependencies, name);
    if (!item || item.get || item.set || !item.enumerable) {
      fail("INVALID_CLIENT", `dependencies.${name} must be an enumerable data field`);
    }
    return item.value;
  };
  const primaryClient = descriptor("primaryClient");
  const secondaryClient = descriptor("secondaryClient");
  if (primaryClient === secondaryClient) {
    fail("RPC_ENDPOINTS_NOT_DISTINCT", "primary and secondary clients must be distinct");
  }
  const origins = descriptor("endpointOrigins");
  if (!Array.isArray(origins) || Object.getPrototypeOf(origins) !== Array.prototype
    || origins.length !== 2 || Reflect.ownKeys(origins).length !== 3) {
    fail("INVALID_CLIENT", "two endpoint origins are required");
  }
  const originValues = [0, 1].map((index) => {
    const item = Object.getOwnPropertyDescriptor(origins, String(index));
    if (!item || item.get || item.set || typeof item.value !== "string") {
      fail("INVALID_CLIENT", "endpoint origins must be dense string data fields");
    }
    return item.value;
  });
  let first;
  let second;
  try {
    first = new URL(originValues[0]);
    second = new URL(originValues[1]);
  } catch {
    fail("INVALID_CLIENT", "RPC endpoint origins are malformed");
  }
  if (first.protocol !== "https:" || second.protocol !== "https:"
    || first.origin !== originValues[0] || second.origin !== originValues[1]
    || first.origin === second.origin
    || providerDomain(first.hostname) === providerDomain(second.hostname)) {
    fail("RPC_ENDPOINTS_NOT_DISTINCT",
      "RPC clients must use distinct HTTPS provider domains");
  }
  const required = [
    "getChainId", "getBlockNumber", "getBlock", "getCode", "readContract", "call",
    "getTransactionReceipt", "getTransaction",
  ];
  return {
    primary: Object.fromEntries(required.map((name) => [
      name,
      method(primaryClient, name, "primary client"),
    ])),
    secondary: Object.fromEntries(required.map((name) => [
      name,
      method(secondaryClient, name, "secondary client"),
    ])),
    endpointOriginHashes: originValues.map((origin) => (
      `0x${createHash("sha256").update(origin).digest("hex")}`
    )),
  };
}

function canonicalRpcValue(value, label, seen = new Set()) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return canonicalJson(value);
  }
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "number" && Number.isSafeInteger(value)) return `number:${value}`;
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not deterministic RPC data`);
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
  const parts = [];
  for (const key of keys.sort()) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_RPC_RESPONSE", `${label}.${key} is not an enumerable data field`);
    }
    parts.push(`${canonicalJson(key)}:${canonicalRpcValue(descriptor.value, `${label}.${key}`, seen)}`);
  }
  seen.delete(value);
  return `${isArray ? "array" : "object"}:{${parts.join(",")}}`;
}

function rpcEqual(primary, secondary, label) {
  if (canonicalRpcValue(primary, `${label} primary`)
    !== canonicalRpcValue(secondary, `${label} secondary`)) {
    fail("RPC_DISAGREEMENT", `${label} differs between providers`);
  }
}

function ownValue(value, key, label) {
  if (!value || typeof value !== "object") {
    fail("INVALID_RPC_RESPONSE", `${label} is not an object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.get || descriptor.set) {
    fail("INVALID_RPC_RESPONSE", `${label}.${String(key)} is not an own data field`);
  }
  return descriptor.value;
}

function tupleField(value, name, index, label) {
  if (!value || typeof value !== "object") {
    fail("INVALID_RPC_RESPONSE", `${label} is not a tuple`);
  }
  if (Object.hasOwn(value, name)) return ownValue(value, name, label);
  if (Object.hasOwn(value, index)) return ownValue(value, String(index), label);
  fail("INVALID_RPC_RESPONSE", `${label}.${name} is missing`);
}

function normalizeCode(value, label, { allowEmpty = false } = {}) {
  const empty = value === undefined || value === null || value === "0x" || value === "0x0";
  if (empty) {
    if (allowEmpty) return "0x";
    fail("CODE_MISSING", `${label} has no runtime bytecode`);
  }
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not byte-aligned runtime bytecode`);
  }
  if ((value.length - 2) / 2 > 1_000_000) {
    fail("INVALID_RPC_RESPONSE", `${label} runtime exceeds the size bound`);
  }
  return value.toLowerCase();
}

function rpcAddress(value, label, { allowZero = false } = {}) {
  return normalizeAddress(value, label, { allowZero });
}

function rpcHash(value, label) {
  return normalizeHash(value, label);
}

function rpcBool(value, label) {
  if (typeof value !== "boolean") fail("INVALID_RPC_RESPONSE", `${label} must be boolean`);
  return value;
}

function blockView(value, label) {
  const number = parseUint(ownValue(value, "number", label), `${label}.number`);
  const hash = rpcHash(ownValue(value, "hash", label), `${label}.hash`);
  const timestamp = parseUint(ownValue(value, "timestamp", label), `${label}.timestamp`);
  return { number, hash, timestamp };
}

async function dual(primaryPromise, secondaryPromise, label) {
  let primary;
  let secondary;
  try {
    [primary, secondary] = await Promise.all([primaryPromise, secondaryPromise]);
  } catch {
    fail("RPC_FAILURE", `${label} failed on one or more providers`);
  }
  rpcEqual(primary, secondary, label);
  return { primary, secondary };
}

async function rpcPair(primaryPromise, secondaryPromise, label) {
  try {
    const [primary, secondary] = await Promise.all([primaryPromise, secondaryPromise]);
    return { primary, secondary };
  } catch {
    fail("RPC_FAILURE", `${label} failed on one or more providers`);
  }
}

async function pinCommonBlock(clients, confirmationCount, label, minimumBlock = 0n) {
  const heads = await rpcPair(
    clients.primary.getBlockNumber(),
    clients.secondary.getBlockNumber(),
    `${label} heads`,
  );
  const primaryHead = parseUint(heads.primary, `${label} primary head`);
  const secondaryHead = parseUint(heads.secondary, `${label} secondary head`);
  const skew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead
    : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("RPC_HEAD_SKEW", `${label} head skew exceeds the bound`);
  const sharedHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const depth = BigInt(confirmationCount);
  if (sharedHead <= depth) fail("INSUFFICIENT_CONFIRMATIONS", `${label} head is too young`);
  const blockNumber = sharedHead - depth;
  if (blockNumber < minimumBlock) {
    fail("INSUFFICIENT_CONFIRMATIONS", `${label} block precedes required deployment state`);
  }
  const blocks = await rpcPair(
    clients.primary.getBlock({ blockNumber }),
    clients.secondary.getBlock({ blockNumber }),
    `${label} block`,
  );
  const primaryBlock = blockView(blocks.primary, `${label} primary block`);
  const secondaryBlock = blockView(blocks.secondary, `${label} secondary block`);
  same(primaryBlock.number, blockNumber, "RPC_DISAGREEMENT", `${label} primary block number`);
  same(secondaryBlock.number, blockNumber, "RPC_DISAGREEMENT", `${label} secondary block number`);
  same(primaryBlock.hash, secondaryBlock.hash, "RPC_DISAGREEMENT", `${label} block hash`);
  same(primaryBlock.timestamp, secondaryBlock.timestamp, "RPC_DISAGREEMENT",
    `${label} block timestamp`);
  return {
    number: blockNumber,
    hash: primaryBlock.hash,
    timestamp: primaryBlock.timestamp,
    primaryHead,
    secondaryHead,
  };
}

async function pinFreshCommonBlock(clients, label, minimumBlock) {
  const heads = await rpcPair(
    clients.primary.getBlockNumber(),
    clients.secondary.getBlockNumber(),
    `${label} heads`,
  );
  const primaryHead = parseUint(heads.primary, `${label} primary head`);
  const secondaryHead = parseUint(heads.secondary, `${label} secondary head`);
  const skew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead
    : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("RPC_HEAD_SKEW", `${label} head skew exceeds the bound`);
  const blockNumber = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  if (blockNumber < minimumBlock) fail("STALE_RPC", `${label} is behind the confirmed pin`);
  const blocks = await rpcPair(
    clients.primary.getBlock({ blockNumber }),
    clients.secondary.getBlock({ blockNumber }),
    `${label} block`,
  );
  const primaryBlock = blockView(blocks.primary, `${label} primary block`);
  const secondaryBlock = blockView(blocks.secondary, `${label} secondary block`);
  same(primaryBlock.number, blockNumber, "RPC_DISAGREEMENT", `${label} block number`);
  same(primaryBlock.hash, secondaryBlock.hash, "RPC_DISAGREEMENT", `${label} block hash`);
  same(primaryBlock.timestamp, secondaryBlock.timestamp, "RPC_DISAGREEMENT",
    `${label} block timestamp`);
  return {
    number: blockNumber,
    hash: primaryBlock.hash,
    timestamp: primaryBlock.timestamp,
    primaryHead,
    secondaryHead,
  };
}

async function recheckBlock(clients, block, label) {
  const values = await rpcPair(
    clients.primary.getBlock({ blockNumber: block.number }),
    clients.secondary.getBlock({ blockNumber: block.number }),
    `${label} recheck`,
  );
  for (const [provider, raw] of [["primary", values.primary], ["secondary", values.secondary]]) {
    const current = blockView(raw, `${label} ${provider} recheck`);
    same(current.number, block.number, "BLOCK_CHANGED", `${label} block number`);
    same(current.hash, block.hash, "BLOCK_CHANGED", `${label} block hash`);
    same(current.timestamp, block.timestamp, "BLOCK_CHANGED", `${label} block timestamp`);
  }
}

async function dualCode(clients, address, blockNumber, label, options) {
  const values = await dual(
    clients.primary.getCode({ address, blockNumber }),
    clients.secondary.getCode({ address, blockNumber }),
    `${label} code`,
  );
  const primary = normalizeCode(values.primary, `${label} primary code`, options);
  const secondary = normalizeCode(values.secondary, `${label} secondary code`, options);
  same(primary, secondary, "RPC_DISAGREEMENT", `${label} runtime bytecode`);
  return primary;
}

async function dualRead(clients, blockNumber, request, label) {
  const values = await dual(
    clients.primary.readContract({ ...request, blockNumber }),
    clients.secondary.readContract({ ...request, blockNumber }),
    label,
  );
  return values.primary;
}

function emptyCode(value) {
  return value === "0x";
}

function uint256Word(value) {
  return parseUint(value, "ERC-6551 runtime word").toString(16).padStart(64, "0");
}

export function expectedPunkAccountRuntime({ implementation, salt, tokenId }) {
  const implementationAddress = normalizeAddress(implementation, "account implementation");
  const normalizedSalt = normalizeHash(salt, "account salt", { allowZero: true });
  const id = parseUint(tokenId, "Punk token ID");
  return `0x${EIP1167_PREFIX}${implementationAddress.slice(2).toLowerCase()}${EIP1167_SUFFIX}`
    + `${normalizedSalt.slice(2)}${uint256Word(ACTIVATION_CHAIN_ID)}`
    + `${ACTIVATION_CANONICAL_COLLECTION.slice(2).toLowerCase().padStart(64, "0")}`
    + uint256Word(id);
}

export function expectedPunkAccountAddress({ implementation, salt, tokenId }) {
  const normalizedSalt = normalizeHash(salt, "account salt", { allowZero: true });
  const runtime = expectedPunkAccountRuntime({ implementation, salt: normalizedSalt, tokenId });
  const creationBytecode = `0x${ERC6551_CREATION_PREFIX}${runtime.slice(2)}`;
  return getCreate2Address({
    from: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    salt: normalizedSalt,
    bytecodeHash: keccak256(creationBytecode),
  });
}

async function validateDeploymentReceipts(clients, deployment, pinnedBlock) {
  for (const name of CORE_CONTRACT_NAMES) {
    const contract = deployment.contracts[name];
    if (contract.deploymentBlock > pinnedBlock) {
      fail("INSUFFICIENT_CONFIRMATIONS", `${name} deployment is newer than the confirmed pin`);
    }
    const values = await dual(
      clients.primary.getTransactionReceipt({ hash: contract.deploymentTransaction }),
      clients.secondary.getTransactionReceipt({ hash: contract.deploymentTransaction }),
      `${name} deployment receipt`,
    );
    const receipt = values.primary;
    same(ownValue(receipt, "status", `${name} receipt`), "success", "FAILED_DEPLOYMENT",
      `${name} deployment status`);
    same(parseUint(ownValue(receipt, "blockNumber", `${name} receipt`), `${name} receipt block`),
      contract.deploymentBlock, "DEPLOYMENT_MISMATCH", `${name} deployment block`);
    sameAddress(ownValue(receipt, "contractAddress", `${name} receipt`), contract.address,
      "DEPLOYMENT_MISMATCH", `${name} created address`);
    sameAddress(ownValue(receipt, "from", `${name} receipt`), contract.deployer,
      "DEPLOYMENT_MISMATCH", `${name} deployer`);
    const to = ownValue(receipt, "to", `${name} receipt`);
    if (to !== null && to !== undefined) {
      fail("DEPLOYMENT_MISMATCH", `${name} receipt is not a contract creation`);
    }
    same(normalizeHash(ownValue(receipt, "transactionHash", `${name} receipt`),
      `${name} receipt transaction`), contract.deploymentTransaction,
    "DEPLOYMENT_MISMATCH", `${name} deployment transaction`);
  }
}

async function collectUncreatedState(clients, deployment, tokenId, expectedOwner, blockNumber) {
  const codes = {};
  for (const name of CORE_CONTRACT_NAMES) {
    const contract = deployment.contracts[name];
    const code = await dualCode(clients, contract.address, blockNumber, name);
    const runtimeHash = keccak256(code).toLowerCase();
    same(runtimeHash, contract.runtimeBytecodeHash, "RUNTIME_HASH_MISMATCH",
      `${name} runtime bytecode hash`);
    codes[name] = runtimeHash;
  }
  const collectionCode = await dualCode(clients, ACTIVATION_CANONICAL_COLLECTION, blockNumber,
    "canonical Gogh Punks");
  const canonicalRegistryCode = await dualCode(
    clients,
    ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    blockNumber,
    "canonical ERC-6551 registry",
  );
  same(keccak256(canonicalRegistryCode).toLowerCase(), ACTIVATION_CANONICAL_ERC6551_RUNTIME_HASH,
    "RUNTIME_HASH_MISMATCH", "canonical ERC-6551 registry runtime hash");
  const ownerCode = await dualCode(clients, expectedOwner, blockNumber, "expected Punk owner", {
    allowEmpty: true,
  });
  if (!emptyCode(ownerCode)) fail("OWNER_NOT_EOA", "expected Punk owner has contract code");

  const registryAddress = deployment.contracts.GoghPunkAccountRegistry.address;
  const implementation = deployment.contracts.GoghPunkAccountV1.address;
  const policy = deployment.contracts.BrokerPolicyModule.address;
  const agent = deployment.contracts.ArtAgentRegistry.address;
  const adapter = deployment.contracts.ArtAdapterRegistry.address;
  const readRegistry = (functionName, args = []) => dualRead(clients, blockNumber, {
    address: registryAddress,
    abi: accountRegistryAbi,
    functionName,
    args,
  }, `account registry ${functionName}`);
  const [
    registryChain,
    registryCollection,
    registryCanonicalConstant,
    registryCanonical,
    registryImplementation,
    registrySalt,
    facadeAccount,
    facadeCreated,
    canonicalAccount,
    tokenOwner,
    policyChain,
    policyCollection,
    policyAdapter,
    policyOwner,
    policyPendingOwner,
    policyPaused,
    features,
    agentOwner,
    agentPendingOwner,
    agentPaused,
    adapterOwner,
    adapterPendingOwner,
    adapterPaused,
    implementationChain,
    implementationCollection,
    implementationPolicy,
    implementationAgent,
    implementationAdapter,
  ] = await Promise.all([
    readRegistry("ROBINHOOD_CHAIN_ID"),
    readRegistry("GOGH_PUNKS"),
    readRegistry("CANONICAL_ERC6551_REGISTRY"),
    readRegistry("canonicalRegistry"),
    readRegistry("implementation"),
    readRegistry("accountSalt"),
    readRegistry("account", [tokenId]),
    readRegistry("isAccountCreated", [tokenId]),
    dualRead(clients, blockNumber, {
      address: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
      abi: canonicalRegistryAbi,
      functionName: "account",
      args: [implementation, ZERO_SALT, BigInt(ACTIVATION_CHAIN_ID),
        ACTIVATION_CANONICAL_COLLECTION, tokenId],
    }, "canonical registry account derivation"),
    dualRead(clients, blockNumber, {
      address: ACTIVATION_CANONICAL_COLLECTION,
      abi: collectionAbi,
      functionName: "ownerOf",
      args: [tokenId],
    }, "canonical Punk owner"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "ROBINHOOD_CHAIN_ID" }, "policy chain binding"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "GOGH_PUNKS" }, "policy collection binding"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "adapterRegistry" }, "policy adapter binding"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "owner" }, "policy owner"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "pendingOwner" }, "policy pending owner"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "globallyPaused" }, "policy global pause"),
    dualRead(clients, blockNumber, { address: policy, abi: policyAbi,
      functionName: "featureFlags" }, "policy feature flags"),
    dualRead(clients, blockNumber, { address: agent, abi: pauseRegistryAbi,
      functionName: "owner" }, "agent registry owner"),
    dualRead(clients, blockNumber, { address: agent, abi: pauseRegistryAbi,
      functionName: "pendingOwner" }, "agent registry pending owner"),
    dualRead(clients, blockNumber, { address: agent, abi: pauseRegistryAbi,
      functionName: "globallyPaused" }, "agent registry global pause"),
    dualRead(clients, blockNumber, { address: adapter, abi: pauseRegistryAbi,
      functionName: "owner" }, "adapter registry owner"),
    dualRead(clients, blockNumber, { address: adapter, abi: pauseRegistryAbi,
      functionName: "pendingOwner" }, "adapter registry pending owner"),
    dualRead(clients, blockNumber, { address: adapter, abi: pauseRegistryAbi,
      functionName: "globallyPaused" }, "adapter registry global pause"),
    dualRead(clients, blockNumber, { address: implementation, abi: accountImplementationAbi,
      functionName: "ROBINHOOD_CHAIN_ID" }, "implementation chain binding"),
    dualRead(clients, blockNumber, { address: implementation, abi: accountImplementationAbi,
      functionName: "GOGH_PUNKS" }, "implementation collection binding"),
    dualRead(clients, blockNumber, { address: implementation, abi: accountImplementationAbi,
      functionName: "policyModule" }, "implementation policy binding"),
    dualRead(clients, blockNumber, { address: implementation, abi: accountImplementationAbi,
      functionName: "agentRegistry" }, "implementation agent binding"),
    dualRead(clients, blockNumber, { address: implementation, abi: accountImplementationAbi,
      functionName: "adapterRegistry" }, "implementation adapter binding"),
  ]);

  same(parseUint(registryChain, "registry chain"), BigInt(ACTIVATION_CHAIN_ID),
    "WIRING_MISMATCH", "registry chain");
  sameAddress(registryCollection, ACTIVATION_CANONICAL_COLLECTION, "WIRING_MISMATCH",
    "registry collection");
  sameAddress(registryCanonicalConstant, ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    "WIRING_MISMATCH", "registry canonical constant");
  sameAddress(registryCanonical, ACTIVATION_CANONICAL_ERC6551_REGISTRY, "WIRING_MISMATCH",
    "registry canonical singleton");
  sameAddress(registryImplementation, implementation, "WIRING_MISMATCH",
    "registry implementation");
  same(normalizeHash(registrySalt, "registry salt", { allowZero: true }), ZERO_SALT,
    "WIRING_MISMATCH", "registry salt");
  same(parseUint(policyChain, "policy chain"), BigInt(ACTIVATION_CHAIN_ID),
    "WIRING_MISMATCH", "policy chain");
  sameAddress(policyCollection, ACTIVATION_CANONICAL_COLLECTION, "WIRING_MISMATCH",
    "policy collection");
  sameAddress(policyAdapter, adapter, "WIRING_MISMATCH", "policy adapter registry");
  same(parseUint(implementationChain, "implementation chain"), BigInt(ACTIVATION_CHAIN_ID),
    "WIRING_MISMATCH", "implementation chain");
  sameAddress(implementationCollection, ACTIVATION_CANONICAL_COLLECTION, "WIRING_MISMATCH",
    "implementation collection");
  sameAddress(implementationPolicy, policy, "WIRING_MISMATCH", "implementation policy module");
  sameAddress(implementationAgent, agent, "WIRING_MISMATCH", "implementation agent registry");
  sameAddress(implementationAdapter, adapter, "WIRING_MISMATCH",
    "implementation adapter registry");

  for (const [label, actual] of [
    ["policy owner", policyOwner], ["agent registry owner", agentOwner],
    ["adapter registry owner", adapterOwner],
  ]) sameAddress(actual, deployment.guardian, "GUARDIAN_MISMATCH", label);
  for (const [label, actual] of [
    ["policy pending owner", policyPendingOwner],
    ["agent registry pending owner", agentPendingOwner],
    ["adapter registry pending owner", adapterPendingOwner],
  ]) sameAddress(actual, ZERO_ADDRESS, "PENDING_OWNERSHIP_TRANSFER", label, { allowZero: true });
  for (const [label, actual] of [
    ["policy global pause", policyPaused], ["agent registry global pause", agentPaused],
    ["adapter registry global pause", adapterPaused],
  ]) same(rpcBool(actual, label), false, "UNSAFE_PROTOCOL_STATE", label);
  const normalizedFeatures = featureTuple(features, "policy feature flags");
  if (canonicalJson(normalizedFeatures) !== canonicalJson(expectedFeaturesAsRpcTuple())) {
    fail("UNSAFE_FEATURE_FLAGS", "live feature flags are not the foundation defaults");
  }

  const owner = rpcAddress(tokenOwner, "current Punk owner");
  sameAddress(owner, expectedOwner, "OWNER_MISMATCH", "current Punk owner");
  const facade = rpcAddress(facadeAccount, "facade account");
  const canonical = rpcAddress(canonicalAccount, "canonical account");
  sameAddress(facade, canonical, "ACCOUNT_DERIVATION_MISMATCH", "derived Punk Account");
  const locallyDerived = expectedPunkAccountAddress({
    implementation,
    salt: deployment.accountSalt,
    tokenId,
  });
  sameAddress(facade, locallyDerived, "ACCOUNT_DERIVATION_MISMATCH",
    "locally derived CREATE2 Punk Account");
  if (facade.toLowerCase() === expectedOwner.toLowerCase()) {
    fail("OWNERSHIP_CYCLE", "Punk cannot be owned by its own counterfactual account");
  }
  same(rpcBool(facadeCreated, "facade account creation state"), false,
    "ACCOUNT_ALREADY_CREATED", "facade account creation state");
  const accountCode = await dualCode(clients, facade, blockNumber, "counterfactual Punk Account", {
    allowEmpty: true,
  });
  if (!emptyCode(accountCode)) fail("ACCOUNT_ALREADY_CREATED", "Punk Account already has code");

  return Object.freeze({
    runtimeHashes: Object.freeze(codes),
    collectionRuntimeCodeHash: keccak256(collectionCode).toLowerCase(),
    canonicalRegistryRuntimeCodeHash: keccak256(canonicalRegistryCode).toLowerCase(),
    account: facade,
    currentOwner: owner,
    protocolState: Object.freeze({
      guardian: deployment.guardian,
      pendingOwners: ZERO_ADDRESS,
      globallyPaused: false,
      featureFlags: Object.freeze({ ...SAFE_FEATURE_FLAGS }),
    }),
  });
}

function reviewInput(inputValue) {
  const input = snapshotJson(inputValue, "activation input", 1_000_000);
  exactKeys(input, ["manifest", "tokenId", "expectedOwner", "confirmations"],
    "activation input");
  const expectedOwner = normalizeAddress(input.expectedOwner, "expected Punk owner");
  if (BigInt(expectedOwner) <= 0xffffn) {
    fail("OWNER_NOT_EOA", "expected Punk owner may not be a precompile/system-address candidate");
  }
  return {
    deployment: validateManifest(input.manifest),
    tokenId: parseUint(input.tokenId, "Punk token ID"),
    expectedOwner,
    confirmations: confirmations(input.confirmations),
  };
}

function blockArtifact(block, confirmationCount = undefined) {
  const output = {
    number: block.number.toString(),
    hash: block.hash,
    timestamp: block.timestamp.toString(),
  };
  if (confirmationCount !== undefined) output.confirmations = confirmationCount;
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export async function buildPunkAccountActivationReview(inputValue, dependencies) {
  const input = reviewInput(inputValue);
  const clients = clientsFromDependencies(dependencies);
  if (input.expectedOwner.toLowerCase() === input.deployment.guardian.toLowerCase()) {
    fail("ROLE_COLLISION", "Punk owner must differ from the protocol guardian");
  }
  const latestDeploymentBlock = CORE_CONTRACT_NAMES.reduce((maximum, name) => {
    const current = input.deployment.contracts[name].deploymentBlock;
    return current > maximum ? current : maximum;
  }, 0n);
  const chainIds = await dual(
    clients.primary.getChainId(),
    clients.secondary.getChainId(),
    "RPC chain ID",
  );
  same(parseUint(chainIds.primary, "primary chain ID"), BigInt(ACTIVATION_CHAIN_ID),
    "WRONG_CHAIN", "primary RPC chain ID");
  same(parseUint(chainIds.secondary, "secondary chain ID"), BigInt(ACTIVATION_CHAIN_ID),
    "WRONG_CHAIN", "secondary RPC chain ID");

  const confirmed = await pinCommonBlock(
    clients,
    input.confirmations,
    "confirmed activation preflight",
    latestDeploymentBlock,
  );
  await validateDeploymentReceipts(clients, input.deployment, confirmed.number);
  const confirmedState = await collectUncreatedState(
    clients,
    input.deployment,
    input.tokenId,
    input.expectedOwner,
    confirmed.number,
  );
  await recheckBlock(clients, confirmed, "confirmed activation preflight");

  const fresh = await pinFreshCommonBlock(clients, "fresh activation simulation", confirmed.number);
  const freshState = await collectUncreatedState(
    clients,
    input.deployment,
    input.tokenId,
    input.expectedOwner,
    fresh.number,
  );
  same(freshState.account.toLowerCase(), confirmedState.account.toLowerCase(),
    "ACCOUNT_DERIVATION_MISMATCH", "fresh derived Punk Account");
  same(freshState.collectionRuntimeCodeHash, confirmedState.collectionRuntimeCodeHash,
    "RUNTIME_HASH_MISMATCH", "canonical collection runtime across pins");
  same(freshState.canonicalRegistryRuntimeCodeHash,
    confirmedState.canonicalRegistryRuntimeCodeHash, "RUNTIME_HASH_MISMATCH",
    "canonical ERC-6551 registry runtime across pins");
  for (const name of CORE_CONTRACT_NAMES) {
    same(freshState.runtimeHashes[name], confirmedState.runtimeHashes[name],
      "RUNTIME_HASH_MISMATCH", `${name} runtime across pins`);
  }
  const data = encodeFunctionData({
    abi: accountRegistryAbi,
    functionName: "createAccount",
    args: [input.tokenId],
  });
  const callRequest = {
    account: input.expectedOwner,
    to: input.deployment.contracts.GoghPunkAccountRegistry.address,
    data,
    value: 0n,
    blockNumber: fresh.number,
  };
  const simulated = await dual(
    clients.primary.call(callRequest),
    clients.secondary.call(callRequest),
    "owner-direct activation eth_call",
  );
  const primaryData = ownValue(simulated.primary, "data", "primary activation simulation");
  const secondaryData = ownValue(simulated.secondary, "data", "secondary activation simulation");
  if (typeof primaryData !== "string" || !/^0x[0-9a-fA-F]*$/.test(primaryData)
    || primaryData.length % 2 !== 0 || primaryData.toLowerCase() !== secondaryData?.toLowerCase()) {
    fail("INVALID_SIMULATION", "activation simulation return data is malformed or inconsistent");
  }
  let returnedAccount;
  try {
    returnedAccount = decodeFunctionResult({
      abi: accountRegistryAbi,
      functionName: "createAccount",
      data: primaryData,
    });
  } catch {
    fail("INVALID_SIMULATION", "activation simulation did not return an account address");
  }
  sameAddress(returnedAccount, freshState.account, "SIMULATION_MISMATCH",
    "activation simulation return account");
  const afterSimulationCode = await dualCode(
    clients,
    freshState.account,
    fresh.number,
    "post-simulation counterfactual Punk Account",
    { allowEmpty: true },
  );
  if (!emptyCode(afterSimulationCode)) {
    fail("SIMULATION_MUTATED_STATE", "read-only simulation appears to have created account code");
  }
  await recheckBlock(clients, fresh, "fresh activation simulation");

  const expectedRuntime = expectedPunkAccountRuntime({
    implementation: input.deployment.contracts.GoghPunkAccountV1.address,
    salt: input.deployment.accountSalt,
    tokenId: input.tokenId,
  });
  const expectedCreationBytecode = `0x${ERC6551_CREATION_PREFIX}${expectedRuntime.slice(2)}`;
  const transaction = {
    from: input.expectedOwner,
    to: input.deployment.contracts.GoghPunkAccountRegistry.address,
    value: "0",
    data,
    selector: data.slice(0, 10).toLowerCase(),
    calldataKeccak256: keccak256(data).toLowerCase(),
  };
  const review = {
    schema: ACTIVATION_REVIEW_SCHEMA,
    status: "ENCODING_ONLY_OWNER_REVIEW",
    chainId: ACTIVATION_CHAIN_ID,
    manifestBinding: {
      canonicalJsonSha256: input.deployment.manifestHash,
      sourceVerificationAdoptionSha256: input.deployment.sourceVerificationAdoptionHash,
      gitCommit: input.deployment.gitCommit,
      coreRuntimeCodeHashes: { ...confirmedState.runtimeHashes },
    },
    infrastructure: {
      canonicalCollection: ACTIVATION_CANONICAL_COLLECTION,
      canonicalERC6551Registry: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
      canonicalERC6551RegistryRuntimeCodeHash:
        confirmedState.canonicalRegistryRuntimeCodeHash,
      endpointOriginSha256: [...clients.endpointOriginHashes],
      providerSeparation:
        "DISTINCT_REGISTRABLE_DOMAINS_PROVIDER_INDEPENDENCE_UNVERIFIED",
    },
    punk: {
      tokenId: input.tokenId.toString(),
      currentOwner: input.expectedOwner,
      ownerType: "EOA_NO_RUNTIME_CODE",
      account: freshState.account,
      accountCreated: false,
    },
    accountRuntimeCommitment: {
      implementation: input.deployment.contracts.GoghPunkAccountV1.address,
      salt: input.deployment.accountSalt,
      expectedRuntimeByteLength: (expectedRuntime.length - 2) / 2,
      expectedRuntimeCodeHash: keccak256(expectedRuntime).toLowerCase(),
      creationBytecodeHash: keccak256(expectedCreationBytecode).toLowerCase(),
      footer: {
        chainId: ACTIVATION_CHAIN_ID,
        collection: ACTIVATION_CANONICAL_COLLECTION,
        tokenId: input.tokenId.toString(),
      },
      modules: {
        policy: input.deployment.contracts.BrokerPolicyModule.address,
        agents: input.deployment.contracts.ArtAgentRegistry.address,
        adapters: input.deployment.contracts.ArtAdapterRegistry.address,
      },
    },
    transaction,
    confirmedEvidence: {
      block: blockArtifact(confirmed, input.confirmations),
      runtimeAndImmutableBindingsMatched: true,
      foundationFeatureFlagsMatched: true,
      accountWasUncreated: true,
      ownerWasCurrentEoa: true,
      deploymentReceiptsMatched: true,
    },
    latestSimulation: {
      block: blockArtifact(fresh),
      caller: input.expectedOwner,
      returnedAccount: freshState.account,
      returnDataKeccak256: keccak256(primaryData).toLowerCase(),
      providersMatched: true,
      accountRemainedUncreated: true,
    },
    authorizationBoundary: {
      signingPerformed: false,
      submissionPerformed: false,
      chainWritePerformed: false,
      transactionAuthorized: false,
      privateKeyAccepted: false,
      walletMustDisplayExactFields: ["chainId", "from", "to", "value", "data"],
      walletMustRecheckCurrentOwnerAndUncreatedAccount: true,
    },
  };
  const artifact = {
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    reviewHash: sha256Canonical(review),
    review,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
  };
  return deepFreeze(artifact);
}

function validateReviewArtifact(value) {
  const artifact = snapshotJson(value, "activation review artifact", 1_000_000);
  exactKeys(artifact, [
    "hashAlgorithm", "reviewHash", "review", "transactionAuthorized", "signingPerformed",
    "submissionPerformed", "chainWritePerformed",
  ], "activation review artifact");
  same(artifact.hashAlgorithm, "SHA256_CANONICAL_JSON_V1", "INVALID_REVIEW",
    "review hash algorithm");
  for (const name of [
    "transactionAuthorized", "signingPerformed", "submissionPerformed", "chainWritePerformed",
  ]) same(artifact[name], false, "INVALID_REVIEW", `review ${name}`);
  const review = artifact.review;
  exactKeys(review, [
    "schema", "status", "chainId", "manifestBinding", "infrastructure", "punk",
    "accountRuntimeCommitment", "transaction", "confirmedEvidence", "latestSimulation",
    "authorizationBoundary",
  ], "activation review");
  same(review.schema, ACTIVATION_REVIEW_SCHEMA, "INVALID_REVIEW", "review schema");
  same(review.status, "ENCODING_ONLY_OWNER_REVIEW", "INVALID_REVIEW", "review status");
  same(review.chainId, ACTIVATION_CHAIN_ID, "WRONG_CHAIN", "review chain ID");
  same(normalizeHash(artifact.reviewHash, "review hash"), sha256Canonical(review),
    "REVIEW_HASH_MISMATCH", "review hash");
  exactKeys(review.manifestBinding, [
    "canonicalJsonSha256", "sourceVerificationAdoptionSha256", "gitCommit",
    "coreRuntimeCodeHashes",
  ], "review manifest binding");
  exactKeys(review.manifestBinding.coreRuntimeCodeHashes, CORE_CONTRACT_NAMES,
    "review core runtime hashes");
  exactKeys(review.infrastructure, [
    "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "endpointOriginSha256", "providerSeparation",
  ], "review infrastructure");
  exactKeys(review.punk, [
    "tokenId", "currentOwner", "ownerType", "account", "accountCreated",
  ], "review Punk");
  exactKeys(review.accountRuntimeCommitment, [
    "implementation", "salt", "expectedRuntimeByteLength", "expectedRuntimeCodeHash",
    "creationBytecodeHash", "footer", "modules",
  ], "review account runtime commitment");
  exactKeys(review.accountRuntimeCommitment.footer, ["chainId", "collection", "tokenId"],
    "review account footer");
  exactKeys(review.accountRuntimeCommitment.modules, ["policy", "agents", "adapters"],
    "review modules");
  exactKeys(review.transaction, [
    "from", "to", "value", "data", "selector", "calldataKeccak256",
  ], "review transaction");
  exactKeys(review.confirmedEvidence, [
    "block", "runtimeAndImmutableBindingsMatched", "foundationFeatureFlagsMatched",
    "accountWasUncreated", "ownerWasCurrentEoa", "deploymentReceiptsMatched",
  ], "review confirmed evidence");
  exactKeys(review.confirmedEvidence.block, ["number", "hash", "timestamp", "confirmations"],
    "review confirmed block");
  exactKeys(review.latestSimulation, [
    "block", "caller", "returnedAccount", "returnDataKeccak256", "providersMatched",
    "accountRemainedUncreated",
  ], "review latest simulation");
  exactKeys(review.latestSimulation.block, ["number", "hash", "timestamp"],
    "review simulation block");
  exactKeys(review.authorizationBoundary, [
    "signingPerformed", "submissionPerformed", "chainWritePerformed", "transactionAuthorized",
    "privateKeyAccepted", "walletMustDisplayExactFields",
    "walletMustRecheckCurrentOwnerAndUncreatedAccount",
  ], "review authorization boundary");
  if (!Array.isArray(review.infrastructure.endpointOriginSha256)
    || review.infrastructure.endpointOriginSha256.length !== 2) {
    fail("INVALID_REVIEW", "review must bind exactly two RPC endpoint origins");
  }
  const endpointHashes = review.infrastructure.endpointOriginSha256.map((value, index) => (
    normalizeHash(value, `review endpoint origin hash ${index}`)
  ));
  if (endpointHashes[0] === endpointHashes[1]) {
    fail("INVALID_REVIEW", "review endpoint origin hashes must differ");
  }
  sameAddress(review.infrastructure.canonicalCollection, ACTIVATION_CANONICAL_COLLECTION,
    "NONCANONICAL_COLLECTION", "review infrastructure collection");
  sameAddress(review.infrastructure.canonicalERC6551Registry,
    ACTIVATION_CANONICAL_ERC6551_REGISTRY, "NONCANONICAL_REGISTRY",
    "review infrastructure canonical registry");
  normalizeHash(review.infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    "review infrastructure canonical registry runtime hash");
  same(review.infrastructure.providerSeparation,
    "DISTINCT_REGISTRABLE_DOMAINS_PROVIDER_INDEPENDENCE_UNVERIFIED", "INVALID_REVIEW",
    "review provider-separation boundary");
  const confirmedNumber = parseUint(review.confirmedEvidence.block.number,
    "review confirmed block number", { positive: true });
  normalizeHash(review.confirmedEvidence.block.hash, "review confirmed block hash");
  const confirmedTimestamp = parseUint(review.confirmedEvidence.block.timestamp,
    "review confirmed block timestamp", { positive: true });
  confirmations(review.confirmedEvidence.block.confirmations);
  const simulationNumber = parseUint(review.latestSimulation.block.number,
    "review simulation block number", { positive: true });
  normalizeHash(review.latestSimulation.block.hash, "review simulation block hash");
  const simulationTimestamp = parseUint(review.latestSimulation.block.timestamp,
    "review simulation block timestamp", { positive: true });
  if (simulationNumber < confirmedNumber || simulationTimestamp < confirmedTimestamp) {
    fail("INVALID_REVIEW", "review simulation block predates the confirmed evidence block");
  }
  normalizeHash(review.latestSimulation.returnDataKeccak256,
    "review simulation return-data hash");
  normalizeBytes(review.transaction.data, "review transaction calldata");
  if (typeof review.transaction.selector !== "string"
    || !/^0x[0-9a-fA-F]{8}$/.test(review.transaction.selector)) {
    fail("INVALID_REVIEW", "review transaction selector is malformed");
  }
  for (const field of [
    "runtimeAndImmutableBindingsMatched", "foundationFeatureFlagsMatched", "accountWasUncreated",
    "ownerWasCurrentEoa", "deploymentReceiptsMatched",
  ]) same(review.confirmedEvidence[field], true, "INVALID_REVIEW", `review evidence ${field}`);
  same(review.latestSimulation.providersMatched, true, "INVALID_REVIEW",
    "review provider simulation agreement");
  same(review.latestSimulation.accountRemainedUncreated, true, "INVALID_REVIEW",
    "review post-simulation account state");
  for (const field of [
    "signingPerformed", "submissionPerformed", "chainWritePerformed", "transactionAuthorized",
    "privateKeyAccepted",
  ]) same(review.authorizationBoundary[field], false, "INVALID_REVIEW",
    `review authorization ${field}`);
  same(review.authorizationBoundary.walletMustRecheckCurrentOwnerAndUncreatedAccount, true,
    "INVALID_REVIEW", "review wallet state recheck requirement");
  if (canonicalJson(review.authorizationBoundary.walletMustDisplayExactFields)
    !== canonicalJson(["chainId", "from", "to", "value", "data"])) {
    fail("INVALID_REVIEW", "review wallet display fields are incomplete");
  }
  same(review.punk.ownerType, "EOA_NO_RUNTIME_CODE", "INVALID_REVIEW", "review owner type");
  same(review.punk.accountCreated, false, "INVALID_REVIEW", "review account creation state");
  return { artifact, review };
}

function validateReviewAgainstManifest(review, deployment) {
  same(normalizeHash(review.manifestBinding.canonicalJsonSha256, "review manifest hash"),
    deployment.manifestHash, "MANIFEST_MISMATCH", "review manifest hash");
  same(normalizeHash(review.manifestBinding.sourceVerificationAdoptionSha256,
    "review source verification adoption hash"), deployment.sourceVerificationAdoptionHash,
  "MANIFEST_MISMATCH", "review source verification adoption hash");
  same(normalizeCommit(review.manifestBinding.gitCommit, "review commit"), deployment.gitCommit,
    "MANIFEST_MISMATCH", "review commit");
  for (const name of CORE_CONTRACT_NAMES) {
    same(normalizeHash(review.manifestBinding.coreRuntimeCodeHashes[name],
      `review ${name} runtime hash`), deployment.contracts[name].runtimeBytecodeHash,
    "MANIFEST_MISMATCH", `review ${name} runtime hash`);
  }
  sameAddress(review.infrastructure.canonicalCollection, ACTIVATION_CANONICAL_COLLECTION,
    "NONCANONICAL_COLLECTION", "review canonical collection");
  sameAddress(review.infrastructure.canonicalERC6551Registry,
    ACTIVATION_CANONICAL_ERC6551_REGISTRY, "NONCANONICAL_REGISTRY",
    "review canonical ERC-6551 registry");
  same(normalizeHash(review.infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    "review canonical registry runtime hash"), ACTIVATION_CANONICAL_ERC6551_RUNTIME_HASH,
  "NONCANONICAL_REGISTRY", "review canonical registry runtime hash");
  const tokenId = parseUint(review.punk.tokenId, "review Punk token ID");
  const expectedOwner = normalizeAddress(review.punk.currentOwner, "review current owner");
  const account = normalizeAddress(review.punk.account, "review Punk Account");
  same(review.punk.ownerType, "EOA_NO_RUNTIME_CODE", "INVALID_REVIEW", "review owner type");
  same(review.punk.accountCreated, false, "INVALID_REVIEW", "review account creation state");
  sameAddress(review.accountRuntimeCommitment.implementation,
    deployment.contracts.GoghPunkAccountV1.address, "MANIFEST_MISMATCH",
    "review implementation");
  same(normalizeHash(review.accountRuntimeCommitment.salt, "review salt", { allowZero: true }),
    deployment.accountSalt, "MANIFEST_MISMATCH", "review account salt");
  const runtime = expectedPunkAccountRuntime({
    implementation: deployment.contracts.GoghPunkAccountV1.address,
    salt: deployment.accountSalt,
    tokenId,
  });
  const creationBytecode = `0x${ERC6551_CREATION_PREFIX}${runtime.slice(2)}`;
  same(review.accountRuntimeCommitment.expectedRuntimeByteLength, (runtime.length - 2) / 2,
    "RUNTIME_HASH_MISMATCH", "review expected runtime length");
  same(normalizeHash(review.accountRuntimeCommitment.expectedRuntimeCodeHash,
    "review expected runtime hash"), keccak256(runtime).toLowerCase(),
  "RUNTIME_HASH_MISMATCH", "review expected runtime hash");
  same(normalizeHash(review.accountRuntimeCommitment.creationBytecodeHash,
    "review creation bytecode hash"), keccak256(creationBytecode).toLowerCase(),
  "RUNTIME_HASH_MISMATCH", "review creation bytecode hash");
  sameAddress(account, expectedPunkAccountAddress({
    implementation: deployment.contracts.GoghPunkAccountV1.address,
    salt: deployment.accountSalt,
    tokenId,
  }), "ACCOUNT_DERIVATION_MISMATCH", "review locally derived CREATE2 account");
  same(review.accountRuntimeCommitment.footer.chainId, ACTIVATION_CHAIN_ID,
    "FOOTER_MISMATCH", "review footer chain");
  sameAddress(review.accountRuntimeCommitment.footer.collection,
    ACTIVATION_CANONICAL_COLLECTION, "FOOTER_MISMATCH", "review footer collection");
  same(parseUint(review.accountRuntimeCommitment.footer.tokenId, "review footer token ID"),
    tokenId, "FOOTER_MISMATCH", "review footer token ID");
  for (const [field, contract] of [
    ["policy", "BrokerPolicyModule"], ["agents", "ArtAgentRegistry"],
    ["adapters", "ArtAdapterRegistry"],
  ]) sameAddress(review.accountRuntimeCommitment.modules[field], deployment.contracts[contract].address,
    "WIRING_MISMATCH", `review ${field} module`);
  const expectedData = encodeFunctionData({
    abi: accountRegistryAbi,
    functionName: "createAccount",
    args: [tokenId],
  });
  sameAddress(review.transaction.from, expectedOwner, "TRANSACTION_MISMATCH", "review sender");
  sameAddress(review.transaction.to, deployment.contracts.GoghPunkAccountRegistry.address,
    "TRANSACTION_MISMATCH", "review destination");
  same(review.transaction.value, "0", "TRANSACTION_MISMATCH", "review value");
  same(normalizeBytes(review.transaction.data, "review transaction calldata"),
    expectedData.toLowerCase(),
    "TRANSACTION_MISMATCH", "review calldata");
  same(review.transaction.selector?.toLowerCase(), expectedData.slice(0, 10).toLowerCase(),
    "TRANSACTION_MISMATCH", "review selector");
  same(normalizeHash(review.transaction.calldataKeccak256, "review calldata hash"),
    keccak256(expectedData).toLowerCase(), "TRANSACTION_MISMATCH", "review calldata hash");
  sameAddress(review.latestSimulation.caller, expectedOwner, "INVALID_REVIEW",
    "review simulation caller");
  sameAddress(review.latestSimulation.returnedAccount, account, "INVALID_REVIEW",
    "review simulation account");
  normalizeHash(review.latestSimulation.returnDataKeccak256, "review simulation return hash");
  return { tokenId, expectedOwner, account, expectedRuntime: runtime, data: expectedData };
}

function normalizeLog(log, label) {
  if (!log || typeof log !== "object" || ownValue(log, "removed", label) === true) {
    fail("INVALID_RECEIPT", `${label} is missing or removed`);
  }
  const topics = ownValue(log, "topics", label);
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > 4) {
    fail("INVALID_RECEIPT", `${label}.topics are malformed`);
  }
  const normalizedTopics = topics.map((topic, index) => (
    normalizeHash(topic, `${label}.topics[${index}]`, { allowZero: true })
  ));
  return {
    address: rpcAddress(ownValue(log, "address", label), `${label}.address`),
    data: normalizeBytes(ownValue(log, "data", label), `${label}.data`, { allowEmpty: true }),
    topics: normalizedTopics,
    transactionHash: normalizeHash(ownValue(log, "transactionHash", label),
      `${label}.transactionHash`),
    blockHash: normalizeHash(ownValue(log, "blockHash", label), `${label}.blockHash`),
    blockNumber: parseUint(ownValue(log, "blockNumber", label), `${label}.blockNumber`),
    transactionIndex: parseUint(ownValue(log, "transactionIndex", label),
      `${label}.transactionIndex`),
    logIndex: parseUint(ownValue(log, "logIndex", label), `${label}.logIndex`),
  };
}

function decodeExactEvent(log, abi, label) {
  try {
    return decodeEventLog({ abi: [abi], data: log.data, topics: log.topics, strict: true });
  } catch {
    fail("EVENT_MISMATCH", `${label} is not the expected exact event`);
  }
}

function eventArg(event, name, label) {
  return ownValue(event.args, name, `${label}.args`);
}

async function collectActivatedState(clients, deployment, target, blockNumber) {
  for (const name of CORE_CONTRACT_NAMES) {
    const coreRuntime = await dualCode(
      clients,
      deployment.contracts[name].address,
      blockNumber,
      `post-activation ${name}`,
    );
    same(keccak256(coreRuntime).toLowerCase(), deployment.contracts[name].runtimeBytecodeHash,
      "RUNTIME_HASH_MISMATCH", `post-activation ${name} runtime hash`);
  }
  const singletonRuntime = await dualCode(
    clients,
    ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    blockNumber,
    "post-activation canonical ERC-6551 registry",
  );
  same(keccak256(singletonRuntime).toLowerCase(), ACTIVATION_CANONICAL_ERC6551_RUNTIME_HASH,
    "RUNTIME_HASH_MISMATCH", "post-activation canonical ERC-6551 registry runtime hash");
  const runtime = await dualCode(clients, target.account, blockNumber, "activated Punk Account");
  same(runtime, target.expectedRuntime.toLowerCase(), "ACCOUNT_RUNTIME_MISMATCH",
    "activated Punk Account runtime");
  const expectedRuntimeHash = keccak256(target.expectedRuntime).toLowerCase();
  same(keccak256(runtime).toLowerCase(), expectedRuntimeHash, "ACCOUNT_RUNTIME_MISMATCH",
    "activated Punk Account runtime hash");
  const registryAddress = deployment.contracts.GoghPunkAccountRegistry.address;
  const [
    facadeAccount,
    created,
    canonicalAccount,
    tokenOwner,
    ownerCode,
    accountOwner,
    canonical,
    footer,
    policy,
    agent,
    adapter,
    state,
    acquisitionNonce,
  ] = await Promise.all([
    dualRead(clients, blockNumber, { address: registryAddress, abi: accountRegistryAbi,
      functionName: "account", args: [target.tokenId] }, "activated facade account"),
    dualRead(clients, blockNumber, { address: registryAddress, abi: accountRegistryAbi,
      functionName: "isAccountCreated", args: [target.tokenId] }, "activated account state"),
    dualRead(clients, blockNumber, { address: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
      abi: canonicalRegistryAbi, functionName: "account",
      args: [deployment.contracts.GoghPunkAccountV1.address, deployment.accountSalt,
        BigInt(ACTIVATION_CHAIN_ID), ACTIVATION_CANONICAL_COLLECTION, target.tokenId] },
    "activated canonical account"),
    dualRead(clients, blockNumber, { address: ACTIVATION_CANONICAL_COLLECTION,
      abi: collectionAbi, functionName: "ownerOf", args: [target.tokenId] },
    "activated Punk owner"),
    dualCode(clients, target.expectedOwner, blockNumber, "activated current owner", {
      allowEmpty: true,
    }),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "owner" }, "Punk Account owner"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "isCanonicalGoghPunkAccount" }, "Punk Account canonical status"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "token" }, "Punk Account footer"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "policyModule" }, "Punk Account policy module"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "agentRegistry" }, "Punk Account agent registry"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "adapterRegistry" }, "Punk Account adapter registry"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "state" }, "Punk Account state"),
    dualRead(clients, blockNumber, { address: target.account, abi: activatedAccountAbi,
      functionName: "acquisitionNonce" }, "Punk Account acquisition nonce"),
  ]);
  sameAddress(facadeAccount, target.account, "ACCOUNT_DERIVATION_MISMATCH",
    "activated facade account");
  sameAddress(canonicalAccount, target.account, "ACCOUNT_DERIVATION_MISMATCH",
    "activated canonical account");
  same(rpcBool(created, "activated account state"), true, "ACCOUNT_NOT_CREATED",
    "activated account state");
  sameAddress(tokenOwner, target.expectedOwner, "OWNER_MISMATCH", "activated Punk owner");
  if (!emptyCode(ownerCode)) fail("OWNER_NOT_EOA", "activated current owner has contract code");
  sameAddress(accountOwner, target.expectedOwner, "OWNER_MISMATCH", "Punk Account owner");
  same(rpcBool(canonical, "Punk Account canonical status"), true, "ACCOUNT_IDENTITY_MISMATCH",
    "Punk Account canonical status");
  same(parseUint(tupleField(footer, "chainId", 0, "Punk Account footer")),
    BigInt(ACTIVATION_CHAIN_ID), "FOOTER_MISMATCH", "Punk Account footer chain");
  sameAddress(tupleField(footer, "tokenContract", 1, "Punk Account footer"),
    ACTIVATION_CANONICAL_COLLECTION, "FOOTER_MISMATCH", "Punk Account footer collection");
  same(parseUint(tupleField(footer, "tokenId", 2, "Punk Account footer")), target.tokenId,
    "FOOTER_MISMATCH", "Punk Account footer token ID");
  sameAddress(policy, deployment.contracts.BrokerPolicyModule.address, "WIRING_MISMATCH",
    "Punk Account policy module");
  sameAddress(agent, deployment.contracts.ArtAgentRegistry.address, "WIRING_MISMATCH",
    "Punk Account agent registry");
  sameAddress(adapter, deployment.contracts.ArtAdapterRegistry.address, "WIRING_MISMATCH",
    "Punk Account adapter registry");
  same(parseUint(state, "Punk Account state"), 0n, "DIRTY_ACCOUNT", "Punk Account state");
  same(parseUint(acquisitionNonce, "Punk Account acquisition nonce"), 0n, "DIRTY_ACCOUNT",
    "Punk Account acquisition nonce");
  return {
    runtimeCodeHash: expectedRuntimeHash,
    currentOwner: target.expectedOwner,
    state: "0",
    acquisitionNonce: "0",
  };
}

function receiptInput(inputValue) {
  const input = snapshotJson(inputValue, "activation receipt input", 2_000_000);
  exactKeys(input, ["manifest", "reviewArtifact", "transactionHash", "confirmations"],
    "activation receipt input");
  const deployment = validateManifest(input.manifest);
  const { artifact, review } = validateReviewArtifact(input.reviewArtifact);
  const target = validateReviewAgainstManifest(review, deployment);
  return {
    deployment,
    reviewArtifact: artifact,
    reviewArtifactHash: sha256Canonical(artifact),
    review,
    reviewHash: normalizeHash(artifact.reviewHash, "review hash"),
    transactionHash: normalizeHash(input.transactionHash, "activation transaction hash"),
    confirmations: confirmations(input.confirmations),
    target,
  };
}

function transactionView(transaction, label) {
  return {
    hash: normalizeHash(ownValue(transaction, "hash", label), `${label}.hash`),
    from: rpcAddress(ownValue(transaction, "from", label), `${label}.from`),
    to: rpcAddress(ownValue(transaction, "to", label), `${label}.to`),
    input: normalizeBytes(ownValue(transaction, "input", label), `${label}.input`),
    value: parseUint(ownValue(transaction, "value", label), `${label}.value`),
    blockNumber: parseUint(ownValue(transaction, "blockNumber", label), `${label}.blockNumber`),
    blockHash: normalizeHash(ownValue(transaction, "blockHash", label), `${label}.blockHash`),
    transactionIndex: parseUint(ownValue(transaction, "transactionIndex", label),
      `${label}.transactionIndex`),
    chainId: Object.hasOwn(transaction, "chainId")
      ? parseUint(ownValue(transaction, "chainId", label), `${label}.chainId`)
      : null,
  };
}

function receiptView(receipt, label) {
  const logs = ownValue(receipt, "logs", label);
  if (!Array.isArray(logs) || logs.length !== 2 || !Object.hasOwn(logs, 0)
    || !Object.hasOwn(logs, 1)) {
    fail("UNEXPECTED_RECEIPT_LOGS", "activation receipt must contain exactly two logs");
  }
  return {
    transactionHash: normalizeHash(ownValue(receipt, "transactionHash", label),
      `${label}.transactionHash`),
    from: rpcAddress(ownValue(receipt, "from", label), `${label}.from`),
    to: rpcAddress(ownValue(receipt, "to", label), `${label}.to`),
    status: ownValue(receipt, "status", label),
    blockNumber: parseUint(ownValue(receipt, "blockNumber", label), `${label}.blockNumber`),
    blockHash: normalizeHash(ownValue(receipt, "blockHash", label), `${label}.blockHash`),
    transactionIndex: parseUint(ownValue(receipt, "transactionIndex", label),
      `${label}.transactionIndex`),
    contractAddress: ownValue(receipt, "contractAddress", label),
    logs: logs.map((log, index) => normalizeLog(log, `${label}.logs[${index}]`)),
  };
}

function validateActivationEvents(receipt, input) {
  const canonicalLog = receipt.logs[0];
  const facadeLog = receipt.logs[1];
  for (const [index, log] of receipt.logs.entries()) {
    same(log.transactionHash, input.transactionHash, "EVENT_MISMATCH",
      `activation log ${index} transaction hash`);
    same(log.blockHash, receipt.blockHash, "EVENT_MISMATCH",
      `activation log ${index} block hash`);
    same(log.blockNumber, receipt.blockNumber, "EVENT_MISMATCH",
      `activation log ${index} block number`);
    same(log.transactionIndex, receipt.transactionIndex, "EVENT_MISMATCH",
      `activation log ${index} transaction index`);
  }
  if (canonicalLog.logIndex >= facadeLog.logIndex) {
    fail("EVENT_MISMATCH", "activation log ordering is not canonical");
  }
  sameAddress(canonicalLog.address, ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    "EVENT_MISMATCH", "ERC-6551 creation event emitter");
  sameAddress(facadeLog.address, input.deployment.contracts.GoghPunkAccountRegistry.address,
    "EVENT_MISMATCH", "Gogh activation event emitter");
  const created = decodeExactEvent(canonicalLog, erc6551CreatedEvent,
    "ERC-6551 creation event");
  sameAddress(eventArg(created, "account", "ERC-6551 creation event"), input.target.account,
    "EVENT_MISMATCH", "ERC-6551 created account");
  sameAddress(eventArg(created, "implementation", "ERC-6551 creation event"),
    input.deployment.contracts.GoghPunkAccountV1.address, "EVENT_MISMATCH",
    "ERC-6551 implementation");
  same(normalizeHash(eventArg(created, "salt", "ERC-6551 creation event"),
    "ERC-6551 salt", { allowZero: true }), input.deployment.accountSalt,
  "EVENT_MISMATCH", "ERC-6551 salt");
  same(parseUint(eventArg(created, "chainId", "ERC-6551 creation event"),
    "ERC-6551 chain ID"), BigInt(ACTIVATION_CHAIN_ID), "EVENT_MISMATCH",
  "ERC-6551 chain ID");
  sameAddress(eventArg(created, "tokenContract", "ERC-6551 creation event"),
    ACTIVATION_CANONICAL_COLLECTION, "EVENT_MISMATCH", "ERC-6551 collection");
  same(parseUint(eventArg(created, "tokenId", "ERC-6551 creation event"),
    "ERC-6551 token ID"), input.target.tokenId, "EVENT_MISMATCH", "ERC-6551 token ID");

  const activated = decodeExactEvent(facadeLog, activationEvent, "Gogh activation event");
  sameAddress(eventArg(activated, "account", "Gogh activation event"), input.target.account,
    "EVENT_MISMATCH", "activated account");
  same(parseUint(eventArg(activated, "chainId", "Gogh activation event"),
    "activated chain ID"), BigInt(ACTIVATION_CHAIN_ID), "EVENT_MISMATCH",
  "activated chain ID");
  sameAddress(eventArg(activated, "collection", "Gogh activation event"),
    ACTIVATION_CANONICAL_COLLECTION, "EVENT_MISMATCH", "activated collection");
  same(parseUint(eventArg(activated, "tokenId", "Gogh activation event"),
    "activated token ID"), input.target.tokenId, "EVENT_MISMATCH", "activated token ID");
  sameAddress(eventArg(activated, "owner", "Gogh activation event"), input.target.expectedOwner,
    "EVENT_MISMATCH", "activation owner");
  sameAddress(eventArg(activated, "implementation", "Gogh activation event"),
    input.deployment.contracts.GoghPunkAccountV1.address, "EVENT_MISMATCH",
    "activation implementation");
  same(parseUint(eventArg(activated, "implementationVersion", "Gogh activation event"),
    "activation implementation version"), 1n, "EVENT_MISMATCH",
  "activation implementation version");
}

export async function attestPunkAccountActivationReceipt(inputValue, dependencies) {
  const input = receiptInput(inputValue);
  const clients = clientsFromDependencies(dependencies);
  const chainIds = await dual(
    clients.primary.getChainId(),
    clients.secondary.getChainId(),
    "receipt RPC chain ID",
  );
  same(parseUint(chainIds.primary, "primary chain ID"), BigInt(ACTIVATION_CHAIN_ID),
    "WRONG_CHAIN", "primary RPC chain ID");
  same(parseUint(chainIds.secondary, "secondary chain ID"), BigInt(ACTIVATION_CHAIN_ID),
    "WRONG_CHAIN", "secondary RPC chain ID");
  const txs = await dual(
    clients.primary.getTransaction({ hash: input.transactionHash }),
    clients.secondary.getTransaction({ hash: input.transactionHash }),
    "activation transaction",
  );
  const receipts = await dual(
    clients.primary.getTransactionReceipt({ hash: input.transactionHash }),
    clients.secondary.getTransactionReceipt({ hash: input.transactionHash }),
    "activation receipt",
  );
  const transaction = transactionView(txs.primary, "activation transaction");
  const receipt = receiptView(receipts.primary, "activation receipt");
  same(transaction.hash, input.transactionHash, "TRANSACTION_MISMATCH", "transaction hash");
  sameAddress(transaction.from, input.target.expectedOwner, "TRANSACTION_MISMATCH",
    "activation sender");
  sameAddress(transaction.to, input.deployment.contracts.GoghPunkAccountRegistry.address,
    "TRANSACTION_MISMATCH", "activation destination");
  same(transaction.input?.toLowerCase(), input.target.data.toLowerCase(), "TRANSACTION_MISMATCH",
    "activation calldata");
  same(transaction.value, 0n, "TRANSACTION_MISMATCH", "activation value");
  if (transaction.chainId !== null) {
    same(transaction.chainId, BigInt(ACTIVATION_CHAIN_ID), "WRONG_CHAIN",
      "activation transaction chain ID");
  }
  same(receipt.transactionHash, input.transactionHash, "RECEIPT_MISMATCH",
    "receipt transaction hash");
  sameAddress(receipt.from, input.target.expectedOwner, "RECEIPT_MISMATCH", "receipt sender");
  sameAddress(receipt.to, input.deployment.contracts.GoghPunkAccountRegistry.address,
    "RECEIPT_MISMATCH", "receipt destination");
  same(receipt.status, "success", "FAILED_RECEIPT", "activation receipt status");
  if (receipt.contractAddress !== null && receipt.contractAddress !== undefined) {
    fail("RECEIPT_MISMATCH", "activation transaction unexpectedly created a top-level contract");
  }
  same(transaction.blockNumber, receipt.blockNumber, "RECEIPT_MISMATCH",
    "activation block number");
  same(transaction.blockHash, receipt.blockHash, "RECEIPT_MISMATCH", "activation block hash");
  same(transaction.transactionIndex, receipt.transactionIndex, "RECEIPT_MISMATCH",
    "activation transaction index");
  validateActivationEvents(receipt, input);

  const heads = await rpcPair(
    clients.primary.getBlockNumber(),
    clients.secondary.getBlockNumber(),
    "activation receipt heads",
  );
  const primaryHead = parseUint(heads.primary, "primary receipt head");
  const secondaryHead = parseUint(heads.secondary, "secondary receipt head");
  const sharedHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const skew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead
    : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("RPC_HEAD_SKEW", "receipt RPC head skew exceeds the bound");
  if (sharedHead < receipt.blockNumber + BigInt(input.confirmations)) {
    fail("INSUFFICIENT_CONFIRMATIONS", "activation receipt lacks required confirmations");
  }
  const receiptBlocks = await rpcPair(
    clients.primary.getBlock({ blockNumber: receipt.blockNumber }),
    clients.secondary.getBlock({ blockNumber: receipt.blockNumber }),
    "activation receipt block",
  );
  const receiptBlock = blockView(receiptBlocks.primary, "activation receipt block");
  const secondaryReceiptBlock = blockView(receiptBlocks.secondary,
    "secondary activation receipt block");
  same(receiptBlock.number, receipt.blockNumber, "RECEIPT_MISMATCH",
    "primary receipt block number");
  same(secondaryReceiptBlock.number, receipt.blockNumber, "RECEIPT_MISMATCH",
    "secondary receipt block number");
  same(receiptBlock.hash, receipt.blockHash, "RECEIPT_MISMATCH", "receipt block hash");
  same(receiptBlock.hash, secondaryReceiptBlock.hash, "RPC_DISAGREEMENT", "receipt block hash");
  same(receiptBlock.timestamp, secondaryReceiptBlock.timestamp, "RPC_DISAGREEMENT",
    "receipt block timestamp");
  const receiptState = await collectActivatedState(
    clients,
    input.deployment,
    input.target,
    receipt.blockNumber,
  );
  await recheckBlock(clients, receiptBlock, "activation receipt block");

  const latest = await pinFreshCommonBlock(clients, "post-activation latest state",
    receipt.blockNumber);
  const latestState = await collectActivatedState(
    clients,
    input.deployment,
    input.target,
    latest.number,
  );
  await recheckBlock(clients, latest, "post-activation latest state");

  const attestation = {
    schema: ACTIVATION_RECEIPT_SCHEMA,
    status: "READ_ONLY_ACTIVATION_CONFIRMED",
    chainId: ACTIVATION_CHAIN_ID,
    evidenceBindings: {
      coreManifestSha256: input.deployment.manifestHash,
      sourceVerificationAdoptionSha256: input.deployment.sourceVerificationAdoptionHash,
      activationReviewSha256: input.reviewHash,
      activationReviewArtifactSha256: input.reviewArtifactHash,
      transactionHash: input.transactionHash,
      endpointOriginSha256: [...clients.endpointOriginHashes],
    },
    transaction: {
      from: transaction.from,
      to: transaction.to,
      value: transaction.value.toString(),
      data: transaction.input.toLowerCase(),
      calldataKeccak256: keccak256(transaction.input).toLowerCase(),
    },
    receipt: {
      status: "success",
      block: blockArtifact(receiptBlock, input.confirmations),
      transactionIndex: transaction.transactionIndex.toString(),
      canonicalERC6551EventVerified: true,
      facadeActivationEventVerified: true,
      exactLogCount: 2,
    },
    punk: {
      tokenId: input.target.tokenId.toString(),
      account: input.target.account,
      currentOwner: input.target.expectedOwner,
      ownerType: "EOA_NO_RUNTIME_CODE",
    },
    account: {
      runtimeCodeHash: receiptState.runtimeCodeHash,
      runtimeByteLength: (input.target.expectedRuntime.length - 2) / 2,
      footer: {
        chainId: ACTIVATION_CHAIN_ID,
        collection: ACTIVATION_CANONICAL_COLLECTION,
        tokenId: input.target.tokenId.toString(),
      },
      modules: { ...input.review.accountRuntimeCommitment.modules },
      state: receiptState.state,
      acquisitionNonce: receiptState.acquisitionNonce,
    },
    latestState: {
      block: blockArtifact(latest),
      accountRuntimeCodeHash: latestState.runtimeCodeHash,
      currentOwner: latestState.currentOwner,
      accountRuntimeFooterModulesStateAndNonceMatched: true,
    },
    trustBoundary: {
      readOnly: true,
      signingPerformed: false,
      submissionPerformed: false,
      chainWritePerformed: false,
      transactionAuthorized: false,
      ownerAuthorityDerivedFromLiveOwnerOf: true,
      activationTransactionGrantedAgentAuthority: false,
      currentAgentAuthority: "UNVERIFIED_BY_ACTIVATION_ATTESTATION",
    },
  };
  return deepFreeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    attestationHash: sha256Canonical(attestation),
    attestation,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
  });
}

export const PUNK_ACCOUNT_ACTIVATION_ABIS = Object.freeze({
  accountRegistryAbi,
  canonicalRegistryAbi,
  collectionAbi,
  policyAbi,
  pauseRegistryAbi,
  accountImplementationAbi,
  activatedAccountAbi,
  erc6551CreatedEvent,
  activationEvent,
});
