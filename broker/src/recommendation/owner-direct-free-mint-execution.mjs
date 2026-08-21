import { createHash } from "node:crypto";
import {
  decodeFunctionData,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  toFunctionSelector,
} from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { buildOwnerDirectCanaryConfigBundle } from "../../../scripts/build-owner-direct-canary-config-bundle.mjs";
import { validateCanaryConfigurationReceiptEvidence } from "./canary-configuration-receipt-evidence.mjs";
import { validateCleanPreconfigurationState } from "./clean-preconfiguration-state.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
  validateSourceVerificationAdoption,
} from "./source-verification-adoption.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const EMPTY_BYTES = "0x";
const EMPTY_BYTES_HASH = keccak256(EMPTY_BYTES);
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MIN_CONFIRMATIONS = 20;
export const MIN_OWNER_SUBMISSION_TTL_SECONDS = 30;
export const ONE_SHOT_MINT_SELECTOR = toFunctionSelector("mint(address,uint256)");

const CORE_CONTRACTS = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);

const INTENT_COMPONENTS = Object.freeze([
  Object.freeze({ name: "account", type: "address" }),
  Object.freeze({ name: "chainId", type: "uint256" }),
  Object.freeze({ name: "expectedOwner", type: "address" }),
  Object.freeze({ name: "nonce", type: "uint256" }),
  Object.freeze({ name: "policyVersion", type: "uint64" }),
  Object.freeze({ name: "opportunityType", type: "uint8" }),
  Object.freeze({ name: "assetStandard", type: "uint8" }),
  Object.freeze({ name: "adapter", type: "address" }),
  Object.freeze({ name: "venue", type: "address" }),
  Object.freeze({ name: "collection", type: "address" }),
  Object.freeze({ name: "tokenId", type: "uint256" }),
  Object.freeze({ name: "assetAmount", type: "uint256" }),
  Object.freeze({ name: "currency", type: "address" }),
  Object.freeze({ name: "expectedPrice", type: "uint256" }),
  Object.freeze({ name: "maxPrice", type: "uint256" }),
  Object.freeze({ name: "maxSlippageBps", type: "uint16" }),
  Object.freeze({ name: "createdAt", type: "uint64" }),
  Object.freeze({ name: "expiresAt", type: "uint64" }),
  Object.freeze({ name: "opportunityId", type: "bytes32" }),
  Object.freeze({ name: "reasoningHash", type: "bytes32" }),
  Object.freeze({ name: "adapterCodeHash", type: "bytes32" }),
]);

const INTENT_JSON_FIELDS = Object.freeze(INTENT_COMPONENTS.map(({ name }) => name));

export const OWNER_DIRECT_ACQUISITION_ABI = Object.freeze([Object.freeze({
  type: "function",
  name: "executeApprovedAcquisition",
  stateMutability: "nonpayable",
  inputs: Object.freeze([
    Object.freeze({ name: "intent", type: "tuple", components: INTENT_COMPONENTS }),
    Object.freeze({ name: "adapterData", type: "bytes" }),
    Object.freeze({ name: "ownerSignature", type: "bytes" }),
  ]),
  outputs: Object.freeze([{ name: "result", type: "bytes" }]),
})]);

const ACQUISITION_INTENT_TYPES = Object.freeze({
  AcquisitionIntent: Object.freeze([
    ...INTENT_COMPONENTS,
    Object.freeze({ name: "adapterDataHash", type: "bytes32" }),
  ]),
});

export class OwnerDirectExecutionArtifactError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerDirectExecutionArtifactError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerDirectExecutionArtifactError(code, message);
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
      fail("INVALID_PROTOTYPE", `${label} has a nonstandard array prototype`);
    }
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) {
        fail("UNKNOWN_FIELD", `${label} has an unsupported array property`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        fail("ACCESSOR_REJECTED", `${label}[${String(key)}] is not plain data`);
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
    fail("INVALID_PROTOTYPE", `${label} must not use a custom prototype`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not an enumerable data field`);
    }
    assertJsonData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_PROTOTYPE", `${label} must not use a custom prototype`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) {
    fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
  }
  const sortedActual = actual.sort();
  const sortedExpected = [...expected].sort();
  if (sortedActual.length !== sortedExpected.length
    || sortedActual.some((key, index) => key !== sortedExpected[index])) {
    fail("UNKNOWN_FIELD", `${label} fields do not match the canonical schema`);
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not an enumerable data field`);
    }
  }
}

function strictJsonSnapshot(value, label, maximumBytes = 4_000_000) {
  assertJsonData(value, label);
  let clone;
  try {
    clone = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy or uncloneable value`);
  }
  assertJsonData(clone, `${label} snapshot`);
  const serialized = canonicalJson(clone);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("INVALID_SCHEMA", `${label} exceeds its canonical snapshot size limit`);
  }
  return JSON.parse(serialized);
}

function exactArray(value, length, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== length) {
    fail("INVALID_SCHEMA", `${label} must be an exact ${length}-item array`);
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
  }
  return value;
}

function same(actual, expected, code, label) {
  const normalize = (value) => typeof value === "string" ? value.toLowerCase()
    : typeof value === "bigint" ? value.toString() : value;
  if (normalize(actual) !== normalize(expected)) fail(code, `${label} does not match`);
}

function address(value, label, { allowZero = false } = {}) {
  let normalized;
  try {
    normalized = normalizeAddress(value, label);
  } catch (error) {
    fail("INVALID_ADDRESS", error.message);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) fail("ZERO_ADDRESS", `${label} cannot be zero`);
  return normalized;
}

function bytes32(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be exactly 32 bytes`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_BYTES32) fail("ZERO_HASH", `${label} cannot be zero`);
  return normalized;
}

function uint(value, label, { maximum = MAX_UINT256, positive = false } = {}) {
  let parsed;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) parsed = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) parsed = BigInt(value);
  else fail("INVALID_INTEGER", `${label} must be an unsigned decimal integer`);
  if (parsed > maximum || (positive && parsed === 0n)) {
    fail("INVALID_INTEGER", `${label} is outside its permitted range`);
  }
  return parsed;
}

function safeUintNumber(value, label, options) {
  const parsed = uint(value, label, options);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_INTEGER", `${label} exceeds safe JSON precision`);
  }
  return Number(parsed);
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("INVALID_SCHEMA", `${label} must be a bounded nonempty string`);
  }
  return value;
}

function strictIso(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail("INVALID_TIMESTAMP", `${label} must be a strict ISO-UTC timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail("INVALID_TIMESTAMP", `${label} must be a canonical ISO-UTC timestamp`);
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    fail("INCOMPLETE_MANIFEST", `${label} must be a full git commit`);
  }
  return value.toLowerCase();
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

export function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}

function validateCoreContractRecord(record, name, manifestCommit) {
  exactKeys(record, [
    "address", "deploymentTransaction", "deploymentBlock", "deployer", "implementationVersion",
    "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    "verificationStatus",
  ], `coreManifest.contracts.${name}`);
  const normalized = {
    address: address(record.address, `${name} address`),
    deployer: address(record.deployer, `${name} deployer`),
    deploymentBlock: safeUintNumber(record.deploymentBlock, `${name} deployment block`,
      { positive: true }),
    runtimeBytecodeHash: bytes32(record.runtimeBytecodeHash, `${name} runtime bytecode hash`),
  };
  bytes32(record.deploymentTransaction, `${name} deployment transaction`);
  safeUintNumber(record.deploymentBlock, `${name} deployment block`, { positive: true });
  if (record.implementationVersion !== "1" || record.constructorArguments === null
    || record.verificationStatus !== "VERIFIED"
    || commit(record.gitCommit, `${name} git commit`) !== manifestCommit) {
    fail("INCOMPLETE_MANIFEST", `${name} is not a verified version-1 deployment`);
  }
  bytes32(record.creationBytecodeHash, `${name} creation bytecode hash`);
  return normalized;
}

function validateCoreManifest(manifest) {
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "verifiedExternalInfrastructure",
    "accountSalt", "gitCommit", "compiler", "evmVersion", "optimizerRuns", "contracts",
    "sourceVerificationAdoption", "featureFlags", "protocolGuardian", "notes",
  ], "coreManifest");
  if (manifest.status !== "DEPLOYED") fail("NOT_DEPLOYED", "core manifest status is not DEPLOYED");
  exactKeys(manifest.chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "coreManifest.chain");
  same(manifest.chain.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "core manifest chain ID");
  same(manifest.chain.name, ROBINHOOD.name, "WRONG_CHAIN", "core manifest chain name");
  same(manifest.chain.explorer, ROBINHOOD.explorerUrl, "WRONG_CHAIN", "core manifest explorer");
  same(manifest.chain.nativeCurrency, ROBINHOOD.nativeCurrency.symbol,
    "WRONG_CHAIN", "core manifest native currency");
  same(manifest.chain.rpcEnvironmentVariable, "ROBINHOOD_RPC_URL",
    "WRONG_CHAIN", "core manifest RPC environment variable");
  same(address(manifest.canonicalCollection, "core canonical collection"),
    ROBINHOOD.canonicalCollection, "NONCANONICAL_COLLECTION", "core canonical collection");
  same(address(manifest.canonicalERC6551Registry, "core canonical ERC-6551 registry"),
    ROBINHOOD.canonicalERC6551Registry, "INFRASTRUCTURE_MISMATCH", "canonical ERC-6551 registry");
  same(bytes32(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "core canonical ERC-6551 runtime hash"), ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
  "INFRASTRUCTURE_MISMATCH", "canonical ERC-6551 runtime hash");
  same(bytes32(manifest.accountSalt, "core account salt", { allowZero: true }), ZERO_BYTES32,
    "ACCOUNT_SALT_MISMATCH", "core account salt");
  const manifestCommit = commit(manifest.gitCommit, "core manifest git commit");
  if (manifest.compiler !== "0.8.34" || manifest.evmVersion !== "cancun"
    || manifest.optimizerRuns !== 500) {
    fail("INCOMPLETE_MANIFEST", "core manifest compiler settings are not canonical");
  }
  const guardian = address(manifest.protocolGuardian, "core protocol guardian");
  nonemptyString(manifest.notes, "core manifest notes");
  exactKeys(manifest.verifiedExternalInfrastructure, ["seaport"],
    "coreManifest.verifiedExternalInfrastructure");
  exactKeys(manifest.verifiedExternalInfrastructure.seaport, [
    "address", "name", "compiler", "deploymentTransaction", "deploymentBlock",
    "runtimeCodeHash", "verificationStatus", "executionApproved",
  ], "coreManifest.verifiedExternalInfrastructure.seaport");
  if (manifest.verifiedExternalInfrastructure.seaport.executionApproved !== false) {
    fail("UNSAFE_MANIFEST", "unrelated Seaport execution approval must remain false");
  }
  exactKeys(manifest.contracts, CORE_CONTRACTS, "coreManifest.contracts");
  const contracts = {};
  const seen = new Set();
  for (const name of CORE_CONTRACTS) {
    contracts[name] = validateCoreContractRecord(manifest.contracts[name], name, manifestCommit);
    if (seen.has(contracts[name].address)) fail("INCOMPLETE_MANIFEST", "core contract addresses collide");
    if (contracts[name].deployer === guardian) {
      fail("ROLE_COLLISION", `${name} deployer must differ from the protocol guardian`);
    }
    seen.add(contracts[name].address);
  }
  for (const name of ["ArtAdapterRegistry", "ArtAgentRegistry"]) {
    const args = exactArray(
      manifest.contracts[name].constructorArguments,
      1,
      `${name} constructor arguments`,
    );
    same(address(args[0], `${name} guardian argument`), guardian,
      "CONSTRUCTOR_MISMATCH", `${name} guardian argument`);
  }
  {
    const args = exactArray(
      manifest.contracts.BrokerPolicyModule.constructorArguments,
      2,
      "BrokerPolicyModule constructor arguments",
    );
    same(address(args[0], "BrokerPolicyModule guardian argument"), guardian,
      "CONSTRUCTOR_MISMATCH", "BrokerPolicyModule guardian argument");
    same(address(args[1], "BrokerPolicyModule adapter registry argument"),
      contracts.ArtAdapterRegistry.address,
      "CONSTRUCTOR_MISMATCH", "BrokerPolicyModule adapter registry argument");
  }
  {
    const args = exactArray(
      manifest.contracts.GoghPunkAccountV1.constructorArguments,
      3,
      "GoghPunkAccountV1 constructor arguments",
    );
    for (const [index, expected, label] of [
      [0, contracts.BrokerPolicyModule.address, "policy module"],
      [1, contracts.ArtAgentRegistry.address, "agent registry"],
      [2, contracts.ArtAdapterRegistry.address, "adapter registry"],
    ]) {
      same(address(args[index], `GoghPunkAccountV1 ${label} argument`), expected,
        "CONSTRUCTOR_MISMATCH", `GoghPunkAccountV1 ${label} argument`);
    }
  }
  {
    const args = exactArray(
      manifest.contracts.GoghPunkAccountRegistry.constructorArguments,
      2,
      "GoghPunkAccountRegistry constructor arguments",
    );
    same(address(args[0], "GoghPunkAccountRegistry implementation argument"),
      contracts.GoghPunkAccountV1.address,
      "CONSTRUCTOR_MISMATCH", "GoghPunkAccountRegistry implementation argument");
    same(bytes32(args[1], "GoghPunkAccountRegistry salt argument", { allowZero: true }),
      ZERO_BYTES32, "ACCOUNT_SALT_MISMATCH", "GoghPunkAccountRegistry salt argument");
  }
  exactKeys(manifest.featureFlags, [
    "ENABLE_SCOUT_MODE", "ENABLE_APPROVAL_PURCHASES", "ENABLE_AUTONOMOUS_PURCHASES",
    "ENABLE_AUTONOMOUS_MINTS", "ENABLE_UNKNOWN_COLLECTION_EXECUTION", "ENABLE_SELLING",
    "ENABLE_AUTONOMOUS_SELLING",
  ], "coreManifest.featureFlags");
  const expectedFlags = {
    ENABLE_SCOUT_MODE: true,
    ENABLE_APPROVAL_PURCHASES: false,
    ENABLE_AUTONOMOUS_PURCHASES: false,
    ENABLE_AUTONOMOUS_MINTS: false,
    ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
    ENABLE_SELLING: false,
    ENABLE_AUTONOMOUS_SELLING: false,
  };
  for (const [name, expected] of Object.entries(expectedFlags)) {
    same(manifest.featureFlags[name], expected, "UNSAFE_FEATURE_FLAGS", `core manifest ${name}`);
  }
  let sourceVerificationAdoption;
  try {
    sourceVerificationAdoption = requireVerifiedManifestAdoption(manifest, CORE_CONTRACTS);
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "core source verification adoption is invalid");
  }
  return {
    contracts,
    guardian,
    gitCommit: manifestCommit,
    hash: canonicalSha256(manifest),
    sourceVerificationAdoption,
    sourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(sourceVerificationAdoption),
  };
}

function validateCanaryContractRecord(record, name, gitCommit) {
  exactKeys(record, [
    "address", "deploymentTransaction", "deploymentBlock", "deploymentBlockHash",
    "receiptStatus", "confirmationsRequired", "confirmationsObserved", "deployer",
    "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    "verificationStatus",
  ], `canaryManifest.contracts.${name}`);
  const confirmationsRequired = safeUintNumber(
    record.confirmationsRequired,
    `${name} confirmations required`,
    { positive: true },
  );
  const confirmationsObserved = safeUintNumber(
    record.confirmationsObserved,
    `${name} confirmations observed`,
    { positive: true },
  );
  if (confirmationsRequired < MIN_CONFIRMATIONS || confirmationsObserved < confirmationsRequired) {
    fail("UNCONFIRMED_DEPLOYMENT", `${name} lacks the required confirmations`);
  }
  if (record.receiptStatus !== "SUCCESS"
    || record.verificationStatus !== "VERIFIED"
    || commit(record.gitCommit, `${name} git commit`) !== gitCommit) {
    fail("INCOMPLETE_MANIFEST", `${name} is not a successful verified deployment`);
  }
  bytes32(record.deploymentTransaction, `${name} deployment transaction`);
  safeUintNumber(record.deploymentBlock, `${name} deployment block`, { positive: true });
  bytes32(record.deploymentBlockHash, `${name} deployment block hash`);
  address(record.deployer, `${name} deployer`);
  bytes32(record.creationBytecodeHash, `${name} creation bytecode hash`);
  return {
    address: address(record.address, `${name} address`),
    runtimeBytecodeHash: bytes32(record.runtimeBytecodeHash, `${name} runtime bytecode hash`),
    constructorArguments: record.constructorArguments,
    confirmationsRequired,
  };
}

function validateRpcObservation(observation, label, common) {
  exactKeys(observation, [
    "provider", "origin", "chainId", "headBlockNumber", "confirmedBlockNumber",
    "confirmedBlockHash", "confirmedBlockTimestamp", "observedAt", "evidenceHash",
  ], label);
  const provider = nonemptyString(observation.provider, `${label}.provider`);
  let origin;
  try {
    const parsed = new URL(observation.origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== "/") throw new TypeError();
    origin = parsed.origin;
  } catch {
    fail("UNSAFE_MANIFEST", `${label}.origin must be a credential-free HTTPS origin`);
  }
  same(observation.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", `${label}.chainId`);
  const headBlockNumber = safeUintNumber(
    observation.headBlockNumber,
    `${label}.headBlockNumber`,
    { positive: true },
  );
  const confirmedBlockNumber = safeUintNumber(
    observation.confirmedBlockNumber,
    `${label}.confirmedBlockNumber`,
    { positive: true },
  );
  if (headBlockNumber < confirmedBlockNumber) {
    fail("UNVERIFIED_CANARY", `${label} head precedes the confirmed block`);
  }
  same(confirmedBlockNumber, common.number, "UNVERIFIED_CANARY", `${label}.confirmedBlockNumber`);
  same(bytes32(observation.confirmedBlockHash, `${label}.confirmedBlockHash`), common.hash,
    "UNVERIFIED_CANARY", `${label}.confirmedBlockHash`);
  same(strictIso(observation.confirmedBlockTimestamp, `${label}.confirmedBlockTimestamp`),
    common.timestamp, "UNVERIFIED_CANARY", `${label}.confirmedBlockTimestamp`);
  strictIso(observation.observedAt, `${label}.observedAt`);
  bytes32(observation.evidenceHash, `${label}.evidenceHash`);
  return {
    provider,
    origin,
    headBlockNumber,
    confirmedBlockNumber,
  };
}

function validateOwnerObservation(observation, label, expectedOwner) {
  exactKeys(observation, [
    "expectedOwner", "observedOwner", "blockNumber", "blockHash", "blockTimestamp",
  ], label);
  same(address(observation.expectedOwner, `${label}.expectedOwner`), expectedOwner,
    "OWNER_MISMATCH", `${label}.expectedOwner`);
  same(address(observation.observedOwner, `${label}.observedOwner`), expectedOwner,
    "OWNER_MISMATCH", `${label}.observedOwner`);
  uint(observation.blockNumber, `${label}.blockNumber`, { positive: true });
  bytes32(observation.blockHash, `${label}.blockHash`);
  strictIso(observation.blockTimestamp, `${label}.blockTimestamp`);
}

function validateCanaryManifest(manifest, core, proposal) {
  exactKeys(manifest, [
    "status", "chain", "coreDeploymentManifest", "coreDeploymentManifestStatusRequired",
    "coreDeploymentManifestGitCommit", "coreDeploymentManifestSha256",
    "coreGoghPunkAccountRegistry", "coreGoghPunkAccountRegistryRuntimeCodeHash",
    "coreGoghPunkAccountImplementation", "coreGoghPunkAccountImplementationRuntimeCodeHash",
    "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "controllingPunkTokenId",
    "expectedActivatedPunkAccount", "expectedActivatedPunkAccountRuntimeCodeHash",
    "expectedOwnerAtPreparation", "canaryArtTokenId", "gitCommit", "compiler", "evmVersion",
    "optimizerRuns", "contracts", "sourceVerificationAdoption", "provenanceGate",
    "ownerObservations", "configuration", "notes",
  ], "canaryManifest");
  if (manifest.status !== "DEPLOYED") fail("NOT_DEPLOYED", "canary manifest status is not DEPLOYED");
  exactKeys(manifest.chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "canaryManifest.chain");
  same(manifest.chain.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "canary manifest chain ID");
  same(manifest.chain.name, ROBINHOOD.name, "WRONG_CHAIN", "canary manifest chain name");
  same(manifest.chain.explorer, ROBINHOOD.explorerUrl, "WRONG_CHAIN", "canary manifest explorer");
  same(manifest.chain.nativeCurrency, ROBINHOOD.nativeCurrency.symbol,
    "WRONG_CHAIN", "canary manifest native currency");
  if (manifest.coreDeploymentManifest !== "deployments/robinhood.json"
    || manifest.coreDeploymentManifestStatusRequired !== "DEPLOYED") {
    fail("MANIFEST_MISMATCH", "canary manifest does not bind the authoritative core manifest");
  }
  same(commit(manifest.coreDeploymentManifestGitCommit, "canary core git commit"),
    core.gitCommit, "MANIFEST_MISMATCH", "canary core git commit");
  same(bytes32(manifest.coreDeploymentManifestSha256, "canary core manifest hash"),
    core.hash, "MANIFEST_MISMATCH", "canary core manifest hash");
  same(address(manifest.coreGoghPunkAccountRegistry, "canary core account registry"),
    core.contracts.GoghPunkAccountRegistry.address, "MANIFEST_MISMATCH", "core account registry");
  same(bytes32(manifest.coreGoghPunkAccountRegistryRuntimeCodeHash,
    "canary core registry runtime hash"), core.contracts.GoghPunkAccountRegistry.runtimeBytecodeHash,
  "MANIFEST_MISMATCH", "core registry runtime hash");
  same(address(manifest.coreGoghPunkAccountImplementation, "canary core account implementation"),
    core.contracts.GoghPunkAccountV1.address, "MANIFEST_MISMATCH", "core account implementation");
  same(bytes32(manifest.coreGoghPunkAccountImplementationRuntimeCodeHash,
    "canary core account implementation runtime hash"),
  core.contracts.GoghPunkAccountV1.runtimeBytecodeHash,
  "MANIFEST_MISMATCH", "core account implementation runtime hash");
  same(address(manifest.canonicalCollection, "canary canonical collection"),
    ROBINHOOD.canonicalCollection, "NONCANONICAL_COLLECTION", "canary canonical collection");
  same(address(manifest.canonicalERC6551Registry, "canary canonical ERC-6551 registry"),
    ROBINHOOD.canonicalERC6551Registry, "INFRASTRUCTURE_MISMATCH", "canary ERC-6551 registry");
  same(bytes32(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "canary ERC-6551 runtime hash"), ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
  "INFRASTRUCTURE_MISMATCH", "canary ERC-6551 runtime hash");

  const punkTokenId = uint(manifest.controllingPunkTokenId, "canary controlling Punk token ID");
  const punkAccount = address(manifest.expectedActivatedPunkAccount, "canary Punk Account");
  const accountRuntimeCodeHash = bytes32(
    manifest.expectedActivatedPunkAccountRuntimeCodeHash,
    "canary Punk Account runtime hash",
  );
  const expectedOwner = address(manifest.expectedOwnerAtPreparation, "canary expected owner");
  const artTokenId = uint(manifest.canaryArtTokenId, "canary art token ID");
  same(punkTokenId, proposal.punkTokenId, "CANARY_BINDING_MISMATCH", "controlling Punk token ID");
  same(punkAccount, proposal.account, "CANARY_BINDING_MISMATCH", "activated Punk Account");
  same(expectedOwner, proposal.expectedOwner, "OWNER_MISMATCH", "canary expected owner");
  same(artTokenId, proposal.tokenId, "CANARY_BINDING_MISMATCH", "canary art token ID");

  const canaryCommit = commit(manifest.gitCommit, "canary manifest git commit");
  if (canaryCommit !== core.gitCommit || manifest.compiler !== "0.8.34"
    || manifest.evmVersion !== "cancun"
    || manifest.optimizerRuns !== 500) {
    fail("INCOMPLETE_MANIFEST", "canary source/compiler provenance does not match the core release");
  }
  exactKeys(manifest.contracts, ["GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter"],
    "canaryManifest.contracts");
  const art = validateCanaryContractRecord(
    manifest.contracts.GoghOneShotCanaryArt,
    "GoghOneShotCanaryArt",
    canaryCommit,
  );
  const adapter = validateCanaryContractRecord(
    manifest.contracts.GoghOneShotCanaryMintAdapter,
    "GoghOneShotCanaryMintAdapter",
    canaryCommit,
  );
  let sourceVerificationAdoption;
  try {
    sourceVerificationAdoption = requireVerifiedManifestAdoption(
      manifest,
      ["GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter"],
    );
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "canary source verification adoption is invalid");
  }
  const sensitiveAddresses = [
    ...Object.values(core.contracts).map((record) => record.address),
    core.guardian,
    art.address,
    adapter.address,
    punkAccount,
    expectedOwner,
  ];
  if (new Set(sensitiveAddresses).size !== sensitiveAddresses.length) {
    fail("ROLE_COLLISION", "security-sensitive canary addresses must be distinct");
  }
  const artArgs = exactArray(art.constructorArguments, 4, "canary art constructor arguments");
  same(address(artArgs[0], "canary art registry argument"),
    core.contracts.GoghPunkAccountRegistry.address, "CANARY_BINDING_MISMATCH", "art registry argument");
  same(address(artArgs[1], "canary art account argument"), punkAccount,
    "CANARY_BINDING_MISMATCH", "art account argument");
  same(uint(artArgs[2], "canary art Punk ID argument"), punkTokenId,
    "CANARY_BINDING_MISMATCH", "art Punk ID argument");
  same(uint(artArgs[3], "canary art token ID argument"), artTokenId,
    "CANARY_BINDING_MISMATCH", "art token ID argument");
  const adapterArgs = exactArray(adapter.constructorArguments, 1, "canary adapter constructor arguments");
  same(address(adapterArgs[0], "canary adapter art argument"), art.address,
    "CANARY_BINDING_MISMATCH", "adapter art argument");
  same(proposal.adapter, adapter.address, "CANARY_BINDING_MISMATCH", "proposal adapter");
  same(proposal.venue, art.address, "CANARY_BINDING_MISMATCH", "proposal venue");
  same(proposal.collection, art.address, "CANARY_BINDING_MISMATCH", "proposal collection");
  same(proposal.adapterCodeHash, adapter.runtimeBytecodeHash,
    "CODE_HASH_MISMATCH", "proposal adapter runtime hash");

  const gate = manifest.provenanceGate;
  exactKeys(gate, [
    "status", "dualRpcAgreementRequired", "primaryRpcObservation", "secondaryRpcObservation",
    "commonConfirmedBlockNumber", "commonConfirmedBlockHash", "commonConfirmedBlockTimestamp",
    "confirmationsRequired", "confirmationsObserved", "coreManifestHashVerified",
    "coreRegistryRuntimeHashVerified", "accountImplementationRuntimeHashVerified",
    "activatedAccountRuntimeHashVerified", "canonicalERC6551RegistryRuntimeHashVerified",
    "accountFooterVerified", "expectedOwnerVerified", "constructorInputsVerified",
    "cleanPreconfigurationState", "verifiedAt",
  ], "canaryManifest.provenanceGate");
  if (gate.status !== "VERIFIED" || gate.dualRpcAgreementRequired !== true) {
    fail("UNVERIFIED_CANARY", "canary dual-RPC provenance gate has not passed");
  }
  const common = {
    number: safeUintNumber(
      gate.commonConfirmedBlockNumber,
      "canary common confirmed block",
      { positive: true },
    ),
    hash: bytes32(gate.commonConfirmedBlockHash, "canary common confirmed block hash"),
    timestamp: strictIso(
      gate.commonConfirmedBlockTimestamp,
      "canary common confirmed block timestamp",
    ),
  };
  const primaryObservation = validateRpcObservation(
    gate.primaryRpcObservation,
    "canaryManifest.provenanceGate.primaryRpcObservation",
    common,
  );
  const secondaryObservation = validateRpcObservation(
    gate.secondaryRpcObservation,
    "canaryManifest.provenanceGate.secondaryRpcObservation",
    common,
  );
  if (primaryObservation.origin === secondaryObservation.origin) {
    fail("UNVERIFIED_CANARY", "canary provenance observations reuse one provider");
  }
  const confirmationsRequired = safeUintNumber(
    gate.confirmationsRequired,
    "canary provenance confirmations required",
    { positive: true },
  );
  const confirmationsObserved = safeUintNumber(
    gate.confirmationsObserved,
    "canary provenance confirmations observed",
    { positive: true },
  );
  if (confirmationsRequired < MIN_CONFIRMATIONS || confirmationsObserved < confirmationsRequired) {
    fail("UNCONFIRMED_DEPLOYMENT", "canary provenance block lacks confirmations");
  }
  for (const observation of [primaryObservation, secondaryObservation]) {
    if (observation.headBlockNumber - observation.confirmedBlockNumber < confirmationsRequired) {
      fail("UNCONFIRMED_DEPLOYMENT", "canary RPC observation lacks the required confirmations");
    }
  }
  for (const field of [
    "coreManifestHashVerified", "coreRegistryRuntimeHashVerified",
    "accountImplementationRuntimeHashVerified", "activatedAccountRuntimeHashVerified",
    "canonicalERC6551RegistryRuntimeHashVerified", "accountFooterVerified",
    "expectedOwnerVerified", "constructorInputsVerified",
  ]) {
    if (gate[field] !== true) fail("UNVERIFIED_CANARY", `canary ${field} is not true`);
  }
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
  strictIso(gate.verifiedAt, "canary provenance verification time");

  exactKeys(manifest.ownerObservations, [
    "preparation", "afterCanaryArtReceipt", "afterCanaryAdapterReceipt",
  ], "canaryManifest.ownerObservations");
  validateOwnerObservation(
    manifest.ownerObservations.preparation,
    "canaryManifest.ownerObservations.preparation",
    expectedOwner,
  );
  validateOwnerObservation(
    manifest.ownerObservations.afterCanaryArtReceipt,
    "canaryManifest.ownerObservations.afterCanaryArtReceipt",
    expectedOwner,
  );
  validateOwnerObservation(
    manifest.ownerObservations.afterCanaryAdapterReceipt,
    "canaryManifest.ownerObservations.afterCanaryAdapterReceipt",
    expectedOwner,
  );
  exactKeys(manifest.configuration, [
    "deploymentAuthorized", "broadcastAttempted", "adapterRegistered", "policyConfigured",
    "ownerApprovedMintsEnabled", "agentAuthorized", "approvalPurchasesEnabled",
    "autonomousPurchasesEnabled", "autonomousMintsEnabled", "mintExecuted",
  ], "canaryManifest.configuration");
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
    same(manifest.configuration[name], expected, "UNSAFE_CANARY_CONFIGURATION",
      `canary configuration ${name}`);
  }
  nonemptyString(manifest.notes, "canary manifest notes");
  return {
    art,
    adapter,
    expectedOwner,
    punkAccount,
    punkTokenId,
    artTokenId,
    accountRuntimeCodeHash,
    confirmationsRequired: Math.max(
      confirmationsRequired,
      art.confirmationsRequired,
      adapter.confirmationsRequired,
    ),
    hash: canonicalSha256(manifest),
    cleanPreconfigurationState,
    sourceVerificationAdoption,
    sourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(sourceVerificationAdoption),
  };
}

function validateProposalArtifact(artifact) {
  exactKeys(artifact, ["hashAlgorithm", "proposalHash", "proposal"], "proposalArtifact");
  if (artifact.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1") {
    fail("INVALID_PROPOSAL", "proposal hash algorithm is not canonical");
  }
  const proposal = artifact.proposal;
  exactKeys(proposal, [
    "schema", "stage", "punk", "authorization", "intent", "eip712", "humanReview",
    "localArtifacts",
  ], "proposalArtifact.proposal");
  const proposalHash = bytes32(artifact.proposalHash, "proposal hash");
  same(proposalHash, canonicalSha256(proposal), "PROPOSAL_HASH_MISMATCH", "proposal hash");
  if (proposal.schema !== "GOGH_OWNER_REVIEW_FREE_MINT_PROPOSAL_V1"
    || proposal.stage !== "LOCAL_OWNER_REVIEW") {
    fail("INVALID_PROPOSAL", "proposal is not the canonical owner-review schema");
  }
  exactKeys(proposal.punk, ["chainId", "collection", "tokenId", "account", "expectedOwner"],
    "proposalArtifact.proposal.punk");
  same(proposal.punk.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "proposal Punk chain ID");
  same(address(proposal.punk.collection, "proposal Punk collection"), ROBINHOOD.canonicalCollection,
    "NONCANONICAL_COLLECTION", "proposal Punk collection");
  const punkTokenId = uint(proposal.punk.tokenId, "proposal Punk token ID");
  const account = address(proposal.punk.account, "proposal Punk Account");
  const expectedOwner = address(proposal.punk.expectedOwner, "proposal expected owner");

  exactKeys(proposal.authorization, [
    "executionPath", "ownerReviewRequested", "ownerApprovalObtained", "approvalPurchasesStaged",
    "executionEnabled", "autonomousPurchasesEnabled", "autonomousMintsEnabled",
    "unknownCollectionExecutionEnabled", "sellingEnabled",
  ], "proposalArtifact.proposal.authorization");
  const auth = proposal.authorization;
  if (auth.executionPath !== "OWNER_APPROVAL_REQUIRED" || auth.ownerReviewRequested !== true
    || auth.ownerApprovalObtained !== false || auth.approvalPurchasesStaged !== true
    || auth.executionEnabled !== false || auth.autonomousPurchasesEnabled !== false
    || auth.autonomousMintsEnabled !== false || auth.unknownCollectionExecutionEnabled !== false
    || auth.sellingEnabled !== false) {
    fail("INVALID_PROPOSAL", "proposal authorization boundary is not review-only");
  }

  const intent = proposal.intent;
  exactKeys(intent, INTENT_JSON_FIELDS, "proposalArtifact.proposal.intent");
  same(address(intent.account, "intent account"), account, "INTENT_MISMATCH", "intent account");
  same(intent.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "intent chain ID");
  same(address(intent.expectedOwner, "intent expected owner"), expectedOwner,
    "OWNER_MISMATCH", "intent expected owner");
  const nonce = uint(intent.nonce, "intent nonce");
  const policyVersion = uint(intent.policyVersion, "intent policy version", {
    maximum: MAX_UINT64,
    positive: true,
  });
  same(nonce, 0n, "NONCE_MISMATCH", "intent nonce");
  same(policyVersion, 11n, "POLICY_MISMATCH", "intent policy version");
  if (intent.opportunityType !== "FREE_MINT" || intent.assetStandard !== "ERC721") {
    fail("FREE_MINT_ONLY", "execution artifacts support only a FREE_MINT ERC721 intent");
  }
  const adapter = address(intent.adapter, "intent adapter");
  const venue = address(intent.venue, "intent venue");
  const collection = address(intent.collection, "intent collection");
  const tokenId = uint(intent.tokenId, "intent token ID");
  same(uint(intent.assetAmount, "intent asset amount"), 1n,
    "FREE_MINT_ONLY", "intent asset amount");
  same(address(intent.currency, "intent currency", { allowZero: true }), ZERO_ADDRESS,
    "FREE_MINT_ONLY", "intent currency");
  same(uint(intent.expectedPrice, "intent expected price"), 0n,
    "FREE_MINT_ONLY", "intent expected price");
  same(uint(intent.maxPrice, "intent maximum price"), 0n,
    "FREE_MINT_ONLY", "intent maximum price");
  same(uint(intent.maxSlippageBps, "intent maximum slippage"), 0n,
    "FREE_MINT_ONLY", "intent maximum slippage");
  const createdAt = uint(intent.createdAt, "intent creation time", { maximum: MAX_UINT64 });
  const expiresAt = uint(intent.expiresAt, "intent expiry", { maximum: MAX_UINT64 });
  if (expiresAt <= createdAt || expiresAt - createdAt > 120n) {
    fail("STALE_PROPOSAL", "intent lifetime must be positive and no longer than 120 seconds");
  }
  const opportunityId = bytes32(intent.opportunityId, "intent opportunity ID");
  const reasoningHash = bytes32(intent.reasoningHash, "intent reasoning hash");
  const adapterCodeHash = bytes32(intent.adapterCodeHash, "intent adapter runtime hash");

  exactKeys(proposal.eip712, [
    "domain", "primaryType", "adapterDataPolicy", "adapterDataHash", "intentDigest",
    "derivation", "liveDeploymentVerified", "ownerApprovalObtained",
  ], "proposalArtifact.proposal.eip712");
  exactKeys(proposal.eip712.domain, ["name", "version", "chainId", "verifyingContract"],
    "proposalArtifact.proposal.eip712.domain");
  const domain = proposal.eip712.domain;
  same(domain.name, "Gogh Punk Account", "DIGEST_MISMATCH", "EIP-712 domain name");
  same(domain.version, "1", "DIGEST_MISMATCH", "EIP-712 domain version");
  same(domain.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "EIP-712 domain chain ID");
  same(address(domain.verifyingContract, "EIP-712 verifying contract"), account,
    "DIGEST_MISMATCH", "EIP-712 verifying contract");
  if (proposal.eip712.primaryType !== "AcquisitionIntent"
    || proposal.eip712.adapterDataPolicy !== "EMPTY_ONLY"
    || bytes32(proposal.eip712.adapterDataHash, "EIP-712 adapter-data hash") !== EMPTY_BYTES_HASH
    || proposal.eip712.derivation !== "LOCAL_CURRENT_GOGH_PUNK_ACCOUNT_V1"
    || proposal.eip712.liveDeploymentVerified !== false
    || proposal.eip712.ownerApprovalObtained !== false) {
    fail("INVALID_PROPOSAL", "proposal EIP-712 review boundary is not canonical");
  }

  exactKeys(proposal.humanReview, [
    "summary", "target", "outputTokenId", "outputAmount", "totalPrice", "expiresInSeconds",
    "requiredChecks",
  ], "proposalArtifact.proposal.humanReview");
  exactKeys(proposal.humanReview.target, [
    "adapter", "venue", "collection", "mintSelector", "adapterDataPolicy", "adapterDataHash",
  ], "proposalArtifact.proposal.humanReview.target");
  const target = proposal.humanReview.target;
  same(address(target.adapter, "review adapter"), adapter, "TARGET_MISMATCH", "review adapter");
  same(address(target.venue, "review venue"), venue, "TARGET_MISMATCH", "review venue");
  same(address(target.collection, "review collection"), collection,
    "TARGET_MISMATCH", "review collection");
  same(target.mintSelector, ONE_SHOT_MINT_SELECTOR, "TARGET_MISMATCH", "one-shot mint selector");
  if (target.adapterDataPolicy !== "EMPTY_ONLY"
    || bytes32(target.adapterDataHash, "review adapter-data hash") !== EMPTY_BYTES_HASH) {
    fail("TARGET_MISMATCH", "review target does not require empty adapter data");
  }
  same(uint(proposal.humanReview.outputTokenId, "review output token ID"), tokenId,
    "TARGET_MISMATCH", "review output token ID");
  same(uint(proposal.humanReview.outputAmount, "review output amount"), 1n,
    "TARGET_MISMATCH", "review output amount");
  same(uint(proposal.humanReview.totalPrice, "review total price"), 0n,
    "TARGET_MISMATCH", "review total price");
  same(uint(proposal.humanReview.expiresInSeconds, "review expiry"), expiresAt - createdAt,
    "TARGET_MISMATCH", "review expiry");
  if (!Array.isArray(proposal.humanReview.requiredChecks)
    || proposal.humanReview.requiredChecks.length !== 5
    || proposal.humanReview.requiredChecks.some((item) => typeof item !== "string" || !item)) {
    fail("INVALID_PROPOSAL", "review checklist is not the canonical five-item list");
  }
  nonemptyString(proposal.humanReview.summary, "review summary");
  exactKeys(proposal.localArtifacts, [
    "signingPerformed", "submissionPerformed", "chainWritePerformed",
  ], "proposalArtifact.proposal.localArtifacts");
  if (proposal.localArtifacts.signingPerformed !== false
    || proposal.localArtifacts.submissionPerformed !== false
    || proposal.localArtifacts.chainWritePerformed !== false) {
    fail("INVALID_PROPOSAL", "proposal claims a signing, submission, or chain write");
  }

  const solidityIntent = {
    account,
    chainId: BigInt(ROBINHOOD.chainId),
    expectedOwner,
    nonce,
    policyVersion,
    opportunityType: 2,
    assetStandard: 0,
    adapter,
    venue,
    collection,
    tokenId,
    assetAmount: 1n,
    currency: ZERO_ADDRESS,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt,
    expiresAt,
    opportunityId,
    reasoningHash,
    adapterCodeHash,
  };
  const intentDigest = hashTypedData({
    domain: { name: "Gogh Punk Account", version: "1", chainId: ROBINHOOD.chainId,
      verifyingContract: account },
    types: ACQUISITION_INTENT_TYPES,
    primaryType: "AcquisitionIntent",
    message: { ...solidityIntent, adapterDataHash: EMPTY_BYTES_HASH },
  }).toLowerCase();
  same(bytes32(proposal.eip712.intentDigest, "proposal intent digest"), intentDigest,
    "DIGEST_MISMATCH", "recomputed EIP-712 intent digest");
  return {
    proposalHash,
    artifactHash: canonicalSha256(artifact),
    punkTokenId,
    account,
    expectedOwner,
    nonce,
    policyVersion,
    adapter,
    venue,
    collection,
    tokenId,
    createdAt,
    expiresAt,
    opportunityId,
    reasoningHash,
    adapterCodeHash,
    intentDigest,
    solidityIntent,
  };
}

function validateConfigurationArtifacts(configBundleArtifact, configurationEvidenceArtifact,
  coreManifest, canaryManifest) {
  let expectedBundle;
  try {
    expectedBundle = buildOwnerDirectCanaryConfigBundle(coreManifest, canaryManifest);
  } catch (error) {
    fail(error?.code ?? "INVALID_CONFIG_BUNDLE", error?.message ?? "config bundle rebuild failed");
  }
  if (canonicalJson(configBundleArtifact) !== canonicalJson(expectedBundle)) {
    fail("CONFIG_BUNDLE_MISMATCH",
      "config bundle is not the exact artifact rebuilt from the authoritative manifests");
  }
  let evidence;
  try {
    evidence = validateCanaryConfigurationReceiptEvidence(configurationEvidenceArtifact);
  } catch (error) {
    fail(error?.code ?? "INVALID_CONFIGURATION_EVIDENCE",
      error?.message ?? "configuration receipt evidence is invalid");
  }
  same(evidence.evidence.configBundleHash, expectedBundle.bundleHash,
    "CONFIG_BUNDLE_MISMATCH", "configuration evidence config bundle hash");
  const clean = canaryManifest.provenanceGate.cleanPreconfigurationState;
  same(evidence.evidence.preconfigurationBlock.number, clean.blockNumber,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block number");
  same(evidence.evidence.preconfigurationBlock.hash, clean.blockHash,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block hash");
  same(evidence.evidence.preconfigurationBlock.timestamp, clean.blockTimestamp,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block timestamp");
  const planned = expectedBundle.review?.configurationPlan?.orderedCalls;
  if (!Array.isArray(planned) || planned.length !== 13) {
    fail("INVALID_CONFIG_BUNDLE", "config bundle lacks the exact 13-call configuration plan");
  }
  for (let index = 0; index < planned.length; index += 1) {
    const recorded = evidence.evidence.transactions[index];
    if (recorded.id !== planned[index].id || recorded.order !== planned[index].order) {
      fail("CONFIGURATION_EVIDENCE_MISMATCH",
        `configuration receipt evidence item ${index + 1} is not the planned call`);
    }
  }
  return {
    bundle: expectedBundle,
    bundleArtifactHash: canonicalSha256(configBundleArtifact),
    evidence,
    evidenceArtifactHash: canonicalSha256(configurationEvidenceArtifact),
  };
}

function validateAttestation(attestation, proposal, core, canary, config, nowSeconds) {
  exactKeys(attestation, [
    "chainId", "chainWritePerformed", "configurationHistory", "evidenceHashes",
    "executionBoundary", "infrastructure", "intentDigest", "latestExecutionCheck",
    "pinnedBlock", "punk", "readOnly", "signingPerformed", "simulation", "status",
    "sourceVerification", "submissionPerformed", "target", "timing", "transactionAuthorized",
  ], "liveAttestation");
  if (attestation.status !== "READ_ONLY_PASS" || attestation.readOnly !== true
    || attestation.transactionAuthorized !== false || attestation.signingPerformed !== false
    || attestation.submissionPerformed !== false || attestation.chainWritePerformed !== false
    || attestation.simulation !== "READ_ONLY_ETH_CALL_PASS") {
    fail("INVALID_ATTESTATION", "attestation is not a genuine read-only pass boundary");
  }
  same(attestation.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "attestation chain ID");
  exactKeys(attestation.executionBoundary, [
    "path", "ownerType", "simulatedCaller", "adapterData", "ownerSignature", "agentRelayerUsed",
  ], "liveAttestation.executionBoundary");
  const execution = attestation.executionBoundary;
  if (execution.path !== "OWNER_DIRECT_EMPTY_SIGNATURE"
    || execution.ownerType !== "EOA_CURRENT_OWNER_ONLY"
    || execution.adapterData !== EMPTY_BYTES || execution.ownerSignature !== EMPTY_BYTES
    || execution.agentRelayerUsed !== false) {
    fail("INVALID_ATTESTATION", "attestation did not simulate the exact owner-direct empty-data path");
  }
  same(address(execution.simulatedCaller, "attestation simulated caller"), proposal.expectedOwner,
    "OWNER_MISMATCH", "attestation simulated caller");

  exactKeys(attestation.evidenceHashes, [
    "algorithms", "canaryManifest", "configBundleReview", "configBundleArtifact",
    "canarySourceVerificationAdoption", "coreSourceVerificationAdoption",
    "configurationReceiptEvidence", "configurationReceiptEvidenceArtifact", "coreManifest",
    "proposal", "proposalArtifact",
  ],
    "liveAttestation.evidenceHashes");
  exactKeys(attestation.evidenceHashes.algorithms, ["artifactEvidence", "configBundleReview"],
    "liveAttestation.evidenceHashes.algorithms");
  if (attestation.evidenceHashes.algorithms.artifactEvidence !== "SHA256_CANONICAL_JSON_V1"
    || attestation.evidenceHashes.algorithms.configBundleReview
      !== "KECCAK256_CANONICAL_JSON_V1") {
    fail("INVALID_ATTESTATION", "attestation hash algorithms are not canonical");
  }
  same(bytes32(attestation.evidenceHashes.coreManifest, "attested core manifest hash"), core.hash,
    "EVIDENCE_MISMATCH", "attested core manifest hash");
  same(bytes32(attestation.evidenceHashes.canaryManifest, "attested canary manifest hash"), canary.hash,
    "EVIDENCE_MISMATCH", "attested canary manifest hash");
  same(bytes32(attestation.evidenceHashes.coreSourceVerificationAdoption,
    "attested core source-verification adoption hash"), core.sourceVerificationAdoptionSha256,
  "EVIDENCE_MISMATCH", "attested core source-verification adoption hash");
  same(bytes32(attestation.evidenceHashes.canarySourceVerificationAdoption,
    "attested canary source-verification adoption hash"), canary.sourceVerificationAdoptionSha256,
  "EVIDENCE_MISMATCH", "attested canary source-verification adoption hash");
  same(bytes32(attestation.evidenceHashes.configBundleReview, "attested config bundle review hash"),
    config.bundle.bundleHash, "EVIDENCE_MISMATCH", "attested config bundle hash");
  same(bytes32(attestation.evidenceHashes.configBundleArtifact,
    "attested config bundle artifact hash"), config.bundleArtifactHash,
  "EVIDENCE_MISMATCH", "attested config bundle artifact hash");
  same(bytes32(attestation.evidenceHashes.configurationReceiptEvidence,
    "attested configuration receipt evidence hash"), config.evidence.evidenceHash,
  "EVIDENCE_MISMATCH", "attested configuration receipt evidence hash");
  same(bytes32(attestation.evidenceHashes.configurationReceiptEvidenceArtifact,
    "attested configuration receipt evidence artifact hash"), config.evidenceArtifactHash,
  "EVIDENCE_MISMATCH", "attested configuration receipt evidence artifact hash");
  same(bytes32(attestation.evidenceHashes.proposal, "attested proposal hash"), proposal.proposalHash,
    "EVIDENCE_MISMATCH", "attested proposal hash");
  same(bytes32(attestation.evidenceHashes.proposalArtifact, "attested proposal artifact hash"),
    proposal.artifactHash, "EVIDENCE_MISMATCH", "attested proposal artifact hash");

  exactKeys(attestation.punk, ["tokenId", "account", "currentOwner", "accountRuntimeCodeHash"],
    "liveAttestation.punk");
  same(uint(attestation.punk.tokenId, "attested Punk token ID"), proposal.punkTokenId,
    "CANARY_BINDING_MISMATCH", "attested Punk token ID");
  same(address(attestation.punk.account, "attested Punk Account"), proposal.account,
    "CANARY_BINDING_MISMATCH", "attested Punk Account");
  same(address(attestation.punk.currentOwner, "attested current Punk owner"), proposal.expectedOwner,
    "OWNER_MISMATCH", "attested current Punk owner");
  same(bytes32(attestation.punk.accountRuntimeCodeHash, "attested Punk Account runtime hash"),
    canary.accountRuntimeCodeHash, "CODE_HASH_MISMATCH", "attested Punk Account runtime hash");

  exactKeys(attestation.target, [
    "adapter", "adapterCodeHash", "collection", "collectionCodeHash", "selector", "venue",
    "venueCodeHash",
  ], "liveAttestation.target");
  same(address(attestation.target.adapter, "attested adapter"), canary.adapter.address,
    "CANARY_BINDING_MISMATCH", "attested adapter");
  same(address(attestation.target.venue, "attested venue"), canary.art.address,
    "CANARY_BINDING_MISMATCH", "attested venue");
  same(address(attestation.target.collection, "attested collection"), canary.art.address,
    "CANARY_BINDING_MISMATCH", "attested collection");
  same(attestation.target.selector, ONE_SHOT_MINT_SELECTOR,
    "CANARY_BINDING_MISMATCH", "attested mint selector");
  same(bytes32(attestation.target.adapterCodeHash, "attested adapter runtime hash"),
    canary.adapter.runtimeBytecodeHash, "CODE_HASH_MISMATCH", "attested adapter runtime hash");
  same(bytes32(attestation.target.venueCodeHash, "attested venue runtime hash"),
    canary.art.runtimeBytecodeHash, "CODE_HASH_MISMATCH", "attested venue runtime hash");
  same(bytes32(attestation.target.collectionCodeHash, "attested collection runtime hash"),
    canary.art.runtimeBytecodeHash, "CODE_HASH_MISMATCH", "attested collection runtime hash");

  exactKeys(attestation.infrastructure, [
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
  ], "liveAttestation.infrastructure");
  same(address(attestation.infrastructure.canonicalERC6551Registry,
    "attested canonical ERC-6551 registry"), ROBINHOOD.canonicalERC6551Registry,
  "INFRASTRUCTURE_MISMATCH", "attested canonical ERC-6551 registry");
  same(bytes32(attestation.infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    "attested canonical ERC-6551 runtime hash"), ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
  "INFRASTRUCTURE_MISMATCH", "attested canonical ERC-6551 runtime hash");
  same(bytes32(attestation.intentDigest, "attested intent digest"), proposal.intentDigest,
    "DIGEST_MISMATCH", "attested intent digest");

  exactKeys(attestation.sourceVerification, [
    "canaryAdoption", "canaryAdoptionSha256", "coreAdoption", "coreAdoptionSha256", "status",
  ], "liveAttestation.sourceVerification");
  if (attestation.sourceVerification.status !== "VERIFIED_ADOPTIONS_BOUND") {
    fail("SOURCE_VERIFICATION_NOT_ADOPTED", "attestation source verification status is invalid");
  }
  let attestedCoreAdoption;
  let attestedCanaryAdoption;
  try {
    attestedCoreAdoption = validateSourceVerificationAdoption(
      attestation.sourceVerification.coreAdoption,
      { expectedContracts: CORE_CONTRACTS },
    );
    attestedCanaryAdoption = validateSourceVerificationAdoption(
      attestation.sourceVerification.canaryAdoption,
      { expectedContracts: ["GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter"] },
    );
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "attested source verification adoption is invalid");
  }
  same(sourceVerificationCanonicalSha256(attestedCoreAdoption),
    core.sourceVerificationAdoptionSha256,
    "SOURCE_VERIFICATION_HASH_MISMATCH", "attested core source verification adoption");
  same(sourceVerificationCanonicalSha256(attestedCanaryAdoption),
    canary.sourceVerificationAdoptionSha256,
    "SOURCE_VERIFICATION_HASH_MISMATCH", "attested canary source verification adoption");
  same(bytes32(attestation.sourceVerification.coreAdoptionSha256,
    "attested core adoption section hash"), core.sourceVerificationAdoptionSha256,
  "SOURCE_VERIFICATION_HASH_MISMATCH", "attested core adoption section hash");
  same(bytes32(attestation.sourceVerification.canaryAdoptionSha256,
    "attested canary adoption section hash"), canary.sourceVerificationAdoptionSha256,
  "SOURCE_VERIFICATION_HASH_MISMATCH", "attested canary adoption section hash");

  exactKeys(attestation.configurationHistory, [
    "expectedAcquisitionNonce", "expectedFinalPermissionGeneration",
    "expectedFinalPolicyVersion", "lastTransactionBlock", "noExtraRelevantMutationEvents",
    "noOwnershipTransfersFromPreconfigurationThroughLatest", "noPriorCanaryActivity",
    "noRelevantMutationsAfterPinnedBlock", "preconfigurationBlock", "status", "transactionCount",
  ], "liveAttestation.configurationHistory");
  const history = attestation.configurationHistory;
  if (history.status !== "EXACT_13_CALL_DUAL_RPC_VERIFIED" || history.transactionCount !== 13
    || history.expectedFinalPolicyVersion !== "11"
    || history.expectedFinalPermissionGeneration !== "1"
    || history.expectedAcquisitionNonce !== "0"
    || history.noPriorCanaryActivity !== true
    || history.noExtraRelevantMutationEvents !== true
    || history.noOwnershipTransfersFromPreconfigurationThroughLatest !== true
    || history.noRelevantMutationsAfterPinnedBlock !== true) {
    fail("CONFIGURATION_HISTORY_MISMATCH",
      "attestation does not prove the exact isolated 13-call configuration history");
  }
  same(uint(history.preconfigurationBlock, "configuration prestate block"),
    BigInt(config.evidence.evidence.preconfigurationBlock.number),
    "CONFIGURATION_HISTORY_MISMATCH", "configuration prestate block");
  const historyLastBlock = uint(history.lastTransactionBlock,
    "configuration last transaction block");

  exactKeys(attestation.latestExecutionCheck, [
    "currentOwner", "exactState", "hash", "headSkew", "nonce", "number", "ownerType",
    "permissionGeneration", "policyVersion", "primaryHead", "secondaryHead", "simulation",
    "status", "timestamp",
  ], "liveAttestation.latestExecutionCheck");
  const latest = attestation.latestExecutionCheck;
  exactKeys(latest.exactState, [
    "accountPaused", "accountRuntimeCodeHash", "acquisitionsToday", "adapterActive",
    "adaptersPaused", "agentsPaused", "approvalPurchases", "autonomousFreeMints",
    "autonomousMints", "autonomousPaidMints", "autonomousPurchases",
    "maxAcquisitionsPerDay", "maxIntentAgeSeconds", "minimumNativeReserve", "mode",
    "ownerApprovedMints", "policyPaused", "selling", "autonomousSelling",
    "unknownCollectionExecution",
  ], "liveAttestation.latestExecutionCheck.exactState");
  if (latest.status !== "LATEST_COMMON_BLOCK_READ_AND_SIMULATION_PASS"
    || latest.ownerType !== "EOA" || latest.simulation !== "READ_ONLY_ETH_CALL_PASS") {
    fail("STALE_ATTESTATION", "latest owner-direct execution check did not pass");
  }
  same(address(latest.currentOwner, "latest attested owner"), proposal.expectedOwner,
    "OWNER_MISMATCH", "latest attested owner");
  same(uint(latest.nonce, "latest attested nonce"), 0n, "NONCE_MISMATCH", "latest nonce");
  same(uint(latest.policyVersion, "latest attested policy version"), 11n,
    "POLICY_MISMATCH", "latest policy version");
  same(uint(latest.permissionGeneration, "latest permission generation"), 1n,
    "POLICY_MISMATCH", "latest permission generation");
  const exactState = latest.exactState;
  same(bytes32(exactState.accountRuntimeCodeHash, "latest Punk Account runtime hash"),
    canary.accountRuntimeCodeHash, "CODE_HASH_MISMATCH", "latest Punk Account runtime hash");
  const expectedLatestState = {
    mode: "APPROVAL_REQUIRED", minimumNativeReserve: "0", maxAcquisitionsPerDay: "1",
    maxIntentAgeSeconds: "120", acquisitionsToday: "0", accountPaused: false,
    policyPaused: false, adaptersPaused: false, agentsPaused: false,
    ownerApprovedMints: true, autonomousFreeMints: false, autonomousPaidMints: false,
    approvalPurchases: true, autonomousPurchases: false, autonomousMints: false,
    unknownCollectionExecution: false, selling: false, autonomousSelling: false,
    adapterActive: true,
  };
  for (const [name, expected] of Object.entries(expectedLatestState)) {
    same(exactState[name], expected, "STALE_ATTESTATION", `latest exact state ${name}`);
  }
  const latestBlock = {
    number: uint(latest.number, "latest attested block number"),
    hash: bytes32(latest.hash, "latest attested block hash"),
    timestamp: uint(latest.timestamp, "latest attested block timestamp"),
    primaryHead: uint(latest.primaryHead, "latest primary head"),
    secondaryHead: uint(latest.secondaryHead, "latest secondary head"),
    headSkew: uint(latest.headSkew, "latest head skew"),
  };
  if (latestBlock.headSkew > 3n) fail("STALE_ATTESTATION", "latest RPC head skew exceeds three blocks");

  exactKeys(attestation.pinnedBlock, ["confirmations", "hash", "number", "timestamp"],
    "liveAttestation.pinnedBlock");
  const confirmations = safeUintNumber(
    attestation.pinnedBlock.confirmations,
    "attested confirmations",
    { positive: true },
  );
  if (confirmations < Math.max(MIN_CONFIRMATIONS, canary.confirmationsRequired)) {
    fail("UNCONFIRMED_ATTESTATION", "live attestation does not meet the deployment confirmation depth");
  }
  const pinnedBlock = {
    number: uint(attestation.pinnedBlock.number, "attested pinned block number"),
    hash: bytes32(attestation.pinnedBlock.hash, "attested pinned block hash"),
    timestamp: uint(attestation.pinnedBlock.timestamp, "attested pinned block timestamp"),
    confirmations,
  };
  if (!(BigInt(config.evidence.evidence.preconfigurationBlock.number) < historyLastBlock
    && historyLastBlock <= pinnedBlock.number)) {
    fail("CONFIGURATION_HISTORY_MISMATCH", "configuration history block ordering is invalid");
  }
  if (latestBlock.number < pinnedBlock.number || latestBlock.timestamp < pinnedBlock.timestamp) {
    fail("STALE_ATTESTATION", "latest execution check precedes the confirmed attestation pin");
  }
  exactKeys(attestation.timing, [
    "checkedAt", "expiresAt", "minimumSubmissionMarginSeconds", "remainingSeconds",
  ], "liveAttestation.timing");
  const checkedAt = uint(attestation.timing.checkedAt, "attestation checkedAt");
  const expiresAt = uint(attestation.timing.expiresAt, "attestation expiresAt");
  const remainingAtAttestation = uint(
    attestation.timing.remainingSeconds,
    "attestation remaining seconds",
  );
  same(expiresAt, proposal.expiresAt, "STALE_ATTESTATION", "attested expiry");
  same(expiresAt - checkedAt, remainingAtAttestation,
    "STALE_ATTESTATION", "attested remaining time");
  same(attestation.timing.minimumSubmissionMarginSeconds, MIN_OWNER_SUBMISSION_TTL_SECONDS,
    "STALE_ATTESTATION", "attested minimum submission margin");
  if (checkedAt < pinnedBlock.timestamp || checkedAt < latestBlock.timestamp
    || checkedAt > BigInt(nowSeconds)) {
    fail("STALE_ATTESTATION", "attestation timing is future-dated or precedes its pinned block");
  }
  if (proposal.createdAt > pinnedBlock.timestamp || proposal.expiresAt < pinnedBlock.timestamp) {
    fail("STALE_ATTESTATION", "proposal was not valid at the attested pinned block");
  }
  const remainingNow = proposal.expiresAt - BigInt(nowSeconds);
  if (remainingNow < BigInt(MIN_OWNER_SUBMISSION_TTL_SECONDS)) {
    fail("STALE_ATTESTATION", "less than the safe owner submission TTL remains");
  }
  return {
    checkedAt,
    remainingNow,
    pinnedBlock,
    latestBlock,
    configurationHistory: {
      noOwnershipTransfersFromPreconfigurationThroughLatest:
        history.noOwnershipTransfersFromPreconfigurationThroughLatest,
      noRelevantMutationsAfterPinnedBlock: history.noRelevantMutationsAfterPinnedBlock,
    },
    hash: canonicalSha256(attestation),
  };
}

function decodedField(tuple, name, index) {
  if (!tuple || (typeof tuple !== "object" && typeof tuple !== "function")) return undefined;
  if (Object.hasOwn(tuple, name)) return tuple[name];
  if (Object.hasOwn(tuple, index)) return tuple[index];
  return undefined;
}

function assertDecodedIntent(decoded, expected) {
  const expectedValues = [
    expected.account, expected.chainId, expected.expectedOwner, expected.nonce,
    expected.policyVersion, expected.opportunityType, expected.assetStandard, expected.adapter,
    expected.venue, expected.collection, expected.tokenId, expected.assetAmount, expected.currency,
    expected.expectedPrice, expected.maxPrice, expected.maxSlippageBps, expected.createdAt,
    expected.expiresAt, expected.opportunityId, expected.reasoningHash, expected.adapterCodeHash,
  ];
  for (let index = 0; index < INTENT_COMPONENTS.length; index += 1) {
    const { name, type } = INTENT_COMPONENTS[index];
    let actual = decodedField(decoded, name, index);
    let wanted = expectedValues[index];
    if (type === "address" || type === "bytes32") {
      actual = typeof actual === "string" ? actual.toLowerCase() : actual;
      wanted = typeof wanted === "string" ? wanted.toLowerCase() : wanted;
    } else {
      actual = BigInt(actual);
      wanted = BigInt(wanted);
    }
    same(actual, wanted, "ENCODING_MISMATCH", `decoded intent.${name}`);
  }
}

function intentForJson(proposal) {
  return Object.freeze({
    account: proposal.account,
    chainId: String(ROBINHOOD.chainId),
    expectedOwner: proposal.expectedOwner,
    nonce: proposal.nonce.toString(),
    policyVersion: proposal.policyVersion.toString(),
    opportunityType: "FREE_MINT",
    opportunityTypeValue: 2,
    assetStandard: "ERC721",
    assetStandardValue: 0,
    adapter: proposal.adapter,
    venue: proposal.venue,
    collection: proposal.collection,
    tokenId: proposal.tokenId.toString(),
    assetAmount: "1",
    currency: ZERO_ADDRESS,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: "0",
    createdAt: proposal.createdAt.toString(),
    expiresAt: proposal.expiresAt.toString(),
    opportunityId: proposal.opportunityId,
    reasoningHash: proposal.reasoningHash,
    adapterCodeHash: proposal.adapterCodeHash,
    adapterDataHash: EMPTY_BYTES_HASH,
  });
}

export function buildOwnerDirectFreeMintExecutionArtifact(inputs, options = {}) {
  const snapshot = strictJsonSnapshot(inputs, "inputs");
  const optionSnapshot = strictJsonSnapshot(options, "options", 10_000);
  exactKeys(snapshot, [
    "proposalArtifact", "liveAttestation", "coreManifest", "canaryManifest",
    "configBundleArtifact", "configurationEvidenceArtifact",
  ],
    "inputs snapshot");
  exactKeys(optionSnapshot, ["nowSeconds"], "options snapshot");
  const nowSeconds = safeUintNumber(optionSnapshot.nowSeconds, "nowSeconds");

  const proposal = validateProposalArtifact(snapshot.proposalArtifact);
  const core = validateCoreManifest(snapshot.coreManifest);
  const canary = validateCanaryManifest(snapshot.canaryManifest, core, proposal);
  const config = validateConfigurationArtifacts(
    snapshot.configBundleArtifact,
    snapshot.configurationEvidenceArtifact,
    snapshot.coreManifest,
    snapshot.canaryManifest,
  );
  const attestation = validateAttestation(
    snapshot.liveAttestation,
    proposal,
    core,
    canary,
    config,
    nowSeconds,
  );

  const data = encodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    functionName: "executeApprovedAcquisition",
    args: [proposal.solidityIntent, EMPTY_BYTES, EMPTY_BYTES],
  }).toLowerCase();
  const decoded = decodeFunctionData({ abi: OWNER_DIRECT_ACQUISITION_ABI, data });
  if (decoded.functionName !== "executeApprovedAcquisition" || decoded.args?.length !== 3
    || decoded.args[1] !== EMPTY_BYTES || decoded.args[2] !== EMPTY_BYTES) {
    fail("ENCODING_MISMATCH", "post-encoding decode did not recover the owner-direct call");
  }
  assertDecodedIntent(decoded.args[0], proposal.solidityIntent);
  const reencoded = encodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    functionName: decoded.functionName,
    args: decoded.args,
  }).toLowerCase();
  same(reencoded, data, "ENCODING_MISMATCH", "canonical re-encoding");
  const functionSelector = data.slice(0, 10);
  same(functionSelector, toFunctionSelector(
    "executeApprovedAcquisition((address,uint256,address,uint256,uint64,uint8,uint8,address,address,address,uint256,uint256,address,uint256,uint256,uint16,uint64,uint64,bytes32,bytes32,bytes32),bytes,bytes)",
  ), "ENCODING_MISMATCH", "account execution selector");

  return freeze({
    schema: "GOGH_OWNER_DIRECT_FREE_MINT_EXECUTION_ARTIFACT_V1",
    status: "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED",
    generatedAt: String(nowSeconds),
    transaction: {
      chainId: ROBINHOOD.chainId,
      from: proposal.expectedOwner,
      to: proposal.account,
      value: "0",
      functionName: "executeApprovedAcquisition",
      functionSelector,
      data,
      dataKeccak256: keccak256(data),
    },
    reviewedAcquisition: {
      controllingPunk: {
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        tokenId: proposal.punkTokenId.toString(),
        account: proposal.account,
        currentOwner: proposal.expectedOwner,
      },
      target: {
        kind: "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter",
        adapter: proposal.adapter,
        venue: proposal.venue,
        collection: proposal.collection,
        mintSelector: ONE_SHOT_MINT_SELECTOR,
        tokenId: proposal.tokenId.toString(),
        amount: "1",
      },
      payment: {
        currency: ZERO_ADDRESS,
        expectedPrice: "0",
        maxPrice: "0",
        maxSlippageBps: "0",
        transactionValue: "0",
      },
      livePolicyBinding: {
        nonce: proposal.nonce.toString(),
        policyVersion: proposal.policyVersion.toString(),
        modeAttested: "APPROVAL_REQUIRED",
        permissionGeneration: "1",
        minimumNativeReserve: "0",
        maxIntentAgeSeconds: "120",
        ownerApprovedMintsAttested: true,
        approvalPurchasesAttested: true,
        autonomousPurchasesAttested: false,
        autonomousMintsAttested: false,
      },
      timing: {
        createdAt: proposal.createdAt.toString(),
        expiresAt: proposal.expiresAt.toString(),
        encodedAt: String(nowSeconds),
        remainingSeconds: attestation.remainingNow.toString(),
        minimumRequiredSeconds: MIN_OWNER_SUBMISSION_TTL_SECONDS,
      },
      intent: intentForJson(proposal),
      intentDigest: proposal.intentDigest,
      adapterData: EMPTY_BYTES,
      ownerSignature: EMPTY_BYTES,
    },
    confirmedEvidence: {
      status: "READ_ONLY_PASS",
      simulation: "READ_ONLY_ETH_CALL_PASS",
      pinnedBlock: {
        number: attestation.pinnedBlock.number.toString(),
        hash: attestation.pinnedBlock.hash,
        timestamp: attestation.pinnedBlock.timestamp.toString(),
        confirmations: attestation.pinnedBlock.confirmations,
      },
      latestExecutionCheck: {
        number: attestation.latestBlock.number.toString(),
        hash: attestation.latestBlock.hash,
        timestamp: attestation.latestBlock.timestamp.toString(),
        primaryHead: attestation.latestBlock.primaryHead.toString(),
        secondaryHead: attestation.latestBlock.secondaryHead.toString(),
        headSkew: attestation.latestBlock.headSkew.toString(),
        ownerType: "EOA_CURRENT_OWNER_ONLY",
        nonce: "0",
        policyVersion: "11",
        permissionGeneration: "1",
      },
      hashes: {
        proposal: proposal.proposalHash,
        proposalArtifact: proposal.artifactHash,
        liveAttestation: attestation.hash,
        coreManifest: core.hash,
        canaryManifest: canary.hash,
        coreSourceVerificationAdoption: core.sourceVerificationAdoptionSha256,
        canarySourceVerificationAdoption: canary.sourceVerificationAdoptionSha256,
        configBundleReviewKeccak256: config.bundle.bundleHash,
        configBundleArtifactSha256: config.bundleArtifactHash,
        configurationReceiptEvidenceSha256: config.evidence.evidenceHash,
        configurationReceiptEvidenceArtifactSha256: config.evidenceArtifactHash,
        intentDigest: proposal.intentDigest,
        adapterRuntimeCode: canary.adapter.runtimeBytecodeHash,
        venueRuntimeCode: canary.art.runtimeBytecodeHash,
        collectionRuntimeCode: canary.art.runtimeBytecodeHash,
        punkAccountRuntimeCode: canary.accountRuntimeCodeHash,
      },
      canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
      canonicalERC6551RegistryRuntimeCodeHash:
        ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
      sourceVerification: {
        status: "VERIFIED_ADOPTIONS_BOUND",
        coreAdoption: core.sourceVerificationAdoption,
        coreAdoptionSha256: core.sourceVerificationAdoptionSha256,
        canaryAdoption: canary.sourceVerificationAdoption,
        canaryAdoptionSha256: canary.sourceVerificationAdoptionSha256,
      },
      configurationHistory: {
        status: "EXACT_13_CALL_DUAL_RPC_VERIFIED",
        transactionCount: 13,
        preconfigurationBlock:
          config.evidence.evidence.preconfigurationBlock.number.toString(),
        finalPolicyVersion: "11",
        finalPermissionGeneration: "1",
        acquisitionNonce: "0",
        noOwnershipTransfersDuringEvidenceWindow:
          attestation.configurationHistory.noOwnershipTransfersFromPreconfigurationThroughLatest,
        noRelevantMutationsAfterPinnedBlock:
          attestation.configurationHistory.noRelevantMutationsAfterPinnedBlock,
      },
    },
    safetyBoundary: {
      postEncodingDecodeEqual: true,
      arbitraryCalldataAccepted: false,
      adapterDataPolicy: "EMPTY_ONLY",
      ownerSignaturePolicy: "EMPTY_OWNER_DIRECT_ONLY",
      agentRelayerUsed: false,
      transactionAuthorized: false,
      signingPerformed: false,
      submissionPerformed: false,
      rpcPerformed: false,
      deploymentPerformed: false,
      chainWritePerformed: false,
      instruction:
        "This EOA-current-owner artifact is encoding-only. Re-run the live preflight if any field, owner, nonce, policy, code hash, configuration receipt, block evidence, or expiry changes. The wallet must recheck the current owner, nonce, policy version, value, and expiry at submission; this artifact does not authorize submission.",
    },
  });
}

const EXECUTION_ARTIFACT_HASH_FIELDS = Object.freeze([
  "proposal", "proposalArtifact", "liveAttestation", "coreManifest", "canaryManifest",
  "coreSourceVerificationAdoption", "canarySourceVerificationAdoption",
  "configBundleReviewKeccak256", "configBundleArtifactSha256",
  "configurationReceiptEvidenceSha256", "configurationReceiptEvidenceArtifactSha256",
  "intentDigest", "adapterRuntimeCode", "venueRuntimeCode", "collectionRuntimeCode",
  "punkAccountRuntimeCode",
]);

/**
 * Strictly validate the final, encoding-only owner-direct artifact at a later handoff boundary.
 *
 * The primary builder above remains the authoritative proof that all upstream manifests and live
 * attestations agree. This validator is intentionally narrower: it makes sure an artifact handed
 * to a wallet-review surface is the exact canonical output shape, still live, zero-value,
 * owner-direct, and ABI-decode-equal. A caller must additionally bind the returned public fields
 * to its independently reviewed deployment manifest before publishing the artifact hash.
 */
export function validateOwnerDirectFreeMintExecutionArtifact(artifact, options = {}) {
  const snapshot = strictJsonSnapshot(artifact, "executionArtifact", 2_000_000);
  const optionSnapshot = strictJsonSnapshot(options, "options", 10_000);
  exactKeys(optionSnapshot, ["nowSeconds"], "options snapshot");
  const nowSeconds = uint(optionSnapshot.nowSeconds, "nowSeconds", { maximum: MAX_UINT64 });

  exactKeys(snapshot, [
    "schema", "status", "generatedAt", "transaction", "reviewedAcquisition",
    "confirmedEvidence", "safetyBoundary",
  ], "executionArtifact");
  if (snapshot.schema !== "GOGH_OWNER_DIRECT_FREE_MINT_EXECUTION_ARTIFACT_V1"
    || snapshot.status !== "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED") {
    fail("INVALID_EXECUTION_ARTIFACT", "execution artifact schema or status is invalid");
  }
  const generatedAt = uint(snapshot.generatedAt, "execution artifact generation time", {
    maximum: MAX_UINT64,
  });
  if (generatedAt > nowSeconds) {
    fail("STALE_ARTIFACT", "execution artifact is future-dated");
  }

  const transaction = snapshot.transaction;
  exactKeys(transaction, [
    "chainId", "from", "to", "value", "functionName", "functionSelector", "data",
    "dataKeccak256",
  ], "executionArtifact.transaction");
  same(transaction.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "transaction chain ID");
  const from = address(transaction.from, "transaction sender");
  const to = address(transaction.to, "transaction target");
  if (transaction.value !== "0" || transaction.functionName !== "executeApprovedAcquisition") {
    fail("FREE_MINT_ONLY", "transaction must be the zero-value approved-acquisition call");
  }
  const expectedFunctionSelector = toFunctionSelector(
    "executeApprovedAcquisition((address,uint256,address,uint256,uint64,uint8,uint8,address,address,address,uint256,uint256,address,uint256,uint256,uint16,uint64,uint64,bytes32,bytes32,bytes32),bytes,bytes)",
  );
  same(transaction.functionSelector, expectedFunctionSelector,
    "ENCODING_MISMATCH", "transaction function selector");
  if (typeof transaction.data !== "string" || !/^0x[0-9a-f]+$/.test(transaction.data)
    || transaction.data.length !== 1_610
    || !transaction.data.startsWith(expectedFunctionSelector)) {
    fail("ENCODING_MISMATCH", "transaction calldata is not the exact canonical ABI length");
  }
  const dataHash = bytes32(transaction.dataKeccak256, "transaction calldata hash");
  same(dataHash, keccak256(transaction.data), "ENCODING_MISMATCH", "transaction calldata hash");

  const reviewed = snapshot.reviewedAcquisition;
  exactKeys(reviewed, [
    "controllingPunk", "target", "payment", "livePolicyBinding", "timing", "intent",
    "intentDigest", "adapterData", "ownerSignature",
  ], "executionArtifact.reviewedAcquisition");
  exactKeys(reviewed.controllingPunk, [
    "chainId", "collection", "tokenId", "account", "currentOwner",
  ], "executionArtifact.reviewedAcquisition.controllingPunk");
  same(reviewed.controllingPunk.chainId, ROBINHOOD.chainId,
    "WRONG_CHAIN", "controlling Punk chain ID");
  same(address(reviewed.controllingPunk.collection, "controlling Punk collection"),
    ROBINHOOD.canonicalCollection, "NONCANONICAL_COLLECTION", "controlling Punk collection");
  const punkTokenId = uint(reviewed.controllingPunk.tokenId, "controlling Punk token ID");
  same(address(reviewed.controllingPunk.account, "reviewed Punk Account"), to,
    "CANARY_BINDING_MISMATCH", "reviewed Punk Account");
  same(address(reviewed.controllingPunk.currentOwner, "reviewed current owner"), from,
    "OWNER_MISMATCH", "reviewed current owner");

  exactKeys(reviewed.target, [
    "kind", "adapter", "venue", "collection", "mintSelector", "tokenId", "amount",
  ], "executionArtifact.reviewedAcquisition.target");
  if (reviewed.target.kind !== "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter") {
    fail("CANARY_BINDING_MISMATCH", "reviewed target is not the one-shot canary");
  }
  const adapter = address(reviewed.target.adapter, "reviewed adapter");
  const venue = address(reviewed.target.venue, "reviewed venue");
  const collection = address(reviewed.target.collection, "reviewed collection");
  same(venue, collection, "CANARY_BINDING_MISMATCH", "canary venue and collection");
  same(reviewed.target.mintSelector, ONE_SHOT_MINT_SELECTOR,
    "CANARY_BINDING_MISMATCH", "canary mint selector");
  const tokenId = uint(reviewed.target.tokenId, "reviewed output token ID");
  if (reviewed.target.amount !== "1") fail("FREE_MINT_ONLY", "reviewed amount must be one");

  exactKeys(reviewed.payment, [
    "currency", "expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue",
  ], "executionArtifact.reviewedAcquisition.payment");
  same(address(reviewed.payment.currency, "reviewed currency", { allowZero: true }), ZERO_ADDRESS,
    "FREE_MINT_ONLY", "reviewed currency");
  for (const field of ["expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue"]) {
    if (reviewed.payment[field] !== "0") {
      fail("FREE_MINT_ONLY", `reviewed payment ${field} must be zero`);
    }
  }

  exactKeys(reviewed.livePolicyBinding, [
    "nonce", "policyVersion", "modeAttested", "permissionGeneration",
    "minimumNativeReserve", "maxIntentAgeSeconds", "ownerApprovedMintsAttested",
    "approvalPurchasesAttested", "autonomousPurchasesAttested", "autonomousMintsAttested",
  ], "executionArtifact.reviewedAcquisition.livePolicyBinding");
  const policy = reviewed.livePolicyBinding;
  if (policy.nonce !== "0" || policy.policyVersion !== "11"
    || policy.modeAttested !== "APPROVAL_REQUIRED" || policy.permissionGeneration !== "1"
    || policy.minimumNativeReserve !== "0" || policy.maxIntentAgeSeconds !== "120"
    || policy.ownerApprovedMintsAttested !== true || policy.approvalPurchasesAttested !== true
    || policy.autonomousPurchasesAttested !== false || policy.autonomousMintsAttested !== false) {
    fail("POLICY_MISMATCH", "reviewed live policy is not the exact owner-only canary policy");
  }

  exactKeys(reviewed.timing, [
    "createdAt", "expiresAt", "encodedAt", "remainingSeconds", "minimumRequiredSeconds",
  ], "executionArtifact.reviewedAcquisition.timing");
  const createdAt = uint(reviewed.timing.createdAt, "reviewed creation time", {
    maximum: MAX_UINT64,
  });
  const expiresAt = uint(reviewed.timing.expiresAt, "reviewed expiry", { maximum: MAX_UINT64 });
  const encodedAt = uint(reviewed.timing.encodedAt, "reviewed encoding time", {
    maximum: MAX_UINT64,
  });
  if (createdAt > encodedAt || encodedAt !== generatedAt || expiresAt <= createdAt
    || expiresAt - createdAt > 120n
    || reviewed.timing.remainingSeconds !== (expiresAt - encodedAt).toString()
    || reviewed.timing.minimumRequiredSeconds !== MIN_OWNER_SUBMISSION_TTL_SECONDS
    || expiresAt < nowSeconds
    || expiresAt - nowSeconds < BigInt(MIN_OWNER_SUBMISSION_TTL_SECONDS)) {
    fail("STALE_ARTIFACT", "execution artifact lacks the safe owner submission margin");
  }

  const intent = reviewed.intent;
  exactKeys(intent, [
    "account", "chainId", "expectedOwner", "nonce", "policyVersion", "opportunityType",
    "opportunityTypeValue", "assetStandard", "assetStandardValue", "adapter", "venue",
    "collection", "tokenId", "assetAmount", "currency", "expectedPrice", "maxPrice",
    "maxSlippageBps", "createdAt", "expiresAt", "opportunityId", "reasoningHash",
    "adapterCodeHash", "adapterDataHash",
  ], "executionArtifact.reviewedAcquisition.intent");
  const intentDigest = bytes32(reviewed.intentDigest, "reviewed intent digest");
  const expectedIntent = {
    account: to,
    chainId: BigInt(ROBINHOOD.chainId),
    expectedOwner: from,
    nonce: 0n,
    policyVersion: 11n,
    opportunityType: 2,
    assetStandard: 0,
    adapter,
    venue,
    collection,
    tokenId,
    assetAmount: 1n,
    currency: ZERO_ADDRESS,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt,
    expiresAt,
    opportunityId: bytes32(intent.opportunityId, "intent opportunity ID"),
    reasoningHash: bytes32(intent.reasoningHash, "intent reasoning hash"),
    adapterCodeHash: bytes32(intent.adapterCodeHash, "intent adapter runtime hash"),
  };
  const intentExpectations = {
    account: to, chainId: String(ROBINHOOD.chainId), expectedOwner: from, nonce: "0",
    policyVersion: "11", opportunityType: "FREE_MINT", opportunityTypeValue: 2,
    assetStandard: "ERC721", assetStandardValue: 0, adapter, venue, collection,
    tokenId: tokenId.toString(), assetAmount: "1", currency: ZERO_ADDRESS,
    expectedPrice: "0", maxPrice: "0", maxSlippageBps: "0", createdAt: createdAt.toString(),
    expiresAt: expiresAt.toString(), opportunityId: expectedIntent.opportunityId,
    reasoningHash: expectedIntent.reasoningHash, adapterCodeHash: expectedIntent.adapterCodeHash,
    adapterDataHash: EMPTY_BYTES_HASH,
  };
  for (const [name, expected] of Object.entries(intentExpectations)) {
    same(intent[name], expected, "INTENT_MISMATCH", `reviewed intent.${name}`);
  }
  if (reviewed.adapterData !== EMPTY_BYTES || reviewed.ownerSignature !== EMPTY_BYTES) {
    fail("INVALID_EXECUTION_ARTIFACT", "owner-direct adapter data and signature must be empty");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: OWNER_DIRECT_ACQUISITION_ABI, data: transaction.data });
  } catch {
    fail("ENCODING_MISMATCH", "transaction calldata cannot be decoded canonically");
  }
  if (decoded.functionName !== "executeApprovedAcquisition" || decoded.args?.length !== 3
    || decoded.args[1] !== EMPTY_BYTES || decoded.args[2] !== EMPTY_BYTES) {
    fail("ENCODING_MISMATCH", "transaction calldata is not the owner-direct empty-data call");
  }
  assertDecodedIntent(decoded.args[0], expectedIntent);
  const reencoded = encodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    functionName: "executeApprovedAcquisition",
    args: decoded.args,
  }).toLowerCase();
  same(reencoded, transaction.data, "ENCODING_MISMATCH", "canonical transaction calldata");

  const evidence = snapshot.confirmedEvidence;
  exactKeys(evidence, [
    "status", "simulation", "pinnedBlock", "latestExecutionCheck", "hashes",
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
    "sourceVerification", "configurationHistory",
  ], "executionArtifact.confirmedEvidence");
  if (evidence.status !== "READ_ONLY_PASS" || evidence.simulation !== "READ_ONLY_ETH_CALL_PASS") {
    fail("INVALID_ATTESTATION", "execution artifact does not carry a read-only simulation pass");
  }
  exactKeys(evidence.pinnedBlock, ["number", "hash", "timestamp", "confirmations"],
    "executionArtifact.confirmedEvidence.pinnedBlock");
  uint(evidence.pinnedBlock.number, "evidence pinned block", { positive: true });
  bytes32(evidence.pinnedBlock.hash, "evidence pinned block hash");
  const pinnedTimestamp = uint(evidence.pinnedBlock.timestamp, "evidence pinned timestamp");
  if (!Number.isSafeInteger(evidence.pinnedBlock.confirmations)
    || evidence.pinnedBlock.confirmations < MIN_CONFIRMATIONS || pinnedTimestamp > generatedAt) {
    fail("UNCONFIRMED_ATTESTATION", "execution evidence lacks a confirmed pre-encoding pin");
  }
  exactKeys(evidence.latestExecutionCheck, [
    "number", "hash", "timestamp", "primaryHead", "secondaryHead", "headSkew", "ownerType",
    "nonce", "policyVersion", "permissionGeneration",
  ], "executionArtifact.confirmedEvidence.latestExecutionCheck");
  const latestTimestamp = uint(evidence.latestExecutionCheck.timestamp,
    "latest execution check timestamp");
  if (evidence.latestExecutionCheck.ownerType !== "EOA_CURRENT_OWNER_ONLY"
    || evidence.latestExecutionCheck.nonce !== "0"
    || evidence.latestExecutionCheck.policyVersion !== "11"
    || evidence.latestExecutionCheck.permissionGeneration !== "1"
    || uint(evidence.latestExecutionCheck.headSkew, "latest head skew") > 3n
    || latestTimestamp > generatedAt) {
    fail("STALE_ATTESTATION", "latest execution evidence is not the exact owner-direct state");
  }
  for (const field of ["number", "primaryHead", "secondaryHead"]) {
    uint(evidence.latestExecutionCheck[field], `latest execution ${field}`, { positive: true });
  }
  bytes32(evidence.latestExecutionCheck.hash, "latest execution block hash");
  exactKeys(evidence.hashes, EXECUTION_ARTIFACT_HASH_FIELDS,
    "executionArtifact.confirmedEvidence.hashes");
  for (const field of EXECUTION_ARTIFACT_HASH_FIELDS) {
    bytes32(evidence.hashes[field], `execution evidence ${field} hash`);
  }
  same(evidence.hashes.intentDigest, intentDigest,
    "DIGEST_MISMATCH", "execution evidence intent digest");
  same(evidence.hashes.adapterRuntimeCode, expectedIntent.adapterCodeHash,
    "CODE_HASH_MISMATCH", "execution evidence adapter code hash");
  same(evidence.hashes.venueRuntimeCode, evidence.hashes.collectionRuntimeCode,
    "CODE_HASH_MISMATCH", "execution evidence canary art code hashes");
  same(address(evidence.canonicalERC6551Registry, "evidence canonical ERC-6551 registry"),
    ROBINHOOD.canonicalERC6551Registry, "INFRASTRUCTURE_MISMATCH",
    "evidence canonical ERC-6551 registry");
  same(bytes32(evidence.canonicalERC6551RegistryRuntimeCodeHash,
    "evidence canonical ERC-6551 runtime hash"), ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
  "INFRASTRUCTURE_MISMATCH", "evidence canonical ERC-6551 runtime hash");
  exactKeys(evidence.sourceVerification, [
    "status", "coreAdoption", "coreAdoptionSha256", "canaryAdoption", "canaryAdoptionSha256",
  ], "executionArtifact.confirmedEvidence.sourceVerification");
  if (evidence.sourceVerification.status !== "VERIFIED_ADOPTIONS_BOUND") {
    fail("SOURCE_VERIFICATION_NOT_ADOPTED", "execution evidence source verification is not bound");
  }
  const coreAdoption = validateSourceVerificationAdoption(
    evidence.sourceVerification.coreAdoption,
    { expectedContracts: CORE_CONTRACTS },
  );
  const canaryAdoption = validateSourceVerificationAdoption(
    evidence.sourceVerification.canaryAdoption,
    { expectedContracts: ["GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter"] },
  );
  same(sourceVerificationCanonicalSha256(coreAdoption),
    bytes32(evidence.sourceVerification.coreAdoptionSha256, "core adoption hash"),
    "SOURCE_VERIFICATION_HASH_MISMATCH", "core source-verification adoption");
  same(sourceVerificationCanonicalSha256(canaryAdoption),
    bytes32(evidence.sourceVerification.canaryAdoptionSha256, "canary adoption hash"),
    "SOURCE_VERIFICATION_HASH_MISMATCH", "canary source-verification adoption");
  same(evidence.sourceVerification.coreAdoptionSha256,
    evidence.hashes.coreSourceVerificationAdoption,
    "SOURCE_VERIFICATION_HASH_MISMATCH", "core adoption evidence hash");
  same(evidence.sourceVerification.canaryAdoptionSha256,
    evidence.hashes.canarySourceVerificationAdoption,
    "SOURCE_VERIFICATION_HASH_MISMATCH", "canary adoption evidence hash");
  exactKeys(evidence.configurationHistory, [
    "status", "transactionCount", "preconfigurationBlock", "finalPolicyVersion",
    "finalPermissionGeneration", "acquisitionNonce", "noOwnershipTransfersDuringEvidenceWindow",
    "noRelevantMutationsAfterPinnedBlock",
  ], "executionArtifact.confirmedEvidence.configurationHistory");
  const history = evidence.configurationHistory;
  if (history.status !== "EXACT_13_CALL_DUAL_RPC_VERIFIED" || history.transactionCount !== 13
    || history.finalPolicyVersion !== "11" || history.finalPermissionGeneration !== "1"
    || history.acquisitionNonce !== "0" || history.noOwnershipTransfersDuringEvidenceWindow !== true
    || history.noRelevantMutationsAfterPinnedBlock !== true) {
    fail("CONFIGURATION_HISTORY_MISMATCH", "execution configuration history is not exact");
  }
  uint(history.preconfigurationBlock, "configuration prestate block", { positive: true });

  const safety = snapshot.safetyBoundary;
  exactKeys(safety, [
    "postEncodingDecodeEqual", "arbitraryCalldataAccepted", "adapterDataPolicy",
    "ownerSignaturePolicy", "agentRelayerUsed", "transactionAuthorized", "signingPerformed",
    "submissionPerformed", "rpcPerformed", "deploymentPerformed", "chainWritePerformed",
    "instruction",
  ], "executionArtifact.safetyBoundary");
  if (safety.postEncodingDecodeEqual !== true || safety.arbitraryCalldataAccepted !== false
    || safety.adapterDataPolicy !== "EMPTY_ONLY"
    || safety.ownerSignaturePolicy !== "EMPTY_OWNER_DIRECT_ONLY"
    || safety.agentRelayerUsed !== false || safety.transactionAuthorized !== false
    || safety.signingPerformed !== false || safety.submissionPerformed !== false
    || safety.rpcPerformed !== false || safety.deploymentPerformed !== false
    || safety.chainWritePerformed !== false || typeof safety.instruction !== "string"
    || safety.instruction.length < 40 || safety.instruction.length > 2_000) {
    fail("INVALID_EXECUTION_ARTIFACT", "execution artifact safety boundary is invalid");
  }

  return freeze({
    artifactSha256: canonicalSha256(snapshot),
    chainId: ROBINHOOD.chainId,
    expectedOwner: from,
    account: to,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: punkTokenId.toString(),
    adapter,
    venue,
    collection,
    tokenId: tokenId.toString(),
    mintSelector: ONE_SHOT_MINT_SELECTOR,
    functionSelector: expectedFunctionSelector,
    value: "0",
    dataKeccak256: dataHash,
    intentDigest,
    accountRuntimeCodeHash: evidence.hashes.punkAccountRuntimeCode,
    adapterRuntimeCodeHash: evidence.hashes.adapterRuntimeCode,
    artRuntimeCodeHash: evidence.hashes.venueRuntimeCode,
    coreManifestSha256: evidence.hashes.coreManifest,
    canaryManifestSha256: evidence.hashes.canaryManifest,
    nonce: "0",
    policyVersion: "11",
    expiresAt: expiresAt.toString(),
  });
}
