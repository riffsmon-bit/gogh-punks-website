import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATED_EXECUTION_BATCH_SCHEMA,
  buildAutomatedSeaDropExecutionBatch,
} from "../broker/src/recommendation/automated-seadrop-execution-batch.mjs";
import {
  AUTOMATED_LIVE_STATE_SCHEMA,
  AUTOMATED_PROFILE_SCHEMA,
  CLONE_IMPLEMENTATION,
  CLONE_IMPLEMENTATION_CODE_HASH,
  COLLECTION_RUNTIME_CODE_HASH,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
} from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";

const now = 1_800_000_000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function fixture() {
  const profile = {
    schema: AUTOMATED_PROFILE_SCHEMA,
    version: 1,
    chainId: 4663,
    punk: {
      tokenId: "4242", collection: ROBINHOOD.canonicalCollection,
      account: A("1"), expectedOwner: A("2"),
    },
    agent: A("3"),
    infrastructure: {
      adapter: A("4"), adapterCodeHash: H("4"), seaDrop: SEA_DROP,
      seaDropCodeHash: SEA_DROP_CODE_HASH, cloneImplementation: CLONE_IMPLEMENTATION,
      cloneImplementationCodeHash: CLONE_IMPLEMENTATION_CODE_HASH,
      collectionRuntimeCodeHash: COLLECTION_RUNTIME_CODE_HASH,
    },
    limits: {
      maxMintsPerUtcDay: 1, maxMintsPerRun: 1, maxGasPerMint: 600000,
      maxGasWeiPerRun: "1000000000000000", minAgentReserveWei: "1000000000000000",
      intentTtlSeconds: 120, maxEvidenceAgeSeconds: 30,
      maxContractRiskScore: 40, minimumTasteMatch: 60, stopOnFailure: true,
    },
  };
  const liveState = {
    schema: AUTOMATED_LIVE_STATE_SCHEMA, chainId: 4663, checkedAt: iso(now - 2),
    blockNumber: 42000000, blockHash: H("a"), blockTimestamp: iso(now - 3),
    owner: A("2"), account: A("1"), agent: A("3"), policyVersion: "11", nonce: "7",
    acquisitionsToday: 0, agentBalanceWei: "3000000000000000",
    maxFeePerGasWei: "1000000000", accountPaused: false, agentAuthorized: true,
    featureFlags: {
      scoutMode: true, approvalPurchases: false, autonomousPurchases: true,
      autonomousMints: true, unknownCollectionExecution: true, selling: false,
      autonomousSelling: false,
    },
    policy: {
      mode: "AUTONOMOUS", maxSpendPerTransaction: "0", maxSpendPerDay: "0",
      maxSpendPerWeek: "0", maxMintPrice: "0", maxSecondaryPurchasePrice: "0",
      minimumNativeReserve: "0", maxAcquisitionsPerDay: 1, maxIntentAge: 120,
      maxSlippageBps: 0, requireCollectionAllowlist: false, allowUnknownCollections: true,
      autonomousFreeMints: true, autonomousPaidMints: false,
    },
    permissions: {
      adapterActive: true, adapterAllowed: true, venueAllowed: true, selectorAllowed: true,
      currencyAllowed: true, venueCurrencyMaximumWei: "0",
    },
    targets: [{
      collection: A("5"), collectionCodeHash: COLLECTION_RUNTIME_CODE_HASH,
      collectionRuntimeLength: 45, explicitlyDenied: false, dropActive: true,
      mintPriceWei: "0", walletRemaining: "2", supplyRemaining: "100", nextTokenId: "42",
      restrictFeeRecipients: false, feeRecipientAllowed: false,
      contractRiskScore: 10, tasteMatch: 90, metadataSanitized: true,
      analysisComplete: true, simulationSucceeded: true, simulationTarget: SEA_DROP,
      simulationValueWei: "0", simulationSelector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      gasEstimate: "400000", opportunityId: H("5"), reasoningHash: H("6"),
    }],
  };
  return { profile, liveState };
}

test("encodes only the exact autonomous account entry point and typed zero-value intent", () => {
  const { profile, liveState } = fixture();
  const result = buildAutomatedSeaDropExecutionBatch(
    profile,
    liveState,
    { nowSeconds: now },
  );
  assert.equal(result.schema, AUTOMATED_EXECUTION_BATCH_SCHEMA);
  assert.equal(result.transactions.length, 1);
  const tx = result.transactions[0];
  assert.equal(tx.from, profile.agent);
  assert.equal(tx.to, profile.punk.account);
  assert.equal(tx.value, "0");
  assert.match(tx.dataKeccak256, /^0x[0-9a-f]{64}$/);
  assert.match(result.batchHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.safety.submissionPerformed, false);
  assert.equal(Object.hasOwn(tx, "signature"), false);
  assert.ok(Object.isFrozen(tx));
});

test("rebuilds from live evidence so mutations cannot be wrapped in executable calldata", () => {
  const mutations = [
    (f) => { f.liveState.targets[0].mintPriceWei = "1"; },
    (f) => { f.liveState.agentAuthorized = false; },
    (f) => { f.liveState.policy.autonomousPaidMints = true; },
    (f) => { f.profile.limits.maxMintsPerUtcDay = 0; },
  ];
  for (const mutate of mutations) {
    const current = fixture();
    mutate(current);
    assert.throws(() => buildAutomatedSeaDropExecutionBatch(
      current.profile,
      current.liveState,
      { nowSeconds: now },
    ));
  }
});
