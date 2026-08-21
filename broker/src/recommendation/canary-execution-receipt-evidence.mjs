import { createHash } from "node:crypto";
import { decodeFunctionData, encodeFunctionData, keccak256, toFunctionSelector } from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { canonicalJson } from "../scout/canonical-json.mjs";
import { OWNER_DIRECT_ACQUISITION_ABI } from "./owner-direct-free-mint-execution.mjs";
import {
  sourceVerificationCanonicalSha256,
  validateSourceVerificationAdoption,
} from "./source-verification-adoption.mjs";

export const CANARY_EXECUTION_RECEIPT_EVIDENCE_SCHEMA =
  "GOGH_OWNER_DIRECT_CANARY_EXECUTION_RECEIPT_EVIDENCE_V1";
export const CANARY_EXECUTION_ARTIFACT_SCHEMA =
  "GOGH_OWNER_DIRECT_FREE_MINT_EXECUTION_ARTIFACT_V1";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EMPTY_BYTES = "0x";
const EMPTY_BYTES_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const EXECUTION_SELECTOR = toFunctionSelector(
  "executeApprovedAcquisition((address,uint256,address,uint256,uint64,uint8,uint8,address,address,address,uint256,uint256,address,uint256,uint256,uint16,uint64,uint64,bytes32,bytes32,bytes32),bytes,bytes)",
);
const HASH = /^0x[0-9a-f]{64}$/;
const TX_HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const BYTES = /^0x(?:[0-9a-f]{2})+$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const CORE_CONTRACTS = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_CONTRACTS = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);
const INTENT_FIELDS = Object.freeze([
  "account", "chainId", "expectedOwner", "nonce", "policyVersion", "opportunityType",
  "opportunityTypeValue", "assetStandard", "assetStandardValue", "adapter", "venue",
  "collection", "tokenId", "assetAmount", "currency", "expectedPrice", "maxPrice",
  "maxSlippageBps", "createdAt", "expiresAt", "opportunityId", "reasoningHash",
  "adapterCodeHash", "adapterDataHash",
]);
const HASH_BINDING_FIELDS = Object.freeze([
  "proposal", "proposalArtifact", "liveAttestation", "coreManifest", "canaryManifest",
  "coreSourceVerificationAdoption", "canarySourceVerificationAdoption",
  "configBundleReviewKeccak256", "configBundleArtifactSha256",
  "configurationReceiptEvidenceSha256", "configurationReceiptEvidenceArtifactSha256",
  "intentDigest", "adapterRuntimeCode", "venueRuntimeCode", "collectionRuntimeCode",
  "punkAccountRuntimeCode",
]);

export class CanaryExecutionReceiptEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryExecutionReceiptEvidenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryExecutionReceiptEvidenceError(code, message);
}

function strictSnapshot(value, label, maximumBytes = 8_000_000) {
  const seen = new Set();
  function visit(item, path) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) fail("INVALID_SCHEMA", `${path} contains an unsafe number`);
      return item;
    }
    if (!item || typeof item !== "object" || seen.has(item)) {
      fail("INVALID_SCHEMA", `${path} is not acyclic JSON data`);
    }
    seen.add(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
      fail("INVALID_PROTOTYPE", `${path} has a custom prototype`);
    }
    const keys = Reflect.ownKeys(item);
    if (keys.some((key) => typeof key !== "string")) {
      fail("UNKNOWN_FIELD", `${path} contains a symbol field`);
    }
    if (array && (keys.length !== item.length + 1
      || keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
      fail("INVALID_SCHEMA", `${path} is not a dense array`);
    }
    const output = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        fail("ACCESSOR_REJECTED", `${path}.${key} is not an enumerable data field`);
      }
      output[key] = visit(descriptor.value, `${path}.${key}`);
    }
    seen.delete(item);
    return output;
  }
  const snapshot = visit(value, label);
  let serialized;
  try {
    serialized = canonicalJson(snapshot);
  } catch {
    fail("INVALID_SCHEMA", `${label} is not canonical JSON data`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("INPUT_TOO_LARGE", `${label} exceeds its size limit`);
  }
  return JSON.parse(serialized);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    fail("UNKNOWN_FIELD", `${label} fields do not match the canonical schema`);
  }
}

function hash(value, label, { nonzero = true } = {}) {
  if (typeof value !== "string" || !HASH.test(value)
    || (nonzero && !TX_HASH.test(value))) {
    fail("INVALID_HASH", `${label} must be a lowercase ${nonzero ? "nonzero " : ""}bytes32`);
  }
  return value;
}

function address(value, label, { allowZero = false } = {}) {
  let normalized;
  try {
    normalized = normalizeAddress(value, label);
  } catch {
    fail("INVALID_ADDRESS", `${label} must be an EVM address`);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) fail("ZERO_ADDRESS", `${label} cannot be zero`);
  if (value !== normalized) fail("NONCANONICAL_ADDRESS", `${label} must be lowercase canonical hex`);
  return normalized;
}

function decimal(value, label, { expected, positive = false } = {}) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical decimal string`);
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || (expected !== undefined && parsed !== BigInt(expected))) {
    fail("INVALID_INTEGER", `${label} has an unexpected value`);
  }
  return value;
}

function bool(value, expected, label) {
  if (value !== expected) fail("INVALID_BOUNDARY", `${label} must be ${expected}`);
}

export function canonicalExecutionReceiptEvidenceSha256(value) {
  const snapshot = strictSnapshot(value, "hash input");
  return `0x${createHash("sha256").update(canonicalJson(snapshot)).digest("hex")}`;
}

export function validateCanaryExecutionArtifactEnvelope(value) {
  const artifact = strictSnapshot(value, "owner execution artifact");
  exactKeys(artifact, [
    "schema", "status", "generatedAt", "transaction", "reviewedAcquisition",
    "confirmedEvidence", "safetyBoundary",
  ], "owner execution artifact");
  if (artifact.schema !== CANARY_EXECUTION_ARTIFACT_SCHEMA
    || artifact.status !== "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED") {
    fail("INVALID_EXECUTION_ARTIFACT", "owner execution artifact identity is wrong");
  }
  decimal(artifact.generatedAt, "execution artifact generatedAt");

  const transaction = artifact.transaction;
  exactKeys(transaction, [
    "chainId", "from", "to", "value", "functionName", "functionSelector", "data",
    "dataKeccak256",
  ], "execution transaction");
  if (transaction.chainId !== ROBINHOOD.chainId
    || transaction.functionName !== "executeApprovedAcquisition"
    || transaction.functionSelector !== EXECUTION_SELECTOR
    || typeof transaction.data !== "string" || !BYTES.test(transaction.data)
    || !transaction.data.startsWith(transaction.functionSelector)) {
    fail("INVALID_EXECUTION_TRANSACTION", "execution transaction encoding is malformed");
  }
  const from = address(transaction.from, "execution sender");
  const to = address(transaction.to, "execution destination");
  decimal(transaction.value, "execution value", { expected: 0n });
  if (hash(transaction.dataKeccak256, "execution calldata hash") !== keccak256(transaction.data)) {
    fail("CALLDATA_HASH_MISMATCH", "execution calldata hash differs from exact calldata");
  }

  const reviewed = artifact.reviewedAcquisition;
  exactKeys(reviewed, [
    "controllingPunk", "target", "payment", "livePolicyBinding", "timing", "intent",
    "intentDigest", "adapterData", "ownerSignature",
  ], "reviewed acquisition");
  exactKeys(reviewed.controllingPunk, ["chainId", "collection", "tokenId", "account", "currentOwner"],
    "reviewed controlling Punk");
  if (reviewed.controllingPunk.chainId !== ROBINHOOD.chainId
    || address(reviewed.controllingPunk.collection, "reviewed Punk collection")
      !== ROBINHOOD.canonicalCollection
    || address(reviewed.controllingPunk.account, "reviewed Punk Account") !== to
    || address(reviewed.controllingPunk.currentOwner, "reviewed current owner") !== from) {
    fail("CANARY_BINDING_MISMATCH", "reviewed controlling Punk differs from transaction");
  }
  const punkTokenId = decimal(reviewed.controllingPunk.tokenId, "controlling Punk token ID");

  exactKeys(reviewed.target, [
    "kind", "adapter", "venue", "collection", "mintSelector", "tokenId", "amount",
  ], "reviewed target");
  if (reviewed.target.kind !== "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter"
    || reviewed.target.mintSelector !== "0x40c10f19") {
    fail("CANARY_BINDING_MISMATCH", "reviewed one-shot target identity is wrong");
  }
  const adapter = address(reviewed.target.adapter, "reviewed adapter");
  const venue = address(reviewed.target.venue, "reviewed venue");
  const collection = address(reviewed.target.collection, "reviewed collection");
  if (venue !== collection) fail("CANARY_BINDING_MISMATCH", "one-shot venue and collection differ");
  const tokenId = decimal(reviewed.target.tokenId, "reviewed canary token ID");
  decimal(reviewed.target.amount, "reviewed asset amount", { expected: 1n });

  exactKeys(reviewed.payment, [
    "currency", "expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue",
  ], "reviewed payment");
  if (address(reviewed.payment.currency, "reviewed currency", { allowZero: true }) !== ZERO_ADDRESS) {
    fail("NONZERO_PAYMENT", "reviewed currency must be native zero address");
  }
  for (const field of ["expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue"]) {
    decimal(reviewed.payment[field], `reviewed payment ${field}`, { expected: 0n });
  }

  exactKeys(reviewed.livePolicyBinding, [
    "nonce", "policyVersion", "modeAttested", "permissionGeneration", "minimumNativeReserve",
    "maxIntentAgeSeconds", "ownerApprovedMintsAttested", "approvalPurchasesAttested",
    "autonomousPurchasesAttested", "autonomousMintsAttested",
  ], "reviewed live policy binding");
  decimal(reviewed.livePolicyBinding.nonce, "reviewed nonce", { expected: 0n });
  decimal(reviewed.livePolicyBinding.policyVersion, "reviewed policy version", { expected: 11n });
  decimal(reviewed.livePolicyBinding.permissionGeneration, "reviewed permission generation",
    { expected: 1n });
  decimal(reviewed.livePolicyBinding.minimumNativeReserve, "reviewed minimum reserve",
    { expected: 0n });
  decimal(reviewed.livePolicyBinding.maxIntentAgeSeconds, "reviewed intent age",
    { expected: 120n });
  if (reviewed.livePolicyBinding.modeAttested !== "APPROVAL_REQUIRED") {
    fail("POLICY_MISMATCH", "reviewed broker mode is not APPROVAL_REQUIRED");
  }
  bool(reviewed.livePolicyBinding.ownerApprovedMintsAttested, true, "owner-approved mint control");
  bool(reviewed.livePolicyBinding.approvalPurchasesAttested, true, "approval purchase feature");
  bool(reviewed.livePolicyBinding.autonomousPurchasesAttested, false, "autonomous purchases");
  bool(reviewed.livePolicyBinding.autonomousMintsAttested, false, "autonomous mints");

  exactKeys(reviewed.timing, [
    "createdAt", "expiresAt", "encodedAt", "remainingSeconds", "minimumRequiredSeconds",
  ], "reviewed timing");
  const createdAt = BigInt(decimal(reviewed.timing.createdAt, "reviewed createdAt"));
  const expiresAt = BigInt(decimal(reviewed.timing.expiresAt, "reviewed expiresAt", { positive: true }));
  const encodedAt = BigInt(decimal(reviewed.timing.encodedAt, "reviewed encodedAt"));
  const remainingSeconds = BigInt(decimal(
    reviewed.timing.remainingSeconds,
    "reviewed remaining seconds",
    { positive: true },
  ));
  if (reviewed.timing.minimumRequiredSeconds !== 30 || expiresAt <= createdAt
    || expiresAt - createdAt > 120n || encodedAt < createdAt || encodedAt >= expiresAt
    || expiresAt - encodedAt !== remainingSeconds || remainingSeconds < 30n) {
    fail("INVALID_TIMING", "reviewed execution timing is not the canonical short-lived window");
  }

  exactKeys(reviewed.intent, INTENT_FIELDS, "reviewed intent");
  const intent = reviewed.intent;
  if (address(intent.account, "intent account") !== to
    || decimal(intent.chainId, "intent chain ID", { expected: ROBINHOOD.chainId })
      !== String(ROBINHOOD.chainId)
    || address(intent.expectedOwner, "intent owner") !== from
    || address(intent.adapter, "intent adapter") !== adapter
    || address(intent.venue, "intent venue") !== venue
    || address(intent.collection, "intent collection") !== collection
    || intent.opportunityType !== "FREE_MINT" || intent.opportunityTypeValue !== 2
    || intent.assetStandard !== "ERC721" || intent.assetStandardValue !== 0
    || intent.adapterDataHash !== EMPTY_BYTES_HASH) {
    fail("INTENT_MISMATCH", "reviewed intent identity differs from the exact canary");
  }
  decimal(intent.nonce, "intent nonce", { expected: 0n });
  decimal(String(intent.policyVersion), "intent policy version", { expected: 11n });
  decimal(intent.tokenId, "intent token ID", { expected: BigInt(tokenId) });
  decimal(intent.assetAmount, "intent asset amount", { expected: 1n });
  if (address(intent.currency, "intent currency", { allowZero: true }) !== ZERO_ADDRESS) {
    fail("NONZERO_PAYMENT", "intent currency must be native zero address");
  }
  for (const field of ["expectedPrice", "maxPrice"]) {
    decimal(intent[field], `intent ${field}`, { expected: 0n });
  }
  decimal(intent.maxSlippageBps, "intent slippage", { expected: 0n });
  decimal(intent.createdAt, "intent createdAt", { expected: createdAt });
  decimal(intent.expiresAt, "intent expiresAt", { expected: expiresAt });
  const opportunityId = hash(intent.opportunityId, "intent opportunity ID");
  const reasoningHash = hash(intent.reasoningHash, "intent reasoning hash");
  const adapterCodeHash = hash(intent.adapterCodeHash, "intent adapter code hash");
  const intentDigest = hash(reviewed.intentDigest, "reviewed intent digest");
  if (reviewed.adapterData !== EMPTY_BYTES || reviewed.ownerSignature !== EMPTY_BYTES) {
    fail("INVALID_EXECUTION_PATH", "owner-direct canary requires empty adapter data and signature");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: OWNER_DIRECT_ACQUISITION_ABI, data: transaction.data });
  } catch {
    fail("CALLDATA_DECODE_FAILED", "execution calldata does not decode under the reviewed ABI");
  }
  if (decoded.functionName !== "executeApprovedAcquisition" || decoded.args?.length !== 3
    || decoded.args[1] !== EMPTY_BYTES || decoded.args[2] !== EMPTY_BYTES) {
    fail("CALLDATA_MISMATCH", "execution calldata is not the empty-data owner-direct path");
  }
  const decodedIntent = decoded.args[0];
  const expectedDecoded = {
    account: to,
    chainId: BigInt(intent.chainId),
    expectedOwner: from,
    nonce: BigInt(intent.nonce),
    policyVersion: BigInt(intent.policyVersion),
    opportunityType: intent.opportunityTypeValue,
    assetStandard: intent.assetStandardValue,
    adapter,
    venue,
    collection,
    tokenId: BigInt(intent.tokenId),
    assetAmount: BigInt(intent.assetAmount),
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
  for (const [field, expected] of Object.entries(expectedDecoded)) {
    const actual = decodedIntent?.[field];
    const equal = typeof expected === "string"
      ? typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase()
      : BigInt(actual) === BigInt(expected);
    if (!equal) fail("CALLDATA_MISMATCH", `decoded intent ${field} differs from review`);
  }
  const reencoded = encodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    functionName: "executeApprovedAcquisition",
    args: [decodedIntent, EMPTY_BYTES, EMPTY_BYTES],
  }).toLowerCase();
  if (reencoded !== transaction.data) {
    fail("CALLDATA_MISMATCH", "execution calldata is not canonical ABI encoding");
  }

  const evidence = artifact.confirmedEvidence;
  exactKeys(evidence, [
    "status", "simulation", "pinnedBlock", "latestExecutionCheck", "hashes",
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
    "sourceVerification", "configurationHistory",
  ], "confirmed evidence");
  if (evidence.status !== "READ_ONLY_PASS" || evidence.simulation !== "READ_ONLY_ETH_CALL_PASS"
    || address(evidence.canonicalERC6551Registry, "canonical ERC-6551 registry")
      !== ROBINHOOD.canonicalERC6551Registry
    || hash(evidence.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical ERC-6551 runtime hash")
      !== ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash) {
    fail("INVALID_CONFIRMED_EVIDENCE", "execution artifact lacks canonical read-only evidence");
  }
  exactKeys(evidence.pinnedBlock, ["number", "hash", "timestamp", "confirmations"],
    "confirmed pinned block");
  decimal(evidence.pinnedBlock.number, "confirmed pinned block number", { positive: true });
  hash(evidence.pinnedBlock.hash, "confirmed pinned block hash");
  decimal(evidence.pinnedBlock.timestamp, "confirmed pinned block timestamp", { positive: true });
  if (!Number.isSafeInteger(evidence.pinnedBlock.confirmations)
    || evidence.pinnedBlock.confirmations < 12 || evidence.pinnedBlock.confirmations > 128) {
    fail("INVALID_CONFIRMED_EVIDENCE", "confirmed pinned block depth is invalid");
  }
  exactKeys(evidence.latestExecutionCheck, [
    "number", "hash", "timestamp", "primaryHead", "secondaryHead", "headSkew", "ownerType",
    "nonce", "policyVersion", "permissionGeneration",
  ], "latest execution check");
  for (const field of ["number", "timestamp", "primaryHead", "secondaryHead", "headSkew"]) {
    decimal(evidence.latestExecutionCheck[field], `latest execution ${field}`);
  }
  hash(evidence.latestExecutionCheck.hash, "latest execution block hash");
  if (evidence.latestExecutionCheck.ownerType !== "EOA_CURRENT_OWNER_ONLY"
    || evidence.latestExecutionCheck.nonce !== "0"
    || evidence.latestExecutionCheck.policyVersion !== "11"
    || evidence.latestExecutionCheck.permissionGeneration !== "1") {
    fail("INVALID_CONFIRMED_EVIDENCE", "latest execution state is not the reviewed owner path");
  }
  exactKeys(evidence.hashes, HASH_BINDING_FIELDS, "confirmed evidence hashes");
  const hashes = Object.fromEntries(HASH_BINDING_FIELDS.map((field) => [
    field, hash(evidence.hashes[field], `confirmed hash ${field}`),
  ]));
  if (hashes.intentDigest !== intentDigest || hashes.adapterRuntimeCode !== adapterCodeHash
    || hashes.venueRuntimeCode !== hashes.collectionRuntimeCode) {
    fail("EVIDENCE_HASH_MISMATCH", "confirmed evidence differs from the reviewed intent/target");
  }
  exactKeys(evidence.sourceVerification, [
    "status", "coreAdoption", "coreAdoptionSha256", "canaryAdoption", "canaryAdoptionSha256",
  ], "confirmed source verification");
  if (evidence.sourceVerification.status !== "VERIFIED_ADOPTIONS_BOUND"
    || hash(evidence.sourceVerification.coreAdoptionSha256, "core adoption hash")
      !== hashes.coreSourceVerificationAdoption
    || hash(evidence.sourceVerification.canaryAdoptionSha256, "canary adoption hash")
      !== hashes.canarySourceVerificationAdoption) {
    fail("SOURCE_VERIFICATION_MISMATCH", "source verification hashes are not transitively bound");
  }
  let coreAdoption;
  let canaryAdoption;
  try {
    coreAdoption = validateSourceVerificationAdoption(
      evidence.sourceVerification.coreAdoption,
      { expectedContracts: CORE_CONTRACTS },
    );
    canaryAdoption = validateSourceVerificationAdoption(
      evidence.sourceVerification.canaryAdoption,
      { expectedContracts: CANARY_CONTRACTS },
    );
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_MISMATCH",
      error?.message ?? "source verification adoption is invalid");
  }
  if (sourceVerificationCanonicalSha256(coreAdoption)
      !== hashes.coreSourceVerificationAdoption
    || sourceVerificationCanonicalSha256(canaryAdoption)
      !== hashes.canarySourceVerificationAdoption) {
    fail("SOURCE_VERIFICATION_MISMATCH", "source verification bodies differ from their hashes");
  }
  exactKeys(evidence.configurationHistory, [
    "status", "transactionCount", "preconfigurationBlock", "finalPolicyVersion",
    "finalPermissionGeneration", "acquisitionNonce", "noOwnershipTransfersDuringEvidenceWindow",
    "noRelevantMutationsAfterPinnedBlock",
  ], "configuration history");
  if (evidence.configurationHistory.status !== "EXACT_13_CALL_DUAL_RPC_VERIFIED"
    || evidence.configurationHistory.transactionCount !== 13
    || evidence.configurationHistory.finalPolicyVersion !== "11"
    || evidence.configurationHistory.finalPermissionGeneration !== "1"
    || evidence.configurationHistory.acquisitionNonce !== "0"
    || evidence.configurationHistory.noOwnershipTransfersDuringEvidenceWindow !== true
    || evidence.configurationHistory.noRelevantMutationsAfterPinnedBlock !== true) {
    fail("CONFIGURATION_HISTORY_MISMATCH", "execution artifact lacks exact configuration history");
  }

  exactKeys(artifact.safetyBoundary, [
    "postEncodingDecodeEqual", "arbitraryCalldataAccepted", "adapterDataPolicy",
    "ownerSignaturePolicy", "agentRelayerUsed", "transactionAuthorized", "signingPerformed",
    "submissionPerformed", "rpcPerformed", "deploymentPerformed", "chainWritePerformed",
    "instruction",
  ], "execution safety boundary");
  const boundary = artifact.safetyBoundary;
  if (boundary.postEncodingDecodeEqual !== true || boundary.arbitraryCalldataAccepted !== false
    || boundary.adapterDataPolicy !== "EMPTY_ONLY"
    || boundary.ownerSignaturePolicy !== "EMPTY_OWNER_DIRECT_ONLY"
    || boundary.agentRelayerUsed !== false || boundary.transactionAuthorized !== false
    || boundary.signingPerformed !== false || boundary.submissionPerformed !== false
    || boundary.rpcPerformed !== false || boundary.deploymentPerformed !== false
    || boundary.chainWritePerformed !== false || typeof boundary.instruction !== "string") {
    fail("INVALID_BOUNDARY", "execution artifact safety boundary is not non-authorizing");
  }

  return Object.freeze({
    artifact,
    artifactSha256: canonicalExecutionReceiptEvidenceSha256(artifact),
    from,
    to,
    data: transaction.data,
    dataKeccak256: transaction.dataKeccak256,
    punkTokenId,
    tokenId,
    adapter,
    venue,
    collection,
    opportunityId,
    reasoningHash,
    adapterCodeHash,
    intentDigest,
    hashes: Object.freeze(hashes),
  });
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function buildCanaryExecutionReceiptEvidence(inputValue) {
  const input = strictSnapshot(inputValue, "execution receipt input");
  exactKeys(input, ["executionArtifact", "transactionHash"], "execution receipt input");
  const execution = validateCanaryExecutionArtifactEnvelope(input.executionArtifact);
  const transactionHash = hash(input.transactionHash, "mint transaction hash");
  const hashes = execution.hashes;
  const evidence = {
    schema: CANARY_EXECUTION_RECEIPT_EVIDENCE_SCHEMA,
    chainId: ROBINHOOD.chainId,
    executionArtifactSha256: execution.artifactSha256,
    transaction: {
      hash: transactionHash,
      from: execution.from,
      to: execution.to,
      value: "0",
      dataKeccak256: execution.dataKeccak256,
    },
    acquisition: {
      punkTokenId: execution.punkTokenId,
      account: execution.to,
      owner: execution.from,
      adapter: execution.adapter,
      venue: execution.venue,
      collection: execution.collection,
      tokenId: execution.tokenId,
      opportunityId: execution.opportunityId,
      reasoningHash: execution.reasoningHash,
      intentDigest: execution.intentDigest,
      nonce: "0",
      policyVersion: "11",
      price: "0",
    },
    upstreamHashes: {
      coreManifestSha256: hashes.coreManifest,
      canaryManifestSha256: hashes.canaryManifest,
      coreSourceVerificationAdoptionSha256: hashes.coreSourceVerificationAdoption,
      canarySourceVerificationAdoptionSha256: hashes.canarySourceVerificationAdoption,
      configBundleReviewKeccak256: hashes.configBundleReviewKeccak256,
      configBundleArtifactSha256: hashes.configBundleArtifactSha256,
      configurationReceiptEvidenceSha256: hashes.configurationReceiptEvidenceSha256,
      configurationReceiptEvidenceArtifactSha256:
        hashes.configurationReceiptEvidenceArtifactSha256,
      proposalSha256: hashes.proposal,
      proposalArtifactSha256: hashes.proposalArtifact,
      liveAttestationSha256: hashes.liveAttestation,
    },
  };
  return freeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    evidenceSha256: canonicalExecutionReceiptEvidenceSha256(evidence),
    evidence,
    transactionAuthorized: false,
  });
}

export function validateCanaryExecutionReceiptEvidence(artifactValue, executionArtifactValue) {
  const artifact = strictSnapshot(artifactValue, "execution receipt evidence artifact");
  exactKeys(artifact, [
    "hashAlgorithm", "evidenceSha256", "evidence", "transactionAuthorized",
  ], "execution receipt evidence artifact");
  if (artifact.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1"
    || artifact.transactionAuthorized !== false) {
    fail("INVALID_BOUNDARY", "execution receipt evidence must remain non-authorizing");
  }
  const rebuilt = buildCanaryExecutionReceiptEvidence({
    executionArtifact: executionArtifactValue,
    transactionHash: artifact.evidence?.transaction?.hash,
  });
  if (artifact.evidence?.schema !== CANARY_EXECUTION_RECEIPT_EVIDENCE_SCHEMA
    || artifact.evidence?.chainId !== ROBINHOOD.chainId
    || hash(artifact.evidenceSha256, "execution receipt evidence hash") !== rebuilt.evidenceSha256
    || canonicalJson(artifact) !== canonicalJson(rebuilt)) {
    fail("EVIDENCE_HASH_MISMATCH", "execution receipt evidence is not the canonical rebuilt artifact");
  }
  return rebuilt;
}

export const CANARY_EXECUTION_RECEIPT_CONTRACT_SETS = Object.freeze({
  core: CORE_CONTRACTS,
  canary: CANARY_CONTRACTS,
});
