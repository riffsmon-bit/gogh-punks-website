import { keccak256, toBytes } from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";

export const ONE_SHOT_ADAPTER_VERSION_LABEL = "GOGH_ONE_SHOT_CANARY_MINT_ADAPTER_V1";
export const ONE_SHOT_ADAPTER_METADATA_SCHEMA =
  "GOGH_ONE_SHOT_CANARY_ADAPTER_REGISTRATION_V1";
export const ONE_SHOT_MINT_SELECTOR = "0x40c10f19";

const INPUT_FIELDS = Object.freeze([
  "coreGitCommit",
  "corePreconfigurationManifestSha256",
  "canaryGitCommit",
  "canaryPreconfigurationManifestSha256",
  "adapter",
  "adapterRuntimeBytecodeHash",
  "venue",
  "venueRuntimeBytecodeHash",
  "collection",
  "controllingPunkTokenId",
  "punkAccount",
  "canaryArtTokenId",
]);

export class OneShotAdapterCommitmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OneShotAdapterCommitmentError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OneShotAdapterCommitmentError(code, message);
}

function assertPlainData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_INPUT", `${label} contains an unsafe number`);
    return;
  }
  if (!value || typeof value !== "object") fail("INVALID_INPUT", `${label} is not JSON data`);
  if (seen.has(value)) fail("INVALID_INPUT", `${label} contains a cycle`);
  seen.add(value);
  const expectedPrototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (![expectedPrototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_PROTOTYPE", `${label} has a custom prototype`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail("UNKNOWN_FIELD", `${label} contains a symbol`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("ACCESSOR_REJECTED", `${label}.${key} is not plain data`);
    }
    assertPlainData(descriptor.value, `${label}.${key}`, seen);
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
  assertPlainData(value, "commitment input");
  let clone;
  try {
    clone = structuredClone(value);
  } catch {
    fail("UNCLONEABLE_INPUT", "commitment input may not contain a Proxy or uncloneable value");
  }
  assertPlainData(clone, "commitment snapshot");
  return JSON.parse(canonicalJson(clone));
}

function exactKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_INPUT", "commitment input must be a plain object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...INPUT_FIELDS].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("UNKNOWN_FIELD", "commitment input fields do not match the canonical schema");
  }
}

function address(value, label) {
  let normalized;
  try {
    normalized = normalizeAddress(value, label);
  } catch (error) {
    fail("INVALID_ADDRESS", error.message);
  }
  if (normalized === "0x0000000000000000000000000000000000000000") {
    fail("ZERO_ADDRESS", `${label} cannot be zero`);
  }
  return normalized;
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be a nonzero bytes32 value`);
  }
  return value.toLowerCase();
}

function commit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_COMMIT", `${label} must be a full git commit`);
  }
  return value.toLowerCase();
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical decimal string`);
  }
  return BigInt(value).toString();
}

export function deriveOneShotAdapterRegistrationCommitment(input) {
  const value = snapshot(input);
  exactKeys(value);
  const metadata = Object.freeze({
    schema: ONE_SHOT_ADAPTER_METADATA_SCHEMA,
    chainId: ROBINHOOD.chainId,
    coreGitCommit: commit(value.coreGitCommit, "coreGitCommit"),
    corePreconfigurationManifestSha256: hash(
      value.corePreconfigurationManifestSha256,
      "corePreconfigurationManifestSha256",
    ),
    canaryGitCommit: commit(value.canaryGitCommit, "canaryGitCommit"),
    canaryPreconfigurationManifestSha256: hash(
      value.canaryPreconfigurationManifestSha256,
      "canaryPreconfigurationManifestSha256",
    ),
    adapter: address(value.adapter, "adapter"),
    adapterRuntimeBytecodeHash: hash(
      value.adapterRuntimeBytecodeHash,
      "adapterRuntimeBytecodeHash",
    ),
    venue: address(value.venue, "venue"),
    venueRuntimeBytecodeHash: hash(value.venueRuntimeBytecodeHash, "venueRuntimeBytecodeHash"),
    collection: address(value.collection, "collection"),
    controllingPunkTokenId: decimal(value.controllingPunkTokenId, "controllingPunkTokenId"),
    punkAccount: address(value.punkAccount, "punkAccount"),
    canaryArtTokenId: decimal(value.canaryArtTokenId, "canaryArtTokenId"),
    kind: "MINT",
    selector: ONE_SHOT_MINT_SELECTOR,
    assetStandard: "ERC721",
    payment: "ZERO_NATIVE_ONLY",
  });
  if (metadata.venue !== metadata.collection) {
    fail("TARGET_MISMATCH", "one-shot venue and collection must be identical");
  }
  const metadataCanonicalJson = canonicalJson(metadata);
  return Object.freeze({
    versionLabel: ONE_SHOT_ADAPTER_VERSION_LABEL,
    versionHash: keccak256(toBytes(ONE_SHOT_ADAPTER_VERSION_LABEL)),
    metadata,
    metadataCanonicalJson,
    metadataHash: keccak256(toBytes(metadataCanonicalJson)),
  });
}
