import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
} from "viem";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";

export const ROBINHOOD_CHAIN_ID = 4663;
export const EXPECTED_DEPLOYMENT_ORDER = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
export const SAFE_FEATURE_FLAGS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});

const DEFAULT_CONFIRMATIONS = 20;
const MIN_CONFIRMATIONS = 12;
const MAX_CONFIRMATIONS = 256;
const MAX_HEAD_SKEW = 128n;
const MAX_ARTIFACT_BYTES = 2_000_000;
const MAX_COMPILED_ARTIFACT_BYTES = 2_000_000;
const MAX_TEMPLATE_BYTES = 256_000;
const MAX_BYTECODE_BYTES = 1_000_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const CANONICAL_COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const CANONICAL_ERC6551_REGISTRY = "0x000000006551c19487814612e58fe06813775758";
const CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
export const COMPILER_INPUT_PATHS = Object.freeze([
  "contracts/src",
  "contracts/script/DeployArtBroker.s.sol",
  "foundry.toml",
  "remappings.txt",
  "package.json",
  "package-lock.json",
]);
const SEAPORT = Object.freeze({
  address: "0x0000000000000068f116a894984e2db1123eb395",
  name: "Seaport",
  compiler: "v0.8.24+commit.e11b9ed9",
  deploymentTransaction: "0x4320260396b5fbb69618a9b95de358a865fb6c305d5b5dda35c21452b30ee39d",
  deploymentBlock: 605917,
  runtimeCodeHash: "0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00",
  verificationStatus: "VERIFIED_READ_ONLY_SCOUT",
  executionApproved: false,
});
const projectRoot = resolve(import.meta.dirname, "..");
const defaultTemplatePath = resolve(projectRoot, "deployments/robinhood.json");
const execFileAsync = promisify(execFile);
const addressOutput = [{ type: "address" }];
const uintOutput = [{ type: "uint256" }];
const bytes32Output = [{ type: "bytes32" }];
const viewFunction = (name, outputs) => ({
  type: "function",
  name,
  stateMutability: "view",
  inputs: [],
  outputs,
});
const identityAbi = [
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
];
const ownableBindingAbi = [
  viewFunction("owner", addressOutput),
  viewFunction("pendingOwner", addressOutput),
];
const policyBindingAbi = [
  ...identityAbi,
  ...ownableBindingAbi,
  viewFunction("adapterRegistry", addressOutput),
  viewFunction("featureFlags", [{
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
const accountBindingAbi = [
  ...identityAbi,
  viewFunction("policyModule", addressOutput),
  viewFunction("agentRegistry", addressOutput),
  viewFunction("adapterRegistry", addressOutput),
];
const registryBindingAbi = [
  ...identityAbi,
  viewFunction("implementation", addressOutput),
  viewFunction("accountSalt", bytes32Output),
  viewFunction("canonicalRegistry", addressOutput),
];

class ManifestProposalError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ManifestProposalError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ManifestProposalError(code, message);
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("INVALID_SCHEMA", `${label} has an unexpected key set`);
  }
}

function requiredAllowedKeys(value, required, allowed, label) {
  plainObject(value, label);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("INVALID_SCHEMA", `${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("INVALID_SCHEMA", `${label}.${key} is not allowed`);
  }
}

function boundedJson(value, maximum, label) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} must be JSON serializable`);
  }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maximum) {
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

function sameAddress(value, expected, label) {
  const normalized = normalizeAddress(value, label);
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

function normalizeBytes32(value, label, options) {
  return normalizeHash(value, label, options);
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
    else if (Number.isSafeInteger(value) && value >= 0) parsed = BigInt(value);
    else if (typeof value === "string"
      && (/^0x[0-9a-fA-F]+$/.test(value) || /^(?:0|[1-9]\d*)$/.test(value))) {
      parsed = BigInt(value);
    } else throw new TypeError();
  } catch {
    fail("INVALID_INTEGER", `${label} must be an unsigned integer`);
  }
  if (parsed < 0n || (positive && parsed === 0n)) {
    fail("INVALID_INTEGER", `${label} must be positive`);
  }
  return parsed;
}

function safeNumber(value, label, { positive = false } = {}) {
  const parsed = parseUint(value, label, { positive });
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("UNSAFE_INTEGER", `${label} exceeds the JSON safe-integer range`);
  }
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

function successfulReceipt(value, label) {
  if (value !== "success" && value !== "0x1" && value !== 1 && value !== 1n) {
    fail("FAILED_RECEIPT", `${label} is not successful`);
  }
}

function normalizeConfirmations(value) {
  const parsed = safeNumber(value ?? DEFAULT_CONFIRMATIONS, "confirmations", { positive: true });
  if (parsed < MIN_CONFIRMATIONS || parsed > MAX_CONFIRMATIONS) {
    fail(
      "INVALID_CONFIRMATIONS",
      `confirmations must be between ${MIN_CONFIRMATIONS} and ${MAX_CONFIRMATIONS}`,
    );
  }
  return parsed;
}

function constructorDefinition(name, context, suppliedArgs) {
  if (name === "ArtAdapterRegistry" || name === "ArtAgentRegistry") {
    return { types: [{ type: "address" }], values: [context.guardian] };
  }
  if (name === "BrokerPolicyModule") {
    return {
      types: [{ type: "address" }, { type: "address" }],
      values: [context.guardian, context.addresses.ArtAdapterRegistry],
    };
  }
  if (name === "GoghPunkAccountV1") {
    return {
      types: [{ type: "address" }, { type: "address" }, { type: "address" }],
      values: [
        context.addresses.BrokerPolicyModule,
        context.addresses.ArtAgentRegistry,
        context.addresses.ArtAdapterRegistry,
      ],
    };
  }
  if (name === "GoghPunkAccountRegistry") {
    return {
      types: [{ type: "address" }, { type: "bytes32" }],
      values: [
        context.addresses.GoghPunkAccountV1,
        normalizeBytes32(suppliedArgs[1], "account salt", { allowZero: true }),
      ],
    };
  }
  fail("UNKNOWN_CONTRACT", `${name} is not a DeployArtBroker contract`);
}

function validateImmutableReferences(references, byteLength, label) {
  plainObject(references, label);
  const ranges = [];
  for (const [identifier, entries] of Object.entries(references)) {
    if (!/^\d+$/.test(identifier) || !Array.isArray(entries)) {
      fail("INVALID_COMPILED_ARTIFACT", `${label} has malformed immutable references`);
    }
    for (const [index, entry] of entries.entries()) {
      exactKeys(entry, ["start", "length"], `${label}.${identifier}[${index}]`);
      const start = safeNumber(entry.start, `${label}.${identifier}[${index}].start`);
      const length = safeNumber(entry.length, `${label}.${identifier}[${index}].length`, {
        positive: true,
      });
      if (length !== 32) {
        fail("INVALID_COMPILED_ARTIFACT", `${label} immutable ranges must be exactly 32 bytes`);
      }
      if (start + length > byteLength) {
        fail("INVALID_COMPILED_ARTIFACT", `${label} immutable range exceeds runtime bytecode`);
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
  for (const { start, length } of ranges) {
    bytes.fill("00", start, start + length);
  }
  return keccak256(`0x${bytes.join("")}`);
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
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
    rawMetadataSha256: sha256(artifact.rawMetadata),
    sourceSetSha256: sha256(canonicalJson(sourceHashes)),
    compilerSettingsSha256: sha256(canonicalJson(metadata.settings)),
    abiSha256: sha256(canonicalJson(artifact.abi)),
  };
}

function normalizeCompiledArtifact(name, artifact) {
  boundedJson(artifact, MAX_COMPILED_ARTIFACT_BYTES, `${name} compiled artifact`);
  plainObject(artifact, `${name} compiled artifact`);
  requiredAllowedKeys(
    artifact,
    ["abi", "bytecode", "deployedBytecode", "methodIdentifiers", "rawMetadata", "metadata", "id"],
    ["abi", "bytecode", "deployedBytecode", "methodIdentifiers", "rawMetadata", "metadata", "id"],
    `${name} compiled artifact`,
  );
  requiredAllowedKeys(
    artifact.bytecode,
    ["object", "sourceMap", "linkReferences"],
    ["object", "sourceMap", "linkReferences"],
    `${name}.bytecode`,
  );
  requiredAllowedKeys(
    artifact.deployedBytecode,
    ["object", "sourceMap", "linkReferences"],
    ["object", "sourceMap", "linkReferences", "immutableReferences"],
    `${name}.deployedBytecode`,
  );
  if (Object.keys(plainObject(artifact.bytecode.linkReferences, `${name} creation links`)).length
    || Object.keys(plainObject(artifact.deployedBytecode.linkReferences, `${name} runtime links`)).length) {
    fail("UNRESOLVED_LIBRARY_LINK", `${name} compiled artifact contains library links`);
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
    fail("INVALID_COMPILED_ARTIFACT", `${name} rawMetadata is not valid JSON`);
  }
  const target = metadata?.settings?.compilationTarget;
  if (metadata?.compiler?.version !== "0.8.34+commit.80d5c536"
    || metadata?.settings?.optimizer?.enabled !== true
    || metadata?.settings?.optimizer?.runs !== 500
    || metadata?.settings?.evmVersion !== "cancun"
    || metadata?.settings?.viaIR !== true
    || metadata?.settings?.metadata?.bytecodeHash !== "none"
    || target?.[`contracts/src/${name}.sol`] !== name
    || Object.keys(target ?? {}).length !== 1) {
    fail("WRONG_COMPILER_SETTINGS", `${name} was not built with the canonical release settings`);
  }
  const suppliedImmutableReferences = artifact.deployedBytecode.immutableReferences;
  if (suppliedImmutableReferences === null
    || (suppliedImmutableReferences !== undefined
      && (typeof suppliedImmutableReferences !== "object"
        || Array.isArray(suppliedImmutableReferences)))) {
    fail("INVALID_COMPILED_ARTIFACT", `${name}.immutableReferences must be an object when present`);
  }
  const immutableRanges = validateImmutableReferences(
    suppliedImmutableReferences ?? {},
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
  exactKeys(compiledArtifacts, EXPECTED_DEPLOYMENT_ORDER, "compiledArtifacts");
  return Object.fromEntries(EXPECTED_DEPLOYMENT_ORDER.map((name) => (
    [name, normalizeCompiledArtifact(name, compiledArtifacts[name])]
  )));
}

function validateFeatureFlags(flags, label) {
  exactKeys(flags, Object.keys(SAFE_FEATURE_FLAGS), label);
  for (const [name, expected] of Object.entries(SAFE_FEATURE_FLAGS)) {
    if (flags[name] !== expected) fail("UNSAFE_FEATURE_FLAGS", `${label}.${name} must be ${expected}`);
  }
}

function validateTemplateRecord(record, name) {
  exactKeys(record, [
    "address", "deploymentTransaction", "deploymentBlock", "deployer", "implementationVersion",
    "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
    "verificationStatus",
  ], `template.contracts.${name}`);
  for (const field of [
    "address", "deploymentTransaction", "deploymentBlock", "deployer", "constructorArguments",
    "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
  ]) {
    if (record[field] !== null) fail("INVALID_TEMPLATE", `${name}.${field} must still be null`);
  }
  if (record.implementationVersion !== "1" || record.verificationStatus !== "NOT_SUBMITTED") {
    fail("INVALID_TEMPLATE", `${name} version or verification status is noncanonical`);
  }
}

function validateCanonicalTemplate(template) {
  boundedJson(template, MAX_TEMPLATE_BYTES, "manifest template");
  exactKeys(template, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash",
    "verifiedExternalInfrastructure", "accountSalt", "gitCommit", "compiler", "evmVersion",
    "optimizerRuns", "contracts", "sourceVerificationAdoption", "featureFlags",
    "protocolGuardian", "notes",
  ], "manifest template");
  if (template.status !== "NOT_DEPLOYED" || template.gitCommit !== null
    || template.protocolGuardian !== null || template.sourceVerificationAdoption !== null
    || template.compiler !== "0.8.34"
    || template.evmVersion !== "cancun" || template.optimizerRuns !== 500) {
    fail("INVALID_TEMPLATE", "manifest template release fields are noncanonical");
  }
  exactKeys(template.chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "template.chain");
  if (template.chain.name !== "Robinhood Chain" || template.chain.chainId !== ROBINHOOD_CHAIN_ID
    || template.chain.rpcEnvironmentVariable !== "ROBINHOOD_RPC_URL"
    || template.chain.explorer !== "https://robinhoodchain.blockscout.com"
    || template.chain.nativeCurrency !== "ETH") {
    fail("INVALID_TEMPLATE", "manifest template chain record is noncanonical");
  }
  sameAddress(template.canonicalCollection, CANONICAL_COLLECTION, "canonical collection");
  sameAddress(
    template.canonicalERC6551Registry,
    CANONICAL_ERC6551_REGISTRY,
    "canonical ERC-6551 registry",
  );
  if (normalizeHash(
    template.canonicalERC6551RegistryRuntimeCodeHash,
    "canonical ERC-6551 registry runtime code hash",
  ) !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail("INVALID_TEMPLATE", "canonical ERC-6551 registry runtime code hash is noncanonical");
  }
  if (normalizeBytes32(template.accountSalt, "template account salt", { allowZero: true })
    !== ZERO_HASH) {
    fail("INVALID_TEMPLATE", "template account salt must be the canonical zero bytes32 value");
  }
  exactKeys(template.verifiedExternalInfrastructure, ["seaport"], "external infrastructure");
  exactKeys(template.verifiedExternalInfrastructure.seaport, Object.keys(SEAPORT), "Seaport record");
  if (JSON.stringify(template.verifiedExternalInfrastructure.seaport) !== JSON.stringify(SEAPORT)) {
    fail("INVALID_TEMPLATE", "Seaport read-only record is noncanonical");
  }
  exactKeys(template.contracts, EXPECTED_DEPLOYMENT_ORDER, "template.contracts");
  for (const name of EXPECTED_DEPLOYMENT_ORDER) validateTemplateRecord(template.contracts[name], name);
  validateFeatureFlags(template.featureFlags, "template.featureFlags");
  if (typeof template.notes !== "string" || template.notes.length > 1_000) {
    fail("INVALID_TEMPLATE", "template notes are malformed");
  }
}

function validateArtifactReceiptSchema(receipt, index) {
  requiredAllowedKeys(receipt, [
    "status", "transactionHash", "blockHash", "blockNumber", "from", "to", "contractAddress",
  ], [
    "status", "cumulativeGasUsed", "logs", "logsBloom", "type", "transactionHash",
    "transactionIndex", "blockHash", "blockNumber", "gasUsed", "effectiveGasPrice", "from", "to",
    "contractAddress", "gasUsedForL1", "l1BlockNumber",
  ], `artifact.receipts[${index}]`);
  if (receipt.logs !== undefined && (!Array.isArray(receipt.logs) || receipt.logs.length > 2_000)) {
    fail("INVALID_SCHEMA", `artifact.receipts[${index}].logs is invalid`);
  }
}

function normalizeFoundryArtifact(artifact, gitCommit, guardian, compiled) {
  boundedJson(artifact, MAX_ARTIFACT_BYTES, "Foundry artifact");
  exactKeys(artifact, [
    "transactions", "receipts", "libraries", "pending", "returns", "timestamp", "chain", "commit",
  ], "Foundry artifact");
  if (artifact.chain !== ROBINHOOD_CHAIN_ID) fail("WRONG_CHAIN", "artifact chain must be 4663");
  const foundryArtifactCommit = normalizeFoundryCommit(artifact.commit);
  if (!gitCommit.startsWith(foundryArtifactCommit)) {
    fail("ARTIFACT_COMMIT_MISMATCH", "artifact commit is not a prefix of the release commit");
  }
  safeNumber(artifact.timestamp, "artifact timestamp", { positive: true });
  if (!Array.isArray(artifact.pending) || artifact.pending.length !== 0
    || !Array.isArray(artifact.libraries) || artifact.libraries.length !== 0) {
    fail("AMBIGUOUS_ARTIFACT", "pending and libraries must be exact empty arrays");
  }
  if (!Array.isArray(artifact.transactions) || artifact.transactions.length !== 5
    || !Array.isArray(artifact.receipts) || artifact.receipts.length !== 5) {
    fail("AMBIGUOUS_ARTIFACT", "artifact must contain exactly five transactions and receipts");
  }

  const addresses = {};
  const addressSet = new Set();
  const hashSet = new Set();
  let deployer;
  artifact.transactions.forEach((transaction, index) => {
    const name = EXPECTED_DEPLOYMENT_ORDER[index];
    exactKeys(transaction, [
      "hash", "transactionType", "contractName", "contractAddress", "function", "arguments",
      "transaction", "additionalContracts", "isFixedGasLimit",
    ], `artifact.transactions[${index}]`);
    requiredAllowedKeys(transaction.transaction, [
      "from", "gas", "value", "input", "nonce", "chainId",
    ], ["from", "to", "gas", "value", "input", "nonce", "chainId"], `${name}.transaction`);
    if (transaction.transactionType !== "CREATE" || transaction.contractName !== name
      || transaction.function !== null || transaction.isFixedGasLimit !== false) {
      fail("WRONG_CREATION_ORDER", `transaction ${index} is not the canonical ${name} creation`);
    }
    if (!Array.isArray(transaction.additionalContracts)
      || transaction.additionalContracts.length !== 0) {
      fail("AMBIGUOUS_CREATION", `${name}.additionalContracts must be an exact empty array`);
    }
    if (transaction.transaction.to !== undefined && transaction.transaction.to !== null) {
      fail("NOT_CREATION_TRANSACTION", `${name} unexpectedly has a target`);
    }
    if (parseUint(transaction.transaction.chainId, `${name} chain ID`)
      !== BigInt(ROBINHOOD_CHAIN_ID)
      || parseUint(transaction.transaction.value, `${name} value`) !== 0n) {
      fail("UNSAFE_CREATION", `${name} chain or value is wrong`);
    }
    const address = normalizeAddress(transaction.contractAddress, `${name} address`);
    const hash = normalizeHash(transaction.hash, `${name} transaction hash`);
    if (addressSet.has(address.toLowerCase()) || hashSet.has(hash)) {
      fail("DUPLICATE_CREATION", `${name} reuses an address or transaction hash`);
    }
    addressSet.add(address.toLowerCase());
    hashSet.add(hash);
    addresses[name] = address;
    const sender = normalizeAddress(transaction.transaction.from, `${name} deployer`);
    if (deployer && deployer.toLowerCase() !== sender.toLowerCase()) {
      fail("MULTIPLE_DEPLOYERS", "all creations must have one deployer");
    }
    deployer = sender;
  });

  exactKeys(artifact.returns, ["deployment"], "artifact.returns");
  exactKeys(artifact.returns.deployment, ["internal_type", "value"], "artifact.returns.deployment");
  if (artifact.returns.deployment.internal_type !== "struct DeployArtBroker.Deployment") {
    fail("INVALID_RETURN_BINDING", "artifact deployment return type is wrong");
  }
  const returned = /^\((.*)\)$/.exec(artifact.returns.deployment.value ?? "")?.[1]?.split(",");
  if (!returned || returned.length !== 5) fail("INVALID_RETURN_BINDING", "deployment return is malformed");
  returned.forEach((address, index) => sameAddress(
    address.trim(),
    addresses[EXPECTED_DEPLOYMENT_ORDER[index]],
    `deployment return ${index}`,
  ));

  const receipts = new Map();
  artifact.receipts.forEach((receipt, index) => {
    validateArtifactReceiptSchema(receipt, index);
    const hash = normalizeHash(receipt.transactionHash, `artifact receipt ${index} hash`);
    if (receipts.has(hash)) fail("DUPLICATE_RECEIPT", `artifact receipt ${index} is duplicated`);
    receipts.set(hash, receipt);
  });

  const records = artifact.transactions.map((transaction, index) => {
    const name = EXPECTED_DEPLOYMENT_ORDER[index];
    const transactionHash = normalizeHash(transaction.hash, `${name} transaction hash`);
    const receipt = receipts.get(transactionHash);
    if (!receipt) fail("MISSING_RECEIPT", `${name} receipt is missing`);
    successfulReceipt(receipt.status, `${name} artifact receipt`);
    sameAddress(receipt.contractAddress, addresses[name], `${name} receipt contract`);
    sameAddress(receipt.from, deployer, `${name} receipt deployer`);
    if (receipt.to !== null) fail("NOT_CREATION_RECEIPT", `${name} receipt target must be null`);
    const deploymentBlock = safeNumber(receipt.blockNumber, `${name} deployment block`, {
      positive: true,
    });
    const deploymentBlockHash = normalizeHash(receipt.blockHash, `${name} deployment block hash`);
    if (!Array.isArray(transaction.arguments)) {
      fail("MISSING_CONSTRUCTOR_ARGS", `${name} arguments must be an array`);
    }
    const definition = constructorDefinition(name, { guardian, addresses }, transaction.arguments);
    if (transaction.arguments.length !== definition.values.length) {
      fail("CONSTRUCTOR_ARGS_MISMATCH", `${name} argument count is wrong`);
    }
    const constructorArguments = transaction.arguments.map((value, argumentIndex) => (
      definition.types[argumentIndex].type === "address"
        ? sameAddress(value, definition.values[argumentIndex], `${name} argument ${argumentIndex}`)
        : normalizeBytes32(value, `${name} argument ${argumentIndex}`, { allowZero: true })
    ));
    const encodedArguments = encodeAbiParameters(definition.types, constructorArguments);
    const expectedInput = `${compiled[name].creationBytecode}${encodedArguments.slice(2)}`;
    const artifactInput = normalizeBytecode(transaction.transaction.input, `${name} artifact input`);
    if (artifactInput !== expectedInput.toLowerCase()) {
      fail("COMPILED_INITCODE_MISMATCH", `${name} artifact input differs from compiled code plus args`);
    }
    return {
      name,
      address: addresses[name],
      transactionHash,
      artifactInput,
      deploymentBlock,
      deploymentBlockHash,
      deployer,
      constructorArguments,
      compiled: compiled[name],
    };
  });
  if (receipts.size !== records.length) fail("AMBIGUOUS_RECEIPTS", "artifact has unmatched receipts");
  return {
    records,
    deployer,
    accountSalt: records.at(-1).constructorArguments[1],
    foundryArtifactCommit,
  };
}

function validateSourceProvenance(provenance, releaseCommit, foundryArtifactCommit) {
  exactKeys(provenance, [
    "artifactResolvedCommit", "compilerInputsClean", "foundryArtifactCommit", "headCommit",
    "offlineBuildCommand", "offlineBuildCompleted", "releaseGitCommit",
  ], "sourceProvenance");
  for (const [field, expected] of [
    ["releaseGitCommit", releaseCommit],
    ["headCommit", releaseCommit],
    ["artifactResolvedCommit", releaseCommit],
  ]) {
    if (normalizeCommit(provenance[field], `sourceProvenance.${field}`) !== expected) {
      fail("SOURCE_PROVENANCE_MISMATCH", `${field} does not match the supplied release commit`);
    }
  }
  if (normalizeFoundryCommit(provenance.foundryArtifactCommit) !== foundryArtifactCommit) {
    fail("SOURCE_PROVENANCE_MISMATCH", "Foundry artifact commit evidence differs from the artifact");
  }
  if (provenance.compilerInputsClean !== true || provenance.offlineBuildCompleted !== true) {
    fail("SOURCE_PROVENANCE_MISMATCH", "clean compiler inputs and offline rebuild are required");
  }
  if (JSON.stringify(provenance.offlineBuildCommand)
    !== JSON.stringify(["forge", "build", "--offline", "--force"])) {
    fail("SOURCE_PROVENANCE_MISMATCH", "offline build command is noncanonical");
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
  const value = typeof stdout === "string" ? stdout.trim() : "";
  return normalizeCommit(value, label);
}

export async function verifyCliSourceProvenance({
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
  const resolveGitState = async () => {
    const [headResult, artifactResult, statusResult] = await Promise.all([
      run("git", ["rev-parse", "--verify", "HEAD^{commit}"], "HEAD resolution"),
      run(
        "git",
        ["rev-parse", "--verify", `${foundryCommit}^{commit}`],
        "Foundry artifact commit resolution",
      ),
      run(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "--", ...COMPILER_INPUT_PATHS],
        "compiler input status",
      ),
    ]);
    const headCommit = commandCommit(headResult?.stdout, "resolved HEAD");
    const artifactResolvedCommit = commandCommit(
      artifactResult?.stdout,
      "resolved Foundry artifact commit",
    );
    if (headCommit !== releaseCommit || artifactResolvedCommit !== releaseCommit) {
      fail(
        "SOURCE_PROVENANCE_MISMATCH",
        "HEAD and the Foundry artifact commit must resolve to the supplied release commit",
      );
    }
    if (typeof statusResult?.stdout !== "string" || statusResult.stdout.trim() !== "") {
      fail("DIRTY_COMPILER_INPUTS", "canonical compiler inputs differ from clean HEAD");
    }
    return { headCommit, artifactResolvedCommit };
  };

  await resolveGitState();
  await run("forge", ["build", "--offline", "--force"], "offline canonical rebuild");
  const resolved = await resolveGitState();
  return Object.freeze({
    releaseGitCommit: releaseCommit,
    headCommit: resolved.headCommit,
    artifactResolvedCommit: resolved.artifactResolvedCommit,
    foundryArtifactCommit: foundryCommit,
    compilerInputsClean: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: Object.freeze(["forge", "build", "--offline", "--force"]),
  });
}

function normalizeEndpointEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    fail("INSUFFICIENT_READ_CLIENTS", "at least two read-only endpoint entries are required");
  }
  const origins = new Set();
  const providerDomains = new Set();
  const clients = new Set();
  return entries.map((entry, index) => {
    exactKeys(entry, ["origin", "client"], `readEndpoints[${index}]`);
    let url;
    try {
      url = new URL(entry.origin);
    } catch {
      fail("INVALID_ENDPOINT_ORIGIN", `read endpoint ${index + 1} origin is invalid`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== entry.origin) {
      fail("INVALID_ENDPOINT_ORIGIN", `read endpoint ${index + 1} must be an exact public HTTPS origin`);
    }
    if (origins.has(url.origin)) {
      fail("DUPLICATE_ENDPOINT_ORIGIN", "read endpoint origins must be distinct");
    }
    const providerDomain = registrableProviderDomain(url.hostname);
    if (providerDomains.has(providerDomain)) {
      fail(
        "DUPLICATE_PROVIDER_DOMAIN",
        "read endpoints must use distinct registrable provider domains",
      );
    }
    if (clients.has(entry.client)) {
      fail("DUPLICATE_READ_CLIENT", "read endpoint clients must be distinct objects");
    }
    clients.add(entry.client);
    origins.add(url.origin);
    providerDomains.add(providerDomain);
    let transportOrigin;
    try {
      transportOrigin = new URL(entry.client?.transport?.url).origin;
    } catch {
      fail("UNBOUND_ENDPOINT_ORIGIN", `read endpoint ${index + 1} lacks transport URL provenance`);
    }
    if (transportOrigin !== url.origin) {
      fail("UNBOUND_ENDPOINT_ORIGIN", `read endpoint ${index + 1} origin differs from its client`);
    }
    for (const method of [
      "getChainId", "getBlockNumber", "getBlock", "getTransactionReceipt", "getTransaction",
      "getCode", "readContract",
    ]) {
      if (typeof entry.client?.[method] !== "function") {
        fail("INVALID_READ_CLIENT", `read endpoint ${index + 1} lacks ${method}`);
      }
    }
    return { origin: url.origin, client: entry.client };
  });
}

function registrableProviderDomain(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return normalized;
  }
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const compoundSuffixes = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = labels.slice(-2).join(".");
  return compoundSuffixes.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function normalizeBlockTransactionHash(transaction, label) {
  return normalizeHash(typeof transaction === "string" ? transaction : transaction?.hash, label);
}

async function pinnedBlockForEndpoints(endpoints, confirmations) {
  const heads = await Promise.all(endpoints.map(async ({ client }, index) => {
    try {
      const chainId = await client.getChainId();
      if (Number(chainId) !== ROBINHOOD_CHAIN_ID) fail("WRONG_CHAIN", `endpoint ${index + 1} is wrong`);
      return parseUint(await client.getBlockNumber(), `endpoint ${index + 1} head`, { positive: true });
    } catch (error) {
      if (error instanceof ManifestProposalError) throw error;
      fail("LIVE_READ_FAILED", `endpoint ${index + 1} head read failed`);
    }
  }));
  const minimumHead = heads.reduce((minimum, head) => head < minimum ? head : minimum);
  const maximumHead = heads.reduce((maximum, head) => head > maximum ? head : maximum);
  if (maximumHead - minimumHead > MAX_HEAD_SKEW) {
    fail("RPC_HEAD_SKEW", `read endpoint heads differ by more than ${MAX_HEAD_SKEW} blocks`);
  }
  if (minimumHead <= BigInt(confirmations)) {
    fail("UNCONFIRMED_CHAIN", "chain head is too low for the requested confirmations");
  }
  const number = minimumHead - BigInt(confirmations);
  const blocks = await Promise.all(endpoints.map(async ({ client }, index) => {
    try {
      return await client.getBlock({ blockNumber: number, includeTransactions: false });
    } catch {
      fail("LIVE_READ_FAILED", `endpoint ${index + 1} pinned block read failed`);
    }
  }));
  const hashes = blocks.map((block, index) => {
    if (parseUint(block?.number, `endpoint ${index + 1} pinned block`) !== number) {
      fail("PINNED_BLOCK_MISMATCH", `endpoint ${index + 1} returned the wrong block`);
    }
    return normalizeHash(block.hash, `endpoint ${index + 1} pinned block hash`);
  });
  if (new Set(hashes).size !== 1) fail("RPC_DISAGREEMENT", "endpoint pinned block hashes differ");
  return { number, hash: hashes[0], heads };
}

async function verifyCriticalBindings(endpoint, endpointIndex, records, blockNumber, guardian) {
  const addresses = Object.fromEntries(records.map((record) => [record.name, record.address]));
  const read = (address, abi, functionName) => endpoint.client.readContract({
    address,
    abi,
    functionName,
    blockNumber,
  });
  let values;
  try {
    values = await Promise.all([
      read(addresses.BrokerPolicyModule, policyBindingAbi, "GOGH_PUNKS"),
      read(addresses.BrokerPolicyModule, policyBindingAbi, "ROBINHOOD_CHAIN_ID"),
      read(addresses.BrokerPolicyModule, policyBindingAbi, "adapterRegistry"),
      read(addresses.GoghPunkAccountV1, accountBindingAbi, "GOGH_PUNKS"),
      read(addresses.GoghPunkAccountV1, accountBindingAbi, "ROBINHOOD_CHAIN_ID"),
      read(addresses.GoghPunkAccountV1, accountBindingAbi, "policyModule"),
      read(addresses.GoghPunkAccountV1, accountBindingAbi, "agentRegistry"),
      read(addresses.GoghPunkAccountV1, accountBindingAbi, "adapterRegistry"),
      read(addresses.GoghPunkAccountRegistry, registryBindingAbi, "GOGH_PUNKS"),
      read(addresses.GoghPunkAccountRegistry, registryBindingAbi, "ROBINHOOD_CHAIN_ID"),
      read(addresses.GoghPunkAccountRegistry, registryBindingAbi, "implementation"),
      read(addresses.GoghPunkAccountRegistry, registryBindingAbi, "accountSalt"),
      read(addresses.GoghPunkAccountRegistry, registryBindingAbi, "canonicalRegistry"),
      read(addresses.ArtAdapterRegistry, ownableBindingAbi, "owner"),
      read(addresses.ArtAdapterRegistry, ownableBindingAbi, "pendingOwner"),
      read(addresses.ArtAgentRegistry, ownableBindingAbi, "owner"),
      read(addresses.ArtAgentRegistry, ownableBindingAbi, "pendingOwner"),
      read(addresses.BrokerPolicyModule, policyBindingAbi, "owner"),
      read(addresses.BrokerPolicyModule, policyBindingAbi, "pendingOwner"),
      read(addresses.BrokerPolicyModule, policyBindingAbi, "featureFlags"),
    ]);
  } catch {
    fail("LIVE_BINDING_READ_FAILED", `critical binding read failed on endpoint ${endpointIndex + 1}`);
  }
  const expectedSalt = records.at(-1).constructorArguments[1];
  const addressValue = (index, expected, label) => (
    sameAddress(values[index], expected, label).toLowerCase()
  );
  const chainValue = (index, label) => {
    const value = parseUint(values[index], label);
    if (value !== BigInt(ROBINHOOD_CHAIN_ID)) fail("LIVE_BINDING_MISMATCH", `${label} is wrong`);
    return value.toString();
  };
  const salt = normalizeHash(values[11], "registry live account salt", { allowZero: true });
  if (salt !== expectedSalt.toLowerCase()) {
    fail("LIVE_BINDING_MISMATCH", "registry live account salt is wrong");
  }
  const pendingOwner = (index, label) => {
    const value = normalizeAddress(values[index], label, { allowZero: true }).toLowerCase();
    if (value !== ZERO_ADDRESS) fail("PENDING_OWNERSHIP", `${label} must be zero`);
    return value;
  };
  const featureTuple = values[19];
  const tupleField = (name, index) => featureTuple?.[name] ?? featureTuple?.[index];
  const expectedFeatureValues = [
    ["scoutMode", SAFE_FEATURE_FLAGS.ENABLE_SCOUT_MODE],
    ["approvalPurchases", SAFE_FEATURE_FLAGS.ENABLE_APPROVAL_PURCHASES],
    ["autonomousPurchases", SAFE_FEATURE_FLAGS.ENABLE_AUTONOMOUS_PURCHASES],
    ["autonomousMints", SAFE_FEATURE_FLAGS.ENABLE_AUTONOMOUS_MINTS],
    ["unknownCollectionExecution", SAFE_FEATURE_FLAGS.ENABLE_UNKNOWN_COLLECTION_EXECUTION],
    ["selling", SAFE_FEATURE_FLAGS.ENABLE_SELLING],
    ["autonomousSelling", SAFE_FEATURE_FLAGS.ENABLE_AUTONOMOUS_SELLING],
  ];
  const featureFlags = {};
  for (const [index, [name, expected]] of expectedFeatureValues.entries()) {
    const value = tupleField(name, index);
    if (value !== expected) {
      fail("UNSAFE_LIVE_FEATURE_FLAGS", `live BrokerPolicyModule.${name} must be ${expected}`);
    }
    featureFlags[name] = value;
  }
  return {
    policy: {
      collection: addressValue(0, CANONICAL_COLLECTION, "policy live collection"),
      chainId: chainValue(1, "policy live chain ID"),
      adapterRegistry: addressValue(
        2,
        addresses.ArtAdapterRegistry,
        "policy live adapter registry",
      ),
    },
    accountImplementation: {
      collection: addressValue(3, CANONICAL_COLLECTION, "account live collection"),
      chainId: chainValue(4, "account live chain ID"),
      policyModule: addressValue(5, addresses.BrokerPolicyModule, "account live policy module"),
      agentRegistry: addressValue(6, addresses.ArtAgentRegistry, "account live agent registry"),
      adapterRegistry: addressValue(7, addresses.ArtAdapterRegistry, "account live adapter registry"),
    },
    accountRegistry: {
      collection: addressValue(8, CANONICAL_COLLECTION, "registry live collection"),
      chainId: chainValue(9, "registry live chain ID"),
      implementation: addressValue(
        10,
        addresses.GoghPunkAccountV1,
        "registry live implementation",
      ),
      accountSalt: salt,
      canonicalRegistry: addressValue(
        12,
        CANONICAL_ERC6551_REGISTRY,
        "registry live canonical registry",
      ),
    },
    governedAuthority: {
      artAdapterRegistry: {
        owner: addressValue(13, guardian, "ArtAdapterRegistry live owner"),
        pendingOwner: pendingOwner(14, "ArtAdapterRegistry live pending owner"),
      },
      artAgentRegistry: {
        owner: addressValue(15, guardian, "ArtAgentRegistry live owner"),
        pendingOwner: pendingOwner(16, "ArtAgentRegistry live pending owner"),
      },
      brokerPolicyModule: {
        owner: addressValue(17, guardian, "BrokerPolicyModule live owner"),
        pendingOwner: pendingOwner(18, "BrokerPolicyModule live pending owner"),
        featureFlags,
      },
    },
  };
}

async function verifyEndpoint(endpoint, endpointIndex, records, pinnedBlock, guardian) {
  const evidence = [];
  for (const record of records) {
    if (BigInt(record.deploymentBlock) > pinnedBlock.number) {
      fail("UNCONFIRMED_DEPLOYMENT", `${record.name} is newer than the common pinned block`);
    }
    let receipt;
    let transaction;
    let code;
    let deploymentBlock;
    try {
      [receipt, transaction, code, deploymentBlock] = await Promise.all([
        endpoint.client.getTransactionReceipt({ hash: record.transactionHash }),
        endpoint.client.getTransaction({ hash: record.transactionHash }),
        endpoint.client.getCode({ address: record.address, blockNumber: pinnedBlock.number }),
        endpoint.client.getBlock({
          blockNumber: BigInt(record.deploymentBlock),
          includeTransactions: false,
        }),
      ]);
    } catch {
      fail("LIVE_READ_FAILED", `${record.name} read failed on endpoint ${endpointIndex + 1}`);
    }
    successfulReceipt(receipt?.status, `${record.name} live receipt`);
    if (normalizeHash(receipt.transactionHash, `${record.name} receipt hash`)
      !== record.transactionHash
      || safeNumber(receipt.blockNumber, `${record.name} receipt block`, { positive: true })
        !== record.deploymentBlock
      || normalizeHash(receipt.blockHash, `${record.name} receipt block hash`)
        !== record.deploymentBlockHash) {
      fail("LIVE_RECEIPT_MISMATCH", `${record.name} receipt differs from artifact`);
    }
    sameAddress(receipt.contractAddress, record.address, `${record.name} receipt contract`);
    sameAddress(receipt.from, record.deployer, `${record.name} receipt deployer`);
    if (receipt.to !== null) fail("NOT_CREATION_RECEIPT", `${record.name} receipt target is not null`);

    if (normalizeHash(transaction?.hash, `${record.name} live transaction hash`)
      !== record.transactionHash
      || normalizeBytecode(transaction.input, `${record.name} live transaction input`)
        !== record.artifactInput
      || parseUint(transaction.value, `${record.name} live transaction value`) !== 0n
      || parseUint(transaction.chainId, `${record.name} live transaction chain ID`)
        !== BigInt(ROBINHOOD_CHAIN_ID)
      || safeNumber(transaction.blockNumber, `${record.name} live transaction block`, {
        positive: true,
      }) !== record.deploymentBlock
      || normalizeHash(transaction.blockHash, `${record.name} live transaction block hash`)
        !== record.deploymentBlockHash) {
      fail("LIVE_TRANSACTION_MISMATCH", `${record.name} live transaction differs from artifact`);
    }
    sameAddress(transaction.from, record.deployer, `${record.name} live transaction deployer`);
    if (transaction.to !== null) {
      fail("NOT_CREATION_TRANSACTION", `${record.name} live transaction target is not null`);
    }

    if (parseUint(deploymentBlock?.number, `${record.name} deployment block number`)
      !== BigInt(record.deploymentBlock)
      || normalizeHash(deploymentBlock.hash, `${record.name} deployment block hash`)
        !== record.deploymentBlockHash
      || !Array.isArray(deploymentBlock.transactions)) {
      fail("DEPLOYMENT_BLOCK_MISMATCH", `${record.name} deployment block differs from receipt`);
    }
    const transactionHashes = deploymentBlock.transactions.map((item, index) => (
      normalizeBlockTransactionHash(item, `${record.name} block transaction ${index}`)
    ));
    if (!transactionHashes.includes(record.transactionHash)) {
      fail("TRANSACTION_NOT_IN_BLOCK", `${record.name} transaction is absent from deployment block`);
    }

    const runtimeBytecode = normalizeBytecode(code, `${record.name} runtime bytecode`);
    if ((runtimeBytecode.length - 2) !== (record.compiled.deployedBytecode.length - 2)
      || maskedRuntimeHash(runtimeBytecode, record.compiled.immutableRanges)
        !== record.compiled.maskedDeployedBytecodeHash) {
      fail("COMPILED_RUNTIME_MISMATCH", `${record.name} runtime does not match compiled output`);
    }
    evidence.push({
      name: record.name,
      runtimeBytecodeHash: keccak256(runtimeBytecode),
      compiledCreationBytecodeHash: record.compiled.creationBytecodeHash,
      compiledDeployedBytecodeTemplateHash: record.compiled.deployedBytecodeTemplateHash,
      compiledMaskedDeployedBytecodeHash: record.compiled.maskedDeployedBytecodeHash,
    });
  }
  let canonicalRegistryCode;
  try {
    canonicalRegistryCode = await endpoint.client.getCode({
      address: CANONICAL_ERC6551_REGISTRY,
      blockNumber: pinnedBlock.number,
    });
  } catch {
    fail("LIVE_READ_FAILED", `canonical ERC-6551 registry read failed on endpoint ${endpointIndex + 1}`);
  }
  const canonicalRegistryRuntimeCodeHash = keccak256(normalizeBytecode(
    canonicalRegistryCode,
    "canonical ERC-6551 registry runtime bytecode",
  ));
  if (canonicalRegistryRuntimeCodeHash !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH) {
    fail(
      "CANONICAL_REGISTRY_CODE_MISMATCH",
      `canonical ERC-6551 registry runtime hash is wrong on endpoint ${endpointIndex + 1}`,
    );
  }
  const criticalBindings = await verifyCriticalBindings(
    endpoint,
    endpointIndex,
    records,
    pinnedBlock.number,
    guardian,
  );
  let closingBlock;
  try {
    closingBlock = await endpoint.client.getBlock({
      blockNumber: pinnedBlock.number,
      includeTransactions: false,
    });
  } catch {
    fail("LIVE_READ_FAILED", `endpoint ${endpointIndex + 1} closing pinned block read failed`);
  }
  if (parseUint(closingBlock?.number, `endpoint ${endpointIndex + 1} closing block`)
    !== pinnedBlock.number
    || normalizeHash(closingBlock.hash, `endpoint ${endpointIndex + 1} closing block hash`)
      !== pinnedBlock.hash) {
    fail("PINNED_BLOCK_CHANGED", `endpoint ${endpointIndex + 1} pinned block changed during reads`);
  }
  return { contracts: evidence, canonicalRegistryRuntimeCodeHash, criticalBindings };
}

async function verifyLiveDeployment(records, endpointEntries, confirmations, guardian) {
  const endpoints = normalizeEndpointEntries(endpointEntries);
  const pinnedBlock = await pinnedBlockForEndpoints(endpoints, confirmations);
  const observations = await Promise.all(endpoints.map((endpoint, index) => (
    verifyEndpoint(endpoint, index, records, pinnedBlock, guardian)
  )));
  const baseline = JSON.stringify(observations[0]);
  if (observations.some((observation) => JSON.stringify(observation) !== baseline)) {
    fail("RPC_DISAGREEMENT", "read endpoint deployment observations differ");
  }
  return {
    evidence: observations[0].contracts,
    canonicalRegistryRuntimeCodeHash: observations[0].canonicalRegistryRuntimeCodeHash,
    criticalBindings: observations[0].criticalBindings,
    pinnedBlock: {
      number: safeNumber(pinnedBlock.number, "pinned block", { positive: true }),
      hash: pinnedBlock.hash,
      confirmations,
    },
    origins: endpoints.map(({ origin }) => origin),
  };
}

export async function buildRobinhoodDeploymentManifestProposal({
  artifact,
  compiledArtifacts,
  gitCommit: suppliedCommit,
  guardian: suppliedGuardian,
  template,
  readEndpoints,
  confirmations,
  sourceProvenance,
}) {
  const gitCommit = normalizeCommit(suppliedCommit, "release git commit");
  const guardian = normalizeAddress(suppliedGuardian, "protocol guardian");
  const confirmationCount = normalizeConfirmations(confirmations);
  validateCanonicalTemplate(template);
  const compiled = normalizeCompiledArtifacts(compiledArtifacts);
  const normalized = normalizeFoundryArtifact(artifact, gitCommit, guardian, compiled);
  validateSourceProvenance(sourceProvenance, gitCommit, normalized.foundryArtifactCommit);
  if (normalized.accountSalt.toLowerCase() !== ZERO_HASH) {
    fail("NONCANONICAL_ACCOUNT_SALT", "broadcast registry salt must be zero bytes32");
  }
  if (normalized.accountSalt.toLowerCase() !== template.accountSalt.toLowerCase()) {
    fail("ACCOUNT_SALT_MISMATCH", "broadcast registry salt differs from the canonical template");
  }
  if (normalized.deployer.toLowerCase() === guardian.toLowerCase()) {
    fail("GUARDIAN_DEPLOYER_COLLISION", "protocol guardian must differ from the deployer");
  }
  const live = await verifyLiveDeployment(
    normalized.records,
    readEndpoints,
    confirmationCount,
    guardian,
  );
  const evidenceByName = new Map(live.evidence.map((item) => [item.name, item]));

  const contracts = Object.fromEntries(normalized.records.map((record) => [record.name, {
    address: record.address,
    deploymentTransaction: record.transactionHash,
    deploymentBlock: record.deploymentBlock,
    deployer: record.deployer,
    implementationVersion: "1",
    constructorArguments: record.constructorArguments,
    creationBytecodeHash: record.compiled.creationBytecodeHash,
    runtimeBytecodeHash: evidenceByName.get(record.name).runtimeBytecodeHash,
    gitCommit,
    verificationStatus: "NOT_SUBMITTED",
  }]));
  const manifest = {
    status: "DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: ROBINHOOD_CHAIN_ID,
      rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeCurrency: "ETH",
    },
    canonicalCollection: getAddress(CANONICAL_COLLECTION),
    canonicalERC6551Registry: getAddress(CANONICAL_ERC6551_REGISTRY),
    canonicalERC6551RegistryRuntimeCodeHash:
      CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
    verifiedExternalInfrastructure: { seaport: { ...SEAPORT } },
    accountSalt: normalized.accountSalt,
    gitCommit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts,
    sourceVerificationAdoption: null,
    featureFlags: { ...SAFE_FEATURE_FLAGS },
    protocolGuardian: guardian,
    notes: "COMPLETE MANIFEST PROPOSAL only. Clean-HEAD offline compiler outputs, live creation transactions, receipts, critical immutable getters, deployment blocks, protocol runtime code, and the canonical ERC-6551 registry runtime pin passed read-only agreement checks at a common confirmed block. RPC provider independence and guardian contract/multisig status remain UNVERIFIED. Blockscout source verification is NOT_SUBMITTED. No transaction feature is enabled.",
  };
  return {
    schema: "GOGH_ROBINHOOD_DEPLOYMENT_MANIFEST_PROPOSAL_V2",
    proposalStatus: "COMPLETE_MANIFEST_PROPOSAL",
    trustBindings: {
      chainId: ROBINHOOD_CHAIN_ID,
      releaseGitCommit: gitCommit,
      foundryArtifactCommit: normalized.foundryArtifactCommit,
      sourceProvenance: { ...sourceProvenance },
      commonPinnedBlock: live.pinnedBlock,
      distinctReadEndpointOrigins: live.origins,
      providerIndependence: "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS",
      guardianAuthority: {
        address: guardian,
        differsFromDeployer: true,
        contractStatus: "UNVERIFIED",
        multisigStatus: "UNVERIFIED",
      },
      canonicalERC6551Registry: {
        address: getAddress(CANONICAL_ERC6551_REGISTRY),
        runtimeCodeHash: live.canonicalRegistryRuntimeCodeHash,
        matchedReadEndpoints: live.origins.length,
      },
      criticalImmutableBindings: live.criticalBindings,
      compiledContracts: Object.fromEntries(live.evidence.map((item) => [item.name, {
        creationBytecodeHash: item.compiledCreationBytecodeHash,
        deployedBytecodeTemplateHash: item.compiledDeployedBytecodeTemplateHash,
        maskedDeployedBytecodeHash: item.compiledMaskedDeployedBytecodeHash,
        rawMetadataSha256: compiled[item.name].rawMetadataSha256,
        sourceSetSha256: compiled[item.name].sourceSetSha256,
        compilerSettingsSha256: compiled[item.name].compilerSettingsSha256,
        abiSha256: compiled[item.name].abiSha256,
      }])),
    },
    manifest,
  };
}

export function renderRobinhoodDeploymentManifestProposal(proposal) {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}

function parseArguments(argv) {
  const allowed = new Set(["--artifact", "--git-commit", "--guardian", "--confirmations"]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", "required: --artifact --git-commit --guardian; optional: --confirmations");
    }
    if (Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} was supplied twice`);
    parsed[flag] = value;
  }
  for (const flag of ["--artifact", "--git-commit", "--guardian"]) {
    if (!Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} is required`);
  }
  return parsed;
}

export async function readBoundedDeploymentJson(
  path,
  maximum,
  label,
  { openFile = open } = {},
) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4_096
    || !Number.isSafeInteger(maximum) || maximum <= 0 || typeof label !== "string"
    || label.length === 0 || typeof openFile !== "function") {
    fail("INVALID_FILE_READ", "bounded JSON read parameters are invalid");
  }
  let handle;
  try {
    handle = await openFile(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximum)) {
      fail("INPUT_TOO_LARGE", `${label} must be a bounded nonempty regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== before.size) {
      fail("FILE_CHANGED", `${label} changed while it was read`);
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("INVALID_JSON", `${label} is not valid UTF-8 JSON`);
    }
    try {
      return JSON.parse(text);
    } catch {
      fail("INVALID_JSON", `${label} is not valid JSON`);
    }
  } catch (error) {
    if (error instanceof ManifestProposalError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be opened as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const artifactPath = resolve(process.cwd(), args["--artifact"]);
  const normalizedPath = artifactPath.replaceAll("\\", "/");
  if (!normalizedPath.includes("/broadcast/DeployArtBroker.s.sol/4663/")
    || normalizedPath.includes("/dry-run/")
    || !/^run-(?:latest|\d+)\.json$/.test(normalizedPath.split("/").at(-1))) {
    fail("INVALID_ARTIFACT_PATH", "use an explicit non-dry-run DeployArtBroker chain-4663 artifact");
  }
  const urls = [process.env.ROBINHOOD_RPC_URL, process.env.ROBINHOOD_SECONDARY_RPC_URL];
  if (urls.some((url) => !url)) fail("MISSING_READ_ENDPOINTS", "two read-only RPC URLs are required");
  const endpoints = urls.map((url, index) => {
    const parsed = new URL(url);
    const chain = {
      id: ROBINHOOD_CHAIN_ID,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    };
    return {
      origin: parsed.origin,
      client: createPublicClient({ chain, transport: http(url), name: `manifest-read-${index + 1}` }),
    };
  });
  const [artifact, template] = await Promise.all([
    readBoundedDeploymentJson(artifactPath, MAX_ARTIFACT_BYTES, "Foundry artifact"),
    readBoundedDeploymentJson(defaultTemplatePath, MAX_TEMPLATE_BYTES, "manifest template"),
  ]);
  const sourceProvenance = await verifyCliSourceProvenance({
    releaseGitCommit: args["--git-commit"],
    foundryArtifactCommit: artifact?.commit,
  });
  const compiledArtifacts = Object.fromEntries(await Promise.all(
    EXPECTED_DEPLOYMENT_ORDER.map(async (name) => [name, await readBoundedDeploymentJson(
      resolve(projectRoot, `contracts/out/${name}.sol/${name}.json`),
      MAX_COMPILED_ARTIFACT_BYTES,
      `${name} compiled artifact`,
    )]),
  ));
  const proposal = await buildRobinhoodDeploymentManifestProposal({
    artifact,
    compiledArtifacts,
    gitCommit: args["--git-commit"],
    guardian: args["--guardian"],
    template,
    readEndpoints: endpoints,
    confirmations: args["--confirmations"],
    sourceProvenance,
  });
  process.stdout.write(renderRobinhoodDeploymentManifestProposal(proposal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof ManifestProposalError
      ? error.message
      : "UNEXPECTED_FAILURE: manifest proposal generation failed closed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
