import { createHash } from "node:crypto";
import { canonicalJson } from "../scout/canonical-json.mjs";

export const SOURCE_VERIFICATION_ADOPTION_SCHEMA =
  "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1";
export const SOURCE_VERIFICATION_GATE_SCHEMA =
  "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1";
export const SOURCE_VERIFICATION_GATE_VERSION = 1;
export const ROBINHOOD_BLOCKSCOUT_ORIGIN = "https://robinhoodchain.blockscout.com";
const MAX_PENDING_MANIFEST_NOTES_BYTES = 8_192;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export class SourceVerificationAdoptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SourceVerificationAdoptionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SourceVerificationAdoptionError(code, message);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string"
    || !Object.hasOwn(descriptors[key], "value"))) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} cannot contain symbols/accessors`);
  }
  const expected = [...keys].sort();
  const sorted = [...actual].sort();
  if (sorted.length !== expected.length
    || sorted.some((key, index) => key !== expected[index])) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} fields do not match the schema`);
  }
}

function strictHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} must be lowercase SHA-256`);
  }
  return value;
}

function strictIso(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", `${label} must be strict ISO-8601 UTC`);
  }
  return value;
}

function strictPendingNotes(value) {
  if (typeof value !== "string"
    || Buffer.byteLength(value, "utf8") > MAX_PENDING_MANIFEST_NOTES_BYTES) {
    fail(
      "INVALID_SOURCE_VERIFICATION_ADOPTION",
      "pendingManifestNotes must be a bounded string",
    );
  }
  return value;
}

export function sourceVerificationCanonicalSha256(value) {
  let serialized;
  try {
    serialized = canonicalJson(value);
  } catch {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "hash input is not strict canonical JSON");
  }
  return `0x${createHash("sha256").update(serialized).digest("hex")}`;
}

export function validateSourceVerificationAdoption(value, {
  expectedContracts,
  expectedPendingProposalSha256,
  expectedPendingManifestSha256,
  expectedPendingManifestNotes,
  expectedVerificationEvidenceSha256,
} = {}) {
  exactObject(value, [
    "schema", "gateSchema", "gateVersion", "chainId", "explorerOrigin",
    "pendingProposalSha256", "pendingManifestSha256", "pendingManifestNotes",
    "verificationEvidenceSha256", "verifiedContracts", "observedAt",
  ], "sourceVerificationAdoption");
  if (value.schema !== SOURCE_VERIFICATION_ADOPTION_SCHEMA
    || value.gateSchema !== SOURCE_VERIFICATION_GATE_SCHEMA
    || value.gateVersion !== SOURCE_VERIFICATION_GATE_VERSION || value.chainId !== 4663
    || value.explorerOrigin !== ROBINHOOD_BLOCKSCOUT_ORIGIN) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "source verification gate identity is wrong");
  }
  const pendingProposalSha256 = strictHash(
    value.pendingProposalSha256,
    "pendingProposalSha256",
  );
  const verificationEvidenceSha256 = strictHash(
    value.verificationEvidenceSha256,
    "verificationEvidenceSha256",
  );
  const pendingManifestSha256 = strictHash(
    value.pendingManifestSha256,
    "pendingManifestSha256",
  );
  const pendingManifestNotes = strictPendingNotes(value.pendingManifestNotes);
  strictIso(value.observedAt, "observedAt");
  if (!Array.isArray(expectedContracts) || expectedContracts.length === 0
    || expectedContracts.some((name) => typeof name !== "string" || name.length === 0)) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "expectedContracts are required");
  }
  try {
    if (canonicalJson(value.verifiedContracts) !== canonicalJson(expectedContracts)) {
      fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "verified contract set/order is wrong");
    }
  } catch (error) {
    if (error instanceof SourceVerificationAdoptionError) throw error;
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "verifiedContracts are not strict JSON");
  }
  if (expectedPendingProposalSha256 !== undefined
    && pendingProposalSha256 !== strictHash(
      expectedPendingProposalSha256,
      "expected pending proposal hash",
    )) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "pending proposal hash differs");
  }
  if (expectedVerificationEvidenceSha256 !== undefined
    && verificationEvidenceSha256 !== strictHash(
      expectedVerificationEvidenceSha256,
      "expected verification evidence hash",
    )) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "verification evidence hash differs");
  }
  if (expectedPendingManifestSha256 !== undefined
    && pendingManifestSha256 !== strictHash(
      expectedPendingManifestSha256,
      "expected pending manifest hash",
    )) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "pending manifest hash differs");
  }
  if (expectedPendingManifestNotes !== undefined
    && pendingManifestNotes !== strictPendingNotes(expectedPendingManifestNotes)) {
    fail("SOURCE_VERIFICATION_HASH_MISMATCH", "pending manifest notes differ");
  }
  return Object.freeze({
    schema: value.schema,
    gateSchema: value.gateSchema,
    gateVersion: value.gateVersion,
    chainId: value.chainId,
    explorerOrigin: value.explorerOrigin,
    pendingProposalSha256,
    pendingManifestSha256,
    pendingManifestNotes,
    verificationEvidenceSha256,
    verifiedContracts: Object.freeze([...expectedContracts]),
    observedAt: value.observedAt,
  });
}

export function requireVerifiedManifestAdoption(manifest, expectedContracts) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "manifest must be an object");
  }
  if (!manifest.contracts || typeof manifest.contracts !== "object"
    || Array.isArray(manifest.contracts)) {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "manifest contracts are missing");
  }
  for (const name of expectedContracts) {
    if (!Object.hasOwn(manifest.contracts, name)
      || manifest.contracts[name]?.verificationStatus !== "VERIFIED") {
      fail("SOURCE_VERIFICATION_NOT_ADOPTED", `${name} is not VERIFIED`);
    }
  }
  const contractNames = Reflect.ownKeys(manifest.contracts);
  if (contractNames.some((name) => typeof name !== "string")
    || canonicalJson([...contractNames].sort()) !== canonicalJson([...expectedContracts].sort())) {
    fail("SOURCE_VERIFICATION_NOT_ADOPTED", "manifest contract set is wrong");
  }
  const adoption = validateSourceVerificationAdoption(manifest.sourceVerificationAdoption, {
    expectedContracts,
  });
  let snapshot;
  try {
    const serialized = canonicalJson(manifest);
    if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) throw new Error();
    snapshot = JSON.parse(serialized);
  } catch {
    fail("INVALID_SOURCE_VERIFICATION_ADOPTION", "manifest is not bounded strict JSON");
  }
  for (const name of expectedContracts) {
    snapshot.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  snapshot.sourceVerificationAdoption = null;
  snapshot.notes = adoption.pendingManifestNotes;
  if (sourceVerificationCanonicalSha256(snapshot) !== adoption.pendingManifestSha256) {
    fail(
      "SOURCE_VERIFICATION_HASH_MISMATCH",
      "manifest is not the exact adopted transition of its pending manifest",
    );
  }
  return adoption;
}
