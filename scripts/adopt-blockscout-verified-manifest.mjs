import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { O_NOFOLLOW, O_RDONLY } from "node:constants";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  stringToBytes,
} from "viem";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import {
  SOURCE_VERIFICATION_ADOPTION_SCHEMA,
  SOURCE_VERIFICATION_GATE_SCHEMA,
  SOURCE_VERIFICATION_GATE_VERSION,
  validateSourceVerificationAdoption,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

export const ROBINHOOD_CHAIN_ID = 4663;
export const BLOCKSCOUT_ORIGIN = "https://robinhoodchain.blockscout.com";
export const SOURCIFY_ORIGIN = "https://sourcify.dev";
export const BLOCKSCOUT_SMART_CONTRACT_DOCUMENTATION =
  "https://docs.blockscout.com/api-reference/get-smart-contract";
export const BLOCKSCOUT_ADDRESS_DOCUMENTATION =
  "https://docs.blockscout.com/api-reference/get-address-info";
export const SOURCIFY_DOCUMENTATION =
  "https://docs.sourcify.dev/docs/api/";
export const CORE_CONTRACT_NAMES = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
export const CANARY_CONTRACT_NAMES = Object.freeze([
  "GoghOneShotCanaryArt",
  "GoghOneShotCanaryMintAdapter",
]);

const COMPILER_VERSION = "0.8.34+commit.80d5c536";
const BLOCKSCOUT_COMPILER_VERSION = `v${COMPILER_VERSION}`;
const EVM_VERSION = "cancun";
const OPTIMIZER_RUNS = 500;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_FILES = 512;
const MAX_BYTECODE_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 20_000;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FOUNDRY_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const CANONICAL_COLLECTION = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
const CANONICAL_ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const SOURCE_PATHS = Object.freeze({
  ArtAdapterRegistry: "contracts/src/ArtAdapterRegistry.sol",
  ArtAgentRegistry: "contracts/src/ArtAgentRegistry.sol",
  BrokerPolicyModule: "contracts/src/BrokerPolicyModule.sol",
  GoghPunkAccountV1: "contracts/src/GoghPunkAccountV1.sol",
  GoghPunkAccountRegistry: "contracts/src/GoghPunkAccountRegistry.sol",
  GoghOneShotCanaryArt: "contracts/src/canary/GoghOneShotCanaryArt.sol",
  GoghOneShotCanaryMintAdapter:
    "contracts/src/adapters/GoghOneShotCanaryMintAdapter.sol",
});
const ARTIFACT_PATHS = Object.freeze(Object.fromEntries(
  [...CORE_CONTRACT_NAMES, ...CANARY_CONTRACT_NAMES].map((name) => [
    name,
    `contracts/out/${name}.sol/${name}.json`,
  ]),
));
const SAFE_FEATURE_FLAGS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});
const VERIFIED_MANIFEST_NOTES = Object.freeze({
  core: "Immutable VERIFIED core deployment manifest proposal. The original complete deployment proposal remains bound by canonical SHA-256. Robinhood Blockscout supplied exact unchanged non-twin source, compiler, ABI, bytecode, constructor, deployer, and receipt evidence; direct Sourcify evidence independently reported exact creation and runtime full matches for every protocol contract. Blockscout partial-match labels are accepted only with that exact Sourcify full match and the clean offline build/live deployment bindings. This read-only gate signed, sent, enabled, and wrote nothing.",
  canary: "Immutable VERIFIED canary deployment and clean-preconfiguration manifest proposal. The original source-verification-pending canary proposal remains bound by canonical SHA-256. Robinhood Blockscout supplied exact unchanged non-twin source, compiler, ABI, bytecode, constructor, deployer, and receipt evidence; direct Sourcify evidence independently reported exact creation and runtime full matches for both canary contracts. Blockscout partial-match labels are accepted only with that exact Sourcify full match and the clean offline build/live deployment bindings. This historical snapshot must not be mutated after configuration. This read-only gate signed, sent, enabled, and wrote nothing.",
});
const projectRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

export class SourceVerificationGateError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SourceVerificationGateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SourceVerificationGateError(code, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) {
    fail("INVALID_SCHEMA", `${label} contains a symbol key`);
  }
  const expected = [...keys].sort();
  const sorted = [...actual].sort();
  if (sorted.length !== expected.length
    || sorted.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} has an unexpected key set`);
  }
}

function requireOwn(value, keys, label) {
  plainObject(value, label);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail("MISSING_EVIDENCE", `${label}.${key} is missing`);
  }
}

function strictSnapshot(value, maximum, label) {
  let snapshot;
  try {
    const original = canonicalJson(value);
    if (Buffer.byteLength(original, "utf8") > maximum) {
      fail("INPUT_TOO_LARGE", `${label} exceeds the size limit`);
    }
    snapshot = structuredClone(value);
    const serialized = canonicalJson(snapshot);
    if (Buffer.byteLength(serialized, "utf8") > maximum) {
      fail("INPUT_TOO_LARGE", `${label} exceeds the size limit`);
    }
  } catch (error) {
    if (error instanceof SourceVerificationGateError) throw error;
    fail("INVALID_SCHEMA", `${label} is not strict JSON`);
  }
  return snapshot;
}

function sha256Text(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value) {
  return sha256Text(canonicalJson(value));
}

function sameCanonical(actual, expected, code, label) {
  let actualJson;
  let expectedJson;
  try {
    actualJson = canonicalJson(actual);
    expectedJson = canonicalJson(expected);
  } catch {
    fail("INVALID_SCHEMA", `${label} is not strict JSON`);
  }
  if (actualJson !== expectedJson) fail(code, `${label} does not match`);
}

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} is not a strict EVM address`);
  }
  return getAddress(value);
}

function normalizeHash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    fail("INVALID_HASH", `${label} is not a bytes32 hash`);
  }
  return value.toLowerCase();
}

function normalizeTransactionHash(value, label) {
  if (typeof value !== "string" || !TX_HASH_PATTERN.test(value)) {
    fail("INVALID_TRANSACTION", `${label} is not a transaction hash`);
  }
  return value.toLowerCase();
}

function normalizeCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    fail("INVALID_COMMIT", `${label} must be a full lowercase git commit`);
  }
  return value;
}

function normalizeFoundryCommit(value, label) {
  if (typeof value !== "string" || !FOUNDRY_COMMIT_PATTERN.test(value)) {
    fail("INVALID_COMMIT", `${label} must be a lowercase abbreviated or full git commit`);
  }
  return value;
}

function normalizeBytecode(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    fail("INVALID_BYTECODE", `${label} is not nonempty even-length bytecode`);
  }
  if ((value.length - 2) / 2 > MAX_BYTECODE_BYTES) {
    fail("INPUT_TOO_LARGE", `${label} exceeds the bytecode limit`);
  }
  return value.toLowerCase();
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_SCHEMA", `${label} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_SCHEMA", `${label} must be a nonnegative safe integer`);
  }
  return value;
}

function normalizeHexData(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    fail("INVALID_BYTECODE", `${label} is not even-length hex data`);
  }
  if ((value.length - 2) / 2 > MAX_BYTECODE_BYTES) {
    fail("INPUT_TOO_LARGE", `${label} exceeds the byte limit`);
  }
  return value.toLowerCase();
}

function normalizeSourceHashMap(value, label, maximum = MAX_SOURCE_FILES) {
  plainObject(value, label);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length > maximum) {
    fail("SOURCE_IDENTITY_MISMATCH", `${label} has an invalid source count`);
  }
  const normalized = {};
  for (const path of [...keys].sort()) {
    const safePath = safeSourcePath(path);
    normalized[safePath] = normalizeHash(value[path], `${label}.${safePath}`);
  }
  sameCanonical(value, normalized, "SOURCE_IDENTITY_MISMATCH", label);
  return normalized;
}

function validateTimestamp(value, label, observedAtMs) {
  if (typeof value !== "string" || value.length > 64) {
    fail("INVALID_VERIFICATION_TIME", `${label} is invalid`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > observedAtMs + 5 * 60_000) {
    fail("INVALID_VERIFICATION_TIME", `${label} is invalid or in the future`);
  }
  return new Date(timestamp).toISOString();
}

function validateChain(chain) {
  exactKeys(chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "manifest.chain");
  if (chain.name !== "Robinhood Chain" || chain.chainId !== ROBINHOOD_CHAIN_ID
    || chain.rpcEnvironmentVariable !== "ROBINHOOD_RPC_URL"
    || chain.explorer !== BLOCKSCOUT_ORIGIN || chain.nativeCurrency !== "ETH") {
    fail("CHAIN_BINDING_MISMATCH", "pending proposal is not bound to canonical Robinhood Chain");
  }
}

function validateSourceProvenance(value, kind, releaseCommit, foundryCommit) {
  const cleanKey = kind === "core" ? "compilerInputsClean" : "fullWorktreeClean";
  exactKeys(value, [
    "releaseGitCommit", "headCommit", "artifactResolvedCommit", "foundryArtifactCommit",
    cleanKey, "offlineBuildCompleted", "offlineBuildCommand",
  ], "pendingProposal.trustBindings.sourceProvenance");
  for (const key of ["releaseGitCommit", "headCommit", "artifactResolvedCommit"]) {
    if (normalizeCommit(value[key], `sourceProvenance.${key}`) !== releaseCommit) {
      fail("BUILD_BINDING_MISMATCH", `sourceProvenance.${key} differs from the release commit`);
    }
  }
  if (normalizeFoundryCommit(value.foundryArtifactCommit, "sourceProvenance commit")
      !== foundryCommit
    || !releaseCommit.startsWith(foundryCommit)
    || value[cleanKey] !== true || value.offlineBuildCompleted !== true) {
    fail("BUILD_BINDING_MISMATCH", "pending proposal lacks clean offline build provenance");
  }
  sameCanonical(value.offlineBuildCommand, ["forge", "build", "--offline", "--force"],
    "BUILD_BINDING_MISMATCH", "offline build command");
}

function validateContractRecord(record, name, kind, releaseCommit) {
  const common = [
    "address", "deploymentTransaction", "deploymentBlock", "deployer",
    "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    "verificationStatus",
  ];
  exactKeys(record, kind === "core"
    ? [...common, "implementationVersion"]
    : [
      "address", "deploymentTransaction", "deploymentBlock", "deploymentBlockHash",
      "receiptStatus", "confirmationsRequired", "confirmationsObserved", "deployer",
      "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
      "verificationStatus",
    ], `manifest.contracts.${name}`);
  const normalized = {
    address: normalizeAddress(record.address, `${name} address`),
    deploymentTransaction: normalizeTransactionHash(
      record.deploymentTransaction,
      `${name} deployment transaction`,
    ),
    deploymentBlock: positiveSafeInteger(record.deploymentBlock, `${name} deployment block`),
    deployer: normalizeAddress(record.deployer, `${name} deployer`),
    creationBytecodeHash: normalizeHash(record.creationBytecodeHash, `${name} creation hash`),
    runtimeBytecodeHash: normalizeHash(record.runtimeBytecodeHash, `${name} runtime hash`),
  };
  if (!Array.isArray(record.constructorArguments) || record.constructorArguments.length > 32) {
    fail("INVALID_SCHEMA", `${name} constructor arguments are invalid`);
  }
  if (normalizeCommit(record.gitCommit, `${name} git commit`) !== releaseCommit
    || record.verificationStatus !== "NOT_SUBMITTED") {
    fail("NOT_SOURCE_VERIFICATION_PENDING", `${name} is not an unadopted release contract`);
  }
  if (kind === "core" && record.implementationVersion !== "1") {
    fail("BUILD_BINDING_MISMATCH", `${name} implementation version is not v1`);
  }
  if (kind === "canary") {
    normalizeHash(record.deploymentBlockHash, `${name} deployment block hash`);
    if (record.receiptStatus !== "SUCCESS" || record.confirmationsRequired !== 20
      || !Number.isSafeInteger(record.confirmationsObserved)
      || record.confirmationsObserved < record.confirmationsRequired) {
      fail("DEPLOYMENT_EVIDENCE_MISMATCH", `${name} deployment receipt is not final`);
    }
  }
  return normalized;
}

function validateCorePendingProposal(proposal) {
  exactKeys(proposal, ["schema", "proposalStatus", "trustBindings", "manifest"],
    "pendingProposal");
  if (proposal.schema !== "GOGH_ROBINHOOD_DEPLOYMENT_MANIFEST_PROPOSAL_V2"
    || proposal.proposalStatus !== "COMPLETE_MANIFEST_PROPOSAL") {
    fail("WRONG_PENDING_PROPOSAL", "core input is not the canonical pending proposal schema");
  }
  const manifest = plainObject(proposal.manifest, "pendingProposal.manifest");
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "verifiedExternalInfrastructure", "accountSalt",
    "gitCommit", "compiler", "evmVersion", "optimizerRuns", "contracts", "featureFlags",
    "sourceVerificationAdoption", "protocolGuardian", "notes",
  ], "pendingProposal.manifest");
  validateChain(manifest.chain);
  if (manifest.status !== "DEPLOYED" || manifest.compiler !== "0.8.34"
    || manifest.evmVersion !== EVM_VERSION || manifest.optimizerRuns !== OPTIMIZER_RUNS
    || manifest.sourceVerificationAdoption !== null) {
    fail("BUILD_BINDING_MISMATCH", "core manifest compiler/deployment binding is wrong");
  }
  if (normalizeAddress(manifest.canonicalCollection, "canonical collection")
      !== CANONICAL_COLLECTION
    || normalizeAddress(manifest.canonicalERC6551Registry, "canonical ERC-6551 registry")
      !== CANONICAL_ERC6551_REGISTRY
    || normalizeHash(
      manifest.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical ERC-6551 registry runtime hash",
    ) !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail("CHAIN_BINDING_MISMATCH", "core manifest canonical identity is wrong");
  }
  sameCanonical(manifest.featureFlags, SAFE_FEATURE_FLAGS, "UNSAFE_MANIFEST",
    "core feature flags");
  normalizeAddress(manifest.protocolGuardian, "protocol guardian");
  const releaseCommit = normalizeCommit(manifest.gitCommit, "core manifest git commit");
  exactKeys(manifest.contracts, CORE_CONTRACT_NAMES, "core manifest contracts");

  const trust = proposal.trustBindings;
  exactKeys(trust, [
    "chainId", "releaseGitCommit", "foundryArtifactCommit", "sourceProvenance",
    "commonPinnedBlock", "distinctReadEndpointOrigins", "providerIndependence",
    "guardianAuthority", "canonicalERC6551Registry", "criticalImmutableBindings",
    "compiledContracts",
  ], "pendingProposal.trustBindings");
  const foundryCommit = normalizeFoundryCommit(
    trust.foundryArtifactCommit,
    "Foundry artifact commit",
  );
  if (trust.chainId !== ROBINHOOD_CHAIN_ID
    || normalizeCommit(trust.releaseGitCommit, "trust release commit") !== releaseCommit) {
    fail("BUILD_BINDING_MISMATCH", "core proposal trust binding differs from its manifest");
  }
  validateSourceProvenance(trust.sourceProvenance, "core", releaseCommit, foundryCommit);
  exactKeys(trust.compiledContracts, CORE_CONTRACT_NAMES, "compiled core contracts");
  const records = Object.fromEntries(CORE_CONTRACT_NAMES.map((name) => [
    name,
    validateContractRecord(manifest.contracts[name], name, "core", releaseCommit),
  ]));
  return { manifest, trust, releaseCommit, foundryCommit, records };
}

function validateCanaryPendingProposal(proposal) {
  exactKeys(proposal, ["schema", "proposalStatus", "trustBindings", "manifest"],
    "pendingProposal");
  if (proposal.schema !== "GOGH_ROBINHOOD_CANARY_DEPLOYMENT_MANIFEST_PROPOSAL_V1"
    || proposal.proposalStatus
      !== "CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING") {
    fail("WRONG_PENDING_PROPOSAL", "canary input is not the canonical pending proposal schema");
  }
  const manifest = plainObject(proposal.manifest, "pendingProposal.manifest");
  exactKeys(manifest, [
    "status", "chain", "coreDeploymentManifest", "coreDeploymentManifestStatusRequired",
    "coreDeploymentManifestGitCommit", "coreDeploymentManifestSha256",
    "coreGoghPunkAccountRegistry", "coreGoghPunkAccountRegistryRuntimeCodeHash",
    "coreGoghPunkAccountImplementation", "coreGoghPunkAccountImplementationRuntimeCodeHash",
    "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "controllingPunkTokenId",
    "expectedActivatedPunkAccount", "expectedActivatedPunkAccountRuntimeCodeHash",
    "expectedOwnerAtPreparation", "canaryArtTokenId", "gitCommit", "compiler", "evmVersion",
    "optimizerRuns", "contracts", "provenanceGate", "ownerObservations", "configuration",
    "sourceVerificationAdoption", "notes",
  ], "pendingProposal.manifest");
  validateChain(manifest.chain);
  if (manifest.status !== "DEPLOYED" || manifest.compiler !== "0.8.34"
    || manifest.evmVersion !== EVM_VERSION || manifest.optimizerRuns !== OPTIMIZER_RUNS
    || manifest.coreDeploymentManifest !== "deployments/robinhood.json"
    || manifest.coreDeploymentManifestStatusRequired !== "DEPLOYED"
    || manifest.provenanceGate?.status !== "VERIFIED"
    || manifest.sourceVerificationAdoption !== null) {
    fail("BUILD_BINDING_MISMATCH", "canary deployment/provenance binding is wrong");
  }
  if (normalizeAddress(manifest.canonicalCollection, "canonical collection")
      !== CANONICAL_COLLECTION
    || normalizeAddress(manifest.canonicalERC6551Registry, "canonical ERC-6551 registry")
      !== CANONICAL_ERC6551_REGISTRY
    || normalizeHash(
      manifest.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical ERC-6551 registry runtime hash",
    ) !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail("CHAIN_BINDING_MISMATCH", "canary manifest canonical identity is wrong");
  }
  const releaseCommit = normalizeCommit(manifest.gitCommit, "canary manifest git commit");
  if (normalizeCommit(manifest.coreDeploymentManifestGitCommit, "core manifest git commit")
    !== releaseCommit) {
    fail("BUILD_BINDING_MISMATCH", "canary and core release commits differ");
  }
  normalizeHash(manifest.coreDeploymentManifestSha256, "core manifest hash");
  exactKeys(manifest.contracts, CANARY_CONTRACT_NAMES, "canary manifest contracts");
  exactKeys(manifest.configuration, [
    "deploymentAuthorized", "broadcastAttempted", "adapterRegistered", "policyConfigured",
    "ownerApprovedMintsEnabled", "agentAuthorized", "approvalPurchasesEnabled",
    "autonomousPurchasesEnabled", "autonomousMintsEnabled", "mintExecuted",
  ], "canary configuration");
  if (manifest.configuration.deploymentAuthorized !== true
    || manifest.configuration.broadcastAttempted !== true
    || Object.entries(manifest.configuration).some(([key, value]) => (
      !["deploymentAuthorized", "broadcastAttempted"].includes(key) && value !== false
    ))) fail("UNSAFE_MANIFEST", "canary manifest is not a clean preconfiguration snapshot");

  const trust = proposal.trustBindings;
  exactKeys(trust, [
    "chainId", "releaseGitCommit", "foundryArtifactCommit", "sourceProvenance",
    "authoritativeCoreManifest", "deploymentOrder", "commonConfirmedBlock", "rpcOrigins",
    "providerIndependence", "contractEvidence", "blockscoutSourceVerification",
    "immutableBindings", "accountIdentity", "cleanPreconfigurationStateHash",
    "immutableSnapshotSemantics", "transactionCapability",
  ], "pendingProposal.trustBindings");
  const foundryCommit = normalizeFoundryCommit(
    trust.foundryArtifactCommit,
    "Foundry artifact commit",
  );
  if (trust.chainId !== ROBINHOOD_CHAIN_ID
    || normalizeCommit(trust.releaseGitCommit, "trust release commit") !== releaseCommit
    || trust.blockscoutSourceVerification !== "NOT_SUBMITTED"
    || trust.immutableSnapshotSemantics !== true
    || trust.transactionCapability !== "NONE_READ_ONLY_PROPOSAL") {
    fail("BUILD_BINDING_MISMATCH", "canary proposal trust binding is wrong");
  }
  sameCanonical(trust.deploymentOrder, CANARY_CONTRACT_NAMES, "BUILD_BINDING_MISMATCH",
    "canary deployment order");
  validateSourceProvenance(trust.sourceProvenance, "canary", releaseCommit, foundryCommit);
  exactKeys(trust.contractEvidence, CANARY_CONTRACT_NAMES, "canary contract evidence");
  const records = Object.fromEntries(CANARY_CONTRACT_NAMES.map((name) => [
    name,
    validateContractRecord(manifest.contracts[name], name, "canary", releaseCommit),
  ]));
  return { manifest, trust, releaseCommit, foundryCommit, records };
}

function normalizePendingProposal(kind, value) {
  if (kind !== "core" && kind !== "canary") {
    fail("INVALID_KIND", "kind must be core or canary");
  }
  const proposal = strictSnapshot(value, MAX_INPUT_BYTES, "pending proposal");
  const normalized = kind === "core"
    ? validateCorePendingProposal(proposal)
    : validateCanaryPendingProposal(proposal);
  return { proposal, ...normalized };
}

function normalizeCompilerSettings(settings, label) {
  plainObject(settings, label);
  const allowedSettings = new Set([
    "compilationTarget", "evmVersion", "libraries", "metadata", "optimizer", "remappings",
    "viaIR", "outputSelection",
  ]);
  for (const key of Reflect.ownKeys(settings)) {
    if (typeof key !== "string" || !allowedSettings.has(key)) {
      fail("COMPILER_SETTINGS_MISMATCH", `${label} contains an unsupported setting`);
    }
  }
  requireOwn(settings, [
    "compilationTarget", "evmVersion", "libraries", "metadata", "optimizer", "remappings",
    "viaIR",
  ], label);
  plainObject(settings.compilationTarget, `${label}.compilationTarget`);
  plainObject(settings.libraries, `${label}.libraries`);
  plainObject(settings.metadata, `${label}.metadata`);
  plainObject(settings.optimizer, `${label}.optimizer`);
  const allowedMetadata = new Set(["bytecodeHash", "appendCBOR", "useLiteralContent"]);
  for (const key of Reflect.ownKeys(settings.metadata)) {
    if (typeof key !== "string" || !allowedMetadata.has(key)) {
      fail("COMPILER_SETTINGS_MISMATCH", `${label}.metadata contains an unsupported setting`);
    }
  }
  exactKeys(settings.optimizer, ["enabled", "runs"], `${label}.optimizer`);
  if (!Array.isArray(settings.remappings)) fail("MISSING_EVIDENCE", `${label}.remappings is missing`);
  if (settings.evmVersion !== EVM_VERSION || settings.viaIR !== true
    || settings.optimizer.enabled !== true || settings.optimizer.runs !== OPTIMIZER_RUNS
    || settings.metadata.bytecodeHash !== "none"
    || (Object.hasOwn(settings.metadata, "appendCBOR")
      && settings.metadata.appendCBOR !== true)
    || (Object.hasOwn(settings.metadata, "useLiteralContent")
      && settings.metadata.useLiteralContent !== false)) {
    fail("COMPILER_SETTINGS_MISMATCH", `${label} is not the canonical release configuration`);
  }
  const remappings = settings.remappings.map((value) => {
    if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
      fail("COMPILER_SETTINGS_MISMATCH", `${label}.remappings contains an invalid entry`);
    }
    return value.startsWith(":") ? value.slice(1) : value;
  });
  return strictSnapshot({
    compilationTarget: settings.compilationTarget,
    evmVersion: settings.evmVersion,
    libraries: settings.libraries,
    metadata: { bytecodeHash: settings.metadata.bytecodeHash },
    optimizer: settings.optimizer,
    remappings,
    viaIR: settings.viaIR,
  }, MAX_INPUT_BYTES, label);
}

function normalizeArtifact(name, artifact, pending) {
  exactKeys(artifact, [
    "abi", "bytecode", "deployedBytecode", "methodIdentifiers", "rawMetadata", "metadata", "id",
  ], `${name} compiled artifact`);
  if (!Array.isArray(artifact.abi) || artifact.abi.length > 2_000) {
    fail("INVALID_COMPILED_ARTIFACT", `${name} ABI is invalid`);
  }
  requireOwn(artifact.bytecode, ["object", "linkReferences"], `${name}.bytecode`);
  requireOwn(
    artifact.deployedBytecode,
    ["object", "linkReferences"],
    `${name}.deployedBytecode`,
  );
  if (canonicalJson(artifact.bytecode.linkReferences) !== "{}"
    || canonicalJson(artifact.deployedBytecode.linkReferences) !== "{}") {
    fail("UNRESOLVED_LIBRARY_LINK", `${name} contains unresolved library links`);
  }
  const creationBytecode = normalizeBytecode(artifact.bytecode.object, `${name} creation bytecode`);
  const deployedBytecode = normalizeBytecode(
    artifact.deployedBytecode.object,
    `${name} deployed bytecode template`,
  );
  let metadata;
  try {
    if (typeof artifact.rawMetadata !== "string"
      || Buffer.byteLength(artifact.rawMetadata, "utf8") > MAX_INPUT_BYTES) throw new Error();
    metadata = strictSnapshot(JSON.parse(artifact.rawMetadata), MAX_INPUT_BYTES, `${name} metadata`);
  } catch (error) {
    if (error instanceof SourceVerificationGateError) throw error;
    fail("INVALID_COMPILED_ARTIFACT", `${name} raw metadata is invalid`);
  }
  requireOwn(metadata, ["compiler", "language", "settings", "sources"], `${name} metadata`);
  if (metadata.compiler?.version !== COMPILER_VERSION || metadata.language !== "Solidity") {
    fail("COMPILER_SETTINGS_MISMATCH", `${name} compiler identity is wrong`);
  }
  const settings = normalizeCompilerSettings(metadata.settings, `${name} metadata settings`);
  const expectedPath = SOURCE_PATHS[name];
  sameCanonical(settings.compilationTarget, { [expectedPath]: name },
    "COMPILER_SETTINGS_MISMATCH", `${name} compilation target`);
  const sources = plainObject(metadata.sources, `${name} metadata sources`);
  const sourcePaths = Object.keys(sources).sort();
  if (sourcePaths.length === 0 || sourcePaths.length > MAX_SOURCE_FILES
    || !sourcePaths.includes(expectedPath)) {
    fail("SOURCE_IDENTITY_MISMATCH", `${name} metadata source set is invalid`);
  }
  const sourceHashes = Object.fromEntries(sourcePaths.map((path) => {
    requireOwn(sources[path], ["keccak256"], `${name} source ${path}`);
    return [path, normalizeHash(sources[path].keccak256, `${name} source ${path} hash`)];
  }));
  const creationHash = keccak256(creationBytecode).toLowerCase();
  if (creationHash !== pending.record.creationBytecodeHash) {
    fail("BYTECODE_BINDING_MISMATCH", `${name} artifact creation code differs from manifest`);
  }
  const compiledEvidence = pending.compiledEvidence;
  if (normalizeHash(compiledEvidence.creationHash, `${name} compiled creation evidence`)
    !== creationHash
    || normalizeHash(compiledEvidence.templateHash, `${name} compiled runtime template evidence`)
      !== keccak256(deployedBytecode).toLowerCase()) {
    fail("BUILD_BINDING_MISMATCH", `${name} artifact differs from pending build evidence`);
  }
  for (const [field, actual] of [
    ["rawMetadataSha256", sha256Text(artifact.rawMetadata)],
    ["sourceSetSha256", canonicalSha256(sourceHashes)],
    ["compilerSettingsSha256", canonicalSha256(metadata.settings)],
    ["abiSha256", canonicalSha256(artifact.abi)],
  ]) {
    if (normalizeHash(compiledEvidence[field], `${name} ${field}`) !== actual) {
      fail("BUILD_BINDING_MISMATCH", `${name} ${field} differs from pending build evidence`);
    }
  }
  const constructors = artifact.abi.filter((item) => item?.type === "constructor");
  if (constructors.length !== 1 || !Array.isArray(constructors[0].inputs)
    || constructors[0].inputs.length !== pending.constructorArguments.length) {
    fail("CONSTRUCTOR_BINDING_MISMATCH", `${name} constructor ABI differs from manifest`);
  }
  let constructorArguments;
  try {
    constructorArguments = encodeAbiParameters(
      constructors[0].inputs,
      pending.constructorArguments,
    ).toLowerCase();
  } catch {
    fail("CONSTRUCTOR_BINDING_MISMATCH", `${name} constructor arguments cannot be encoded`);
  }
  return {
    name,
    expectedPath,
    abi: artifact.abi,
    abiSha256: canonicalSha256(artifact.abi),
    creationBytecode,
    creationHash,
    deployedBytecode,
    settings,
    settingsSha256: canonicalSha256(metadata.settings),
    sourceHashes,
    sourceSetSha256: canonicalSha256(sourceHashes),
    rawMetadataSha256: sha256Text(artifact.rawMetadata),
    constructorArguments,
    deploymentInitcode: `${creationBytecode}${constructorArguments.slice(2)}`,
  };
}

function compiledEvidenceFor(kind, trust, name) {
  if (kind === "core") {
    exactKeys(trust.compiledContracts[name], [
      "creationBytecodeHash", "deployedBytecodeTemplateHash", "maskedDeployedBytecodeHash",
      "rawMetadataSha256", "sourceSetSha256", "compilerSettingsSha256", "abiSha256",
    ], `compiledContracts.${name}`);
    return {
      creationHash: trust.compiledContracts[name].creationBytecodeHash,
      templateHash: trust.compiledContracts[name].deployedBytecodeTemplateHash,
      rawMetadataSha256: trust.compiledContracts[name].rawMetadataSha256,
      sourceSetSha256: trust.compiledContracts[name].sourceSetSha256,
      compilerSettingsSha256: trust.compiledContracts[name].compilerSettingsSha256,
      abiSha256: trust.compiledContracts[name].abiSha256,
    };
  }
  const evidence = trust.contractEvidence[name];
  requireOwn(evidence, [
    "compiledCreationBytecodeHash", "compiledDeployedBytecodeTemplateHash",
    "compiledMaskedDeployedBytecodeHash", "rawMetadataSha256", "sourceSetSha256",
    "compilerSettingsSha256", "abiSha256",
  ], `contractEvidence.${name}`);
  return {
    creationHash: evidence.compiledCreationBytecodeHash,
    templateHash: evidence.compiledDeployedBytecodeTemplateHash,
    rawMetadataSha256: evidence.rawMetadataSha256,
    sourceSetSha256: evidence.sourceSetSha256,
    compilerSettingsSha256: evidence.compilerSettingsSha256,
    abiSha256: evidence.abiSha256,
  };
}

function normalizeArtifacts(kind, artifacts, normalizedPending) {
  const names = kind === "core" ? CORE_CONTRACT_NAMES : CANARY_CONTRACT_NAMES;
  const snapshot = strictSnapshot(artifacts, MAX_INPUT_BYTES * 2, "compiled artifacts");
  exactKeys(snapshot, names, "compiled artifacts");
  return Object.fromEntries(names.map((name) => [name, normalizeArtifact(name, snapshot[name], {
    record: normalizedPending.records[name],
    constructorArguments: normalizedPending.manifest.contracts[name].constructorArguments,
    compiledEvidence: compiledEvidenceFor(kind, normalizedPending.trust, name),
  })]));
}

async function defaultProgramRunner(executable, arguments_, options) {
  return execFileAsync(executable, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_INPUT_BYTES,
  });
}

function commandText(result, label) {
  if (!result || typeof result.stdout !== "string") {
    fail("RELEASE_PROVENANCE_FAILED", `${label} returned no text`);
  }
  return result.stdout;
}

function safeSourcePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1_024
    || isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) {
    fail("RELEASE_SOURCE_MISMATCH", `unsafe compiler source path ${String(path)}`);
  }
  return path;
}

async function readAtomicFile(path, maximum, label) {
  let handle;
  try {
    handle = await open(path, O_RDONLY | O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > maximum) {
      fail("INVALID_INPUT_FILE", `${label} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== details.size || bytes.byteLength > maximum) {
      fail("INVALID_INPUT_FILE", `${label} changed or exceeded its size bound while reading`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof SourceVerificationGateError) throw error;
    fail("INVALID_INPUT_FILE", `${label} could not be opened without following a symlink`);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function defaultSourceReader(path) {
  const safePath = safeSourcePath(path);
  const candidate = resolve(projectRoot, safePath);
  let canonical;
  try {
    canonical = await realpath(candidate);
  } catch {
    fail("RELEASE_SOURCE_MISMATCH", `${safePath} does not exist in the release tree`);
  }
  const location = relative(projectRoot, canonical);
  if (location === "" || location.startsWith("..") || isAbsolute(location)) {
    fail("RELEASE_SOURCE_MISMATCH", `${safePath} resolves outside the release tree`);
  }
  return readAtomicFile(canonical, MAX_INPUT_BYTES, `release source ${safePath}`);
}

function bytesFromSource(value, label) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail("RELEASE_SOURCE_MISMATCH", `${label} did not return bytes`);
}

function dependencyPackagePath(sourcePath) {
  if (!sourcePath.startsWith("node_modules/")) return null;
  const parts = sourcePath.split("/");
  if (parts.length < 3) return null;
  return parts[1].startsWith("@") && parts.length >= 4
    ? `node_modules/${parts[1]}/${parts[2]}`
    : `node_modules/${parts[1]}`;
}

export async function verifyReadOnlyReleaseSourceProvenance({
  releaseCommit,
  foundryCommit,
  artifacts,
  runProgram = defaultProgramRunner,
  sourceReader = defaultSourceReader,
  cwd = projectRoot,
}) {
  const normalizedRelease = normalizeCommit(releaseCommit, "release commit");
  const normalizedFoundry = normalizeFoundryCommit(foundryCommit, "Foundry artifact commit");
  if (!normalizedRelease.startsWith(normalizedFoundry)) {
    fail("BUILD_BINDING_MISMATCH", "Foundry artifact commit is not a prefix of the release commit");
  }
  if (typeof runProgram !== "function" || typeof sourceReader !== "function") {
    fail("INVALID_OPTIONS", "release provenance readers must be functions");
  }
  const run = async (executable, arguments_, label, { optional = false } = {}) => {
    try {
      return await runProgram(executable, arguments_, { cwd });
    } catch {
      if (optional) return null;
      fail("RELEASE_PROVENANCE_FAILED", `${label} failed closed`);
    }
  };
  const [headResult, artifactResult, statusResult, lockResult] = await Promise.all([
    run("git", ["rev-parse", "--verify", "HEAD^{commit}"], "HEAD resolution"),
    run("git", ["rev-parse", "--verify", `${normalizedFoundry}^{commit}`],
      "Foundry artifact resolution"),
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"],
      "full worktree status"),
    run("git", ["show", `${normalizedRelease}:package-lock.json`],
      "release package-lock read"),
  ]);
  const head = normalizeCommit(commandText(headResult, "HEAD resolution").trim(), "resolved HEAD");
  const artifactCommit = normalizeCommit(
    commandText(artifactResult, "Foundry artifact resolution").trim(),
    "resolved Foundry artifact commit",
  );
  if (artifactCommit !== normalizedRelease) {
    fail("BUILD_BINDING_MISMATCH", "Foundry artifact does not resolve to release commit");
  }
  await run(
    "git",
    ["merge-base", "--is-ancestor", normalizedRelease, head],
    "release ancestry check",
  );
  if (head !== normalizedRelease && !COMMIT_PATTERN.test(head)) {
    fail("BUILD_BINDING_MISMATCH", "verifier HEAD is invalid");
  }
  if (commandText(statusResult, "worktree status").trim() !== "") {
    fail("DIRTY_RELEASE_TREE", "source verification adoption requires a fully clean worktree");
  }
  const lockText = commandText(lockResult, "release package-lock read");
  let lock;
  try {
    lock = JSON.parse(lockText);
  } catch {
    fail("RELEASE_PROVENANCE_FAILED", "release package-lock is invalid JSON");
  }
  const expectedSources = new Map();
  for (const artifact of Object.values(artifacts)) {
    for (const [path, hash] of Object.entries(artifact.sourceHashes)) {
      const safePath = safeSourcePath(path);
      const existing = expectedSources.get(safePath);
      if (existing && existing !== hash) {
        fail("RELEASE_SOURCE_MISMATCH", `${safePath} has conflicting artifact source hashes`);
      }
      expectedSources.set(safePath, hash);
    }
  }
  const trackedSources = {};
  const dependencySources = {};
  const dependencyPackages = {};
  for (const [path, expectedHash] of [...expectedSources.entries()].sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const tracked = await run("git", ["show", `${normalizedRelease}:${path}`],
      `release source ${path}`, { optional: true });
    let bytes;
    if (tracked) {
      bytes = Buffer.from(commandText(tracked, `release source ${path}`), "utf8");
      trackedSources[path] = expectedHash;
    } else {
      const packagePath = dependencyPackagePath(path);
      if (!packagePath) {
        fail("RELEASE_SOURCE_MISMATCH", `${path} is neither release-tracked nor lockfile-bound`);
      }
      bytes = bytesFromSource(await sourceReader(path), `dependency source ${path}`);
      dependencySources[path] = expectedHash;
      const packageRecord = lock?.packages?.[packagePath];
      if (!packageRecord || typeof packageRecord.version !== "string"
        || typeof packageRecord.integrity !== "string"
        || !packageRecord.integrity.startsWith("sha512-")
        || typeof packageRecord.resolved !== "string"
        || !packageRecord.resolved.startsWith("https://")) {
        fail("DEPENDENCY_PROVENANCE_MISMATCH", `${packagePath} lacks pinned lockfile integrity`);
      }
      dependencyPackages[packagePath] = {
        version: packageRecord.version,
        resolved: packageRecord.resolved,
        integrity: packageRecord.integrity,
      };
    }
    if (keccak256(bytes).toLowerCase() !== expectedHash) {
      fail("RELEASE_SOURCE_MISMATCH", `${path} differs from compiled metadata`);
    }
  }
  return {
    releaseGitCommit: normalizedRelease,
    headCommit: head,
    foundryArtifactCommit: normalizedFoundry,
    artifactResolvedCommit: artifactCommit,
    releaseCommitAncestorOfVerifierHead: true,
    fullWorktreeClean: true,
    offlineRebuildEvidenceInheritedFromPendingProposal: true,
    trackedSourceCount: Object.keys(trackedSources).length,
    dependencySourceCount: Object.keys(dependencySources).length,
    trackedSourceHashes: trackedSources,
    dependencySourceHashes: dependencySources,
    trackedSourceSetSha256: canonicalSha256(trackedSources),
    dependencySourceSetSha256: canonicalSha256(dependencySources),
    dependencyPackages,
    packageLockText: lockText,
    packageLockSha256: sha256Text(lockText),
  };
}

function validateDependencyPackageEvidence(value, dependencySourceHashes) {
  plainObject(value, "release source dependency packages");
  const packagePaths = Reflect.ownKeys(value);
  if (packagePaths.some((key) => typeof key !== "string")
    || packagePaths.length > Object.keys(dependencySourceHashes).length) {
    fail("INVALID_VERIFIED_PROPOSAL", "release dependency package set is invalid");
  }
  const requiredPackages = new Set(Object.keys(dependencySourceHashes).map((path) => {
    const packagePath = dependencyPackagePath(path);
    if (!packagePath) {
      fail("INVALID_VERIFIED_PROPOSAL", `${path} is not a package-bound dependency source`);
    }
    return packagePath;
  }));
  const normalized = {};
  for (const packagePath of [...packagePaths].sort()) {
    const parts = safeSourcePath(packagePath).split("/");
    const validPackagePath = parts[0] === "node_modules"
      && ((parts.length === 2 && !parts[1].startsWith("@"))
        || (parts.length === 3 && parts[1].startsWith("@") && parts[1].length > 1));
    if (!validPackagePath || !requiredPackages.has(packagePath)) {
      fail("INVALID_VERIFIED_PROPOSAL", `${packagePath} is not required by dependency sources`);
    }
    const record = value[packagePath];
    exactKeys(record, ["version", "resolved", "integrity"], `dependency package ${packagePath}`);
    if (typeof record.version !== "string" || !/^\S{1,256}$/.test(record.version)
      || typeof record.resolved !== "string" || record.resolved.length > 2_048
      || typeof record.integrity !== "string"
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity)) {
      fail("INVALID_VERIFIED_PROPOSAL", `${packagePath} lockfile binding is invalid`);
    }
    let resolved;
    try {
      resolved = new URL(record.resolved);
    } catch {
      fail("INVALID_VERIFIED_PROPOSAL", `${packagePath} resolved URL is invalid`);
    }
    if (resolved.protocol !== "https:" || resolved.username !== ""
      || resolved.password !== "" || resolved.hash !== "") {
      fail("INVALID_VERIFIED_PROPOSAL", `${packagePath} resolved URL is not trusted HTTPS`);
    }
    normalized[packagePath] = { ...record };
  }
  if (packagePaths.length !== requiredPackages.size
    || [...requiredPackages].some((packagePath) => !Object.hasOwn(normalized, packagePath))) {
    fail("INVALID_VERIFIED_PROPOSAL", "release dependency package coverage is incomplete");
  }
  return normalized;
}

function validateReleaseSourceProvenanceEvidence(value, {
  releaseCommit,
  foundryCommit,
  expectedSourceHashes,
}) {
  exactKeys(value, [
    "releaseGitCommit", "headCommit", "foundryArtifactCommit", "artifactResolvedCommit",
    "releaseCommitAncestorOfVerifierHead",
    "fullWorktreeClean", "offlineRebuildEvidenceInheritedFromPendingProposal",
    "trackedSourceCount", "dependencySourceCount", "trackedSourceHashes",
    "dependencySourceHashes", "trackedSourceSetSha256", "dependencySourceSetSha256",
    "dependencyPackages", "packageLockText", "packageLockSha256",
  ], "verified release source provenance");
  for (const key of ["releaseGitCommit", "artifactResolvedCommit"]) {
    if (normalizeCommit(value[key], `releaseSourceProvenance.${key}`) !== releaseCommit) {
      fail("BUILD_BINDING_MISMATCH", `releaseSourceProvenance.${key} differs from release`);
    }
  }
  normalizeCommit(value.headCommit, "releaseSourceProvenance.headCommit");
  const provenanceFoundryCommit = normalizeFoundryCommit(
    value.foundryArtifactCommit,
    "releaseSourceProvenance.foundryArtifactCommit",
  );
  if (provenanceFoundryCommit !== foundryCommit
    || !releaseCommit.startsWith(provenanceFoundryCommit)
    || value.releaseCommitAncestorOfVerifierHead !== true
    || value.fullWorktreeClean !== true
    || value.offlineRebuildEvidenceInheritedFromPendingProposal !== true) {
    fail("BUILD_BINDING_MISMATCH", "verified release source provenance is not clean and bound");
  }
  const maximumSources = MAX_SOURCE_FILES
    * (CORE_CONTRACT_NAMES.length + CANARY_CONTRACT_NAMES.length);
  const tracked = normalizeSourceHashMap(
    value.trackedSourceHashes,
    "release tracked source hashes",
    maximumSources,
  );
  const dependencies = normalizeSourceHashMap(
    value.dependencySourceHashes,
    "release dependency source hashes",
    maximumSources,
  );
  if (nonnegativeSafeInteger(value.trackedSourceCount, "trackedSourceCount")
      !== Object.keys(tracked).length
    || nonnegativeSafeInteger(value.dependencySourceCount, "dependencySourceCount")
      !== Object.keys(dependencies).length) {
    fail("INVALID_VERIFIED_PROPOSAL", "release source counts do not match their hash maps");
  }
  if (normalizeHash(value.trackedSourceSetSha256, "tracked source-set SHA-256")
      !== canonicalSha256(tracked)
    || normalizeHash(value.dependencySourceSetSha256, "dependency source-set SHA-256")
      !== canonicalSha256(dependencies)) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "release source-set hash is wrong");
  }
  const combined = { ...tracked };
  for (const [path, hash] of Object.entries(dependencies)) {
    if (Object.hasOwn(combined, path)) {
      fail("INVALID_VERIFIED_PROPOSAL", `${path} is both tracked and dependency-bound`);
    }
    combined[path] = hash;
  }
  const expected = normalizeSourceHashMap(
    expectedSourceHashes,
    "verified contract source union",
    maximumSources,
  );
  sameCanonical(combined, expected, "SOURCE_IDENTITY_MISMATCH",
    "release/contract source union");
  const dependencyPackages = validateDependencyPackageEvidence(
    value.dependencyPackages,
    dependencies,
  );
  if (typeof value.packageLockText !== "string"
    || Buffer.byteLength(value.packageLockText, "utf8") > MAX_INPUT_BYTES
    || normalizeHash(value.packageLockSha256, "release package-lock SHA-256")
      !== sha256Text(value.packageLockText)) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "release package-lock content hash is wrong");
  }
  let packageLock;
  try {
    packageLock = JSON.parse(value.packageLockText);
  } catch {
    fail("INVALID_VERIFIED_PROPOSAL", "release package-lock evidence is invalid JSON");
  }
  plainObject(packageLock, "release package-lock evidence");
  plainObject(packageLock.packages, "release package-lock packages");
  for (const [packagePath, expected] of Object.entries(dependencyPackages)) {
    const actual = packageLock.packages[packagePath];
    if (!actual || typeof actual !== "object") {
      fail("INVALID_VERIFIED_PROPOSAL", `${packagePath} is absent from package-lock evidence`);
    }
    sameCanonical({
      version: actual.version,
      resolved: actual.resolved,
      integrity: actual.integrity,
    }, expected, "DEPENDENCY_PROVENANCE_MISMATCH", `${packagePath} package-lock binding`);
  }
  return value;
}

function responseRunCount(value, label) {
  const hasPlural = Object.hasOwn(value, "optimizations_runs");
  const hasSingular = Object.hasOwn(value, "optimization_runs");
  if (!hasPlural && !hasSingular) fail("MISSING_EVIDENCE", `${label} optimizer runs are missing`);
  if (hasPlural && hasSingular && value.optimizations_runs !== value.optimization_runs) {
    fail("COMPILER_SETTINGS_MISMATCH", `${label} optimizer run fields conflict`);
  }
  const runs = hasPlural ? value.optimizations_runs : value.optimization_runs;
  if (runs !== OPTIMIZER_RUNS) {
    fail("COMPILER_SETTINGS_MISMATCH", `${label} optimizer runs are wrong`);
  }
  return runs;
}

function normalizeApiAbi(value, label) {
  let abi = value;
  if (typeof abi === "string") {
    if (Buffer.byteLength(abi, "utf8") > MAX_INPUT_BYTES) {
      fail("INPUT_TOO_LARGE", `${label} is too large`);
    }
    try {
      abi = JSON.parse(abi);
    } catch {
      fail("ABI_MISMATCH", `${label} is not JSON`);
    }
  }
  if (!Array.isArray(abi) || abi.length > 2_000) fail("ABI_MISMATCH", `${label} is invalid`);
  return strictSnapshot(abi, MAX_INPUT_BYTES, label);
}

function apiSourceHashes(response, name, artifact) {
  if (typeof response.file_path !== "string" || response.file_path !== artifact.expectedPath
    || typeof response.source_code !== "string") {
    fail("SOURCE_IDENTITY_MISMATCH", `${name} main source path/content is missing or wrong`);
  }
  if (!Array.isArray(response.additional_sources)
    || response.additional_sources.length > MAX_SOURCE_FILES) {
    fail("SOURCE_IDENTITY_MISMATCH", `${name} additional source evidence is invalid`);
  }
  const sources = new Map([[response.file_path, response.source_code]]);
  for (const [index, item] of response.additional_sources.entries()) {
    exactKeys(item, ["file_path", "source_code"], `${name} additional_sources[${index}]`);
    if (typeof item.file_path !== "string" || item.file_path.length === 0
      || item.file_path.length > 1_024 || typeof item.source_code !== "string"
      || sources.has(item.file_path)) {
      fail("SOURCE_IDENTITY_MISMATCH", `${name} contains an invalid or duplicate source`);
    }
    sources.set(item.file_path, item.source_code);
  }
  const hashes = Object.fromEntries([...sources.entries()].sort(([a], [b]) => (
    a.localeCompare(b)
  )).map(([path, source]) => [path, keccak256(stringToBytes(source)).toLowerCase()]));
  sameCanonical(hashes, artifact.sourceHashes, "SOURCE_IDENTITY_MISMATCH",
    `${name} verified source set`);
  return hashes;
}

function normalizeSourcifyEvidence(response, name, record, observedAtMs) {
  exactKeys(response, [
    "matchId", "creationMatch", "runtimeMatch", "verifiedAt", "match", "chainId", "address",
  ], `${name} Sourcify response`);
  if (typeof response.matchId !== "string" || !/^\d+$/.test(response.matchId)
    || response.creationMatch !== "match" || response.runtimeMatch !== "match"
    || response.match !== "match" || response.chainId !== String(ROBINHOOD_CHAIN_ID)
    || normalizeAddress(response.address, `${name} Sourcify address`) !== record.address) {
    fail("NOT_FULLY_VERIFIED", `${name} lacks an exact Sourcify creation/runtime match`);
  }
  return {
    provider: "SOURCIFY",
    matchId: response.matchId,
    chainId: ROBINHOOD_CHAIN_ID,
    address: record.address,
    creationMatch: "match",
    runtimeMatch: "match",
    overallMatch: "match",
    verifiedAt: validateTimestamp(response.verifiedAt, `${name} Sourcify verifiedAt`, observedAtMs),
  };
}

function normalizeSmartContractEvidence(
  response,
  sourcifyEvidence,
  name,
  artifact,
  record,
  observedAtMs,
) {
  requireOwn(response, [
    "verified_twin_address_hash", "is_verified", "is_changed_bytecode",
    "is_partially_verified", "is_fully_verified", "name",
    "optimization_enabled", "compiler_version", "evm_version", "verified_at", "abi",
    "source_code", "file_path", "compiler_settings", "constructor_args",
    "additional_sources", "deployed_bytecode", "creation_bytecode", "external_libraries",
    "language", "creation_status",
  ], `${name} Blockscout smart-contract response`);
  if (response.is_verified !== true || typeof response.is_fully_verified !== "boolean"
    || typeof response.is_partially_verified !== "boolean"
    || response.is_changed_bytecode !== false
    || sourcifyEvidence.creationMatch !== "match"
    || sourcifyEvidence.runtimeMatch !== "match"
    || sourcifyEvidence.overallMatch !== "match") {
    fail("NOT_FULLY_VERIFIED", `${name} lacks unchanged Blockscout and full Sourcify evidence`);
  }
  if (response.verified_twin_address_hash !== null) {
    fail("VERIFIED_TWIN_REJECTED", `${name} source is inherited from a verified twin`);
  }
  const minimalProxy = Object.hasOwn(response, "minimal_proxy_address_hash")
    ? response.minimal_proxy_address_hash
    : null;
  if (minimalProxy !== null) {
    fail("PROXY_REJECTED", `${name} is reported as a minimal proxy`);
  }
  if (response.name !== name || response.language?.toLowerCase() !== "solidity"
    || response.compiler_version !== BLOCKSCOUT_COMPILER_VERSION
    || response.evm_version !== EVM_VERSION || response.optimization_enabled !== true
    || response.creation_status !== "success") {
    fail("COMPILER_SETTINGS_MISMATCH", `${name} Blockscout compiler identity is wrong`);
  }
  responseRunCount(response, `${name} Blockscout response`);
  const apiSettingsInput = strictSnapshot(
    response.compiler_settings,
    MAX_INPUT_BYTES,
    `${name} Blockscout compiler settings input`,
  );
  if (!Object.hasOwn(apiSettingsInput, "compilationTarget")) {
    apiSettingsInput.compilationTarget = strictSnapshot(
      artifact.settings.compilationTarget,
      MAX_INPUT_BYTES,
      `${name} compiled compilation target`,
    );
  }
  const apiSettings = normalizeCompilerSettings(
    apiSettingsInput,
    `${name} Blockscout compiler settings`,
  );
  sameCanonical(apiSettings, artifact.settings, "COMPILER_SETTINGS_MISMATCH",
    `${name} Blockscout compiler settings`);
  const apiAbi = normalizeApiAbi(response.abi, `${name} Blockscout ABI`);
  sameCanonical(apiAbi, artifact.abi, "ABI_MISMATCH", `${name} Blockscout ABI`);
  const sourceHashes = apiSourceHashes(response, name, artifact);
  const creationBytecode = normalizeBytecode(
    response.creation_bytecode,
    `${name} Blockscout creation bytecode`,
  );
  const deployedBytecode = normalizeBytecode(
    response.deployed_bytecode,
    `${name} Blockscout deployed bytecode`,
  );
  if (creationBytecode !== artifact.deploymentInitcode
    || keccak256(artifact.creationBytecode).toLowerCase() !== record.creationBytecodeHash
    || keccak256(deployedBytecode).toLowerCase() !== record.runtimeBytecodeHash) {
    fail("BYTECODE_BINDING_MISMATCH", `${name} Blockscout bytecode differs from live manifest`);
  }
  if (typeof response.constructor_args !== "string"
    || response.constructor_args.toLowerCase() !== artifact.constructorArguments) {
    fail("CONSTRUCTOR_BINDING_MISMATCH", `${name} Blockscout constructor args differ`);
  }
  if (!Array.isArray(response.external_libraries) || response.external_libraries.length !== 0
    || canonicalJson(artifact.settings.libraries) !== "{}") {
    fail("LIBRARY_BINDING_MISMATCH", `${name} has external or unexpected libraries`);
  }
  return {
    fullVerificationEstablished: true,
    blockscoutFullyVerified: response.is_fully_verified,
    blockscoutPartiallyVerified: response.is_partially_verified,
    sourcifyFullMatch: true,
    changedBytecode: false,
    verifiedTwin: null,
    minimalProxy: null,
    compilerVersion: response.compiler_version,
    evmVersion: response.evm_version,
    optimizerEnabled: true,
    optimizerRuns: OPTIMIZER_RUNS,
    viaIR: true,
    contractName: name,
    filePath: artifact.expectedPath,
    verifiedAt: validateTimestamp(response.verified_at, `${name}.verified_at`, observedAtMs),
    sourceHashes,
    sourceSetSha256: canonicalSha256(sourceHashes),
    compilerSettingsSha256: artifact.settingsSha256,
    abiSha256: artifact.abiSha256,
    creationBytecodeHash: record.creationBytecodeHash,
    deploymentInitcodeHash: keccak256(artifact.deploymentInitcode).toLowerCase(),
    runtimeBytecodeHash: record.runtimeBytecodeHash,
    constructorArguments: artifact.constructorArguments,
  };
}

function normalizeAddressEvidence(response, name, record) {
  requireOwn(response, [
    "hash", "creator_address_hash", "creation_transaction_hash",
    "is_contract", "is_verified", "creation_status",
  ], `${name} Blockscout address response`);
  if (normalizeAddress(response.hash, `${name} explorer address`) !== record.address
    || normalizeAddress(response.creator_address_hash, `${name} creator`) !== record.deployer
    || normalizeTransactionHash(response.creation_transaction_hash, `${name} creation tx`)
      !== record.deploymentTransaction
    || response.is_contract !== true || response.is_verified !== true
    || response.creation_status !== "success") {
    fail("DEPLOYMENT_EVIDENCE_MISMATCH", `${name} Blockscout address binding is wrong`);
  }
  const implementationAddress = Object.hasOwn(response, "implementation_address")
    ? response.implementation_address
    : null;
  const implementationName = Object.hasOwn(response, "implementation_name")
    ? response.implementation_name
    : null;
  if (implementationAddress !== null || implementationName !== null) {
    fail("PROXY_REJECTED", `${name} has a Blockscout implementation/proxy binding`);
  }
  return {
    address: record.address,
    creator: record.deployer,
    creationTransaction: record.deploymentTransaction,
    isContract: true,
    isVerified: true,
    implementationAddress: null,
    implementationName: null,
    creationStatus: "success",
  };
}

async function readBoundedResponse(response, expectedUrl, label) {
  if (!response || typeof response !== "object" || response.status !== 200
    || response.ok !== true || response.redirected !== false || response.url !== expectedUrl) {
    fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} status, redirect, or final URL is invalid`);
  }
  const contentType = response.headers?.get?.("content-type");
  if (typeof contentType !== "string"
    || !contentType.toLowerCase().startsWith("application/json")) {
    fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} is not application/json`);
  }
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const parsed = Number(statedLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_RESPONSE_BYTES) {
      fail("BLOCKSCOUT_RESPONSE_TOO_LARGE", `${label} content-length is invalid`);
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} body is not a readable stream`);
  const chunks = [];
  let length = 0;
  while (true) {
    let result;
    try {
      result = await reader.read();
    } catch {
      fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} body read failed`);
    }
    if (result.done) break;
    if (!(result.value instanceof Uint8Array)) {
      fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} emitted a non-byte chunk`);
    }
    length += result.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch { /* ignore cancellation failure */ }
      fail("BLOCKSCOUT_RESPONSE_TOO_LARGE", `${label} exceeded the streaming size limit`);
    }
    chunks.push(result.value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
  let text;
  let value;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = strictSnapshot(JSON.parse(text), MAX_RESPONSE_BYTES, label);
  } catch (error) {
    if (error instanceof SourceVerificationGateError) throw error;
    fail("BLOCKSCOUT_RESPONSE_REJECTED", `${label} is not valid UTF-8 JSON`);
  }
  return { value, rawBodySha256: sha256Text(bytes) };
}

async function fetchEvidenceJson(fetcher, url, label) {
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    fail("BLOCKSCOUT_FETCH_FAILED", `${label} request failed closed`);
  }
  return readBoundedResponse(response, url, label);
}

function sourceEndpoint(address) {
  return `${BLOCKSCOUT_ORIGIN}/api/v2/smart-contracts/${address}`;
}

function addressEndpoint(address) {
  return `${BLOCKSCOUT_ORIGIN}/api/v2/addresses/${address}`;
}

function sourcifyEndpoint(address) {
  return `${SOURCIFY_ORIGIN}/server/v2/contract/${ROBINHOOD_CHAIN_ID}/${address}`;
}

export async function buildBlockscoutVerifiedManifestProposal(input, options = {}) {
  exactKeys(input, ["kind", "pendingProposal", "compiledArtifacts"], "gate input");
  plainObject(options, "gate options");
  for (const key of Reflect.ownKeys(options)) {
    if (!["fetcher", "clock", "runProgram", "sourceReader", "cwd"].includes(key)) {
      fail("INVALID_OPTIONS", `gate option ${String(key)} is not allowed`);
    }
  }
  const kind = input.kind;
  const normalized = normalizePendingProposal(kind, input.pendingProposal);
  const artifacts = normalizeArtifacts(kind, input.compiledArtifacts, normalized);
  const releaseSourceProvenance = await verifyReadOnlyReleaseSourceProvenance({
    releaseCommit: normalized.releaseCommit,
    foundryCommit: normalized.foundryCommit,
    artifacts,
    runProgram: options.runProgram ?? defaultProgramRunner,
    sourceReader: options.sourceReader ?? defaultSourceReader,
    cwd: options.cwd ?? projectRoot,
  });
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") fail("INVALID_FETCHER", "fetcher must be a function");
  const clock = options.clock ?? Date.now;
  if (typeof clock !== "function") fail("INVALID_CLOCK", "clock must be a function");
  const observedAtMs = clock();
  if (!Number.isFinite(observedAtMs) || observedAtMs < 0) {
    fail("INVALID_CLOCK", "clock returned an invalid timestamp");
  }
  const names = kind === "core" ? CORE_CONTRACT_NAMES : CANARY_CONTRACT_NAMES;
  const evidence = {};
  for (const name of names) {
    const record = normalized.records[name];
    const smartContractUrl = sourceEndpoint(record.address);
    const addressUrl = addressEndpoint(record.address);
    const sourcifyUrl = sourcifyEndpoint(record.address);
    const [smart, address, sourcify] = await Promise.all([
      fetchEvidenceJson(fetcher, smartContractUrl, `${name} smart-contract evidence`),
      fetchEvidenceJson(fetcher, addressUrl, `${name} address evidence`),
      fetchEvidenceJson(fetcher, sourcifyUrl, `${name} Sourcify evidence`),
    ]);
    const sourcifyVerification = normalizeSourcifyEvidence(
      sourcify.value,
      name,
      record,
      observedAtMs,
    );
    evidence[name] = {
      address: record.address,
      smartContractEndpoint: smartContractUrl,
      addressEndpoint: addressUrl,
      sourcifyEndpoint: sourcifyUrl,
      smartContractResponseSha256: smart.rawBodySha256,
      addressResponseSha256: address.rawBodySha256,
      sourcifyResponseSha256: sourcify.rawBodySha256,
      sourcifyVerification,
      sourceVerification: normalizeSmartContractEvidence(
        smart.value,
        sourcifyVerification,
        name,
        artifacts[name],
        record,
        observedAtMs,
      ),
      deploymentAndProxyEvidence: normalizeAddressEvidence(address.value, name, record),
    };
  }

  const manifest = strictSnapshot(normalized.manifest, MAX_INPUT_BYTES, "manifest snapshot");
  for (const name of names) manifest.contracts[name].verificationStatus = "VERIFIED";
  const pendingProposalSha256 = canonicalSha256(normalized.proposal);
  const pendingManifestSha256 = canonicalSha256(normalized.manifest);
  const verificationEvidence = {
    releaseSourceProvenance,
    contracts: evidence,
  };
  const verificationEvidenceSha256 = canonicalSha256(verificationEvidence);
  const sourceVerificationAdoption = {
    schema: SOURCE_VERIFICATION_ADOPTION_SCHEMA,
    gateSchema: SOURCE_VERIFICATION_GATE_SCHEMA,
    gateVersion: SOURCE_VERIFICATION_GATE_VERSION,
    chainId: ROBINHOOD_CHAIN_ID,
    explorerOrigin: BLOCKSCOUT_ORIGIN,
    pendingProposalSha256,
    pendingManifestSha256,
    pendingManifestNotes: normalized.manifest.notes,
    verificationEvidenceSha256,
    verifiedContracts: [...names],
    observedAt: new Date(observedAtMs).toISOString(),
  };
  validateSourceVerificationAdoption(sourceVerificationAdoption, {
    expectedContracts: names,
    expectedPendingProposalSha256: pendingProposalSha256,
    expectedPendingManifestSha256: pendingManifestSha256,
    expectedPendingManifestNotes: normalized.manifest.notes,
    expectedVerificationEvidenceSha256: verificationEvidenceSha256,
  });
  manifest.sourceVerificationAdoption = sourceVerificationAdoption;
  manifest.notes = VERIFIED_MANIFEST_NOTES[kind];

  return {
    schema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    proposalStatus: "VERIFIED_MANIFEST_PROPOSAL",
    verificationScope: kind === "core" ? "ROBINHOOD_CORE" : "ROBINHOOD_CANARY",
    sourceProposal: {
      schema: normalized.proposal.schema,
      proposalStatus: normalized.proposal.proposalStatus,
      canonicalSha256: pendingProposalSha256,
    },
    pendingProposal: normalized.proposal,
    trustBindings: {
      chainId: ROBINHOOD_CHAIN_ID,
      explorerOrigin: BLOCKSCOUT_ORIGIN,
      sourcifyOrigin: SOURCIFY_ORIGIN,
      smartContractApiDocumentation: BLOCKSCOUT_SMART_CONTRACT_DOCUMENTATION,
      addressApiDocumentation: BLOCKSCOUT_ADDRESS_DOCUMENTATION,
      sourcifyApiDocumentation: SOURCIFY_DOCUMENTATION,
      releaseGitCommit: normalized.releaseCommit,
      foundryArtifactCommit: normalized.foundryCommit,
      compilerVersion: BLOCKSCOUT_COMPILER_VERSION,
      evmVersion: EVM_VERSION,
      optimizerEnabled: true,
      optimizerRuns: OPTIMIZER_RUNS,
      viaIR: true,
      metadataBytecodeHash: "none",
      allExpectedContractsVerified: true,
      directVerificationOnly: true,
      blockscoutPartialAcceptedOnlyWithSourcifyFullMatch: true,
      changedBytecodeAccepted: false,
      verifiedTwinAccepted: false,
      proxyAccepted: false,
      observedAt: new Date(observedAtMs).toISOString(),
      contracts: evidence,
      releaseSourceProvenance,
      sourceVerificationAdoption,
      transactionCapability: "NONE_READ_ONLY_ADOPTION_PROPOSAL",
    },
    manifest,
  };
}

export function renderBlockscoutVerifiedManifestProposal(proposal) {
  return `${canonicalJson(proposal)}\n`;
}

export function validateBlockscoutVerifiedManifestProposal(value) {
  const proposal = strictSnapshot(value, MAX_INPUT_BYTES * 2, "verified manifest proposal");
  exactKeys(proposal, [
    "schema", "proposalStatus", "verificationScope", "sourceProposal", "pendingProposal",
    "trustBindings", "manifest",
  ], "verified manifest proposal");
  if (proposal.schema !== SOURCE_VERIFICATION_GATE_SCHEMA
    || proposal.proposalStatus !== "VERIFIED_MANIFEST_PROPOSAL"
    || !["ROBINHOOD_CORE", "ROBINHOOD_CANARY"].includes(proposal.verificationScope)) {
    fail("INVALID_VERIFIED_PROPOSAL", "verified proposal identity is wrong");
  }
  const names = proposal.verificationScope === "ROBINHOOD_CORE"
    ? CORE_CONTRACT_NAMES
    : CANARY_CONTRACT_NAMES;
  const expectedSourceProposal = proposal.verificationScope === "ROBINHOOD_CORE"
    ? {
      schema: "GOGH_ROBINHOOD_DEPLOYMENT_MANIFEST_PROPOSAL_V2",
      proposalStatus: "COMPLETE_MANIFEST_PROPOSAL",
    }
    : {
      schema: "GOGH_ROBINHOOD_CANARY_DEPLOYMENT_MANIFEST_PROPOSAL_V1",
      proposalStatus: "CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING",
    };
  exactKeys(proposal.sourceProposal, ["schema", "proposalStatus", "canonicalSha256"],
    "verified proposal sourceProposal");
  if (proposal.sourceProposal.schema !== expectedSourceProposal.schema
    || proposal.sourceProposal.proposalStatus !== expectedSourceProposal.proposalStatus) {
    fail("INVALID_VERIFIED_PROPOSAL", "verified proposal source identity is wrong");
  }
  const pendingHash = normalizeHash(
    proposal.sourceProposal.canonicalSha256,
    "source pending proposal hash",
  );
  if (canonicalSha256(proposal.pendingProposal) !== pendingHash) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "embedded pending proposal hash differs");
  }
  const kind = proposal.verificationScope === "ROBINHOOD_CORE" ? "core" : "canary";
  const normalizedPending = normalizePendingProposal(kind, proposal.pendingProposal);
  if (normalizedPending.proposal.schema !== expectedSourceProposal.schema
    || normalizedPending.proposal.proposalStatus !== expectedSourceProposal.proposalStatus) {
    fail("INVALID_VERIFIED_PROPOSAL", "embedded pending proposal identity is wrong");
  }
  const trust = proposal.trustBindings;
  exactKeys(trust, [
    "chainId", "explorerOrigin", "sourcifyOrigin", "smartContractApiDocumentation",
    "addressApiDocumentation", "sourcifyApiDocumentation", "releaseGitCommit", "foundryArtifactCommit",
    "compilerVersion", "evmVersion", "optimizerEnabled", "optimizerRuns", "viaIR",
    "metadataBytecodeHash", "allExpectedContractsVerified", "directVerificationOnly",
    "blockscoutPartialAcceptedOnlyWithSourcifyFullMatch", "changedBytecodeAccepted", "verifiedTwinAccepted",
    "proxyAccepted", "observedAt", "contracts", "releaseSourceProvenance",
    "sourceVerificationAdoption", "transactionCapability",
  ], "verified proposal trustBindings");
  if (trust.chainId !== ROBINHOOD_CHAIN_ID || trust.explorerOrigin !== BLOCKSCOUT_ORIGIN
    || trust.sourcifyOrigin !== SOURCIFY_ORIGIN
    || trust.smartContractApiDocumentation !== BLOCKSCOUT_SMART_CONTRACT_DOCUMENTATION
    || trust.addressApiDocumentation !== BLOCKSCOUT_ADDRESS_DOCUMENTATION
    || trust.sourcifyApiDocumentation !== SOURCIFY_DOCUMENTATION
    || trust.compilerVersion !== BLOCKSCOUT_COMPILER_VERSION || trust.evmVersion !== EVM_VERSION
    || trust.optimizerEnabled !== true || trust.optimizerRuns !== OPTIMIZER_RUNS
    || trust.viaIR !== true || trust.metadataBytecodeHash !== "none"
    || trust.allExpectedContractsVerified !== true || trust.directVerificationOnly !== true
    || trust.blockscoutPartialAcceptedOnlyWithSourcifyFullMatch !== true
    || trust.changedBytecodeAccepted !== false
    || trust.verifiedTwinAccepted !== false || trust.proxyAccepted !== false
    || trust.transactionCapability !== "NONE_READ_ONLY_ADOPTION_PROPOSAL") {
    fail("INVALID_VERIFIED_PROPOSAL", "verified proposal trust policy is wrong");
  }
  const releaseCommit = normalizeCommit(trust.releaseGitCommit, "verified release commit");
  const foundryCommit = normalizeFoundryCommit(
    trust.foundryArtifactCommit,
    "verified Foundry artifact commit",
  );
  if (!releaseCommit.startsWith(foundryCommit)) {
    fail("BUILD_BINDING_MISMATCH", "verified Foundry commit is not a release prefix");
  }
  if (normalizedPending.releaseCommit !== releaseCommit
    || normalizedPending.foundryCommit !== foundryCommit) {
    fail("BUILD_BINDING_MISMATCH", "verified wrapper differs from pending build provenance");
  }
  const observedAtMs = Date.parse(trust.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    fail("INVALID_VERIFICATION_TIME", "verified proposal observedAt is invalid");
  }
  validateTimestamp(trust.observedAt, "verified proposal observedAt", observedAtMs);
  exactKeys(trust.contracts, names, "verified contract evidence");
  exactKeys(proposal.manifest.contracts, names, "verified manifest contracts");
  const expectedSourceHashes = {};
  for (const name of names) {
    const record = normalizedPending.manifest.contracts[name];
    const adoptedRecord = proposal.manifest.contracts[name];
    if (adoptedRecord.verificationStatus !== "VERIFIED") {
      fail("INVALID_VERIFIED_PROPOSAL", `${name} is not VERIFIED`);
    }
    const address = normalizeAddress(record.address, `${name} pending manifest address`);
    const contractEvidence = trust.contracts[name];
    exactKeys(contractEvidence, [
      "address", "smartContractEndpoint", "addressEndpoint", "sourcifyEndpoint",
      "smartContractResponseSha256", "addressResponseSha256", "sourcifyResponseSha256",
      "sourcifyVerification", "sourceVerification", "deploymentAndProxyEvidence",
    ], `${name} verified evidence`);
    if (normalizeAddress(contractEvidence.address, `${name} evidence address`) !== address
      || contractEvidence.smartContractEndpoint !== sourceEndpoint(address)
      || contractEvidence.addressEndpoint !== addressEndpoint(address)
      || contractEvidence.sourcifyEndpoint !== sourcifyEndpoint(address)) {
      fail("INVALID_VERIFIED_PROPOSAL", `${name} endpoint/address binding is wrong`);
    }
    normalizeHash(contractEvidence.smartContractResponseSha256, `${name} source response hash`);
    normalizeHash(contractEvidence.addressResponseSha256, `${name} address response hash`);
    normalizeHash(contractEvidence.sourcifyResponseSha256, `${name} Sourcify response hash`);
    const sourcify = contractEvidence.sourcifyVerification;
    exactKeys(sourcify, [
      "provider", "matchId", "chainId", "address", "creationMatch", "runtimeMatch",
      "overallMatch", "verifiedAt",
    ], `${name} Sourcify verification`);
    if (sourcify.provider !== "SOURCIFY" || !/^\d+$/.test(sourcify.matchId)
      || sourcify.chainId !== ROBINHOOD_CHAIN_ID
      || normalizeAddress(sourcify.address, `${name} Sourcify address`) !== address
      || sourcify.creationMatch !== "match" || sourcify.runtimeMatch !== "match"
      || sourcify.overallMatch !== "match") {
      fail("INVALID_VERIFIED_PROPOSAL", `${name} Sourcify evidence is not a full match`);
    }
    validateTimestamp(sourcify.verifiedAt, `${name} Sourcify verifiedAt`, observedAtMs);
    const source = contractEvidence.sourceVerification;
    const compiledEvidence = compiledEvidenceFor(kind, normalizedPending.trust, name);
    exactKeys(source, [
      "fullVerificationEstablished", "blockscoutFullyVerified",
      "blockscoutPartiallyVerified", "sourcifyFullMatch", "changedBytecode", "verifiedTwin",
      "minimalProxy", "compilerVersion", "evmVersion", "optimizerEnabled", "optimizerRuns",
      "viaIR", "contractName", "filePath", "verifiedAt", "sourceHashes",
      "sourceSetSha256", "compilerSettingsSha256", "abiSha256", "creationBytecodeHash",
      "deploymentInitcodeHash", "runtimeBytecodeHash", "constructorArguments",
    ], `${name} source verification`);
    if (source.fullVerificationEstablished !== true
      || typeof source.blockscoutFullyVerified !== "boolean"
      || typeof source.blockscoutPartiallyVerified !== "boolean"
      || source.sourcifyFullMatch !== true || source.changedBytecode !== false
      || source.verifiedTwin !== null
      || source.minimalProxy !== null || source.compilerVersion !== BLOCKSCOUT_COMPILER_VERSION
      || source.evmVersion !== EVM_VERSION || source.optimizerEnabled !== true
      || source.optimizerRuns !== OPTIMIZER_RUNS || source.viaIR !== true
      || source.contractName !== name
      || source.filePath !== SOURCE_PATHS[name]
      || normalizeHash(source.creationBytecodeHash, `${name} creation hash`)
        !== normalizeHash(record.creationBytecodeHash, `${name} manifest creation hash`)
      || normalizeHash(source.creationBytecodeHash, `${name} creation hash`)
        !== normalizeHash(compiledEvidence.creationHash, `${name} compiled creation hash`)
      || normalizeHash(source.runtimeBytecodeHash, `${name} runtime hash`)
        !== normalizeHash(record.runtimeBytecodeHash, `${name} manifest runtime hash`)) {
      fail("INVALID_VERIFIED_PROPOSAL", `${name} normalized source evidence is wrong`);
    }
    const sourceHashes = normalizeSourceHashMap(
      source.sourceHashes,
      `${name} verified source hashes`,
    );
    if (!Object.hasOwn(sourceHashes, SOURCE_PATHS[name])
      || normalizeHash(source.sourceSetSha256, `${name} source-set hash`)
        !== canonicalSha256(sourceHashes)
      || normalizeHash(source.sourceSetSha256, `${name} source-set hash`)
        !== normalizeHash(compiledEvidence.sourceSetSha256, `${name} compiled source-set hash`)) {
      fail("SOURCE_IDENTITY_MISMATCH", `${name} source path/set binding is wrong`);
    }
    for (const [path, hash] of Object.entries(sourceHashes)) {
      if (Object.hasOwn(expectedSourceHashes, path) && expectedSourceHashes[path] !== hash) {
        fail("SOURCE_IDENTITY_MISMATCH", `${path} has conflicting verified source hashes`);
      }
      expectedSourceHashes[path] = hash;
    }
    normalizeHash(source.deploymentInitcodeHash, `${name} deployment initcode hash`);
    if (normalizeHash(source.compilerSettingsSha256, `${name} compiler-settings hash`)
        !== normalizeHash(
          compiledEvidence.compilerSettingsSha256,
          `${name} compiled compiler-settings hash`,
        )
      || normalizeHash(source.abiSha256, `${name} ABI hash`)
        !== normalizeHash(compiledEvidence.abiSha256, `${name} compiled ABI hash`)) {
      fail("BUILD_BINDING_MISMATCH", `${name} source evidence differs from compiled identity`);
    }
    const constructorArguments = normalizeHexData(
      source.constructorArguments,
      `${name} constructor arguments`,
    );
    if (constructorArguments !== source.constructorArguments) {
      fail("CONSTRUCTOR_BINDING_MISMATCH", `${name} constructor arguments are not canonical`);
    }
    validateTimestamp(source.verifiedAt, `${name} verifiedAt`, observedAtMs);
    const deployment = contractEvidence.deploymentAndProxyEvidence;
    exactKeys(deployment, [
      "address", "creator", "creationTransaction", "isContract", "isVerified",
      "implementationAddress", "implementationName", "creationStatus",
    ], `${name} deployment evidence`);
    if (normalizeAddress(deployment.address, `${name} deployed address`) !== address
      || normalizeAddress(deployment.creator, `${name} creator`)
        !== normalizeAddress(record.deployer, `${name} manifest deployer`)
      || normalizeTransactionHash(deployment.creationTransaction, `${name} creation tx`)
        !== normalizeTransactionHash(record.deploymentTransaction, `${name} manifest tx`)
      || deployment.isContract !== true || deployment.isVerified !== true
      || deployment.implementationAddress !== null || deployment.implementationName !== null
      || deployment.creationStatus !== "success") {
      fail("INVALID_VERIFIED_PROPOSAL", `${name} normalized deployment evidence is wrong`);
    }
  }
  validateReleaseSourceProvenanceEvidence(trust.releaseSourceProvenance, {
    releaseCommit,
    foundryCommit,
    expectedSourceHashes,
  });
  const evidenceHash = canonicalSha256({
    releaseSourceProvenance: trust.releaseSourceProvenance,
    contracts: trust.contracts,
  });
  const adoption = validateSourceVerificationAdoption(
    proposal.manifest.sourceVerificationAdoption,
    {
      expectedContracts: names,
      expectedPendingProposalSha256: pendingHash,
      expectedPendingManifestSha256: canonicalSha256(normalizedPending.manifest),
      expectedPendingManifestNotes: normalizedPending.manifest.notes,
      expectedVerificationEvidenceSha256: evidenceHash,
    },
  );
  sameCanonical(trust.sourceVerificationAdoption, adoption,
    "SOURCE_VERIFICATION_HASH_MISMATCH", "wrapper/manifest source adoption");
  if (proposal.manifest.gitCommit !== releaseCommit || adoption.observedAt !== trust.observedAt) {
    fail("INVALID_VERIFIED_PROPOSAL", "verified manifest release/time binding is wrong");
  }
  const expectedManifest = strictSnapshot(
    normalizedPending.manifest,
    MAX_INPUT_BYTES,
    "expected adopted manifest",
  );
  for (const name of names) {
    expectedManifest.contracts[name].verificationStatus = "VERIFIED";
  }
  expectedManifest.sourceVerificationAdoption = adoption;
  expectedManifest.notes = VERIFIED_MANIFEST_NOTES[kind];
  sameCanonical(proposal.manifest, expectedManifest,
    "INVALID_VERIFIED_PROPOSAL", "exact pending-to-verified manifest transition");
  return proposal;
}

export function extractBlockscoutVerifiedManifest(value) {
  const proposal = validateBlockscoutVerifiedManifestProposal(value);
  return strictSnapshot(proposal.manifest, MAX_INPUT_BYTES, "adopted manifest");
}

export function parseSourceVerificationArguments(argv) {
  if (!Array.isArray(argv)) fail("INVALID_ARGUMENTS", "arguments must be an array");
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--kind", "--proposal"].includes(flag) || typeof value !== "string"
      || value.length === 0 || value.startsWith("--") || Object.hasOwn(parsed, flag)) {
      fail("INVALID_ARGUMENTS", "required exactly once: --kind core|canary --proposal PATH");
    }
    parsed[flag] = value;
  }
  if (Object.keys(parsed).length !== 2 || !["core", "canary"].includes(parsed["--kind"])) {
    fail("INVALID_ARGUMENTS", "required exactly once: --kind core|canary --proposal PATH");
  }
  return { kind: parsed["--kind"], proposalPath: parsed["--proposal"] };
}

export async function readSourceVerificationJsonFile(path, maximum = MAX_INPUT_BYTES, label = "JSON") {
  const text = (await readAtomicFile(path, maximum, label)).toString("utf8");
  try {
    return strictSnapshot(JSON.parse(text), maximum, label);
  } catch (error) {
    if (error instanceof SourceVerificationGateError) throw error;
    fail("INVALID_INPUT_FILE", `${label} is not valid JSON`);
  }
}

async function loadCompiledArtifacts(kind) {
  const names = kind === "core" ? CORE_CONTRACT_NAMES : CANARY_CONTRACT_NAMES;
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    await readSourceVerificationJsonFile(
      resolve(projectRoot, ARTIFACT_PATHS[name]),
      MAX_INPUT_BYTES,
      `${name} compiled artifact`,
    ),
  ])));
}

async function main() {
  const { kind, proposalPath } = parseSourceVerificationArguments(process.argv.slice(2));
  const pendingProposal = await readSourceVerificationJsonFile(
    resolve(process.cwd(), proposalPath),
    MAX_INPUT_BYTES,
    "pending manifest proposal",
  );
  const compiledArtifacts = await loadCompiledArtifacts(kind);
  const proposal = await buildBlockscoutVerifiedManifestProposal({
    kind,
    pendingProposal,
    compiledArtifacts,
  });
  process.stdout.write(renderBlockscoutVerifiedManifestProposal(proposal));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message = error instanceof SourceVerificationGateError
      ? error.message
      : "SOURCE_VERIFICATION_GATE_FAILED: unexpected read-only gate failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
