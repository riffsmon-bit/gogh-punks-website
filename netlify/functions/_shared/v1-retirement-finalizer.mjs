import { getDatabase } from "@netlify/database";
import { brokerMigrationState } from "./broker-migration-state.mjs";
import { finalizeSupabaseV1Retirement } from "./supabase-operational-store.mjs";

function count(value, name) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${name} is invalid`);
  return parsed;
}

export async function finalizeNetlifyV1Retirement(options = {}) {
  const environment = options.environment ?? process.env;
  const lifecycle = brokerMigrationState(environment, { now: options.now });
  if (!lifecycle.cutoffReached) {
    return Object.freeze({ state: lifecycle.state, executed: false,
      enrolledPunksAtCutoff: null, paidJobsReleased: 0 });
  }
  const database = options.database ?? getDatabase().pool;
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [4_663_009]);
    const enrollment = await client.query(
      `SELECT COUNT(*)::integer AS count FROM broker_automation_v3_enrollments`,
    );
    const released = await client.query(
      `UPDATE broker_paid_mint_jobs
          SET status = 'RELEASED', updated_at = NOW()
        WHERE status = 'RESERVED'
        RETURNING job_id`,
    );
    const enrolledPunksAtCutoff = count(enrollment.rows?.[0]?.count, "enrollment count");
    const paidJobsReleased = count(released.rowCount ?? released.rows?.length,
      "released paid job count");
    await client.query(
      `UPDATE broker_v1_retirement
          SET state = 'V1_SHUTDOWN_EXECUTING',
              enrolled_punks_at_cutoff = COALESCE(enrolled_punks_at_cutoff, $1),
              paid_jobs_released = paid_jobs_released + $2,
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE singleton_id = 1`,
      [enrolledPunksAtCutoff, paidJobsReleased],
    );
    await client.query("COMMIT");
    return Object.freeze({ state: "V1_SHUTDOWN_EXECUTING", executed: true,
      enrolledPunksAtCutoff, paidJobsReleased });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readNetlifyV1Retirement(options = {}) {
  const database = options.database ?? getDatabase().pool;
  const result = await database.query(
    `SELECT state, shutdown_at, enrolled_punks_at_cutoff, paid_jobs_released,
            started_at, completed_at
       FROM broker_v1_retirement
      WHERE singleton_id = 1`,
  );
  const row = result.rows?.[0];
  return row ? Object.freeze({
    state: row.state,
    shutdownAt: new Date(row.shutdown_at).toISOString(),
    enrolledPunksAtCutoff: row.enrolled_punks_at_cutoff == null ? null
      : count(row.enrolled_punks_at_cutoff, "enrollment count"),
    paidJobsReleased: count(row.paid_jobs_released, "released paid job count"),
    startedAt: row.started_at == null ? null : new Date(row.started_at).toISOString(),
    completedAt: row.completed_at == null ? null : new Date(row.completed_at).toISOString(),
  }) : null;
}

async function noteNetlifyV1RetirementResult(state, options = {}) {
  if (!new Set(["V1_RETIRED", "REQUIRES_RECEIPT_RECONCILIATION"]).has(state)) {
    throw new TypeError("invalid V1 retirement result state");
  }
  const database = options.database ?? getDatabase().pool;
  await database.query(
    `UPDATE broker_v1_retirement
        SET state = $1,
            completed_at = CASE WHEN $1 = 'V1_RETIRED'
              THEN COALESCE(completed_at, NOW()) ELSE NULL END,
            updated_at = NOW()
      WHERE singleton_id = 1`,
    [state],
  );
}

export async function finalizeV1Retirement(options = {}) {
  const environment = options.environment ?? process.env;
  const lifecycle = brokerMigrationState(environment, { now: options.now });
  if (!lifecycle.cutoffReached) {
    return Object.freeze({ state: lifecycle.state, executed: false,
      database: null, operational: null });
  }
  const finalizeDatabase = options.finalizeDatabase ?? finalizeNetlifyV1Retirement;
  const finalizeOperational = options.finalizeOperational ?? finalizeSupabaseV1Retirement;
  const database = await finalizeDatabase({ environment, now: options.now,
    database: options.database });
  const operational = await finalizeOperational({ environment,
    database: options.operationalDatabase });
  const reconciliationRequired = operational.attemptsRequiringReconciliation > 0;
  const state = reconciliationRequired
    ? "REQUIRES_RECEIPT_RECONCILIATION" : "V1_RETIRED";
  const noteResult = options.noteResult ?? noteNetlifyV1RetirementResult;
  await noteResult(state, { database: options.database });
  return Object.freeze({
    state,
    executed: true,
    database,
    operational,
  });
}
