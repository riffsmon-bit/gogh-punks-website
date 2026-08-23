import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATED_SCREEN_SCHEMA,
  screenAutomatedSeaDropCandidate,
} from "../broker/src/discovery/automated-seadrop-screen.mjs";
import {
  COLLECTION_RUNTIME_CODE_HASH,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
} from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";

const now = 1_800_000_000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function fixture() {
  const candidate = {
    collection: A("5"), opportunityId: H("5"), reasoningHash: H("6"),
    contractRiskScore: 20, tasteMatch: 80, metadataSanitized: true, analysisComplete: true,
  };
  const observation = {
    chainId: 4663, checkedAt: iso(now - 2), blockNumber: "42000000",
    blockHash: H("a"), blockTimestamp: iso(now - 3), collection: candidate.collection,
    collectionCodeHash: COLLECTION_RUNTIME_CODE_HASH, collectionRuntimeLength: 45,
    seaDropCodeHash: SEA_DROP_CODE_HASH, explicitlyDenied: false,
    drop: {
      mintPriceWei: "0", startTime: String(now - 60), endTime: String(now + 60),
      maxTotalMintableByWallet: "3", restrictFeeRecipients: false,
    },
    mintStats: { minterNumMinted: "1", currentTotalMinted: "41", maxSupply: "100" },
    feeRecipientAllowed: false,
    simulation: {
      succeeded: true, target: SEA_DROP, valueWei: "0",
      selector: SEA_DROP_MINT_PUBLIC_SELECTOR, tokenId: "42", gasEstimate: "400000",
    },
  };
  const options = {
    nowSeconds: now, maximumEvidenceAgeSeconds: 30,
    primaryOrigin: "https://rpc.robinhood.example",
    secondaryOrigin: "https://rpc.independent.example",
  };
  return { candidate, primary: structuredClone(observation),
    secondary: structuredClone(observation), options };
}

test("emits a planner target only after exact dual-provider agreement", () => {
  const f = fixture();
  const result = screenAutomatedSeaDropCandidate(
    f.candidate,
    f.primary,
    f.secondary,
    f.options,
  );
  assert.equal(result.schema, AUTOMATED_SCREEN_SCHEMA);
  assert.equal(result.target.walletRemaining, "2");
  assert.equal(result.target.supplyRemaining, "59");
  assert.equal(result.target.nextTokenId, "42");
  assert.equal(result.target.feeRecipientAllowed, false);
  assert.equal(result.safety.humanTargetReviewRequired, false);
  assert.equal(result.safety.suppliedDualRpcEvidenceAgrees, true);
  assert.equal(result.safety.submissionPerformed, false);
  assert.equal(result.providers.transportProvenanceVerified, false);
  assert.equal(result.providers.providerIndependenceVerified, false);
  assert.match(result.evidenceHash, /^0x[0-9a-f]{64}$/);
});

test("accepts restricted fee recipients only when the pinned recipient is allowed", () => {
  const f = fixture();
  f.primary.drop.restrictFeeRecipients = true;
  f.secondary.drop.restrictFeeRecipients = true;
  assert.throws(() => screenAutomatedSeaDropCandidate(
    f.candidate, f.primary, f.secondary, f.options,
  ), { code: "FEE_RECIPIENT_REJECTED" });
  f.primary.feeRecipientAllowed = true;
  f.secondary.feeRecipientAllowed = true;
  assert.equal(screenAutomatedSeaDropCandidate(
    f.candidate, f.primary, f.secondary, f.options,
  ).target.feeRecipientAllowed, true);
});

test("rejects disagreement, same provider, stale blocks, payment, code drift, and exhaustion", () => {
  const mutations = [
    (f) => { f.secondary.mintStats.currentTotalMinted = "42"; },
    (f) => { f.options.secondaryOrigin = "https://other.robinhood.example"; },
    (f) => { f.primary.checkedAt = iso(now - 31); f.secondary.checkedAt = iso(now - 31); },
    (f) => { f.primary.drop.mintPriceWei = "1"; f.secondary.drop.mintPriceWei = "1"; },
    (f) => { f.primary.collectionCodeHash = H("f"); f.secondary.collectionCodeHash = H("f"); },
    (f) => { f.primary.mintStats.minterNumMinted = "3";
      f.secondary.mintStats.minterNumMinted = "3"; },
    (f) => { f.primary.simulation.valueWei = "1"; f.secondary.simulation.valueWei = "1"; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => screenAutomatedSeaDropCandidate(
      f.candidate, f.primary, f.secondary, f.options,
    ));
  }
});

test("rejects incomplete analysis and hostile object boundaries without invoking accessors", () => {
  const incomplete = fixture();
  incomplete.candidate.analysisComplete = false;
  assert.throws(() => screenAutomatedSeaDropCandidate(
    incomplete.candidate, incomplete.primary, incomplete.secondary, incomplete.options,
  ), { code: "ANALYSIS_INCOMPLETE" });

  let invoked = 0;
  const hostile = fixture();
  Object.defineProperty(hostile.primary.drop, "mintPriceWei", {
    enumerable: true, get() { invoked += 1; return "0"; },
  });
  assert.throws(() => screenAutomatedSeaDropCandidate(
    hostile.candidate, hostile.primary, hostile.secondary, hostile.options,
  ), { code: "INVALID_JSON" });
  assert.equal(invoked, 0);
});
