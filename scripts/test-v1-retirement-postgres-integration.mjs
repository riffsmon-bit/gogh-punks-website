import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.argv.includes("--production-rollback")) {
  throw new Error("V1 retirement integration requires --production-rollback");
}

function connectionString(environment = process.env) {
  const value = environment.SUPABASE_DATABASE_URL ?? environment.SUPABASE_DB_URL;
  if (typeof value !== "string" || !/^postgres(?:ql)?:\/\//.test(value)) {
    throw new Error("Supabase database URL is required");
  }
  return value;
}

const migrations = await Promise.all([
  "20260902043000_prepare_v4_legacy_reconciliation",
  "20260903221000_schedule_v1_retirement",
].map((name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
  "utf8")));

const pool = new pg.Pool({
  connectionString: connectionString(),
  max: 1,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 2_000,
  allowExitOnIdle: true,
  application_name: "gogh-v1-retirement-integration-rollback",
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const migration of migrations) await client.query(migration);
  const databaseClock = await client.query(
    `SELECT NOW() AS now, '2026-09-04T22:00:00Z'::timestamptz AS shutdown_at`,
  );
  const first = await client.query("SELECT * FROM gogh_broker_finalize_v1_retirement()");
  const second = await client.query("SELECT * FROM gogh_broker_finalize_v1_retirement()");
  const metadata = await client.query(
    `SELECT routine.routine_definition IS NOT NULL AS function_present,
            procedure.prosecdef AS security_definer,
            procedure.proconfig = ARRAY['search_path=public']::text[] AS fixed_search_path,
            table_info.relrowsecurity AS row_security,
            has_function_privilege('service_role',
              'gogh_broker_finalize_v1_retirement()', 'EXECUTE') AS service_execute
       FROM information_schema.routines AS routine
       JOIN pg_proc AS procedure ON procedure.proname = routine.routine_name
       JOIN pg_class AS table_info ON table_info.relname = 'gogh_broker_v1_retirement'
      WHERE routine.routine_schema = 'public'
        AND routine.routine_name = 'gogh_broker_finalize_v1_retirement'
      LIMIT 1`,
  );
  const now = new Date(databaseClock.rows[0].now);
  const shutdownAt = new Date(databaseClock.rows[0].shutdown_at);
  const expectedState = now < shutdownAt ? "V1_SUNSET_PENDING" : first.rows[0]?.retirement_state;
  const meta = metadata.rows[0];
  if (first.rows.length !== 1 || second.rows.length !== 1
    || first.rows[0]?.retirement_state !== expectedState
    || second.rows[0]?.retirement_state !== first.rows[0]?.retirement_state
    || meta?.function_present !== true || meta?.security_definer !== true
    || meta?.fixed_search_path !== true || meta?.row_security !== true
    || meta?.service_execute !== true) {
    throw new Error("V1 retirement PostgreSQL integration assertions failed");
  }
  console.log(JSON.stringify({
    mode: "PRODUCTION_ROLLBACK",
    migrationCount: migrations.length,
    databaseClockBeforeCutoff: now < shutdownAt,
    firstState: first.rows[0].retirement_state,
    repeatedState: second.rows[0].retirement_state,
    functionPresent: meta.function_present,
    securityDefiner: meta.security_definer,
    fixedSearchPath: meta.fixed_search_path,
    rowSecurity: meta.row_security,
    serviceRoleExecute: meta.service_execute,
    committed: false,
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
