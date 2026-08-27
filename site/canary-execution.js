import { keccak256Hex } from "./keccak256.js";

const CHAIN_ID = 4663;
const PUNK_TOKEN_ID = "1797";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EMPTY_BYTES_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const EXECUTE_SELECTOR = "0x4402cb61";
const MINT_SELECTOR = "0x40c10f19";
const OWNER_SELECTOR = "0x8da5cb5b";
const OWNER_OF_SELECTOR = "0x6352211e";
const NONCE_SELECTOR = "0xca10c956";
const POLICY_MODULE_SELECTOR = "0x893866f7";
const POLICY_VERSION_SELECTOR = "0xd3afe2b9";
const MIN_TTL_SECONDS = 30n;
const MAX_FILE_BYTES = 2_000_000;
const MAX_UINT256 = (1n << 256n) - 1n;

export class CanaryExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryExecutionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryExecutionError(code, message);
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("UNKNOWN_FIELD", `${label} fields are not canonical`);
  }
}

function assertJson(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} contains an unsafe number`);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    fail("INVALID_SCHEMA", `${label} is not acyclic JSON data`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail("INVALID_SCHEMA", `${label} has a nonstandard array prototype`);
    }
    value.forEach((item, index) => assertJson(item, `${label}[${index}]`, seen));
  } else {
    plain(value, label);
    for (const [key, item] of Object.entries(value)) assertJson(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

export function canonicalExecutionJson(value) {
  assertJson(value, "value");
  function serialize(item) {
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    if (item && typeof item === "object") {
      return `{${Object.keys(item).sort().map((key) => (
        `${JSON.stringify(key)}:${serialize(item[key])}`
      )).join(",")}}`;
    }
    return JSON.stringify(item);
  }
  return serialize(value);
}

export async function canonicalExecutionSha256(value, cryptoObject = globalThis.crypto) {
  const canonical = canonicalExecutionJson(value);
  if (new TextEncoder().encode(canonical).byteLength > MAX_FILE_BYTES) {
    fail("FILE_TOO_LARGE", "execution artifact exceeds its canonical size limit");
  }
  if (!cryptoObject?.subtle?.digest) fail("HASH_UNAVAILABLE", "SHA-256 is unavailable");
  const digest = await cryptoObject.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `0x${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function address(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is not an address`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function bytes32(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} is not 32 bytes`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === `0x${"0".repeat(64)}`) fail("INVALID_HASH", `${label} is zero`);
  return normalized;
}

function uint(value, label, maximum = MAX_UINT256) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} is not an unsigned decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) fail("INVALID_INTEGER", `${label} is too large`);
  return parsed;
}

function same(actual, expected, code, label) {
  const left = typeof actual === "string" ? actual.toLowerCase() : actual;
  const right = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (left !== right) fail(code, `${label} does not match`);
}

function word(value) {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n || parsed > MAX_UINT256) fail("ENCODING_MISMATCH", "ABI integer is invalid");
  return parsed.toString(16).padStart(64, "0");
}

function addressWord(value) {
  return address(value, "ABI address", { zero: true }).slice(2).padStart(64, "0");
}

function bytes32Word(value) {
  return bytes32(value, "ABI bytes32", { zero: true }).slice(2);
}

export function encodeReviewedOwnerDirectCalldata(intent) {
  const words = [
    addressWord(intent.account),
    word(uint(intent.chainId, "intent chain ID")),
    addressWord(intent.expectedOwner),
    word(uint(intent.nonce, "intent nonce")),
    word(uint(intent.policyVersion, "intent policy version", (1n << 64n) - 1n)),
    word(intent.opportunityTypeValue),
    word(intent.assetStandardValue),
    addressWord(intent.adapter),
    addressWord(intent.venue),
    addressWord(intent.collection),
    word(uint(intent.tokenId, "intent token ID")),
    word(uint(intent.assetAmount, "intent asset amount")),
    addressWord(intent.currency),
    word(uint(intent.expectedPrice, "intent expected price")),
    word(uint(intent.maxPrice, "intent maximum price")),
    word(uint(intent.maxSlippageBps, "intent slippage", (1n << 16n) - 1n)),
    word(uint(intent.createdAt, "intent creation time", (1n << 64n) - 1n)),
    word(uint(intent.expiresAt, "intent expiry", (1n << 64n) - 1n)),
    bytes32Word(intent.opportunityId),
    bytes32Word(intent.reasoningHash),
    bytes32Word(intent.adapterCodeHash),
    word(0x2e0n),
    word(0x300n),
    word(0n),
    word(0n),
  ];
  return `${EXECUTE_SELECTOR}${words.join("")}`;
}

function validateGate(gate) {
  exactKeys(gate, [
    "status", "capability", "reason", "expectedArtifactSha256", "bindings",
  ], "executionGate");
  if (gate.status !== "READY_FOR_OWNER_REVIEW" || gate.capability !== true
    || gate.reason !== null) fail("GATE_CLOSED", "server execution review gate is closed");
  const artifactSha256 = bytes32(gate.expectedArtifactSha256, "expected artifact hash");
  const bindings = gate.bindings;
  exactKeys(bindings, [
    "chainId", "expectedOwner", "account", "policyModule", "punkCollection", "punkTokenId",
    "adapter", "venue", "collection", "tokenId", "functionSelector", "mintSelector", "value",
    "dataKeccak256", "intentDigest", "accountRuntimeCodeHash", "adapterRuntimeCodeHash",
    "artRuntimeCodeHash", "coreManifestSha256", "canaryManifestSha256", "nonce",
    "policyVersion", "expiresAt",
  ], "executionGate.bindings");
  if (bindings.chainId !== CHAIN_ID || bindings.punkTokenId !== PUNK_TOKEN_ID
    || bindings.functionSelector !== EXECUTE_SELECTOR || bindings.mintSelector !== MINT_SELECTOR
    || bindings.value !== "0" || bindings.nonce !== "0" || bindings.policyVersion !== "11") {
    fail("GATE_MISMATCH", "server gate is not the fixed Punk #1797 canary");
  }
  return {
    ...bindings,
    expectedOwner: address(bindings.expectedOwner, "gate owner"),
    account: address(bindings.account, "gate Punk Account"),
    policyModule: address(bindings.policyModule, "gate policy module"),
    punkCollection: address(bindings.punkCollection, "gate Punk collection"),
    adapter: address(bindings.adapter, "gate adapter"),
    venue: address(bindings.venue, "gate venue"),
    collection: address(bindings.collection, "gate collection"),
    dataKeccak256: bytes32(bindings.dataKeccak256, "gate calldata hash"),
    intentDigest: bytes32(bindings.intentDigest, "gate intent digest"),
    accountRuntimeCodeHash: bytes32(
      bindings.accountRuntimeCodeHash,
      "gate Punk Account runtime hash",
    ),
    adapterRuntimeCodeHash: bytes32(
      bindings.adapterRuntimeCodeHash,
      "gate adapter runtime hash",
    ),
    artRuntimeCodeHash: bytes32(bindings.artRuntimeCodeHash, "gate art runtime hash"),
    coreManifestSha256: bytes32(bindings.coreManifestSha256, "gate core manifest hash"),
    canaryManifestSha256: bytes32(bindings.canaryManifestSha256, "gate canary manifest hash"),
    expiresAt: uint(bindings.expiresAt, "gate expiry", (1n << 64n) - 1n),
    artifactSha256,
  };
}

export async function validateCanaryExecutionArtifact(artifact, gate, options = {}) {
  const nowSeconds = options.nowSeconds === undefined
    ? BigInt(Math.floor(Date.now() / 1_000))
    : BigInt(options.nowSeconds);
  const expected = validateGate(gate);
  exactKeys(artifact, [
    "schema", "status", "generatedAt", "transaction", "reviewedAcquisition",
    "confirmedEvidence", "safetyBoundary",
  ], "executionArtifact");
  if (artifact.schema !== "GOGH_OWNER_DIRECT_FREE_MINT_EXECUTION_ARTIFACT_V1"
    || artifact.status !== "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED") {
    fail("INVALID_ARTIFACT", "artifact schema or status is invalid");
  }
  const artifactSha256 = await canonicalExecutionSha256(artifact, options.cryptoObject);
  same(artifactSha256, expected.artifactSha256, "ARTIFACT_HASH_MISMATCH", "artifact hash");

  const transaction = artifact.transaction;
  exactKeys(transaction, [
    "chainId", "from", "to", "value", "functionName", "functionSelector", "data",
    "dataKeccak256",
  ], "executionArtifact.transaction");
  if (transaction.chainId !== CHAIN_ID || transaction.value !== "0"
    || transaction.functionName !== "executeApprovedAcquisition"
    || transaction.functionSelector !== EXECUTE_SELECTOR) {
    fail("TRANSACTION_MISMATCH", "transaction is not the fixed zero-value acquisition call");
  }
  const from = address(transaction.from, "transaction sender");
  const to = address(transaction.to, "transaction target");
  same(from, expected.expectedOwner, "OWNER_MISMATCH", "transaction sender");
  same(to, expected.account, "TARGET_MISMATCH", "transaction target");
  same(bytes32(transaction.dataKeccak256, "calldata hash"), expected.dataKeccak256,
    "DATA_HASH_MISMATCH", "calldata hash");

  const reviewed = artifact.reviewedAcquisition;
  exactKeys(reviewed, [
    "controllingPunk", "target", "payment", "livePolicyBinding", "timing", "intent",
    "intentDigest", "adapterData", "ownerSignature",
  ], "executionArtifact.reviewedAcquisition");
  exactKeys(reviewed.controllingPunk, [
    "chainId", "collection", "tokenId", "account", "currentOwner",
  ], "reviewed controlling Punk");
  if (reviewed.controllingPunk.chainId !== CHAIN_ID
    || reviewed.controllingPunk.tokenId !== PUNK_TOKEN_ID) {
    fail("PUNK_MISMATCH", "artifact is not controlled by Punk #1797");
  }
  for (const [actual, wanted, label] of [
    [reviewed.controllingPunk.collection, expected.punkCollection, "Punk collection"],
    [reviewed.controllingPunk.account, expected.account, "Punk Account"],
    [reviewed.controllingPunk.currentOwner, expected.expectedOwner, "current owner"],
  ]) same(address(actual, label), wanted, "PUNK_MISMATCH", label);

  exactKeys(reviewed.target, [
    "kind", "adapter", "venue", "collection", "mintSelector", "tokenId", "amount",
  ], "reviewed target");
  if (reviewed.target.kind !== "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter"
    || reviewed.target.mintSelector !== MINT_SELECTOR || reviewed.target.amount !== "1") {
    fail("TARGET_MISMATCH", "artifact target is not the one-shot ERC-721 canary");
  }
  for (const [field, wanted] of [
    ["adapter", expected.adapter], ["venue", expected.venue], ["collection", expected.collection],
  ]) same(address(reviewed.target[field], `target ${field}`), wanted,
    "TARGET_MISMATCH", `target ${field}`);
  same(reviewed.target.tokenId, expected.tokenId, "TARGET_MISMATCH", "output token ID");

  exactKeys(reviewed.payment, [
    "currency", "expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue",
  ], "reviewed payment");
  if (address(reviewed.payment.currency, "payment currency", { zero: true }) !== ZERO_ADDRESS
    || ["expectedPrice", "maxPrice", "maxSlippageBps", "transactionValue"]
      .some((field) => reviewed.payment[field] !== "0")) {
    fail("NONZERO_PAYMENT", "canary execution must remain completely zero-value");
  }

  exactKeys(reviewed.livePolicyBinding, [
    "nonce", "policyVersion", "modeAttested", "permissionGeneration",
    "minimumNativeReserve", "maxIntentAgeSeconds", "ownerApprovedMintsAttested",
    "approvalPurchasesAttested", "autonomousPurchasesAttested", "autonomousMintsAttested",
  ], "reviewed policy binding");
  const policy = reviewed.livePolicyBinding;
  if (policy.nonce !== "0" || policy.policyVersion !== "11"
    || policy.modeAttested !== "APPROVAL_REQUIRED" || policy.permissionGeneration !== "1"
    || policy.minimumNativeReserve !== "0" || policy.maxIntentAgeSeconds !== "120"
    || policy.ownerApprovedMintsAttested !== true || policy.approvalPurchasesAttested !== true
    || policy.autonomousPurchasesAttested !== false || policy.autonomousMintsAttested !== false) {
    fail("POLICY_MISMATCH", "artifact policy is not the exact current-holder direct policy");
  }

  exactKeys(reviewed.timing, [
    "createdAt", "expiresAt", "encodedAt", "remainingSeconds", "minimumRequiredSeconds",
  ], "reviewed timing");
  const createdAt = uint(reviewed.timing.createdAt, "artifact creation time", (1n << 64n) - 1n);
  const expiresAt = uint(reviewed.timing.expiresAt, "artifact expiry", (1n << 64n) - 1n);
  const encodedAt = uint(reviewed.timing.encodedAt, "artifact encoding time", (1n << 64n) - 1n);
  if (createdAt > encodedAt || expiresAt <= createdAt || expiresAt - createdAt > 120n
    || reviewed.timing.remainingSeconds !== (expiresAt - encodedAt).toString()
    || reviewed.timing.minimumRequiredSeconds !== 30
    || expiresAt < nowSeconds || expiresAt - nowSeconds < MIN_TTL_SECONDS) {
    fail("STALE_ARTIFACT", "artifact lacks the minimum submission TTL");
  }
  same(expiresAt, expected.expiresAt, "STALE_ARTIFACT", "gate expiry");

  const intent = reviewed.intent;
  exactKeys(intent, [
    "account", "chainId", "expectedOwner", "nonce", "policyVersion", "opportunityType",
    "opportunityTypeValue", "assetStandard", "assetStandardValue", "adapter", "venue",
    "collection", "tokenId", "assetAmount", "currency", "expectedPrice", "maxPrice",
    "maxSlippageBps", "createdAt", "expiresAt", "opportunityId", "reasoningHash",
    "adapterCodeHash", "adapterDataHash",
  ], "reviewed intent");
  const fixedIntent = {
    account: expected.account, chainId: String(CHAIN_ID), expectedOwner: expected.expectedOwner,
    nonce: "0", policyVersion: "11", opportunityType: "FREE_MINT", opportunityTypeValue: 2,
    assetStandard: "ERC721", assetStandardValue: 0, adapter: expected.adapter,
    venue: expected.venue, collection: expected.collection, tokenId: expected.tokenId,
    assetAmount: "1", currency: ZERO_ADDRESS, expectedPrice: "0", maxPrice: "0",
    maxSlippageBps: "0", createdAt: createdAt.toString(), expiresAt: expiresAt.toString(),
    adapterDataHash: EMPTY_BYTES_HASH,
  };
  for (const [field, wanted] of Object.entries(fixedIntent)) {
    same(intent[field], wanted, "INTENT_MISMATCH", `intent ${field}`);
  }
  bytes32(intent.opportunityId, "intent opportunity ID");
  bytes32(intent.reasoningHash, "intent reasoning hash");
  bytes32(intent.adapterCodeHash, "intent adapter code hash");
  if (reviewed.adapterData !== "0x" || reviewed.ownerSignature !== "0x") {
    fail("ARBITRARY_DATA_REJECTED", "adapter data and owner signature must both be empty");
  }
  same(bytes32(reviewed.intentDigest, "intent digest"), expected.intentDigest,
    "INTENT_MISMATCH", "intent digest");

  const rebuiltData = encodeReviewedOwnerDirectCalldata(intent);
  if (typeof transaction.data !== "string" || transaction.data !== transaction.data.toLowerCase()
    || transaction.data !== rebuiltData || transaction.data.length !== 1_610) {
    fail("ENCODING_MISMATCH", "calldata is not the canonical encoding of the displayed intent");
  }
  same(keccak256Hex(rebuiltData), expected.dataKeccak256,
    "DATA_HASH_MISMATCH", "independently computed calldata hash");

  exactKeys(artifact.confirmedEvidence, [
    "status", "simulation", "pinnedBlock", "latestExecutionCheck", "hashes",
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash",
    "sourceVerification", "configurationHistory",
  ], "confirmed evidence");
  if (artifact.confirmedEvidence.status !== "READ_ONLY_PASS"
    || artifact.confirmedEvidence.simulation !== "READ_ONLY_ETH_CALL_PASS"
    || artifact.confirmedEvidence.sourceVerification?.status !== "VERIFIED_ADOPTIONS_BOUND"
    || artifact.confirmedEvidence.configurationHistory?.status
      !== "EXACT_13_CALL_DUAL_RPC_VERIFIED"
    || artifact.confirmedEvidence.configurationHistory?.transactionCount !== 13
    || artifact.confirmedEvidence.configurationHistory?.acquisitionNonce !== "0"
    || artifact.confirmedEvidence.configurationHistory?.finalPolicyVersion !== "11"
    || artifact.confirmedEvidence.configurationHistory?.finalPermissionGeneration !== "1"
    || artifact.confirmedEvidence.configurationHistory?.noOwnershipTransfersDuringEvidenceWindow
      !== true
    || artifact.confirmedEvidence.configurationHistory?.noRelevantMutationsAfterPinnedBlock
      !== true) {
    fail("EVIDENCE_MISMATCH", "artifact evidence gates are incomplete");
  }
  same(bytes32(artifact.confirmedEvidence.hashes?.coreManifest, "core manifest hash"),
    expected.coreManifestSha256, "MANIFEST_MISMATCH", "core manifest hash");
  same(bytes32(artifact.confirmedEvidence.hashes?.canaryManifest, "canary manifest hash"),
    expected.canaryManifestSha256, "MANIFEST_MISMATCH", "canary manifest hash");
  same(bytes32(artifact.confirmedEvidence.hashes?.intentDigest, "evidence intent digest"),
    expected.intentDigest, "INTENT_MISMATCH", "evidence intent digest");
  same(bytes32(artifact.confirmedEvidence.hashes?.punkAccountRuntimeCode,
    "evidence Punk Account runtime hash"), expected.accountRuntimeCodeHash,
  "CODE_HASH_MISMATCH", "evidence Punk Account runtime hash");
  same(bytes32(artifact.confirmedEvidence.hashes?.adapterRuntimeCode,
    "evidence adapter runtime hash"), expected.adapterRuntimeCodeHash,
  "CODE_HASH_MISMATCH", "evidence adapter runtime hash");
  same(bytes32(artifact.confirmedEvidence.hashes?.venueRuntimeCode,
    "evidence art runtime hash"), expected.artRuntimeCodeHash,
  "CODE_HASH_MISMATCH", "evidence art runtime hash");

  exactKeys(artifact.safetyBoundary, [
    "postEncodingDecodeEqual", "arbitraryCalldataAccepted", "adapterDataPolicy",
    "ownerSignaturePolicy", "agentRelayerUsed", "transactionAuthorized", "signingPerformed",
    "submissionPerformed", "rpcPerformed", "deploymentPerformed", "chainWritePerformed",
    "instruction",
  ], "safety boundary");
  const safety = artifact.safetyBoundary;
  if (safety.postEncodingDecodeEqual !== true || safety.arbitraryCalldataAccepted !== false
    || safety.adapterDataPolicy !== "EMPTY_ONLY"
    || safety.ownerSignaturePolicy !== "EMPTY_OWNER_DIRECT_ONLY"
    || ["agentRelayerUsed", "transactionAuthorized", "signingPerformed", "submissionPerformed",
      "rpcPerformed", "deploymentPerformed", "chainWritePerformed"]
      .some((field) => safety[field] !== false)) {
    fail("SAFETY_BOUNDARY_MISMATCH", "artifact safety boundary is invalid");
  }

  return Object.freeze({
    artifact,
    artifactSha256,
    transaction: Object.freeze({
      from,
      to,
      value: "0x0",
      data: rebuiltData,
    }),
    expected,
    createdAt,
    expiresAt,
    remainingSeconds: expiresAt - nowSeconds,
    intent,
  });
}

function parseHexUint(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail("RPC_MALFORMED", `${label} is malformed`);
  }
  return BigInt(value);
}

function decodeWordUint(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("RPC_MALFORMED", `${label} did not return one ABI word`);
  }
  return BigInt(value);
}

function decodeWordAddress(value, label) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    fail("RPC_MALFORMED", `${label} did not return a canonical address word`);
  }
  return address(`0x${value.slice(-40)}`, label, { zero: true });
}

function canonicalBytesReturn(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)
    || (value.length - 2) % 64 !== 0 || value.length < 130) return false;
  const body = value.slice(2);
  if (BigInt(`0x${body.slice(0, 64)}`) !== 32n) return false;
  const length = BigInt(`0x${body.slice(64, 128)}`);
  if (length > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  const padded = Math.ceil(Number(length) / 32) * 64;
  return body.length === 128 + padded
    && (padded === 0 || /^0*$/.test(body.slice(128 + Number(length) * 2)));
}

async function request(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "an EVM wallet is unavailable");
  return provider.request({ method, params });
}

export async function confirmCanaryWalletSelection(provider, expectedOwner) {
  const chain = parseHexUint(await request(provider, "eth_chainId"), "wallet chain ID");
  if (chain !== BigInt(CHAIN_ID)) fail("WRONG_CHAIN", "wallet is not on Robinhood Chain 4663");
  const accounts = await request(provider, "eth_accounts");
  const selected = Array.isArray(accounts) && accounts.length
    ? address(accounts[0], "selected wallet account") : null;
  if (selected !== expectedOwner) {
    fail("OWNER_MISMATCH", "selected wallet is not the reviewed current owner");
  }
  return selected;
}

function callTransaction(transaction) {
  return Object.freeze({
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
  });
}

function verifyRuntimeCode(code, expectedHash, label) {
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
    fail("CODE_MISSING", `${label} contract code is missing or malformed`);
  }
  let actualHash;
  try {
    actualHash = keccak256Hex(code);
  } catch {
    fail("CODE_MISMATCH", `${label} contract code could not be hashed`);
  }
  if (actualHash !== expectedHash) {
    fail("CODE_MISMATCH", `${label} runtime code does not match the reviewed manifest`);
  }
}

async function simulateCanaryTransaction(provider, validated) {
  const simulation = await request(provider, "eth_call", [
    callTransaction(validated.transaction),
    "latest",
  ]);
  if (!canonicalBytesReturn(simulation)) {
    fail("SIMULATION_FAILED", "wallet RPC did not return the canonical acquisition result");
  }
  return simulation;
}

export async function preflightCanaryTransaction(provider, validated) {
  const selected = await confirmCanaryWalletSelection(
    provider,
    validated.expected.expectedOwner,
  );
  const block = await request(provider, "eth_getBlockByNumber", ["latest", false]);
  const chainTimestamp = parseHexUint(block?.timestamp, "latest block timestamp");
  if (validated.createdAt > chainTimestamp || validated.expiresAt < chainTimestamp
    || validated.expiresAt - chainTimestamp < MIN_TTL_SECONDS) {
    fail("STALE_ARTIFACT", "chain time leaves less than 30 seconds to submit");
  }

  const accountWord = word(BigInt(validated.expected.account));
  const punkWord = word(BigInt(PUNK_TOKEN_ID));
  const [punkOwnerRaw, accountOwnerRaw, nonceRaw, policyModuleRaw, accountCode, adapterCode,
    venueCode] = await Promise.all([
    request(provider, "eth_call", [{
      to: validated.expected.punkCollection,
      data: `${OWNER_OF_SELECTOR}${punkWord}`,
    }, "latest"]),
    request(provider, "eth_call", [{ to: validated.expected.account, data: OWNER_SELECTOR }, "latest"]),
    request(provider, "eth_call", [{ to: validated.expected.account, data: NONCE_SELECTOR }, "latest"]),
    request(provider, "eth_call", [{
      to: validated.expected.account,
      data: POLICY_MODULE_SELECTOR,
    }, "latest"]),
    request(provider, "eth_getCode", [validated.expected.account, "latest"]),
    request(provider, "eth_getCode", [validated.expected.adapter, "latest"]),
    request(provider, "eth_getCode", [validated.expected.venue, "latest"]),
  ]);
  if (decodeWordAddress(punkOwnerRaw, "canonical Punk owner") !== selected
    || decodeWordAddress(accountOwnerRaw, "Punk Account owner") !== selected) {
    fail("OWNER_MISMATCH", "live canonical owner checks do not match the selected wallet");
  }
  if (decodeWordUint(nonceRaw, "acquisition nonce") !== 0n) {
    fail("NONCE_MISMATCH", "live acquisition nonce is no longer zero");
  }
  if (decodeWordAddress(policyModuleRaw, "account policy module")
    !== validated.expected.policyModule) {
    fail("POLICY_MISMATCH", "account policy module differs from the reviewed deployment");
  }
  verifyRuntimeCode(accountCode, validated.expected.accountRuntimeCodeHash, "Punk Account");
  verifyRuntimeCode(adapterCode, validated.expected.adapterRuntimeCodeHash, "mint adapter");
  verifyRuntimeCode(venueCode, validated.expected.artRuntimeCodeHash, "canary art");
  const policyVersionRaw = await request(provider, "eth_call", [{
    to: validated.expected.policyModule,
    data: `${POLICY_VERSION_SELECTOR}${accountWord}`,
  }, "latest"]);
  if (decodeWordUint(policyVersionRaw, "policy version") !== 11n) {
    fail("POLICY_MISMATCH", "live policy version is no longer eleven");
  }
  const simulation = await simulateCanaryTransaction(provider, validated);
  return Object.freeze({ selected, chainTimestamp, simulation });
}

function sameValidatedTransaction(initial, fresh) {
  return initial.artifactSha256 === fresh.artifactSha256
    && initial.expected.artifactSha256 === fresh.expected.artifactSha256
    && initial.transaction.from === fresh.transaction.from
    && initial.transaction.to === fresh.transaction.to
    && initial.transaction.value === fresh.transaction.value
    && initial.transaction.data === fresh.transaction.data;
}

export async function submitCanaryTransaction(provider, validated, options = {}) {
  const { refreshValidated, isCurrent = () => true } = options;
  if (typeof refreshValidated !== "function" || typeof isCurrent !== "function") {
    fail("SUBMISSION_BLOCKED", "submission requires a fresh server gate and state guard");
  }
  await preflightCanaryTransaction(provider, validated);
  if (!isCurrent()) fail("WALLET_STATE_CHANGED", "wallet or reviewed state changed during checks");

  const fresh = await refreshValidated();
  if (!fresh || !sameValidatedTransaction(validated, fresh)) {
    fail("STATUS_CHANGED", "the active reviewed artifact changed during checks");
  }
  if (!isCurrent()) fail("WALLET_STATE_CHANGED", "wallet or reviewed state changed during checks");

  // This second exact call occurs after the no-store status refresh. The final chain/account
  // reads are deliberately the last awaited wallet state checks before the send request.
  await simulateCanaryTransaction(provider, fresh);
  await confirmCanaryWalletSelection(provider, fresh.expected.expectedOwner);
  if (!isCurrent()) fail("WALLET_STATE_CHANGED", "wallet or reviewed state changed during checks");

  const hash = await request(provider, "eth_sendTransaction", [callTransaction(fresh.transaction)]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return Object.freeze({ hash, validated: fresh });
}

export async function fetchCanaryExecutionReview(fetchFunction = globalThis.fetch, options = {}) {
  const response = await fetchFunction("/api/broker/canary-execution-status", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response?.ok) fail("STATUS_UNAVAILABLE", "execution status is unavailable");
  const payload = await response.json();
  if (!payload?.ok || payload.chainId !== CHAIN_ID) {
    fail("STATUS_UNAVAILABLE", "execution status response is invalid");
  }
  if (payload.autonomyStatus !== "DISABLED") {
    fail("STATUS_UNAVAILABLE", "autonomous execution must remain disabled");
  }
  const gate = payload.executionGate;
  if (gate?.capability !== true) {
    if (payload.executionArtifact !== null) {
      fail("STATUS_UNAVAILABLE", "a closed gate exposed an execution artifact");
    }
    return Object.freeze({ gate, validated: null });
  }
  if (!payload.executionArtifact || typeof payload.executionArtifact !== "object"
    || Array.isArray(payload.executionArtifact)) {
    fail("STATUS_UNAVAILABLE", "the active reviewed artifact is unavailable");
  }
  const validated = await validateCanaryExecutionArtifact(payload.executionArtifact, gate, options);
  return Object.freeze({ gate, validated });
}

function routePunkTokenId(windowObject) {
  return windowObject.location?.pathname?.match(/^\/punk\/(\d+)\/?$/)?.[1]
    ?? new URLSearchParams(windowObject.location?.search ?? "").get("tokenId");
}

export function setupCanaryExecution({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-canary-execution]");
  if (!browserWindow || !browserDocument || !panel) return null;
  if (routePunkTokenId(browserWindow) !== PUNK_TOKEN_ID) {
    panel.hidden = true;
    return null;
  }
  panel.hidden = false;
  const confirmation = panel.querySelector("[data-canary-confirm]");
  const submit = panel.querySelector("[data-canary-submit]");
  const status = panel.querySelector("[data-canary-execution-state]");
  const fields = new Map([...panel.querySelectorAll("[data-canary-field]")]
    .map((element) => [element.dataset.canaryField, element]));
  const state = {
    gate: null,
    validated: null,
    wallet: browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null,
    submitting: false,
    notice: null,
    revision: 0,
  };

  function clearArtifact() {
    state.validated = null;
    confirmation.checked = false;
    fields.forEach((element) => { element.textContent = "—"; });
  }

  function setStatus(text, kind = "locked") {
    status.textContent = text;
    status.dataset.canaryStatus = kind;
  }

  function render() {
    const readyGate = state.gate?.capability === true;
    const walletOwner = state.wallet?.account?.toLowerCase?.()
      === state.validated?.expected.expectedOwner;
    const rightChain = state.wallet?.chainId === CHAIN_ID;
    submit.disabled = !(state.validated && readyGate && walletOwner && rightChain
      && confirmation.checked && !state.submitting);
    if (state.notice) setStatus(state.notice.text, state.notice.kind);
    else if (!readyGate) setStatus("LOCKED · verified deployment and active review hash required");
    else if (!state.validated) setStatus("LOCKED · reviewed artifact unavailable", "error");
    else if (!walletOwner || !rightChain) {
      setStatus("LOCKED · connect the reviewed owner on Robinhood Chain 4663");
    } else setStatus("REVIEWED · confirm the exact fields before wallet submission", "ready");
  }

  function display(validated) {
    const values = {
      artifactHash: validated.artifactSha256,
      dataHash: validated.expected.dataKeccak256,
      intentDigest: validated.expected.intentDigest,
      from: validated.expected.expectedOwner,
      account: validated.expected.account,
      adapter: validated.expected.adapter,
      collection: validated.expected.collection,
      tokenId: validated.expected.tokenId,
      value: "0 ETH (owner pays network gas)",
      intent: "Punk #1797 · owner-direct FREE_MINT · ERC-721 · amount 1",
      expiresAt: `${validated.expiresAt} · ${validated.remainingSeconds}s remaining at review`,
    };
    for (const [name, value] of Object.entries(values)) fields.get(name).textContent = String(value);
  }

  async function refreshGate() {
    state.notice = null;
    try {
      const { gate, validated } = await fetchCanaryExecutionReview(fetchFunction);
      const priorGate = JSON.stringify(state.gate);
      const nextGate = JSON.stringify(gate);
      if (priorGate !== nextGate) {
        state.revision += 1;
        clearArtifact();
      }
      state.gate = gate;
      state.validated = validated;
      if (validated) display(validated);
    } catch {
      state.revision += 1;
      state.gate = null;
      clearArtifact();
    }
    render();
  }

  function walletChanged(event) {
    const next = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    if (state.wallet?.account !== next?.account || state.wallet?.chainId !== next?.chainId) {
      state.revision += 1;
      state.notice = null;
    }
    state.wallet = next;
    render();
  }

  function providerStateChanged() {
    state.revision += 1;
    state.notice = null;
    render();
  }

  async function submitReviewed() {
    if (submit.disabled || state.submitting || !state.validated) return;
    state.submitting = true;
    render();
    const selected = state.validated;
    const submissionRevision = state.revision;
    try {
      const { hash } = await submitCanaryTransaction(
        browserWindow.__GOGH_WALLET_PROVIDER__, selected, {
        refreshValidated: async () => {
          const fresh = await fetchCanaryExecutionReview(fetchFunction);
          if (!fresh.validated) fail("STATUS_CHANGED", "the active review gate is closed");
          return fresh.validated;
        },
        isCurrent: () => state.revision === submissionRevision
          && state.validated === selected
          && state.gate?.expectedArtifactSha256 === selected.artifactSha256
          && state.wallet?.chainId === CHAIN_ID
          && state.wallet?.account?.toLowerCase?.() === selected.expected.expectedOwner
          && confirmation.checked,
      });
      state.notice = {
        text: `SUBMITTED · pending receipt and independent attestation · ${hash}`,
        kind: "pending",
      };
    } catch (error) {
      state.notice = {
        text: `NOT SUBMITTED · ${error instanceof CanaryExecutionError ? error.code : "WALLET_REJECTED"}`,
        kind: "error",
      };
    } finally {
      state.submitting = false;
      clearArtifact();
      render();
    }
  }

  confirmation?.addEventListener("change", render);
  submit?.addEventListener("click", submitReviewed);
  browserWindow.addEventListener("gogh:wallet-state", walletChanged);
  for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
    browserWindow.__GOGH_WALLET_PROVIDER__?.on?.(eventName, providerStateChanged);
  }
  refreshGate();

  return {
    refreshGate,
    destroy() {
      confirmation?.removeEventListener("change", render);
      submit?.removeEventListener("click", submitReviewed);
      browserWindow.removeEventListener("gogh:wallet-state", walletChanged);
      for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
        browserWindow.__GOGH_WALLET_PROVIDER__?.removeListener?.(eventName, providerStateChanged);
      }
      clearArtifact();
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupCanaryExecution({ windowObject: window, documentObject: document });
}
