import { readFile } from "node:fs/promises";
import pg from "pg";

const MIGRATIONS = Object.freeze([
  "20260830210000_create_gogh_broker_operational_shadow",
  "20260831220000_add_punk_agent_gas_credits",
  "20260831233000_add_punk_priority_sessions",
  "20260901090000_add_priority_gas_usage_refunds",
]);
const APPLY = process.argv.includes("--apply");

function connectionString(environment = process.env) {
  const raw = environment.SUPABASE_DATABASE_URL ?? environment.SUPABASE_DB_URL;
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 2_048) {
    throw new Error("SUPABASE_DATABASE_URL or SUPABASE_DB_URL is required");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Supabase database URL is invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)
    || !parsed.hostname || !parsed.pathname || parsed.hash) {
    throw new Error("Supabase database URL is invalid");
  }
  return raw;
}

const pool = new pg.Pool({
  connectionString: connectionString(),
  max: 1,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 2_000,
  allowExitOnIdle: true,
  application_name: "gogh-broker-migration",
});
const client = await pool.connect();
try {
  const identity = await client.query(
    "SELECT current_database() AS database, current_user AS role",
  );
  const already = await client.query(
    `SELECT to_regclass('public.gogh_broker_punk_jobs') IS NOT NULL AS jobs,
            to_regclass('public.gogh_broker_punk_state') IS NOT NULL AS states,
            to_regclass('public.gogh_broker_punk_agent_gas_accounts') IS NOT NULL AS gas_accounts,
            to_regclass('public.gogh_broker_punk_agent_gas_deposits') IS NOT NULL AS gas_deposits,
            to_regclass('public.gogh_broker_punk_priority_sessions') IS NOT NULL AS priority_sessions,
            to_regclass('public.gogh_broker_punk_agent_gas_usage') IS NOT NULL AS gas_usage,
            to_regclass('public.gogh_broker_punk_agent_gas_refunds') IS NOT NULL AS gas_refunds`,
  );
  console.log(JSON.stringify({
    migrations: MIGRATIONS,
    mode: APPLY ? "APPLY" : "DRY_RUN",
    connected: identity.rows.length === 1,
    databaseNamePresent: Boolean(identity.rows[0]?.database),
    databaseRolePresent: Boolean(identity.rows[0]?.role),
    tablesPresent: already.rows[0]?.jobs === true && already.rows[0]?.states === true,
    prepaidGasTablesPresent: already.rows[0]?.gas_accounts === true
      && already.rows[0]?.gas_deposits === true,
    prioritySessionTablePresent: already.rows[0]?.priority_sessions === true,
    receiptMeteringTablesPresent: already.rows[0]?.gas_usage === true
      && already.rows[0]?.gas_refunds === true,
  }));
  if (APPLY) {
    const statements = await Promise.all(MIGRATIONS.map((migration) => readFile(new URL(
      `../supabase/migrations/${migration}.sql`, import.meta.url,
    ), "utf8")));
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(4663210000)");
      for (const sql of statements) await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const verified = await client.query(
      `SELECT COUNT(*)::integer AS table_count
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [["gogh_broker_punk_state", "gogh_broker_punk_jobs", "gogh_broker_worker_runs",
        "gogh_broker_agent_activity", "gogh_broker_ownership_projection",
        "gogh_broker_diagnostics", "gogh_broker_punk_agent_gas_accounts",
        "gogh_broker_punk_agent_gas_deposits", "gogh_broker_punk_priority_sessions",
        "gogh_broker_punk_agent_gas_usage", "gogh_broker_punk_agent_gas_refunds"]],
    );
    console.log(JSON.stringify({
      migrations: MIGRATIONS,
      applied: true,
      verifiedTableCount: Number(verified.rows[0]?.table_count ?? 0),
      expectedTableCount: 11,
    }));
  }
} finally {
  client.release();
  await pool.end();
}
