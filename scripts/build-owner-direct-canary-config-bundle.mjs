import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
} from "viem";
import {
  deriveOneShotAdapterRegistrationCommitment,
  ONE_SHOT_ADAPTER_VERSION_LABEL,
  ONE_SHOT_MINT_SELECTOR,
} from "../broker/src/recommendation/one-shot-adapter-commitment.mjs";
import { validateCleanPreconfigurationState } from "../broker/src/recommendation/clean-preconfiguration-state.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

export const ROBINHOOD_CHAIN_ID = 4663;
export const CANONICAL_COLLECTION = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
export const CANONICAL_ERC6551_REGISTRY =
  "0x000000006551c19487814612e58FE06813775758";
export const CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_SALT = `0x${"0".repeat(64)}`;
export const CANARY_MINT_SELECTOR = ONE_SHOT_MINT_SELECTOR;
export const MAX_INTENT_AGE_SECONDS = 120;
const MAX_MANIFEST_BYTES = 512_000;

const CORE_CONTRACT_NAMES = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const CANARY_CONTRACT_NAMES = Object.freeze([
  "GoghOneShotCanaryArt",
  "GoghOneShotCanaryMintAdapter",
]);
const SAFE_INITIAL_FEATURE_FLAGS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});
const APPROVAL_ONLY_FEATURE_FLAGS = Object.freeze({
  ...SAFE_INITIAL_FEATURE_FLAGS,
  ENABLE_APPROVAL_PURCHASES: true,
});

const accountRegistryAbi = [{
  type: "function",
  name: "createAccount",
  stateMutability: "nonpayable",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "accountAddress", type: "address" }],
}];
const adapterRegistryAbi = [
  {
    type: "function",
    name: "registerAdapter",
    stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "venue", type: "address" },
      { name: "versionHash", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAdapterActive",
    stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setGloballyPaused",
    stateMutability: "nonpayable",
    inputs: [{ name: "paused", type: "bool" }],
    outputs: [],
  },
];
const featureTuple = {
  name: "flags",
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
};
const policyTuple = {
  name: "config",
  type: "tuple",
  components: [
    { name: "mode", type: "uint8" },
    { name: "maxSpendPerTransaction", type: "uint256" },
    { name: "maxSpendPerDay", type: "uint256" },
    { name: "maxSpendPerWeek", type: "uint256" },
    { name: "maxMintPrice", type: "uint256" },
    { name: "maxSecondaryPurchasePrice", type: "uint256" },
    { name: "minimumNativeReserve", type: "uint256" },
    { name: "maxAcquisitionsPerDay", type: "uint32" },
    { name: "maxIntentAge", type: "uint32" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "requireCollectionAllowlist", type: "bool" },
    { name: "allowUnknownCollections", type: "bool" },
  ],
};
const currencyPolicyTuple = {
  name: "newCurrencyPolicy",
  type: "tuple",
  components: [
    { name: "allowed", type: "bool" },
    { name: "maxSpendPerTransaction", type: "uint256" },
    { name: "maxSpendPerDay", type: "uint256" },
    { name: "maxSpendPerWeek", type: "uint256" },
    { name: "maxMintPrice", type: "uint256" },
    { name: "maxSecondaryPurchasePrice", type: "uint256" },
  ],
};
const mintControlsTuple = {
  name: "controls",
  type: "tuple",
  components: [
    { name: "ownerApprovedMints", type: "bool" },
    { name: "autonomousFreeMints", type: "bool" },
    { name: "autonomousPaidMints", type: "bool" },
  ],
};
const policyModuleAbi = [
  {
    type: "function",
    name: "setFeatureFlags",
    stateMutability: "nonpayable",
    inputs: [featureTuple],
    outputs: [],
  },
  {
    type: "function",
    name: "setGloballyPaused",
    stateMutability: "nonpayable",
    inputs: [{ name: "paused", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "configurePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }, policyTuple],
    outputs: [],
  },
  {
    type: "function",
    name: "setAccountPaused",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "paused", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAdapterPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "adapter", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setVenuePermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "venue", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setCollectionPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "collection", type: "address" },
      { name: "allowed", type: "bool" },
      { name: "denied", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setCurrencyPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "currency", type: "address" },
      currencyPolicyTuple,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setVenueCurrencyMaximum",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "venue", type: "address" },
      { name: "currency", type: "address" },
      { name: "maximum", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setSelectorPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "allowed", type: "bool" },
      { name: "denied", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setMintControls",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      mintControlsTuple,
    ],
    outputs: [],
  },
];

export class OwnerDirectCanaryBundleError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "OwnerDirectCanaryBundleError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerDirectCanaryBundleError(code, message);
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} has an unsafe number`);
    return;
  }
  if (typeof value !== "object") {
    fail("INVALID_SCHEMA", `${label} contains a non-JSON value`);
  }
  if (seen.has(value)) fail("INVALID_SCHEMA", `${label} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail("INVALID_SCHEMA", `${label} has a nonstandard array prototype`);
    }
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) {
        fail("UNKNOWN_FIELD", `${label} has an unsupported array property`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        fail("INVALID_SCHEMA", `${label}[${String(key)}] is not plain data`);
      }
    }
    if (keys.length !== value.length + 1) {
      fail("INVALID_SCHEMA", `${label} must be a dense JSON array`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
      assertJsonData(value[index], `${label}[${index}]`, seen);
    }
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_SCHEMA", `${label} must not use a custom prototype`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label}.${key} is not an enumerable data field`);
    }
    assertJsonData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function strictJsonSnapshot(value, label) {
  assertJsonData(value, label);
  let cloned;
  try {
    cloned = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy or uncloneable value`);
  }
  assertJsonData(cloned, `${label} snapshot`);
  const serialized = canonicalJson(cloned);
  if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES * 2) {
    fail("INVALID_SCHEMA", `${label} exceeds the combined input size limit`);
  }
  return JSON.parse(serialized);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} has an unexpected key set`);
  }
}

function exactArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    fail("INVALID_SCHEMA", `${label} must contain exactly ${length} values`);
  }
  return value;
}

function address(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact 20-byte address`);
  }
  const normalized = getAddress(value);
  if (!allowZero && normalized.toLowerCase() === ZERO_ADDRESS) {
    fail("ZERO_ADDRESS", `${label} must not be zero`);
  }
  return normalized;
}

function sameAddress(value, expected, label) {
  const normalized = address(value, label);
  if (normalized.toLowerCase() !== expected.toLowerCase()) {
    fail("ADDRESS_MISMATCH", `${label} does not match ${expected}`);
  }
  return normalized;
}

function hash(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be an exact 32-byte hash`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_SALT) {
    fail("ZERO_HASH", `${label} must not be zero`);
  }
  return normalized;
}

function gitCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_GIT_COMMIT", `${label} must be exactly 40 hexadecimal characters`);
  }
  return value.toLowerCase();
}

function uint(value, label, { positive = false, maximum = (1n << 256n) - 1n } = {}) {
  let parsed;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) parsed = BigInt(value);
  else if (Number.isSafeInteger(value) && value >= 0) parsed = BigInt(value);
  else fail("INVALID_INTEGER", `${label} must be an unsigned integer`);
  if (parsed > maximum || (positive && parsed === 0n)) {
    fail("INVALID_INTEGER", `${label} is outside the permitted range`);
  }
  return parsed;
}

function positiveSafeInteger(value, label) {
  const parsed = uint(value, label, { positive: true, maximum: BigInt(Number.MAX_SAFE_INTEGER) });
  if (typeof value !== "number") {
    fail("INVALID_INTEGER", `${label} must be a JSON safe integer`);
  }
  return Number(parsed);
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("INVALID_STRING", `${label} must be a nonempty string`);
  }
  return value;
}

function strictIso(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail("INVALID_TIMESTAMP", `${label} must be a strict ISO-8601 UTC timestamp`);
  }
  return value;
}

function same(actual, expected, code, label) {
  const displayed = typeof expected === "bigint" ? expected.toString() : JSON.stringify(expected);
  if (actual !== expected) fail(code, `${label} must be ${displayed}`);
}

function assertDistinct(entries, label) {
  const seen = new Map();
  for (const [name, value] of entries) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      fail("DUPLICATE_ADDRESS", `${label}: ${name} duplicates ${seen.get(normalized)}`);
    }
    seen.set(normalized, name);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validateChain(chain, label) {
  exactKeys(chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], label);
  same(chain.name, "Robinhood Chain", "WRONG_CHAIN", `${label}.name`);
  same(chain.chainId, ROBINHOOD_CHAIN_ID, "WRONG_CHAIN", `${label}.chainId`);
  same(chain.rpcEnvironmentVariable, "ROBINHOOD_RPC_URL", "WRONG_CHAIN",
    `${label}.rpcEnvironmentVariable`);
  same(chain.explorer, "https://robinhoodchain.blockscout.com", "WRONG_CHAIN",
    `${label}.explorer`);
  same(chain.nativeCurrency, "ETH", "WRONG_CHAIN", `${label}.nativeCurrency`);
}

function validateCoreContractRecord(record, name, manifestCommit) {
  const label = `core.contracts.${name}`;
  exactKeys(record, [
    "address", "deploymentTransaction", "deploymentBlock", "deployer",
    "implementationVersion", "constructorArguments", "creationBytecodeHash",
    "runtimeBytecodeHash", "gitCommit", "verificationStatus",
  ], label);
  const result = {
    address: address(record.address, `${label}.address`),
    deployer: address(record.deployer, `${label}.deployer`),
    deploymentBlock: positiveSafeInteger(record.deploymentBlock, `${label}.deploymentBlock`),
    runtimeBytecodeHash: hash(record.runtimeBytecodeHash, `${label}.runtimeBytecodeHash`),
  };
  hash(record.deploymentTransaction, `${label}.deploymentTransaction`);
  same(record.implementationVersion, "1", "INCOMPLETE_MANIFEST",
    `${label}.implementationVersion`);
  if (!Array.isArray(record.constructorArguments)) {
    fail("INVALID_SCHEMA", `${label}.constructorArguments must be an array`);
  }
  hash(record.creationBytecodeHash, `${label}.creationBytecodeHash`);
  same(gitCommit(record.gitCommit, `${label}.gitCommit`), manifestCommit,
    "COMMIT_MISMATCH", `${label}.gitCommit`);
  same(record.verificationStatus, "VERIFIED", "UNVERIFIED_CONTRACT",
    `${label}.verificationStatus`);
  return result;
}

function validateCoreManifest(manifest) {
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "verifiedExternalInfrastructure",
    "accountSalt", "gitCommit", "compiler", "evmVersion", "optimizerRuns", "contracts",
    "sourceVerificationAdoption", "featureFlags", "protocolGuardian", "notes",
  ], "core");
  same(manifest.status, "DEPLOYED", "NOT_DEPLOYED", "core.status");
  validateChain(manifest.chain, "core.chain");
  sameAddress(manifest.canonicalCollection, CANONICAL_COLLECTION,
    "core.canonicalCollection");
  sameAddress(manifest.canonicalERC6551Registry, CANONICAL_ERC6551_REGISTRY,
    "core.canonicalERC6551Registry");
  same(hash(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "core.canonicalERC6551RegistryRuntimeCodeHash"),
  CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH, "REGISTRY_PIN_MISMATCH",
  "core canonical registry runtime hash");
  same(hash(manifest.accountSalt, "core.accountSalt", { allowZero: true }), ZERO_SALT,
    "NONZERO_SALT", "core.accountSalt");
  const manifestCommit = gitCommit(manifest.gitCommit, "core.gitCommit");
  same(manifest.compiler, "0.8.34", "COMPILER_MISMATCH", "core.compiler");
  same(manifest.evmVersion, "cancun", "COMPILER_MISMATCH", "core.evmVersion");
  same(manifest.optimizerRuns, 500, "COMPILER_MISMATCH", "core.optimizerRuns");
  nonemptyString(manifest.notes, "core.notes");

  exactKeys(manifest.verifiedExternalInfrastructure, ["seaport"],
    "core.verifiedExternalInfrastructure");
  const seaport = manifest.verifiedExternalInfrastructure.seaport;
  exactKeys(seaport, [
    "address", "name", "compiler", "deploymentTransaction", "deploymentBlock",
    "runtimeCodeHash", "verificationStatus", "executionApproved",
  ], "core.verifiedExternalInfrastructure.seaport");
  address(seaport.address, "core.verifiedExternalInfrastructure.seaport.address");
  nonemptyString(seaport.name, "core.verifiedExternalInfrastructure.seaport.name");
  nonemptyString(seaport.compiler, "core.verifiedExternalInfrastructure.seaport.compiler");
  hash(seaport.deploymentTransaction,
    "core.verifiedExternalInfrastructure.seaport.deploymentTransaction");
  positiveSafeInteger(seaport.deploymentBlock,
    "core.verifiedExternalInfrastructure.seaport.deploymentBlock");
  hash(seaport.runtimeCodeHash, "core.verifiedExternalInfrastructure.seaport.runtimeCodeHash");
  same(seaport.verificationStatus, "VERIFIED_READ_ONLY_SCOUT", "INVALID_INFRASTRUCTURE",
    "core.verifiedExternalInfrastructure.seaport.verificationStatus");
  same(seaport.executionApproved, false, "INVALID_INFRASTRUCTURE",
    "core.verifiedExternalInfrastructure.seaport.executionApproved");

  exactKeys(manifest.featureFlags, Object.keys(SAFE_INITIAL_FEATURE_FLAGS), "core.featureFlags");
  for (const [name, expected] of Object.entries(SAFE_INITIAL_FEATURE_FLAGS)) {
    same(manifest.featureFlags[name], expected, "UNSAFE_INITIAL_STATE", `core.featureFlags.${name}`);
  }

  exactKeys(manifest.contracts, CORE_CONTRACT_NAMES, "core.contracts");
  const contracts = Object.fromEntries(CORE_CONTRACT_NAMES.map((name) => [
    name,
    validateCoreContractRecord(manifest.contracts[name], name, manifestCommit),
  ]));
  let sourceVerificationAdoption;
  try {
    sourceVerificationAdoption = requireVerifiedManifestAdoption(manifest, CORE_CONTRACT_NAMES);
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "core source verification adoption is invalid");
  }
  const guardian = address(manifest.protocolGuardian, "core.protocolGuardian");
  assertDistinct(CORE_CONTRACT_NAMES.map((name) => [name, contracts[name].address]),
    "core protocol contracts must be distinct");
  for (const name of CORE_CONTRACT_NAMES) {
    if (contracts[name].deployer.toLowerCase() === guardian.toLowerCase()) {
      fail("ROLE_COLLISION", `${name} deployer must differ from protocol guardian`);
    }
  }

  const constructorArguments = Object.fromEntries(CORE_CONTRACT_NAMES.map((name) => [
    name,
    manifest.contracts[name].constructorArguments,
  ]));
  const oneGuardian = ["ArtAdapterRegistry", "ArtAgentRegistry"];
  for (const name of oneGuardian) {
    const args = exactArray(constructorArguments[name], 1,
      `core.contracts.${name}.constructorArguments`);
    sameAddress(args[0], guardian, `core.contracts.${name}.constructorArguments[0]`);
  }
  {
    const args = exactArray(constructorArguments.BrokerPolicyModule, 2,
      "core.contracts.BrokerPolicyModule.constructorArguments");
    sameAddress(args[0], guardian, "BrokerPolicyModule guardian constructor argument");
    sameAddress(args[1], contracts.ArtAdapterRegistry.address,
      "BrokerPolicyModule adapter registry constructor argument");
  }
  {
    const args = exactArray(constructorArguments.GoghPunkAccountV1, 3,
      "core.contracts.GoghPunkAccountV1.constructorArguments");
    sameAddress(args[0], contracts.BrokerPolicyModule.address,
      "GoghPunkAccountV1 policy module constructor argument");
    sameAddress(args[1], contracts.ArtAgentRegistry.address,
      "GoghPunkAccountV1 agent registry constructor argument");
    sameAddress(args[2], contracts.ArtAdapterRegistry.address,
      "GoghPunkAccountV1 adapter registry constructor argument");
  }
  {
    const args = exactArray(constructorArguments.GoghPunkAccountRegistry, 2,
      "core.contracts.GoghPunkAccountRegistry.constructorArguments");
    sameAddress(args[0], contracts.GoghPunkAccountV1.address,
      "GoghPunkAccountRegistry implementation constructor argument");
    same(hash(args[1], "GoghPunkAccountRegistry salt constructor argument", { allowZero: true }),
      ZERO_SALT, "NONZERO_SALT", "GoghPunkAccountRegistry salt constructor argument");
  }
  return {
    manifestCommit,
    manifestHash: canonicalSha256(manifest),
    guardian,
    contracts,
    sourceVerificationAdoption,
    sourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(sourceVerificationAdoption),
  };
}

function validateRpcObservation(observation, label, common) {
  exactKeys(observation, [
    "provider", "origin", "chainId", "headBlockNumber", "confirmedBlockNumber",
    "confirmedBlockHash", "confirmedBlockTimestamp", "observedAt", "evidenceHash",
  ], label);
  nonemptyString(observation.provider, `${label}.provider`);
  let origin;
  try {
    const parsed = new URL(observation.origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== "/") throw new TypeError();
    origin = parsed.origin;
  } catch {
    fail("INVALID_RPC_EVIDENCE", `${label}.origin must be a credential-free HTTPS origin`);
  }
  same(observation.chainId, ROBINHOOD_CHAIN_ID, "WRONG_CHAIN", `${label}.chainId`);
  const head = positiveSafeInteger(observation.headBlockNumber, `${label}.headBlockNumber`);
  const confirmed = positiveSafeInteger(observation.confirmedBlockNumber,
    `${label}.confirmedBlockNumber`);
  if (head < confirmed) fail("INVALID_RPC_EVIDENCE", `${label} head precedes confirmed block`);
  same(confirmed, common.number, "RPC_DISAGREEMENT", `${label}.confirmedBlockNumber`);
  same(hash(observation.confirmedBlockHash, `${label}.confirmedBlockHash`), common.hash,
    "RPC_DISAGREEMENT", `${label}.confirmedBlockHash`);
  same(strictIso(observation.confirmedBlockTimestamp, `${label}.confirmedBlockTimestamp`),
    common.timestamp, "RPC_DISAGREEMENT", `${label}.confirmedBlockTimestamp`);
  const observedAt = strictIso(observation.observedAt, `${label}.observedAt`);
  if (Date.parse(observedAt) < Date.parse(common.timestamp)) {
    fail("INVALID_RPC_EVIDENCE", `${label}.observedAt precedes the confirmed block timestamp`);
  }
  hash(observation.evidenceHash, `${label}.evidenceHash`);
  return { origin, head, confirmed, observedAt };
}

function validateOwnerObservation(observation, label, expectedOwner) {
  exactKeys(observation, [
    "expectedOwner", "observedOwner", "blockNumber", "blockHash", "blockTimestamp",
  ], label);
  sameAddress(observation.expectedOwner, expectedOwner, `${label}.expectedOwner`);
  sameAddress(observation.observedOwner, expectedOwner, `${label}.observedOwner`);
  return {
    blockNumber: positiveSafeInteger(observation.blockNumber, `${label}.blockNumber`),
    blockHash: hash(observation.blockHash, `${label}.blockHash`),
    blockTimestamp: strictIso(observation.blockTimestamp, `${label}.blockTimestamp`),
  };
}

function validateCanaryContractRecord(record, name, manifestCommit) {
  const label = `canary.contracts.${name}`;
  exactKeys(record, [
    "address", "deploymentTransaction", "deploymentBlock", "deploymentBlockHash",
    "receiptStatus", "confirmationsRequired", "confirmationsObserved", "deployer",
    "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    "verificationStatus",
  ], label);
  const result = {
    address: address(record.address, `${label}.address`),
    deployer: address(record.deployer, `${label}.deployer`),
    deploymentTransaction: hash(record.deploymentTransaction, `${label}.deploymentTransaction`),
    deploymentBlock: positiveSafeInteger(record.deploymentBlock, `${label}.deploymentBlock`),
    deploymentBlockHash: hash(record.deploymentBlockHash, `${label}.deploymentBlockHash`),
    runtimeBytecodeHash: hash(record.runtimeBytecodeHash, `${label}.runtimeBytecodeHash`),
  };
  same(record.receiptStatus, "SUCCESS", "FAILED_DEPLOYMENT", `${label}.receiptStatus`);
  const required = positiveSafeInteger(record.confirmationsRequired,
    `${label}.confirmationsRequired`);
  const observed = positiveSafeInteger(record.confirmationsObserved,
    `${label}.confirmationsObserved`);
  if (required < 20 || observed < required) {
    fail("INSUFFICIENT_CONFIRMATIONS", `${label} must have at least 20 confirmed blocks`);
  }
  if (!Array.isArray(record.constructorArguments)) {
    fail("INVALID_SCHEMA", `${label}.constructorArguments must be an array`);
  }
  hash(record.creationBytecodeHash, `${label}.creationBytecodeHash`);
  same(gitCommit(record.gitCommit, `${label}.gitCommit`), manifestCommit,
    "COMMIT_MISMATCH", `${label}.gitCommit`);
  same(record.verificationStatus, "VERIFIED", "UNVERIFIED_CONTRACT",
    `${label}.verificationStatus`);
  return result;
}

function validateCanaryManifest(manifest, core) {
  exactKeys(manifest, [
    "status", "chain", "coreDeploymentManifest", "coreDeploymentManifestStatusRequired",
    "coreDeploymentManifestGitCommit", "coreDeploymentManifestSha256",
    "coreGoghPunkAccountRegistry", "coreGoghPunkAccountRegistryRuntimeCodeHash",
    "coreGoghPunkAccountImplementation", "coreGoghPunkAccountImplementationRuntimeCodeHash",
    "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "controllingPunkTokenId",
    "expectedActivatedPunkAccount", "expectedActivatedPunkAccountRuntimeCodeHash",
    "expectedOwnerAtPreparation", "canaryArtTokenId", "gitCommit", "compiler",
    "evmVersion", "optimizerRuns", "contracts", "sourceVerificationAdoption",
    "provenanceGate", "ownerObservations",
    "configuration", "notes",
  ], "canary");
  same(manifest.status, "DEPLOYED", "NOT_DEPLOYED", "canary.status");
  validateChain(manifest.chain, "canary.chain");
  same(manifest.coreDeploymentManifest, "deployments/robinhood.json", "CORE_BINDING_MISMATCH",
    "canary.coreDeploymentManifest");
  same(manifest.coreDeploymentManifestStatusRequired, "DEPLOYED", "CORE_BINDING_MISMATCH",
    "canary.coreDeploymentManifestStatusRequired");
  same(gitCommit(manifest.coreDeploymentManifestGitCommit,
    "canary.coreDeploymentManifestGitCommit"), core.manifestCommit,
  "CORE_BINDING_MISMATCH", "canary.coreDeploymentManifestGitCommit");
  same(hash(manifest.coreDeploymentManifestSha256,
    "canary.coreDeploymentManifestSha256"), core.manifestHash,
  "CORE_BINDING_MISMATCH", "canary.coreDeploymentManifestSha256");
  sameAddress(manifest.coreGoghPunkAccountRegistry,
    core.contracts.GoghPunkAccountRegistry.address, "canary.coreGoghPunkAccountRegistry");
  same(hash(manifest.coreGoghPunkAccountRegistryRuntimeCodeHash,
    "canary.coreGoghPunkAccountRegistryRuntimeCodeHash"),
  core.contracts.GoghPunkAccountRegistry.runtimeBytecodeHash, "CORE_BINDING_MISMATCH",
  "canary.coreGoghPunkAccountRegistryRuntimeCodeHash");
  sameAddress(manifest.coreGoghPunkAccountImplementation,
    core.contracts.GoghPunkAccountV1.address, "canary.coreGoghPunkAccountImplementation");
  same(hash(manifest.coreGoghPunkAccountImplementationRuntimeCodeHash,
    "canary.coreGoghPunkAccountImplementationRuntimeCodeHash"),
  core.contracts.GoghPunkAccountV1.runtimeBytecodeHash, "CORE_BINDING_MISMATCH",
  "canary.coreGoghPunkAccountImplementationRuntimeCodeHash");
  sameAddress(manifest.canonicalCollection, CANONICAL_COLLECTION,
    "canary.canonicalCollection");
  sameAddress(manifest.canonicalERC6551Registry, CANONICAL_ERC6551_REGISTRY,
    "canary.canonicalERC6551Registry");
  same(hash(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "canary.canonicalERC6551RegistryRuntimeCodeHash"),
  CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH, "REGISTRY_PIN_MISMATCH",
  "canary canonical registry runtime hash");
  const punkTokenId = uint(manifest.controllingPunkTokenId,
    "canary.controllingPunkTokenId", { positive: true });
  const account = address(manifest.expectedActivatedPunkAccount,
    "canary.expectedActivatedPunkAccount");
  const accountRuntimeBytecodeHash = hash(manifest.expectedActivatedPunkAccountRuntimeCodeHash,
    "canary.expectedActivatedPunkAccountRuntimeCodeHash");
  const owner = address(manifest.expectedOwnerAtPreparation,
    "canary.expectedOwnerAtPreparation");
  const artTokenId = uint(manifest.canaryArtTokenId, "canary.canaryArtTokenId");
  const manifestCommit = gitCommit(manifest.gitCommit, "canary.gitCommit");
  same(manifestCommit, core.manifestCommit, "COMMIT_MISMATCH",
    "canary.gitCommit must match the core release commit");
  same(manifest.compiler, "0.8.34", "COMPILER_MISMATCH", "canary.compiler");
  same(manifest.evmVersion, "cancun", "COMPILER_MISMATCH", "canary.evmVersion");
  same(manifest.optimizerRuns, 500, "COMPILER_MISMATCH", "canary.optimizerRuns");
  nonemptyString(manifest.notes, "canary.notes");

  exactKeys(manifest.contracts, CANARY_CONTRACT_NAMES, "canary.contracts");
  const contracts = Object.fromEntries(CANARY_CONTRACT_NAMES.map((name) => [
    name,
    validateCanaryContractRecord(manifest.contracts[name], name, manifestCommit),
  ]));
  let sourceVerificationAdoption;
  try {
    sourceVerificationAdoption = requireVerifiedManifestAdoption(manifest, CANARY_CONTRACT_NAMES);
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "canary source verification adoption is invalid");
  }
  assertDistinct(CANARY_CONTRACT_NAMES.map((name) => [name, contracts[name].address]),
    "canary contracts must be distinct");
  if (contracts.GoghOneShotCanaryArt.deploymentTransaction
    === contracts.GoghOneShotCanaryMintAdapter.deploymentTransaction) {
    fail("DUPLICATE_TRANSACTION", "canary art and adapter deployment transactions must differ");
  }
  if (contracts.GoghOneShotCanaryArt.deploymentBlock
    > contracts.GoghOneShotCanaryMintAdapter.deploymentBlock) {
    fail("DEPLOYMENT_ORDER_MISMATCH", "canary adapter cannot precede its art constructor target");
  }
  same(contracts.GoghOneShotCanaryArt.deployer,
    contracts.GoghOneShotCanaryMintAdapter.deployer, "DEPLOYER_MISMATCH",
    "both sequential canary deployments must use the recorded canary deployer");
  {
    const args = exactArray(manifest.contracts.GoghOneShotCanaryArt.constructorArguments, 4,
      "canary.contracts.GoghOneShotCanaryArt.constructorArguments");
    sameAddress(args[0], core.contracts.GoghPunkAccountRegistry.address,
      "canary art account registry constructor argument");
    sameAddress(args[1], account, "canary art account constructor argument");
    same(uint(args[2], "canary art Punk token constructor argument"), punkTokenId,
      "TOKEN_BINDING_MISMATCH", "canary art Punk token constructor argument");
    same(uint(args[3], "canary art token constructor argument"), artTokenId,
      "TOKEN_BINDING_MISMATCH", "canary art token constructor argument");
  }
  {
    const args = exactArray(manifest.contracts.GoghOneShotCanaryMintAdapter.constructorArguments, 1,
      "canary.contracts.GoghOneShotCanaryMintAdapter.constructorArguments");
    sameAddress(args[0], contracts.GoghOneShotCanaryArt.address,
      "canary adapter art constructor argument");
  }

  const gate = manifest.provenanceGate;
  exactKeys(gate, [
    "status", "dualRpcAgreementRequired", "primaryRpcObservation", "secondaryRpcObservation",
    "commonConfirmedBlockNumber", "commonConfirmedBlockHash",
    "commonConfirmedBlockTimestamp", "confirmationsRequired", "confirmationsObserved",
    "coreManifestHashVerified", "coreRegistryRuntimeHashVerified",
    "accountImplementationRuntimeHashVerified", "activatedAccountRuntimeHashVerified",
    "canonicalERC6551RegistryRuntimeHashVerified", "accountFooterVerified",
    "expectedOwnerVerified", "constructorInputsVerified", "cleanPreconfigurationState",
    "verifiedAt",
  ], "canary.provenanceGate");
  same(gate.status, "VERIFIED", "UNVERIFIED_PROVENANCE", "canary.provenanceGate.status");
  same(gate.dualRpcAgreementRequired, true, "UNVERIFIED_PROVENANCE",
    "canary.provenanceGate.dualRpcAgreementRequired");
  const common = {
    number: positiveSafeInteger(gate.commonConfirmedBlockNumber,
      "canary.provenanceGate.commonConfirmedBlockNumber"),
    hash: hash(gate.commonConfirmedBlockHash,
      "canary.provenanceGate.commonConfirmedBlockHash"),
    timestamp: strictIso(gate.commonConfirmedBlockTimestamp,
      "canary.provenanceGate.commonConfirmedBlockTimestamp"),
  };
  const primaryObservation = validateRpcObservation(gate.primaryRpcObservation,
    "canary.provenanceGate.primaryRpcObservation", common);
  const secondaryObservation = validateRpcObservation(gate.secondaryRpcObservation,
    "canary.provenanceGate.secondaryRpcObservation", common);
  if (primaryObservation.origin === secondaryObservation.origin) {
    fail("RPC_NOT_INDEPENDENT", "canary provenance RPC origins must be distinct");
  }
  const confirmationsRequired = positiveSafeInteger(gate.confirmationsRequired,
    "canary.provenanceGate.confirmationsRequired");
  const confirmationsObserved = positiveSafeInteger(gate.confirmationsObserved,
    "canary.provenanceGate.confirmationsObserved");
  if (confirmationsRequired < 20 || confirmationsObserved < confirmationsRequired) {
    fail("INSUFFICIENT_CONFIRMATIONS", "canary provenance must have at least 20 confirmations");
  }
  if (common.number < contracts.GoghOneShotCanaryMintAdapter.deploymentBlock) {
    fail("INVALID_RPC_EVIDENCE", "common confirmed block precedes a canary deployment");
  }
  for (const observation of [primaryObservation, secondaryObservation]) {
    if (observation.head - observation.confirmed < confirmationsRequired) {
      fail("INSUFFICIENT_CONFIRMATIONS",
        "each provenance RPC head must exceed the common block by the required depth");
    }
  }
  for (const name of [
    "coreManifestHashVerified", "coreRegistryRuntimeHashVerified",
    "accountImplementationRuntimeHashVerified", "activatedAccountRuntimeHashVerified",
    "canonicalERC6551RegistryRuntimeHashVerified", "accountFooterVerified",
    "expectedOwnerVerified", "constructorInputsVerified",
  ]) same(gate[name], true, "UNVERIFIED_PROVENANCE", `canary.provenanceGate.${name}`);
  let cleanPreconfigurationState;
  try {
    cleanPreconfigurationState = validateCleanPreconfigurationState(
      gate.cleanPreconfigurationState,
      {
        commonBlockNumber: common.number,
        commonBlockHash: common.hash,
        commonBlockTimestamp: common.timestamp,
        policyDeploymentBlock: core.contracts.BrokerPolicyModule.deploymentBlock,
        agentRegistryDeploymentBlock: core.contracts.ArtAgentRegistry.deploymentBlock,
      },
    );
  } catch (error) {
    fail(error?.code ?? "NONCLEAN_PRECONFIGURATION",
      error?.message ?? "clean preconfiguration state is invalid");
  }
  const verifiedAt = strictIso(gate.verifiedAt, "canary.provenanceGate.verifiedAt");
  if (Date.parse(verifiedAt) < Math.max(
    Date.parse(primaryObservation.observedAt), Date.parse(secondaryObservation.observedAt),
  )) fail("INVALID_RPC_EVIDENCE", "provenance verifiedAt precedes an RPC observation");

  exactKeys(manifest.ownerObservations, [
    "preparation", "afterCanaryArtReceipt", "afterCanaryAdapterReceipt",
  ], "canary.ownerObservations");
  const preparationObservation = validateOwnerObservation(manifest.ownerObservations.preparation,
    "canary.ownerObservations.preparation", owner);
  const afterArtObservation = validateOwnerObservation(
    manifest.ownerObservations.afterCanaryArtReceipt,
    "canary.ownerObservations.afterCanaryArtReceipt", owner);
  const afterAdapterObservation = validateOwnerObservation(
    manifest.ownerObservations.afterCanaryAdapterReceipt,
    "canary.ownerObservations.afterCanaryAdapterReceipt", owner);
  if (preparationObservation.blockNumber > contracts.GoghOneShotCanaryArt.deploymentBlock
    || Date.parse(preparationObservation.blockTimestamp)
      > Date.parse(afterArtObservation.blockTimestamp)) {
    fail("OWNER_OBSERVATION_ORDER_MISMATCH",
      "preparation owner observation must not follow the canary art receipt observation");
  }
  same(afterArtObservation.blockNumber, contracts.GoghOneShotCanaryArt.deploymentBlock,
    "OWNER_OBSERVATION_MISMATCH", "owner observation after canary art receipt block");
  same(afterArtObservation.blockHash, contracts.GoghOneShotCanaryArt.deploymentBlockHash,
    "OWNER_OBSERVATION_MISMATCH", "owner observation after canary art receipt hash");
  same(afterAdapterObservation.blockNumber,
    contracts.GoghOneShotCanaryMintAdapter.deploymentBlock,
    "OWNER_OBSERVATION_MISMATCH", "owner observation after canary adapter receipt block");
  same(afterAdapterObservation.blockHash,
    contracts.GoghOneShotCanaryMintAdapter.deploymentBlockHash,
    "OWNER_OBSERVATION_MISMATCH", "owner observation after canary adapter receipt hash");
  if (Date.parse(afterArtObservation.blockTimestamp)
    > Date.parse(afterAdapterObservation.blockTimestamp)) {
    fail("OWNER_OBSERVATION_ORDER_MISMATCH",
      "canary adapter owner observation must not precede the art observation");
  }

  exactKeys(manifest.configuration, [
    "deploymentAuthorized", "broadcastAttempted", "adapterRegistered", "policyConfigured",
    "ownerApprovedMintsEnabled", "agentAuthorized", "approvalPurchasesEnabled",
    "autonomousPurchasesEnabled", "autonomousMintsEnabled", "mintExecuted",
  ], "canary.configuration");
  const expectedConfiguration = {
    deploymentAuthorized: true,
    broadcastAttempted: true,
    adapterRegistered: false,
    policyConfigured: false,
    ownerApprovedMintsEnabled: false,
    agentAuthorized: false,
    approvalPurchasesEnabled: false,
    autonomousPurchasesEnabled: false,
    autonomousMintsEnabled: false,
    mintExecuted: false,
  };
  for (const [name, expected] of Object.entries(expectedConfiguration)) {
    same(manifest.configuration[name], expected, "AMBIGUOUS_CANARY_STATE",
      `canary.configuration.${name}`);
  }

  return {
    manifestCommit,
    manifestHash: canonicalSha256(manifest),
    punkTokenId,
    account,
    accountRuntimeBytecodeHash,
    owner,
    artTokenId,
    contracts,
    cleanPreconfigurationState,
    sourceVerificationAdoption,
    sourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(sourceVerificationAdoption),
  };
}

function featureFlagsForAbi(flags) {
  return {
    scoutMode: flags.ENABLE_SCOUT_MODE,
    approvalPurchases: flags.ENABLE_APPROVAL_PURCHASES,
    autonomousPurchases: flags.ENABLE_AUTONOMOUS_PURCHASES,
    autonomousMints: flags.ENABLE_AUTONOMOUS_MINTS,
    unknownCollectionExecution: flags.ENABLE_UNKNOWN_COLLECTION_EXECUTION,
    selling: flags.ENABLE_SELLING,
    autonomousSelling: flags.ENABLE_AUTONOMOUS_SELLING,
  };
}

function call({ id, order, phase, role, from, to, abi, functionName, args, purpose }) {
  return {
    id,
    order,
    phase,
    role,
    from,
    to,
    valueWei: "0",
    functionName,
    arguments: args,
    calldata: encodeFunctionData({ abi, functionName, args }),
    purpose,
    transactionAuthorized: false,
  };
}

function zeroPolicy(mode) {
  return {
    mode,
    maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n,
    maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n,
    minimumNativeReserve: 0n,
    maxAcquisitionsPerDay: 1,
    maxIntentAge: MAX_INTENT_AGE_SECONDS,
    maxSlippageBps: 0,
    requireCollectionAllowlist: true,
    allowUnknownCollections: false,
  };
}

function zeroCurrencyPolicy(allowed) {
  return {
    allowed,
    maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n,
    maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n,
  };
}

function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  }
  return value;
}

export function buildOwnerDirectCanaryConfigBundle(coreManifest, canaryManifest) {
  const snapshot = strictJsonSnapshot({ core: coreManifest, canary: canaryManifest }, "inputs");
  const core = validateCoreManifest(plainObject(snapshot.core, "core"));
  const canary = validateCanaryManifest(plainObject(snapshot.canary, "canary"), core);
  assertDistinct([
    ...CORE_CONTRACT_NAMES.map((name) => [name, core.contracts[name].address]),
    ...CANARY_CONTRACT_NAMES.map((name) => [name, canary.contracts[name].address]),
    ["Punk Account", canary.account],
    ["protocol guardian", core.guardian],
    ["current expected owner", canary.owner],
    ["canonical Gogh Punks collection", CANONICAL_COLLECTION],
    ["canonical ERC-6551 registry", CANONICAL_ERC6551_REGISTRY],
  ], "security-sensitive addresses must be distinct");
  for (const name of CORE_CONTRACT_NAMES) {
    if (core.contracts[name].deployer.toLowerCase() === canary.owner.toLowerCase()) {
      fail("ROLE_COLLISION", `${name} deployer must differ from the current canary Punk owner`);
    }
  }
  const canaryDeployer = canary.contracts.GoghOneShotCanaryArt.deployer.toLowerCase();
  for (const [name, roleAddress] of [
    ["protocol guardian", core.guardian],
    ["current canary Punk owner", canary.owner],
    ["Punk Account", canary.account],
  ]) {
    if (canaryDeployer === roleAddress.toLowerCase()) {
      fail("ROLE_COLLISION", `canary deployer must differ from ${name}`);
    }
  }

  const adapter = canary.contracts.GoghOneShotCanaryMintAdapter;
  const art = canary.contracts.GoghOneShotCanaryArt;
  const adapterCommitment = deriveOneShotAdapterRegistrationCommitment({
    coreGitCommit: core.manifestCommit,
    corePreconfigurationManifestSha256: core.manifestHash,
    canaryGitCommit: canary.manifestCommit,
    canaryPreconfigurationManifestSha256: canary.manifestHash,
    adapter: adapter.address,
    adapterRuntimeBytecodeHash: adapter.runtimeBytecodeHash,
    venue: art.address,
    venueRuntimeBytecodeHash: art.runtimeBytecodeHash,
    collection: art.address,
    controllingPunkTokenId: canary.punkTokenId.toString(),
    punkAccount: canary.account,
    canaryArtTokenId: canary.artTokenId.toString(),
  });
  const {
    versionHash: adapterVersionHash,
    metadata: adapterMetadata,
    metadataCanonicalJson: adapterMetadataCanonicalJson,
    metadataHash: adapterMetadataHash,
  } = adapterCommitment;
  const disabledPolicy = zeroPolicy(0);
  const approvalPolicy = zeroPolicy(2);
  const enabledCurrency = zeroCurrencyPolicy(true);
  const disabledCurrency = zeroCurrencyPolicy(false);
  const enabledMintControls = {
    ownerApprovedMints: true,
    autonomousFreeMints: false,
    autonomousPaidMints: false,
  };
  const disabledMintControls = {
    ownerApprovedMints: false,
    autonomousFreeMints: false,
    autonomousPaidMints: false,
  };
  const approvalFlags = featureFlagsForAbi(APPROVAL_ONLY_FEATURE_FLAGS);
  const teardownFlags = featureFlagsForAbi(SAFE_INITIAL_FEATURE_FLAGS);
  const adapterRegistry = core.contracts.ArtAdapterRegistry.address;
  const policyModule = core.contracts.BrokerPolicyModule.address;

  const configurationCalls = [
    call({
      id: "CONFIG_OWNER_01_PAUSE_ACCOUNT_BEFORE_STAGING", order: 1,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setAccountPaused", args: [canary.account, true],
      purpose: "Pause the exact Punk Account before staging any policy or permission.",
    }),
    call({
      id: "CONFIG_OWNER_02_CONFIGURE_DISABLED_ZERO_SPEND_POLICY", order: 2,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "configurePolicy",
      args: [canary.account, disabledPolicy],
      purpose: "Bind the current owner and stage the zero-spend policy in DISABLED mode while approvalPurchases remains false.",
    }),
    call({
      id: "CONFIG_GUARDIAN_01_REGISTER_EXACT_MINT_ADAPTER", order: 3,
      phase: "CONFIGURATION", role: "GUARDIAN", from: core.guardian, to: adapterRegistry,
      abi: adapterRegistryAbi, functionName: "registerAdapter",
      args: [adapter.address, 1, art.address, adapterVersionHash, adapterMetadataHash],
      purpose: "Register only the pinned one-shot MINT adapter and its exact one-shot art venue while account execution remains disabled.",
    }),
    call({
      id: "CONFIG_OWNER_03_ALLOW_EXACT_ADAPTER", order: 4,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setAdapterPermission",
      args: [canary.account, adapter.address, true],
      purpose: "Allow only the exact canary adapter for this Punk Account.",
    }),
    call({
      id: "CONFIG_OWNER_04_ALLOW_EXACT_MINT_VENUE", order: 5,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setVenuePermission",
      args: [canary.account, art.address, 1, true],
      purpose: "Allow the one-shot art contract as a MINT venue only.",
    }),
    call({
      id: "CONFIG_OWNER_05_ALLOW_EXACT_COLLECTION", order: 6,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setCollectionPermission",
      args: [canary.account, art.address, true, false],
      purpose: "Allow only the one-shot art collection for this canary path.",
    }),
    call({
      id: "CONFIG_OWNER_06_ALLOW_ZERO_NATIVE_CURRENCY", order: 7,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setCurrencyPolicy",
      args: [canary.account, ZERO_ADDRESS, enabledCurrency],
      purpose: "Allow native currency only with every spend and price maximum fixed at zero.",
    }),
    call({
      id: "CONFIG_OWNER_07_SET_ZERO_VENUE_MAXIMUM", order: 8,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setVenueCurrencyMaximum",
      args: [canary.account, art.address, ZERO_ADDRESS, 0n],
      purpose: "Pin the venue-specific native-currency maximum to zero.",
    }),
    call({
      id: "CONFIG_OWNER_08_ALLOW_EXACT_MINT_SELECTOR", order: 9,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setSelectorPermission",
      args: [canary.account, CANARY_MINT_SELECTOR, true, false],
      purpose: "Allow only mint(address,uint256) for the controlled canary.",
    }),
    call({
      id: "CONFIG_OWNER_09_ENABLE_OWNER_APPROVED_MINTS_ONLY", order: 10,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setMintControls",
      args: [canary.account, enabledMintControls],
      purpose: "Enable owner-approved mints while both autonomous mint controls remain false.",
    }),
    call({
      id: "CONFIG_GUARDIAN_02_ENABLE_APPROVAL_PURCHASES_ONLY", order: 11,
      phase: "CONFIGURATION", role: "GUARDIAN", from: core.guardian, to: policyModule,
      abi: policyModuleAbi, functionName: "setFeatureFlags", args: [approvalFlags],
      purpose: "Enable owner-approved acquisitions only after the account is paused and every narrow permission is staged; autonomy, unknown execution, and selling remain off.",
    }),
    call({
      id: "CONFIG_OWNER_10_SWITCH_TO_APPROVAL_REQUIRED", order: 12,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "configurePolicy",
      args: [canary.account, approvalPolicy],
      purpose: "Switch from DISABLED to APPROVAL_REQUIRED only after the guardian feature gate is enabled; the account remains paused.",
    }),
    call({
      id: "CONFIG_OWNER_11_UNPAUSE_ACCOUNT_LAST", order: 13,
      phase: "CONFIGURATION", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setAccountPaused", args: [canary.account, false],
      purpose: "Unpause only this Punk Account after every narrow permission is configured.",
    }),
  ];

  const teardownCalls = [
    call({
      id: "TEARDOWN_GUARDIAN_01_DISABLE_APPROVAL_PURCHASES", order: 1,
      phase: "TEARDOWN", role: "GUARDIAN", from: core.guardian, to: policyModule,
      abi: policyModuleAbi, functionName: "setFeatureFlags", args: [teardownFlags],
      purpose: "Disable approvalPurchases first; every autonomous, unknown, and selling flag remains false.",
    }),
    call({
      id: "TEARDOWN_OWNER_01_PAUSE_ACCOUNT", order: 2,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setAccountPaused", args: [canary.account, true],
      purpose: "Pause the exact Punk Account.",
    }),
    call({
      id: "TEARDOWN_OWNER_02_CONFIGURE_DISABLED", order: 3,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "configurePolicy",
      args: [canary.account, disabledPolicy],
      purpose: "Return the account policy to DISABLED before revoking the staged permissions.",
    }),
    call({
      id: "TEARDOWN_GUARDIAN_02_DISABLE_ADAPTER", order: 4,
      phase: "TEARDOWN", role: "GUARDIAN", from: core.guardian, to: adapterRegistry,
      abi: adapterRegistryAbi, functionName: "setAdapterActive", args: [adapter.address, false],
      purpose: "Disable the exact registered canary adapter.",
    }),
    call({
      id: "TEARDOWN_OWNER_03_DISABLE_ALL_MINT_CONTROLS", order: 5,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setMintControls",
      args: [canary.account, disabledMintControls],
      purpose: "Disable owner-approved, autonomous-free, and autonomous-paid mint controls.",
    }),
    call({
      id: "TEARDOWN_OWNER_04_DENY_SELECTOR", order: 6,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setSelectorPermission",
      args: [canary.account, CANARY_MINT_SELECTOR, false, true],
      purpose: "Revoke and explicitly deny the canary mint selector.",
    }),
    call({
      id: "TEARDOWN_OWNER_05_REVOKE_ADAPTER", order: 7,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setAdapterPermission",
      args: [canary.account, adapter.address, false],
      purpose: "Revoke the account-level canary adapter permission.",
    }),
    call({
      id: "TEARDOWN_OWNER_06_REVOKE_MINT_VENUE", order: 8,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setVenuePermission",
      args: [canary.account, art.address, 1, false],
      purpose: "Revoke the exact MINT venue permission.",
    }),
    call({
      id: "TEARDOWN_OWNER_07_DENY_COLLECTION", order: 9,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setCollectionPermission",
      args: [canary.account, art.address, false, true],
      purpose: "Revoke and explicitly deny the canary collection.",
    }),
    call({
      id: "TEARDOWN_OWNER_08_DISABLE_CURRENCY", order: 10,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setCurrencyPolicy",
      args: [canary.account, ZERO_ADDRESS, disabledCurrency],
      purpose: "Disable the native-currency policy while retaining zero limits.",
    }),
    call({
      id: "TEARDOWN_OWNER_09_KEEP_ZERO_VENUE_MAXIMUM", order: 11,
      phase: "TEARDOWN", role: "CURRENT_PUNK_OWNER", from: canary.owner, to: policyModule,
      abi: policyModuleAbi, functionName: "setVenueCurrencyMaximum",
      args: [canary.account, art.address, ZERO_ADDRESS, 0n],
      purpose: "Keep the venue-specific payment ceiling pinned to zero.",
    }),
  ];

  const emergencyGlobalContainmentCalls = [
    call({
      id: "EMERGENCY_GLOBAL_01_PAUSE_ALL_BROKER_POLICY", order: 1,
      phase: "OPTIONAL_EMERGENCY_GLOBAL_CONTAINMENT", role: "GUARDIAN",
      from: core.guardian, to: policyModule,
      abi: policyModuleAbi, functionName: "setGloballyPaused", args: [true],
      purpose: "EMERGENCY ONLY: pause policy consumption for every Punk Account in the protocol, not merely this canary.",
    }),
    call({
      id: "EMERGENCY_GLOBAL_02_PAUSE_ALL_ADAPTERS", order: 2,
      phase: "OPTIONAL_EMERGENCY_GLOBAL_CONTAINMENT", role: "GUARDIAN",
      from: core.guardian, to: adapterRegistry,
      abi: adapterRegistryAbi, functionName: "setGloballyPaused", args: [true],
      purpose: "EMERGENCY ONLY: pause adapter validation protocol-wide, affecting every registered adapter and Punk Account.",
    }),
  ];

  const activationCall = call({
    id: "SEPARATE_PREDEPLOYMENT_ACTIVATION_REFERENCE", order: 0,
    phase: "SEPARATE_PREDEPLOYMENT_PREREQUISITE", role: "CURRENT_PUNK_OWNER",
    from: canary.owner, to: core.contracts.GoghPunkAccountRegistry.address,
    abi: accountRegistryAbi, functionName: "createAccount", args: [canary.punkTokenId],
    purpose: "Reference-only activation call. A DEPLOYED canary manifest already requires this exact account to have code and pass provenance checks.",
  });

  const review = serializable({
    schema: "GOGH_OWNER_DIRECT_CANARY_CONFIG_REVIEW_V1",
    generatedFrom: {
      coreManifestStatus: "DEPLOYED",
      coreGitCommit: core.manifestCommit,
      coreManifestSha256: core.manifestHash,
      coreSourceVerificationAdoption: core.sourceVerificationAdoption,
      coreSourceVerificationAdoptionSha256: core.sourceVerificationAdoptionSha256,
      canaryManifestStatus: "DEPLOYED",
      canaryGitCommit: canary.manifestCommit,
      canaryManifestSha256: canary.manifestHash,
      canarySourceVerificationAdoption: canary.sourceVerificationAdoption,
      canarySourceVerificationAdoptionSha256: canary.sourceVerificationAdoptionSha256,
    },
    scope: {
      chainId: ROBINHOOD_CHAIN_ID,
      canonicalCollection: CANONICAL_COLLECTION,
      canonicalERC6551Registry: CANONICAL_ERC6551_REGISTRY,
      canonicalERC6551RegistryRuntimeCodeHash:
        CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
      accountSalt: ZERO_SALT,
      controllingPunkTokenId: canary.punkTokenId,
      punkAccount: canary.account,
      punkAccountRuntimeBytecodeHash: canary.accountRuntimeBytecodeHash,
      expectedOwnerFromDeployedCanaryManifest: canary.owner,
      canaryArtTokenId: canary.artTokenId,
      opportunityType: "FREE_MINT",
      acquisitionMode: "APPROVAL_REQUIRED",
      executionAuthority: "CURRENT_PUNK_OWNER_ONLY",
    },
    authorization: {
      transactionAuthorized: false,
      signingPerformed: false,
      broadcastPerformed: false,
      rpcUsed: false,
      walletUsed: false,
      privateKeyUsed: false,
      deploymentPerformed: false,
      databaseUsed: false,
      agentRegistrationIncluded: false,
      agentAuthorizationIncluded: false,
      autonomousExecutionIncluded: false,
    },
    roleSections: {
      guardian: {
        address: core.guardian,
        authority: "Protocol feature flags, global pauses, and adapter registry only; no Punk Account asset authority.",
        configurationCallIds: configurationCalls.filter((item) => item.role === "GUARDIAN")
          .map((item) => item.id),
        teardownCallIds: teardownCalls.filter((item) => item.role === "GUARDIAN")
          .map((item) => item.id),
        emergencyGlobalContainmentCallIds: emergencyGlobalContainmentCalls
          .map((item) => item.id),
      },
      currentPunkOwner: {
        address: canary.owner,
        authority: "Live ownerOf(controllingPunkTokenId) must be reverified immediately before every owner call.",
        configurationCallIds: configurationCalls
          .filter((item) => item.role === "CURRENT_PUNK_OWNER").map((item) => item.id),
        teardownCallIds: teardownCalls
          .filter((item) => item.role === "CURRENT_PUNK_OWNER").map((item) => item.id),
      },
    },
    activation: {
      status: "SEPARATE_PREDEPLOYMENT_PREREQUISITE_ALREADY_ATTESTED_BY_INPUT_MANIFEST",
      includeInPostDeploymentConfiguration: false,
      expectedActivatedAccount: canary.account,
      expectedRuntimeBytecodeHash: canary.accountRuntimeBytecodeHash,
      referenceCall: activationCall,
    },
    adapterRegistrationCommitment: {
      adapter: adapter.address,
      venue: art.address,
      collection: art.address,
      kind: "MINT",
      kindEnumValue: 1,
      adapterRuntimeBytecodeHash: adapter.runtimeBytecodeHash,
      venueRuntimeBytecodeHash: art.runtimeBytecodeHash,
      versionLabel: ONE_SHOT_ADAPTER_VERSION_LABEL,
      versionHash: adapterVersionHash,
      metadata: adapterMetadata,
      metadataCanonicalJson: adapterMetadataCanonicalJson,
      metadataHash: adapterMetadataHash,
    },
    desiredConfiguration: {
      featureFlags: APPROVAL_ONLY_FEATURE_FLAGS,
      policy: {
        mode: "APPROVAL_REQUIRED",
        modeEnumValue: 2,
        maxSpendPerTransactionWei: "0",
        maxSpendPerDayWei: "0",
        maxSpendPerWeekWei: "0",
        maxMintPriceWei: "0",
        maxSecondaryPurchasePriceWei: "0",
        minimumNativeReserveWei: "0",
        maxAcquisitionsPerDay: 1,
        maxIntentAgeSeconds: MAX_INTENT_AGE_SECONDS,
        maxSlippageBps: 0,
        requireCollectionAllowlist: true,
        allowUnknownCollections: false,
      },
      exactPermissions: {
        adapter: adapter.address,
        venue: art.address,
        venueKind: "MINT",
        collection: art.address,
        currency: ZERO_ADDRESS,
        selector: CANARY_MINT_SELECTOR,
        ownerApprovedMints: true,
        autonomousFreeMints: false,
        autonomousPaidMints: false,
      },
    },
    configurationPlan: {
      state: "REVIEW_ONLY",
      atomic: false,
      roleBoundary: "Guardian and current Punk owner are separate authorities; this ordered list is a review sequence, not one atomic transaction.",
      safeHandoffs: [
        "The owner pauses and configures DISABLED before any permission is staged.",
        "The guardian enables approvalPurchases only after all narrow account permissions and mint controls are staged.",
        "The account remains paused until the owner switches to APPROVAL_REQUIRED and unpauses it in the final call.",
      ],
      policyVersionTransition: {
        verifiedPreconfigurationVersion: "0",
        verifiedPreconfigurationPermissionGeneration: "0",
        expectedOwnerMutationCount: 11,
        expectedFinalVersion: "11",
        expectedFinalPermissionGeneration: "1",
        note: "The authoritative canary manifest proves a clean version-0/generation-0 prestate. Guardian calls do not increment account policy version; the exact receipt/event verifier must prove all 11 owner mutations, no substitutions, and no extra account mutations before accepting version 11/generation 1.",
      },
      orderedCalls: configurationCalls,
    },
    postConfigurationManifestTransitionChecklist: {
      state: "AWAIT_CONFIRMED_RECEIPTS_AND_FRESH_DUAL_RPC_VERIFICATION",
      authoritativeDeploymentManifestsRemainImmutable: true,
      expectedLiveFeatureFlagsAfterConfirmedReceipts: APPROVAL_ONLY_FEATURE_FLAGS,
      expectedFinalPolicyVersion: "11",
      expectedFinalPermissionGeneration: "1",
      expectedFinalAcquisitionNonce: "0",
      orderedEvidenceAndUpdateSteps: [
        "Record every configuration transaction hash, receipt, block number, block hash, sender role, and emitted event outside this stdout-only generator.",
        "Wait for the documented confirmation threshold and independently verify every resulting state through two credential-free HTTPS RPC origins at one common confirmed block.",
        "Verify the live current Punk owner, account pause=false, APPROVAL_REQUIRED mode, zero spend limits, max acquisitions/day=1, max intent age=120 seconds, exact permissions, ownerApprovedMints=true, and every autonomous mint control=false.",
        "Verify the final policy version is exactly 11 and permission generation exactly 1 only if every listed owner mutation confirmed exactly once from the manifest-proven version-0/generation-0 prestate; otherwise stop.",
        "Verify the adapter registry record is active and pins the exact MINT kind, venue, adapter runtime hash, venue runtime hash, version hash, and metadata hash shown in this review.",
        "Do not mutate the authoritative core or canary deployment/preconfiguration manifests after configuration; retain their exact hashes as immutable evidence inputs.",
        "Build the canonical 13-transaction receipt-evidence artifact and run the dual-RPC read-only live attestor against the immutable manifests plus this exact config bundle.",
        "Generate an owner-direct execution artifact only from that fresh READ_ONLY_PASS output; the artifact remains non-authorizing and EOA-current-owner only.",
      ],
      executionArtifactEligibleBeforeCompletion: false,
    },
    teardownPlan: {
      state: "REVIEW_ONLY_PER_CANARY_TEARDOWN",
      atomic: false,
      roleBoundary: "Guardian disables the global approval feature first; the current owner then pauses/disables the one account; exact revocations follow across both roles.",
      changesGlobalPolicyPause: false,
      changesGlobalAdapterRegistryPause: false,
      leavesAccountPaused: true,
      leavesApprovalPurchasesEnabled: false,
      leavesAdapterActive: false,
      leavesAllMintControlsDisabled: true,
      orderedCalls: teardownCalls,
    },
    emergencyGlobalContainmentPlan: {
      state: "REVIEW_ONLY_OPTIONAL_EMERGENCY_PROTOCOL_WIDE_PAUSE",
      ordinaryPerCanaryTeardownIncludesTheseCalls: false,
      blastRadius: "ALL_PUNK_ACCOUNTS_AND_ALL_REGISTERED_ADAPTERS",
      warning: "These guardian calls are protocol-wide emergency controls. They are not harmless account-local teardown steps and must be authorized separately only for an incident requiring global containment.",
      orderedCalls: emergencyGlobalContainmentCalls,
    },
    requiredBeforeAnyAuthorization: [
      "Explicit, separate deployment/configuration authorization from the human owner and guardian signers.",
      "Fresh dual-RPC confirmation of chain 4663, runtime code hashes, account footer, account owner, adapter identity, venue identity, and unminted one-shot state.",
      "Fresh owner-direct acquisition intent generated only after all configuration calls, using the final on-chain policy version and account nonce.",
      "Per-call simulation from the exact guardian or current owner, followed by human review of destination, selector, calldata, and resulting state.",
      "Confirm no protocol incident pause is active before considering any unpause; this bundle does not clear either global pause.",
      "Keep this teardown plan available to both role holders before the canary mint is attempted.",
    ],
    hardExclusions: [
      "No ArtAgentRegistry call.",
      "No agent registration or authorization.",
      "No autonomous purchases or autonomous mints.",
      "No unknown collection execution.",
      "No selling.",
      "No arbitrary calldata execution.",
      "No signing, sending, deployment, broadcast, RPC, wallet, private key, or database access.",
    ],
    transactionAuthorized: false,
  });
  const bundleHash = keccak256(toBytes(canonicalJson(review)));
  return {
    hashAlgorithm: "KECCAK256_CANONICAL_JSON_V1",
    bundleHash,
    review,
    transactionAuthorized: false,
  };
}

function parseArguments(argv) {
  const allowed = new Set(["--core-manifest", "--canary-manifest"]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.startsWith("--")
      || Object.hasOwn(parsed, name)) {
      fail("INVALID_ARGUMENTS",
        "usage: node scripts/build-owner-direct-canary-config-bundle.mjs --core-manifest <path> --canary-manifest <path>");
    }
    parsed[name] = value;
  }
  if (Object.keys(parsed).length !== 2) {
    fail("INVALID_ARGUMENTS",
      "both --core-manifest and --canary-manifest are required; no default live input is assumed");
  }
  return parsed;
}

async function readJson(path, label) {
  const resolved = resolve(path);
  let handle;
  try {
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MANIFEST_BYTES) {
      fail("INVALID_INPUT_FILE",
        `${label} must be a nonempty regular file no larger than ${MAX_MANIFEST_BYTES} bytes`);
    }
    const text = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
      fail("INVALID_INPUT_FILE", `${label} exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    try {
      return JSON.parse(text);
    } catch {
      fail("INVALID_JSON", `${label} must contain valid JSON`);
    }
  } catch (error) {
    if (error instanceof OwnerDirectCanaryBundleError) throw error;
    fail("READ_FAILED", `${label}: ${error.message}`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const core = await readJson(args["--core-manifest"], "core manifest");
  const canary = await readJson(args["--canary-manifest"], "canary manifest");
  const artifact = buildOwnerDirectCanaryConfigBundle(core, canary);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
