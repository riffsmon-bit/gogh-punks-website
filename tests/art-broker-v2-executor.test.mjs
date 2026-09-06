import assert from "node:assert/strict";
import test from "node:test";
import { StatelessV2Executor } from "../broker/src/v4/executor.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const MINT = "0x3333333333333333333333333333333333333333";
const ADAPTER = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"a".repeat(64)}`;
const NOW = new Date("2026-09-06T16:00:00.000Z");

function intent(mode = "ASK") {
  return { schema: "PUNK_COLLECTING_INTENT_V1", version: 1, chainId: 4663,
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET, operatingMode: mode,
    mintMode: "FREE_ONLY", maxMintPriceWei: "0", maxGasPerMintWei: "500",
    dailyMintLimit: 3, totalMintLimit: 10, minimumReserveWei: "1000",
    maximumCollectionSupply: 2000, preferences: { prefer: ["PIXEL_ART"], avoid: [] },
    requiresWebsite: true, requiresSocial: true, preferredSocialPlatforms: ["X"],
    blockedContracts: [], allowedContracts: [], blockedCollections: [],
    allowedAdapters: [ADAPTER], riskThreshold: 20, requireSimulation: true,
    expiration: "2026-09-20T00:00:00.000Z", userSubmittedLinksAllowed: true,
    discoveryEnabled: true };
}
function opportunity() {
  return { schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: "seadrop:neon:public", chainId: 4663, collectionContract: MINT,
    mintContract: MINT, adapter: ADAPTER, mintStage: "PUBLIC",
    mintMethod: "mintPublic(address,uint256)", priceWei: "0", estimatedGasCostWei: "100",
    supply: 777, walletLimit: 1, startTime: "2026-09-06T00:00:00.000Z",
    endTime: "2026-09-20T00:00:00.000Z", website: "https://neon.example",
    socialUrls: { x: "https://x.com/neon", discord: null, farcaster: null },
    sourceUrls: ["https://opensea.io/collection/neon"], artStyles: ["PIXEL_ART"],
    imageReference: null, collectionName: "Neon", contractCodeHash: HASH,
    adapterCodeHash: HASH, screeningStatus: "PASSED", simulationStatus: "PASSED",
    riskLevel: "LOW", riskScore: 5, expectedNftReceiver: WALLET,
    unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
}
class Attempts {
  constructor() { this.values = new Map(); this.transitions = []; }
  async reserve(value) {
    if (this.values.has(value.idempotencyKey)) return { replayed: true,
      result: this.values.get(value.idempotencyKey) };
    this.values.set(value.idempotencyKey, { idempotencyKey: value.idempotencyKey,
      status: "RESERVED", submitted: false, productionAuthorized: false });
    return { replayed: false };
  }
  async transition(key, state) { this.transitions.push(state); this.values.set(key,
    { idempotencyKey: key, status: state, submitted: false, productionAuthorized: false }); }
}
function executor(attemptStore = new Attempts(), authority = {}) {
  return { attemptStore, value: new StatelessV2Executor({ clock: () => NOW,
    readAuthority: async () => ({ owner: OWNER, punkWallet: WALLET,
      nativeBalanceWei: "2000", blockNumber: "88", ...authority }), attemptStore,
    buildKnownSafeMint: async () => ({ envelope: { to: MINT, valueWei: "0", data: "0x12345678" },
      screening: { allowedSelectors: ["0x12345678"], adapterRecognized: true,
        chainCodePinned: true, proxyChanged: false, containsDelegatecall: false,
        requestsApproval: false, requestsAssetTransfer: false } }),
    simulate: async () => ({ success: true, reverted: false, valueWei: "0", nftReceiver: WALLET,
      estimatedGasWei: "100", approvals: [], unexpectedTransfers: [], postCallVerified: true }),
  }) };
}

test("ASK screens and simulates but returns a recommendation without transaction calldata", async () => {
  const { value, attemptStore } = executor();
  const output = await value.prepare({ intent: intent("ASK"), opportunity: opportunity(),
    strategyVersion: 7, accountNonce: "1", usage: { dailyMints: 0, totalMints: 0 } });
  assert.equal(output.status, "RECOMMENDATION_READY");
  assert.equal(output.transaction, null);
  assert.equal(output.submitted, false);
  assert.deepEqual(attemptStore.transitions, ["SIMULATED", "OWNER_APPROVAL_PENDING"]);
});

test("ASSIST prepares known-safe calldata for explicit owner approval and never submits", async () => {
  const { value } = executor();
  const output = await value.prepare({ intent: intent("ASSIST"), opportunity: opportunity(),
    strategyVersion: 7, accountNonce: "2", usage: { dailyMints: 0, totalMints: 0 } });
  assert.equal(output.status, "OWNER_APPROVAL_REQUIRED");
  assert.deepEqual(output.transaction, { to: MINT, valueWei: "0", data: "0x12345678" });
  assert.equal(output.productionAuthorized, false);
});

test("AUTONOMOUS fails at the deployed self-funded gas boundary before transaction building", async () => {
  const { value, attemptStore } = executor();
  await assert.rejects(value.prepare({ intent: intent("AUTONOMOUS"), opportunity: opportunity(),
    strategyVersion: 7, accountNonce: "3", usage: { dailyMints: 0, totalMints: 0 } }),
  (error) => error.code === "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT");
  assert.equal(attemptStore.values.size, 0);
});

test("current ownership is rechecked and an old owner strategy is rejected", async () => {
  const { value } = executor(new Attempts(), { owner: MINT });
  await assert.rejects(value.prepare({ intent: intent("ASSIST"), opportunity: opportunity(),
    strategyVersion: 7, accountNonce: "4", usage: { dailyMints: 0, totalMints: 0 } }),
  (error) => error.code === "OWNERSHIP_CHANGED");
});

test("durable attempt identity replays instead of duplicating an attempt", async () => {
  const attempts = new Attempts(); const { value } = executor(attempts);
  const input = { intent: intent("ASK"), strategyVersion: 7,
    opportunity: opportunity(), accountNonce: "5",
    usage: { dailyMints: 0, totalMints: 0 } };
  const first = await value.prepare(input); const second = await value.prepare(input);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(second.replayed, true);
  assert.equal(attempts.values.size, 1);
});
