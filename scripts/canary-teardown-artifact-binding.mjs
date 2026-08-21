import { createHash } from "node:crypto";
import { keccak256 } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  canonicalConfigurationEvidenceSha256,
  validateCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import {
  canonicalExecutionReceiptEvidenceSha256,
  validateCanaryExecutionReceiptEvidence,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import {
  canonicalTeardownEvidenceSha256,
  validateCanaryTeardownReceiptEvidence,
} from "../broker/src/recommendation/canary-teardown-receipt-evidence.mjs";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import { canonicalSha256 } from
  "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";
import { buildOwnerDirectCanaryConfigBundle } from
  "./build-owner-direct-canary-config-bundle.mjs";
import {
  CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
  CANARY_MINT_RECEIPT_PASS,
  canonicalCanaryMintAttestationSha256,
  validateCanaryMintReceiptAttestationArtifact,
} from "./canary-mint-receipt-attestation.mjs";

const CORE_NAMES = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_NAMES = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HASH_FIELDS = Object.freeze([
  "coreManifestSha256", "canaryManifestSha256",
  "coreSourceVerificationAdoptionSha256", "canarySourceVerificationAdoptionSha256",
  "proposalSha256", "proposalArtifactSha256", "configBundleReviewKeccak256",
  "configBundleArtifactSha256", "configurationReceiptEvidenceSha256",
  "configurationReceiptEvidenceArtifactSha256", "liveAttestationSha256",
  "executionArtifactSha256", "executionReceiptEvidenceSha256",
  "executionReceiptEvidenceArtifactSha256",
]);

export class CanaryTeardownArtifactBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryTeardownArtifactBindingError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryTeardownArtifactBindingError(code, message);
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
    fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
  }
  if (array) {
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      fail("UNKNOWN_FIELD", `${label} contains an extended array`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
    }
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

function snapshot(value, label, maximumBytes = 32_000_000) {
  assertJsonData(value, label);
  let copy;
  try { copy = structuredClone(value); } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy`);
  }
  assertJsonData(copy, `${label} snapshot`);
  let encoded;
  try { encoded = canonicalJson(copy); } catch {
    fail("INVALID_SCHEMA", `${label} is not canonical JSON data`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    fail("INPUT_TOO_LARGE", `${label} exceeds its canonical size limit`);
  }
  try { return JSON.parse(encoded); } catch {
    fail("INVALID_SCHEMA", `${label} could not be snapshotted`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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

function bytes32(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} is not bytes32`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === `0x${"00".repeat(32)}`) {
    fail("INVALID_HASH", `${label} is zero`);
  }
  return normalized;
}

function address(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is not an address`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} is not a canonical decimal string`);
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) fail("INVALID_INTEGER", `${label} must be positive`);
  return parsed;
}

function safeNumber(value, label, { positive = false } = {}) {
  const parsed = decimal(value, label, { positive });
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_INTEGER", `${label} exceeds the JSON-safe range`);
  }
  return Number(parsed);
}

function same(actual, expected, code, label) {
  const left = typeof actual === "string" ? actual.toLowerCase() : actual;
  const right = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (left !== right) fail(code, `${label} does not match`);
}

function canonicalArtifactSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function deriveMintAttestationTeardownExpectation({
  coreManifest,
  canaryManifest,
  executionEvidence,
  executionArtifact,
}) {
  const acquisition = executionEvidence.acquisition;
  const cleanState = decimal(
    canaryManifest?.provenanceGate?.cleanPreconfigurationState?.accountState,
    "clean preconfiguration account state",
  );
  const runtime = {};
  for (const name of CORE_NAMES) {
    runtime[name] = {
      address: address(coreManifest.contracts[name].address, `${name} address`),
      runtimeCodeHash: bytes32(coreManifest.contracts[name].runtimeBytecodeHash,
        `${name} runtime hash`),
    };
  }
  runtime.CanonicalERC6551Registry = {
    address: address(coreManifest.canonicalERC6551Registry, "canonical registry address"),
    runtimeCodeHash: bytes32(coreManifest.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical registry runtime hash"),
  };
  runtime.PunkAccount = {
    address: address(acquisition.account, "Punk Account"),
    runtimeCodeHash: bytes32(canaryManifest.expectedActivatedPunkAccountRuntimeCodeHash,
      "Punk Account runtime hash"),
  };
  runtime.GoghOneShotCanaryArt = {
    address: address(canaryManifest.contracts.GoghOneShotCanaryArt.address, "canary art address"),
    runtimeCodeHash: bytes32(
      canaryManifest.contracts.GoghOneShotCanaryArt.runtimeBytecodeHash,
      "canary art runtime hash",
    ),
  };
  runtime.GoghOneShotCanaryMintAdapter = {
    address: address(canaryManifest.contracts.GoghOneShotCanaryMintAdapter.address,
      "canary adapter address"),
    runtimeCodeHash: bytes32(
      canaryManifest.contracts.GoghOneShotCanaryMintAdapter.runtimeBytecodeHash,
      "canary adapter runtime hash",
    ),
  };
  return deepFreeze({
    owner: address(acquisition.owner, "mint owner"),
    account: address(acquisition.account, "mint account"),
    policy: address(coreManifest.contracts.BrokerPolicyModule.address, "policy module"),
    adapter: address(acquisition.adapter, "mint adapter"),
    venue: address(acquisition.venue, "mint venue"),
    collection: address(acquisition.collection, "mint collection"),
    tokenId: acquisition.tokenId,
    opportunityId: bytes32(acquisition.opportunityId, "mint opportunity ID"),
    reasoningHash: bytes32(acquisition.reasoningHash, "mint reasoning hash"),
    receivedState: (cleanState + 1n).toString(),
    postState: (cleanState + 2n).toString(),
    data: typeof executionArtifact?.transaction?.data === "string"
      ? executionArtifact.transaction.data.toLowerCase()
      : fail("INVALID_EXECUTION_ARTIFACT", "execution artifact calldata is missing"),
    coreSourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(requireVerifiedManifestAdoption(coreManifest, CORE_NAMES)),
    canarySourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(requireVerifiedManifestAdoption(canaryManifest, CANARY_NAMES)),
    runtimes: runtime,
  });
}

export function validateMintAttestationForTeardown(attestation, expected) {
  exactKeys(attestation, [
    "schema", "status", "chainId", "evidenceHashes", "transaction", "receipt",
    "confirmedPin", "events", "preMintState", "postMintState", "confirmedState",
    "continuity", "sourceVerification", "safetyBoundary",
  ], "mint receipt attestation");
  if (attestation.schema !== CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA
    || attestation.status !== CANARY_MINT_RECEIPT_PASS || attestation.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_MINT_ATTESTATION", "mint receipt attestation identity is invalid");
  }
  exactKeys(attestation.evidenceHashes, HASH_FIELDS, "mint receipt evidence hashes");
  for (const name of HASH_FIELDS) bytes32(attestation.evidenceHashes[name], `mint hash ${name}`);
  exactKeys(attestation.transaction,
    ["hash", "from", "to", "value", "data", "dataKeccak256", "nonce"],
    "mint attested transaction");
  const transaction = {
    hash: bytes32(attestation.transaction.hash, "mint transaction hash"),
    from: address(attestation.transaction.from, "mint transaction sender"),
    to: address(attestation.transaction.to, "mint transaction destination"),
    value: decimal(attestation.transaction.value, "mint transaction value"),
    data: typeof attestation.transaction.data === "string"
      && /^0x(?:[0-9a-fA-F]{2})+$/.test(attestation.transaction.data)
      ? attestation.transaction.data.toLowerCase()
      : fail("INVALID_MINT_ATTESTATION", "mint transaction calldata is invalid"),
    dataKeccak256: bytes32(attestation.transaction.dataKeccak256,
      "mint transaction calldata hash"),
  };
  same(keccak256(transaction.data), transaction.dataKeccak256,
    "INVALID_MINT_ATTESTATION", "mint transaction calldata hash");
  same(transaction.data, expected.data, "MINT_TRANSACTION_MISMATCH", "mint transaction calldata");
  decimal(attestation.transaction.nonce, "mint sender nonce");
  exactKeys(attestation.receipt, [
    "status", "blockNumber", "blockHash", "blockTimestamp", "transactionIndex",
    "parentBlockHash", "logCount", "firstLogIndex", "lastLogIndex",
  ], "mint receipt");
  if (attestation.receipt.status !== "success" || attestation.receipt.logCount !== 4) {
    fail("INVALID_MINT_ATTESTATION", "mint receipt is not the exact four-event successful receipt");
  }
  const receipt = {
    transactionHash: transaction.hash,
    blockNumber: safeNumber(attestation.receipt.blockNumber, "mint receipt block", { positive: true }),
    blockHash: bytes32(attestation.receipt.blockHash, "mint receipt block hash"),
    blockTimestamp: decimal(attestation.receipt.blockTimestamp, "mint receipt block timestamp",
      { positive: true }).toString(),
    transactionIndex: safeNumber(attestation.receipt.transactionIndex,
      "mint receipt transaction index"),
  };
  const parentBlockHash = bytes32(attestation.receipt.parentBlockHash,
    "mint receipt parent block hash");
  decimal(attestation.receipt.firstLogIndex, "mint first log index");
  decimal(attestation.receipt.lastLogIndex, "mint last log index");
  exactKeys(attestation.confirmedPin, [
    "number", "hash", "timestamp", "confirmations", "primaryHead", "secondaryHead", "headSkew",
    "checkedAt", "maximumAgeSeconds", "providerOrigins", "providerIndependence",
  ], "mint confirmed pin");
  const pinNumber = decimal(attestation.confirmedPin.number, "mint confirmed pin number",
    { positive: true });
  bytes32(attestation.confirmedPin.hash, "mint confirmed pin hash");
  decimal(attestation.confirmedPin.timestamp, "mint confirmed pin timestamp", { positive: true });
  if (!Number.isSafeInteger(attestation.confirmedPin.confirmations)
    || attestation.confirmedPin.confirmations < 12 || attestation.confirmedPin.confirmations > 128
    || pinNumber < BigInt(receipt.blockNumber)) {
    fail("INVALID_MINT_ATTESTATION", "mint confirmation evidence is invalid");
  }
  if (!Array.isArray(attestation.confirmedPin.providerOrigins)
    || attestation.confirmedPin.providerOrigins.length !== 2
    || new Set(attestation.confirmedPin.providerOrigins).size !== 2
    || attestation.confirmedPin.providerOrigins.some((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol !== "https:" || url.origin !== origin || url.pathname !== "/"
          || url.username || url.password || url.search || url.hash;
      } catch { return true; }
    })
    || attestation.confirmedPin.providerIndependence
      !== "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS") {
    fail("INVALID_MINT_ATTESTATION", "mint provider-origin evidence is invalid");
  }
  exactKeys(attestation.events, [
    "AcquisitionPolicyConsumed", "Transfer", "ERC721Received", "AcquisitionExecuted",
  ], "mint events");
  for (const value of Object.values(attestation.events)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("INVALID_MINT_ATTESTATION", "mint event summary is missing");
    }
  }
  const eventExpectations = {
    AcquisitionPolicyConsumed: {
      emitter: expected.policy, account: expected.account, opportunityId: expected.opportunityId,
      currency: ZERO_ADDRESS, amount: "0", spentToday: "0", spentThisWeek: "0",
      acquisitionsToday: "1", ownerApproved: true, policyVersion: "11",
    },
    Transfer: {
      emitter: expected.collection, from: ZERO_ADDRESS, to: expected.account,
      tokenId: expected.tokenId,
    },
    ERC721Received: {
      emitter: expected.account, collection: expected.collection, tokenId: expected.tokenId,
      from: ZERO_ADDRESS, operator: expected.account, state: expected.receivedState,
    },
    AcquisitionExecuted: {
      emitter: expected.account, executor: expected.owner, opportunityId: expected.opportunityId,
      collection: expected.collection, opportunityType: "FREE_MINT", assetStandard: "ERC721",
      adapter: expected.adapter, venue: expected.venue, tokenId: expected.tokenId,
      assetAmount: "1", currency: ZERO_ADDRESS, price: "0", ownerApproved: true,
      reasoningHash: expected.reasoningHash, policyVersion: "11", nonce: "0",
      state: expected.postState,
    },
  };
  const indices = [];
  for (const [name, fields] of Object.entries(eventExpectations)) {
    for (const [field, wanted] of Object.entries(fields)) {
      same(attestation.events[name]?.[field], wanted,
        "INVALID_MINT_ATTESTATION", `${name}.${field}`);
    }
    indices.push(decimal(attestation.events[name]?.logIndex, `${name}.logIndex`));
  }
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index] !== indices[index - 1] + 1n) {
      fail("INVALID_MINT_ATTESTATION", "mint event log indices are not contiguous");
    }
  }
  same(indices[0], decimal(attestation.receipt.firstLogIndex, "mint first log index"),
    "INVALID_MINT_ATTESTATION", "mint first event index");
  same(indices[3], decimal(attestation.receipt.lastLogIndex, "mint last log index"),
    "INVALID_MINT_ATTESTATION", "mint last event index");
  exactKeys(attestation.preMintState,
    ["blockNumber", "blockHash", "minted", "accountNftBalance", "accountNativeBalance"],
    "mint prestate");
  if (decimal(attestation.preMintState.blockNumber, "mint parent block")
      + 1n !== BigInt(receipt.blockNumber)
    || attestation.preMintState.minted !== false
    || attestation.preMintState.accountNftBalance !== "0") {
    fail("INVALID_MINT_ATTESTATION", "mint prestate is not the exact unminted parent state");
  }
  bytes32(attestation.preMintState.blockHash, "mint parent block hash");
  same(attestation.preMintState.blockHash, parentBlockHash,
    "INVALID_MINT_ATTESTATION", "mint parent block hash linkage");
  decimal(attestation.preMintState.accountNativeBalance, "mint prestate native balance");
  for (const name of ["postMintState", "confirmedState"]) {
    const state = attestation[name];
    exactKeys(state, [
      "blockNumber", "blockTimestamp", "owner", "ownerType", "acquisitionNonce",
      "accountState", "nativeBalance", "policy", "nft", "runtime",
    ], name);
    exactKeys(state.policy, [
      "version", "permissionGeneration", "mode", "globallyPaused", "accountPaused",
      "acquisitionsToday", "spentToday", "spentThisWeek",
    ], `${name}.policy`);
    exactKeys(state.nft, [
      "collection", "tokenId", "owner", "accountBalance", "approved",
      "adapterApprovedForAll", "minted",
    ], `${name}.nft`);
    if (state?.owner?.toLowerCase() !== expected.owner
      || state?.ownerType !== "EOA_CURRENT_OWNER_ONLY"
      || state?.acquisitionNonce !== "1" || state?.accountState !== "2"
      || state?.policy?.version !== "11" || state?.policy?.permissionGeneration !== "1"
      || state?.nft?.owner?.toLowerCase() !== expected.account
      || state?.nft?.collection?.toLowerCase() !== expected.collection
      || state?.nft?.tokenId !== expected.tokenId
      || state?.nft?.accountBalance !== "1"
      || state?.nft?.approved?.toLowerCase() !== ZERO_ADDRESS
      || state?.nft?.adapterApprovedForAll !== false || state?.nft?.minted !== true) {
      fail("INVALID_MINT_ATTESTATION", `${name} is not the exact post-mint security state`);
    }
    if (state.policy.mode !== "APPROVAL_REQUIRED" || state.policy.globallyPaused !== false
      || state.policy.accountPaused !== false || state.policy.spentToday !== "0"
      || state.policy.spentThisWeek !== "0" || !["0", "1"].includes(state.policy.acquisitionsToday)
      || state.nativeBalance !== attestation.preMintState.accountNativeBalance) {
      fail("INVALID_MINT_ATTESTATION", `${name} policy/balance state is inconsistent`);
    }
    const expectedBlock = name === "postMintState"
      ? String(receipt.blockNumber) : attestation.confirmedPin.number;
    if (state.blockNumber !== expectedBlock) {
      fail("INVALID_MINT_ATTESTATION", `${name} block is not receipt/pin-bound`);
    }
    exactKeys(state.runtime, Object.keys(expected.runtimes), `${name}.runtime`);
    for (const [runtimeName, runtimeExpected] of Object.entries(expected.runtimes)) {
      const runtime = state.runtime[runtimeName];
      exactKeys(runtime, ["address", "runtimeCodeHash", "eip1967Slots"],
        `${name}.runtime.${runtimeName}`);
      same(runtime.address, runtimeExpected.address,
        "INVALID_MINT_ATTESTATION", `${name}.${runtimeName} address`);
      same(runtime.runtimeCodeHash, runtimeExpected.runtimeCodeHash,
        "INVALID_MINT_ATTESTATION", `${name}.${runtimeName} runtime hash`);
      exactKeys(runtime.eip1967Slots, ["implementation", "beacon", "admin"],
        `${name}.runtime.${runtimeName}.eip1967Slots`);
      for (const slot of Object.values(runtime.eip1967Slots)) {
        if (bytes32(slot, `${name}.${runtimeName} EIP-1967 slot`, { zero: true })
          !== `0x${"00".repeat(32)}`) {
          fail("INVALID_MINT_ATTESTATION", `${name}.${runtimeName} has a proxy slot`);
        }
      }
    }
  }
  exactKeys(attestation.continuity, [
    "priorEvidenceStatus", "priorLatestExecutionBlock",
    "noControllingPunkTransfersThroughConfirmedPin",
    "noUnexpectedScannedProtocolEventsThroughConfirmedPin",
    "unrelatedDirectTokenReceiptsChecked", "receiptAndConfirmedBlocksRechecked",
  ], "mint continuity");
  if (attestation.continuity.priorEvidenceStatus
      !== "CONFIGURATION_AND_EXECUTION_PREFLIGHT_CHAIN_BOUND"
    || attestation.continuity.noControllingPunkTransfersThroughConfirmedPin !== true
    || attestation.continuity.noUnexpectedScannedProtocolEventsThroughConfirmedPin !== true
    || attestation.continuity.unrelatedDirectTokenReceiptsChecked !== false
    || attestation.continuity.receiptAndConfirmedBlocksRechecked !== true) {
    fail("INVALID_MINT_ATTESTATION", "mint continuity evidence is incomplete");
  }
  exactKeys(attestation.sourceVerification,
    ["status", "coreAdoptionSha256", "canaryAdoptionSha256"], "mint source verification");
  if (attestation.sourceVerification.status !== "VERIFIED_MANIFEST_ADOPTIONS_HASH_BOUND") {
    fail("INVALID_MINT_ATTESTATION", "mint source verification is not adopted");
  }
  same(attestation.sourceVerification.coreAdoptionSha256,
    expected.coreSourceVerificationAdoptionSha256,
    "INVALID_MINT_ATTESTATION", "mint core source adoption hash");
  same(attestation.sourceVerification.canaryAdoptionSha256,
    expected.canarySourceVerificationAdoptionSha256,
    "INVALID_MINT_ATTESTATION", "mint canary source adoption hash");
  exactKeys(attestation.safetyBoundary, [
    "readOnly", "transactionAuthorized", "signingPerformed", "submissionPerformed",
    "chainWritePerformed", "deploymentPerformed", "walletMethodsPresent",
  ], "mint safety boundary");
  if (attestation.safetyBoundary.readOnly !== true
    || ["transactionAuthorized", "signingPerformed", "submissionPerformed", "chainWritePerformed",
      "deploymentPerformed", "walletMethodsPresent"].some((name) => (
      attestation.safetyBoundary[name] !== false
    ))) {
    fail("INVALID_MINT_ATTESTATION", "mint attestation safety boundary is not read-only");
  }
  return { transaction, receipt };
}

export function bindCanaryTeardownArtifacts(value) {
  const input = snapshot(value, "teardown artifact inputs");
  exactKeys(input, [
    "proposalArtifact", "liveAttestation", "coreManifest", "canaryManifest",
    "configBundleArtifact", "configurationEvidenceArtifact", "executionArtifact",
    "executionReceiptEvidenceArtifact", "mintReceiptAttestationArtifact",
    "teardownReceiptEvidenceArtifact",
  ], "teardown artifact inputs");
  let expectedBundle;
  let configEvidence;
  let executionEvidence;
  let teardownEvidence;
  try {
    expectedBundle = buildOwnerDirectCanaryConfigBundle(input.coreManifest, input.canaryManifest);
    configEvidence = validateCanaryConfigurationReceiptEvidence(
      input.configurationEvidenceArtifact,
    );
    executionEvidence = validateCanaryExecutionReceiptEvidence(
      input.executionReceiptEvidenceArtifact,
      input.executionArtifact,
    );
    validateCanaryMintReceiptAttestationArtifact(
      input.mintReceiptAttestationArtifact,
      {
        proposalArtifact: input.proposalArtifact,
        liveAttestation: input.liveAttestation,
        coreManifest: input.coreManifest,
        canaryManifest: input.canaryManifest,
        configBundleArtifact: input.configBundleArtifact,
        configurationEvidenceArtifact: input.configurationEvidenceArtifact,
        executionArtifact: input.executionArtifact,
        executionReceiptEvidence: input.executionReceiptEvidenceArtifact,
      },
    );
    teardownEvidence = validateCanaryTeardownReceiptEvidence(
      input.teardownReceiptEvidenceArtifact,
    );
  } catch (error) {
    fail(error?.code ?? "UPSTREAM_ARTIFACT_INVALID",
      error?.message ?? "an upstream artifact is invalid");
  }
  if (canonicalJson(expectedBundle) !== canonicalJson(input.configBundleArtifact)) {
    fail("CONFIG_BUNDLE_MISMATCH", "configuration bundle is not rebuilt from both manifests");
  }
  same(configEvidence.evidence.configBundleHash, expectedBundle.bundleHash,
    "CONFIG_BUNDLE_MISMATCH", "configuration receipt bundle hash");
  const calls = expectedBundle.review?.teardownPlan?.orderedCalls;
  if (!Array.isArray(calls) || calls.length !== 11) {
    fail("INVALID_TEARDOWN_PLAN", "configuration bundle lacks the exact eleven-call teardown");
  }
  for (let index = 0; index < calls.length; index += 1) {
    const record = teardownEvidence.evidence.transactions[index];
    if (record.id !== calls[index].id || record.order !== calls[index].order) {
      fail("TEARDOWN_EVIDENCE_MISMATCH", `teardown receipt ${index + 1} is not plan-bound`);
    }
  }
  let coreAdoption;
  let canaryAdoption;
  try {
    coreAdoption = requireVerifiedManifestAdoption(input.coreManifest, CORE_NAMES);
    canaryAdoption = requireVerifiedManifestAdoption(input.canaryManifest, CANARY_NAMES);
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_MISMATCH",
      error?.message ?? "source verification adoption is invalid");
  }
  const hashes = {
    coreManifest: canonicalSha256(input.coreManifest),
    canaryManifest: canonicalSha256(input.canaryManifest),
    coreSourceVerificationAdoption: sourceVerificationCanonicalSha256(coreAdoption),
    canarySourceVerificationAdoption: sourceVerificationCanonicalSha256(canaryAdoption),
    configBundleReviewKeccak256: expectedBundle.bundleHash,
    configBundleArtifact: canonicalSha256(input.configBundleArtifact),
    configurationReceiptEvidence: configEvidence.evidenceHash,
    configurationReceiptEvidenceArtifact:
      canonicalConfigurationEvidenceSha256(input.configurationEvidenceArtifact),
    executionReceiptEvidence: executionEvidence.evidenceSha256,
    executionReceiptEvidenceArtifact:
      canonicalExecutionReceiptEvidenceSha256(input.executionReceiptEvidenceArtifact),
    mintReceiptAttestationArtifact:
      canonicalCanaryMintAttestationSha256(input.mintReceiptAttestationArtifact),
    teardownReceiptEvidence: teardownEvidence.evidenceHash,
    teardownReceiptEvidenceArtifact:
      canonicalTeardownEvidenceSha256(input.teardownReceiptEvidenceArtifact),
  };
  const execution = executionEvidence.evidence;
  const expectedMint = deriveMintAttestationTeardownExpectation({
    coreManifest: input.coreManifest,
    canaryManifest: input.canaryManifest,
    executionEvidence: execution,
    executionArtifact: input.executionArtifact,
  });
  const mint = validateMintAttestationForTeardown(
    input.mintReceiptAttestationArtifact,
    expectedMint,
  );
  const mintHashes = input.mintReceiptAttestationArtifact.evidenceHashes;
  const expectedMintHashes = {
    coreManifestSha256: hashes.coreManifest,
    canaryManifestSha256: hashes.canaryManifest,
    coreSourceVerificationAdoptionSha256: hashes.coreSourceVerificationAdoption,
    canarySourceVerificationAdoptionSha256: hashes.canarySourceVerificationAdoption,
    proposalSha256: canonicalSha256(input.proposalArtifact.proposal),
    proposalArtifactSha256: canonicalSha256(input.proposalArtifact),
    configBundleReviewKeccak256: hashes.configBundleReviewKeccak256,
    configBundleArtifactSha256: hashes.configBundleArtifact,
    configurationReceiptEvidenceSha256: hashes.configurationReceiptEvidence,
    configurationReceiptEvidenceArtifactSha256: hashes.configurationReceiptEvidenceArtifact,
    liveAttestationSha256: canonicalSha256(input.liveAttestation),
    executionArtifactSha256: execution.executionArtifactSha256,
    executionReceiptEvidenceSha256: hashes.executionReceiptEvidence,
    executionReceiptEvidenceArtifactSha256: hashes.executionReceiptEvidenceArtifact,
  };
  for (const [name, expected] of Object.entries(expectedMintHashes)) {
    same(mintHashes[name], expected, "EVIDENCE_HASH_MISMATCH", `mint evidence ${name}`);
  }
  same(mint.transaction.hash, execution.transaction.hash,
    "MINT_TRANSACTION_MISMATCH", "mint transaction hash");
  same(mint.transaction.from, execution.transaction.from,
    "MINT_TRANSACTION_MISMATCH", "mint transaction sender");
  same(mint.transaction.to, execution.transaction.to,
    "MINT_TRANSACTION_MISMATCH", "mint transaction destination");
  same(mint.transaction.value, 0n, "MINT_TRANSACTION_MISMATCH", "mint transaction value");
  same(mint.transaction.dataKeccak256, execution.transaction.dataKeccak256,
    "MINT_TRANSACTION_MISMATCH", "mint transaction calldata hash");
  same(mint.transaction.data, input.executionArtifact.transaction.data,
    "MINT_TRANSACTION_MISMATCH", "mint transaction calldata");

  const binding = teardownEvidence.evidence.bindings;
  const expectedBindings = {
    coreManifestSha256: hashes.coreManifest,
    canaryManifestSha256: hashes.canaryManifest,
    coreSourceVerificationAdoptionSha256: hashes.coreSourceVerificationAdoption,
    canarySourceVerificationAdoptionSha256: hashes.canarySourceVerificationAdoption,
    configBundleReviewHash: hashes.configBundleReviewKeccak256,
    configBundleArtifactSha256: hashes.configBundleArtifact,
    configurationReceiptEvidenceHash: hashes.configurationReceiptEvidence,
    configurationReceiptEvidenceArtifactSha256: hashes.configurationReceiptEvidenceArtifact,
    executionReceiptEvidenceHash: hashes.executionReceiptEvidence,
    executionReceiptEvidenceArtifactSha256: hashes.executionReceiptEvidenceArtifact,
    mintReceiptAttestationArtifactSha256: hashes.mintReceiptAttestationArtifact,
  };
  for (const [name, expected] of Object.entries(expectedBindings)) {
    same(binding[name], expected, "EVIDENCE_HASH_MISMATCH", `teardown binding ${name}`);
  }
  same(teardownEvidence.evidence.mintReceipt.transactionHash, mint.receipt.transactionHash,
    "MINT_RECEIPT_MISMATCH", "teardown-bound mint transaction hash");
  same(teardownEvidence.evidence.mintReceipt.blockNumber, mint.receipt.blockNumber,
    "MINT_RECEIPT_MISMATCH", "teardown-bound mint block number");
  same(teardownEvidence.evidence.mintReceipt.blockHash, mint.receipt.blockHash,
    "MINT_RECEIPT_MISMATCH", "teardown-bound mint block hash");
  same(teardownEvidence.evidence.mintReceipt.transactionIndex, mint.receipt.transactionIndex,
    "MINT_RECEIPT_MISMATCH", "teardown-bound mint transaction index");

  const core = input.coreManifest.contracts;
  const canary = input.canaryManifest.contracts;
  const scope = expectedBundle.review.scope;
  const normalizedCalls = calls.map((call) => ({
    id: call.id,
    order: call.order,
    role: call.role,
    from: call.from.toLowerCase(),
    to: call.to.toLowerCase(),
    valueWei: call.valueWei,
    functionName: call.functionName,
    calldata: call.calldata.toLowerCase(),
  }));
  return deepFreeze({
    evidenceHashes: hashes,
    scope: {
      punkTokenId: String(scope.controllingPunkTokenId),
      account: scope.punkAccount.toLowerCase(),
      owner: scope.expectedOwnerFromDeployedCanaryManifest.toLowerCase(),
      adapter: expectedBundle.review.adapterRegistrationCommitment.adapter.toLowerCase(),
      venue: expectedBundle.review.adapterRegistrationCommitment.venue.toLowerCase(),
      collection: expectedBundle.review.adapterRegistrationCommitment.collection.toLowerCase(),
      selector: expectedBundle.review.desiredConfiguration.exactPermissions.selector.toLowerCase(),
      artTokenId: String(scope.canaryArtTokenId),
      adapterVersionHash: expectedBundle.review.adapterRegistrationCommitment.versionHash.toLowerCase(),
      adapterMetadataHash: expectedBundle.review.adapterRegistrationCommitment.metadataHash.toLowerCase(),
    },
    infrastructure: {
      canonicalCollection: input.coreManifest.canonicalCollection.toLowerCase(),
      canonicalERC6551Registry: input.coreManifest.canonicalERC6551Registry.toLowerCase(),
      canonicalERC6551RegistryRuntimeCodeHash:
        input.coreManifest.canonicalERC6551RegistryRuntimeCodeHash.toLowerCase(),
      accountSalt: input.coreManifest.accountSalt.toLowerCase(),
    },
    contracts: {
      guardian: input.coreManifest.protocolGuardian.toLowerCase(),
      adapterRegistry: record(core.ArtAdapterRegistry),
      agentRegistry: record(core.ArtAgentRegistry),
      policyModule: record(core.BrokerPolicyModule),
      accountImplementation: record(core.GoghPunkAccountV1),
      accountRegistry: record(core.GoghPunkAccountRegistry),
      account: {
        address: scope.punkAccount.toLowerCase(),
        runtimeCodeHash: scope.punkAccountRuntimeBytecodeHash.toLowerCase(),
        deploymentBlock: String(input.canaryManifest.provenanceGate.cleanPreconfigurationState.blockNumber),
      },
      adapter: record(canary.GoghOneShotCanaryMintAdapter),
      venue: record(canary.GoghOneShotCanaryArt),
    },
    mintTransaction: {
      hash: mint.transaction.hash,
      from: mint.transaction.from,
      to: mint.transaction.to,
      value: mint.transaction.value.toString(),
      data: mint.transaction.data,
      dataKeccak256: mint.transaction.dataKeccak256,
    },
    mintReceipt: {
      ...mint.receipt,
      blockNumber: String(mint.receipt.blockNumber),
      transactionIndex: String(mint.receipt.transactionIndex),
    },
    teardownPlan: normalizedCalls,
    teardownEvidence: teardownEvidence.evidence.transactions,
  });
}

function record(value) {
  if (!value || typeof value !== "object") fail("INCOMPLETE_MANIFEST", "contract record is missing");
  return {
    address: address(value.address, "contract record address"),
    runtimeCodeHash: bytes32(value.runtimeBytecodeHash, "contract record runtime hash"),
    deploymentBlock: String(value.deploymentBlock),
  };
}

export const CANARY_TEARDOWN_BINDING_HASH_ALGORITHM = "SHA256_CANONICAL_JSON_V1";
export const canonicalCanaryTeardownBindingSha256 = canonicalArtifactSha256;
