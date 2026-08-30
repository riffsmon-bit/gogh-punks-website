import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  automationV3PunkEnrollment, enrollAutomationV3Punk,
  getAutomationV3PunkWorkerActivity, getAutomationV3UsageStats,
  punkWorkerActivityFromRow, punkWorkerEvidenceFromRow, recordAutomationV3PunkWorkerEvidence,
  recordAutomationV3WorkerHeartbeat, workerDiscoverySummary, workerHeartbeatFromRow,
  workerUsageFromRow,
} from "../netlify/functions/_shared/automation-v3-worker-state.mjs";

const RELEASE = "a".repeat(40);
const ACCOUNT = `0x${"1".repeat(40)}`;
const COLLECTION = `0x${"2".repeat(40)}`;
const TRANSACTION = `0x${"3".repeat(64)}`;

test("V3 worker records append-only history and the current heartbeat atomically", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        release_commit: RELEASE,
        started_at: "2026-08-24T12:00:00.000Z",
        completed_at: "2026-08-24T12:00:02.000Z",
        status: "MINT_CONFIRMED",
        submitted: 1,
        punk_token_id: "93",
        account_address: ACCOUNT,
        collection_address: COLLECTION,
        transaction_hash: TRANSACTION,
        failure_code: null,
      }] };
    },
  };
  const heartbeat = await recordAutomationV3WorkerHeartbeat({
    status: "MINT_CONFIRMED", submitted: 1, tokenId: "93", account: ACCOUNT,
    collection: COLLECTION, transactionHash: TRANSACTION,
    diagnostics: { socialRanking: { discovered: 14, withWebsite: 8, withX: 6,
      highPriority: 2, sentToOnchainValidation: 3, maximumOnchainValidations: 3 },
    socialCandidates: [{ collection: COLLECTION, tier: "HIGH", score: 75,
      signals: { projectName: "Example", imageUrl: "https://i.seadn.io/example.png",
        websiteUrl: "https://example.com/", xUrl: "https://x.com/example" },
      reasons: ["Free mint", "Supported contract runtime"] }] },
  }, {
    database, release: RELEASE, startedAt: "2026-08-24T12:00:00Z",
    completedAt: "2026-08-24T12:00:02Z",
  });
  assert.equal(heartbeat.tokenId, "93");
  assert.match(calls[0].sql, /WITH recorded AS/);
  assert.match(calls[0].sql, /INSERT INTO broker_automation_v3_worker_runs/);
  assert.match(calls[0].sql, /INSERT INTO broker_automation_v3_worker_state/);
  assert.match(calls[0].sql, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(JSON.parse(calls[0].values[10]), {
    discovered: 14, withWebsite: 8, withX: 6, highPriority: 2,
    sentToOnchainValidation: 3, maximumOnchainValidations: 3,
    candidates: [{ collection: COLLECTION, tier: "HIGH", score: 75,
      projectName: "Example", imageUrl: "https://i.seadn.io/example.png",
      websiteUrl: "https://example.com/", xUrl: "https://x.com/example",
      reasons: ["Free mint", "Supported contract runtime"] }],
  });
});

test("V3 worker records one bounded evidence row for every scheduled Punk", async () => {
  const calls = [];
  const database = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: [{
      punk_token_id: values[0], state: values[1], current_job_id: values[2],
      last_scheduled_scan: values[3], last_actual_scan: values[4],
      last_successful_mint: values[5], next_scan_estimate: values[6],
      reason: values[7], updated_at: values[8],
    }] };
  } };
  const evidence = await recordAutomationV3PunkWorkerEvidence({
    status: "NO_ELIGIBLE_TARGETS", submitted: 0,
    diagnostics: {
      totalEligibleProfiles: 161,
      scheduledProfileBatch: 6,
      scheduledTokenIds: ["93", "1616"],
      profileOutcomes: [{ tokenId: "93", account: ACCOUNT,
        state: "SKIPPED", reason: "NO_ELIGIBLE_TARGETS" }],
    },
  }, {
    database, jobId: "12345678-1234-1234-1234-123456789abc",
    startedAt: "2026-08-29T12:00:00Z", completedAt: "2026-08-29T12:00:02Z",
  });
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map(({ tokenId, state, reason }) => ({ tokenId, state, reason })), [
    { tokenId: "93", state: "SKIPPED", reason: "NO_ELIGIBLE_TARGETS" },
    { tokenId: "1616", state: "QUEUED", reason: "WAITING_FOR_WORKER_CAPACITY" },
  ]);
  assert.equal(calls[0].values[4], "2026-08-29T12:00:02.000Z");
  assert.equal(calls[1].values[4], null);
  assert.equal(calls[0].values[6], "2026-08-29T14:15:00.000Z");
  assert.match(calls[0].sql, /broker_punk_agent_heartbeats/);
  assert.match(calls[0].sql, /broker_punk_agent_activity/);
  assert.match(calls[0].sql, /WHERE broker_punk_agent_heartbeats\.updated_at <= EXCLUDED\.updated_at/);
  assert.equal(calls[0].values[11], true);
  assert.equal(calls[1].values[11], false);
  assert.match(calls[0].values[9], /^[0-9a-f]{64}$/);
});

test("a reverted mint records its transaction only as failed activity", async () => {
  const calls = [];
  const database = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: [{
      punk_token_id: values[0], state: values[1], current_job_id: values[2],
      last_scheduled_scan: values[3], last_actual_scan: values[4],
      last_successful_mint: values[5], next_scan_estimate: values[6],
      reason: values[7], updated_at: values[8],
    }] };
  } };
  await recordAutomationV3PunkWorkerEvidence({
    status: "FAILED", submitted: 0, failureCode: "AUTONOMOUS_MINT_REVERTED",
    tokenId: "1788", account: ACCOUNT, collection: COLLECTION,
    transactionHash: TRANSACTION,
    diagnostics: {
      totalEligibleProfiles: 2, scheduledProfileBatch: 2,
      scheduledTokenIds: ["1788", "1793"],
      profileOutcomes: [{ tokenId: "1788", account: ACCOUNT,
        state: "ERROR", reason: "AUTONOMOUS_MINT_REVERTED" }],
    },
  }, {
    database, jobId: "12345678-1234-1234-1234-123456789abc",
    startedAt: "2026-08-30T12:00:00Z", completedAt: "2026-08-30T12:00:02Z",
  });
  assert.equal(calls[0].values[5], null, "a reverted tx is not a successful mint");
  assert.equal(calls[0].values[12], TRANSACTION, "failed activity retains its tx hash");
  assert.equal(calls[0].values[10], COLLECTION);
  assert.equal(calls[1].values[12], null, "the queued Punk did not submit the failed tx");
  assert.equal(calls[1].values[11], false);
});

test("Punk activity reads one exact indexed timeline without chain RPC", async () => {
  const calls = [];
  const database = { async query(sql, values) {
    calls.push({ sql, values });
    if (/broker_punk_agent_heartbeats/.test(sql)) return { rows: [{
      punk_token_id: "93", state: "SKIPPED", current_job_id: "12345678",
      last_scheduled_scan: "2026-08-29T12:00:00Z",
      last_actual_scan: "2026-08-29T12:00:02Z", last_successful_mint: null,
      next_scan_estimate: "2026-08-29T14:15:00Z", reason: "NO_ELIGIBLE_TARGETS",
      updated_at: "2026-08-29T12:00:02Z",
    }] };
    return { rows: [{
      punk_token_id: "93", event_id: "a".repeat(64), job_id: "12345678",
      state: "SKIPPED", reason: "NO_ELIGIBLE_TARGETS", collection_address: null,
      transaction_hash: null, occurred_at: "2026-08-29T12:00:02Z",
    }] };
  } };
  const result = await getAutomationV3PunkWorkerActivity("93", { database });
  assert.equal(result.heartbeat.tokenId, "93");
  assert.equal(result.events[0].reason, "NO_ELIGIBLE_TARGETS");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ values }) => values[0] === "93"));
  assert.deepEqual(punkWorkerActivityFromRow({
    punk_token_id: "93", event_id: "b".repeat(64), job_id: null,
    state: "MINTED", reason: "MINT_CONFIRMED", collection_address: COLLECTION,
    transaction_hash: TRANSACTION, occurred_at: "2026-08-29T12:00:02Z",
  }).transactionHash, TRANSACTION);
});

test("per-Punk worker evidence rejects unscheduled or malformed outcomes", async () => {
  const options = {
    database: { async query() { throw new Error("must not query"); } },
    jobId: "12345678-1234-1234-1234-123456789abc",
    startedAt: "2026-08-29T12:00:00Z", completedAt: "2026-08-29T12:00:02Z",
  };
  await assert.rejects(() => recordAutomationV3PunkWorkerEvidence({ diagnostics: {
    scheduledTokenIds: ["93"], scheduledProfileBatch: 1, totalEligibleProfiles: 1,
    profileOutcomes: [{ tokenId: "94", state: "READY", reason: "ELIGIBLE" }],
  } }, options), /not scheduled/);
  assert.throws(() => punkWorkerEvidenceFromRow({
    punk_token_id: "93", state: "FAKE_ACTIVE", reason: "NOPE",
    updated_at: "2026-08-29T12:00:02Z",
  }), /state is invalid/);
});

test("worker discovery summary is bounded, public, and never an execution approval", () => {
  const summary = workerDiscoverySummary({ diagnostics: {
    socialRanking: { discovered: 1000, withWebsite: 4, withX: 3,
      highPriority: 2, sentToOnchainValidation: 3, maximumOnchainValidations: 3 },
    socialCandidates: [{ collection: COLLECTION.toUpperCase().replace("0X", "0x"),
      tier: "MEDIUM", score: 40, signals: { websiteUrl: "https://example.com/project",
        xUrl: "https://x.com/example" }, reasons: ["Free mint"] }],
  } });
  assert.equal(summary.discovered, 0);
  assert.equal(summary.sentToOnchainValidation, 3);
  assert.doesNotMatch(JSON.stringify(summary), /approved|private|calldata/i);
  const heartbeat = workerHeartbeatFromRow({
    release_commit: RELEASE, started_at: "2026-08-24T12:00:00Z",
    completed_at: "2026-08-24T12:00:02Z", status: "NO_ELIGIBLE_TARGETS",
    submitted: 0, discovery_summary: summary,
  });
  assert.equal(heartbeat.discoverySummary.candidates[0].tier, "MEDIUM");
});

test("public V3 usage is aggregate, canonical, and contains no holder addresses", async () => {
  const row = {
    confirmed_mints: "7",
    minting_punks: "3",
    autonomous_preference_wallets: "2",
    recorded_runs: "18",
    tracked_since: "2026-08-24T12:00:00Z",
    latest_confirmed_at: "2026-08-24T14:00:00Z",
  };
  assert.deepEqual(workerUsageFromRow(row), {
    confirmedMints: "7",
    mintingPunks: "3",
    autonomousPreferenceWallets: "2",
    recordedRuns: "18",
    trackedSince: "2026-08-24T12:00:00.000Z",
    latestConfirmedAt: "2026-08-24T14:00:00.000Z",
  });
  const calls = [];
  const usage = await getAutomationV3UsageStats({ database: {
    async query(sql) { calls.push(sql); return { rows: [row] }; },
  } });
  assert.equal(usage.confirmedMints, "7");
  assert.match(calls[0], /COUNT\(DISTINCT punk_token_id\)/);
  assert.match(calls[0], /COUNT\(DISTINCT configured_by\)/);
  assert.doesNotMatch(JSON.stringify(usage), /0x[0-9a-f]{40}/);
  assert.throws(() => workerUsageFromRow({ ...row, confirmed_mints: "01" }));
});

test("V3 history migration backfills the last heartbeat and enforces idempotence", async () => {
  const source = await readFile(new URL(
    "../netlify/database/migrations/20260824170000_create_automation_v3_worker_history.sql",
    import.meta.url,
  ), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS broker_automation_v3_worker_runs/);
  assert.match(source, /UNIQUE \(release_commit, started_at, completed_at\)/);
  assert.match(source, /WHERE transaction_hash IS NOT NULL/);
  assert.match(source, /FROM broker_automation_v3_worker_state/);
  assert.match(source, /ON CONFLICT DO NOTHING/);
});

test("active Punk enrollment is idempotent and contains no signing authority", async () => {
  const calls = [];
  const punk = {
    tokenId: "1639", created: true, active: true,
    account: `0x${"A".repeat(40)}`, owner: `0x${"B".repeat(40)}`,
  };
  const enrolled = await enrollAutomationV3Punk(punk, { database: {
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; },
  } });
  assert.equal(enrolled.tokenId, "1639");
  assert.equal(enrolled.account, `0x${"a".repeat(40)}`);
  assert.match(calls[0].sql, /ON CONFLICT/);
  assert.match(calls[0].sql, /last_requested_at = NOW\(\)/);
  await assert.rejects(
    () => enrollAutomationV3Punk({ ...punk, active: false }), /not active/,
  );
});

test("backfill enrollment evidence binds the exact Punk account and owner", async () => {
  const punk = { tokenId: "93", account: ACCOUNT, owner: COLLECTION };
  assert.equal(await automationV3PunkEnrollment(punk, { database: {
    async query(sql, values) {
      assert.match(sql, /token_id = \$2::numeric/);
      assert.equal(values[1], "93");
      return { rows: [{ account_address: ACCOUNT, owner_snapshot: COLLECTION }] };
    },
  } }), true);
  assert.equal(await automationV3PunkEnrollment(punk, { database: {
    async query() { return { rows: [] }; },
  } }), false);
  assert.equal(await automationV3PunkEnrollment(punk, { database: {
    async query() { return { rows: [{ account_address: ACCOUNT,
      owner_snapshot: `0x${"4".repeat(40)}` }] }; },
  } }), false);
});

test("V3 enrollment migration keeps a chain-qualified public Punk roster", async () => {
  const source = await readFile(new URL(
    "../netlify/database/migrations/20260825010000_create_automation_v3_enrollments.sql",
    import.meta.url,
  ), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS broker_automation_v3_enrollments/);
  assert.match(source, /PRIMARY KEY \(chain_id, collection_address, token_id\)/);
  assert.doesNotMatch(source, /private_key|signature|password/i);
});
