import assert from "node:assert/strict";
import test from "node:test";

import {
  recordAutomationV2WorkerHeartbeat,
  workerHeartbeatFromRow,
  workerHeartbeatIsCurrent,
} from "../netlify/functions/_shared/automation-v2-worker-state.mjs";

const release = "a".repeat(40);
const row = {
  release_commit: release,
  started_at: new Date("2026-08-23T19:46:58.000Z"),
  completed_at: new Date("2026-08-23T19:47:03.000Z"),
  status: "NO_ELIGIBLE_TARGETS",
  submitted: 0,
  punk_token_id: null,
  account_address: null,
  collection_address: null,
  transaction_hash: null,
  failure_code: null,
};

test("worker heartbeat exposes a bounded fresh public status", () => {
  const heartbeat = workerHeartbeatFromRow(row);
  assert.equal(heartbeat.status, "NO_ELIGIBLE_TARGETS");
  assert.equal(workerHeartbeatIsCurrent(
    heartbeat,
    release,
    Date.parse("2026-08-23T19:55:00.000Z"),
  ), true);
  assert.equal(workerHeartbeatIsCurrent(
    heartbeat,
    release,
    Date.parse("2026-08-23T20:00:00.000Z"),
  ), false);
  assert.equal(workerHeartbeatIsCurrent(heartbeat, "b".repeat(40), Date.parse(row.completed_at)), false);
});

test("worker heartbeat persistence is monotonic and rejects false mint claims", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [row] };
    },
  };
  const saved = await recordAutomationV2WorkerHeartbeat(
    { status: "NO_ELIGIBLE_TARGETS", submitted: 0 },
    {
      database,
      release,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    },
  );
  assert.equal(saved.status, "NO_ELIGIBLE_TARGETS");
  assert.match(calls[0].sql, /completed_at <= EXCLUDED\.completed_at/);
  await assert.rejects(
    recordAutomationV2WorkerHeartbeat(
      { status: "MINT_CONFIRMED", submitted: 1 },
      { database, release, startedAt: row.started_at, completedAt: row.completed_at },
    ),
    /incomplete/,
  );
});
