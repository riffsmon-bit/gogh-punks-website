import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATED_LIVE_STATE_SCHEMA,
  AUTOMATED_PROFILE_SCHEMA,
  CLONE_IMPLEMENTATION,
  CLONE_IMPLEMENTATION_CODE_HASH,
  COLLECTION_RUNTIME_CODE_HASH,
  NATIVE_CURRENCY,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
  buildAutomatedSeaDropRunPlan,
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
      collectionRuntimeCodeHash: COLLECTION_RUNTIME_CODE_HASH,
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
  const target = (digit, tasteMatch, risk) => ({
    collection: A(digit),
    collectionCodeHash: COLLECTION_RUNTIME_CODE_HASH,
    collectionRuntimeLength: 45,
    explicitlyDenied: false,
    dropActive: true,
    mintPriceWei: "0",
    walletRemaining: "2",
    supplyRemaining: "100",
    nextTokenId: String(40 + Number(digit)),
    restrictFeeRecipients: false,
    feeRecipientAllowed: false,
    contractRiskScore: risk,
    tasteMatch,
    metadataSanitized: true,
    analysisComplete: true,
    simulationSucceeded: true,
    simulationTarget: SEA_DROP,
    simulationValueWei: "0",
    simulationSelector: SEA_DROP_MINT_PUBLIC_SELECTOR,
    gasEstimate: "400000",
    opportunityId: H(digit),
    reasoningHash: H(String(9 - Number(digit))),
  });
  const liveState = {
    schema: AUTOMATED_LIVE_STATE_SCHEMA,
    chainId: ROBINHOOD.chainId,
    checkedAt: iso(now - 2),
    blockNumber: 42_000_000,
    blockHash: H("a"),
    blockTimestamp: iso(now - 3),
    owner: profile.punk.expectedOwner,
    account: profile.punk.account,
    agent: profile.agent,
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
    targets: [target("5", 90, 10), target("6", 70, 20), target("7", 50, 10)],
  };
  return { profile, liveState };
}

test("does not let off-chain taste or risk suppress an exact live zero-price target", () => {
  const { profile, liveState } = fixture();
  const plan = buildAutomatedSeaDropRunPlan(profile, liveState, { nowSeconds: now });
  assert.equal(plan.actions.length, 3);
  assert.deepEqual(plan.actions.map((action) => action.collection), [A("5"), A("6"), A("7")]);
  assert.deepEqual(plan.actions.map((action) => action.nonce), ["7", "8", "9"]);
  assert.ok(plan.actions.every((action) => action.expectedPrice === "0"
    && action.maxPrice === "0" && action.adapterData === "0x"));
  assert.equal(plan.safety.targetHumanReviewRequired, false);
  assert.equal(plan.safety.executionAuthorizedByThisArtifact, false);
  assert.match(plan.planHash, /^0x[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(plan.actions[0]));
});

test("enforces daily and run gas caps without trusting Punk Account funds", () => {
  const { profile, liveState } = fixture();
  profile.limits.maxMintsPerRun = 2;
  profile.limits.maxGasWeiPerRun = "400000000000000";
  liveState.acquisitionsToday = 1;
  const plan = buildAutomatedSeaDropRunPlan(profile, liveState, { nowSeconds: now });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.limits.plannedMaximumGasCostWei, "400000000000000");
  liveState.acquisitionsToday = 3;
  assert.throws(
    () => buildAutomatedSeaDropRunPlan(profile, liveState, { nowSeconds: now }),
    { code: "DAILY_CAP_REACHED" },
  );
});

test("rejects any paid, arbitrary, noncanonical, denied, or unsimulated target", () => {
  const mutations = [
    (f) => { f.liveState.targets[0].mintPriceWei = "1"; },
    (f) => { f.liveState.targets[0].simulationValueWei = "1"; },
    (f) => { f.liveState.targets[0].simulationSelector = "0x095ea7b3"; },
    (f) => { f.liveState.targets[0].collectionCodeHash = H("f"); },
    (f) => { f.liveState.targets[0].collectionRuntimeLength = 46; },
    (f) => { f.liveState.targets[0].explicitlyDenied = true; },
    (f) => { f.liveState.targets[0].simulationSucceeded = false; },
    (f) => {
      f.liveState.targets[0].restrictFeeRecipients = true;
      f.liveState.targets[0].feeRecipientAllowed = false;
    },
  ];
  for (const mutate of mutations) {
    const current = fixture();
    mutate(current);
    assert.throws(
      () => buildAutomatedSeaDropRunPlan(
        current.profile,
        current.liveState,
        { nowSeconds: now },
      ),
    );
  }
});

test("requires exact live zero-spend autonomy and reviewed infrastructure", () => {
  const mutations = [
    (f) => { f.liveState.featureFlags.unknownCollectionExecution = false; },
    (f) => { f.liveState.featureFlags.selling = true; },
    (f) => { f.liveState.policy.maxMintPrice = "1"; },
    (f) => { f.liveState.policy.requireCollectionAllowlist = true; },
    (f) => { f.liveState.policy.autonomousPaidMints = true; },
    (f) => { f.liveState.permissions.venueCurrencyMaximumWei = "1"; },
    (f) => { f.profile.infrastructure.seaDropCodeHash = H("f"); },
  ];
  for (const mutate of mutations) {
    const current = fixture();
    mutate(current);
    assert.throws(
      () => buildAutomatedSeaDropRunPlan(
        current.profile,
        current.liveState,
        { nowSeconds: now },
      ),
    );
  }
});

test("rejects stale evidence and hostile object boundaries", () => {
  const stale = fixture();
  stale.liveState.checkedAt = iso(now - 31);
  assert.throws(
    () => buildAutomatedSeaDropRunPlan(stale.profile, stale.liveState, { nowSeconds: now }),
    { code: "STALE_EVIDENCE" },
  );

  let invoked = 0;
  const hostile = fixture();
  Object.defineProperty(hostile.liveState.targets[0], "simulationSucceeded", {
    enumerable: true,
    get() { invoked += 1; return true; },
  });
  assert.throws(
    () => buildAutomatedSeaDropRunPlan(hostile.profile, hostile.liveState, { nowSeconds: now }),
    { code: "INVALID_JSON" },
  );
  assert.equal(invoked, 0);
  assert.throws(
    () => buildAutomatedSeaDropRunPlan(
      new Proxy(fixture().profile, {}),
      fixture().liveState,
      { nowSeconds: now },
    ),
    { code: "INVALID_JSON" },
  );
});

test("zero-address currency remains exact and no value-bearing field is emitted", () => {
  const { profile, liveState } = fixture();
  const action = buildAutomatedSeaDropRunPlan(
    profile,
    liveState,
    { nowSeconds: now },
  ).actions[0];
  assert.equal(action.currency, NATIVE_CURRENCY);
  assert.equal(action.assetAmount, "1");
  assert.equal(action.expectedPrice, "0");
  assert.equal(action.maxPrice, "0");
  assert.equal(Object.hasOwn(action, "callData"), false);
});
