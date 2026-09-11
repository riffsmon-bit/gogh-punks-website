import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { readPunkAgentMissionUsage } from
  "../broker/src/agent-account/punk-agent-mission-usage.mjs";
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { matchV2Opportunity } from "../broker/src/v4/policy-matcher.mjs";

const NOW = new Date("2026-09-11T02:23:00.000Z");
const YESTERDAY = "2026-09-09T13:18:03.580Z";
const CURRENT = "11111111-1111-4111-8111-111111111111";
const PREVIOUS = "22222222-2222-4222-8222-222222222222";
const OTHER_PUNK = "33333333-3333-4333-8333-333333333333";
const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const TARGET = "seadrop:new:public";
const mission = { sessionId: CURRENT, tokenId: "93" };
let database;

before(async () => {
  database = new PGlite();
  // Real PostgreSQL evaluates the worker's production queries. Only unrelated
  // schema columns and constraints are omitted from this isolated fixture.
  await database.exec(`CREATE TABLE broker_v2_agent_sessions (
      session_id UUID PRIMARY KEY, chain_id BIGINT, punk_token_id NUMERIC(78, 0));
    CREATE TABLE broker_v2_agent_user_operations (
      attempt_id UUID PRIMARY KEY, session_id UUID REFERENCES broker_v2_agent_sessions,
      opportunity_id TEXT, state TEXT, created_at TIMESTAMPTZ);
    CREATE TABLE broker_v2_activity (
      chain_id BIGINT, punk_token_id NUMERIC(78, 0), activity_type TEXT,
      opportunity_id TEXT, attempt_id UUID, occurred_at TIMESTAMPTZ);`);
});
after(async () => { await database?.close(); });
beforeEach(async () => {
  await database.exec(`TRUNCATE broker_v2_activity, broker_v2_agent_user_operations,
    broker_v2_agent_sessions;`);
  for (const [id, token] of [[CURRENT, "93"], [PREVIOUS, "93"], [OTHER_PUNK, "94"]]) {
    await database.query("INSERT INTO broker_v2_agent_sessions VALUES ($1, 4663, $2)", [id, token]);
  }
});

async function operation({ session = CURRENT, state = "CONFIRMED", createdAt = NOW,
  collectedAt = createdAt, opportunityId = TARGET, activity = state === "CONFIRMED" } = {}) {
  const attemptId = crypto.randomUUID();
  await database.query("INSERT INTO broker_v2_agent_user_operations VALUES ($1, $2, $3, $4, $5)",
    [attemptId, session, opportunityId, state, new Date(createdAt).toISOString()]);
  if (activity) await database.query(`INSERT INTO broker_v2_activity VALUES
    (4663, $1, 'COLLECTED', $2, $3, $4)`, [session === OTHER_PUNK ? "94" : "93",
    opportunityId, attemptId, new Date(collectedAt).toISOString()]);
}

function match(counts, overrides = {}) {
  const intent = { ...defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
    punkWallet: ACCOUNT }, NOW), operatingMode: "AUTONOMOUS", dailyMintLimit: 1,
    totalMintLimit: 1, minimumReserveWei: "0" };
  return matchV2Opportunity(intent, {
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2, opportunityId: TARGET,
    chainId: 4663, collectionContract: OWNER, mintContract: OWNER, adapter: OWNER,
    mintStage: "PUBLIC", mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: "0", estimatedGasCostWei: "1", supply: 100, walletLimit: 1,
    startTime: null, endTime: null, website: null,
    socialUrls: { x: null, discord: null, farcaster: null }, sourceUrls: [],
    artStyles: [], imageReference: null, collectionName: "New free mint",
    contractCodeHash: `0x${"11".repeat(32)}`, adapterCodeHash: `0x${"22".repeat(32)}`,
    screeningStatus: "PASSED", simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 10,
    expectedNftReceiver: ACCOUNT, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides,
  }, { currentOwner: OWNER, punkWallet: ACCOUNT, punkWalletBalanceWei: "1000000000000000",
    ...counts }, NOW);
}

test("an earlier mission's mint does not consume a new quantity-one mission", async () => {
  await operation({ session: PREVIOUS, createdAt: YESTERDAY, opportunityId: "old-mint" });
  const counts = await readPunkAgentMissionUsage(database, mission, TARGET, NOW);
  assert.deepEqual(counts, { dailyMints: 0, totalMints: 0, opportunityMints: 0 });
  assert.equal(match(counts).automaticExecutionCandidate, true);
  assert.deepEqual(match({ ...counts, totalMints: 1 }).reasons, ["TOTAL_LIMIT_REACHED"]);
});

test("daily and per-opportunity limits survive a mission change", async () => {
  await operation({ session: PREVIOUS });
  const counts = await readPunkAgentMissionUsage(database, mission, TARGET, NOW);
  assert.deepEqual(counts, { dailyMints: 1, totalMints: 0, opportunityMints: 1 });
  assert.deepEqual(match(counts).reasons, ["DAILY_LIMIT_REACHED", "WALLET_LIMIT_REACHED"]);
});

test("receipt reconciliation time cannot attribute an old mint to a new session", async () => {
  await operation({ session: PREVIOUS, createdAt: YESTERDAY, collectedAt: NOW });
  const counts = await readPunkAgentMissionUsage(database, mission, TARGET, NOW);
  assert.equal(counts.totalMints, 0);
  assert.equal(counts.dailyMints, 1);
});

test("the current mission's confirmed mint consumes its budget exactly once", async () => {
  await operation();
  const counts = await readPunkAgentMissionUsage(database, mission, TARGET, NOW);
  assert.deepEqual(counts, { dailyMints: 1, totalMints: 1, opportunityMints: 1 });
  assert.equal(match(counts).automaticExecutionCandidate, false);
  assert.ok(match(counts).reasons.includes("TOTAL_LIMIT_REACHED"));
});

for (const state of ["SIGNED", "SUBMITTED", "RECONCILIATION_REQUIRED"]) {
  test(`${state} operations reserve the current mission's budget`, async () => {
    await operation({ state });
    assert.deepEqual(await readPunkAgentMissionUsage(database, mission, TARGET, NOW),
      { dailyMints: 1, totalMints: 1, opportunityMints: 1 });
  });
}

test("unresolved earlier sessions retain daily and opportunity reservations", async () => {
  await operation({ session: PREVIOUS, state: "RECONCILIATION_REQUIRED" });
  assert.deepEqual(await readPunkAgentMissionUsage(database, mission, TARGET, NOW),
    { dailyMints: 1, totalMints: 0, opportunityMints: 1 });
});

test("failed operations and another Punk's mints do not consume this mission", async () => {
  for (const state of ["REVERTED", "REJECTED", "RESERVED"]) await operation({ state });
  await operation({ session: OTHER_PUNK });
  assert.deepEqual(await readPunkAgentMissionUsage(database, mission, TARGET, NOW),
    { dailyMints: 0, totalMints: 0, opportunityMints: 0 });
});

test("owner-assisted history retains daily limits without consuming an autonomous session", async () => {
  await database.query(`INSERT INTO broker_v2_activity VALUES
    (4663, 93, 'COLLECTED', $1, NULL, $2)`, [TARGET, NOW.toISOString()]);
  assert.deepEqual(await readPunkAgentMissionUsage(database, mission, TARGET, NOW),
    { dailyMints: 1, totalMints: 0, opportunityMints: 1 });
});

test("UTC day rollover clears the daily count, preserving mission and collection totals", async () => {
  await operation({ createdAt: "2026-09-10T23:59:59.999Z" });
  assert.deepEqual(await readPunkAgentMissionUsage(database, mission, TARGET, NOW),
    { dailyMints: 0, totalMints: 1, opportunityMints: 1 });
});
