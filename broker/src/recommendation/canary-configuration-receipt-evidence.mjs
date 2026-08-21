import { createHash } from "node:crypto";

export const CANARY_CONFIGURATION_RECEIPT_EVIDENCE_SCHEMA =
  "GOGH_OWNER_DIRECT_CANARY_CONFIGURATION_RECEIPT_EVIDENCE_V1";
export const CANARY_CONFIGURATION_CALL_COUNT = 13;

export class CanaryConfigurationReceiptEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryConfigurationReceiptEvidenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryConfigurationReceiptEvidenceError(code, message);
}

function assertData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} contains an unsafe number`);
    return;
  }
  if (!value || typeof value !== "object") fail("INVALID_SCHEMA", `${label} is not JSON data`);
  if (seen.has(value)) fail("INVALID_SCHEMA", `${label} contains a cycle`);
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const expected = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (prototype !== expected && prototype !== null) {
    fail("INVALID_PROTOTYPE", `${label} has a custom prototype`);
  }
  if (Array.isArray(value)) {
    const arrayKeys = Reflect.ownKeys(value);
    if (arrayKeys.some((key) => key !== "length"
      && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)))) {
      fail("UNKNOWN_FIELD", `${label} contains an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail("UNKNOWN_FIELD", `${label} contains a symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not an enumerable data field`);
    }
    assertData(descriptor.value, `${label}.${key}`, seen);
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

function snapshot(value) {
  assertData(value, "configuration evidence input");
  let cloned;
  try {
    cloned = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", "configuration evidence input may not contain a Proxy");
  }
  assertData(cloned, "configuration evidence snapshot");
  return JSON.parse(canonicalJson(cloned));
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

function hash(value, label) {
  if (typeof value !== "string" || !/^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be a nonzero bytes32 value`);
  }
  return value.toLowerCase();
}

function uint(value, label, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
    || (positive && value === 0)) {
    fail("INVALID_INTEGER", `${label} must be a JSON safe unsigned integer`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("INVALID_SCHEMA", `${label} must be a bounded nonempty string`);
  }
  return value;
}

export function canonicalConfigurationEvidenceSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * Builds a review-only receipt index. It records transaction hashes only; the live
 * attestor independently obtains and compares both transactions, receipts, blocks,
 * and interval logs from two RPC providers before it can return READ_ONLY_PASS.
 */
export function buildCanaryConfigurationReceiptEvidence(inputValue) {
  // Snapshot the single outer object before any property read. In particular,
  // do not destructure a caller-controlled Proxy at the function boundary.
  const input = snapshot(inputValue);
  exactKeys(input, ["configBundleHash", "preconfigurationBlock", "transactions"], "input");
  const normalizedBundleHash = hash(input.configBundleHash, "config bundle hash");
  exactKeys(input.preconfigurationBlock, ["number", "hash", "timestamp"],
    "preconfiguration block");
  const normalizedBlock = {
    number: uint(input.preconfigurationBlock.number, "preconfiguration block number", { positive: true }),
    hash: hash(input.preconfigurationBlock.hash, "preconfiguration block hash"),
    timestamp: nonemptyString(input.preconfigurationBlock.timestamp,
      "preconfiguration block timestamp"),
  };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalizedBlock.timestamp)
    || new Date(normalizedBlock.timestamp).toISOString() !== normalizedBlock.timestamp) {
    fail("INVALID_TIMESTAMP", "preconfiguration block timestamp must be strict ISO-UTC");
  }
  if (!Array.isArray(input.transactions)
    || input.transactions.length !== CANARY_CONFIGURATION_CALL_COUNT) {
    fail("INVALID_SCHEMA", `transactions must contain exactly ${CANARY_CONFIGURATION_CALL_COUNT} items`);
  }
  const seen = new Set();
  const normalizedTransactions = input.transactions.map((item, index) => {
    exactKeys(item, ["id", "order", "hash"], `transactions[${index}]`);
    const order = uint(item.order, `transactions[${index}].order`, { positive: true });
    if (order !== index + 1) fail("INVALID_ORDER", "configuration transaction order is not contiguous");
    const id = nonemptyString(item.id, `transactions[${index}].id`);
    const transactionHash = hash(item.hash, `transactions[${index}].hash`);
    if (seen.has(transactionHash)) fail("DUPLICATE_TRANSACTION", "configuration transaction hash is reused");
    seen.add(transactionHash);
    return { id, order, hash: transactionHash };
  });
  const evidence = {
    schema: CANARY_CONFIGURATION_RECEIPT_EVIDENCE_SCHEMA,
    chainId: 4663,
    configBundleHash: normalizedBundleHash,
    preconfigurationBlock: normalizedBlock,
    transactions: normalizedTransactions,
  };
  return deepFreeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    evidenceHash: canonicalConfigurationEvidenceSha256(evidence),
    evidence,
    transactionAuthorized: false,
  });
}

export function validateCanaryConfigurationReceiptEvidence(artifact) {
  const snapshotArtifact = snapshot(artifact);
  exactKeys(snapshotArtifact,
    ["hashAlgorithm", "evidenceHash", "evidence", "transactionAuthorized"], "artifact");
  if (snapshotArtifact.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1"
    || snapshotArtifact.transactionAuthorized !== false) {
    fail("INVALID_SCHEMA", "configuration evidence must be non-authorizing canonical SHA-256 data");
  }
  const rebuilt = buildCanaryConfigurationReceiptEvidence({
    configBundleHash: snapshotArtifact.evidence?.configBundleHash,
    preconfigurationBlock: snapshotArtifact.evidence?.preconfigurationBlock,
    transactions: snapshotArtifact.evidence?.transactions,
  });
  if (snapshotArtifact.evidence?.schema !== CANARY_CONFIGURATION_RECEIPT_EVIDENCE_SCHEMA
    || snapshotArtifact.evidence?.chainId !== 4663
    || hash(snapshotArtifact.evidenceHash, "evidence hash") !== rebuilt.evidenceHash
    || canonicalJson(snapshotArtifact) !== canonicalJson(rebuilt)) {
    fail("EVIDENCE_HASH_MISMATCH", "configuration evidence is not the canonical rebuilt artifact");
  }
  return rebuilt;
}
