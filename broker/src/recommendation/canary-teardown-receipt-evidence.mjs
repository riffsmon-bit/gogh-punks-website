import { createHash } from "node:crypto";

export const CANARY_TEARDOWN_RECEIPT_EVIDENCE_SCHEMA =
  "GOGH_OWNER_DIRECT_CANARY_TEARDOWN_RECEIPT_EVIDENCE_V1";
export const CANARY_TEARDOWN_CALL_COUNT = 11;

export class CanaryTeardownReceiptEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryTeardownReceiptEvidenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryTeardownReceiptEvidenceError(code, message);
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
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      fail("UNKNOWN_FIELD", `${label} contains an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
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

function snapshot(value, label = "teardown receipt evidence input") {
  assertJsonData(value, label);
  let copy;
  try {
    copy = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", `${label} may not contain a Proxy`);
  }
  assertJsonData(copy, `${label} snapshot`);
  const encoded = canonicalJson(copy);
  if (Buffer.byteLength(encoded, "utf8") > 1_000_000) {
    fail("INVALID_SCHEMA", `${label} exceeds its canonical size limit`);
  }
  return JSON.parse(encoded);
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
    fail("UNKNOWN_FIELD", `${label} fields do not match the canonical schema`);
  }
}

function bytes32(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be bytes32`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === `0x${"00".repeat(32)}`) {
    fail("INVALID_HASH", `${label} must be nonzero`);
  }
  return normalized;
}

function safeUint(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    fail("INVALID_INTEGER", `${label} must be a JSON-safe unsigned integer`);
  }
  return value;
}

function boundedString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("INVALID_SCHEMA", `${label} must be a bounded nonempty string`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function canonicalTeardownEvidenceSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/**
 * Builds a non-authorizing index of the exact eleven teardown transaction hashes.
 * No receipt or state claim is trusted from this artifact; the final dual-RPC
 * attestor independently fetches and reconciles the chain evidence.
 */
export function buildCanaryTeardownReceiptEvidence(inputValue) {
  const input = snapshot(inputValue);
  exactKeys(input, ["bindings", "mintReceipt", "transactions"], "input");
  exactKeys(input.bindings, [
    "coreManifestSha256", "canaryManifestSha256",
    "coreSourceVerificationAdoptionSha256", "canarySourceVerificationAdoptionSha256",
    "configBundleReviewHash", "configBundleArtifactSha256",
    "configurationReceiptEvidenceHash", "configurationReceiptEvidenceArtifactSha256",
    "executionReceiptEvidenceHash", "executionReceiptEvidenceArtifactSha256",
    "mintReceiptAttestationArtifactSha256",
  ], "input.bindings");
  const bindings = {};
  for (const [name, value] of Object.entries(input.bindings)) {
    bindings[name] = bytes32(value, `input.bindings.${name}`);
  }
  exactKeys(input.mintReceipt,
    ["transactionHash", "blockNumber", "blockHash", "transactionIndex"],
    "input.mintReceipt");
  const mintReceipt = {
    transactionHash: bytes32(input.mintReceipt.transactionHash,
      "input.mintReceipt.transactionHash"),
    blockNumber: safeUint(input.mintReceipt.blockNumber,
      "input.mintReceipt.blockNumber", { positive: true }),
    blockHash: bytes32(input.mintReceipt.blockHash, "input.mintReceipt.blockHash"),
    transactionIndex: safeUint(input.mintReceipt.transactionIndex,
      "input.mintReceipt.transactionIndex"),
  };
  if (!Array.isArray(input.transactions)
    || input.transactions.length !== CANARY_TEARDOWN_CALL_COUNT) {
    fail("INVALID_SCHEMA",
      `transactions must contain exactly ${CANARY_TEARDOWN_CALL_COUNT} items`);
  }
  const seen = new Set([mintReceipt.transactionHash]);
  const transactions = input.transactions.map((item, index) => {
    exactKeys(item, ["id", "order", "hash"], `input.transactions[${index}]`);
    const order = safeUint(item.order, `input.transactions[${index}].order`, { positive: true });
    if (order !== index + 1) fail("INVALID_ORDER", "teardown transaction order is not contiguous");
    const id = boundedString(item.id, `input.transactions[${index}].id`);
    const hash = bytes32(item.hash, `input.transactions[${index}].hash`);
    if (seen.has(hash)) {
      fail("DUPLICATE_TRANSACTION",
        "teardown transaction hash is reused or equals the mint transaction");
    }
    seen.add(hash);
    return { id, order, hash };
  });
  const evidence = {
    schema: CANARY_TEARDOWN_RECEIPT_EVIDENCE_SCHEMA,
    chainId: 4663,
    bindings,
    mintReceipt,
    transactions,
  };
  return deepFreeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    evidenceHash: canonicalTeardownEvidenceSha256(evidence),
    evidence,
    transactionAuthorized: false,
  });
}

export function validateCanaryTeardownReceiptEvidence(artifactValue) {
  const artifact = snapshot(artifactValue, "teardown receipt evidence artifact");
  exactKeys(artifact,
    ["hashAlgorithm", "evidenceHash", "evidence", "transactionAuthorized"], "artifact");
  if (artifact.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1"
    || artifact.transactionAuthorized !== false) {
    fail("INVALID_SCHEMA", "teardown receipt evidence must be canonical non-authorizing data");
  }
  const rebuilt = buildCanaryTeardownReceiptEvidence({
    bindings: artifact.evidence?.bindings,
    mintReceipt: artifact.evidence?.mintReceipt,
    transactions: artifact.evidence?.transactions,
  });
  if (artifact.evidence?.schema !== CANARY_TEARDOWN_RECEIPT_EVIDENCE_SCHEMA
    || artifact.evidence?.chainId !== 4663
    || bytes32(artifact.evidenceHash, "artifact.evidenceHash") !== rebuilt.evidenceHash
    || canonicalJson(artifact) !== canonicalJson(rebuilt)) {
    fail("EVIDENCE_HASH_MISMATCH", "teardown receipt evidence is not the canonical rebuilt artifact");
  }
  return rebuilt;
}
