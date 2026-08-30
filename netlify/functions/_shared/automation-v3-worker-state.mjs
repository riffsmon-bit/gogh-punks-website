import { getDatabase } from "@netlify/database";
import { createHash } from "node:crypto";

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

function tokenId(value) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return normalized;
}

function address(value, name) {
  return text(value, /^0x[0-9a-fA-F]{40}$/, name);
}

function boundedInteger(value, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : fallback;
}

function advisoryUrl(value, kind) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    if (kind === "x" && !new Set(["x.com", "www.x.com"]).has(url.hostname.toLowerCase())) return null;
    if (kind === "image" && !new Set(["i.seadn.io", "raw2.seadn.io"])
      .has(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function workerDiscoverySummary(result) {
  const diagnostics = result?.diagnostics;
  const ranking = diagnostics?.socialRanking;
  if (!ranking || typeof ranking !== "object" || Array.isArray(ranking)) return null;
  const candidates = Array.isArray(diagnostics.socialCandidates)
    ? diagnostics.socialCandidates.slice(0, 3).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || !/^0x[0-9a-fA-F]{40}$/.test(candidate.collection ?? "")
        || !new Set(["HIGH", "MEDIUM", "LOW"]).has(candidate.tier)) return [];
      const reasons = Array.isArray(candidate.reasons) ? candidate.reasons
        .filter((reason) => typeof reason === "string" && reason.length > 0 && reason.length <= 80)
        .slice(0, 8) : [];
      return [Object.freeze({
        collection: candidate.collection.toLowerCase(),
        tier: candidate.tier,
        score: boundedInteger(candidate.score, 100),
        projectName: typeof candidate.signals?.projectName === "string"
          && candidate.signals.projectName.length > 0 && candidate.signals.projectName.length <= 160
          ? candidate.signals.projectName : null,
        imageUrl: advisoryUrl(candidate.signals?.imageUrl, "image"),
        websiteUrl: advisoryUrl(candidate.signals?.websiteUrl, "website"),
        xUrl: advisoryUrl(candidate.signals?.xUrl, "x"),
        reasons: Object.freeze(reasons),
      })];
    }) : [];
  return Object.freeze({
    discovered: boundedInteger(ranking.discovered, 64),
    withWebsite: boundedInteger(ranking.withWebsite, 64),
    withX: boundedInteger(ranking.withX, 64),
    highPriority: boundedInteger(ranking.highPriority, 64),
    sentToOnchainValidation: boundedInteger(ranking.sentToOnchainValidation, 8),
    maximumOnchainValidations: boundedInteger(ranking.maximumOnchainValidations, 8),
    candidates: Object.freeze(candidates),
  });
}

function discoverySummaryFromRow(row) {
  const raw = rowValue(row, "discovery_summary", "discoverySummary");
  if (raw == null) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return workerDiscoverySummary({ diagnostics: {
      socialRanking: parsed,
      socialCandidates: parsed?.candidates?.map((candidate) => ({
        ...candidate,
        signals: { projectName: candidate?.projectName, imageUrl: candidate?.imageUrl,
          websiteUrl: candidate?.websiteUrl, xUrl: candidate?.xUrl },
      })),
    } });
  } catch {
    throw new TypeError("worker discovery summary is invalid");
  }
}

export async function enrollAutomationV3Punk(punk, options = {}) {
  if (!punk || punk.created !== true || punk.active !== true) {
    throw new TypeError("Punk automation is not active");
  }
  const selectedTokenId = tokenId(punk.tokenId);
  const account = address(punk.account, "Punk account");
  const owner = address(punk.owner, "Punk owner");
  const database = options.database ?? getDatabase().pool;
  await database.query(
    `INSERT INTO broker_automation_v3_enrollments
      (chain_id, collection_address, token_id, account_address, owner_snapshot)
     VALUES (4663, $1, $2::numeric, $3, $4)
     ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE SET
       account_address = EXCLUDED.account_address,
       owner_snapshot = EXCLUDED.owner_snapshot,
       last_requested_at = NOW()`,
    ["0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6", selectedTokenId, account, owner],
  );
  return Object.freeze({ tokenId: selectedTokenId, account, owner });
}

export async function automationV3PunkEnrollment(punk, options = {}) {
  if (!punk || typeof punk !== "object" || Array.isArray(punk)) {
    throw new TypeError("Punk enrollment lookup is invalid");
  }
  const selectedTokenId = tokenId(punk.tokenId);
  const account = address(punk.account, "Punk account");
  const owner = address(punk.owner, "Punk owner");
  const database = options.database ?? getDatabase().pool;
  const result = await database.query(
    `SELECT account_address, owner_snapshot
       FROM broker_automation_v3_enrollments
      WHERE chain_id = 4663 AND collection_address = $1 AND token_id = $2::numeric
      LIMIT 1`,
    ["0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6", selectedTokenId],
  );
  const row = result.rows?.[0];
  if (!row) return false;
  return address(row.account_address, "Stored Punk account") === account
    && address(row.owner_snapshot, "Stored Punk owner") === owner;
}

const PUNK_WORKER_STATES = new Set(["QUEUED", "MINTED", "SKIPPED", "ERROR", "READY"]);

function punkWorkerOutcome(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selectedTokenId = tokenId(value.tokenId);
  const state = String(value.state ?? "");
  const reason = String(value.reason ?? "");
  const account = value.account == null ? null : address(value.account, "Punk account");
  if (!PUNK_WORKER_STATES.has(state) || !/^[A-Z0-9_]{3,64}$/.test(reason)) {
    throw new TypeError("Punk worker outcome is invalid");
  }
  return Object.freeze({ tokenId: selectedTokenId, state, reason, account });
}

export function punkWorkerEvidenceFromRow(row) {
  if (!row) return null;
  const state = String(rowValue(row, "state", "state"));
  if (!new Set([
    "IDLE", "QUEUED", "SCANNING", "CANDIDATE_FOUND", "VERIFYING_CONTRACT",
    "CHECKING_PRICE", "CHECKING_ELIGIBILITY", "CHECKING_LIMITS", "SIMULATING",
    "READY", "SUBMITTING", "CONFIRMING", "MINTED", "SKIPPED", "PAUSED", "ERROR",
  ]).has(state)) throw new TypeError("Punk worker state is invalid");
  const reason = rowValue(row, "reason", "reason");
  if (reason !== null && !/^[A-Z0-9_]{3,64}$/.test(String(reason))) {
    throw new TypeError("Punk worker reason is invalid");
  }
  return Object.freeze({
    tokenId: tokenId(rowValue(row, "punk_token_id", "tokenId")),
    state,
    jobId: rowValue(row, "current_job_id", "jobId") == null
      ? null : String(rowValue(row, "current_job_id", "jobId")),
    lastScheduledScan: optionalIso(
      rowValue(row, "last_scheduled_scan", "lastScheduledScan"), "lastScheduledScan",
    ),
    lastActualScan: optionalIso(
      rowValue(row, "last_actual_scan", "lastActualScan"), "lastActualScan",
    ),
    lastSuccessfulMint: optional(
      rowValue(row, "last_successful_mint", "lastSuccessfulMint"),
      /^0x[0-9a-f]{64}$/, "lastSuccessfulMint",
    ),
    nextScanEstimate: optionalIso(
      rowValue(row, "next_scan_estimate", "nextScanEstimate"), "nextScanEstimate",
    ),
    reason: reason === null ? null : String(reason),
    updatedAt: iso(rowValue(row, "updated_at", "updatedAt"), "updatedAt"),
  });
}

export async function recordAutomationV3PunkWorkerEvidence(result, options = {}) {
  const diagnostics = result?.diagnostics;
  if (!diagnostics || !Array.isArray(diagnostics.scheduledTokenIds)
    || diagnostics.scheduledTokenIds.length > 32
    || !Array.isArray(diagnostics.profileOutcomes)
    || diagnostics.profileOutcomes.length > 32) return Object.freeze([]);
  const scheduled = [...new Set(diagnostics.scheduledTokenIds.map(tokenId))];
  const outcomes = new Map(diagnostics.profileOutcomes.map((item) => {
    const normalized = punkWorkerOutcome(item);
    return [normalized.tokenId, normalized];
  }));
  if ([...outcomes.keys()].some((selectedTokenId) => !scheduled.includes(selectedTokenId))) {
    throw new TypeError("Punk worker outcome was not scheduled");
  }
  const database = options.database ?? getDatabase().pool;
  const jobId = String(options.jobId ?? "");
  if (!/^[0-9a-f-]{8,160}$/i.test(jobId)) throw new TypeError("Punk worker job ID is invalid");
  const startedAt = iso(options.startedAt, "startedAt");
  const completedAt = iso(options.completedAt, "completedAt");
  const totalProfiles = boundedInteger(diagnostics.totalEligibleProfiles, 10_000, scheduled.length);
  const batchSize = Math.max(1, boundedInteger(diagnostics.scheduledProfileBatch, 32, scheduled.length));
  const rotationMilliseconds = Math.max(300_000, Math.ceil(totalProfiles / batchSize) * 300_000);
  const nextScanEstimate = new Date(new Date(startedAt).getTime() + rotationMilliseconds).toISOString();
  const rows = [];
  for (const selectedTokenId of scheduled) {
    const outcome = outcomes.get(selectedTokenId) ?? Object.freeze({
      tokenId: selectedTokenId, state: "QUEUED", reason: "WAITING_FOR_WORKER_CAPACITY",
      account: null,
    });
    const lastActualScan = outcome.state === "QUEUED" ? null : completedAt;
    const transactionHash = outcome.state === "MINTED" ? result.transactionHash : null;
    const collection = outcome.state === "MINTED" && result.collection != null
      ? address(result.collection, "Mint collection") : null;
    const eventId = createHash("sha256")
      .update(`${jobId}:${selectedTokenId}:${outcome.state}`, "utf8").digest("hex");
    const query = await database.query(
      `WITH heartbeat AS (
       INSERT INTO broker_punk_agent_heartbeats
        (chain_id, punk_token_id, state, current_job_id, last_scheduled_scan,
         last_actual_scan, last_successful_mint, next_scan_estimate, reason, updated_at)
       VALUES (4663, $1::numeric, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
       ON CONFLICT (chain_id, punk_token_id) DO UPDATE SET
         state = EXCLUDED.state,
         current_job_id = EXCLUDED.current_job_id,
         last_scheduled_scan = EXCLUDED.last_scheduled_scan,
         last_actual_scan = COALESCE(EXCLUDED.last_actual_scan,
           broker_punk_agent_heartbeats.last_actual_scan),
         last_successful_mint = COALESCE(EXCLUDED.last_successful_mint,
           broker_punk_agent_heartbeats.last_successful_mint),
         next_scan_estimate = EXCLUDED.next_scan_estimate,
         reason = EXCLUDED.reason,
         updated_at = EXCLUDED.updated_at
       WHERE broker_punk_agent_heartbeats.updated_at <= EXCLUDED.updated_at
       RETURNING *
       ), activity AS (
         INSERT INTO broker_punk_agent_activity
           (chain_id, punk_token_id, event_id, job_id, state, reason,
            collection_address, transaction_hash, occurred_at)
         SELECT 4663, $1::numeric, $10, $3, $2, $8, $11, $6, $9::timestamptz
          WHERE $12::boolean
         ON CONFLICT DO NOTHING
         RETURNING event_id
       )
       SELECT heartbeat.* FROM heartbeat`,
      [selectedTokenId, outcome.state, jobId, startedAt, lastActualScan,
        transactionHash, nextScanEstimate, outcome.reason, completedAt,
        eventId, collection, outcome.state !== "QUEUED"],
    );
    if (query.rows?.[0]) rows.push(punkWorkerEvidenceFromRow(query.rows[0]));
  }
  return Object.freeze(rows);
}

export function punkWorkerActivityFromRow(row) {
  if (!row) return null;
  const state = String(rowValue(row, "state", "state"));
  if (!new Set([
    "IDLE", "QUEUED", "SCANNING", "CANDIDATE_FOUND", "VERIFYING_CONTRACT",
    "CHECKING_PRICE", "CHECKING_ELIGIBILITY", "CHECKING_LIMITS", "SIMULATING",
    "READY", "SUBMITTING", "CONFIRMING", "MINTED", "SKIPPED", "PAUSED", "ERROR",
  ]).has(state)) throw new TypeError("Punk activity state is invalid");
  const reason = rowValue(row, "reason", "reason");
  if (reason !== null && !/^[A-Z0-9_]{3,64}$/.test(String(reason))) {
    throw new TypeError("Punk activity reason is invalid");
  }
  const eventId = String(rowValue(row, "event_id", "eventId"));
  const jobId = rowValue(row, "job_id", "jobId") == null
    ? null : String(rowValue(row, "job_id", "jobId"));
  if (!/^[0-9A-Za-z:_-]{8,160}$/.test(eventId)
    || (jobId !== null && !/^[0-9A-Za-z:_-]{8,160}$/.test(jobId))) {
    throw new TypeError("Punk activity identity is invalid");
  }
  return Object.freeze({
    tokenId: tokenId(rowValue(row, "punk_token_id", "tokenId")),
    eventId,
    jobId,
    state,
    reason: reason === null ? null : String(reason),
    collection: optional(
      rowValue(row, "collection_address", "collection"), /^0x[0-9a-f]{40}$/, "collection",
    ),
    transactionHash: optional(
      rowValue(row, "transaction_hash", "transactionHash"),
      /^0x[0-9a-f]{64}$/, "transactionHash",
    ),
    occurredAt: iso(rowValue(row, "occurred_at", "occurredAt"), "occurredAt"),
  });
}

export async function getAutomationV3PunkWorkerActivity(value, options = {}) {
  const selectedTokenId = tokenId(value);
  const database = options.database ?? getDatabase().pool;
  const [heartbeatResult, activityResult] = await Promise.all([
    database.query(
      `SELECT * FROM broker_punk_agent_heartbeats
        WHERE chain_id = 4663 AND punk_token_id = $1::numeric
        LIMIT 1`,
      [selectedTokenId],
    ),
    database.query(
      `SELECT punk_token_id::text, event_id, job_id, state, reason,
              collection_address, transaction_hash, occurred_at
         FROM broker_punk_agent_activity
        WHERE chain_id = 4663 AND punk_token_id = $1::numeric
        ORDER BY occurred_at DESC
        LIMIT 20`,
      [selectedTokenId],
    ),
  ]);
  return Object.freeze({
    heartbeat: heartbeatResult.rows?.[0]
      ? punkWorkerEvidenceFromRow(heartbeatResult.rows[0]) : null,
    events: Object.freeze((activityResult.rows ?? []).map(punkWorkerActivityFromRow)),
  });
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
    discoverySummary: discoverySummaryFromRow(row),
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
  const discoverySummary = workerDiscoverySummary(result);
  const database = options.database ?? getDatabase().pool;
  const query = await database.query(
    `WITH recorded AS (
       INSERT INTO broker_automation_v3_worker_runs
        (release_commit, started_at, completed_at, status, submitted,
         punk_token_id, account_address, collection_address, transaction_hash, failure_code,
         discovery_summary)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING run_id
     )
     INSERT INTO broker_automation_v3_worker_state
      (singleton_id, release_commit, started_at, completed_at, status, submitted,
       punk_token_id, account_address, collection_address, transaction_hash, failure_code,
       discovery_summary)
     VALUES (1, $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::jsonb)
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
       failure_code = EXCLUDED.failure_code,
       discovery_summary = EXCLUDED.discovery_summary
     WHERE broker_automation_v3_worker_state.completed_at <= EXCLUDED.completed_at
     RETURNING *`,
    [release, startedAt, completedAt, status, submitted, tokenId, account, collection,
      transactionHash, failureCode, discoverySummary ? JSON.stringify(discoverySummary) : null],
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
