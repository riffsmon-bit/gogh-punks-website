import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertHostedExecutionEnabled, assertV1RegistrationEnabled, brokerMigrationState,
  BROKER_MIGRATION_PAUSE_REASON, BROKER_V1_STATES,
  V1_REGISTRATION_CLOSED, V1_RETIRED_REASON, V1_SHUTDOWN_AT, V1_SHUTDOWN_AT_MS,
} from "../netlify/functions/_shared/broker-migration-state.mjs";
import {
  backgroundRpcDecision,
} from "../netlify/functions/_shared/background-rpc-policy.mjs";
import {
  runAutomationV3Once,
} from "../netlify/functions/_shared/automation-v3-runner.mjs";
import {
  confirmPrepaidAgentGas, prepaidAgentGasStatus,
} from "../netlify/functions/broker-punk-agent-gas.mjs";
import { finalizeV1Retirement } from
  "../netlify/functions/_shared/v1-retirement-finalizer.mjs";
import { AUTOMATION_V3_AGENT } from
  "../netlify/functions/_shared/autonomy-v3-live.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const RELEASE = "a".repeat(40);
const BEFORE_CUTOFF = V1_SHUTDOWN_AT_MS - 1;
const PAUSED_ENVIRONMENT = Object.freeze({
  BROKER_V4_MIGRATION_STATE: "PAUSED_MIGRATION",
  BROKER_SUPABASE_QUEUE_MODE: "SHADOW",
  SUPABASE_DATABASE_URL: "postgresql://server-only:secret@db.example.invalid/postgres",
  BROKER_AUTOMATION_V3_WORKER_RELEASE: RELEASE,
  BROKER_AUTOMATION_V3_ENABLED: "true",
  BROKER_AUTOMATION_V3_AGENT_ADDRESS: AUTOMATION_V3_AGENT,
  BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: `0x${"b".repeat(64)}`,
});

test("migration pause is explicit and takes precedence over generic background controls", () => {
  const migration = brokerMigrationState(PAUSED_ENVIRONMENT, { now: BEFORE_CUTOFF });
  assert.equal(migration.state, "PAUSED_MIGRATION");
  assert.equal(migration.paused, true);
  assert.equal(migration.reason, BROKER_MIGRATION_PAUSE_REASON);
  assert.equal(migration.hostedExecutionEnabled, false);
  assert.equal(migration.hostedFundingEnabled, false);
  assert.equal(migration.withdrawalsEnabled, true);
  assert.equal(backgroundRpcDecision({
    ...PAUSED_ENVIRONMENT,
    CONTEXT: "production",
    PAUSE_BACKGROUND_RPC: "true",
  }, "AUTOMATION_V3_WORKER", { now: BEFORE_CUTOFF }).reason, "MIGRATION_PAUSE");
  assert.equal(backgroundRpcDecision(PAUSED_ENVIRONMENT, "BROKER_INDEXER",
    { now: BEFORE_CUTOFF }).enabled, true);
  assert.throws(() => assertHostedExecutionEnabled(PAUSED_ENVIRONMENT,
    { now: BEFORE_CUTOFF }),
    (error) => error.code === BROKER_MIGRATION_PAUSE_REASON);
});

test("canonical shutdown clock is exact at every required boundary", () => {
  assert.equal(V1_SHUTDOWN_AT, "2026-09-05T22:00:00Z");
  for (const delta of [-3_600_000, -60_000, -1_000, -1]) {
    const state = brokerMigrationState({}, { now: V1_SHUTDOWN_AT_MS + delta });
    assert.equal(state.v1State, BROKER_V1_STATES.ACTIVE);
    assert.equal(state.state, BROKER_V1_STATES.SUNSET_PENDING);
    assert.equal(state.hostedExecutionEnabled, true);
    assert.equal(state.registrationEnabled, true);
    assert.equal(state.hostedFundingEnabled, false);
  }
  for (const delta of [0, 1_000, 60_000, 3_600_000]) {
    const state = brokerMigrationState({}, { now: V1_SHUTDOWN_AT_MS + delta });
    assert.equal(state.v1State, BROKER_V1_STATES.RETIRED);
    assert.equal(state.state, BROKER_V1_STATES.RETIRED);
    assert.equal(state.transitionState, BROKER_V1_STATES.SHUTDOWN_EXECUTING);
    assert.equal(state.hostedExecutionEnabled, false);
    assert.equal(state.registrationEnabled, false);
    assert.equal(state.withdrawalsEnabled, true);
    assert.throws(() => assertHostedExecutionEnabled({}, {
      now: V1_SHUTDOWN_AT_MS + delta,
    }), (error) => error.code === V1_RETIRED_REASON);
    assert.throws(() => assertV1RegistrationEnabled({}, {
      now: V1_SHUTDOWN_AT_MS + delta,
    }), (error) => error.code === V1_REGISTRATION_CLOSED);
  }
  assert.equal(brokerMigrationState({ BROKER_V1_RETIREMENT_COMPLETE: "true" }, {
    now: V1_SHUTDOWN_AT_MS,
  }).transitionState, BROKER_V1_STATES.V2_COMING_SOON);
});

test("V3 runner stops before database acquisition, discovery, or submission", async () => {
  let databaseTouched = false;
  let workerTouched = false;
  await assert.rejects(() => runAutomationV3Once({
    environment: PAUSED_ENVIRONMENT,
    now: () => BEFORE_CUTOFF,
    database: { connect() { databaseTouched = true; throw new Error("database touched"); } },
    worker: async () => { workerTouched = true; throw new Error("worker touched"); },
  }), (error) => error.code === BROKER_MIGRATION_PAUSE_REASON);
  assert.equal(databaseTouched, false);
  assert.equal(workerTouched, false);
});

test("hosted balance remains readable while new hosted funding fails before mutation", async () => {
  const status = await prepaidAgentGasStatus("93", OWNER, {
    environment: PAUSED_ENVIRONMENT,
    now: () => BEFORE_CUTOFF,
    readPunk: async () => ({ tokenId: "93", owner: OWNER, created: true, active: true }),
    getBalance: async () => ({ available: true, creditedWei: "500000000000000",
      spentWei: "100000000000000", availableWei: "400000000000000", updatedAt: null }),
  });
  assert.equal(status.fundingEnabled, false);
  assert.equal(status.fundingState, "LEGACY_READ_ONLY");
  assert.equal(status.availableWei, "400000000000000");

  let mutationTouched = false;
  await assert.rejects(() => confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: "500000000000000", mintLimit: 1,
    durationDays: 7, transactionHash: `0x${"c".repeat(64)}`,
  }, {
    environment: PAUSED_ENVIRONMENT,
    now: () => BEFORE_CUTOFF,
    readTransaction: async () => { mutationTouched = true; },
    recordCredit: async () => { mutationTouched = true; },
    runNow: async () => { mutationTouched = true; },
  }), (error) => error.code === "PREPAID_FUNDING_RETIRED" && error.status === 410);
  assert.equal(mutationTouched, false);
});

test("migration UI keeps Punk authorization separate from system pause", async () => {
  const [control, statusRoute, fundingRoute, v3Worker, v2Worker, sunset] = await Promise.all([
    readFile(new URL("../site/punk-control-center.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-autonomy-v3-status.mjs", import.meta.url),
      "utf8"),
    readFile(new URL("../netlify/functions/broker-punk-agent-gas.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-automated-seadrop-v3-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-automated-seadrop-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../site/broker-sunset.js", import.meta.url), "utf8"),
  ]);
  assert.match(control, /System paused for V4 migration/);
  assert.match(control, /no repair or wallet reconnection is required/);
  assert.match(statusRoute, /status: migration\.state/);
  assert.match(statusRoute, /scheduledRetry: false/);
  assert.match(fundingRoute, /state: "LEGACY_READ_ONLY"/);
  assert.match(v3Worker, /assertHostedExecutionEnabled\(environment, \{ now: clock \}\);[\s\S]{0,400}createWalletClient/);
  assert.match(v2Worker, /assertHostedExecutionEnabled\(environment, \{ now: clock \}\);[\s\S]{0,300}wallet\.sendTransaction/);
  assert.match(sunset, /2026-09-05T22:00:00Z/);
  assert.match(sunset, /performance\.now/);
});

test("at cutoff the runner stops before database acquisition and registration closes", async () => {
  let touched = false;
  await assert.rejects(() => runAutomationV3Once({
    environment: { ...PAUSED_ENVIRONMENT, BROKER_V4_MIGRATION_STATE: "" },
    now: () => V1_SHUTDOWN_AT_MS,
    database: { connect() { touched = true; } },
  }), (error) => error.code === V1_RETIRED_REASON);
  assert.equal(touched, false);
  assert.equal(backgroundRpcDecision({}, "AUTOMATION_V3_WORKER",
    { now: V1_SHUTDOWN_AT_MS }).reason, "V1_RETIRED");
  assert.equal(backgroundRpcDecision({}, "BROKER_SCOUT",
    { now: V1_SHUTDOWN_AT_MS }).reason, "V1_RETIRED");
  assert.equal(backgroundRpcDecision({}, "BROKER_INDEXER",
    { now: V1_SHUTDOWN_AT_MS }).enabled, true);
});

test("retirement finalization is convergent and preserves receipt reconciliation", async () => {
  let calls = 0;
  const before = await finalizeV1Retirement({ now: () => BEFORE_CUTOFF,
    finalizeDatabase: async () => { calls += 1; },
    finalizeOperational: async () => { calls += 1; } });
  assert.equal(before.executed, false);
  assert.equal(calls, 0);

  const database = { state: "V1_SHUTDOWN_EXECUTING", enrolledPunksAtCutoff: 273 };
  const retired = await finalizeV1Retirement({ now: () => V1_SHUTDOWN_AT_MS,
    finalizeDatabase: async () => { calls += 1; return database; },
    finalizeOperational: async () => { calls += 1; return {
      state: "V1_RETIRED", attemptsRequiringReconciliation: 0,
    }; }, noteResult: async () => { calls += 1; } });
  assert.equal(retired.state, "V1_RETIRED");
  assert.equal(retired.database, database);

  const reconciling = await finalizeV1Retirement({ now: () => V1_SHUTDOWN_AT_MS + 1,
    finalizeDatabase: async () => database,
    finalizeOperational: async () => ({
      state: "REQUIRES_RECEIPT_RECONCILIATION", attemptsRequiringReconciliation: 1,
    }), noteResult: async () => {} });
  assert.equal(reconciling.state, "REQUIRES_RECEIPT_RECONCILIATION");
});

test("additive retirement migration cancels only unsubmitted work", async () => {
  const [migration, reschedule] = await Promise.all([
    readFile(new URL(
      "../supabase/migrations/20260903221000_schedule_v1_retirement.sql", import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../supabase/migrations/20260904030000_reschedule_v1_retirement_to_september_5.sql",
      import.meta.url,
    ), "utf8"),
  ]);
  assert.match(reschedule, /2026-09-05T22:00:00Z/g);
  assert.match(migration, /job\.state IN \('QUEUED', 'RETRY', 'LEASED'\)/);
  assert.match(migration, /attempt\.state = 'CLAIMED'/);
  assert.match(migration, /attempt\.state IN \('SUBMISSION_RESERVED', 'SUBMITTED'\)/);
  assert.match(migration, /REQUIRES_RECEIPT_RECONCILIATION/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
