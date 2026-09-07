import assert from "node:assert/strict";
import test from "node:test";

import { defaultAskIntent, punkCollectingIntentHash } from
  "../broker/src/v4/collecting-intent.mjs";
import { buildOwnerAssistedSeaDropTransaction } from
  "../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { handleV2ReviewMint } from "../netlify/functions/broker-v2-review-mint.mjs";
import { handleV2ReviewStrategyDraft } from
  "../netlify/functions/broker-v2-review-strategy-draft.mjs";

const ORIGIN = "https://deploy-preview-42.preview.goghpunks.xyz";
const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER_OWNER = "0x2222222222222222222222222222222222222222";
const PUNK_WALLET = "0x3333333333333333333333333333333333333333";
const COLLECTION = "0x4444444444444444444444444444444444444444";
const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
const ADAPTER = "0xd4316dfbcfa3f51f1a9de77aaa5d9e6edf848777";
const OPPORTUNITY_ID = "seadrop:test-collection:public";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-09-06T18:00:00.000Z");

function request(path, body) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: {
    origin: ORIGIN, "content-type": "application/json",
  }, body: JSON.stringify(body) });
}

function intent(mode = "ASSIST") {
  return { ...defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
    punkWallet: PUNK_WALLET }, NOW), operatingMode: mode,
    dailyMintLimit: 2, totalMintLimit: 2,
    preferences: { prefer: ["PIXEL_ART"], avoid: [] },
  };
}

function opportunity() {
  return {
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: OPPORTUNITY_ID, dedupeKey: "ignored", chainId: 4663,
    collectionContract: COLLECTION, mintContract: SEA_DROP, adapter: ADAPTER,
    mintStage: "PUBLIC", mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: "0", estimatedGasCostWei: "0", supply: 41, walletLimit: 2,
    startTime: "2026-09-06T17:00:00.000Z", endTime: "2026-09-07T18:00:00.000Z",
    website: null, socialUrls: { x: null, discord: null, farcaster: null },
    sourceUrls: [`https://robinhoodchain.blockscout.com/address/${COLLECTION}`],
    artStyles: ["PIXEL_ART"], imageReference: null, collectionName: "Test Collection",
    contractCodeHash: `0x${"11".repeat(32)}`, adapterCodeHash: `0x${"22".repeat(32)}`,
    screeningStatus: "PASSED", simulationStatus: "UNAVAILABLE",
    riskLevel: "LOW", riskScore: 10, expectedNftReceiver: null,
    unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: "2026-09-06T17:00:00.000Z", updatedAt: "2026-09-06T17:30:00.000Z",
  };
}

test("ASSIST strategy drafts persist only under the signed-in current owner", async () => {
  const queries = [];
  const database = { async query(sql, params = []) {
    queries.push([sql, params]);
    if (sql.includes("SELECT version FROM broker_v2_strategies")) return { rows: [] };
    if (sql.includes("SELECT COALESCE(MAX(version)")) return { rows: [{ version: "1" }] };
    return { rows: [] };
  }, release() {} };
  const pool = { async connect() { return database; } };
  const response = await handleV2ReviewStrategyDraft(request("/api/v2/review/strategy-draft", {
    owner: OWNER, tokenId: "93", intent: intent(),
  }), { pool, now: NOW,
    requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET, blockNumber: "123" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.draft.state, "PENDING_OWNER_CONFIRMATION");
  assert.equal(payload.draft.intent.operatingMode, "ASSIST");
  assert.equal(payload.transactionPrepared, false);
  const insert = queries.find(([sql]) => sql.includes("INSERT INTO broker_v2_strategies"));
  assert.ok(insert, "the complete owner-bound draft must be persisted");
  assert.equal(insert[1][6], OWNER);
  assert.equal(queries.some(([sql]) => sql === "COMMIT"), true);

  let connected = false;
  const wrongSession = await handleV2ReviewStrategyDraft(request(
    "/api/v2/review/strategy-draft", { owner: OWNER, tokenId: "93", intent: intent() }), {
    pool: { async connect() { connected = true; throw new Error("must not connect"); } }, now: NOW,
    requireSession: async () => ({ walletAddress: OTHER_OWNER }),
    readAuthority: async () => { throw new Error("must not read authority"); },
  });
  assert.equal(wrongSession.status, 403);
  assert.equal((await wrongSession.json()).code, "NOT_CURRENT_OWNER");
  assert.equal(connected, false);
});

test("ASK strategies cannot be persisted as live mint drafts", async () => {
  let connected = false;
  const response = await handleV2ReviewStrategyDraft(request("/api/v2/review/strategy-draft", {
    owner: OWNER, tokenId: "93", intent: intent("ASK"),
  }), { now: NOW,
    pool: { async connect() { connected = true; throw new Error("must not persist"); } },
    requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET, blockNumber: "123" }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ASSIST_REQUIRED");
  assert.equal(connected, false);
});

test("live mint preparation requires the signed-in owner session", async () => {
  let authorityRead = false;
  const response = await handleV2ReviewMint(request("/api/v2/review/mint", {
    owner: OWNER, tokenId: "93", opportunityId: OPPORTUNITY_ID, intent: intent(),
  }), {
    now: NOW,
    pool: { async query() { throw new Error("must not query"); } },
    requireSession: async () => ({ walletAddress: COLLECTION }),
    readAuthority: async () => { authorityRead = true; throw new Error("must not read"); },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "NOT_CURRENT_OWNER");
  assert.equal(authorityRead, false);
});

test("live mint preparation rejects an absent or mismatched ACTIVE strategy", async () => {
  const supplied = intent();
  const absent = await handleV2ReviewMint(request("/api/v2/review/mint", {
    owner: OWNER, tokenId: "93", opportunityId: OPPORTUNITY_ID, intent: supplied,
  }), { now: NOW, readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET }),
    requireSession: async () => ({ walletAddress: OWNER }),
    pool: { async query(sql) {
      if (sql.includes("broker_v2_opportunities")) return { rows: [{ normalized: opportunity() }] };
      return { rows: [] };
    } }, simulate: async () => { throw new Error("must not simulate"); },
  });
  assert.equal(absent.status, 409);
  assert.equal((await absent.json()).code, "ASSIST_REQUIRED");

  const changed = { ...supplied, dailyMintLimit: 1 };
  const mismatch = await handleV2ReviewMint(request("/api/v2/review/mint", {
    owner: OWNER, tokenId: "93", opportunityId: OPPORTUNITY_ID, intent: supplied,
  }), { now: NOW, readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET }),
    requireSession: async () => ({ walletAddress: OWNER }),
    pool: { async query(sql) {
      if (sql.includes("broker_v2_opportunities")) return { rows: [{ normalized: opportunity() }] };
      if (sql.includes("broker_v2_strategies")) return { rows: [{ version: 2,
        intent_hash: punkCollectingIntentHash(changed, NOW), intent: changed }] };
      return { rows: [] };
    } }, simulate: async () => { throw new Error("must not simulate"); },
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, "STRATEGY_CHANGED");
});

test("successful live mint preparation reserves an attempt-bound artifact without submitting", async () => {
  const activeIntent = intent();
  const activeHash = punkCollectingIntentHash(activeIntent, NOW);
  const normalized = opportunity();
  const transaction = buildOwnerAssistedSeaDropTransaction({ owner: OWNER,
    punkWallet: PUNK_WALLET, collection: COLLECTION });
  const queries = [];
  const database = { async query(sql, params = []) {
    queries.push([sql, params]);
    if (sql.includes("SELECT version, intent_hash, state")) return { rows: [{
      version: 1, intent_hash: activeHash, state: "ACTIVE",
    }] };
    if (sql.includes("SELECT attempt_id::text, state")) return { rows: [] };
    if (sql.includes("FROM broker_v2_activity")) return { rows: [{ daily: 0, total: 0,
      opportunity: 0 }] };
    if (sql.includes("FROM broker_v2_execution_attempts WHERE")) return { rows: [{ daily: 0,
      total: 0, opportunity: 0 }] };
    if (sql.includes("INSERT INTO broker_v2_execution_attempts")) {
      return { rows: [{ attempt_id: ATTEMPT_ID }] };
    }
    return { rows: [] };
  }, release() {} };
  const pool = { async query(sql, params = []) {
    queries.push([sql, params]);
    if (sql.includes("broker_v2_opportunities")) return { rows: [{ normalized }] };
    if (sql.includes("broker_v2_strategies")) return { rows: [{ version: 1,
      intent_hash: activeHash, intent: activeIntent }] };
    return { rows: [] };
  }, async connect() { return database; } };
  const rpcMethods = [];
  const client = { async readContract() { rpcMethods.push("readContract"); return 7n; } };
  let simulations = 0;
  const response = await handleV2ReviewMint(request("/api/v2/review/mint", {
    owner: OWNER, tokenId: "93", opportunityId: OPPORTUNITY_ID, intent: activeIntent,
  }), { pool, client, now: NOW,
    requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      nativeBalanceWei: "100000000000000000", activated: true }),
    simulate: async ({ opportunity: input }) => {
      simulations += 1;
      return { opportunity: input, transaction, evidence: {
        expectedTokenId: "42", estimatedGasWei: "1000", pinnedBlock: "123",
        inputHash: "simulation-input-hash", simulatedAt: NOW.toISOString(),
      } };
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.attemptId, ATTEMPT_ID);
  assert.equal(payload.mint.attemptId, ATTEMPT_ID);
  assert.equal(payload.mint.idempotencyKey, payload.mint.idempotencyKey.toLowerCase());
  assert.match(payload.mint.idempotencyKey, /^[0-9a-f]{64}$/);
  assert.equal(payload.mint.transaction.to, PUNK_WALLET);
  assert.equal(payload.mint.safety.ownerApprovalRequired, true);
  assert.equal(payload.transactionSubmitted, false);
  assert.equal(simulations, 1);
  assert.deepEqual(rpcMethods, ["readContract"]);
  assert.equal(queries.some(([sql]) => sql.includes("INSERT INTO broker_v2_execution_attempts")), true);
  assert.equal(queries.some(([sql]) => sql.includes("SET state = 'EXPIRED'")), false,
    "an unreported wallet handoff remains reserved until reconciliation or reuse");
  assert.equal(queries.some(([sql]) => /eth_sendTransaction|sendTransaction/.test(sql)), false);
  assert.equal(queries.some(([sql]) => sql === "COMMIT"), true);
});
