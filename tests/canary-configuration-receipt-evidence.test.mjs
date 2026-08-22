import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildCanaryConfigurationReceiptEvidence,
  CanaryConfigurationReceiptEvidenceError,
  canonicalConfigurationEvidenceSha256,
  validateCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import { buildReceiptEvidenceFromFiles } from
  "../scripts/build-canary-configuration-receipt-evidence.mjs";

const hash = (nibble) => `0x${nibble.repeat(64)}`;
const IDS = [
  "CONFIG_OWNER_01_PAUSE_ACCOUNT_BEFORE_STAGING",
  "CONFIG_OWNER_02_CONFIGURE_DISABLED_ZERO_SPEND_POLICY",
  "CONFIG_GUARDIAN_01_REGISTER_EXACT_MINT_ADAPTER",
  "CONFIG_OWNER_03_ALLOW_EXACT_ADAPTER",
  "CONFIG_OWNER_04_ALLOW_EXACT_MINT_VENUE",
  "CONFIG_OWNER_05_ALLOW_EXACT_COLLECTION",
  "CONFIG_OWNER_06_ALLOW_ZERO_NATIVE_CURRENCY",
  "CONFIG_OWNER_07_SET_ZERO_VENUE_MAXIMUM",
  "CONFIG_OWNER_08_ALLOW_EXACT_MINT_SELECTOR",
  "CONFIG_OWNER_09_ENABLE_OWNER_APPROVED_MINTS_ONLY",
  "CONFIG_GUARDIAN_02_ENABLE_APPROVAL_PURCHASES_ONLY",
  "CONFIG_OWNER_10_SWITCH_TO_APPROVAL_REQUIRED",
  "CONFIG_OWNER_11_UNPAUSE_ACCOUNT_LAST",
];
const NIBBLES = "123456789abcd";

function input() {
  return {
    configBundleHash: hash("e"),
    preconfigurationBlock: {
      number: 1_120,
      hash: hash("f"),
      timestamp: "2026-08-20T16:00:00.000Z",
    },
    transactions: IDS.map((id, index) => ({
      id,
      order: index + 1,
      hash: hash(NIBBLES[index]),
    })),
  };
}

test("builds and validates one deterministic non-authorizing 13-receipt index", () => {
  const first = buildCanaryConfigurationReceiptEvidence(input());
  const second = buildCanaryConfigurationReceiptEvidence(structuredClone(input()));
  assert.deepEqual(first, second);
  assert.equal(first.evidence.schema,
    "GOGH_OWNER_DIRECT_CANARY_CONFIGURATION_RECEIPT_EVIDENCE_V1");
  assert.equal(first.evidence.chainId, 4663);
  assert.equal(first.evidence.transactions.length, 13);
  assert.equal(first.transactionAuthorized, false);
  assert.equal(first.evidenceHash, canonicalConfigurationEvidenceSha256(first.evidence));
  assert.deepEqual(validateCanaryConfigurationReceiptEvidence(first), first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.evidence.transactions));
});

test("rejects duplicate hashes, bad order, unknown fields, sparse/extended arrays, and stale hashes", () => {
  const duplicate = input();
  duplicate.transactions[1].hash = duplicate.transactions[0].hash;
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(duplicate), (error) => (
    error instanceof CanaryConfigurationReceiptEvidenceError
      && error.code === "DUPLICATE_TRANSACTION"
  ));

  const order = input();
  order.transactions[3].order = 9;
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(order), /order is not contiguous/);

  const unknown = input();
  unknown.transactions[0].calldata = "0xdeadbeef";
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(unknown), (error) => (
    error.code === "UNKNOWN_FIELD"
  ));

  const extended = input();
  extended.transactions.hidden = true;
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(extended), (error) => (
    error.code === "UNKNOWN_FIELD"
  ));

  const sparse = input();
  delete sparse.transactions[4];
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(sparse), /array hole/);

  const stale = structuredClone(buildCanaryConfigurationReceiptEvidence(input()));
  stale.evidence.transactions[0].hash = hash("f");
  assert.throws(() => validateCanaryConfigurationReceiptEvidence(stale), (error) => (
    error.code === "EVIDENCE_HASH_MISMATCH"
  ));
});

test("rejects accessors and programmatic Proxies without invoking value getters", () => {
  const accessor = input();
  let reads = 0;
  Object.defineProperty(accessor.transactions[0], "id", {
    enumerable: true,
    get() { reads += 1; return IDS[0]; },
  });
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(accessor), (error) => (
    error.code === "ACCESSOR_REJECTED"
  ));
  assert.equal(reads, 0);

  const source = input();
  const proxy = new Proxy(source, {
    get() { reads += 1; throw new Error("must not read through Proxy"); },
  });
  assert.throws(() => buildCanaryConfigurationReceiptEvidence(proxy), (error) => (
    error.code === "UNCLONEABLE_INPUT"
  ));
  assert.equal(reads, 0);
});

test("stdout-only CLI path rejects an unbound bundle and symlinks", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "gogh-config-evidence-"));
  try {
    const bundlePath = resolve(directory, "bundle.json");
    const transactionsPath = resolve(directory, "transactions.json");
    await writeFile(bundlePath, JSON.stringify({
      hashAlgorithm: "KECCAK256_CANONICAL_JSON_V1",
      bundleHash: hash("e"),
      review: {},
      transactionAuthorized: false,
    }));
    await writeFile(transactionsPath, JSON.stringify({ transactions: input().transactions }));
    await assert.rejects(() => buildReceiptEvidenceFromFiles([
      "--config-bundle", bundlePath,
      "--transactions", transactionsPath,
    ]), /not rebuilt exactly from the authoritative manifests/);

    const symlinkPath = resolve(directory, "bundle-link.json");
    await symlink(bundlePath, symlinkPath);
    await assert.rejects(() => buildReceiptEvidenceFromFiles([
      "--config-bundle", symlinkPath,
      "--transactions", transactionsPath,
    ]), /could not be read as exact JSON/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("receipt-index builder source has no wallet, signer, RPC, submission, or file-write path", async () => {
  const source = await Promise.all([
    readFile(new URL(
      "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../scripts/build-canary-configuration-receipt-evidence.mjs",
      import.meta.url,
    ), "utf8"),
  ]).then((parts) => parts.join("\n"));
  assert.match(source, /O_NOFOLLOW/);
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|signTypedData/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /createPublicClient|\bhttp\(|simulateContract/);
  assert.doesNotMatch(source, /writeFile|appendFile/);
});
