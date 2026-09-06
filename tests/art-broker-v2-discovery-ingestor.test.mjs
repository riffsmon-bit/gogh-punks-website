import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestSeaDropObservations, screenSeaDropDiscoveryObservation,
  seaDropObservationToOpportunity, V2_SEADROP_ADAPTER_CODE_HASH, V2_SEADROP_CODE_HASH,
} from "../broker/src/v4/discovery/seadrop-ingestor.mjs";
import { handleV2DiscoveryIngest } from
  "../netlify/functions/broker-v2-discovery-ingest.mjs";
import { advanceRobinhoodDiscoveryCheckpoint, readCurrentRobinhoodSeaDropObservations } from
  "../broker/src/v4/discovery/robinhood-seadrop-source.mjs";

const NOW = new Date("2026-09-06T20:00:00.000Z");
const OWNER_TOKEN = "a-secure-admin-review-token";

function observation(overrides = {}) {
  const nowSeconds = Math.floor(NOW.getTime() / 1_000);
  return {
    collection: "0x1111111111111111111111111111111111111111",
    updateBlockNumber: "50000000", updateBlockHash: `0x${"11".repeat(32)}`,
    updateTransactionHash: `0x${"22".repeat(32)}`, checkedAt: NOW.toISOString(),
    pinnedBlockNumber: "50000100", pinnedBlockHash: `0x${"33".repeat(32)}`,
    collectionName: "Current SeaDrop Study", maxSupply: 777, totalSupply: 100,
    drop: { priceWei: "0", startTime: String(nowSeconds - 60),
      endTime: String(nowSeconds + 3600), walletLimit: 2, restrictFeeRecipients: false },
    contracts: { seaDropCodeHash: V2_SEADROP_CODE_HASH,
      adapterCodeHash: V2_SEADROP_ADAPTER_CODE_HASH,
      collectionCodeHash: "0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041" },
    adapterRegistered: false, feeRecipientAllowed: true, ...overrides,
  };
}

test("live SeaDrop discovery identifies contracts but cannot become eligible without adapter registration", () => {
  const screen = screenSeaDropDiscoveryObservation(observation(), NOW);
  assert.equal(screen.contractIdentified, true);
  assert.equal(screen.status, "NEEDS_REVIEW");
  assert.deepEqual(screen.reasons, ["ADAPTER_NOT_REGISTERED"]);
  const { opportunity } = seaDropObservationToOpportunity(observation(), NOW);
  assert.equal(opportunity.screeningStatus, "NEEDS_REVIEW");
  assert.equal(opportunity.simulationStatus, "UNAVAILABLE");
  assert.equal(opportunity.expectedNftReceiver, null);
});

test("shared screening passes only pinned active free SeaDrop contracts", () => {
  const passed = screenSeaDropDiscoveryObservation(observation({ adapterRegistered: true }), NOW);
  assert.equal(passed.status, "PASSED");
  assert.deepEqual(passed.reasons, []);
  const blocked = screenSeaDropDiscoveryObservation(observation({
    adapterRegistered: true,
    contracts: { ...observation().contracts, collectionCodeHash: `0x${"99".repeat(32)}` },
  }), NOW);
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(blocked.reasons, ["UNREVIEWED_COLLECTION_RUNTIME"]);
});

test("ingestion stores normalized source evidence and an immutable screening record", async () => {
  const ingested = []; const queries = [];
  const results = await ingestSeaDropObservations({ observations: [observation()], now: NOW,
    repository: { ingest: async (opportunity, source) => {
      ingested.push({ opportunity, source }); return opportunity;
    } }, pool: { query: async (...args) => { queries.push(args); return { rows: [] }; } } });
  assert.equal(results.length, 1);
  assert.equal(results[0].eligible, false);
  assert.equal(ingested[0].source.evidence.externalCalldataAccepted, false);
  assert.equal(queries.length, 1);
  assert.match(queries[0][0], /broker_v2_security_screenings/);
  assert.equal(JSON.parse(queries[0][1][7]).pinnedBlockNumber, "50000100");
});

test("Robinhood source scans confirmed SeaDrop events and pins every contract read", async () => {
  const collection = "0x1111111111111111111111111111111111111111";
  const tx = `0x${"44".repeat(32)}`; const blockHash = `0x${"55".repeat(32)}`;
  let emitted = false; const reads = [];
  const client = {
    getBlockNumber: async () => 20_020n,
    getLogs: async ({ fromBlock, toBlock }) => {
      reads.push([fromBlock, toBlock]);
      if (emitted) return [];
      emitted = true;
      return [{ args: { nftContract: collection }, blockNumber: 19_500n,
        blockHash, transactionHash: tx }];
    },
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: `0x${"66".repeat(32)}` }),
    getCode: async () => "0x6000",
    readContract: async ({ functionName }) => {
      if (functionName === "getPublicDrop") return { mintPrice: 0n,
        startTime: 1_788_700_000n, endTime: 1_788_800_000n,
        maxTotalMintableByWallet: 3, restrictFeeRecipients: false };
      if (functionName === "validateAdapter") return true;
      if (functionName === "name") return "Pinned Study";
      if (functionName === "maxSupply") return 888n;
      if (functionName === "totalSupply") return 123n;
      throw new Error("unexpected read");
    },
  };
  let queryCount = 0;
  const pool = { query: async () => ({ rows: queryCount++ === 0 ? [] : [] }) };
  const source = await readCurrentRobinhoodSeaDropObservations({ pool, client, now: NOW,
    maximum: 5, pause: async () => {} });
  assert.equal(reads.length, 5);
  assert.equal(source.confirmedBlock, "20000");
  assert.equal(source.observations.length, 1);
  assert.equal(source.observations[0].updateTransactionHash, tx);
  assert.equal(source.observations[0].pinnedBlockNumber, "20000");
  assert.equal(source.observations[0].collectionName, "Pinned Study");
});

test("Robinhood checkpoint only advances monotonically after ingestion", async () => {
  const queries = [];
  await advanceRobinhoodDiscoveryCheckpoint({ query: async (...args) => { queries.push(args); } },
    "50000123");
  assert.equal(queries[0][1][2], "50000123");
  assert.match(queries[0][0], /GREATEST/);
});

function request(token = OWNER_TOKEN) {
  return new Request("https://deploy-preview-42.preview.goghpunks.xyz/api/v2/admin/discovery/ingest",
    { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

test("the live ingestor is admin-only, disabled by default, and never creates execution authority", async () => {
  const disabled = await handleV2DiscoveryIngest(request(), {
    environment: { GOGH_V2_ADMIN_TOKEN: OWNER_TOKEN }, pool: {} });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "V2_DISCOVERY_DISABLED");

  let advanced = null;
  const enabled = await handleV2DiscoveryIngest(request(), {
    environment: { GOGH_V2_ADMIN_TOKEN: OWNER_TOKEN,
      GOGH_V2_DISCOVERY_INGEST_ENABLED: "true" }, pool: {}, client: {}, now: NOW,
    repository: { ingest: async () => { throw new Error("injected ingest should own persistence"); } },
    readSource: async () => ({ sourceKey: "ROBINHOOD_SEADROP_PUBLIC_DROP_V2",
      confirmedBlock: "50000000", observations: [observation()] }),
    ingest: async () => [{ screeningStatus: "NEEDS_REVIEW" }],
    advanceCheckpoint: async (_pool, block) => { advanced = block; },
  });
  assert.equal(enabled.status, 200);
  const payload = await enabled.json();
  assert.equal(payload.discoveredCount, 1);
  assert.equal(payload.needsReviewCount, 1);
  assert.equal(payload.eligibleCount, 0);
  assert.equal(payload.simulationRequiredPerPunk, true);
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.executionAttemptCreated, false);
  assert.equal(advanced, "50000000");
});
