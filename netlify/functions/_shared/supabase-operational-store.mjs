import { createHash } from "node:crypto";
import pg from "pg";

const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const MODES = new Set(["DISABLED", "SHADOW", "CANARY", "ACTIVE"]);
const WORKER_STATES = new Map([
  ["QUEUED", "QUEUED"],
  ["READY", "VERIFYING"],
  ["SKIPPED", "WAITING"],
  ["MINTED", "MINTED"],
  ["ERROR", "ERROR"],
]);
let cachedConnectionString;
let cachedPool;

function mode(value) {
  const normalized = String(value ?? "DISABLED").trim().toUpperCase();
  if (!MODES.has(normalized)) throw new TypeError("Supabase operational mode is invalid");
  return normalized;
}

function release(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new TypeError("worker release is invalid");
  return normalized;
}

function tokenId(value) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return normalized;
}

function iso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} is invalid`);
  return date.toISOString();
}

function address(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value.toLowerCase();
}

function optionalHash(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("transaction hash is invalid");
  }
  return value.toLowerCase();
}

function positiveWei(value, name) {
  const normalized = String(value ?? "");
  if (!/^[1-9][0-9]{0,77}$/.test(normalized)) throw new TypeError(`${name} is invalid`);
  return normalized;
}

function priorityMintLimit(value) {
  const normalized = Number(value);
  if (!new Set([1, 3, 5, 10]).has(normalized)) {
    throw new TypeError("priority-session mint limit is invalid");
  }
  return normalized;
}

function priorityDurationDays(value) {
  const normalized = Number(value);
  if (!new Set([1, 3, 7, 30]).has(normalized)) {
    throw new TypeError("priority-session duration is invalid");
  }
  return normalized;
}

function uuid(value, name) {
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value.toLowerCase();
}

function normalizeWorkerId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{8,160}$/.test(value)) {
    throw new TypeError("queue worker ID is invalid");
  }
  return value;
}

function resultCode(value, fallback = "UNKNOWN_RESULT") {
  const normalized = String(value ?? fallback).toUpperCase();
  return /^[A-Z0-9_]{3,128}$/.test(normalized) ? normalized : fallback;
}

function supabaseConnectionString(environment) {
  const raw = environment.SUPABASE_DATABASE_URL ?? environment.SUPABASE_DB_URL;
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 2_048) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)
    || !parsed.hostname || !parsed.pathname || parsed.hash) return null;
  return raw;
}

export function supabaseOperationalConfiguration(environment = process.env) {
  const operationalMode = mode(environment.BROKER_SUPABASE_QUEUE_MODE);
  const configured = supabaseConnectionString(environment) !== null;
  const workerRelease = environment.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim().toLowerCase() ?? "";
  const cutoverRelease = environment.BROKER_SUPABASE_QUEUE_CUTOVER_RELEASE?.trim().toLowerCase() ?? "";
  const driving = new Set(["CANARY", "ACTIVE"]).has(operationalMode)
    && configured && /^[0-9a-f]{40}$/.test(workerRelease)
    && cutoverRelease === workerRelease
    && environment.BROKER_SUPABASE_QUEUE_CUTOVER_ACK === "I_UNDERSTAND_PER_PUNK_QUEUE_CUTOVER";
  return Object.freeze({
    mode: operationalMode,
    configured,
    shadowWrites: configured && operationalMode !== "DISABLED",
    drivesExecution: driving,
  });
}

export function prepaidPunkAgentGasConfiguration(environment = process.env) {
  const operational = supabaseOperationalConfiguration(environment);
  return Object.freeze({
    configured: operational.shadowWrites,
    agentAddress: environment.BROKER_AUTOMATION_V3_AGENT_ADDRESS?.trim().toLowerCase() ?? null,
  });
}

function operationalPool(environment, database) {
  if (database) return database;
  const connectionString = supabaseConnectionString(environment);
  if (!connectionString) throw new TypeError("Supabase database connection is unavailable");
  if (!cachedPool || cachedConnectionString !== connectionString) {
    cachedConnectionString = connectionString;
    cachedPool = new pg.Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      application_name: "gogh-broker-operational-shadow",
    });
  }
  return cachedPool;
}

function normalizedOutcome(item) {
  const selectedTokenId = tokenId(item?.tokenId);
  const legacyState = String(item?.state ?? "QUEUED");
  const workerState = WORKER_STATES.get(legacyState);
  if (!workerState) throw new TypeError("Supabase worker outcome is invalid");
  return Object.freeze({
    tokenId: selectedTokenId,
    workerState,
    result: resultCode(item?.reason, legacyState === "QUEUED"
      ? "WAITING_FOR_WORKER_CAPACITY" : "WORKER_RESULT_RECORDED"),
    account: item?.account == null ? null : address(item.account, "Punk account"),
  });
}

export async function shadowAutomationV3Run(result, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) return Object.freeze({ written: false, reason: "DISABLED" });
  const database = operationalPool(environment, options.database);
  const releaseCommit = release(options.release ?? environment.BROKER_AUTOMATION_V3_WORKER_RELEASE);
  const startedAt = iso(options.startedAt, "startedAt");
  const completedAt = iso(options.completedAt, "completedAt");
  const legacyJobId = String(options.jobId ?? "");
  if (!/^[0-9a-f-]{8,160}$/i.test(legacyJobId)) throw new TypeError("legacy job ID is invalid");
  const scheduled = Array.isArray(result?.diagnostics?.scheduledTokenIds)
    ? [...new Set(result.diagnostics.scheduledTokenIds.map(tokenId))] : [];
  if (scheduled.length > 32) throw new TypeError("Supabase scheduled Punk set is invalid");
  const outcomes = new Map((result?.diagnostics?.profileOutcomes ?? []).map((item) => {
    const normalized = normalizedOutcome(item);
    return [normalized.tokenId, normalized];
  }));
  const runId = createHash("sha256").update(`shadow:${releaseCommit}:${legacyJobId}`)
    .digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const transactionHash = optionalHash(result?.transactionHash);
  const client = typeof database.connect === "function" ? await database.connect() : database;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO gogh_broker_worker_runs
        (run_id, release_commit, mode, started_at, completed_at, status,
         scheduled_punks, successful_punks, failed_punks, submitted, failure_code)
       VALUES ($1::uuid, $2, 'SHADOW', $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (run_id) DO NOTHING`,
      [runId, releaseCommit, startedAt, completedAt,
        resultCode(result?.status, "FAILED"), scheduled.length,
        scheduled.filter((id) => outcomes.get(id)?.workerState !== "ERROR").length,
        scheduled.filter((id) => outcomes.get(id)?.workerState === "ERROR").length,
        Number(result?.submitted ?? 0), result?.failureCode == null
          ? null : resultCode(result.failureCode, "FAILED")],
    );
    for (const selectedTokenId of scheduled) {
      const outcome = outcomes.get(selectedTokenId) ?? Object.freeze({
        tokenId: selectedTokenId, workerState: "QUEUED",
        result: "WAITING_FOR_WORKER_CAPACITY", account: null,
      });
      const shadowJob = createHash("sha256")
        .update(`legacy-shadow:${legacyJobId}:${selectedTokenId}`).digest("hex");
      const eventId = createHash("sha256")
        .update(`shadow-event:${legacyJobId}:${selectedTokenId}:${outcome.workerState}`).digest("hex");
      await client.query(
        `WITH job AS (
           INSERT INTO gogh_broker_punk_jobs
             (idempotency_key, chain_id, collection_address, punk_token_id, job_kind,
              state, source, source_release, completed_at, updated_at)
           VALUES ($1, 4663, $2, $3::numeric, 'SCOUT', 'SHADOWED',
                   'LEGACY_SHADOW', $4, $5, $5)
           ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
           RETURNING job_id
         ), state AS (
           INSERT INTO gogh_broker_punk_state
             (chain_id, collection_address, punk_token_id, account_address,
              authorization_status, worker_state, current_job_id,
              last_scan_requested_at, last_scan_completed_at, last_result,
              last_successful_mint, next_eligible_scan_at, consecutive_failures,
              source_release, observed_at, updated_at)
           SELECT 4663, $2, $3::numeric, $6, 'AUTHORIZED', $7, job.job_id,
                  $8, CASE WHEN $7 = 'QUEUED' THEN NULL ELSE $5::timestamptz END,
                  $9, $10, $11,
                  CASE WHEN $7 = 'ERROR' THEN 1 ELSE 0 END, $4, $5, $5
             FROM job
           ON CONFLICT (chain_id, collection_address, punk_token_id) DO UPDATE SET
             account_address = COALESCE(EXCLUDED.account_address,
               gogh_broker_punk_state.account_address),
             authorization_status = EXCLUDED.authorization_status,
             worker_state = EXCLUDED.worker_state,
             current_job_id = EXCLUDED.current_job_id,
             last_scan_requested_at = EXCLUDED.last_scan_requested_at,
             last_scan_completed_at = COALESCE(EXCLUDED.last_scan_completed_at,
               gogh_broker_punk_state.last_scan_completed_at),
             last_result = EXCLUDED.last_result,
             last_successful_mint = COALESCE(EXCLUDED.last_successful_mint,
               gogh_broker_punk_state.last_successful_mint),
             next_eligible_scan_at = EXCLUDED.next_eligible_scan_at,
             consecutive_failures = CASE WHEN EXCLUDED.worker_state = 'ERROR'
               THEN gogh_broker_punk_state.consecutive_failures + 1 ELSE 0 END,
             source_release = EXCLUDED.source_release,
             observed_at = EXCLUDED.observed_at,
             updated_at = EXCLUDED.updated_at
           WHERE gogh_broker_punk_state.observed_at <= EXCLUDED.observed_at
           RETURNING current_job_id
         )
         INSERT INTO gogh_broker_agent_activity
           (event_id, chain_id, punk_token_id, job_id, worker_state, result_code,
            transaction_hash, source, occurred_at)
         SELECT $12, 4663, $3::numeric, state.current_job_id, $7, $9,
                CASE WHEN $7 = 'MINTED' THEN $10 ELSE NULL END,
                'LEGACY_SHADOW', $5
           FROM state
         ON CONFLICT (event_id) DO NOTHING`,
        [`legacy-shadow:${shadowJob}`, COLLECTION, selectedTokenId, releaseCommit,
          completedAt, outcome.account, outcome.workerState, startedAt, outcome.result,
          outcome.workerState === "MINTED" ? transactionHash : null,
          result?.diagnostics?.nextScanEstimate ?? null, eventId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (client !== database && typeof client.release === "function") client.release();
  }
  return Object.freeze({ written: true, mode: configuration.mode, runId, punks: scheduled.length });
}

export async function shadowOwnershipProjection(owner, tokenIds, blockNumber, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) return Object.freeze({ written: false, reason: "DISABLED" });
  const normalizedOwner = address(owner, "Punk owner");
  if (!Array.isArray(tokenIds) || tokenIds.length > 5_017
    || tokenIds.some((value) => tokenId(value) !== String(value))) {
    throw new TypeError("ownership projection is invalid");
  }
  const unique = [...new Set(tokenIds)].sort((left, right) => Number(left) - Number(right));
  if (unique.length !== tokenIds.length || typeof blockNumber !== "bigint" || blockNumber < 0n) {
    throw new TypeError("ownership projection evidence is invalid");
  }
  const database = operationalPool(environment, options.database);
  const verifiedAt = iso(options.verifiedAt ?? new Date(), "verifiedAt");
  const rpcSource = String(options.rpcSource ?? "configured-primary");
  if (!/^[a-z0-9-]{3,80}$/.test(rpcSource)) throw new TypeError("RPC source is invalid");
  await database.query(
    `INSERT INTO gogh_broker_ownership_projection
      (chain_id, collection_address, owner_address, token_ids, canonical_balance,
       verified_block, rpc_source, verified_at, updated_at)
     VALUES (4663, $1, $2, $3::numeric[], $4, $5, $6, $7, $7)
     ON CONFLICT (chain_id, collection_address, owner_address) DO UPDATE SET
       token_ids = EXCLUDED.token_ids,
       canonical_balance = EXCLUDED.canonical_balance,
       verified_block = EXCLUDED.verified_block,
       rpc_source = EXCLUDED.rpc_source,
       verified_at = EXCLUDED.verified_at,
       updated_at = EXCLUDED.updated_at
     WHERE gogh_broker_ownership_projection.verified_block <= EXCLUDED.verified_block`,
    [COLLECTION, normalizedOwner, unique, unique.length, blockNumber.toString(),
      rpcSource, verifiedAt],
  );
  return Object.freeze({ written: true, tokenCount: unique.length, blockNumber });
}

export async function getPrepaidPunkAgentGasBalance(selectedTokenId, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) {
    return Object.freeze({ available: false, reason: "OPERATIONAL_STORE_UNAVAILABLE" });
  }
  const normalizedTokenId = tokenId(selectedTokenId);
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    `SELECT account.credited_wei::text AS credited_wei,
            account.spent_wei::text AS spent_wei,
            (account.credited_wei - account.spent_wei)::text AS available_wei,
            account.updated_at,
            session.session_id::text AS session_id,
            session.state AS session_state,
            session.requested_mints,
            session.completed_mints,
            session.duration_days,
            session.starts_at,
            session.expires_at,
            session.last_attempt_at,
            session.last_result
       FROM gogh_broker_punk_agent_gas_accounts AS account
       LEFT JOIN LATERAL (
         SELECT * FROM gogh_broker_punk_priority_sessions
          WHERE chain_id = account.chain_id
            AND collection_address = account.collection_address
            AND punk_token_id = account.punk_token_id
          ORDER BY created_at DESC LIMIT 1
       ) AS session ON TRUE
      WHERE account.chain_id = 4663 AND account.collection_address = $1
        AND account.punk_token_id = $2::numeric`,
    [COLLECTION, normalizedTokenId],
  );
  const row = result.rows?.[0];
  return Object.freeze({
    available: true,
    creditedWei: row?.credited_wei ?? "0",
    spentWei: row?.spent_wei ?? "0",
    availableWei: row?.available_wei ?? "0",
    updatedAt: row?.updated_at == null ? null : iso(row.updated_at, "gas balance update"),
    session: row?.session_id == null ? null : Object.freeze({
      id: row.session_id,
      state: row.session_state,
      requestedMints: Number(row.requested_mints),
      completedMints: Number(row.completed_mints),
      durationDays: Number(row.duration_days),
      startsAt: iso(row.starts_at, "priority-session start"),
      expiresAt: iso(row.expires_at, "priority-session expiry"),
      lastAttemptAt: row.last_attempt_at == null ? null
        : iso(row.last_attempt_at, "priority-session attempt"),
      lastResult: row.last_result ?? null,
    }),
  });
}

export async function recordPrepaidPunkAgentGasCredit(evidence, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) {
    throw new TypeError("Per-Punk agent gas accounting is unavailable");
  }
  const selectedTokenId = tokenId(evidence?.tokenId);
  const transactionHash = optionalHash(evidence?.transactionHash);
  if (!transactionHash) throw new TypeError("agent gas transaction hash is required");
  const owner = address(evidence?.owner, "Punk owner");
  const agent = address(evidence?.agent, "hosted agent");
  const amountWei = positiveWei(evidence?.amountWei, "agent gas amount");
  const blockNumber = positiveWei(evidence?.blockNumber, "agent gas block number");
  const confirmedAt = iso(evidence?.confirmedAt, "agent gas confirmation time");
  // Deploy previews deliberately do not carry every production-worker variable.  The
  // credit is still an auditable write made by a concrete site release, so use the
  // immutable Netlify commit when the worker release is not present.  This value is
  // provenance only; it does not authorize the preview to drive the production queue.
  const releaseCommit = release(options.release
    ?? environment.BROKER_AUTOMATION_V3_WORKER_RELEASE
    ?? environment.COMMIT_REF);
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    `SELECT credited, available_wei::text AS available_wei, job_id
       FROM gogh_broker_credit_punk_agent_gas(
         $1, $2::numeric, $3, $4, $5::numeric, $6::bigint, $7::timestamptz, $8
       )`,
    [transactionHash, selectedTokenId, owner, agent, amountWei, blockNumber,
      confirmedAt, releaseCommit],
  );
  const row = result.rows?.[0];
  if (!row || typeof row.available_wei !== "string") {
    throw new TypeError("Per-Punk agent gas credit was not recorded");
  }
  return Object.freeze({
    credited: row.credited === true,
    availableWei: row.available_wei,
    jobId: row.job_id ?? null,
  });
}

export async function startPunkPrioritySession(evidence, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) {
    throw new TypeError("Punk priority-session accounting is unavailable");
  }
  const selectedTokenId = tokenId(evidence?.tokenId);
  const transactionHash = optionalHash(evidence?.transactionHash);
  if (!transactionHash) throw new TypeError("priority-session transaction hash is required");
  const owner = address(evidence?.owner, "Punk owner");
  const agent = address(evidence?.agent, "hosted agent");
  const amountWei = positiveWei(evidence?.amountWei, "priority-session gas amount");
  const blockNumber = positiveWei(evidence?.blockNumber, "priority-session block number");
  const confirmedAt = iso(evidence?.confirmedAt, "priority-session confirmation time");
  const mintLimit = priorityMintLimit(evidence?.mintLimit);
  const durationDays = priorityDurationDays(evidence?.durationDays);
  const releaseCommit = release(options.release
    ?? environment.BROKER_AUTOMATION_V3_WORKER_RELEASE
    ?? environment.COMMIT_REF);
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    `SELECT credited, available_wei::text AS available_wei,
            session_id::text AS session_id, session_state, completed_mints,
            expires_at, job_id::text AS job_id
       FROM gogh_broker_start_punk_priority_session(
         $1, $2::numeric, $3, $4, $5::numeric, $6::bigint, $7::timestamptz,
         $8, $9::smallint, $10::smallint
       )`,
    [transactionHash, selectedTokenId, owner, agent, amountWei, blockNumber,
      confirmedAt, releaseCommit, mintLimit, durationDays],
  );
  const row = result.rows?.[0];
  if (!row || typeof row.available_wei !== "string" || typeof row.session_id !== "string") {
    throw new TypeError("Punk priority session was not recorded");
  }
  return Object.freeze({
    credited: row.credited === true,
    availableWei: row.available_wei,
    session: Object.freeze({
      id: row.session_id,
      state: row.session_state,
      requestedMints: mintLimit,
      completedMints: Number(row.completed_mints),
      durationDays,
      expiresAt: iso(row.expires_at, "priority-session expiry"),
    }),
    jobId: row.job_id ?? null,
  });
}

export async function nextPunkPrioritySession(options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) return null;
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    `WITH expired AS (
       UPDATE gogh_broker_punk_priority_sessions
          SET state = 'EXPIRED', updated_at = NOW()
        WHERE state = 'ACTIVE' AND expires_at <= NOW()
        RETURNING session_id
     )
     SELECT session.session_id::text AS session_id,
            session.punk_token_id::text AS punk_token_id,
            session.owner_snapshot, deposit.agent_address,
            session.requested_mints, session.completed_mints, session.duration_days,
            session.starts_at, session.expires_at
       FROM gogh_broker_punk_priority_sessions AS session
       JOIN gogh_broker_punk_agent_gas_deposits AS deposit
         ON deposit.transaction_hash = session.deposit_transaction_hash
      WHERE session.state = 'ACTIVE' AND session.expires_at > NOW()
        AND session.completed_mints < session.requested_mints
      ORDER BY session.last_attempt_at ASC NULLS FIRST, session.created_at,
               session.punk_token_id
      LIMIT 1`,
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return Object.freeze({
    id: row.session_id,
    tokenId: tokenId(row.punk_token_id),
    owner: address(row.owner_snapshot, "priority-session owner"),
    agent: address(row.agent_address, "priority-session agent"),
    requestedMints: priorityMintLimit(row.requested_mints),
    completedMints: Number(row.completed_mints),
    durationDays: priorityDurationDays(row.duration_days),
    startsAt: iso(row.starts_at, "priority-session start"),
    expiresAt: iso(row.expires_at, "priority-session expiry"),
  });
}

export async function recordPunkPrioritySessionAttempt(sessionId, outcome, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.shadowWrites) return Object.freeze({ recorded: false, reason: "DISABLED" });
  const selectedSession = uuid(sessionId, "priority-session ID");
  const status = resultCode(outcome?.status, "UNKNOWN_RESULT");
  const minted = status === "MINT_CONFIRMED" && Number(outcome?.submitted ?? 0) === 1;
  const terminalState = status === "OWNER_CHANGED" ? "OWNER_CHANGED"
    : new Set(["PUNK_AUTOMATION_INACTIVE", "PUNK_NOT_AUTHORIZED", "AUTHORIZATION_EXPIRED"])
      .has(status) ? "CANCELLED" : null;
  const transactionHash = optionalHash(outcome?.transactionHash);
  if (minted && !transactionHash) throw new TypeError("confirmed priority mint needs a transaction hash");
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    `UPDATE gogh_broker_punk_priority_sessions
        SET completed_mints = completed_mints + CASE WHEN $2 THEN 1 ELSE 0 END,
            state = CASE
              WHEN $5::text IS NOT NULL THEN $5::text
              WHEN completed_mints + CASE WHEN $2 THEN 1 ELSE 0 END >= requested_mints
                THEN 'COMPLETE'
              WHEN expires_at <= NOW() THEN 'EXPIRED'
              ELSE state END,
            last_attempt_at = NOW(), last_result = $3,
            last_transaction_hash = COALESCE($4, last_transaction_hash),
            updated_at = NOW()
      WHERE session_id = $1::uuid AND state = 'ACTIVE'
      RETURNING punk_token_id::text AS punk_token_id, state,
                requested_mints, completed_mints, expires_at`,
    [selectedSession, minted, status, transactionHash, terminalState],
  );
  const row = result.rows?.[0];
  return row ? Object.freeze({
    recorded: true,
    tokenId: tokenId(row.punk_token_id),
    state: row.state,
    requestedMints: Number(row.requested_mints),
    completedMints: Number(row.completed_mints),
    expiresAt: iso(row.expires_at, "priority-session expiry"),
  }) : Object.freeze({ recorded: false, reason: "SESSION_NOT_ACTIVE" });
}

export async function claimSupabasePunkJobs(workerId, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.drivesExecution) {
    return Object.freeze({ claimed: Object.freeze([]), reason: "CUTOVER_NOT_ACKNOWLEDGED" });
  }
  const normalizedWorkerId = normalizeWorkerId(workerId);
  const limit = Number(options.limit ?? 4);
  const leaseSeconds = Number(options.leaseSeconds ?? 180);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 600) {
    throw new TypeError("queue claim bounds are invalid");
  }
  const database = operationalPool(environment, options.database);
  const result = await database.query(
    "SELECT * FROM gogh_broker_claim_punk_jobs($1, $2, $3)",
    [normalizedWorkerId, limit, leaseSeconds],
  );
  return Object.freeze({ claimed: Object.freeze(result.rows ?? []), reason: null });
}

export async function enqueueSupabasePunkJobs(punks, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.drivesExecution) {
    return Object.freeze({ enqueued: 0, reason: "CUTOVER_NOT_ACKNOWLEDGED" });
  }
  if (!Array.isArray(punks) || punks.length < 1 || punks.length > 64) {
    throw new TypeError("queue Punk set is invalid");
  }
  if (options.authorizationVerified !== true) {
    throw new TypeError("live Punk authorization evidence is required before enqueue");
  }
  const releaseCommit = release(options.release ?? environment.BROKER_AUTOMATION_V3_WORKER_RELEASE);
  const source = String(options.source ?? "SCHEDULER");
  if (!new Set(["SCHEDULER", "USER", "CONNECTOR"]).has(source)) {
    throw new TypeError("queue source is invalid");
  }
  const database = operationalPool(environment, options.database);
  const availableAt = iso(options.availableAt ?? new Date(), "availableAt");
  let enqueued = 0;
  for (const item of punks) {
    const selectedTokenId = tokenId(item?.tokenId ?? item);
    const idempotencyKey = String(item?.idempotencyKey
      ?? `scheduler:${releaseCommit}:${availableAt.slice(0, 16)}:${selectedTokenId}`);
    if (!/^[A-Za-z0-9:_.-]{12,200}$/.test(idempotencyKey)) {
      throw new TypeError("queue idempotency key is invalid");
    }
    const result = await database.query(
      `WITH job AS (
         INSERT INTO gogh_broker_punk_jobs
           (idempotency_key, chain_id, collection_address, punk_token_id, job_kind,
            state, available_at, source, source_release, updated_at)
         VALUES ($1, 4663, $2, $3::numeric, 'SCOUT', 'QUEUED', $4, $5, $6, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING job_id
       ), state AS (
         INSERT INTO gogh_broker_punk_state
           (chain_id, collection_address, punk_token_id, authorization_status,
            worker_state, current_job_id, last_scan_requested_at,
            source_release, observed_at, updated_at)
         SELECT 4663, $2, $3::numeric, 'AUTHORIZED', 'QUEUED', job_id,
                NOW(), $6, NOW(), NOW() FROM job
         ON CONFLICT (chain_id, collection_address, punk_token_id) DO UPDATE SET
           authorization_status = 'AUTHORIZED', worker_state = 'QUEUED',
           current_job_id = EXCLUDED.current_job_id,
           last_scan_requested_at = EXCLUDED.last_scan_requested_at,
           source_release = EXCLUDED.source_release,
           observed_at = EXCLUDED.observed_at, updated_at = EXCLUDED.updated_at
         RETURNING current_job_id
       )
       SELECT current_job_id AS job_id FROM state`,
      [idempotencyKey, COLLECTION, selectedTokenId, availableAt, source, releaseCommit],
    );
    enqueued += result.rows?.length ?? 0;
  }
  return Object.freeze({ enqueued, reason: null });
}

export async function completeSupabasePunkJob(jobId, claimedBy, outcome, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration = supabaseOperationalConfiguration(environment);
  if (!configuration.drivesExecution) {
    return Object.freeze({ completed: false, reason: "CUTOVER_NOT_ACKNOWLEDGED" });
  }
  const selectedJobId = uuid(jobId, "queue job ID");
  const selectedWorker = normalizeWorkerId(claimedBy);
  const status = String(outcome?.status ?? "");
  if (!new Set(["SUCCEEDED", "RETRYABLE_FAILURE", "TERMINAL_FAILURE"]).has(status)) {
    throw new TypeError("queue completion status is invalid");
  }
  const code = resultCode(outcome?.resultCode,
    status === "SUCCEEDED" ? "SCAN_COMPLETE" : "PUNK_JOB_FAILED");
  const transactionHash = optionalHash(outcome?.transactionHash);
  const retrySeconds = Number(options.retrySeconds ?? 120);
  if (!Number.isSafeInteger(retrySeconds) || retrySeconds < 30 || retrySeconds > 3_600) {
    throw new TypeError("queue retry delay is invalid");
  }
  const database = operationalPool(environment, options.database);
  const client = typeof database.connect === "function" ? await database.connect() : database;
  await client.query("BEGIN");
  try {
    const updated = await client.query(
      `UPDATE gogh_broker_punk_jobs
          SET state = CASE
                WHEN $3 = 'SUCCEEDED' THEN 'SUCCEEDED'
                WHEN $3 = 'RETRYABLE_FAILURE' AND attempts < max_attempts THEN 'RETRY'
                ELSE 'FAILED' END,
              available_at = CASE
                WHEN $3 = 'RETRYABLE_FAILURE' AND attempts < max_attempts
                THEN NOW() + ($4 * INTERVAL '1 second') ELSE available_at END,
              lease_owner = NULL,
              lease_until = NULL,
              completed_at = CASE
                WHEN $3 = 'SUCCEEDED'
                  OR $3 = 'TERMINAL_FAILURE'
                  OR attempts >= max_attempts THEN NOW() ELSE NULL END,
              last_failure_code = CASE WHEN $3 = 'SUCCEEDED' THEN NULL ELSE $5 END,
              updated_at = NOW()
        WHERE job_id = $1::uuid AND state = 'LEASED' AND lease_owner = $2
        RETURNING punk_token_id::text AS punk_token_id, state, attempts, max_attempts`,
      [selectedJobId, selectedWorker, status, retrySeconds, code],
    );
    if (updated.rows.length !== 1) {
      throw new Error("queue lease no longer belongs to this worker");
    }
    const row = updated.rows[0];
    const finalWorkerState = row.state === "SUCCEEDED"
      ? (transactionHash ? "MINTED" : "WAITING")
      : (row.state === "RETRY" ? "QUEUED" : "ERROR");
    const eventId = createHash("sha256")
      .update(`queue:${selectedJobId}:${row.attempts}:${row.state}:${code}`).digest("hex");
    await client.query(
      `UPDATE gogh_broker_punk_state
          SET worker_state = $2,
              current_job_id = CASE WHEN $3 = 'RETRY' THEN $1::uuid ELSE NULL END,
              last_scan_completed_at = NOW(),
              last_result = $4,
              last_successful_mint = COALESCE($5, last_successful_mint),
              next_eligible_scan_at = CASE WHEN $3 = 'RETRY'
                THEN NOW() + ($6 * INTERVAL '1 second') ELSE next_eligible_scan_at END,
              consecutive_failures = CASE WHEN $3 = 'SUCCEEDED'
                THEN 0 ELSE consecutive_failures + 1 END,
              observed_at = NOW(), updated_at = NOW()
        WHERE chain_id = 4663 AND collection_address = $7
          AND punk_token_id = $8::numeric`,
      [selectedJobId, finalWorkerState, row.state, code, transactionHash,
        retrySeconds, COLLECTION, row.punk_token_id],
    );
    await client.query(
      `INSERT INTO gogh_broker_agent_activity
         (event_id, chain_id, punk_token_id, job_id, worker_state, result_code,
          transaction_hash, source, occurred_at)
       VALUES ($1, 4663, $2::numeric, $3::uuid, $4, $5, $6, 'QUEUE', NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, row.punk_token_id, selectedJobId, finalWorkerState, code, transactionHash],
    );
    await client.query("COMMIT");
    return Object.freeze({ completed: true, state: row.state,
      tokenId: row.punk_token_id, reason: null });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (client !== database && typeof client.release === "function") client.release();
  }
}
