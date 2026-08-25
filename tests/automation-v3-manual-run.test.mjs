import assert from "node:assert/strict";
import test from "node:test";

import { runSelectedAutomationV3 } from
  "../netlify/functions/broker-autonomy-v3-run.mjs";
import { runAutomationV3Once } from
  "../netlify/functions/_shared/automation-v3-runner.mjs";

test("manual V3 run scopes the existing worker to one active Punk", async () => {
  const calls = [];
  const enrollments = [];
  const result = await runSelectedAutomationV3({ tokenId: "1797" }, {
    readPunk: async (tokenId) => ({
      tokenId, created: true, active: true,
      account: `0x${"1".repeat(40)}`, owner: `0x${"2".repeat(40)}`,
    }),
    enroll: async (punk) => { enrollments.push(punk.tokenId); },
    runOnce: async (options) => {
      calls.push(options);
      return { status: "NO_ANALYZED_ACTIVE_TARGETS", submitted: 0 };
    },
  });
  assert.deepEqual(enrollments, ["1797"]);
  assert.deepEqual(calls, [{ requestedTokenId: "1797" }]);
  assert.deepEqual(result, {
    tokenId: "1797", status: "NO_ANALYZED_ACTIVE_TARGETS", submitted: 0,
    collection: null, transactionHash: null,
  });
});

test("manual V3 run rejects ambiguity and inactive authority", async () => {
  await assert.rejects(() => runSelectedAutomationV3({ tokenId: "01797" }, {}),
    /valid Punk/);
  await assert.rejects(() => runSelectedAutomationV3({ tokenId: "1797", extra: true }, {}),
    /valid Punk/);
  await assert.rejects(() => runSelectedAutomationV3({ tokenId: "1797" }, {
    readPunk: async (tokenId) => ({ tokenId, created: true, active: false }),
    enroll: async () => assert.fail("inactive Punk must not be enrolled"),
  }), /not currently authorized/);
});

test("worker runner holds one global lock and preserves the scoped Punk", async () => {
  const queries = [];
  const client = {
    query: async (sql, values) => {
      queries.push([sql, values]);
      return sql.includes("INSERT INTO broker_automation_v3_worker_leases")
        ? { rows: [{ holder: values[1] }] } : { rows: [] };
    },
    release() { queries.push(["release"]); },
  };
  const database = { connect: async () => client };
  const workerCalls = [];
  const records = [];
  const result = await runAutomationV3Once({
    environment: { BROKER_AUTOMATION_V3_WORKER_RELEASE: "a".repeat(40) },
    database,
    requestedTokenId: "1797",
    worker: async (environment, dependencies) => {
      workerCalls.push([environment, dependencies]);
      return { status: "NO_ANALYZED_ACTIVE_TARGETS", submitted: 0 };
    },
    record: async (...values) => { records.push(values); },
  });
  assert.equal(result.status, "NO_ANALYZED_ACTIVE_TARGETS");
  assert.equal(workerCalls[0][1].requestedTokenId, "1797");
  assert.equal(records.length, 1);
  assert.match(queries[0][0], /lease_until <= NOW/);
  assert.match(queries.at(-2)[0], /DELETE FROM broker_automation_v3_worker_leases/);
  assert.deepEqual(queries.at(-1), ["release"]);
});

test("worker runner fails closed when another run holds the lock", async () => {
  let called = false;
  const client = {
    query: async () => ({ rows: [] }),
    release() {},
  };
  const result = await runAutomationV3Once({
    database: { connect: async () => client },
    worker: async () => { called = true; },
  });
  assert.deepEqual(result, { status: "RUN_IN_PROGRESS", submitted: 0 });
  assert.equal(called, false);
});

test("worker lease is crash-recoverable and bounded beyond the function timeout", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../netlify/database/migrations/20260825080000_create_automation_v3_worker_lease.sql", import.meta.url),
    "utf8",
  ));
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../netlify/functions/_shared/automation-v3-runner.mjs", import.meta.url),
    "utf8",
  ));
  assert.match(migration, /lease_until TIMESTAMPTZ NOT NULL/);
  assert.match(source, /WORKER_LEASE_MILLISECONDS = 240_000/);
  assert.match(source, /lease_until <= NOW\(\)/);
  assert.doesNotMatch(source, /pg_try_advisory_lock|pg_advisory_unlock/);
});
