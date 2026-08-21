import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeFunctionData, keccak256 } from "viem";
import {
  buildCanaryExecutionReceiptEvidence,
  CANARY_EXECUTION_RECEIPT_EVIDENCE_SCHEMA,
  canonicalExecutionReceiptEvidenceSha256,
  validateCanaryExecutionArtifactEnvelope,
  validateCanaryExecutionReceiptEvidence,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import { OWNER_DIRECT_ACQUISITION_ABI } from
  "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  buildExecutionReceiptEvidenceFromFiles,
  parseExecutionReceiptEvidenceArguments,
} from "../scripts/build-canary-execution-receipt-evidence.mjs";
import {
  buildCanaryMintArtifactFixtures,
  fixtureAddress,
  fixtureHash,
  MINT_TX_HASH,
} from "./helpers/canary-mint-fixtures.mjs";

test("builds and validates one non-authorizing exact execution receipt index", () => {
  const fixtures = buildCanaryMintArtifactFixtures();
  const artifact = buildCanaryExecutionReceiptEvidence({
    executionArtifact: fixtures.executionArtifact,
    transactionHash: MINT_TX_HASH,
  });
  assert.equal(artifact.evidence.schema, CANARY_EXECUTION_RECEIPT_EVIDENCE_SCHEMA);
  assert.equal(artifact.evidence.transaction.hash, MINT_TX_HASH);
  assert.equal(artifact.evidence.transaction.from, fixtures.executionArtifact.transaction.from);
  assert.equal(artifact.evidence.transaction.to, fixtures.executionArtifact.transaction.to);
  assert.equal(artifact.evidence.transaction.value, "0");
  assert.equal(artifact.evidenceSha256,
    canonicalExecutionReceiptEvidenceSha256(artifact.evidence));
  assert.equal(artifact.transactionAuthorized, false);
  assert.deepEqual(validateCanaryExecutionReceiptEvidence(
    artifact,
    fixtures.executionArtifact,
  ), artifact);
});

test("accepts the genuine string-encoded intent chain, policy, and slippage fields", () => {
  const artifact = buildCanaryMintArtifactFixtures().executionArtifact;
  const validated = validateCanaryExecutionArtifactEnvelope(artifact);
  assert.equal(artifact.reviewedAcquisition.intent.chainId, "4663");
  assert.equal(artifact.reviewedAcquisition.intent.policyVersion, "11");
  assert.equal(artifact.reviewedAcquisition.intent.maxSlippageBps, "0");
  assert.equal(validated.to, artifact.transaction.to);
});

test("decodes all reviewed calldata fields and rejects a self-hashed arbitrary target", () => {
  const artifact = buildCanaryMintArtifactFixtures().executionArtifact;
  const decodedIntent = {
    ...artifact.reviewedAcquisition.intent,
    chainId: 4663n,
    nonce: 0n,
    policyVersion: 11n,
    opportunityType: 2,
    assetStandard: 0,
    tokenId: BigInt(artifact.reviewedAcquisition.intent.tokenId),
    assetAmount: 1n,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt: BigInt(artifact.reviewedAcquisition.intent.createdAt),
    expiresAt: BigInt(artifact.reviewedAcquisition.intent.expiresAt),
    collection: fixtureAddress("f"),
  };
  delete decodedIntent.opportunityTypeValue;
  delete decodedIntent.assetStandardValue;
  delete decodedIntent.adapterDataHash;
  const forged = structuredClone(artifact);
  forged.transaction.data = encodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    functionName: "executeApprovedAcquisition",
    args: [decodedIntent, "0x", "0x"],
  }).toLowerCase();
  forged.transaction.dataKeccak256 = keccak256(forged.transaction.data);
  assert.throws(() => validateCanaryExecutionArtifactEnvelope(forged),
    (error) => error.code === "CALLDATA_MISMATCH");
});

test("rejects nonempty adapter data or owner signature even with reviewed fields", () => {
  for (const field of ["adapterData", "ownerSignature"]) {
    const artifact = buildCanaryMintArtifactFixtures().executionArtifact;
    artifact.reviewedAcquisition[field] = "0x12";
    assert.throws(() => validateCanaryExecutionArtifactEnvelope(artifact),
      (error) => error.code === "INVALID_EXECUTION_PATH");
  }
});

test("rejects stale/malformed reviewed timing and pinned/latest evidence", () => {
  const mutations = [
    (artifact) => { artifact.reviewedAcquisition.timing.remainingSeconds = "49"; },
    (artifact) => { artifact.confirmedEvidence.pinnedBlock.confirmations = 1; },
    (artifact) => { artifact.confirmedEvidence.latestExecutionCheck.ownerType = "AGENT"; },
  ];
  for (const mutate of mutations) {
    const artifact = buildCanaryMintArtifactFixtures().executionArtifact;
    mutate(artifact);
    assert.throws(() => validateCanaryExecutionArtifactEnvelope(artifact));
  }
});

test("validates complete source-adoption bodies rather than trusting copied hashes", () => {
  const artifact = buildCanaryMintArtifactFixtures().executionArtifact;
  artifact.confirmedEvidence.sourceVerification.coreAdoption.verifiedContracts.reverse();
  assert.throws(() => validateCanaryExecutionArtifactEnvelope(artifact),
    (error) => /SOURCE_VERIFICATION|INVALID_SOURCE/.test(error.code));
});

test("rejects zero, uppercase, malformed, and replayed-looking transaction hashes", () => {
  const executionArtifact = buildCanaryMintArtifactFixtures().executionArtifact;
  for (const transactionHash of [
    `0x${"0".repeat(64)}`, fixtureHash("A"), "0x12", null,
  ]) {
    assert.throws(() => buildCanaryExecutionReceiptEvidence({
      executionArtifact,
      transactionHash,
    }));
  }
});

test("receipt index tampering fails deterministic rebuild and artifact hash binding", () => {
  const fixtures = buildCanaryMintArtifactFixtures();
  for (const mutate of [
    (artifact) => { artifact.evidence.acquisition.price = "1"; },
    (artifact) => { artifact.evidence.transaction.from = fixtureAddress("f"); },
    (artifact) => { artifact.evidenceSha256 = fixtureHash("f"); },
    (artifact) => { artifact.transactionAuthorized = true; },
  ]) {
    const artifact = structuredClone(fixtures.executionReceiptEvidence);
    mutate(artifact);
    assert.throws(() => validateCanaryExecutionReceiptEvidence(
      artifact,
      fixtures.executionArtifact,
    ));
  }
});

test("strict snapshots reject unknown fields, accessors, symbols, and custom prototypes", () => {
  const fixtures = buildCanaryMintArtifactFixtures();
  const values = [
    () => { const input = { executionArtifact: fixtures.executionArtifact,
      transactionHash: MINT_TX_HASH, data: "0x" }; return input; },
    () => { const input = { executionArtifact: fixtures.executionArtifact,
      transactionHash: MINT_TX_HASH }; Object.defineProperty(input, "transactionHash",
      { enumerable: true, get() { throw new Error("never"); } }); return input; },
    () => { const input = { executionArtifact: fixtures.executionArtifact,
      transactionHash: MINT_TX_HASH }; input[Symbol("hidden")] = true; return input; },
    () => { const input = { executionArtifact: fixtures.executionArtifact,
      transactionHash: MINT_TX_HASH }; Object.setPrototypeOf(input, { poisoned: true }); return input; },
  ];
  for (const value of values) assert.throws(() => buildCanaryExecutionReceiptEvidence(value()));
});

test("receipt evidence CLI accepts only two exact JSON paths", () => {
  assert.deepEqual(parseExecutionReceiptEvidenceArguments([
    "--execution-artifact", "ops/execution.json",
    "--transaction", "ops/transaction.json",
  ]), {
    "--execution-artifact": new URL("../ops/execution.json", import.meta.url).pathname,
    "--transaction": new URL("../ops/transaction.json", import.meta.url).pathname,
  });
  for (const argv of [
    [],
    ["--execution-artifact", "x.json"],
    ["--execution-artifact", "*.json", "--transaction", "t.json"],
    ["--execution-artifact", "x.json", "--transaction", "t.json", "--private-key", "secret"],
  ]) assert.throws(() => parseExecutionReceiptEvidenceArguments(argv));
});

test("receipt evidence CLI reads regular files with O_NOFOLLOW and emits the exact index", async () => {
  const fixtures = buildCanaryMintArtifactFixtures();
  const directory = await mkdtemp(join(tmpdir(), "gogh-execution-receipt-"));
  const executionPath = join(directory, "execution.json");
  const transactionPath = join(directory, "transaction.json");
  await writeFile(executionPath, JSON.stringify(fixtures.executionArtifact));
  await writeFile(transactionPath, JSON.stringify({ transactionHash: MINT_TX_HASH }));
  const result = await buildExecutionReceiptEvidenceFromFiles([
    "--execution-artifact", executionPath,
    "--transaction", transactionPath,
  ]);
  assert.equal(result.evidence.transaction.hash, MINT_TX_HASH);

  const link = join(directory, "execution-link.json");
  await symlink(executionPath, link);
  await assert.rejects(buildExecutionReceiptEvidenceFromFiles([
    "--execution-artifact", link,
    "--transaction", transactionPath,
  ]), (error) => error.code === "FILE_READ_FAILED");
});

test("receipt-index source has no RPC, wallet, signer, send, deploy, or file-write path", async () => {
  const source = (await Promise.all([
    readFile(new URL("../broker/src/recommendation/canary-execution-receipt-evidence.mjs",
      import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-canary-execution-receipt-evidence.mjs",
      import.meta.url), "utf8"),
  ])).join("\n");
  assert.doesNotMatch(source, /createPublicClient|createWalletClient|privateKeyToAccount/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|deployContract|signTypedData/);
  assert.doesNotMatch(source, /writeFile|appendFile/);
  assert.match(source, /O_NOFOLLOW/);
});
