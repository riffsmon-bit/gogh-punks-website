import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import {
  canonicalConfigurationEvidenceSha256,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import {
  canonicalExecutionReceiptEvidenceSha256,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import {
  buildCanaryTeardownReceiptEvidence,
} from "../broker/src/recommendation/canary-teardown-receipt-evidence.mjs";
import {
  canonicalSha256,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";
import {
  bindCanaryTeardownArtifacts,
  CanaryTeardownArtifactBindingError,
} from "../scripts/canary-teardown-artifact-binding.mjs";
import { canonicalCanaryMintAttestationSha256 } from
  "../scripts/canary-mint-receipt-attestation.mjs";
import { attestCanaryMintFixture, createCanaryMintWorld } from
  "./helpers/canary-mint-attestation-world.mjs";
import { fixtureHash } from "./helpers/canary-mint-fixtures.mjs";

const CORE_NAMES = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_NAMES = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);

function teardownBindings(fixtures, mint) {
  const coreAdoption = requireVerifiedManifestAdoption(fixtures.coreManifest, CORE_NAMES);
  const canaryAdoption = requireVerifiedManifestAdoption(fixtures.canaryManifest, CANARY_NAMES);
  return {
    coreManifestSha256: canonicalSha256(fixtures.coreManifest),
    canaryManifestSha256: canonicalSha256(fixtures.canaryManifest),
    coreSourceVerificationAdoptionSha256: sourceVerificationCanonicalSha256(coreAdoption),
    canarySourceVerificationAdoptionSha256: sourceVerificationCanonicalSha256(canaryAdoption),
    configBundleReviewHash: fixtures.configBundleArtifact.bundleHash,
    configBundleArtifactSha256: canonicalSha256(fixtures.configBundleArtifact),
    configurationReceiptEvidenceHash: fixtures.configurationEvidenceArtifact.evidenceHash,
    configurationReceiptEvidenceArtifactSha256:
      canonicalConfigurationEvidenceSha256(fixtures.configurationEvidenceArtifact),
    executionReceiptEvidenceHash: fixtures.executionReceiptEvidence.evidenceSha256,
    executionReceiptEvidenceArtifactSha256:
      canonicalExecutionReceiptEvidenceSha256(fixtures.executionReceiptEvidence),
    mintReceiptAttestationArtifactSha256: canonicalCanaryMintAttestationSha256(mint),
  };
}

function teardownArtifact(fixtures, mint) {
  const calls = fixtures.configBundleArtifact.review.teardownPlan.orderedCalls;
  return buildCanaryTeardownReceiptEvidence({
    bindings: teardownBindings(fixtures, mint),
    mintReceipt: {
      transactionHash: mint.transaction.hash,
      blockNumber: Number(mint.receipt.blockNumber),
      blockHash: mint.receipt.blockHash,
      transactionIndex: Number(mint.receipt.transactionIndex),
    },
    transactions: calls.map((call, index) => ({
      id: call.id,
      order: call.order,
      hash: fixtureHash("12345678abc"[index]),
    })),
  });
}

async function inputFixture() {
  const world = createCanaryMintWorld();
  const mint = await attestCanaryMintFixture(world);
  const fixtures = world.fixtures;
  return structuredClone({
    proposalArtifact: fixtures.proposalArtifact,
    liveAttestation: fixtures.liveAttestation,
    coreManifest: fixtures.coreManifest,
    canaryManifest: fixtures.canaryManifest,
    configBundleArtifact: fixtures.configBundleArtifact,
    configurationEvidenceArtifact: fixtures.configurationEvidenceArtifact,
    executionArtifact: fixtures.executionArtifact,
    executionReceiptEvidenceArtifact: fixtures.executionReceiptEvidence,
    mintReceiptAttestationArtifact: mint,
    teardownReceiptEvidenceArtifact: teardownArtifact(fixtures, mint),
  });
}

function rebindMutatedMint(input) {
  input.teardownReceiptEvidenceArtifact = teardownArtifact({
    coreManifest: input.coreManifest,
    canaryManifest: input.canaryManifest,
    configBundleArtifact: input.configBundleArtifact,
    configurationEvidenceArtifact: input.configurationEvidenceArtifact,
    executionReceiptEvidence: input.executionReceiptEvidenceArtifact,
  }, input.mintReceiptAttestationArtifact);
}

test("binds the exact semantically validated mint, teardown plan, and full provenance chain", async () => {
  const input = await inputFixture();
  const context = bindCanaryTeardownArtifacts(input);
  assert.equal(context.teardownPlan.length, 11);
  assert.equal(context.teardownEvidence.length, 11);
  assert.equal(context.mintTransaction.data, input.executionArtifact.transaction.data);
  assert.equal(context.mintReceipt.blockHash,
    input.mintReceiptAttestationArtifact.receipt.blockHash);
  assert.equal(context.evidenceHashes.configBundleReviewKeccak256,
    input.configBundleArtifact.bundleHash);
  assert.equal(context.scope.account,
    input.executionReceiptEvidenceArtifact.evidence.acquisition.account);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.teardownPlan));
  assert.ok(Object.isFrozen(context.contracts.policyModule));
});

test("rejects self-rehashed false mint calldata, hash claims, parent linkage, and event summaries", async (t) => {
  const cases = [
    ["calldata", (mint) => {
      mint.transaction.data = "0x1234";
      mint.transaction.dataKeccak256 = keccak256(mint.transaction.data);
    }],
    ["proposal hash", (mint) => { mint.evidenceHashes.proposalSha256 = fixtureHash("f"); }],
    ["parent block", (mint) => { mint.receipt.parentBlockHash = fixtureHash("f"); }],
    ["event summary", (mint) => { mint.events.AcquisitionExecuted.price = "1"; }],
    ["runtime summary", (mint) => {
      mint.confirmedState.runtime.PunkAccount.runtimeCodeHash = fixtureHash("f");
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const input = await inputFixture();
      mutate(input.mintReceiptAttestationArtifact);
      rebindMutatedMint(input);
      assert.throws(() => bindCanaryTeardownArtifacts(input), (error) => (
        error instanceof CanaryTeardownArtifactBindingError
      ));
    });
  }
});

test("rejects teardown substitutions and hostile prototypes/accessors/Proxies", async () => {
  const substituted = await inputFixture();
  const evidence = substituted.teardownReceiptEvidenceArtifact.evidence;
  evidence.transactions[3].id = "TEARDOWN_OWNER_99_SUBSTITUTED";
  evidence.transactions[3].order = 4;
  // Rebuilding is deliberately unnecessary: the receipt-evidence hash validator must fail first.
  assert.throws(() => bindCanaryTeardownArtifacts(substituted), CanaryTeardownArtifactBindingError);

  let reads = 0;
  const accessor = await inputFixture();
  Object.defineProperty(accessor, "proposalArtifact", {
    enumerable: true,
    get() { reads += 1; throw new Error("must not execute"); },
  });
  assert.throws(() => bindCanaryTeardownArtifacts(accessor), (error) => (
    error.code === "ACCESSOR_REJECTED"
  ));
  assert.equal(reads, 0);

  const proxied = new Proxy(await inputFixture(), {});
  assert.throws(() => bindCanaryTeardownArtifacts(proxied), (error) => (
    error.code === "UNCLONEABLE_INPUT"
  ));
});
