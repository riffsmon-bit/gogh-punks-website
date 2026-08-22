import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  http,
  isAddress,
  keccak256,
  parseAbiItem,
} from "viem";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import { requireVerifiedManifestAdoption } from
  "../broker/src/recommendation/source-verification-adoption.mjs";

export const ROBINHOOD_CHAIN_ID = 4663;
export const CANARY_DEPLOYMENT_ORDER = Object.freeze([
  "GoghOneShotCanaryArt",
  "GoghOneShotCanaryMintAdapter",
]);
export const CANONICAL_COLLECTION = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
export const CANONICAL_ERC6551_REGISTRY =
  "0x000000006551c19487814612e58FE06813775758";
export const CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
export const CANARY_MINT_SELECTOR = "0x40c10f19";
export const SAFE_INITIAL_FEATURE_FLAGS = Object.freeze({
  scoutMode: true,
  approvalPurchases: false,
  autonomousPurchases: false,
  autonomousMints: false,
  unknownCollectionExecution: false,
  selling: false,
  autonomousSelling: false,
});

const CORE_CONTRACT_NAMES = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const CORE_FEATURE_FLAGS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const DEFAULT_CONFIRMATIONS = 20;
const MIN_CONFIRMATIONS = 20;
const MAX_CONFIRMATIONS = 256;
const MAX_HEAD_SKEW = 128n;
const MAX_JSON_BYTES = 2_000_000;
const MAX_TEMPLATE_BYTES = 256_000;
const MAX_BYTECODE_BYTES = 1_000_000;
const MAX_LOG_BLOCK_RANGE = 25_000n;
const projectRoot = resolve(import.meta.dirname, "..");
const defaultCoreManifestPath = resolve(projectRoot, "deployments/robinhood.json");
const defaultCanaryTemplatePath = resolve(projectRoot, "deployments/robinhood-canary.json");
const defaultBroadcastRoot = resolve(
  projectRoot,
  "broadcast/DeployOneShotCanary.s.sol/4663",
);
const execFileAsync = promisify(execFile);

const addressOutput = [{ type: "address" }];
const uintOutput = [{ type: "uint256" }];
const boolOutput = [{ type: "bool" }];
const bytes4Output = [{ type: "bytes4" }];
const bytes32Output = [{ type: "bytes32" }];
const viewFunction = (name, outputs, inputs = []) => ({
  type: "function",
  name,
  stateMutability: "view",
  inputs,
  outputs,
});
const uintInput = [{ name: "tokenId", type: "uint256" }];
const accountInput = [{ name: "account", type: "address" }];
const accountAddressInput = [
  { name: "account", type: "address" },
  { name: "target", type: "address" },
];
const accountSelectorInput = [
  { name: "account", type: "address" },
  { name: "selector", type: "bytes4" },
];
const featureTuple = {
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
const policyConfigTuple = {
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
const policyStateTuple = {
  type: "tuple",
  components: [
    policyConfigTuple,
    { name: "configuredBy", type: "address" },
    { name: "version", type: "uint64" },
    { name: "permissionGeneration", type: "uint64" },
    { name: "accountPaused", type: "bool" },
  ],
};
const currencyPolicyTuple = {
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
  type: "tuple",
  components: [
    { name: "ownerApprovedMints", type: "bool" },
    { name: "autonomousFreeMints", type: "bool" },
    { name: "autonomousPaidMints", type: "bool" },
  ],
};
const adapterRecordTuple = {
  type: "tuple",
  components: [
    { name: "kind", type: "uint8" },
    { name: "active", type: "bool" },
    { name: "venue", type: "address" },
    { name: "adapterCodeHash", type: "bytes32" },
    { name: "venueCodeHash", type: "bytes32" },
    { name: "versionHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
  ],
};
const registryAbi = [
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
  viewFunction("CANONICAL_ERC6551_REGISTRY", addressOutput),
  viewFunction("canonicalRegistry", addressOutput),
  viewFunction("implementation", addressOutput),
  viewFunction("accountSalt", bytes32Output),
  viewFunction("account", addressOutput, uintInput),
];
const canonicalRegistryAbi = [viewFunction("account", addressOutput, [
  { name: "implementation", type: "address" },
  { name: "salt", type: "bytes32" },
  { name: "chainId", type: "uint256" },
  { name: "tokenContract", type: "address" },
  { name: "tokenId", type: "uint256" },
])];
const accountAbi = [
  viewFunction("owner", addressOutput),
  viewFunction("isCanonicalGoghPunkAccount", boolOutput),
  viewFunction("token", [
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ]),
  viewFunction("policyModule", addressOutput),
  viewFunction("agentRegistry", addressOutput),
  viewFunction("adapterRegistry", addressOutput),
  viewFunction("state", uintOutput),
  viewFunction("acquisitionNonce", uintOutput),
];
const punkAbi = [viewFunction("ownerOf", addressOutput, uintInput)];
const policyAbi = [
  viewFunction("featureFlags", [featureTuple]),
  viewFunction("globallyPaused", boolOutput),
  viewFunction("policy", [policyStateTuple], accountInput),
  viewFunction("mintControls", [mintControlsTuple], accountInput),
  viewFunction("approvedAdapters", boolOutput, accountAddressInput),
  viewFunction("approvedMintContracts", boolOutput, accountAddressInput),
  viewFunction("approvedCollections", boolOutput, accountAddressInput),
  viewFunction("deniedCollections", boolOutput, accountAddressInput),
  viewFunction("approvedSelectors", boolOutput, accountSelectorInput),
  viewFunction("deniedSelectors", boolOutput, accountSelectorInput),
  viewFunction("currencyPolicy", [currencyPolicyTuple], [
    { name: "account", type: "address" },
    { name: "currency", type: "address" },
  ]),
  viewFunction("venueCurrencyMaximum", uintOutput, [
    { name: "account", type: "address" },
    { name: "venue", type: "address" },
    { name: "currency", type: "address" },
  ]),
  viewFunction("acquisitionUsage", [{
    type: "tuple",
    components: [
      { name: "dayBucket", type: "uint64" },
      { name: "acquisitionsToday", type: "uint32" },
    ],
  }], accountInput),
  viewFunction("usage", [{
    type: "tuple",
    components: [
      { name: "dayBucket", type: "uint64" },
      { name: "weekBucket", type: "uint64" },
      { name: "acquisitionsToday", type: "uint32" },
      { name: "spentToday", type: "uint256" },
      { name: "spentThisWeek", type: "uint256" },
    ],
  }], [
    { name: "account", type: "address" },
    { name: "currency", type: "address" },
  ]),
];
const adapterRegistryAbi = [
  viewFunction("globallyPaused", boolOutput),
  viewFunction("adapterRecord", [adapterRecordTuple], [{ name: "adapter", type: "address" }]),
];
const agentRegistryAbi = [
  viewFunction("globallyPaused", boolOutput),
  viewFunction("authorizationGeneration", [{ type: "uint64" }], accountInput),
];
const canaryArtAbi = [
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("CANONICAL_ERC6551_REGISTRY", addressOutput),
  viewFunction("punkAccountRegistry", addressOutput),
  viewFunction("punkAccount", addressOutput),
  viewFunction("controllingPunkTokenId", uintOutput),
  viewFunction("canaryTokenId", uintOutput),
  viewFunction("minted", boolOutput),
];
const canaryAdapterAbi = [
  viewFunction("canaryCollection", addressOutput),
  viewFunction("boundAccount", addressOutput),
  viewFunction("boundTokenId", uintOutput),
  viewFunction("venue", addressOutput),
  viewFunction("collection", addressOutput),
  viewFunction("mintSelector", bytes4Output),
  viewFunction("assetStandard", [{ type: "uint8" }]),
  viewFunction("kind", [{ type: "uint8" }]),
];
const agentAuthorizedEvent = parseAbiItem(
  "event AgentAuthorized(address indexed account,address indexed agent,address indexed owner,uint64 validUntil,uint64 generation)",
);
const agentRevokedEvent = parseAbiItem(
  "event AgentRevoked(address indexed account,address indexed agent,address indexed owner)",
);
const allAgentsRevokedEvent = parseAbiItem(
  "event AllAgentsRevoked(address indexed account,address indexed owner,uint64 newGeneration)",
);
const policyMutationEvents = Object.freeze([
  parseAbiItem("event PolicyConfigured(address indexed account,address indexed owner,uint64 indexed version,uint8 mode)"),
  parseAbiItem("event AccountPauseChanged(address indexed account,address indexed owner,bool paused,uint64 version)"),
  parseAbiItem("event AdapterPermissionChanged(address indexed account,address indexed adapter,bool allowed)"),
  parseAbiItem("event VenuePermissionChanged(address indexed account,address indexed venue,uint8 indexed kind,bool allowed)"),
  parseAbiItem("event CollectionPermissionChanged(address indexed account,address indexed collection,bool allowed,bool denied)"),
  parseAbiItem("event CurrencyPolicyChanged(address indexed account,address indexed currency,(bool allowed,uint256 maxSpendPerTransaction,uint256 maxSpendPerDay,uint256 maxSpendPerWeek,uint256 maxMintPrice,uint256 maxSecondaryPurchasePrice) policy)"),
  parseAbiItem("event VenueCurrencyMaximumChanged(address indexed account,address indexed venue,address indexed currency,uint256 maximum)"),
  parseAbiItem("event SelectorPermissionChanged(address indexed account,bytes4 indexed selector,bool allowed,bool denied)"),
  parseAbiItem("event MintControlsChanged(address indexed account,address indexed owner,bool ownerApprovedMints,bool autonomousFreeMints,bool autonomousPaidMints,uint64 policyVersion)"),
  parseAbiItem("event AcquisitionPolicyConsumed(address indexed account,bytes32 indexed opportunityId,address indexed currency,uint256 amount,uint256 spentToday,uint256 spentThisWeek,uint32 acquisitionsToday,bool ownerApproved,uint64 policyVersion)"),
]);
const featureFlagsChangedEvent = parseAbiItem(
  "event FeatureFlagsChanged((bool scoutMode,bool approvalPurchases,bool autonomousPurchases,bool autonomousMints,bool unknownCollectionExecution,bool selling,bool autonomousSelling) flags)",
);

export class CanaryManifestProposalError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CanaryManifestProposalError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryManifestProposalError(code, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor || descriptor.get || descriptor.set
      || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label} must contain only enumerable string data properties`);
    }
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("INVALID_SCHEMA", `${label} has an unexpected key set`);
  }
}

function requiredAllowedKeys(value, required, allowed, label) {
  plainObject(value, label);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("INVALID_SCHEMA", `${label}.${key} is required`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) fail("INVALID_SCHEMA", `${label}.${key} is not allowed`);
  }
}

function boundedJson(value, maximum, label) {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} must be strict JSON data`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maximum) {
    fail("INPUT_TOO_LARGE", `${label} exceeds ${maximum} bytes`);
  }
}

function normalizeAddress(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact 20-byte address`);
  }
  const normalized = getAddress(value);
  if (!allowZero && normalized.toLowerCase() === ZERO_ADDRESS) {
    fail("ZERO_ADDRESS", `${label} must not be zero`);
  }
  return normalized;
}

function sameAddress(value, expected, label, options) {
  const normalized = normalizeAddress(value, label, options);
  if (normalized.toLowerCase() !== expected.toLowerCase()) {
    fail("ADDRESS_MISMATCH", `${label} does not match the expected value`);
  }
  return normalized;
}

function normalizeHash(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be an exact 32-byte hash`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_HASH) fail("ZERO_HASH", `${label} must not be zero`);
  return normalized;
}

function normalizeBytecode(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    fail("INVALID_BYTECODE", `${label} must be nonempty byte-aligned hex`);
  }
  if ((value.length - 2) / 2 > MAX_BYTECODE_BYTES) {
    fail("INPUT_TOO_LARGE", `${label} exceeds ${MAX_BYTECODE_BYTES} bytes`);
  }
  return value.toLowerCase();
}

function parseUint(value, label, { positive = false } = {}) {
  let parsed;
  try {
    if (typeof value === "bigint") parsed = value;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      parsed = BigInt(value);
    } else if (typeof value === "string"
      && (/^(?:0|[1-9]\d*)$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value))) {
      parsed = BigInt(value);
    } else throw new TypeError();
  } catch {
    fail("INVALID_INTEGER", `${label} must be an unsigned integer`);
  }
  if (parsed < 0n || (positive && parsed === 0n)) {
    fail("INVALID_INTEGER", `${label} must${positive ? " be positive" : " not be negative"}`);
  }
  return parsed;
}

function safeNumber(value, label, options) {
  const parsed = parseUint(value, label, options);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) fail("UNSAFE_INTEGER", `${label} is too large`);
  return Number(parsed);
}

function normalizeCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_GIT_COMMIT", `${label} must be exactly 40 hexadecimal characters`);
  }
  return value.toLowerCase();
}

function normalizeFoundryCommit(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{7,40}$/.test(value)) {
    fail("INVALID_FOUNDRY_COMMIT", "Foundry artifact commit must be 7-40 hexadecimal characters");
  }
  return value.toLowerCase();
}

function strictIso(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail("INVALID_TIMESTAMP", `${label} must be a strict ISO-8601 UTC timestamp`);
  }
  return value;
}

function blockTimestampIso(value, label) {
  const seconds = parseUint(value, label, { positive: true });
  if (seconds > BigInt(Math.floor(8.64e15 / 1_000))) {
    fail("INVALID_TIMESTAMP", `${label} exceeds the JavaScript date range`);
  }
  return strictIso(new Date(Number(seconds) * 1_000).toISOString(), label);
}

function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function tupleField(tuple, name, index) {
  if (!tuple || typeof tuple !== "object") fail("INVALID_LIVE_VALUE", `${name} tuple is missing`);
  return Object.hasOwn(tuple, name) ? tuple[name] : tuple[index];
}

function expectBoolean(value, expected, label) {
  if (value !== expected) fail("UNSAFE_LIVE_STATE", `${label} must be ${expected}`);
  return value;
}

function expectUint(value, expected, label) {
  const normalized = parseUint(value, label);
  if (normalized !== BigInt(expected)) fail("UNSAFE_LIVE_STATE", `${label} must be ${expected}`);
  return normalized;
}

function normalizeConfirmations(value) {
  const count = safeNumber(value ?? DEFAULT_CONFIRMATIONS, "confirmations", { positive: true });
  if (count < MIN_CONFIRMATIONS || count > MAX_CONFIRMATIONS) {
    fail("INVALID_CONFIRMATIONS", `confirmations must be ${MIN_CONFIRMATIONS}-${MAX_CONFIRMATIONS}`);
  }
  return count;
}

function validateChain(chain, label) {
  exactKeys(chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], label);
  if (chain.name !== "Robinhood Chain" || chain.chainId !== ROBINHOOD_CHAIN_ID
    || chain.rpcEnvironmentVariable !== "ROBINHOOD_RPC_URL"
    || chain.explorer !== "https://robinhoodchain.blockscout.com"
    || chain.nativeCurrency !== "ETH") {
    fail("WRONG_CHAIN", `${label} is not the canonical Robinhood chain record`);
  }
}

function validateCoreManifest(manifest) {
  boundedJson(manifest, MAX_TEMPLATE_BYTES, "core manifest");
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "verifiedExternalInfrastructure",
    "accountSalt", "gitCommit", "compiler", "evmVersion", "optimizerRuns", "contracts",
    "sourceVerificationAdoption", "featureFlags", "protocolGuardian", "notes",
  ], "core manifest");
  if (manifest.status !== "DEPLOYED") fail("CORE_NOT_DEPLOYED", "core manifest must be DEPLOYED");
  validateChain(manifest.chain, "core.chain");
  sameAddress(manifest.canonicalCollection, CANONICAL_COLLECTION, "core canonical collection");
  sameAddress(
    manifest.canonicalERC6551Registry,
    CANONICAL_ERC6551_REGISTRY,
    "core canonical ERC-6551 registry",
  );
  if (normalizeHash(manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "core canonical registry hash") !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail("CORE_BINDING_MISMATCH", "core canonical registry runtime hash is wrong");
  }
  if (normalizeHash(manifest.accountSalt, "core account salt", { allowZero: true }) !== ZERO_HASH) {
    fail("CORE_BINDING_MISMATCH", "core account salt must be zero");
  }
  const gitCommit = normalizeCommit(manifest.gitCommit, "core git commit");
  if (manifest.compiler !== "0.8.34" || manifest.evmVersion !== "cancun"
    || manifest.optimizerRuns !== 500) {
    fail("CORE_BINDING_MISMATCH", "core compiler settings are wrong");
  }
  exactKeys(manifest.contracts, CORE_CONTRACT_NAMES, "core.contracts");
  requireVerifiedManifestAdoption(manifest, CORE_CONTRACT_NAMES);
  const contracts = {};
  const addresses = new Set();
  let deployer;
  for (const name of CORE_CONTRACT_NAMES) {
    const record = manifest.contracts[name];
    exactKeys(record, [
      "address", "deploymentTransaction", "deploymentBlock", "deployer", "implementationVersion",
      "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
      "verificationStatus",
    ], `core.contracts.${name}`);
    const address = normalizeAddress(record.address, `${name} address`);
    if (addresses.has(address.toLowerCase())) fail("DUPLICATE_ADDRESS", "core addresses repeat");
    addresses.add(address.toLowerCase());
    normalizeHash(record.deploymentTransaction, `${name} deployment transaction`);
    safeNumber(record.deploymentBlock, `${name} deployment block`, { positive: true });
    const recordDeployer = normalizeAddress(record.deployer, `${name} deployer`);
    if (deployer && deployer.toLowerCase() !== recordDeployer.toLowerCase()) {
      fail("CORE_BINDING_MISMATCH", "core contracts have multiple deployers");
    }
    deployer = recordDeployer;
    if (record.implementationVersion !== "1" || record.verificationStatus !== "VERIFIED") {
      fail("CORE_NOT_VERIFIED", `${name} must be implementation v1 and VERIFIED`);
    }
    if (!Array.isArray(record.constructorArguments)) {
      fail("INVALID_SCHEMA", `${name} constructorArguments must be an array`);
    }
    normalizeHash(record.creationBytecodeHash, `${name} creation hash`);
    const runtimeBytecodeHash = normalizeHash(record.runtimeBytecodeHash, `${name} runtime hash`);
    if (normalizeCommit(record.gitCommit, `${name} git commit`) !== gitCommit) {
      fail("CORE_BINDING_MISMATCH", `${name} git commit differs from core release`);
    }
    contracts[name] = { address, runtimeBytecodeHash, record };
  }
  exactKeys(manifest.featureFlags, Object.keys(CORE_FEATURE_FLAGS), "core.featureFlags");
  for (const [name, expected] of Object.entries(CORE_FEATURE_FLAGS)) {
    if (manifest.featureFlags[name] !== expected) {
      fail("UNSAFE_CORE_FLAGS", `core.featureFlags.${name} must be ${expected}`);
    }
  }
  const guardian = normalizeAddress(manifest.protocolGuardian, "core protocol guardian");
  if (guardian.toLowerCase() === deployer.toLowerCase()) {
    fail("ROLE_COLLISION", "core guardian must differ from the deployer");
  }
  const artAdapterArgs = manifest.contracts.ArtAdapterRegistry.constructorArguments;
  const artAgentArgs = manifest.contracts.ArtAgentRegistry.constructorArguments;
  const policyArgs = manifest.contracts.BrokerPolicyModule.constructorArguments;
  const implementationArgs = manifest.contracts.GoghPunkAccountV1.constructorArguments;
  const registryArgs = manifest.contracts.GoghPunkAccountRegistry.constructorArguments;
  if (artAdapterArgs.length !== 1 || artAgentArgs.length !== 1 || policyArgs.length !== 2
    || implementationArgs.length !== 3 || registryArgs.length !== 2) {
    fail("CORE_BINDING_MISMATCH", "core constructor argument counts are wrong");
  }
  sameAddress(artAdapterArgs[0], guardian, "ArtAdapterRegistry guardian");
  sameAddress(artAgentArgs[0], guardian, "ArtAgentRegistry guardian");
  sameAddress(policyArgs[0], guardian, "BrokerPolicyModule guardian");
  sameAddress(policyArgs[1], contracts.ArtAdapterRegistry.address, "policy adapter registry");
  sameAddress(implementationArgs[0], contracts.BrokerPolicyModule.address, "account policy module");
  sameAddress(implementationArgs[1], contracts.ArtAgentRegistry.address, "account agent registry");
  sameAddress(implementationArgs[2], contracts.ArtAdapterRegistry.address, "account adapter registry");
  sameAddress(registryArgs[0], contracts.GoghPunkAccountV1.address, "registry implementation");
  if (normalizeHash(registryArgs[1], "registry constructor salt", { allowZero: true }) !== ZERO_HASH) {
    fail("CORE_BINDING_MISMATCH", "registry constructor salt must be zero");
  }
  return {
    manifestHash: canonicalSha256(manifest),
    gitCommit,
    guardian,
    deployer,
    contracts,
  };
}

function validateCanaryTemplate(template) {
  boundedJson(template, MAX_TEMPLATE_BYTES, "canary manifest template");
  exactKeys(template, [
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
  ], "canary template");
  if (template.status !== "NOT_DEPLOYED" || template.compiler !== "0.8.34"
    || template.evmVersion !== "cancun" || template.optimizerRuns !== 500
    || template.coreDeploymentManifest !== "deployments/robinhood.json"
    || template.coreDeploymentManifestStatusRequired !== "DEPLOYED"
    || template.sourceVerificationAdoption !== null) {
    fail("INVALID_TEMPLATE", "canary template has noncanonical release fields");
  }
  validateChain(template.chain, "canary template.chain");
  sameAddress(template.canonicalCollection, CANONICAL_COLLECTION, "template canonical collection");
  sameAddress(template.canonicalERC6551Registry, CANONICAL_ERC6551_REGISTRY,
    "template canonical registry");
  if (normalizeHash(template.canonicalERC6551RegistryRuntimeCodeHash,
    "template canonical registry hash") !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail("INVALID_TEMPLATE", "template canonical registry hash is wrong");
  }
  for (const field of [
    "coreDeploymentManifestGitCommit", "coreDeploymentManifestSha256",
    "coreGoghPunkAccountRegistry", "coreGoghPunkAccountRegistryRuntimeCodeHash",
    "coreGoghPunkAccountImplementation", "coreGoghPunkAccountImplementationRuntimeCodeHash",
    "controllingPunkTokenId", "expectedActivatedPunkAccount",
    "expectedActivatedPunkAccountRuntimeCodeHash", "expectedOwnerAtPreparation",
    "canaryArtTokenId", "gitCommit",
  ]) {
    if (template[field] !== null) fail("INVALID_TEMPLATE", `template.${field} must remain null`);
  }
  exactKeys(template.contracts, CANARY_DEPLOYMENT_ORDER, "canary template.contracts");
  for (const name of CANARY_DEPLOYMENT_ORDER) {
    const record = template.contracts[name];
    exactKeys(record, [
      "address", "deploymentTransaction", "deploymentBlock", "deploymentBlockHash",
      "receiptStatus", "confirmationsRequired", "confirmationsObserved", "deployer",
      "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
      "verificationStatus",
    ], `canary template.contracts.${name}`);
    for (const field of [
      "address", "deploymentTransaction", "deploymentBlock", "deploymentBlockHash",
      "receiptStatus", "confirmationsObserved", "deployer", "constructorArguments",
      "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    ]) if (record[field] !== null) fail("INVALID_TEMPLATE", `${name}.${field} must remain null`);
    if (record.confirmationsRequired !== 20 || record.verificationStatus !== "NOT_SUBMITTED") {
      fail("INVALID_TEMPLATE", `${name} confirmation/verification defaults are wrong`);
    }
  }
  exactKeys(template.provenanceGate, [
    "status", "dualRpcAgreementRequired", "primaryRpcObservation", "secondaryRpcObservation",
    "commonConfirmedBlockNumber", "commonConfirmedBlockHash", "commonConfirmedBlockTimestamp",
    "confirmationsRequired", "confirmationsObserved", "coreManifestHashVerified",
    "coreRegistryRuntimeHashVerified", "accountImplementationRuntimeHashVerified",
    "activatedAccountRuntimeHashVerified", "canonicalERC6551RegistryRuntimeHashVerified",
    "accountFooterVerified", "expectedOwnerVerified", "constructorInputsVerified",
    "cleanPreconfigurationState", "verifiedAt",
  ], "canary template.provenanceGate");
  if (template.provenanceGate.status !== "BLOCKED"
    || template.provenanceGate.dualRpcAgreementRequired !== true
    || template.provenanceGate.confirmationsRequired !== 20
    || template.provenanceGate.cleanPreconfigurationState !== null
    || template.provenanceGate.primaryRpcObservation !== null
    || template.provenanceGate.secondaryRpcObservation !== null
    || template.provenanceGate.commonConfirmedBlockNumber !== null
    || template.provenanceGate.commonConfirmedBlockHash !== null
    || template.provenanceGate.commonConfirmedBlockTimestamp !== null
    || template.provenanceGate.confirmationsObserved !== null
    || template.provenanceGate.verifiedAt !== null) {
    fail("INVALID_TEMPLATE", "canary template provenance gate must remain blocked and empty");
  }
  for (const field of [
    "coreManifestHashVerified", "coreRegistryRuntimeHashVerified",
    "accountImplementationRuntimeHashVerified", "activatedAccountRuntimeHashVerified",
    "canonicalERC6551RegistryRuntimeHashVerified", "accountFooterVerified",
    "expectedOwnerVerified", "constructorInputsVerified",
  ]) {
    if (template.provenanceGate[field] !== false) {
      fail("INVALID_TEMPLATE", `template.provenanceGate.${field} must remain false`);
    }
  }
  exactKeys(template.ownerObservations, [
    "preparation", "afterCanaryArtReceipt", "afterCanaryAdapterReceipt",
  ], "canary template.ownerObservations");
  exactKeys(template.ownerObservations.preparation, [
    "expectedOwner", "observedOwner", "blockNumber", "blockHash", "blockTimestamp",
  ], "canary template.ownerObservations.preparation");
  if (Object.values(template.ownerObservations.preparation).some((value) => value !== null)
    || template.ownerObservations.afterCanaryArtReceipt !== null
    || template.ownerObservations.afterCanaryAdapterReceipt !== null) {
    fail("INVALID_TEMPLATE", "canary template owner observations must remain empty");
  }
  exactKeys(template.configuration, [
    "deploymentAuthorized", "broadcastAttempted", "adapterRegistered", "policyConfigured",
    "ownerApprovedMintsEnabled", "agentAuthorized", "approvalPurchasesEnabled",
    "autonomousPurchasesEnabled", "autonomousMintsEnabled", "mintExecuted",
  ], "canary template.configuration");
  if (Object.values(template.configuration).some((value) => value !== false)) {
    fail("INVALID_TEMPLATE", "all template configuration flags must be false");
  }
}

function validateImmutableReferences(references, byteLength, label) {
  plainObject(references, label);
  const ranges = [];
  for (const [identifier, entries] of Object.entries(references)) {
    if (!/^\d+$/.test(identifier) || !Array.isArray(entries)) {
      fail("INVALID_COMPILED_ARTIFACT", `${label} is malformed`);
    }
    for (const [index, entry] of entries.entries()) {
      exactKeys(entry, ["start", "length"], `${label}.${identifier}[${index}]`);
      const start = safeNumber(entry.start, `${label} start`);
      const length = safeNumber(entry.length, `${label} length`, { positive: true });
      if (length !== 32 || start + length > byteLength) {
        fail("INVALID_COMPILED_ARTIFACT", `${label} contains an invalid immutable range`);
      }
      ranges.push({ start, length });
    }
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].start + ranges[index - 1].length) {
      fail("INVALID_COMPILED_ARTIFACT", `${label} immutable ranges overlap`);
    }
  }
  return ranges;
}

function maskedRuntimeHash(bytecode, ranges) {
  const bytes = bytecode.slice(2).match(/.{2}/g);
  for (const { start, length } of ranges) bytes.fill("00", start, start + length);
  return keccak256(`0x${bytes.join("")}`);
}

function compiledSourceIdentity(name, artifact, metadata) {
  if (!Array.isArray(artifact.abi) || artifact.abi.length > 2_000) {
    fail("INVALID_COMPILED_ARTIFACT", `${name} ABI is invalid`);
  }
  const sources = plainObject(metadata.sources, `${name} metadata sources`);
  const paths = Object.keys(sources).sort();
  if (paths.length === 0 || paths.length > 512) {
    fail("INVALID_COMPILED_ARTIFACT", `${name} metadata source set is invalid`);
  }
  const sourceHashes = Object.fromEntries(paths.map((path) => {
    const entry = plainObject(sources[path], `${name} metadata source ${path}`);
    if (typeof entry.keccak256 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(entry.keccak256)) {
      fail("INVALID_COMPILED_ARTIFACT", `${name} metadata source ${path} lacks keccak256`);
    }
    return [path, entry.keccak256.toLowerCase()];
  }));
  return {
    rawMetadataSha256:
      `0x${createHash("sha256").update(artifact.rawMetadata).digest("hex")}`,
    sourceSetSha256: canonicalSha256(sourceHashes),
    compilerSettingsSha256: canonicalSha256(metadata.settings),
    abiSha256: canonicalSha256(artifact.abi),
  };
}

function normalizeCompiledArtifact(name, artifact) {
  boundedJson(artifact, MAX_JSON_BYTES, `${name} compiled artifact`);
  requiredAllowedKeys(artifact,
    ["abi", "bytecode", "deployedBytecode", "methodIdentifiers", "rawMetadata", "metadata", "id"],
    ["abi", "bytecode", "deployedBytecode", "methodIdentifiers", "rawMetadata", "metadata", "id"],
    `${name} compiled artifact`);
  requiredAllowedKeys(artifact.bytecode, ["object", "sourceMap", "linkReferences"],
    ["object", "sourceMap", "linkReferences"], `${name}.bytecode`);
  requiredAllowedKeys(artifact.deployedBytecode, ["object", "sourceMap", "linkReferences"],
    ["object", "sourceMap", "linkReferences", "immutableReferences"], `${name}.deployedBytecode`);
  if (Object.keys(plainObject(artifact.bytecode.linkReferences, `${name} creation links`)).length
    || Object.keys(plainObject(artifact.deployedBytecode.linkReferences, `${name} runtime links`)).length) {
    fail("UNRESOLVED_LIBRARY_LINK", `${name} contains library links`);
  }
  const creationBytecode = normalizeBytecode(artifact.bytecode.object, `${name} creation bytecode`);
  const deployedBytecode = normalizeBytecode(
    artifact.deployedBytecode.object,
    `${name} deployed bytecode`,
  );
  let metadata;
  try {
    metadata = JSON.parse(artifact.rawMetadata);
  } catch {
    fail("INVALID_COMPILED_ARTIFACT", `${name} rawMetadata is invalid`);
  }
  const sourcePath = name === "GoghOneShotCanaryArt"
    ? "contracts/src/canary/GoghOneShotCanaryArt.sol"
    : "contracts/src/adapters/GoghOneShotCanaryMintAdapter.sol";
  const target = metadata?.settings?.compilationTarget;
  if (metadata?.compiler?.version !== "0.8.34+commit.80d5c536"
    || metadata?.settings?.optimizer?.enabled !== true
    || metadata?.settings?.optimizer?.runs !== 500
    || metadata?.settings?.evmVersion !== "cancun"
    || metadata?.settings?.viaIR !== true
    || metadata?.settings?.metadata?.bytecodeHash !== "none"
    || target?.[sourcePath] !== name || Object.keys(target ?? {}).length !== 1) {
    fail("WRONG_COMPILER_SETTINGS", `${name} does not match canonical release settings`);
  }
  const suppliedReferences = artifact.deployedBytecode.immutableReferences;
  if (suppliedReferences === null || (suppliedReferences !== undefined
    && (typeof suppliedReferences !== "object" || Array.isArray(suppliedReferences)))) {
    fail("INVALID_COMPILED_ARTIFACT", `${name}.immutableReferences must be an object`);
  }
  const immutableRanges = validateImmutableReferences(
    suppliedReferences ?? {},
    (deployedBytecode.length - 2) / 2,
    `${name}.immutableReferences`,
  );
  const sourceIdentity = compiledSourceIdentity(name, artifact, metadata);
  return {
    creationBytecode,
    deployedBytecode,
    immutableRanges,
    creationBytecodeHash: keccak256(creationBytecode),
    deployedBytecodeTemplateHash: keccak256(deployedBytecode),
    maskedDeployedBytecodeHash: maskedRuntimeHash(deployedBytecode, immutableRanges),
    ...sourceIdentity,
  };
}

function normalizeCompiledArtifacts(compiledArtifacts) {
  exactKeys(compiledArtifacts, CANARY_DEPLOYMENT_ORDER, "compiledArtifacts");
  return Object.fromEntries(CANARY_DEPLOYMENT_ORDER.map((name) => [
    name,
    normalizeCompiledArtifact(name, compiledArtifacts[name]),
  ]));
}

function constructorDefinition(name, context) {
  if (name === "GoghOneShotCanaryArt") {
    return {
      types: [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      values: [
        context.coreRegistry,
        context.expectedAccount,
        context.punkTokenId,
        context.canaryArtTokenId,
      ],
    };
  }
  if (name === "GoghOneShotCanaryMintAdapter") {
    return {
      types: [{ type: "address" }],
      values: [context.artAddress],
    };
  }
  fail("UNKNOWN_CONTRACT", `${name} is not a one-shot canary contract`);
}

function validateArtifactReceiptSchema(receipt, index) {
  requiredAllowedKeys(receipt, [
    "status", "transactionHash", "transactionIndex", "blockHash", "blockNumber", "from", "to",
    "contractAddress",
  ], [
    "status", "cumulativeGasUsed", "logs", "logsBloom", "type", "transactionHash",
    "transactionIndex", "blockHash", "blockNumber", "gasUsed", "effectiveGasPrice", "from", "to",
    "contractAddress", "gasUsedForL1", "l1BlockNumber",
  ], `artifact.receipts[${index}]`);
  if (receipt.logs !== undefined && (!Array.isArray(receipt.logs) || receipt.logs.length > 2_000)) {
    fail("INVALID_SCHEMA", `artifact.receipts[${index}].logs is invalid`);
  }
}

function successfulReceipt(value, label) {
  if (value !== "success" && value !== "0x1" && value !== 1 && value !== 1n) {
    fail("FAILED_RECEIPT", `${label} is not successful`);
  }
}

function parseDeploymentReturn(value) {
  if (typeof value !== "string" || value.length > 1_000) {
    fail("INVALID_RETURN_BINDING", "deployment return is malformed");
  }
  const match = /^\(\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*\)$/.exec(value);
  if (!match) fail("INVALID_RETURN_BINDING", "deployment return is malformed");
  return match.slice(1).map((item) => item.trim());
}

function normalizeExpectedCanary(value) {
  exactKeys(value, [
    "controllingPunkTokenId", "expectedActivatedPunkAccount", "expectedOwnerAtPreparation",
    "canaryArtTokenId",
  ], "expectedCanary");
  return {
    punkTokenId: parseUint(value.controllingPunkTokenId, "expected controlling Punk token ID"),
    account: normalizeAddress(value.expectedActivatedPunkAccount, "expected activated Punk Account"),
    owner: normalizeAddress(value.expectedOwnerAtPreparation, "expected owner at preparation"),
    canaryArtTokenId: parseUint(value.canaryArtTokenId, "expected canary art token ID"),
  };
}

function normalizeFoundryArtifact(artifact, releaseCommit, compiled, core, expected) {
  boundedJson(artifact, MAX_JSON_BYTES, "Foundry artifact");
  exactKeys(artifact, [
    "transactions", "receipts", "libraries", "pending", "returns", "timestamp", "chain", "commit",
  ], "Foundry artifact");
  if (artifact.chain !== ROBINHOOD_CHAIN_ID) fail("WRONG_CHAIN", "artifact chain must be 4663");
  const foundryArtifactCommit = normalizeFoundryCommit(artifact.commit);
  if (!releaseCommit.startsWith(foundryArtifactCommit)) {
    fail("ARTIFACT_COMMIT_MISMATCH", "artifact commit is not a prefix of the release commit");
  }
  safeNumber(artifact.timestamp, "artifact timestamp", { positive: true });
  if (!Array.isArray(artifact.pending) || artifact.pending.length !== 0
    || !Array.isArray(artifact.libraries) || artifact.libraries.length !== 0) {
    fail("AMBIGUOUS_ARTIFACT", "pending and libraries must be exact empty arrays");
  }
  if (!Array.isArray(artifact.transactions) || artifact.transactions.length !== 2
    || !Array.isArray(artifact.receipts) || artifact.receipts.length !== 2) {
    fail("AMBIGUOUS_ARTIFACT", "artifact must contain exactly two transactions and receipts");
  }

  const context = {
    coreRegistry: core.contracts.GoghPunkAccountRegistry.address,
    expectedAccount: expected.account,
    punkTokenId: expected.punkTokenId,
    canaryArtTokenId: expected.canaryArtTokenId,
  };
  const transactionFacts = [];
  let deployer;
  let previousNonce;
  const hashes = new Set();
  const addresses = new Set();
  for (const [index, transaction] of artifact.transactions.entries()) {
    const name = CANARY_DEPLOYMENT_ORDER[index];
    exactKeys(transaction, [
      "hash", "transactionType", "contractName", "contractAddress", "function", "arguments",
      "transaction", "additionalContracts", "isFixedGasLimit",
    ], `artifact.transactions[${index}]`);
    requiredAllowedKeys(transaction.transaction,
      ["from", "gas", "value", "input", "nonce", "chainId"],
      ["from", "to", "gas", "value", "input", "nonce", "chainId"],
      `${name}.transaction`);
    if (transaction.transactionType !== "CREATE" || transaction.contractName !== name
      || transaction.function !== null || transaction.isFixedGasLimit !== false) {
      fail("WRONG_CREATION_ORDER", `transaction ${index} is not the canonical ${name} creation`);
    }
    if (!Array.isArray(transaction.additionalContracts)
      || transaction.additionalContracts.length !== 0) {
      fail("AMBIGUOUS_CREATION", `${name}.additionalContracts must be empty`);
    }
    if (transaction.transaction.to !== undefined && transaction.transaction.to !== null) {
      fail("NOT_CREATION_TRANSACTION", `${name} unexpectedly has a target`);
    }
    if (parseUint(transaction.transaction.chainId, `${name} chain ID`)
      !== BigInt(ROBINHOOD_CHAIN_ID)
      || parseUint(transaction.transaction.value, `${name} value`) !== 0n) {
      fail("UNSAFE_CREATION", `${name} chain or value is wrong`);
    }
    const sender = normalizeAddress(transaction.transaction.from, `${name} deployer`);
    if (deployer && deployer.toLowerCase() !== sender.toLowerCase()) {
      fail("MULTIPLE_DEPLOYERS", "both creations must use one deployer");
    }
    deployer = sender;
    const nonce = parseUint(transaction.transaction.nonce, `${name} nonce`);
    if (previousNonce !== undefined && nonce !== previousNonce + 1n) {
      fail("NONCONSECUTIVE_CREATIONS", "canary creation nonces must be consecutive");
    }
    previousNonce = nonce;
    const address = normalizeAddress(transaction.contractAddress, `${name} address`);
    const predicted = getContractAddress({ from: sender, nonce });
    sameAddress(address, predicted, `${name} CREATE address`);
    const transactionHash = normalizeHash(transaction.hash, `${name} transaction hash`);
    if (addresses.has(address.toLowerCase()) || hashes.has(transactionHash)) {
      fail("DUPLICATE_CREATION", `${name} reuses an address or transaction hash`);
    }
    addresses.add(address.toLowerCase());
    hashes.add(transactionHash);
    if (name === "GoghOneShotCanaryArt") context.artAddress = address;
    if (!Array.isArray(transaction.arguments)) {
      fail("MISSING_CONSTRUCTOR_ARGS", `${name} arguments must be an array`);
    }
    const definition = constructorDefinition(name, context);
    if (transaction.arguments.length !== definition.values.length) {
      fail("CONSTRUCTOR_ARGS_MISMATCH", `${name} argument count is wrong`);
    }
    const constructorArguments = definition.types.map((type, argumentIndex) => {
      const supplied = transaction.arguments[argumentIndex];
      const expectedValue = definition.values[argumentIndex];
      if (type.type === "address") {
        return sameAddress(supplied, expectedValue, `${name} argument ${argumentIndex}`);
      }
      const suppliedUint = parseUint(supplied, `${name} argument ${argumentIndex}`);
      if (suppliedUint !== expectedValue) {
        fail("CONSTRUCTOR_ARGS_MISMATCH", `${name} argument ${argumentIndex} is wrong`);
      }
      return suppliedUint;
    });
    const encodedArguments = encodeAbiParameters(definition.types, constructorArguments);
    const expectedInput = `${compiled[name].creationBytecode}${encodedArguments.slice(2)}`;
    const artifactInput = normalizeBytecode(transaction.transaction.input, `${name} input`);
    if (artifactInput !== expectedInput.toLowerCase()) {
      fail("COMPILED_INITCODE_MISMATCH", `${name} input differs from compiled code plus args`);
    }
    transactionFacts.push({
      name,
      address,
      transactionHash,
      artifactInput,
      deployer: sender,
      nonce,
      constructorArguments: constructorArguments.map((item) => (
        typeof item === "bigint" ? item.toString() : item
      )),
      compiled: compiled[name],
    });
  }
  if (deployer.toLowerCase() === core.guardian.toLowerCase()) {
    fail("ROLE_COLLISION", "canary deployer must differ from the protocol guardian");
  }
  if (deployer.toLowerCase() === expected.owner.toLowerCase()) {
    fail("ROLE_COLLISION", "canary deployer must differ from the Punk owner");
  }

  exactKeys(artifact.returns, ["deployment"], "artifact.returns");
  exactKeys(artifact.returns.deployment, ["internal_type", "value"], "artifact.returns.deployment");
  if (artifact.returns.deployment.internal_type !== "struct DeployOneShotCanary.Deployment") {
    fail("INVALID_RETURN_BINDING", "artifact deployment return type is wrong");
  }
  const returned = parseDeploymentReturn(artifact.returns.deployment.value);
  sameAddress(returned[0], transactionFacts[0].address, "returned canary art");
  sameAddress(returned[1], transactionFacts[1].address, "returned canary adapter");
  sameAddress(returned[2], expected.owner, "returned current owner at preparation");

  const receipts = new Map();
  artifact.receipts.forEach((receipt, index) => {
    validateArtifactReceiptSchema(receipt, index);
    const hash = normalizeHash(receipt.transactionHash, `artifact receipt ${index} hash`);
    if (receipts.has(hash)) fail("DUPLICATE_RECEIPT", `artifact receipt ${index} is duplicated`);
    receipts.set(hash, receipt);
  });
  for (const fact of transactionFacts) {
    const receipt = receipts.get(fact.transactionHash);
    if (!receipt) fail("MISSING_RECEIPT", `${fact.name} receipt is missing`);
    successfulReceipt(receipt.status, `${fact.name} artifact receipt`);
    sameAddress(receipt.contractAddress, fact.address, `${fact.name} receipt contract`);
    sameAddress(receipt.from, fact.deployer, `${fact.name} receipt deployer`);
    if (receipt.to !== null) fail("NOT_CREATION_RECEIPT", `${fact.name} receipt target must be null`);
    fact.deploymentBlock = safeNumber(receipt.blockNumber, `${fact.name} deployment block`, {
      positive: true,
    });
    fact.deploymentBlockHash = normalizeHash(receipt.blockHash, `${fact.name} block hash`);
    fact.transactionIndex = safeNumber(receipt.transactionIndex, `${fact.name} transaction index`);
  }
  if (receipts.size !== 2) fail("AMBIGUOUS_RECEIPTS", "artifact has unmatched receipts");
  const [art, adapter] = transactionFacts;
  if (adapter.deploymentBlock < art.deploymentBlock
    || (adapter.deploymentBlock === art.deploymentBlock
      && adapter.transactionIndex <= art.transactionIndex)) {
    fail("WRONG_CREATION_ORDER", "adapter receipt must be ordered after canary art receipt");
  }
  return { records: transactionFacts, deployer, foundryArtifactCommit };
}

function validateSourceProvenance(provenance, releaseCommit, foundryArtifactCommit) {
  exactKeys(provenance, [
    "releaseGitCommit", "headCommit", "artifactResolvedCommit", "foundryArtifactCommit",
    "fullWorktreeClean", "offlineBuildCompleted", "offlineBuildCommand",
  ], "sourceProvenance");
  for (const field of ["releaseGitCommit", "headCommit", "artifactResolvedCommit"]) {
    if (normalizeCommit(provenance[field], `sourceProvenance.${field}`) !== releaseCommit) {
      fail("SOURCE_PROVENANCE_MISMATCH", `${field} does not equal the release commit`);
    }
  }
  if (normalizeFoundryCommit(provenance.foundryArtifactCommit) !== foundryArtifactCommit
    || provenance.fullWorktreeClean !== true || provenance.offlineBuildCompleted !== true
    || canonicalJson(provenance.offlineBuildCommand)
      !== canonicalJson(["forge", "build", "--offline", "--force"])) {
    fail("SOURCE_PROVENANCE_MISMATCH", "clean full-tree offline release provenance is required");
  }
}

async function defaultProgramRunner(executable, arguments_, options) {
  return execFileAsync(executable, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 2_000_000,
  });
}

function commandCommit(stdout, label) {
  return normalizeCommit(typeof stdout === "string" ? stdout.trim() : "", label);
}

export async function verifyCanaryCliSourceProvenance({
  releaseGitCommit,
  foundryArtifactCommit,
  cwd = projectRoot,
  runProgram = defaultProgramRunner,
}) {
  const releaseCommit = normalizeCommit(releaseGitCommit, "release git commit");
  const foundryCommit = normalizeFoundryCommit(foundryArtifactCommit);
  if (typeof runProgram !== "function") fail("INVALID_RUNNER", "runProgram must be a function");
  const run = async (executable, arguments_, label) => {
    try {
      return await runProgram(executable, arguments_, { cwd });
    } catch {
      fail("SOURCE_PROVENANCE_FAILED", `${label} failed closed`);
    }
  };
  const inspect = async () => {
    const [head, artifactCommit, status] = await Promise.all([
      run("git", ["rev-parse", "--verify", "HEAD^{commit}"], "HEAD resolution"),
      run("git", ["rev-parse", "--verify", `${foundryCommit}^{commit}`],
        "Foundry artifact commit resolution"),
      run("git", ["status", "--porcelain=v1", "--untracked-files=all"], "full worktree status"),
    ]);
    const headCommit = commandCommit(head?.stdout, "resolved HEAD");
    const artifactResolvedCommit = commandCommit(artifactCommit?.stdout, "resolved artifact commit");
    if (headCommit !== releaseCommit || artifactResolvedCommit !== releaseCommit) {
      fail("SOURCE_PROVENANCE_MISMATCH", "HEAD and artifact commit must resolve to release commit");
    }
    if (typeof status?.stdout !== "string" || status.stdout.trim() !== "") {
      fail("DIRTY_RELEASE_TREE", "the full release worktree must be clean");
    }
    return { headCommit, artifactResolvedCommit };
  };
  await inspect();
  await run("forge", ["build", "--offline", "--force"], "offline canonical rebuild");
  const resolved = await inspect();
  return Object.freeze({
    releaseGitCommit: releaseCommit,
    headCommit: resolved.headCommit,
    artifactResolvedCommit: resolved.artifactResolvedCommit,
    foundryArtifactCommit: foundryCommit,
    fullWorktreeClean: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: Object.freeze(["forge", "build", "--offline", "--force"]),
  });
}

function normalizeEndpointEntries(entries) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    fail("INSUFFICIENT_READ_CLIENTS", "exactly two read-only RPC endpoints are required");
  }
  const origins = new Set();
  const providers = new Set();
  const clients = new Set();
  return entries.map((entry, index) => {
    exactKeys(entry, ["provider", "origin", "client"], `readEndpoints[${index}]`);
    if (typeof entry.provider !== "string" || entry.provider.trim() !== entry.provider
      || entry.provider.length === 0 || entry.provider.length > 128) {
      fail("INVALID_PROVIDER", `read endpoint ${index + 1} provider is invalid`);
    }
    const providerKey = entry.provider.toLowerCase();
    if (providers.has(providerKey)) fail("DUPLICATE_PROVIDER", "RPC provider labels must differ");
    providers.add(providerKey);
    let origin;
    try {
      const url = new URL(entry.origin);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
        || url.pathname !== "/" || url.origin !== entry.origin) throw new TypeError();
      origin = url.origin;
    } catch {
      fail("INVALID_ENDPOINT_ORIGIN", `endpoint ${index + 1} needs a credential-free HTTPS origin`);
    }
    if (origins.has(origin)) fail("DUPLICATE_ENDPOINT_ORIGIN", "RPC origins must differ");
    origins.add(origin);
    if (!entry.client || typeof entry.client !== "object" || clients.has(entry.client)) {
      fail("DUPLICATE_READ_CLIENT", "RPC clients must be distinct objects");
    }
    clients.add(entry.client);
    const transportUrl = entry.client?.transport?.url ?? entry.client?.transport?.value?.url;
    let transportOrigin;
    try {
      transportOrigin = new URL(transportUrl).origin;
    } catch {
      fail("UNBOUND_ENDPOINT_ORIGIN", `endpoint ${index + 1} has no transport URL provenance`);
    }
    if (transportOrigin !== origin) {
      fail("UNBOUND_ENDPOINT_ORIGIN", `endpoint ${index + 1} origin differs from its client`);
    }
    for (const method of [
      "getChainId", "getBlockNumber", "getBlock", "getTransactionReceipt", "getTransaction",
      "getCode", "readContract", "getLogs",
    ]) {
      if (typeof entry.client[method] !== "function") {
        fail("INVALID_READ_CLIENT", `endpoint ${index + 1} lacks ${method}`);
      }
    }
    return { provider: entry.provider, origin, client: entry.client };
  });
}

async function pinnedBlockForEndpoints(endpoints, confirmations) {
  const heads = await Promise.all(endpoints.map(async ({ client }, index) => {
    try {
      const chainId = await client.getChainId();
      if (Number(chainId) !== ROBINHOOD_CHAIN_ID) {
        fail("WRONG_CHAIN", `endpoint ${index + 1} is not chain 4663`);
      }
      return parseUint(await client.getBlockNumber(), `endpoint ${index + 1} head`, {
        positive: true,
      });
    } catch (error) {
      if (error instanceof CanaryManifestProposalError) throw error;
      fail("LIVE_READ_FAILED", `endpoint ${index + 1} head read failed`);
    }
  }));
  const minimumHead = heads.reduce((minimum, value) => value < minimum ? value : minimum);
  const maximumHead = heads.reduce((maximum, value) => value > maximum ? value : maximum);
  if (maximumHead - minimumHead > MAX_HEAD_SKEW) {
    fail("RPC_HEAD_SKEW", `RPC heads differ by more than ${MAX_HEAD_SKEW} blocks`);
  }
  if (minimumHead <= BigInt(confirmations)) {
    fail("UNCONFIRMED_CHAIN", "chain head is too low for requested confirmation depth");
  }
  const number = minimumHead - BigInt(confirmations);
  const blocks = await Promise.all(endpoints.map(async ({ client }, index) => {
    try {
      return await client.getBlock({ blockNumber: number, includeTransactions: false });
    } catch {
      fail("LIVE_READ_FAILED", `endpoint ${index + 1} confirmed block read failed`);
    }
  }));
  const normalized = blocks.map((block, index) => {
    if (parseUint(block?.number, `endpoint ${index + 1} confirmed block`) !== number) {
      fail("PINNED_BLOCK_MISMATCH", `endpoint ${index + 1} returned the wrong block`);
    }
    return {
      hash: normalizeHash(block.hash, `endpoint ${index + 1} confirmed block hash`),
      timestamp: blockTimestampIso(block.timestamp, `endpoint ${index + 1} confirmed timestamp`),
    };
  });
  if (new Set(normalized.map((item) => item.hash)).size !== 1
    || new Set(normalized.map((item) => item.timestamp)).size !== 1) {
    fail("RPC_DISAGREEMENT", "RPCs disagree on the common confirmed block");
  }
  return {
    number,
    hash: normalized[0].hash,
    timestamp: normalized[0].timestamp,
    heads,
  };
}

function normalizeBlockTransactionHash(value, label) {
  return normalizeHash(typeof value === "string" ? value : value?.hash, label);
}

async function scanLogsInChunks(client, request, label) {
  const fromBlock = parseUint(request.fromBlock, `${label} fromBlock`);
  const toBlock = parseUint(request.toBlock, `${label} toBlock`);
  if (fromBlock > toBlock) fail("INVALID_LOG_RANGE", `${label} range is reversed`);
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_BLOCK_RANGE) {
    const end = start + MAX_LOG_BLOCK_RANGE - 1n > toBlock
      ? toBlock
      : start + MAX_LOG_BLOCK_RANGE - 1n;
    try {
      const page = await client.getLogs({ ...request, fromBlock: start, toBlock: end });
      if (!Array.isArray(page) || page.length > 10_000) {
        fail("INVALID_LOG_EVIDENCE", `${label} returned an invalid page`);
      }
      logs.push(...page);
    } catch (error) {
      if (error instanceof CanaryManifestProposalError) throw error;
      fail("LIVE_READ_FAILED", `${label} log scan failed`);
    }
  }
  return logs;
}

async function verifyCreationOnEndpoint(endpoint, endpointIndex, records, pinned, head) {
  const evidence = [];
  for (const record of records) {
    if (BigInt(record.deploymentBlock) > pinned.number) {
      fail("UNCONFIRMED_DEPLOYMENT", `${record.name} is newer than the common confirmed block`);
    }
    let receipt;
    let transaction;
    let runtimeAtPin;
    let runtimeAtReceipt;
    let deploymentBlock;
    try {
      [receipt, transaction, runtimeAtPin, runtimeAtReceipt, deploymentBlock] = await Promise.all([
        endpoint.client.getTransactionReceipt({ hash: record.transactionHash }),
        endpoint.client.getTransaction({ hash: record.transactionHash }),
        endpoint.client.getCode({ address: record.address, blockNumber: pinned.number }),
        endpoint.client.getCode({
          address: record.address,
          blockNumber: BigInt(record.deploymentBlock),
        }),
        endpoint.client.getBlock({
          blockNumber: BigInt(record.deploymentBlock),
          includeTransactions: false,
        }),
      ]);
    } catch {
      fail("LIVE_READ_FAILED", `${record.name} live deployment read failed on RPC ${endpointIndex + 1}`);
    }
    successfulReceipt(receipt?.status, `${record.name} live receipt`);
    if (normalizeHash(receipt.transactionHash, `${record.name} receipt hash`)
      !== record.transactionHash
      || safeNumber(receipt.blockNumber, `${record.name} receipt block`, { positive: true })
        !== record.deploymentBlock
      || normalizeHash(receipt.blockHash, `${record.name} receipt block hash`)
        !== record.deploymentBlockHash
      || safeNumber(receipt.transactionIndex, `${record.name} receipt index`)
        !== record.transactionIndex) {
      fail("LIVE_RECEIPT_MISMATCH", `${record.name} live receipt differs from artifact`);
    }
    sameAddress(receipt.contractAddress, record.address, `${record.name} receipt contract`);
    sameAddress(receipt.from, record.deployer, `${record.name} receipt deployer`);
    if (receipt.to !== null) fail("NOT_CREATION_RECEIPT", `${record.name} receipt target is non-null`);

    if (normalizeHash(transaction?.hash, `${record.name} transaction hash`) !== record.transactionHash
      || normalizeBytecode(transaction.input, `${record.name} transaction input`)
        !== record.artifactInput
      || parseUint(transaction.value, `${record.name} transaction value`) !== 0n
      || parseUint(transaction.chainId, `${record.name} transaction chain`) !== 4663n
      || parseUint(transaction.nonce, `${record.name} transaction nonce`) !== record.nonce
      || safeNumber(transaction.blockNumber, `${record.name} transaction block`, { positive: true })
        !== record.deploymentBlock
      || normalizeHash(transaction.blockHash, `${record.name} transaction block hash`)
        !== record.deploymentBlockHash
      || safeNumber(transaction.transactionIndex, `${record.name} transaction index`)
        !== record.transactionIndex) {
      fail("LIVE_TRANSACTION_MISMATCH", `${record.name} live transaction differs from artifact`);
    }
    sameAddress(transaction.from, record.deployer, `${record.name} transaction deployer`);
    if (transaction.to !== null) {
      fail("NOT_CREATION_TRANSACTION", `${record.name} transaction target is non-null`);
    }

    if (parseUint(deploymentBlock?.number, `${record.name} block number`)
      !== BigInt(record.deploymentBlock)
      || normalizeHash(deploymentBlock.hash, `${record.name} block hash`)
        !== record.deploymentBlockHash
      || !Array.isArray(deploymentBlock.transactions)) {
      fail("DEPLOYMENT_BLOCK_MISMATCH", `${record.name} deployment block is inconsistent`);
    }
    const blockTransactions = deploymentBlock.transactions.map((item, index) => (
      normalizeBlockTransactionHash(item, `${record.name} block transaction ${index}`)
    ));
    if (!blockTransactions.includes(record.transactionHash)) {
      fail("TRANSACTION_NOT_IN_BLOCK", `${record.name} transaction is absent from its block`);
    }
    const pinnedCode = normalizeBytecode(runtimeAtPin, `${record.name} pinned runtime`);
    const receiptCode = normalizeBytecode(runtimeAtReceipt, `${record.name} receipt runtime`);
    if (pinnedCode !== receiptCode
      || (pinnedCode.length - 2) !== (record.compiled.deployedBytecode.length - 2)
      || maskedRuntimeHash(pinnedCode, record.compiled.immutableRanges)
        !== record.compiled.maskedDeployedBytecodeHash) {
      fail("COMPILED_RUNTIME_MISMATCH", `${record.name} runtime differs from clean compiled output`);
    }
    // Provider heads may differ while both providers agree on the same confirmed pin. Keep the
    // shared creation evidence deterministic by measuring depth only through that common pin;
    // each provider's actual head is recorded separately in its observation.
    const confirmationsObserved = pinned.number - BigInt(record.deploymentBlock) + 1n;
    if (confirmationsObserved < BigInt(MIN_CONFIRMATIONS)) {
      fail("UNCONFIRMED_DEPLOYMENT", `${record.name} has fewer than 20 confirmations`);
    }
    evidence.push({
      name: record.name,
      address: record.address.toLowerCase(),
      transactionHash: record.transactionHash,
      deploymentBlock: record.deploymentBlock,
      deploymentBlockHash: record.deploymentBlockHash,
      transactionIndex: record.transactionIndex,
      runtimeBytecodeHash: keccak256(pinnedCode),
      confirmationsObserved: safeNumber(confirmationsObserved, `${record.name} confirmations`),
      compiledCreationBytecodeHash: record.compiled.creationBytecodeHash,
      compiledDeployedBytecodeTemplateHash: record.compiled.deployedBytecodeTemplateHash,
      compiledMaskedDeployedBytecodeHash: record.compiled.maskedDeployedBytecodeHash,
      rawMetadataSha256: record.compiled.rawMetadataSha256,
      sourceSetSha256: record.compiled.sourceSetSha256,
      compilerSettingsSha256: record.compiled.compilerSettingsSha256,
      abiSha256: record.compiled.abiSha256,
    });
  }
  return evidence;
}

async function checkedRead(endpoint, endpointIndex, blockNumber, address, abi, functionName, args = []) {
  try {
    return await endpoint.client.readContract({ address, abi, functionName, args, blockNumber });
  } catch {
    fail("LIVE_BINDING_READ_FAILED", `${functionName} failed on RPC ${endpointIndex + 1}`);
  }
}

async function checkedCodeHash(endpoint, endpointIndex, blockNumber, address, expectedHash, label) {
  let code;
  try {
    code = await endpoint.client.getCode({ address, blockNumber });
  } catch {
    fail("LIVE_READ_FAILED", `${label} code read failed on RPC ${endpointIndex + 1}`);
  }
  const runtimeBytecodeHash = keccak256(normalizeBytecode(code, `${label} runtime`));
  if (expectedHash && runtimeBytecodeHash !== expectedHash.toLowerCase()) {
    fail("CODE_HASH_MISMATCH", `${label} runtime hash differs from authoritative evidence`);
  }
  return runtimeBytecodeHash;
}

function normalizeFeatureTuple(value) {
  const result = {};
  for (const [index, name] of Object.keys(SAFE_INITIAL_FEATURE_FLAGS).entries()) {
    result[name] = expectBoolean(
      tupleField(value, name, index),
      SAFE_INITIAL_FEATURE_FLAGS[name],
      `featureFlags.${name}`,
    );
  }
  return result;
}

function normalizeDefaultPolicy(value) {
  const config = tupleField(value, "config", 0);
  const numericFields = [
    "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice", "minimumNativeReserve",
  ];
  const normalizedConfig = { mode: Number(expectUint(tupleField(config, "mode", 0), 0, "policy.mode")) };
  numericFields.forEach((name, offset) => {
    normalizedConfig[name] = expectUint(tupleField(config, name, offset + 1), 0, `policy.${name}`)
      .toString();
  });
  normalizedConfig.maxAcquisitionsPerDay = Number(expectUint(
    tupleField(config, "maxAcquisitionsPerDay", 7), 0, "policy.maxAcquisitionsPerDay",
  ));
  normalizedConfig.maxIntentAge = Number(expectUint(
    tupleField(config, "maxIntentAge", 8), 0, "policy.maxIntentAge",
  ));
  normalizedConfig.maxSlippageBps = Number(expectUint(
    tupleField(config, "maxSlippageBps", 9), 0, "policy.maxSlippageBps",
  ));
  normalizedConfig.requireCollectionAllowlist = expectBoolean(
    tupleField(config, "requireCollectionAllowlist", 10), false,
    "policy.requireCollectionAllowlist",
  );
  normalizedConfig.allowUnknownCollections = expectBoolean(
    tupleField(config, "allowUnknownCollections", 11), false,
    "policy.allowUnknownCollections",
  );
  const configuredBy = sameAddress(
    tupleField(value, "configuredBy", 1),
    ZERO_ADDRESS,
    "policy.configuredBy",
    { allowZero: true },
  );
  const version = Number(expectUint(tupleField(value, "version", 2), 0, "policy.version"));
  const permissionGeneration = Number(expectUint(
    tupleField(value, "permissionGeneration", 3), 0, "policy.permissionGeneration",
  ));
  const accountPaused = expectBoolean(
    tupleField(value, "accountPaused", 4), false, "policy.accountPaused",
  );
  return {
    ...normalizedConfig,
    configuredBy,
    version,
    permissionGeneration,
    accountPaused,
  };
}

function normalizeDefaultMintControls(value) {
  return {
    ownerApprovedMints: expectBoolean(
      tupleField(value, "ownerApprovedMints", 0), false, "mintControls.ownerApprovedMints",
    ),
    autonomousFreeMints: expectBoolean(
      tupleField(value, "autonomousFreeMints", 1), false, "mintControls.autonomousFreeMints",
    ),
    autonomousPaidMints: expectBoolean(
      tupleField(value, "autonomousPaidMints", 2), false, "mintControls.autonomousPaidMints",
    ),
  };
}

function normalizeDefaultCurrencyPolicy(value) {
  const fields = [
    "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice",
  ];
  const result = {
    allowed: expectBoolean(tupleField(value, "allowed", 0), false, "currencyPolicy.allowed"),
  };
  fields.forEach((name, offset) => {
    result[name] = expectUint(tupleField(value, name, offset + 1), 0, `currencyPolicy.${name}`)
      .toString();
  });
  return result;
}

function normalizeDefaultAdapterRecord(value) {
  return {
    kind: Number(expectUint(tupleField(value, "kind", 0), 0, "adapterRecord.kind")),
    active: expectBoolean(tupleField(value, "active", 1), false, "adapterRecord.active"),
    venue: sameAddress(tupleField(value, "venue", 2), ZERO_ADDRESS, "adapterRecord.venue", {
      allowZero: true,
    }),
    adapterCodeHash: normalizeHash(
      tupleField(value, "adapterCodeHash", 3), "adapterRecord.adapterCodeHash", { allowZero: true },
    ),
    venueCodeHash: normalizeHash(
      tupleField(value, "venueCodeHash", 4), "adapterRecord.venueCodeHash", { allowZero: true },
    ),
    versionHash: normalizeHash(
      tupleField(value, "versionHash", 5), "adapterRecord.versionHash", { allowZero: true },
    ),
    metadataHash: normalizeHash(
      tupleField(value, "metadataHash", 6), "adapterRecord.metadataHash", { allowZero: true },
    ),
  };
}

function requireDefaultAdapterRecord(record) {
  if (record.adapterCodeHash !== ZERO_HASH || record.venueCodeHash !== ZERO_HASH
    || record.versionHash !== ZERO_HASH || record.metadataHash !== ZERO_HASH) {
    fail("ADAPTER_ALREADY_REGISTERED", "canary adapter registry record is non-default");
  }
  return record;
}

function normalizeUsage(acquisitionUsage, nativeUsage) {
  const acquisitionsToday = Number(expectUint(
    tupleField(acquisitionUsage, "acquisitionsToday", 1), 0,
    "acquisitionUsage.acquisitionsToday",
  ));
  return {
    acquisitionUsage: { acquisitionsToday },
    nativeUsage: {
      acquisitionsToday: Number(expectUint(
        tupleField(nativeUsage, "acquisitionsToday", 2), 0,
        "nativeUsage.acquisitionsToday",
      )),
      spentToday: expectUint(
        tupleField(nativeUsage, "spentToday", 3), 0, "nativeUsage.spentToday",
      ).toString(),
      spentThisWeek: expectUint(
        tupleField(nativeUsage, "spentThisWeek", 4), 0, "nativeUsage.spentThisWeek",
      ).toString(),
    },
  };
}

async function ownerObservation(endpoint, endpointIndex, blockNumber, account, punkTokenId, owner) {
  let block;
  try {
    block = await endpoint.client.getBlock({ blockNumber, includeTransactions: false });
  } catch {
    fail("LIVE_READ_FAILED", `owner observation block failed on RPC ${endpointIndex + 1}`);
  }
  if (parseUint(block?.number, "owner observation block number") !== blockNumber) {
    fail("OWNER_OBSERVATION_MISMATCH", "owner observation returned the wrong block");
  }
  const [tokenOwner, accountOwner] = await Promise.all([
    checkedRead(endpoint, endpointIndex, blockNumber, CANONICAL_COLLECTION, punkAbi, "ownerOf", [
      punkTokenId,
    ]),
    checkedRead(endpoint, endpointIndex, blockNumber, account, accountAbi, "owner"),
  ]);
  sameAddress(tokenOwner, owner, "canonical Punk owner observation");
  sameAddress(accountOwner, owner, "Punk Account owner observation");
  return {
    expectedOwner: owner,
    observedOwner: getAddress(owner),
    blockNumber: safeNumber(blockNumber, "owner observation block", { positive: true }),
    blockHash: normalizeHash(block.hash, "owner observation block hash"),
    blockTimestamp: blockTimestampIso(block.timestamp, "owner observation block timestamp"),
  };
}

async function scanIsolationEvidence(endpoint, endpointIndex, core, account, pinned) {
  const policyAddress = core.contracts.BrokerPolicyModule.address;
  const policyFrom = BigInt(core.contracts.BrokerPolicyModule.record.deploymentBlock);
  let accountScopedPolicyMutationEvents = 0;
  for (const event of policyMutationEvents) {
    const logs = await scanLogsInChunks(endpoint.client, {
      address: policyAddress,
      event,
      fromBlock: policyFrom,
      toBlock: pinned.number,
    }, `${event.name} RPC ${endpointIndex + 1}`);
    accountScopedPolicyMutationEvents += logs.length;
  }
  const featureLogs = await scanLogsInChunks(endpoint.client, {
    address: policyAddress,
    event: featureFlagsChangedEvent,
    fromBlock: policyFrom,
    toBlock: pinned.number,
  }, `FeatureFlagsChanged RPC ${endpointIndex + 1}`);
  if (accountScopedPolicyMutationEvents !== 0 || featureLogs.length !== 0) {
    fail(
      "PRIOR_POLICY_MUTATION",
      "fresh-deployment first-canary invariant failed: prior policy or feature mutations exist",
    );
  }

  const agentAddress = core.contracts.ArtAgentRegistry.address;
  const agentFrom = BigInt(core.contracts.ArtAgentRegistry.record.deploymentBlock);
  const agentEventCounts = {};
  for (const [name, event] of [
    ["authorizedEvents", agentAuthorizedEvent],
    ["revokedEvents", agentRevokedEvent],
    ["allAgentsRevokedEvents", allAgentsRevokedEvent],
  ]) {
    const logs = await scanLogsInChunks(endpoint.client, {
      address: agentAddress,
      event,
      args: { account },
      fromBlock: agentFrom,
      toBlock: pinned.number,
    }, `${event.name} RPC ${endpointIndex + 1}`);
    agentEventCounts[name] = logs.length;
  }
  if (Object.values(agentEventCounts).some((count) => count !== 0)) {
    fail(
      "PRIOR_AGENT_AUTHORIZATION_HISTORY",
      "selected canary account has prior agent authorization/revocation history",
    );
  }
  const isolation = {
    fromBlock: safeNumber(policyFrom, "policy event scan start", { positive: true }),
    toBlock: safeNumber(pinned.number, "policy event scan end", { positive: true }),
    accountScopedPolicyMutationEvents,
    featureFlagChangeEvents: featureLogs.length,
    passed: true,
  };
  const agentScan = {
    fromBlock: safeNumber(agentFrom, "agent event scan start", { positive: true }),
    toBlock: safeNumber(pinned.number, "agent event scan end", { positive: true }),
    ...agentEventCounts,
    passed: true,
  };
  return {
    isolationEventScan: { ...isolation, evidenceHash: canonicalSha256(isolation) },
    agentAuthorizationEventScan: { ...agentScan, evidenceHash: canonicalSha256(agentScan) },
  };
}

async function verifyEndpointBindings(endpoint, endpointIndex, core, expected, records, pinned) {
  const addresses = {
    art: records[0].address,
    adapter: records[1].address,
    registry: core.contracts.GoghPunkAccountRegistry.address,
    implementation: core.contracts.GoghPunkAccountV1.address,
    adapterRegistry: core.contracts.ArtAdapterRegistry.address,
    agentRegistry: core.contracts.ArtAgentRegistry.address,
    policy: core.contracts.BrokerPolicyModule.address,
  };
  const coreCodeHashes = {};
  for (const name of CORE_CONTRACT_NAMES) {
    coreCodeHashes[name] = await checkedCodeHash(
      endpoint,
      endpointIndex,
      pinned.number,
      core.contracts[name].address,
      core.contracts[name].runtimeBytecodeHash,
      name,
    );
  }
  const canonicalRegistryRuntimeCodeHash = await checkedCodeHash(
    endpoint,
    endpointIndex,
    pinned.number,
    CANONICAL_ERC6551_REGISTRY,
    CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
    "canonical ERC-6551 registry",
  );
  const accountRuntimeBytecodeHash = await checkedCodeHash(
    endpoint,
    endpointIndex,
    pinned.number,
    expected.account,
    null,
    "activated Punk Account",
  );

  const [
    registryCollection, registryChainId, registryConstant, registryInterface, registryImplementation,
    registrySalt, registryAccount, canonicalAccount,
  ] = await Promise.all([
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi, "GOGH_PUNKS"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi,
      "ROBINHOOD_CHAIN_ID"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi,
      "CANONICAL_ERC6551_REGISTRY"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi,
      "canonicalRegistry"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi,
      "implementation"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi, "accountSalt"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.registry, registryAbi, "account", [
      expected.punkTokenId,
    ]),
    checkedRead(endpoint, endpointIndex, pinned.number, CANONICAL_ERC6551_REGISTRY,
      canonicalRegistryAbi, "account", [addresses.implementation, ZERO_HASH,
        BigInt(ROBINHOOD_CHAIN_ID), CANONICAL_COLLECTION, expected.punkTokenId]),
  ]);
  sameAddress(registryCollection, CANONICAL_COLLECTION, "registry collection");
  expectUint(registryChainId, ROBINHOOD_CHAIN_ID, "registry chain ID");
  sameAddress(registryConstant, CANONICAL_ERC6551_REGISTRY, "registry canonical constant");
  sameAddress(registryInterface, CANONICAL_ERC6551_REGISTRY, "registry canonical interface");
  sameAddress(registryImplementation, addresses.implementation, "registry implementation");
  if (normalizeHash(registrySalt, "registry account salt", { allowZero: true }) !== ZERO_HASH) {
    fail("ACCOUNT_DERIVATION_MISMATCH", "live registry account salt is not zero");
  }
  sameAddress(registryAccount, expected.account, "facade-derived Punk Account");
  sameAddress(canonicalAccount, expected.account, "canonical-registry-derived Punk Account");

  const [footer, canonical, accountOwner, tokenOwner, accountPolicy, accountAgents, accountAdapters,
    accountStateValue, acquisitionNonceValue] = await Promise.all([
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "token"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi,
      "isCanonicalGoghPunkAccount"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "owner"),
    checkedRead(endpoint, endpointIndex, pinned.number, CANONICAL_COLLECTION, punkAbi, "ownerOf", [
      expected.punkTokenId,
    ]),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "policyModule"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "agentRegistry"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "adapterRegistry"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "state"),
    checkedRead(endpoint, endpointIndex, pinned.number, expected.account, accountAbi, "acquisitionNonce"),
  ]);
  expectUint(tupleField(footer, "chainId", 0), ROBINHOOD_CHAIN_ID, "account footer chain ID");
  sameAddress(tupleField(footer, "tokenContract", 1), CANONICAL_COLLECTION,
    "account footer collection");
  if (parseUint(tupleField(footer, "tokenId", 2), "account footer token ID")
    !== expected.punkTokenId) {
    fail("ACCOUNT_DERIVATION_MISMATCH", "account footer token ID is wrong");
  }
  expectBoolean(canonical, true, "account canonical qualification");
  sameAddress(accountOwner, expected.owner, "Punk Account current owner");
  sameAddress(tokenOwner, expected.owner, "canonical Punk current owner");
  sameAddress(accountPolicy, addresses.policy, "account policy module");
  sameAddress(accountAgents, addresses.agentRegistry, "account agent registry");
  sameAddress(accountAdapters, addresses.adapterRegistry, "account adapter registry");
  const accountState = expectUint(accountStateValue, 0, "account state").toString();
  const acquisitionNonce = expectUint(acquisitionNonceValue, 0, "account acquisition nonce")
    .toString();

  const [
    artChain, artCollection, artCanonicalRegistry, artRegistry, artAccount, artPunkTokenId,
    artTokenId, artMinted, adapterCollection, adapterAccount, adapterTokenId, adapterVenue,
    adapterAssetCollection, adapterSelector, adapterStandard, adapterKind,
  ] = await Promise.all([
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi,
      "ROBINHOOD_CHAIN_ID"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi, "GOGH_PUNKS"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi,
      "CANONICAL_ERC6551_REGISTRY"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi,
      "punkAccountRegistry"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi, "punkAccount"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi,
      "controllingPunkTokenId"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi, "canaryTokenId"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.art, canaryArtAbi, "minted"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "canaryCollection"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "boundAccount"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "boundTokenId"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi, "venue"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "collection"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "mintSelector"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi,
      "assetStandard"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapter, canaryAdapterAbi, "kind"),
  ]);
  expectUint(artChain, ROBINHOOD_CHAIN_ID, "canary art chain ID");
  sameAddress(artCollection, CANONICAL_COLLECTION, "canary art Gogh collection");
  sameAddress(artCanonicalRegistry, CANONICAL_ERC6551_REGISTRY,
    "canary art canonical registry");
  sameAddress(artRegistry, addresses.registry, "canary art account registry");
  sameAddress(artAccount, expected.account, "canary art bound account");
  if (parseUint(artPunkTokenId, "canary art Punk token ID") !== expected.punkTokenId
    || parseUint(artTokenId, "canary art token ID") !== expected.canaryArtTokenId) {
    fail("CANARY_BINDING_MISMATCH", "canary art token bindings are wrong");
  }
  expectBoolean(artMinted, false, "canary art minted state");
  sameAddress(adapterCollection, addresses.art, "adapter canary collection");
  sameAddress(adapterAccount, expected.account, "adapter bound account");
  if (parseUint(adapterTokenId, "adapter token ID") !== expected.canaryArtTokenId) {
    fail("CANARY_BINDING_MISMATCH", "adapter token ID is wrong");
  }
  sameAddress(adapterVenue, addresses.art, "adapter venue");
  sameAddress(adapterAssetCollection, addresses.art, "adapter collection");
  if (typeof adapterSelector !== "string" || adapterSelector.toLowerCase() !== CANARY_MINT_SELECTOR) {
    fail("CANARY_BINDING_MISMATCH", "adapter mint selector is wrong");
  }
  expectUint(adapterStandard, 0, "adapter ERC-721 standard");
  expectUint(adapterKind, 1, "adapter MINT kind");

  const [featuresValue, policyPausedValue, adapterPausedValue, agentPausedValue, policyValue,
    mintControlsValue, adapterRecordValue, adapterAllowed, mintContractAllowed, collectionAllowed,
    collectionDenied, selectorAllowed, selectorDenied, currencyPolicyValue, venueMaximumValue,
    authorizationGenerationValue, acquisitionUsageValue, nativeUsageValue] = await Promise.all([
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi, "featureFlags"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi, "globallyPaused"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapterRegistry,
      adapterRegistryAbi, "globallyPaused"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.agentRegistry,
      agentRegistryAbi, "globallyPaused"),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi, "policy", [
      expected.account,
    ]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi, "mintControls", [
      expected.account,
    ]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.adapterRegistry,
      adapterRegistryAbi, "adapterRecord", [addresses.adapter]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "approvedAdapters", [expected.account, addresses.adapter]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "approvedMintContracts", [expected.account, addresses.art]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "approvedCollections", [expected.account, addresses.art]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "deniedCollections", [expected.account, addresses.art]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "approvedSelectors", [expected.account, CANARY_MINT_SELECTOR]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "deniedSelectors", [expected.account, CANARY_MINT_SELECTOR]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "currencyPolicy", [expected.account, ZERO_ADDRESS]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "venueCurrencyMaximum", [expected.account, addresses.art, ZERO_ADDRESS]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.agentRegistry,
      agentRegistryAbi, "authorizationGeneration", [expected.account]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi,
      "acquisitionUsage", [expected.account]),
    checkedRead(endpoint, endpointIndex, pinned.number, addresses.policy, policyAbi, "usage", [
      expected.account, ZERO_ADDRESS,
    ]),
  ]);
  const featureFlags = normalizeFeatureTuple(featuresValue);
  const globalPauses = {
    policy: expectBoolean(policyPausedValue, false, "policy global pause"),
    adapters: expectBoolean(adapterPausedValue, false, "adapter global pause"),
    agents: expectBoolean(agentPausedValue, false, "agent global pause"),
  };
  const policy = normalizeDefaultPolicy(policyValue);
  const mintControls = normalizeDefaultMintControls(mintControlsValue);
  const adapterRecord = requireDefaultAdapterRecord(normalizeDefaultAdapterRecord(adapterRecordValue));
  const permissions = {
    adapterAllowed: expectBoolean(adapterAllowed, false, "canary adapter permission"),
    mintContractAllowed: expectBoolean(mintContractAllowed, false, "canary mint permission"),
    collectionAllowed: expectBoolean(collectionAllowed, false, "canary collection allow permission"),
    collectionDenied: expectBoolean(collectionDenied, false, "canary collection deny permission"),
    selectorAllowed: expectBoolean(selectorAllowed, false, "canary selector allow permission"),
    selectorDenied: expectBoolean(selectorDenied, false, "canary selector deny permission"),
    nativeCurrencyPolicy: normalizeDefaultCurrencyPolicy(currencyPolicyValue),
    venueCurrencyMaximum: expectUint(venueMaximumValue, 0, "venue currency maximum").toString(),
  };
  const authorizationGeneration = Number(expectUint(
    authorizationGenerationValue, 0, "agent authorization generation",
  ));
  const usage = normalizeUsage(acquisitionUsageValue, nativeUsageValue);
  const isolation = await scanIsolationEvidence(
    endpoint,
    endpointIndex,
    core,
    expected.account,
    pinned,
  );
  const cleanStateWithoutHash = {
    blockNumber: safeNumber(pinned.number, "clean preconfiguration block", { positive: true }),
    blockHash: pinned.hash,
    blockTimestamp: pinned.timestamp,
    accountState,
    acquisitionNonce,
    policy,
    mintControls,
    adapterRecord,
    permissions,
    featureFlags,
    globalPauses,
    authorizationGeneration,
    activeAgents: [],
    agentAuthorizationEventScan: isolation.agentAuthorizationEventScan,
    acquisitionUsage: usage.acquisitionUsage,
    nativeUsage: usage.nativeUsage,
    isolationEventScan: isolation.isolationEventScan,
  };
  const cleanPreconfigurationState = {
    ...cleanStateWithoutHash,
    evidenceHash: canonicalSha256(cleanStateWithoutHash),
  };

  const preparationBlock = BigInt(records[0].deploymentBlock) - 1n;
  if (preparationBlock <= 0n) fail("INVALID_DEPLOYMENT_BLOCK", "canary art block has no predecessor");
  const ownerObservations = {
    preparation: await ownerObservation(endpoint, endpointIndex, preparationBlock,
      expected.account, expected.punkTokenId, expected.owner),
    afterCanaryArtReceipt: await ownerObservation(endpoint, endpointIndex,
      BigInt(records[0].deploymentBlock), expected.account, expected.punkTokenId, expected.owner),
    afterCanaryAdapterReceipt: await ownerObservation(endpoint, endpointIndex,
      BigInt(records[1].deploymentBlock), expected.account, expected.punkTokenId, expected.owner),
  };
  return {
    coreCodeHashes,
    canonicalRegistryRuntimeCodeHash,
    accountRuntimeBytecodeHash,
    accountIdentity: {
      chainId: ROBINHOOD_CHAIN_ID,
      collection: getAddress(CANONICAL_COLLECTION),
      tokenId: expected.punkTokenId.toString(),
      account: expected.account,
      owner: expected.owner,
    },
    canaryBindings: {
      art: records[0].address,
      adapter: records[1].address,
      artTokenId: expected.canaryArtTokenId.toString(),
      selector: CANARY_MINT_SELECTOR,
      artMinted: false,
      adapterKind: "MINT",
      assetStandard: "ERC721",
    },
    cleanPreconfigurationState,
    ownerObservations,
  };
}

function strictJsonSnapshot(value, maximum, label) {
  boundedJson(value, maximum, label);
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail("INVALID_SCHEMA", `${label} could not be snapshotted as strict JSON`);
  }
}

function clockIso(clock) {
  if (typeof clock !== "function") fail("INVALID_CLOCK", "clock must be a function");
  let milliseconds;
  try {
    milliseconds = clock();
  } catch {
    fail("INVALID_CLOCK", "clock read failed");
  }
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    fail("INVALID_CLOCK", "clock must return nonnegative epoch milliseconds");
  }
  return strictIso(new Date(milliseconds).toISOString(), "observation time");
}

async function verifyLiveDeployment(core, expected, records, endpointEntries, confirmations, clock) {
  const endpoints = normalizeEndpointEntries(endpointEntries);
  const pinned = await pinnedBlockForEndpoints(endpoints, confirmations);
  const latestDeploymentBlock = BigInt(records[1].deploymentBlock);
  if (latestDeploymentBlock > pinned.number) {
    fail("UNCONFIRMED_DEPLOYMENT", "latest canary deployment is newer than confirmed pin");
  }
  const results = await Promise.all(endpoints.map(async (endpoint, index) => {
    const creations = await verifyCreationOnEndpoint(
      endpoint,
      index,
      records,
      pinned,
      pinned.heads[index],
    );
    const bindings = await verifyEndpointBindings(endpoint, index, core, expected, records, pinned);
    let closingBlock;
    try {
      closingBlock = await endpoint.client.getBlock({
        blockNumber: pinned.number,
        includeTransactions: false,
      });
    } catch {
      fail("LIVE_READ_FAILED", `RPC ${index + 1} closing block read failed`);
    }
    if (parseUint(closingBlock?.number, `RPC ${index + 1} closing block`) !== pinned.number
      || normalizeHash(closingBlock.hash, `RPC ${index + 1} closing block hash`) !== pinned.hash
      || blockTimestampIso(closingBlock.timestamp, `RPC ${index + 1} closing block timestamp`)
        !== pinned.timestamp) {
      fail("PINNED_BLOCK_CHANGED", `RPC ${index + 1} confirmed block changed during reads`);
    }
    return { creations, bindings };
  }));
  if (canonicalJson(results[0]) !== canonicalJson(results[1])) {
    fail("RPC_DISAGREEMENT", "RPCs disagree on canary deployment or preconfiguration evidence");
  }
  const observedAt = clockIso(clock);
  const observations = endpoints.map((endpoint, index) => {
    const evidence = {
      provider: endpoint.provider,
      origin: endpoint.origin,
      chainId: ROBINHOOD_CHAIN_ID,
      headBlockNumber: safeNumber(pinned.heads[index], `RPC ${index + 1} head`, { positive: true }),
      confirmedBlockNumber: safeNumber(pinned.number, "confirmed block", { positive: true }),
      confirmedBlockHash: pinned.hash,
      confirmedBlockTimestamp: pinned.timestamp,
      observedAt,
      deploymentEvidence: results[index],
    };
    return {
      provider: evidence.provider,
      origin: evidence.origin,
      chainId: evidence.chainId,
      headBlockNumber: evidence.headBlockNumber,
      confirmedBlockNumber: evidence.confirmedBlockNumber,
      confirmedBlockHash: evidence.confirmedBlockHash,
      confirmedBlockTimestamp: evidence.confirmedBlockTimestamp,
      observedAt: evidence.observedAt,
      evidenceHash: canonicalSha256(evidence),
    };
  });
  const confirmationsObserved = pinned.heads.reduce(
    (minimum, head) => {
      const depth = head - latestDeploymentBlock + 1n;
      return depth < minimum ? depth : minimum;
    },
    pinned.heads[0] - latestDeploymentBlock + 1n,
  );
  return {
    common: {
      number: safeNumber(pinned.number, "confirmed block", { positive: true }),
      hash: pinned.hash,
      timestamp: pinned.timestamp,
    },
    confirmationsObserved: safeNumber(confirmationsObserved, "canary confirmations", {
      positive: true,
    }),
    observations,
    creations: results[0].creations,
    bindings: results[0].bindings,
    verifiedAt: observedAt,
  };
}

export async function buildRobinhoodCanaryDeploymentManifestProposal(input, options = {}) {
  exactKeys(input, [
    "artifact", "compiledArtifacts", "gitCommit", "coreManifest", "canaryTemplate",
    "expectedCanary", "readEndpoints", "confirmations", "sourceProvenance",
  ], "proposal input");
  plainObject(options, "proposal options");
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "clock") fail("INVALID_OPTIONS", `proposal option ${key} is not allowed`);
  }
  const artifact = strictJsonSnapshot(input.artifact, MAX_JSON_BYTES, "Foundry artifact");
  const compiledArtifacts = strictJsonSnapshot(
    input.compiledArtifacts,
    MAX_JSON_BYTES * 2,
    "compiled artifacts",
  );
  const coreManifest = strictJsonSnapshot(input.coreManifest, MAX_TEMPLATE_BYTES, "core manifest");
  const canaryTemplate = strictJsonSnapshot(
    input.canaryTemplate,
    MAX_TEMPLATE_BYTES,
    "canary template",
  );
  const expectedCanary = strictJsonSnapshot(input.expectedCanary, 100_000, "expected canary");
  const sourceProvenance = strictJsonSnapshot(
    input.sourceProvenance,
    100_000,
    "source provenance",
  );
  const gitCommit = normalizeCommit(input.gitCommit, "release git commit");
  const confirmationCount = normalizeConfirmations(input.confirmations);
  const core = validateCoreManifest(coreManifest);
  if (core.gitCommit !== gitCommit) {
    fail("COMMIT_MISMATCH", "canary release commit must equal authoritative core commit");
  }
  validateCanaryTemplate(canaryTemplate);
  const expected = normalizeExpectedCanary(expectedCanary);
  const compiled = normalizeCompiledArtifacts(compiledArtifacts);
  const normalizedArtifact = normalizeFoundryArtifact(
    artifact,
    gitCommit,
    compiled,
    core,
    expected,
  );
  validateSourceProvenance(
    sourceProvenance,
    gitCommit,
    normalizedArtifact.foundryArtifactCommit,
  );
  const live = await verifyLiveDeployment(
    core,
    expected,
    normalizedArtifact.records,
    input.readEndpoints,
    confirmationCount,
    options.clock ?? Date.now,
  );
  const creationByName = new Map(live.creations.map((item) => [item.name, item]));
  const contracts = Object.fromEntries(normalizedArtifact.records.map((record) => {
    const evidence = creationByName.get(record.name);
    return [record.name, {
      address: record.address,
      deploymentTransaction: record.transactionHash,
      deploymentBlock: record.deploymentBlock,
      deploymentBlockHash: record.deploymentBlockHash,
      receiptStatus: "SUCCESS",
      confirmationsRequired: confirmationCount,
      confirmationsObserved: evidence.confirmationsObserved,
      deployer: record.deployer,
      constructorArguments: record.constructorArguments,
      creationBytecodeHash: record.compiled.creationBytecodeHash,
      runtimeBytecodeHash: evidence.runtimeBytecodeHash,
      gitCommit,
      verificationStatus: "NOT_SUBMITTED",
    }];
  }));
  const manifest = {
    status: "DEPLOYED",
    chain: { ...coreManifest.chain },
    coreDeploymentManifest: "deployments/robinhood.json",
    coreDeploymentManifestStatusRequired: "DEPLOYED",
    coreDeploymentManifestGitCommit: core.gitCommit,
    coreDeploymentManifestSha256: core.manifestHash,
    coreGoghPunkAccountRegistry: core.contracts.GoghPunkAccountRegistry.address,
    coreGoghPunkAccountRegistryRuntimeCodeHash:
      core.contracts.GoghPunkAccountRegistry.runtimeBytecodeHash,
    coreGoghPunkAccountImplementation: core.contracts.GoghPunkAccountV1.address,
    coreGoghPunkAccountImplementationRuntimeCodeHash:
      core.contracts.GoghPunkAccountV1.runtimeBytecodeHash,
    canonicalCollection: getAddress(CANONICAL_COLLECTION),
    canonicalERC6551Registry: getAddress(CANONICAL_ERC6551_REGISTRY),
    canonicalERC6551RegistryRuntimeCodeHash:
      CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
    controllingPunkTokenId: expected.punkTokenId.toString(),
    expectedActivatedPunkAccount: expected.account,
    expectedActivatedPunkAccountRuntimeCodeHash: live.bindings.accountRuntimeBytecodeHash,
    expectedOwnerAtPreparation: expected.owner,
    canaryArtTokenId: expected.canaryArtTokenId.toString(),
    gitCommit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts,
    sourceVerificationAdoption: null,
    provenanceGate: {
      status: "VERIFIED",
      dualRpcAgreementRequired: true,
      primaryRpcObservation: live.observations[0],
      secondaryRpcObservation: live.observations[1],
      commonConfirmedBlockNumber: live.common.number,
      commonConfirmedBlockHash: live.common.hash,
      commonConfirmedBlockTimestamp: live.common.timestamp,
      confirmationsRequired: confirmationCount,
      confirmationsObserved: live.confirmationsObserved,
      coreManifestHashVerified: true,
      coreRegistryRuntimeHashVerified: true,
      accountImplementationRuntimeHashVerified: true,
      activatedAccountRuntimeHashVerified: true,
      canonicalERC6551RegistryRuntimeHashVerified: true,
      accountFooterVerified: true,
      expectedOwnerVerified: true,
      constructorInputsVerified: true,
      cleanPreconfigurationState: live.bindings.cleanPreconfigurationState,
      verifiedAt: live.verifiedAt,
    },
    ownerObservations: live.bindings.ownerObservations,
    configuration: {
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
    },
    notes: "Immutable canary deployment and clean-preconfiguration snapshot proposal. Two distinct read-only RPC origins agreed at one confirmed block on creation transactions, receipts, compiled runtime, constructor/immutable bindings, canonical Punk Account identity and owner, unminted art, absent adapter registration, fresh zero account/policy usage, no agent history, and no prior policy or feature mutation since core deployment. Blockscout source verification remains NOT_SUBMITTED, so this proposal is not ready for authoritative adoption or configuration. This historical manifest must not be mutated after configuration; later configuration and execution evidence are separate artifacts. No transaction was signed, sent, or enabled by this generator.",
  };
  return {
    schema: "GOGH_ROBINHOOD_CANARY_DEPLOYMENT_MANIFEST_PROPOSAL_V1",
    proposalStatus: "CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING",
    trustBindings: {
      chainId: ROBINHOOD_CHAIN_ID,
      releaseGitCommit: gitCommit,
      foundryArtifactCommit: normalizedArtifact.foundryArtifactCommit,
      sourceProvenance,
      authoritativeCoreManifest: {
        path: "deployments/robinhood.json",
        canonicalSha256: core.manifestHash,
        status: "DEPLOYED",
        contractsVerified: true,
      },
      deploymentOrder: CANARY_DEPLOYMENT_ORDER,
      commonConfirmedBlock: live.common,
      rpcOrigins: live.observations.map(({ provider, origin }) => ({ provider, origin })),
      providerIndependence: "UNVERIFIED_BEYOND_DISTINCT_DECLARED_PROVIDER_AND_ORIGIN",
      contractEvidence: Object.fromEntries(live.creations.map((item) => [item.name, item])),
      blockscoutSourceVerification: "NOT_SUBMITTED",
      immutableBindings: live.bindings.canaryBindings,
      accountIdentity: live.bindings.accountIdentity,
      cleanPreconfigurationStateHash:
        live.bindings.cleanPreconfigurationState.evidenceHash,
      immutableSnapshotSemantics: true,
      transactionCapability: "NONE_READ_ONLY_PROPOSAL",
    },
    manifest,
  };
}

export function renderRobinhoodCanaryDeploymentManifestProposal(proposal) {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}

export function parseCanaryManifestArguments(argv) {
  if (!Array.isArray(argv)) fail("INVALID_ARGUMENTS", "arguments must be an array");
  const allowed = new Set([
    "--artifact", "--git-commit", "--punk-token-id", "--expected-account", "--expected-owner",
    "--canary-art-token-id", "--confirmations",
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== "string" || value.length === 0
      || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", "invalid or incomplete canary manifest argument list");
    }
    if (Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} was supplied twice`);
    parsed[flag] = value;
  }
  for (const flag of [
    "--artifact", "--git-commit", "--punk-token-id", "--expected-account", "--expected-owner",
    "--canary-art-token-id",
  ]) if (!Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} is required`);
  return parsed;
}

async function readBoundedJson(path, maximum, label) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > maximum) {
      fail("INVALID_FILE", `${label} must be a nonempty regular file within its size limit`);
    }
    const text = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(text, "utf8") > maximum) fail("INPUT_TOO_LARGE", `${label} is too large`);
    try {
      return JSON.parse(text);
    } catch {
      fail("INVALID_JSON", `${label} is not valid JSON`);
    }
  } catch (error) {
    if (error instanceof CanaryManifestProposalError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be read as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function assertBroadcastPath(path) {
  const resolvedPath = resolve(path);
  const pathRelative = relative(defaultBroadcastRoot, resolvedPath);
  if (pathRelative.startsWith(`..${sep}`) || pathRelative === ".." || resolve(defaultBroadcastRoot,
    pathRelative) !== resolvedPath || pathRelative.includes(sep)
    || !/^run-(?:latest|\d+)\.json$/.test(basename(resolvedPath))) {
    fail(
      "INVALID_ARTIFACT_PATH",
      "artifact must be an explicit root broadcast/DeployOneShotCanary.s.sol/4663/run-*.json file",
    );
  }
  return resolvedPath;
}

function endpointFromUrl(urlValue, label, index) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    fail("INVALID_ENDPOINT", `${label} is not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("INVALID_ENDPOINT", `${label} must be an HTTPS URL without URL credentials`);
  }
  const chain = {
    id: ROBINHOOD_CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url.href] } },
  };
  return {
    provider: url.hostname,
    origin: url.origin,
    client: createPublicClient({
      chain,
      transport: http(url.href),
      name: `canary-manifest-read-${index + 1}`,
    }),
  };
}

async function main() {
  const args = parseCanaryManifestArguments(process.argv.slice(2));
  const artifactPath = assertBroadcastPath(args["--artifact"]);
  const urls = [process.env.ROBINHOOD_RPC_URL, process.env.ROBINHOOD_SECONDARY_RPC_URL];
  if (urls.some((url) => typeof url !== "string" || url.trim() === "")) {
    fail("MISSING_READ_ENDPOINTS", "ROBINHOOD_RPC_URL and ROBINHOOD_SECONDARY_RPC_URL are required");
  }
  const [artifact, coreManifest, canaryTemplate] = await Promise.all([
    readBoundedJson(artifactPath, MAX_JSON_BYTES, "Foundry broadcast artifact"),
    readBoundedJson(defaultCoreManifestPath, MAX_TEMPLATE_BYTES, "authoritative core manifest"),
    readBoundedJson(defaultCanaryTemplatePath, MAX_TEMPLATE_BYTES, "canary manifest template"),
  ]);
  const sourceProvenance = await verifyCanaryCliSourceProvenance({
    releaseGitCommit: args["--git-commit"],
    foundryArtifactCommit: artifact?.commit,
  });
  const compiledArtifacts = Object.fromEntries(await Promise.all(
    CANARY_DEPLOYMENT_ORDER.map(async (name) => [name, await readBoundedJson(
      resolve(projectRoot, `contracts/out/${name}.sol/${name}.json`),
      MAX_JSON_BYTES,
      `${name} compiled artifact`,
    )]),
  ));
  const proposal = await buildRobinhoodCanaryDeploymentManifestProposal({
    artifact,
    compiledArtifacts,
    gitCommit: args["--git-commit"],
    coreManifest,
    canaryTemplate,
    expectedCanary: {
      controllingPunkTokenId: args["--punk-token-id"],
      expectedActivatedPunkAccount: args["--expected-account"],
      expectedOwnerAtPreparation: args["--expected-owner"],
      canaryArtTokenId: args["--canary-art-token-id"],
    },
    readEndpoints: urls.map((url, index) => endpointFromUrl(url, `RPC ${index + 1}`, index)),
    confirmations: args["--confirmations"] ?? DEFAULT_CONFIRMATIONS,
    sourceProvenance,
  });
  process.stdout.write(renderRobinhoodCanaryDeploymentManifestProposal(proposal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof CanaryManifestProposalError
      ? error.message
      : "UNEXPECTED_FAILURE: canary manifest proposal generation failed closed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
