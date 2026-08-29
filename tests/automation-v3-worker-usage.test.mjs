import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enrollAutomationV3Punk, getAutomationV3UsageStats,
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

test("V3 enrollment migration keeps a chain-qualified public Punk roster", async () => {
  const source = await readFile(new URL(
    "../netlify/database/migrations/20260825010000_create_automation_v3_enrollments.sql",
    import.meta.url,
  ), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS broker_automation_v3_enrollments/);
  assert.match(source, /PRIMARY KEY \(chain_id, collection_address, token_id\)/);
  assert.doesNotMatch(source, /private_key|signature|password/i);
});
