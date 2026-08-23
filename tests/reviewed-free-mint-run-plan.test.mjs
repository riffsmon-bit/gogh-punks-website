import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildReviewedFreeMintRunPlan, SEA_DROP, SEA_DROP_MINT_PUBLIC_SELECTOR } from "../broker/src/recommendation/reviewed-free-mint-run-plan.mjs";

const H = (digit) => `0x${digit.repeat(64)}`;
const A = (digit) => `0x${digit.repeat(40)}`;
const now = 1_787_440_000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();

function fixture() {
  const queue = {
    schema: "GOGH_REVIEWED_FREE_MINT_QUEUE_V1", version: 1, chainId: 4663,
    createdAt: iso(now - 60), expiresAt: iso(now + 3600),
    punk: { tokenId: "1797", collection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6", account: A("1"), expectedOwner: A("2") },
    agent: A("3"),
    limits: {
      maxMintsPerUtcDay: 3, maxMintsPerRun: 2, maxGasPerMint: 500000,
      maxGasWeiPerRun: "1000000000000000", minAgentReserveWei: "500000000000000",
      intentTtlSeconds: 120, maxEvidenceAgeSeconds: 20, stopOnFailure: true, containAfterRun: true,
    },
    targets: ["4", "5", "6"].map((digit, index) => ({
      id: `target-${index + 1}`, opportunityId: H(digit), reasoningHash: H(String(7 + index)),
      collection: A(digit), collectionCodeHash: H("a"), venue: SEA_DROP,
      venueCodeHash: H("b"), selector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      adapter: A(String(7 + index)), adapterCodeHash: H("c"), adapterVersionHash: H("1"),
      adapterMetadataHash: H("2"),
      adapterData: "0x", assetAmount: "1", currency: A("0"), expectedPrice: "0", maxPrice: "0",
      maxSlippageBps: 0, reviewEvidenceHash: H("d"), reviewedAt: iso(now - 30),
      expiresAt: iso(now + 600), status: "REVIEWED_READY",
    })),
  };
  const liveState = {
    schema: "GOGH_REVIEWED_FREE_MINT_LIVE_STATE_V1", chainId: 4663,
    checkedAt: iso(now - 2), blockNumber: 43_000_000, blockHash: H("e"), blockTimestamp: iso(now - 3),
    owner: A("2"), account: A("1"), agent: A("3"), policyVersion: "38", nonce: "2",
    acquisitionsToday: 1, agentBalanceWei: "3000000000000000", maxFeePerGasWei: "1000000000",
    accountPaused: false, agentAuthorized: true,
    featureFlags: {
      scoutMode: true, approvalPurchases: false, autonomousPurchases: true, autonomousMints: true,
      unknownCollectionExecution: false, selling: false, autonomousSelling: false,
    },
    policy: { mode: "AUTONOMOUS", maxAcquisitionsPerDay: 3, autonomousFreeMints: true, autonomousPaidMints: false },
    targets: queue.targets.map((target, index) => ({
      id: target.id, collection: target.collection, collectionCodeHash: target.collectionCodeHash,
      venue: target.venue, venueCodeHash: target.venueCodeHash, adapter: target.adapter,
      adapterCodeHash: target.adapterCodeHash, adapterVersionHash: target.adapterVersionHash,
      adapterMetadataHash: target.adapterMetadataHash, selector: target.selector,
      adapterActive: true, adapterAllowed: true, venueAllowed: true, collectionAllowed: true,
      selectorAllowed: true, currencyAllowed: true, venueCurrencyMaximumWei: "0", dropActive: true,
      mintPriceWei: "0", walletRemaining: "1", supplyRemaining: "10",
      nextTokenId: String(100 + index), gasEstimate: "300000", simulationSucceeded: true,
    })),
  };
  return { queue, liveState };
}

test("builds a two-target reviewed autonomous plan within daily and gas caps", () => {
  const { queue, liveState } = fixture();
  const result = buildReviewedFreeMintRunPlan(queue, liveState, { nowSeconds: now });
  assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions.map(({ id, nonce }) => [id, nonce]), [["target-1", "2"], ["target-2", "3"]]);
  assert.equal(result.limits.acquisitionsAlreadyToday, 1);
  assert.equal(result.safety.executionAuthorizedByThisArtifact, false);
  assert.equal(result.safety.arbitraryCalldataAccepted, false);
  assert.equal(Object.isFrozen(result.actions[0]), true);
  assert.match(result.planHash, /^0x[0-9a-f]{64}$/);
});

test("gas budget can narrow the reviewed plan without widening scope", () => {
  const { queue, liveState } = fixture();
  queue.limits.maxGasWeiPerRun = "350000000000000";
  const result = buildReviewedFreeMintRunPlan(queue, liveState, { nowSeconds: now });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].id, "target-1");
});

test("fails closed on stale evidence, daily exhaustion, or insufficient reserve", () => {
  for (const mutate of [
    (f) => { f.liveState.checkedAt = iso(now - 21); },
    (f) => { f.liveState.acquisitionsToday = 3; },
    (f) => { f.liveState.agentBalanceWei = f.queue.limits.minAgentReserveWei; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => buildReviewedFreeMintRunPlan(f.queue, f.liveState, { nowSeconds: now }));
  }
});

test("rejects paid, arbitrary-data, unknown-venue, and unsafe feature mutations", () => {
  for (const mutate of [
    (f) => { f.queue.targets[0].expectedPrice = "1"; },
    (f) => { f.queue.targets[0].adapterData = "0x12"; },
    (f) => { f.queue.targets[0].venue = A("9"); f.liveState.targets[0].venue = A("9"); },
    (f) => { f.liveState.featureFlags.unknownCollectionExecution = true; },
    (f) => { f.liveState.featureFlags.selling = true; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => buildReviewedFreeMintRunPlan(f.queue, f.liveState, { nowSeconds: now }));
  }
});

test("rejects target code drift, missing permissions, failed simulation, and oversized gas", () => {
  for (const mutate of [
    (f) => { f.liveState.targets[0].adapterCodeHash = H("f"); },
    (f) => { f.liveState.targets[0].collectionAllowed = false; },
    (f) => { f.liveState.targets[0].simulationSucceeded = false; },
    (f) => { f.liveState.targets[0].gasEstimate = "500001"; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => buildReviewedFreeMintRunPlan(f.queue, f.liveState, { nowSeconds: now }));
  }
});

test("rejects duplicate reviewed collections/adapters and unsafe queue lifetimes", () => {
  const duplicate = fixture();
  duplicate.queue.targets[1].collection = duplicate.queue.targets[0].collection;
  duplicate.liveState.targets[1].collection = duplicate.liveState.targets[0].collection;
  assert.throws(() => buildReviewedFreeMintRunPlan(duplicate.queue, duplicate.liveState, { nowSeconds: now }));
  const long = fixture(); long.queue.expiresAt = iso(now + 86_401);
  assert.throws(() => buildReviewedFreeMintRunPlan(long.queue, long.liveState, { nowSeconds: now }));
});

test("rejects accessors and Proxies without executing an autonomous action", () => {
  const f = fixture();
  let invoked = 0;
  Object.defineProperty(f.queue.targets[0], "adapter", { enumerable: true, get() { invoked += 1; return A("7"); } });
  assert.throws(() => buildReviewedFreeMintRunPlan(f.queue, f.liveState, { nowSeconds: now }));
  assert.equal(invoked, 0);
  const proxy = new Proxy(fixture().queue, {});
  assert.throws(() => buildReviewedFreeMintRunPlan(proxy, fixture().liveState, { nowSeconds: now }));
});

test("planner and CLI contain no signer, wallet send, deployment, or chain-write path", async () => {
  const source = await readFile(new URL("../broker/src/recommendation/reviewed-free-mint-run-plan.mjs", import.meta.url), "utf8");
  const cli = await readFile(new URL("../scripts/build-reviewed-free-mint-run-plan.mjs", import.meta.url), "utf8");
  for (const text of [source, cli]) {
    assert.doesNotMatch(text, /privateKey|sendTransaction|eth_send|writeContract|deployContract|createWalletClient/);
  }
});
