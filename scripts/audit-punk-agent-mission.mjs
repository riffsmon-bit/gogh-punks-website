import pg from "pg";
import { execFileSync } from "node:child_process";

// Read-only production diagnostic. Credentials are supplied by the environment;
// never print connection strings, signed operations, or session key material.
const tokenId = process.argv[2] ?? "93";
if (!/^[0-9]+$/.test(tokenId)) throw new TypeError("Invalid Punk token ID");
let connectionString = process.env.NETLIFY_DB_URL;
if (process.argv.includes("--production")) {
  const cli = process.env.NETLIFY_CLI_PATH;
  if (!cli) throw new Error("NETLIFY_CLI_PATH is required for production audit");
  try {
    const status = JSON.parse(execFileSync(process.execPath, [cli, "database", "status",
      "--branch", "production", "--show-credentials", "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000,
    }));
    connectionString = status.database?.connectionString;
  } catch { throw new Error("Production database connection could not be resolved"); }
}
if (!connectionString) throw new Error("Database connection is unavailable");
const pool = new pg.Pool({ connectionString,
  connectionTimeoutMillis: 10000, max: 1,
  options: "-c default_transaction_read_only=on -c statement_timeout=15000" });
try {
  const session = await pool.query(`SELECT session_id, status, punk_account,
    valid_after, valid_until, max_mints_per_day, max_mints_total, updated_at
    FROM broker_v2_agent_sessions WHERE chain_id = 4663 AND punk_token_id = $1
    ORDER BY created_at DESC LIMIT 1`, [tokenId]);
  const activity = await pool.query(`SELECT activity_type, public_detail, occurred_at
    FROM broker_v2_activity WHERE chain_id = 4663 AND punk_token_id = $1
    ORDER BY occurred_at DESC LIMIT 12`, [tokenId]);
  const operations = await pool.query(`SELECT operation.state, operation.rejection_code,
    operation.transaction_hash, operation.created_at, operation.updated_at
    FROM broker_v2_agent_user_operations operation
    JOIN broker_v2_agent_sessions session USING (session_id)
    WHERE session.chain_id = 4663 AND session.punk_token_id = $1
    ORDER BY operation.created_at DESC LIMIT 5`, [tokenId]);
  const queue = await pool.query(`SELECT screening_status, COUNT(*)::integer AS count,
    MAX(updated_at) AS latest_update FROM broker_v2_opportunities
    WHERE chain_id = 4663 GROUP BY screening_status`);
  console.log(JSON.stringify({ readOnly: true, tokenId, checkedAt: new Date().toISOString(),
    session: session.rows[0] ?? null, activity: activity.rows,
    operations: operations.rows, queue: queue.rows }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code ?? "AUDIT_FAILED" }));
  process.exitCode = 1;
} finally { await pool.end(); }
