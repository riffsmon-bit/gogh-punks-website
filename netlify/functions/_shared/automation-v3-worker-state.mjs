import { getDatabase } from "@netlify/database";

const STATUSES = new Set([
  "NO_AUTONOMOUS_MANDATES",
  "NO_ANALYZED_ACTIVE_TARGETS",
  "NO_ELIGIBLE_TARGETS",
  "MINT_CONFIRMED",
  "FAILED",
]);

function text(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${name} is invalid`);
  return value.toLowerCase();
}

function optional(value, pattern, name) {
  return value == null ? null : text(value, pattern, name);
}

function iso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} is invalid`);
  return date.toISOString();
}

function rowValue(row, snake, camel) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function count(value, name) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) throw new TypeError(`${name} is invalid`);
  return normalized;
}

function optionalIso(value, name) {
  return value == null ? null : iso(value, name);
}

export function workerUsageFromRow(row) {
  if (!row) return null;
  return Object.freeze({
    confirmedMints: count(rowValue(row, "confirmed_mints", "confirmedMints"), "confirmedMints"),
    mintingPunks: count(rowValue(row, "minting_punks", "mintingPunks"), "mintingPunks"),
    autonomousPreferenceWallets: count(
      rowValue(row, "autonomous_preference_wallets", "autonomousPreferenceWallets"),
      "autonomousPreferenceWallets",
    ),
    recordedRuns: count(rowValue(row, "recorded_runs", "recordedRuns"), "recordedRuns"),
    trackedSince: optionalIso(rowValue(row, "tracked_since", "trackedSince"), "trackedSince"),
    latestConfirmedAt: optionalIso(
      rowValue(row, "latest_confirmed_at", "latestConfirmedAt"), "latestConfirmedAt",
    ),
  });
}

export function workerHeartbeatFromRow(row) {
  if (!row) return null;
  const heartbeat = {
    release: text(rowValue(row, "release_commit", "release"), /^[0-9a-f]{40}$/, "release"),
    startedAt: iso(rowValue(row, "started_at", "startedAt"), "startedAt"),
    completedAt: iso(rowValue(row, "completed_at", "completedAt"), "completedAt"),
    status: String(rowValue(row, "status", "status")),
    submitted: Number(rowValue(row, "submitted", "submitted")),
    tokenId: rowValue(row, "punk_token_id", "tokenId") == null
      ? null : String(rowValue(row, "punk_token_id", "tokenId")),
    account: optional(rowValue(row, "account_address", "account"), /^0x[0-9a-f]{40}$/, "account"),
    collection: optional(rowValue(row, "collection_address", "collection"), /^0x[0-9a-f]{40}$/, "collection"),
    transactionHash: optional(rowValue(row, "transaction_hash", "transactionHash"), /^0x[0-9a-f]{64}$/, "transactionHash"),
    failureCode: rowValue(row, "failure_code", "failureCode") == null
      ? null : String(rowValue(row, "failure_code", "failureCode")),
  };
  if (!STATUSES.has(heartbeat.status) || ![0, 1].includes(heartbeat.submitted)
    || (heartbeat.tokenId !== null && !/^(?:0|[1-9][0-9]*)$/.test(heartbeat.tokenId))
    || (heartbeat.failureCode !== null && !/^[A-Z0-9_]{1,128}$/.test(heartbeat.failureCode))) {
    throw new TypeError("worker heartbeat is invalid");
  }
  return Object.freeze(heartbeat);
}

export function workerHeartbeatIsCurrent(heartbeat, release, nowMs = Date.now()) {
  if (!heartbeat || heartbeat.release !== release || heartbeat.status === "FAILED"
    || !Number.isSafeInteger(nowMs) || nowMs < 0) return false;
  const completed = Date.parse(heartbeat.completedAt);
  return Number.isFinite(completed) && completed <= nowMs + 30_000
    && completed >= nowMs - 12 * 60_000;
}

export async function recordAutomationV3WorkerHeartbeat(result, options = {}) {
  const release = text(options.release, /^[0-9a-f]{40}$/, "release");
  const startedAt = iso(options.startedAt, "startedAt");
  const completedAt = iso(options.completedAt, "completedAt");
  const status = String(result?.status ?? "FAILED");
  if (!STATUSES.has(status)) throw new TypeError("worker status is invalid");
  const submitted = Number(result?.submitted ?? 0);
  if (![0, 1].includes(submitted)) throw new TypeError("worker submitted count is invalid");
  const tokenId = result?.tokenId == null ? null : String(result.tokenId);
  if (tokenId !== null && !/^(?:0|[1-9][0-9]*)$/.test(tokenId)) throw new TypeError("worker token ID is invalid");
  const account = optional(result?.account, /^0x[0-9a-fA-F]{40}$/, "account");
  const collection = optional(result?.collection, /^0x[0-9a-fA-F]{40}$/, "collection");
  const transactionHash = optional(result?.transactionHash, /^0x[0-9a-fA-F]{64}$/, "transactionHash");
  const failureCode = result?.failureCode == null ? null : String(result.failureCode);
  if (failureCode !== null && !/^[A-Z0-9_]{1,128}$/.test(failureCode)) throw new TypeError("failure code is invalid");
  if (status === "MINT_CONFIRMED") {
    if (submitted !== 1 || tokenId === null || !account || !collection || !transactionHash || failureCode) {
      throw new TypeError("confirmed worker heartbeat is incomplete");
    }
  } else if (submitted !== 0 || transactionHash) {
    throw new TypeError("non-mint worker heartbeat cannot claim a transaction");
  }
  if ((status === "FAILED") !== (failureCode !== null)) {
    throw new TypeError("worker failure code does not match status");
  }
  const database = options.database ?? getDatabase().pool;
  const query = await database.query(
    `WITH recorded AS (
       INSERT INTO broker_automation_v3_worker_runs
        (release_commit, started_at, completed_at, status, submitted,
         punk_token_id, account_address, collection_address, transaction_hash, failure_code)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING run_id
     )
     INSERT INTO broker_automation_v3_worker_state
      (singleton_id, release_commit, started_at, completed_at, status, submitted,
       punk_token_id, account_address, collection_address, transaction_hash, failure_code)
     VALUES (1, $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10)
     ON CONFLICT (singleton_id) DO UPDATE SET
       release_commit = EXCLUDED.release_commit,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       status = EXCLUDED.status,
       submitted = EXCLUDED.submitted,
       punk_token_id = EXCLUDED.punk_token_id,
       account_address = EXCLUDED.account_address,
       collection_address = EXCLUDED.collection_address,
       transaction_hash = EXCLUDED.transaction_hash,
       failure_code = EXCLUDED.failure_code
     WHERE broker_automation_v3_worker_state.completed_at <= EXCLUDED.completed_at
     RETURNING *`,
    [release, startedAt, completedAt, status, submitted, tokenId, account, collection, transactionHash, failureCode],
  );
  return query.rows[0] ? workerHeartbeatFromRow(query.rows[0]) : null;
}

export async function getAutomationV3WorkerHeartbeat(options = {}) {
  const database = options.database ?? getDatabase().pool;
  const result = await database.query(
    `SELECT * FROM broker_automation_v3_worker_state WHERE singleton_id = 1 LIMIT 1`,
  );
  return workerHeartbeatFromRow(result.rows[0]);
}

export async function getAutomationV3UsageStats(options = {}) {
  const database = options.database ?? getDatabase().pool;
  const result = await database.query(
    `WITH latest_mandates AS (
       SELECT DISTINCT ON (chain_id, collection_address, token_id)
              configured_by, mode
         FROM broker_art_mandates
        WHERE chain_id = 4663
        ORDER BY chain_id, collection_address, token_id, version DESC
     ), worker_stats AS (
       SELECT COUNT(*) FILTER (WHERE status = 'MINT_CONFIRMED') AS confirmed_mints,
              COUNT(DISTINCT punk_token_id) FILTER (WHERE status = 'MINT_CONFIRMED') AS minting_punks,
              COUNT(*) AS recorded_runs,
              MIN(completed_at) AS tracked_since,
              MAX(completed_at) FILTER (WHERE status = 'MINT_CONFIRMED') AS latest_confirmed_at
         FROM broker_automation_v3_worker_runs
     ), preference_stats AS (
       SELECT COUNT(DISTINCT configured_by) FILTER (WHERE mode = 'AUTONOMOUS')
                AS autonomous_preference_wallets
         FROM latest_mandates
     )
     SELECT worker_stats.*, preference_stats.autonomous_preference_wallets
       FROM worker_stats CROSS JOIN preference_stats`,
  );
  return workerUsageFromRow(result.rows[0]);
}
