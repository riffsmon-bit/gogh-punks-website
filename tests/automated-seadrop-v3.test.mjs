import assert from "node:assert/strict";
import test from "node:test";

import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  AUTOMATED_V3_SCREEN_SCHEMA,
  screenAutomatedSeaDropV3Candidate,
} from "../broker/src/discovery/automated-seadrop-v3-screen.mjs";
import {
  AUTOMATED_LIVE_STATE_SCHEMA,
  AUTOMATED_PROFILE_SCHEMA,
  CLONE_COLLECTION_RUNTIME_CODE_HASH,
  CLONE_IMPLEMENTATION,
  CLONE_IMPLEMENTATION_CODE_HASH,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
  STUDIO_COLLECTION_RUNTIME_CODE_HASH,
  buildAutomatedSeaDropV3RunPlan,
} from "../broker/src/recommendation/automated-seadrop-v3-run-plan.mjs";
import {
  AUTOMATED_EXECUTION_BATCH_SCHEMA,
  buildAutomatedSeaDropV3ExecutionBatch,
} from "../broker/src/recommendation/automated-seadrop-v3-execution-batch.mjs";
import {
  AUTOMATED_OWNER_SETUP_INPUT_SCHEMA,
  buildAutomatedSeaDropV3OwnerSetup,
} from "../broker/src/recommendation/automated-seadrop-v3-owner-setup.mjs";
import {
  OWNER_PAID_EXECUTION_SCHEMA,
  buildOwnerPaidSeaDropV3Execution,
} from "../broker/src/recommendation/owner-paid-seadrop-v3-execution.mjs";

const now = 1_800_000_000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function profile() {
  return {
    schema: AUTOMATED_PROFILE_SCHEMA,
    version: 1,
    chainId: ROBINHOOD.chainId,
    punk: {
      tokenId: "4242",
      collection: ROBINHOOD.canonicalCollection,
      account: A("1"),
      expectedOwner: A("2"),
    },
    agent: A("3"),
    infrastructure: {
      adapter: A("4"),
      adapterCodeHash: H("4"),
      seaDrop: SEA_DROP,
      seaDropCodeHash: SEA_DROP_CODE_HASH,
      cloneImplementation: CLONE_IMPLEMENTATION,
      cloneImplementationCodeHash: CLONE_IMPLEMENTATION_CODE_HASH,
      cloneCollectionRuntimeCodeHash: CLONE_COLLECTION_RUNTIME_CODE_HASH,
      studioCollectionRuntimeCodeHash: STUDIO_COLLECTION_RUNTIME_CODE_HASH,
    },
    limits: {
      maxMintsPerUtcDay: 3,
      maxMintsPerRun: 3,
      maxGasPerMint: 600_000,
      maxGasWeiPerRun: "1200000000000000",
      minAgentReserveWei: "1000000000000000",
      intentTtlSeconds: 120,
      maxEvidenceAgeSeconds: 30,
      maxContractRiskScore: 40,
      minimumTasteMatch: 60,
      stopOnFailure: true,
    },
  };
}

function target(collectionCodeHash, collectionRuntimeLength, digit = "5") {
  return {
    collection: A(digit),
    collectionCodeHash,
    collectionRuntimeLength,
    explicitlyDenied: false,
    dropActive: true,
    mintPriceWei: "0",
    walletRemaining: "2",
    supplyRemaining: "100",
    nextTokenId: "42",
    restrictFeeRecipients: false,
    feeRecipientAllowed: false,
    contractRiskScore: 100,
    tasteMatch: 0,
    metadataSanitized: true,
    analysisComplete: true,
    simulationSucceeded: true,
    simulationTarget: SEA_DROP,
    simulationValueWei: "0",
    simulationSelector: SEA_DROP_MINT_PUBLIC_SELECTOR,
    gasEstimate: "400000",
    opportunityId: H(digit),
    reasoningHash: H("6"),
  };
}

function liveState(runtimeHash = STUDIO_COLLECTION_RUNTIME_CODE_HASH, runtimeLength = 19_658) {
  const configured = profile();
  return {
    schema: AUTOMATED_LIVE_STATE_SCHEMA,
    chainId: ROBINHOOD.chainId,
    checkedAt: iso(now - 2),
    blockNumber: 42_000_000,
    blockHash: H("a"),
    blockTimestamp: iso(now - 3),
    owner: configured.punk.expectedOwner,
    account: configured.punk.account,
    agent: configured.agent,
    policyVersion: "11",
    nonce: "7",
    acquisitionsToday: 0,
    agentBalanceWei: "3000000000000000",
    maxFeePerGasWei: "1000000000",
    accountPaused: false,
    agentAuthorized: true,
    featureFlags: {
      scoutMode: true,
      approvalPurchases: false,
      autonomousPurchases: true,
      autonomousMints: true,
      unknownCollectionExecution: true,
      selling: false,
      autonomousSelling: false,
    },
    policy: {
      mode: "AUTONOMOUS",
      maxSpendPerTransaction: "0",
      maxSpendPerDay: "0",
      maxSpendPerWeek: "0",
      maxMintPrice: "0",
      maxSecondaryPurchasePrice: "0",
      minimumNativeReserve: "0",
      maxAcquisitionsPerDay: 3,
      maxIntentAge: 120,
      maxSlippageBps: 0,
      requireCollectionAllowlist: false,
      allowUnknownCollections: true,
      autonomousFreeMints: true,
      autonomousPaidMints: false,
    },
    permissions: {
      adapterActive: true,
      adapterAllowed: true,
      venueAllowed: true,
      selectorAllowed: true,
      currencyAllowed: true,
      venueCurrencyMaximumWei: "0",
    },
    targets: [target(runtimeHash, runtimeLength)],
  };
}

function observation(runtimeHash, runtimeLength) {
  return {
    chainId: 4663,
    checkedAt: iso(now - 2),
    blockNumber: "42000000",
    blockHash: H("a"),
    blockTimestamp: iso(now - 3),
    collection: A("5"),
    collectionCodeHash: runtimeHash,
    collectionRuntimeLength: runtimeLength,
    seaDropCodeHash: SEA_DROP_CODE_HASH,
    explicitlyDenied: false,
    drop: {
      mintPriceWei: "0",
      startTime: String(now - 60),
      endTime: String(now + 60),
      maxTotalMintableByWallet: "3",
      restrictFeeRecipients: false,
    },
    mintStats: { minterNumMinted: "1", currentTotalMinted: "41", maxSupply: "100" },
    feeRecipientAllowed: false,
    simulation: {
      succeeded: true,
      target: SEA_DROP,
      valueWei: "0",
      selector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      tokenId: "42",
      gasEstimate: "400000",
    },
  };
}

const candidate = {
  collection: A("5"),
  opportunityId: H("5"),
  reasoningHash: H("6"),
  contractRiskScore: 100,
  tasteMatch: 0,
  metadataSanitized: true,
  analysisComplete: true,
};
const screenOptions = {
  nowSeconds: now,
  maximumEvidenceAgeSeconds: 30,
  primaryOrigin: "https://rpc.robinhood.example",
  secondaryOrigin: "https://rpc.independent.example",
};

test("V3 screens both reviewed OpenSea Studio runtime families without conflating them", () => {
  for (const [runtimeHash, runtimeLength, family] of [
    [CLONE_COLLECTION_RUNTIME_CODE_HASH, 45, "ERC721_CLONE"],
    [STUDIO_COLLECTION_RUNTIME_CODE_HASH, 19_658, "ERC721_STANDARD"],
  ]) {
    const primary = observation(runtimeHash, runtimeLength);
    const result = screenAutomatedSeaDropV3Candidate(
      candidate,
      primary,
      structuredClone(primary),
      screenOptions,
    );
    assert.equal(result.schema, AUTOMATED_V3_SCREEN_SCHEMA);
    assert.equal(result.target.collectionCodeHash, runtimeHash);
    assert.equal(result.target.collectionRuntimeLength, runtimeLength);
    assert.equal(result.safety.reviewedCollectionRuntime, family);
    assert.equal(result.safety.humanTargetReviewRequired, false);
  }
});

test("V3 planner and execution batch preserve the exact standard-runtime evidence", () => {
  const configured = profile();
  const live = liveState();
  const plan = buildAutomatedSeaDropV3RunPlan(configured, live, { nowSeconds: now });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].automatedEligibility.reviewedCollectionRuntime, "ERC721_STANDARD");
  assert.equal(plan.actions[0].expectedPrice, "0");
  assert.equal(plan.actions[0].adapterData, "0x");
  const batch = buildAutomatedSeaDropV3ExecutionBatch(configured, live, { nowSeconds: now });
  assert.equal(batch.schema, AUTOMATED_EXECUTION_BATCH_SCHEMA);
  assert.equal(batch.transactions[0].value, "0");
  assert.match(batch.transactions[0].dataKeccak256, /^0x[0-9a-f]{64}$/);
  assert.equal(batch.safety.paidMintsAllowed, false);
});

test("V3 owner-paid execution is one exact free-mint account call without approvals", () => {
  const configured = profile();
  configured.limits.minAgentReserveWei = "999999999999999999999999";
  configured.limits.maxGasWeiPerRun = "700000000000000";
  const live = liveState();
  live.agentBalanceWei = "0";
  const execution = buildOwnerPaidSeaDropV3Execution(configured, live, { nowSeconds: now });
  assert.equal(execution.schema, OWNER_PAID_EXECUTION_SCHEMA);
  assert.equal(execution.transaction.from, configured.punk.expectedOwner);
  assert.equal(execution.transaction.to, configured.punk.account);
  assert.equal(execution.transaction.value, "0");
  assert.match(execution.transaction.data, /^0x4402cb61[0-9a-f]+$/);
  assert.equal(execution.safety.recipient, configured.punk.account);
  assert.equal(execution.safety.mintPriceWei, "0");
  assert.equal(execution.safety.approvalsAllowed, false);
  assert.equal(execution.safety.arbitraryCalldataAllowed, false);
  assert.equal(execution.safety.submissionPerformed, false);
});

test("V3 rejects unreviewed runtime hashes and wrong runtime lengths", () => {
  for (const [runtimeHash, runtimeLength] of [
    [H("f"), 19_658],
    [STUDIO_COLLECTION_RUNTIME_CODE_HASH, 45],
    [CLONE_COLLECTION_RUNTIME_CODE_HASH, 19_658],
  ]) {
    const primary = observation(runtimeHash, runtimeLength);
    assert.throws(() => screenAutomatedSeaDropV3Candidate(
      candidate,
      primary,
      structuredClone(primary),
      screenOptions,
    ), { code: "CODE_MISMATCH" });
  }
});

test("V3 owner setup remains bounded, owner-driven, and non-authorizing", () => {
  const input = {
    schema: AUTOMATED_OWNER_SETUP_INPUT_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt: iso(now - 2),
    punk: {
      tokenId: "4242",
      collection: ROBINHOOD.canonicalCollection,
      expectedOwner: A("1"),
      account: A("2"),
      accountCreated: false,
    },
    infrastructure: {
      accountRegistry: A("3"),
      policyModule: A("4"),
      agentRegistry: A("5"),
      agent: A("6"),
    },
    limits: { maxMintsPerUtcDay: 3, authorizationDays: 7 },
    globalAgent: {
      approved: true,
      validAfter: String(now - 60),
      validUntil: String(now + (31 * 86_400)),
    },
  };
  const artifact = buildAutomatedSeaDropV3OwnerSetup(input, { nowSeconds: now });
  assert.deepEqual(artifact.setupTransactions.map(({ purpose }) => purpose), [
    "ACTIVATE_V3_PUNK_ACCOUNT",
    "CONFIGURE_ZERO_SPEND_AUTONOMOUS_POLICY",
    "AUTHORIZE_PUBLISHED_AGENT",
  ]);
  assert.equal(artifact.safety.paidMintsAllowed, false);
  assert.equal(artifact.safety.submissionPerformed, false);
});
