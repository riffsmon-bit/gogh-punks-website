import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import {
  attestLiveApproval,
  LiveApprovalPreflightError,
} from "./canary-approval-live-preflight.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  sourceVerificationCanonicalSha256,
  validateSourceVerificationAdoption,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

const CORE_CONTRACTS = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_CONTRACTS = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);

export const MAX_PROPOSAL_BYTES = 1_000_000;
export const MAX_MANIFEST_BYTES = 500_000;
export const MAX_CONFIG_BUNDLE_BYTES = 2_000_000;
export const MAX_CONFIGURATION_EVIDENCE_BYTES = 250_000;
export const DEFAULT_CONFIRMATIONS = 20;

const projectRoot = resolve(import.meta.dirname, "..");
export const AUTHORITATIVE_MANIFEST_PATH = resolve(projectRoot, "deployments/robinhood.json");
export const AUTHORITATIVE_CANARY_MANIFEST_PATH = resolve(
  projectRoot,
  "deployments/robinhood-canary.json",
);
const DEPENDENCY_KEYS = new Set([
  "attestor",
  "clientFactory",
  "cwd",
  "env",
  "nowSeconds",
  "readJson",
]);

const robinhoodChain = defineChain({
  id: ROBINHOOD.chainId,
  name: ROBINHOOD.name,
  nativeCurrency: ROBINHOOD.nativeCurrency,
  rpcUrls: { default: { http: [ROBINHOOD.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD.explorerUrl } },
});

class LivePreflightRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LivePreflightRunnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LivePreflightRunnerError(code, message);
}

function plainObject(value, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail("INVALID_SCHEMA", `${label} fields do not match the expected schema`);
  }
}

function safeSnapshot(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} has an unsafe number`);
    return value;
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
  if (isArray && (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))
    || keys.length !== value.length + 1)) {
    fail("INVALID_SCHEMA", `${label} is not a dense JSON array`);
  }
  const output = isArray ? [] : {};
  for (const key of keys) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label}.${key} is not an enumerable data field`);
    }
    output[key] = safeSnapshot(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
  return output;
}

function parseConfirmations(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 12 || parsed > 128) {
    fail("INVALID_CONFIRMATIONS", "confirmations must be an integer from 12 through 128");
  }
  return parsed;
}

export function parseLivePreflightArguments(argv) {
  if (!Array.isArray(argv)) fail("INVALID_ARGUMENTS", "arguments must be an array");
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--proposal", "--config-bundle", "--configuration-evidence", "--confirmations"].includes(flag)) {
      fail("INVALID_ARGUMENTS", "only proposal, config-bundle, configuration-evidence, and confirmations flags are accepted");
    }
    if (value === undefined || typeof value !== "string" || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", `${flag} requires a value`);
    }
    if (Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} was supplied twice`);
    parsed[flag] = value;
  }
  if (!Object.hasOwn(parsed, "--proposal")) {
    fail("INVALID_ARGUMENTS", "--proposal <artifact.json> is required");
  }
  for (const required of ["--config-bundle", "--configuration-evidence"]) {
    if (!Object.hasOwn(parsed, required)) {
      fail("INVALID_ARGUMENTS", `${required} <artifact.json> is required`);
    }
  }
  const paths = {
    proposal: parsed["--proposal"],
    configBundle: parsed["--config-bundle"],
    configurationEvidence: parsed["--configuration-evidence"],
  };
  for (const [name, value] of Object.entries(paths)) {
    if (value.length === 0 || value.length > 4_096 || value.trim() !== value
      || value.includes("\0") || /[*?\[\]{}]/.test(value)
      || !basename(value).toLowerCase().endsWith(".json")) {
      fail("INVALID_ARTIFACT_PATH", `${name} must be one exact JSON file path`);
    }
  }
  return Object.freeze({
    ...paths,
    confirmations: parseConfirmations(parsed["--confirmations"] ?? DEFAULT_CONFIRMATIONS),
  });
}

export async function readBoundedJsonFile(path, maximumBytes, label) {
  if (typeof path !== "string" || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail("INVALID_FILE_READ", "bounded JSON read parameters are invalid");
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > maximumBytes) {
      fail("INVALID_FILE", `${label} must be a nonempty regular file within its size limit`);
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents, "utf8") > maximumBytes) {
      fail("INVALID_FILE", `${label} exceeds its size limit`);
    }
    try {
      return JSON.parse(contents);
    } catch {
      fail("INVALID_JSON", `${label} is not valid JSON`);
    }
  } catch (error) {
    if (error instanceof LivePreflightRunnerError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be read as an exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function providerDomain(hostname) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return hostname;
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const compoundSuffix = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = labels.slice(-2).join(".");
  return compoundSuffix.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function rpcDescriptor(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 4_096
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail("INVALID_RPC_ENDPOINT", `${label} must be an HTTPS URL`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_RPC_ENDPOINT", `${label} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.hash || !url.hostname) {
    fail("INVALID_RPC_ENDPOINT", `${label} must be an HTTPS URL without a fragment`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const port = url.port || "443";
  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  const search = [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ))
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    .join("&");
  return Object.freeze({
    href: url.href,
    endpointIdentity: `${host}:${port}${path}${search ? `?${search}` : ""}`,
    originIdentity: `${host}:${port}`,
    providerIdentity: providerDomain(host),
  });
}

export function readRpcEndpoints(environment) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    fail("INVALID_ENVIRONMENT", "environment is unavailable");
  }
  const primary = rpcDescriptor(environment.ROBINHOOD_RPC_URL, "primary RPC");
  const secondary = rpcDescriptor(environment.ROBINHOOD_SECONDARY_RPC_URL, "secondary RPC");
  if (
    primary.endpointIdentity === secondary.endpointIdentity
    || primary.originIdentity === secondary.originIdentity
    || primary.providerIdentity === secondary.providerIdentity
  ) {
    fail("RPC_ENDPOINTS_NOT_DISTINCT", "RPC endpoints must use distinct HTTPS providers");
  }
  return Object.freeze({ primary, secondary });
}

function defaultClientFactory({ url }) {
  const endpoint = new URL(url);
  let fetchOptions;
  if (endpoint.username || endpoint.password) {
    const credentials = `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`;
    endpoint.username = "";
    endpoint.password = "";
    fetchOptions = { headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` } };
  }
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(endpoint.href, fetchOptions ? { fetchOptions } : undefined),
  });
}

function assertDecimalString(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    fail("INVALID_ATTESTATION_RESULT", `${label} is not an unsigned decimal string`);
  }
}

function assertAddress(value, label) {
  if (typeof value !== "string" || !/^0x(?!0{40}$)[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ATTESTATION_RESULT", `${label} is not a nonzero address`);
  }
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_ATTESTATION_RESULT", `${label} is not a nonzero bytes32 value`);
  }
}

function assertReadOnlyPass(result, expectedConfirmations) {
  exactKeys(result, [
    "chainId", "chainWritePerformed", "configurationHistory", "evidenceHashes",
    "executionBoundary", "infrastructure", "intentDigest", "latestExecutionCheck",
    "pinnedBlock", "punk", "readOnly", "signingPerformed", "simulation", "status",
    "sourceVerification", "submissionPerformed", "target", "timing", "transactionAuthorized",
  ], "attestation result");
  exactKeys(result.pinnedBlock, ["confirmations", "hash", "number", "timestamp"],
    "attestation result.pinnedBlock");
  exactKeys(result.punk, ["account", "accountRuntimeCodeHash", "currentOwner", "tokenId"],
    "attestation result.punk");
  exactKeys(result.target, [
    "adapter", "adapterCodeHash", "collection", "collectionCodeHash", "selector", "venue",
    "venueCodeHash",
  ], "attestation result.target");
  exactKeys(result.executionBoundary, [
    "adapterData", "agentRelayerUsed", "ownerSignature", "ownerType", "path", "simulatedCaller",
  ], "attestation result.executionBoundary");
  exactKeys(result.evidenceHashes, [
    "algorithms", "canaryManifest", "configBundleReview", "configBundleArtifact",
    "canarySourceVerificationAdoption", "coreSourceVerificationAdoption",
    "configurationReceiptEvidence", "configurationReceiptEvidenceArtifact", "coreManifest",
    "proposal", "proposalArtifact",
  ],
    "attestation result.evidenceHashes");
  exactKeys(result.evidenceHashes.algorithms, ["artifactEvidence", "configBundleReview"],
    "attestation result.evidenceHashes.algorithms");
  exactKeys(result.infrastructure, [
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
  ], "attestation result.infrastructure");
  exactKeys(result.sourceVerification, [
    "canaryAdoption", "canaryAdoptionSha256", "coreAdoption", "coreAdoptionSha256", "status",
  ], "attestation result.sourceVerification");
  let coreAdoption;
  let canaryAdoption;
  try {
    coreAdoption = validateSourceVerificationAdoption(result.sourceVerification.coreAdoption, {
      expectedContracts: CORE_CONTRACTS,
    });
    canaryAdoption = validateSourceVerificationAdoption(result.sourceVerification.canaryAdoption, {
      expectedContracts: CANARY_CONTRACTS,
    });
  } catch {
    fail("INVALID_ATTESTATION_RESULT", "source verification adoption is invalid");
  }
  exactKeys(result.timing, [
    "checkedAt", "expiresAt", "minimumSubmissionMarginSeconds", "remainingSeconds",
  ], "attestation result.timing");
  exactKeys(result.configurationHistory, [
    "expectedAcquisitionNonce", "expectedFinalPermissionGeneration",
    "expectedFinalPolicyVersion", "lastTransactionBlock", "noExtraRelevantMutationEvents",
    "noOwnershipTransfersFromPreconfigurationThroughLatest", "noPriorCanaryActivity",
    "noRelevantMutationsAfterPinnedBlock", "preconfigurationBlock", "status", "transactionCount",
  ], "attestation result.configurationHistory");
  exactKeys(result.latestExecutionCheck, [
    "currentOwner", "exactState", "hash", "headSkew", "nonce", "number", "ownerType",
    "permissionGeneration", "policyVersion", "primaryHead", "secondaryHead", "simulation",
    "status", "timestamp",
  ], "attestation result.latestExecutionCheck");
  exactKeys(result.latestExecutionCheck.exactState, [
    "accountPaused", "accountRuntimeCodeHash", "acquisitionsToday", "adapterActive",
    "adaptersPaused", "agentsPaused", "approvalPurchases", "autonomousFreeMints",
    "autonomousMints", "autonomousPaidMints", "autonomousPurchases",
    "maxAcquisitionsPerDay", "maxIntentAgeSeconds", "minimumNativeReserve", "mode",
    "ownerApprovedMints", "policyPaused", "selling", "autonomousSelling",
    "unknownCollectionExecution",
  ], "attestation result.latestExecutionCheck.exactState");
  if (
    result.status !== "READ_ONLY_PASS"
    || result.readOnly !== true
    || result.transactionAuthorized !== false
    || result.signingPerformed !== false
    || result.submissionPerformed !== false
    || result.chainWritePerformed !== false
    || result.chainId !== ROBINHOOD.chainId
    || result.simulation !== "READ_ONLY_ETH_CALL_PASS"
    || result.pinnedBlock.confirmations !== expectedConfirmations
    || result.executionBoundary.path !== "OWNER_DIRECT_EMPTY_SIGNATURE"
    || result.executionBoundary.ownerType !== "EOA_CURRENT_OWNER_ONLY"
    || result.executionBoundary.adapterData !== "0x"
    || result.executionBoundary.ownerSignature !== "0x"
    || result.executionBoundary.agentRelayerUsed !== false
    || result.evidenceHashes.algorithms.artifactEvidence !== "SHA256_CANONICAL_JSON_V1"
    || result.evidenceHashes.algorithms.configBundleReview !== "KECCAK256_CANONICAL_JSON_V1"
    || result.sourceVerification.status !== "VERIFIED_ADOPTIONS_BOUND"
    || result.sourceVerification.coreAdoptionSha256
      !== sourceVerificationCanonicalSha256(coreAdoption)
    || result.sourceVerification.canaryAdoptionSha256
      !== sourceVerificationCanonicalSha256(canaryAdoption)
    || result.evidenceHashes.coreSourceVerificationAdoption
      !== result.sourceVerification.coreAdoptionSha256
    || result.evidenceHashes.canarySourceVerificationAdoption
      !== result.sourceVerification.canaryAdoptionSha256
    || result.configurationHistory.status !== "EXACT_13_CALL_DUAL_RPC_VERIFIED"
    || result.configurationHistory.transactionCount !== 13
    || result.configurationHistory.expectedFinalPolicyVersion !== "11"
    || result.configurationHistory.expectedFinalPermissionGeneration !== "1"
    || result.configurationHistory.expectedAcquisitionNonce !== "0"
    || result.configurationHistory.noPriorCanaryActivity !== true
    || result.configurationHistory.noExtraRelevantMutationEvents !== true
    || result.configurationHistory.noOwnershipTransfersFromPreconfigurationThroughLatest !== true
    || result.configurationHistory.noRelevantMutationsAfterPinnedBlock !== true
    || result.latestExecutionCheck.status !== "LATEST_COMMON_BLOCK_READ_AND_SIMULATION_PASS"
    || result.latestExecutionCheck.ownerType !== "EOA"
    || result.latestExecutionCheck.nonce !== "0"
    || result.latestExecutionCheck.policyVersion !== "11"
    || result.latestExecutionCheck.permissionGeneration !== "1"
    || result.latestExecutionCheck.simulation !== "READ_ONLY_ETH_CALL_PASS"
    || result.latestExecutionCheck.exactState.mode !== "APPROVAL_REQUIRED"
    || result.latestExecutionCheck.exactState.minimumNativeReserve !== "0"
    || result.latestExecutionCheck.exactState.maxAcquisitionsPerDay !== "1"
    || result.latestExecutionCheck.exactState.maxIntentAgeSeconds !== "120"
    || result.latestExecutionCheck.exactState.acquisitionsToday !== "0"
    || result.latestExecutionCheck.exactState.accountPaused !== false
    || result.latestExecutionCheck.exactState.policyPaused !== false
    || result.latestExecutionCheck.exactState.adaptersPaused !== false
    || result.latestExecutionCheck.exactState.agentsPaused !== false
    || result.latestExecutionCheck.exactState.ownerApprovedMints !== true
    || result.latestExecutionCheck.exactState.autonomousFreeMints !== false
    || result.latestExecutionCheck.exactState.autonomousPaidMints !== false
    || result.latestExecutionCheck.exactState.approvalPurchases !== true
    || result.latestExecutionCheck.exactState.autonomousPurchases !== false
    || result.latestExecutionCheck.exactState.autonomousMints !== false
    || result.latestExecutionCheck.exactState.unknownCollectionExecution !== false
    || result.latestExecutionCheck.exactState.selling !== false
    || result.latestExecutionCheck.exactState.autonomousSelling !== false
    || result.latestExecutionCheck.exactState.adapterActive !== true
    || result.timing.minimumSubmissionMarginSeconds !== 30
  ) {
    fail("INVALID_ATTESTATION_RESULT", "attestor did not return the canonical read-only pass result");
  }
  assertDecimalString(result.pinnedBlock.number, "pinned block number");
  assertHash(result.pinnedBlock.hash, "pinned block hash");
  assertDecimalString(result.pinnedBlock.timestamp, "pinned block timestamp");
  assertDecimalString(result.punk.tokenId, "Punk token ID");
  assertAddress(result.punk.account, "Punk account");
  assertAddress(result.punk.currentOwner, "Punk owner");
  assertHash(result.punk.accountRuntimeCodeHash, "Punk account runtime code hash");
  assertHash(result.latestExecutionCheck.exactState.accountRuntimeCodeHash,
    "latest Punk Account runtime code hash");
  if (result.latestExecutionCheck.exactState.accountRuntimeCodeHash.toLowerCase()
      !== result.punk.accountRuntimeCodeHash.toLowerCase()) {
    fail("INVALID_ATTESTATION_RESULT", "latest Punk Account runtime hash changed");
  }
  assertAddress(result.executionBoundary.simulatedCaller, "simulated owner caller");
  assertAddress(result.infrastructure.canonicalERC6551Registry, "canonical ERC-6551 registry");
  if (result.executionBoundary.simulatedCaller.toLowerCase()
    !== result.punk.currentOwner.toLowerCase()) {
    fail("INVALID_ATTESTATION_RESULT", "simulated caller is not the current Punk owner");
  }
  if (result.infrastructure.canonicalERC6551Registry.toLowerCase()
      !== ROBINHOOD.canonicalERC6551Registry
    || result.infrastructure.canonicalERC6551RegistryRuntimeCodeHash.toLowerCase()
      !== ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash) {
    fail("INVALID_ATTESTATION_RESULT", "canonical ERC-6551 evidence is not pinned");
  }
  for (const field of ["adapter", "venue", "collection"]) {
    assertAddress(result.target[field], `target ${field}`);
  }
  if (typeof result.target.selector !== "string"
    || !/^0x(?!0{8}$)[0-9a-fA-F]{8}$/.test(result.target.selector)) {
    fail("INVALID_ATTESTATION_RESULT", "target selector is invalid");
  }
  for (const field of ["adapterCodeHash", "venueCodeHash", "collectionCodeHash"]) {
    assertHash(result.target[field], `target ${field}`);
  }
  assertHash(result.intentDigest, "intent digest");
  assertHash(result.infrastructure.canonicalERC6551RegistryRuntimeCodeHash,
    "canonical ERC-6551 registry runtime hash");
  for (const field of [
    "coreManifest", "canaryManifest", "configBundleReview", "configBundleArtifact",
    "coreSourceVerificationAdoption", "canarySourceVerificationAdoption",
    "configurationReceiptEvidence", "configurationReceiptEvidenceArtifact", "proposal",
    "proposalArtifact",
  ]) {
    assertHash(result.evidenceHashes[field], `${field} evidence hash`);
  }
  for (const field of ["checkedAt", "expiresAt", "remainingSeconds"]) {
    assertDecimalString(result.timing[field], `timing ${field}`);
  }
  for (const field of ["number", "timestamp", "primaryHead", "secondaryHead", "headSkew"]) {
    assertDecimalString(result.latestExecutionCheck[field], `latest execution ${field}`);
  }
  assertHash(result.latestExecutionCheck.hash, "latest execution block hash");
  assertAddress(result.latestExecutionCheck.currentOwner, "latest current owner");
  if (result.latestExecutionCheck.currentOwner.toLowerCase() !== result.punk.currentOwner.toLowerCase()
    || BigInt(result.latestExecutionCheck.headSkew) > 3n) {
    fail("INVALID_ATTESTATION_RESULT", "latest execution owner or head skew is invalid");
  }
  for (const field of ["preconfigurationBlock", "lastTransactionBlock"]) {
    assertDecimalString(result.configurationHistory[field], `configuration history ${field}`);
  }
  if (!(BigInt(result.configurationHistory.preconfigurationBlock)
      < BigInt(result.configurationHistory.lastTransactionBlock)
    && BigInt(result.configurationHistory.lastTransactionBlock)
      <= BigInt(result.pinnedBlock.number))) {
    fail("INVALID_ATTESTATION_RESULT", "configuration history block ordering is invalid");
  }
  if (BigInt(result.timing.expiresAt) - BigInt(result.timing.checkedAt)
      !== BigInt(result.timing.remainingSeconds)
    || BigInt(result.timing.remainingSeconds)
      < BigInt(result.timing.minimumSubmissionMarginSeconds)) {
    fail("INVALID_ATTESTATION_RESULT", "attestation lacks the minimum owner submission margin");
  }
  return result;
}

export async function runCanaryApprovalLivePreflight(argv, dependencies = {}) {
  plainObject(dependencies, "dependencies");
  for (const key of Object.keys(dependencies)) {
    if (!DEPENDENCY_KEYS.has(key)) fail("INVALID_DEPENDENCY", `dependencies.${key} is not allowed`);
  }
  const args = parseLivePreflightArguments(argv);
  const cwd = dependencies.cwd ?? process.cwd();
  if (typeof cwd !== "string" || cwd.length === 0) fail("INVALID_WORKING_DIRECTORY", "cwd is invalid");
  const proposalPath = resolve(cwd, args.proposal);
  const configBundlePath = resolve(cwd, args.configBundle);
  const configurationEvidencePath = resolve(cwd, args.configurationEvidence);
  const readJson = dependencies.readJson ?? readBoundedJsonFile;
  const clientFactory = dependencies.clientFactory ?? defaultClientFactory;
  const attestor = dependencies.attestor ?? attestLiveApproval;
  if (typeof readJson !== "function" || typeof clientFactory !== "function" || typeof attestor !== "function") {
    fail("INVALID_DEPENDENCY", "runner dependencies must be functions");
  }
  const endpoints = readRpcEndpoints(dependencies.env ?? process.env);
  const [proposalArtifact, manifest, canaryManifest, configBundleArtifact,
    configurationEvidenceArtifact] = await Promise.all([
    readJson(proposalPath, MAX_PROPOSAL_BYTES, "proposal artifact"),
    readJson(AUTHORITATIVE_MANIFEST_PATH, MAX_MANIFEST_BYTES, "authoritative manifest"),
    readJson(AUTHORITATIVE_CANARY_MANIFEST_PATH, MAX_MANIFEST_BYTES,
      "authoritative canary manifest"),
    readJson(configBundlePath, MAX_CONFIG_BUNDLE_BYTES, "configuration bundle artifact"),
    readJson(configurationEvidencePath, MAX_CONFIGURATION_EVIDENCE_BYTES,
      "configuration receipt evidence artifact"),
  ]);
  const [primaryClient, secondaryClient] = await Promise.all([
    clientFactory({ url: endpoints.primary.href, chain: robinhoodChain, role: "primary" }),
    clientFactory({ url: endpoints.secondary.href, chain: robinhoodChain, role: "secondary" }),
  ]);
  if (!primaryClient || !secondaryClient || primaryClient === secondaryClient) {
    fail("RPC_CLIENTS_NOT_DISTINCT", "RPC clients must be distinct read-only instances");
  }
  const attestationOptions = {
    proposalArtifact,
    manifest,
    canaryManifest,
    configBundleArtifact,
    configurationEvidenceArtifact,
    primaryClient,
    secondaryClient,
    confirmations: args.confirmations,
  };
  if (dependencies.nowSeconds !== undefined) {
    if (!Number.isSafeInteger(dependencies.nowSeconds) || dependencies.nowSeconds < 0) {
      fail("INVALID_TIME", "nowSeconds is invalid");
    }
    attestationOptions.nowSeconds = dependencies.nowSeconds;
  }
  const resultSnapshot = safeSnapshot(await attestor(attestationOptions), "attestation result");
  return assertReadOnlyPass(resultSnapshot, args.confirmations);
}

export function renderSanitizedFailure(error) {
  const rawCode = error instanceof LiveApprovalPreflightError
    || error instanceof LivePreflightRunnerError
    ? error.code
    : "UNEXPECTED_FAILURE";
  const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)
    ? rawCode
    : "UNEXPECTED_FAILURE";
  return `READ_ONLY_FAIL [${code}]: live approval preflight failed closed\n`;
}

async function main() {
  try {
    const result = await runCanaryApprovalLivePreflight(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(renderSanitizedFailure(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
