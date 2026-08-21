import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ROBINHOOD } from "../src/config.mjs";
import {
  buildControlledFreeMintOwnerReview,
  ControlledFreeMintBridgeError,
} from "../src/recommendation/controlled-free-mint-bridge.mjs";
import { buildPerPunkMintDecisions } from "../src/scout/mint-decision.mjs";
import { canonicalJson } from "../src/scout/canonical-json.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const CANARY = "0x3333333333333333333333333333333333333333";
const ADAPTER = "0x4444444444444444444444444444444444444444";
const CODE_HASH = `0x${"55".repeat(32)}`;
const COLLECTION_CODE_HASH = `0x${"66".repeat(32)}`;

function sha(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function opportunity(overrides = {}) {
  return {
    id: "controlled-canary-free-mint-9001",
    chainId: 4663,
    opportunityType: "FREE_MINT",
    collection: CANARY,
    tokenId: "9001",
    expectedPrice: "0",
    maxPrice: "0",
    riskLabel: "LOWER_RISK",
    scores: {
      artScore: 90,
      artConfidence: 90,
      contractRiskScore: 10,
      contractRiskConfidence: 95,
      marketConfidence: 30,
    },
    metadata: {
      actionableMint: true,
      mintPriceStatus: "KNOWN",
      mintContract: CANARY,
      assetStandard: "ERC721",
      collectionSignals: { art: { dimensions: { pixelArt: 90 } } },
    },
    ...overrides,
  };
}

function decisionInput(mode = "APPROVAL_REQUIRED") {
  return {
    tokenId: "4242",
    account: ACCOUNT,
    expectedOwner: OWNER,
    personaKey: "PIXEL_MAXI",
    mandate: {
      tokenId: "4242",
      version: 3,
      mode,
      configuredBy: OWNER,
      economicSettings: { allowFreeMints: true, maxMintsPerDay: 1 },
      riskSettings: { maxContractRiskScore: 30 },
      artisticPreferences: { minimumTasteMatch: 0 },
      mintPermissions: {
        approvedMintContracts: [CANARY],
        approvedCollections: [CANARY],
      },
    },
    controls: {
      acquisitionsToday: 0,
      proposalSupported: true,
      targetInspectionValidated: true,
      ownerMandateCurrent: true,
      policySnapshotValidated: true,
    },
  };
}

function decisionProof(opportunityValue = opportunity(), mode = "APPROVAL_REQUIRED") {
  return buildPerPunkMintDecisions({
    opportunity: opportunityValue,
    punks: [decisionInput(mode)],
  });
}

function fixture() {
  const target = opportunity();
  const reviewedDecisionInput = decisionInput();
  const proof = buildPerPunkMintDecisions({ opportunity: target, punks: [reviewedDecisionInput] });
  const decision = proof.artifact.decisions[0];
  const binding = {
    schema: "GOGH_CONTROLLED_ONE_SHOT_CANARY_BINDING_V1",
    targetKind: "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter",
    chainId: 4663,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: "4242",
    punkAccount: ACCOUNT,
    expectedOwner: OWNER,
    opportunityId: target.id,
    opportunityHash: proof.artifact.opportunityHash,
    decisionHash: proof.decisionHash,
    recommendationId: decision.recommendationId,
    reasoningHash: decision.reasoningHash,
    policyVersion: "3",
    mandateHash: decision.mandateHash,
    controlsHash: decision.controlsHash,
    personaKey: reviewedDecisionInput.personaKey,
    decisionInputHash: sha(canonicalJson(reviewedDecisionInput)),
    adapter: ADAPTER,
    adapterCodeHash: CODE_HASH,
    venue: CANARY,
    collection: CANARY,
    collectionCodeHash: COLLECTION_CODE_HASH,
    mintSelector: "0x40c10f19",
    outputTokenId: "9001",
    assetStandard: "ERC721",
  };
  const proposalInput = {
    chainId: 4663,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: "4242",
    punkAccount: ACCOUNT,
    expectedOwner: OWNER,
    ownerReview: true,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter: ADAPTER,
    venue: CANARY,
    collection: CANARY,
    mintSelector: "0x40c10f19",
    tokenId: "9001",
    assetAmount: "1",
    currency: ZERO,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: "0",
    expiresAt: "1120",
    nonce: "7",
    policyVersion: "3",
    opportunityId: sha(target.id),
    reasoningHash: decision.reasoningHash,
    adapterCodeHash: CODE_HASH,
  };
  return { target, proof, decisionInput: reviewedDecisionInput, binding, proposalInput };
}

test("bridges one exact PROPOSE decision to owner review without authority or execution", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  const result = buildControlledFreeMintOwnerReview({
    decisionProof: proof,
    decisionInput: reviewedInput,
    opportunity: target,
    binding,
    proposalInput,
  }, { nowSeconds: 1_000 });
  assert.match(result.bridgeHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.bridge.decisionHash, proof.decisionHash);
  assert.equal(result.bridge.opportunityHash, proof.artifact.opportunityHash);
  assert.equal(result.bridge.liveDeploymentVerified, false);
  assert.equal(result.bridge.executionEnabled, false);
  assert.equal(result.bridge.autonomyEnabled, false);
  assert.equal(result.bridge.signingPerformed, false);
  assert.equal(result.bridge.submissionPerformed, false);
  assert.equal(result.proposal.proposal.authorization.executionEnabled, false);
  assert.equal(result.proposal.proposal.eip712.ownerApprovalObtained, false);
  assert.equal(result.proposal.proposal.intent.adapter, binding.adapter);
  assert.equal(result.proposal.proposal.humanReview.target.adapter, binding.adapter);
  assert.equal(result.proposal.proposal.intent.collection, binding.collection);
  assert.equal(result.proposal.proposal.intent.tokenId, binding.outputTokenId);
});

test("bridge rejects altered evidence even when the opportunity ID is reused", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: { ...target, collection: "0x7777777777777777777777777777777777777777" },
      binding,
      proposalInput,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "BINDING_MISMATCH",
  );
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: { ...target, riskLabel: "UNKNOWN" },
      binding,
      proposalInput,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "BINDING_MISMATCH",
  );
});

test("bridge binds exact Punk account, owner, mandate, usage, and recommendation", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  for (const [field, value] of [
    ["punkAccount", "0x7777777777777777777777777777777777777777"],
    ["expectedOwner", "0x8888888888888888888888888888888888888888"],
    ["mandateHash", `0x${"77".repeat(32)}`],
    ["controlsHash", `0x${"88".repeat(32)}`],
    ["recommendationId", "different-recommendation"],
  ]) {
    assert.throws(
      () => buildControlledFreeMintOwnerReview({
        decisionProof: proof,
        decisionInput: reviewedInput,
        opportunity: target,
        binding: { ...binding, [field]: value },
        proposalInput,
      }, { nowSeconds: 1_000 }),
      (error) => error instanceof ControlledFreeMintBridgeError && error.code === "BINDING_MISMATCH",
      field,
    );
  }
});

test("bridge rejects generic inspection, paid mint, non-PROPOSE, and proposal mismatches", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: target,
      binding: { ...binding, schema: "GOGH_FREE_MINT_TARGET_INSPECTION_V1" },
      proposalInput,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "UNSUPPORTED_TARGET",
  );
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: { ...target, opportunityType: "MINT", expectedPrice: "1", maxPrice: "1" },
      binding,
      proposalInput,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "PAID_PROPOSAL_UNSUPPORTED",
  );

  const scoutInput = decisionInput("SCOUT");
  const scoutProof = buildPerPunkMintDecisions({ opportunity: target, punks: [scoutInput] });
  const scoutDecision = scoutProof.artifact.decisions[0];
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: scoutProof,
      decisionInput: scoutInput,
      opportunity: target,
      binding: {
        ...binding,
        decisionHash: scoutProof.decisionHash,
        opportunityHash: scoutProof.artifact.opportunityHash,
        recommendationId: scoutDecision.recommendationId,
        reasoningHash: scoutDecision.reasoningHash,
        mandateHash: scoutDecision.mandateHash,
        controlsHash: scoutDecision.controlsHash,
        personaKey: scoutInput.personaKey,
        decisionInputHash: sha(canonicalJson(scoutInput)),
      },
      proposalInput: { ...proposalInput, reasoningHash: scoutDecision.reasoningHash },
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "OWNER_REVIEW_NOT_RECOMMENDED",
  );

  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: target,
      binding,
      proposalInput: { ...proposalInput, adapter: "0x9999999999999999999999999999999999999999" },
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "BINDING_MISMATCH",
  );
});

test("bridge rejects a self-consistent proof that claims any authority or side effect", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  const artifact = structuredClone(proof.artifact);
  artifact.security.signingPerformed = true;
  const decisionHash = sha(canonicalJson(artifact));
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: { ...proof, decisionHash, artifact },
      decisionInput: reviewedInput,
      opportunity: target,
      binding: { ...binding, decisionHash },
      proposalInput,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "UNSAFE_DECISION",
  );
});

test("bridge recomputation rejects a self-consistent IGNORE-to-PROPOSE artifact mutation", () => {
  const { target, binding, proposalInput } = fixture();
  const reviewedDisabledInput = decisionInput("DISABLED");
  const attackerInput = decisionInput("APPROVAL_REQUIRED");
  const attackerProof = buildPerPunkMintDecisions({ opportunity: target, punks: [attackerInput] });
  assert.equal(attackerProof.artifact.decisions[0].decision, "PROPOSE");
  const attackerDecision = attackerProof.artifact.decisions[0];
  const attackerBinding = {
    ...binding,
    decisionHash: attackerProof.decisionHash,
    recommendationId: attackerDecision.recommendationId,
    reasoningHash: attackerDecision.reasoningHash,
    policyVersion: String(attackerDecision.policyVersion),
    mandateHash: attackerDecision.mandateHash,
    controlsHash: attackerDecision.controlsHash,
    decisionInputHash: sha(canonicalJson(reviewedDisabledInput)),
  };
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: attackerProof,
      decisionInput: reviewedDisabledInput,
      opportunity: target,
      binding: attackerBinding,
      proposalInput: { ...proposalInput, reasoningHash: attackerDecision.reasoningHash },
    }, { nowSeconds: 1_000 }),
    (error) => (
      error instanceof ControlledFreeMintBridgeError
      && error.code === "DECISION_RECOMPUTATION_MISMATCH"
    ),
  );
});

test("bridge identity integers require canonical decimal strings", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  for (const field of ["punkTokenId", "policyVersion", "outputTokenId"]) {
    for (const value of [true, [], "", "0x1", "01", "+1", "1e2", 1]) {
      assert.throws(
        () => buildControlledFreeMintOwnerReview({
          decisionProof: proof,
          decisionInput: reviewedInput,
          opportunity: target,
          binding: { ...binding, [field]: value },
          proposalInput,
        }, { nowSeconds: 1_000 }),
        (error) => error instanceof ControlledFreeMintBridgeError && error.code === "INVALID_BINDING",
        `${field}:${String(value)}`,
      );
    }
  }
});

test("bridge rejects missing, wrong, or conflicting opportunity chain evidence", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  const missingChain = { ...target };
  delete missingChain.chainId;
  for (const candidate of [
    missingChain,
    { ...target, chainId: 1 },
    { ...target, chain_id: 1 },
  ]) {
    assert.throws(
      () => buildControlledFreeMintOwnerReview({
        decisionProof: proof,
        decisionInput: reviewedInput,
        opportunity: candidate,
        binding,
        proposalInput,
      }, { nowSeconds: 1_000 }),
      (error) => error instanceof ControlledFreeMintBridgeError && error.code === "INVALID_OPPORTUNITY",
    );
  }
});

test("bridge snapshots inputs once and never invokes a proposal getter", () => {
  const { target, proof, decisionInput: reviewedInput, binding, proposalInput } = fixture();
  let getterCalls = 0;
  const hostileProposal = { ...proposalInput };
  Object.defineProperty(hostileProposal, "adapter", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return getterCalls === 1
        ? binding.adapter
        : "0x9999999999999999999999999999999999999999";
    },
  });
  assert.throws(
    () => buildControlledFreeMintOwnerReview({
      decisionProof: proof,
      decisionInput: reviewedInput,
      opportunity: target,
      binding,
      proposalInput: hostileProposal,
    }, { nowSeconds: 1_000 }),
    (error) => error instanceof ControlledFreeMintBridgeError && error.code === "INVALID_INPUT",
  );
  assert.equal(getterCalls, 0);
});
