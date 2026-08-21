import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCanaryTeardownReceiptEvidence,
  CanaryTeardownReceiptEvidenceError,
  canonicalTeardownEvidenceSha256,
  validateCanaryTeardownReceiptEvidence,
} from "../broker/src/recommendation/canary-teardown-receipt-evidence.mjs";
import { parseCanaryTeardownReceiptArguments } from
  "../scripts/build-canary-teardown-receipt-evidence.mjs";

const hash = (nibble) => `0x${nibble.repeat(64)}`;
const IDS = Object.freeze([
  "TEARDOWN_GUARDIAN_01_DISABLE_APPROVAL_PURCHASES",
  "TEARDOWN_OWNER_01_PAUSE_ACCOUNT",
  "TEARDOWN_OWNER_02_CONFIGURE_DISABLED",
  "TEARDOWN_GUARDIAN_02_DISABLE_ADAPTER",
  "TEARDOWN_OWNER_03_DISABLE_ALL_MINT_CONTROLS",
  "TEARDOWN_OWNER_04_DENY_SELECTOR",
  "TEARDOWN_OWNER_05_REVOKE_ADAPTER",
  "TEARDOWN_OWNER_06_REVOKE_MINT_VENUE",
  "TEARDOWN_OWNER_07_DENY_COLLECTION",
  "TEARDOWN_OWNER_08_DISABLE_CURRENCY",
  "TEARDOWN_OWNER_09_KEEP_ZERO_VENUE_MAXIMUM",
]);

function input() {
  const names = [
    "coreManifestSha256", "canaryManifestSha256",
    "coreSourceVerificationAdoptionSha256", "canarySourceVerificationAdoptionSha256",
    "configBundleReviewHash", "configBundleArtifactSha256",
    "configurationReceiptEvidenceHash", "configurationReceiptEvidenceArtifactSha256",
    "executionReceiptEvidenceHash", "executionReceiptEvidenceArtifactSha256",
    "mintReceiptAttestationArtifactSha256",
  ];
  return {
    bindings: Object.fromEntries(names.map((name, index) => [
      name,
      hash("123456789abcdef"[index]),
    ])),
    mintReceipt: {
      transactionHash: hash("f"),
      blockNumber: 1_500,
      blockHash: hash("e"),
      transactionIndex: 4,
    },
    transactions: IDS.map((id, index) => ({
      id,
      order: index + 1,
      hash: hash("123456789ab"[index]),
    })),
  };
}

test("builds and validates an exact non-authorizing eleven-transaction teardown index", () => {
  const first = buildCanaryTeardownReceiptEvidence(input());
  const second = buildCanaryTeardownReceiptEvidence(structuredClone(input()));
  assert.deepEqual(first, second);
  assert.equal(first.evidence.schema,
    "GOGH_OWNER_DIRECT_CANARY_TEARDOWN_RECEIPT_EVIDENCE_V1");
  assert.equal(first.evidence.chainId, 4663);
  assert.equal(first.evidence.transactions.length, 11);
  assert.equal(first.transactionAuthorized, false);
  assert.equal(first.evidenceHash, canonicalTeardownEvidenceSha256(first.evidence));
  assert.deepEqual(validateCanaryTeardownReceiptEvidence(first), first);
  assert.ok(Object.isFrozen(first.evidence.transactions));
});

test("rejects duplicate mint/teardown hashes, substitutions, order changes, and unknown fields", () => {
  const duplicateMint = input();
  duplicateMint.transactions[0].hash = duplicateMint.mintReceipt.transactionHash;
  assert.throws(() => buildCanaryTeardownReceiptEvidence(duplicateMint), (error) => (
    error instanceof CanaryTeardownReceiptEvidenceError
      && error.code === "DUPLICATE_TRANSACTION"
  ));

  const duplicate = input();
  duplicate.transactions[4].hash = duplicate.transactions[3].hash;
  assert.throws(() => buildCanaryTeardownReceiptEvidence(duplicate), /transaction hash is reused/);

  const reordered = input();
  reordered.transactions[2].order = 8;
  assert.throws(() => buildCanaryTeardownReceiptEvidence(reordered), /order is not contiguous/);

  const unknown = input();
  unknown.transactions[0].calldata = "0xdeadbeef";
  assert.throws(() => buildCanaryTeardownReceiptEvidence(unknown), (error) => (
    error.code === "UNKNOWN_FIELD"
  ));

  const stale = structuredClone(buildCanaryTeardownReceiptEvidence(input()));
  stale.evidence.bindings.coreManifestSha256 = hash("f");
  assert.throws(() => validateCanaryTeardownReceiptEvidence(stale), (error) => (
    error.code === "EVIDENCE_HASH_MISMATCH"
  ));
});

test("rejects sparse/extended arrays, accessors, and Proxies without invoking getters", () => {
  const sparse = input();
  delete sparse.transactions[3];
  assert.throws(() => buildCanaryTeardownReceiptEvidence(sparse), /array hole/);

  const extended = input();
  extended.transactions.hidden = true;
  assert.throws(() => buildCanaryTeardownReceiptEvidence(extended), /extra array field/);

  let reads = 0;
  const accessor = input();
  Object.defineProperty(accessor.transactions[0], "id", {
    enumerable: true,
    get() { reads += 1; return IDS[0]; },
  });
  assert.throws(() => buildCanaryTeardownReceiptEvidence(accessor), (error) => (
    error.code === "ACCESSOR_REJECTED"
  ));
  assert.equal(reads, 0);

  const proxy = new Proxy(input(), {
    get() { reads += 1; throw new Error("must not execute"); },
  });
  assert.throws(() => buildCanaryTeardownReceiptEvidence(proxy), (error) => (
    error.code === "UNCLONEABLE_INPUT"
  ));
  assert.equal(reads, 0);
});

test("receipt-index module has no RPC, wallet, signer, submission, or file-write path", async () => {
  const source = await readFile(new URL(
    "../broker/src/recommendation/canary-teardown-receipt-evidence.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /createPublicClient|createWalletClient|privateKeyToAccount/);
  assert.doesNotMatch(source, /signTypedData|sendTransaction|writeContract|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /writeFile|appendFile|simulateContract/);
});

test("builder requires eight exact artifact paths and tracked example pins all eleven IDs", async () => {
  const args = [
    "--proposal-artifact", "/tmp/proposal.json",
    "--live-attestation", "/tmp/live.json",
    "--config-bundle", "/tmp/config.json",
    "--configuration-evidence", "/tmp/config-receipt.json",
    "--execution-artifact", "/tmp/execution.json",
    "--execution-evidence", "/tmp/execution-receipt.json",
    "--mint-attestation", "/tmp/mint.json",
    "--transactions", "/tmp/teardown.json",
  ];
  const parsed = parseCanaryTeardownReceiptArguments(args);
  assert.equal(Object.keys(parsed).length, 8);
  assert.throws(() => parseCanaryTeardownReceiptArguments(args.slice(0, -2)),
    /all eight exact artifact paths/);
  assert.throws(() => parseCanaryTeardownReceiptArguments([...args, "--unknown", "x.json"]),
    /all eight exact artifact paths/);

  const example = JSON.parse(await readFile(new URL(
    "../ops/canary-teardown-transactions.example.json",
    import.meta.url,
  ), "utf8"));
  assert.deepEqual(example.transactions.map(({ id }) => id), IDS);
  assert.deepEqual(example.transactions.map(({ order }) => order),
    [...Array(11)].map((_, index) => index + 1));
  assert.equal(new Set(example.transactions.map(({ hash: value }) => value)).size, 11);

  const source = await readFile(new URL(
    "../scripts/build-canary-teardown-receipt-evidence.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /createPublicClient|createWalletClient|privateKeyToAccount/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /writeFile|appendFile|simulateContract/);
});
