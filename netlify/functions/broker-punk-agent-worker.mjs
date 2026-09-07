import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { createPublicClient, http, keccak256 } from "viem";

import deployment from "../../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { createPunkAgentBundler, createPunkAgentSessionSigner,
  readPunkAgentUserOperationReceipt, verifyPunkAgentMintReceipt } from
  "../../broker/src/agent-account/punk-agent-account-runtime.mjs";
import { runPunkAgentMissionOnce } from
  "../../broker/src/agent-account/punk-agent-worker.mjs";
import { punkAgentAccountReadiness } from
  "../../broker/src/agent-account/punk-agent-account-manifest.mjs";
import { normalizePunkCollectingIntent } from
  "../../broker/src/v4/collecting-intent.mjs";
import { v2ExecutionIdentity } from "../../broker/src/v4/execution-boundary.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { matchV2Opportunity } from "../../broker/src/v4/policy-matcher.mjs";
import { simulateOwnerAssistedSeaDropMint } from
  "../../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { backgroundRpcDecision } from "./_shared/background-rpc-policy.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveEnvironmentInteger(environment, name, fallback, maximum) {
  const value = environment[name] ?? fallback;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new TypeError(`${name} exceeds its safety maximum`);
  return parsed;
}

async function gasEnvelope(client, environment) {
  const gasPrice = await client.getGasPrice();
  if (typeof gasPrice !== "bigint" || gasPrice <= 0n) throw new TypeError("gas price unavailable");
  return Object.freeze({
    verificationGasLimit: positiveEnvironmentInteger(environment,
      "PUNK_AGENT_VERIFICATION_GAS_LIMIT", "250000", 1_000_000n),
    callGasLimit: positiveEnvironmentInteger(environment,
      "PUNK_AGENT_CALL_GAS_LIMIT", "350000", 1_000_000n),
    preVerificationGas: positiveEnvironmentInteger(environment,
      "PUNK_AGENT_PRE_VERIFICATION_GAS", "75000", 500_000n),
    maxPriorityFeePerGas: gasPrice,
    maxFeePerGas: gasPrice * 2n,
  });
}

function createClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 12_000, retryCount: 1 }) });
}

function missionFromRow(row, now) {
  const strategy = normalizePunkCollectingIntent(row.intent, now);
  return Object.freeze({ sessionId: row.session_id, tokenId: String(row.punk_token_id),
    account: row.punk_account, owner: row.owner_snapshot,
    sessionGeneration: String(row.session_generation), strategyVersion: Number(row.strategy_version),
    strategyHash: row.strategy_hash, strategy });
}

async function loadMission(pool, now) {
  const result = await pool.query(`SELECT session.session_id::text, session.punk_token_id,
      session.punk_account, session.owner_snapshot, session.session_generation,
      session.strategy_version, session.strategy_hash, strategy.intent
    FROM broker_v2_agent_sessions session
    JOIN broker_v2_strategies strategy ON strategy.chain_id = session.chain_id
      AND strategy.collection_address = session.collection_address
      AND strategy.token_id = session.punk_token_id
      AND strategy.version = session.strategy_version
    WHERE session.status = 'ACTIVE' AND session.valid_after <= $1
      AND session.valid_until > $1 AND strategy.state = 'ACTIVE'
      AND strategy.expires_at > $1
    ORDER BY session.updated_at ASC, session.punk_token_id ASC LIMIT 1`,
  [new Date(now).toISOString()]);
  return result.rows[0] ? missionFromRow(result.rows[0], now) : null;
}

async function usage(pool, mission, opportunityId, now) {
  const result = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE activity.occurred_at >= date_trunc('day', $1::timestamptz
        AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE activity.opportunity_id = $2)::integer AS opportunity
    FROM broker_v2_activity activity WHERE activity.chain_id = $3
      AND activity.punk_token_id = $4::numeric AND activity.activity_type = 'COLLECTED'`,
  [new Date(now).toISOString(), opportunityId, ROBINHOOD.chainId, mission.tokenId]);
  const pending = await pool.query(`SELECT COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE operation.created_at >= date_trunc('day', $1::timestamptz
        AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
      COUNT(*) FILTER (WHERE operation.opportunity_id = $2)::integer AS opportunity
    FROM broker_v2_agent_user_operations operation
    JOIN broker_v2_agent_sessions session ON session.session_id = operation.session_id
    WHERE session.chain_id = $3 AND session.punk_token_id = $4::numeric
      AND operation.state IN ('SIGNED', 'SUBMITTED', 'RECONCILIATION_REQUIRED')`,
  [new Date(now).toISOString(), opportunityId, ROBINHOOD.chainId, mission.tokenId]);
  const collected = result.rows[0] ?? {}; const open = pending.rows[0] ?? {};
  return Object.freeze({ dailyMints: Number(collected.daily ?? 0) + Number(open.daily ?? 0),
    totalMints: Number(collected.total ?? 0) + Number(open.total ?? 0),
    opportunityMints: Number(collected.opportunity ?? 0) + Number(open.opportunity ?? 0) });
}

async function loadCandidate(pool, client, mission, runtime, now, observation = null) {
  const results = await pool.query(`SELECT opportunity.normalized,
      screening.input_hash AS screening_input_hash, screening.checked_at
    FROM broker_v2_opportunities opportunity
    JOIN LATERAL (SELECT input_hash, checked_at FROM broker_v2_security_screenings
      WHERE opportunity_id = opportunity.opportunity_id AND status = 'PASSED'
      ORDER BY checked_at DESC LIMIT 1) screening ON TRUE
    WHERE opportunity.chain_id = $1 AND opportunity.screening_status = 'PASSED'
      AND (opportunity.expires_at IS NULL OR opportunity.expires_at > $2)
    ORDER BY opportunity.updated_at DESC LIMIT 12`,
  [ROBINHOOD.chainId, new Date(now).toISOString()]);
  const observed = { opportunitiesChecked: results.rows.length, liveSimulationsPassed: 0 };
  const balance = await client.getBalance({ address: runtime.account });
  for (const row of results.rows) {
    let simulation;
    try {
      simulation = await simulateOwnerAssistedSeaDropMint({ client,
        authority: { owner: mission.owner, punkWallet: runtime.account, activated: true },
        opportunity: normalizeV2Opportunity(row.normalized, now), now });
    } catch { continue; }
    observed.liveSimulationsPassed += 1;
    const candidate = normalizeV2Opportunity({ ...row.normalized, simulationStatus: "PASSED",
      estimatedGasCostWei: simulation.evidence.estimatedGasWei,
      expectedNftReceiver: runtime.account, updatedAt: new Date(now).toISOString() }, now);
    const counts = await usage(pool, mission, candidate.opportunityId, now);
    const match = matchV2Opportunity(mission.strategy, candidate, {
      currentOwner: mission.owner, punkWallet: runtime.account,
      punkWalletBalanceWei: balance.toString(), ...counts,
    }, now);
    if (!match.automaticExecutionCandidate) continue;
    if (observation) Object.assign(observation, observed);
    return Object.freeze({ opportunity: candidate,
      tokenId: simulation.evidence.expectedTokenId,
      screeningInputHash: String(row.screening_input_hash),
      simulationInputHash: simulation.evidence.inputHash,
      checkedAt: new Date(row.checked_at).toISOString(), match });
  }
  if (observation) Object.assign(observation, observed);
  return null;
}

async function reserveOperation(pool, { mission, runtime, candidate, prepared, now }) {
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      [ROBINHOOD.chainId, Number(mission.tokenId)]);
    const live = await database.query(`SELECT status, session_generation
      FROM broker_v2_agent_sessions WHERE session_id = $1 FOR UPDATE`, [mission.sessionId]);
    if (!live.rows[0] || live.rows[0].status !== "ACTIVE"
      || BigInt(live.rows[0].session_generation) !== runtime.session.generation) {
      throw Object.assign(new Error("session changed before reservation"),
        { code: "SESSION_STATE_MISMATCH" });
    }
    const open = await database.query(`SELECT operation_id FROM broker_v2_agent_user_operations
      WHERE session_id = $1 AND state IN ('SIGNED', 'SUBMITTED', 'RECONCILIATION_REQUIRED')
      LIMIT 1 FOR UPDATE`, [mission.sessionId]);
    if (open.rows[0]) throw Object.assign(new Error("previous UserOperation needs reconciliation"),
      { code: "OPERATION_ALREADY_OPEN" });
    const idempotencyKey = v2ExecutionIdentity({ chainId: ROBINHOOD.chainId,
      punkWallet: runtime.account, opportunityId: candidate.opportunity.opportunityId,
      strategyHash: mission.strategyHash, accountNonce: runtime.acquisitionNonce.toString(),
      operatingMode: "AUTONOMOUS" });
    const attempt = await database.query(`INSERT INTO broker_v2_execution_attempts
      (idempotency_key, chain_id, punk_token_id, punk_account, owner_snapshot,
       opportunity_id, strategy_version, strategy_hash, account_nonce, operating_mode,
       state, transaction_envelope_hash, created_at, updated_at)
      VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9::numeric, 'AUTONOMOUS',
        'RESERVED', $10, $11, $11)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING attempt_id::text`,
    [idempotencyKey, ROBINHOOD.chainId, mission.tokenId, runtime.account, mission.owner,
      candidate.opportunity.opportunityId, mission.strategyVersion, mission.strategyHash,
      runtime.acquisitionNonce.toString(), sha256(prepared.operation.packed.callData),
      new Date(now).toISOString()]);
    if (!attempt.rows[0]) throw Object.assign(new Error("operation already reserved"),
      { code: "DUPLICATE_OPERATION" });
    const operation = await database.query(`INSERT INTO broker_v2_agent_user_operations
      (session_id, attempt_id, user_operation_hash, opportunity_id, opportunity_hash,
       account_nonce, session_generation, call_data_hash, maximum_gas_cost_wei,
       screening_input_hash, simulation_input_hash, expected_collection, expected_token_id,
       state, signed_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::numeric, $10, $11,
        $12, $13::numeric, 'SIGNED', $14, $14, $14) RETURNING operation_id::text`,
    [mission.sessionId, attempt.rows[0].attempt_id, prepared.operation.userOpHash,
      candidate.opportunity.opportunityId, prepared.intent.opportunityId,
      runtime.acquisitionNonce.toString(), mission.sessionGeneration,
      keccak256(prepared.operation.packed.callData), prepared.operation.maximumGasCostWei.toString(),
      candidate.screeningInputHash, candidate.simulationInputHash,
      candidate.opportunity.collectionContract, candidate.tokenId, new Date(now).toISOString()]);
    await database.query(`INSERT INTO broker_v2_activity
      (chain_id, punk_token_id, activity_type, opportunity_id, attempt_id, public_detail, occurred_at)
      VALUES ($1, $2::numeric, 'USER_OPERATION_SIGNED', $3, $4, $5::jsonb, $6)`,
    [ROBINHOOD.chainId, mission.tokenId, candidate.opportunity.opportunityId,
      attempt.rows[0].attempt_id, JSON.stringify({ operationId: operation.rows[0].operation_id,
        collection: candidate.opportunity.collectionContract,
        tokenId: candidate.tokenId, authority: "OWNER_APPROVED_SESSION" }),
      new Date(now).toISOString()]);
    await database.query("COMMIT");
    return Object.freeze({ operationId: operation.rows[0].operation_id,
      attemptId: attempt.rows[0].attempt_id });
  } catch (error) { await database.query("ROLLBACK"); throw error; }
  finally { database.release(); }
}

async function markSubmitted(pool, { mission, reservation, userOpHash, now }) {
  const result = await pool.query(`UPDATE broker_v2_agent_user_operations
    SET state = 'SUBMITTED', submitted_at = $1, updated_at = $1
    WHERE operation_id = $2 AND user_operation_hash = $3 AND state = 'SIGNED'
    RETURNING operation_id`, [new Date(now).toISOString(), reservation.operationId, userOpHash]);
  if (!result.rows[0]) throw Object.assign(new Error("submission could not be recorded"),
    { code: "SUBMISSION_RECORD_FAILED" });
  await pool.query(`UPDATE broker_v2_agent_sessions SET updated_at = $1 WHERE session_id = $2`,
    [new Date(now).toISOString(), mission.sessionId]);
}

async function markFailed(pool, { mission, reservation, code, terminal, now }) {
  if (reservation?.operationId) await pool.query(`UPDATE broker_v2_agent_user_operations
    SET state = 'RECONCILIATION_REQUIRED', rejection_code = $1, submitted_at = COALESCE(submitted_at, $2),
      updated_at = $2 WHERE operation_id = $3 AND state IN ('SIGNED', 'SUBMITTED')`,
  [String(code).slice(0, 128), new Date(now).toISOString(), reservation.operationId]);
  if (terminal && mission?.sessionId) {
    await pool.query(`UPDATE broker_v2_agent_sessions SET status = 'PAUSED', updated_at = $1
      WHERE session_id = $2 AND status = 'ACTIVE'`, [new Date(now).toISOString(), mission.sessionId]);
  }
}

async function recordWorkerActivity(pool, tokenId, activityType, detail, now) {
  if (!tokenId) return;
  await pool.query(`INSERT INTO broker_v2_activity
    (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
    VALUES ($1, $2::numeric, $3, $4::jsonb, $5)`, [ROBINHOOD.chainId,
    tokenId, activityType, JSON.stringify(detail), new Date(now).toISOString()]);
}

async function reconcileOne(pool, client, bundler, now) {
  const result = await pool.query(`SELECT operation.operation_id::text,
      operation.attempt_id::text, operation.user_operation_hash, operation.opportunity_id,
      operation.opportunity_hash, operation.expected_collection, operation.expected_token_id,
      session.session_id::text, session.strategy_version, session.punk_token_id,
      session.punk_account, session.session_key, session.adapter_address, session.venue_address
    FROM broker_v2_agent_user_operations operation
    JOIN broker_v2_agent_sessions session ON session.session_id = operation.session_id
    WHERE operation.state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED')
    ORDER BY operation.submitted_at ASC LIMIT 1`);
  const row = result.rows[0];
  if (!row) return null;
  const receipt = await readPunkAgentUserOperationReceipt({ bundler,
    userOpHash: row.user_operation_hash });
  if (!receipt) return Object.freeze({ status: "PENDING", operationId: row.operation_id });
  if (receipt.success !== true) {
    await pool.query(`UPDATE broker_v2_agent_user_operations SET state = 'REVERTED',
      rejection_code = 'USER_OPERATION_REVERTED', updated_at = $1
      WHERE operation_id = $2`, [new Date(now).toISOString(), row.operation_id]);
    await pool.query(`UPDATE broker_v2_execution_attempts SET state = 'REVERTED',
      rejection_code = 'USER_OPERATION_REVERTED', updated_at = $1 WHERE attempt_id = $2`,
    [new Date(now).toISOString(), row.attempt_id]);
    return Object.freeze({ status: "REVERTED", operationId: row.operation_id });
  }
  const verified = await verifyPunkAgentMintReceipt({ client, receipt,
    userOpHash: row.user_operation_hash, account: row.punk_account,
    opportunityId: row.opportunity_hash, collection: row.expected_collection,
    tokenId: row.expected_token_id });
  const block = await client.getBlock({ blockNumber: BigInt(verified.blockNumber) });
  if (!block?.timestamp) throw Object.assign(new Error("confirmed block timestamp unavailable"),
    { code: "RECEIPT_BLOCK_UNAVAILABLE" });
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    const updated = await database.query(`UPDATE broker_v2_agent_user_operations SET state = 'CONFIRMED',
      transaction_hash = $1, actual_gas_cost_wei = $2::numeric, confirmed_at = $3,
      updated_at = $3 WHERE operation_id = $4 AND state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED')
      RETURNING operation_id`,
    [verified.transactionHash, verified.actualGasCostWei, new Date(now).toISOString(),
      row.operation_id]);
    if (!updated.rows[0]) throw Object.assign(new Error("UserOperation was already reconciled"),
      { code: "OPERATION_ALREADY_RECONCILED" });
    await database.query(`UPDATE broker_v2_execution_attempts SET state = 'CONFIRMED',
      transaction_hash = $1, submitted_at = COALESCE(submitted_at, $2), confirmed_at = $2,
      updated_at = $2 WHERE attempt_id = $3`, [verified.transactionHash,
      new Date(now).toISOString(), row.attempt_id]);
    await database.query(`INSERT INTO broker_acquisitions
      (chain_id, transaction_hash, log_index, punk_collection_address, punk_token_id,
       punk_account_address, nft_collection_address, nft_token_id, asset_amount,
       creator_address, currency_address, price, marketplace_address, acquisition_mode,
       agent_address, policy_version, scores, reasoning_hash, block_number, block_hash,
       acquired_at, opportunity_id, opportunity_type, asset_standard, adapter_address,
       executor_address, owner_approved, acquisition_nonce, state_sequence)
      VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::numeric, 1, NULL,
        '0x0000000000000000000000000000000000000000', 0, $9,
        'V2_AGENT_AUTONOMOUS', $10, $11, '{}'::jsonb, $12, $13, $14, $15,
        $12, 'FREE_MINT', 'ERC721', $16, $17, TRUE, $18::numeric, $19::numeric)
      ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [ROBINHOOD.chainId, verified.transactionHash, verified.logIndex,
      ROBINHOOD.canonicalCollection, String(row.punk_token_id), verified.account,
      verified.collection, verified.tokenId, row.venue_address, row.session_key,
      verified.generation, verified.opportunityId, verified.blockNumber,
      verified.blockHash, new Date(Number(block.timestamp) * 1_000).toISOString(),
      row.adapter_address, deployment.entryPoint.toLowerCase(),
      verified.acquisitionNonce, verified.stateSequence]);
    await database.query(`INSERT INTO broker_v2_activity
      (chain_id, punk_token_id, activity_type, opportunity_id, attempt_id, public_detail, occurred_at)
      VALUES ($1, $2::numeric, 'COLLECTED', $3, $4, $5::jsonb, $6)`,
    [ROBINHOOD.chainId, String(row.punk_token_id), row.opportunity_id, row.attempt_id,
      JSON.stringify({ collection: verified.collection, tokenId: verified.tokenId,
        transactionHash: verified.transactionHash, userOperationHash: verified.userOpHash,
        actualGasCostWei: verified.actualGasCostWei, mode: "AUTONOMOUS" }),
      new Date(now).toISOString()]);
    if (verified.remainingMints === "0") {
      await database.query(`UPDATE broker_v2_agent_sessions SET status = 'COMPLETED',
        updated_at = $1 WHERE session_id = $2 AND status = 'ACTIVE'`,
      [new Date(now).toISOString(), row.session_id]);
      await database.query(`UPDATE broker_v2_strategies SET state = 'PAUSED'
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND version = $4 AND state = 'ACTIVE'`, [ROBINHOOD.chainId,
        ROBINHOOD.canonicalCollection, String(row.punk_token_id), row.strategy_version]);
      await database.query(`INSERT INTO broker_v2_activity
        (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
        VALUES ($1, $2::numeric, 'AGENT_MISSION_COMPLETED', $3::jsonb, $4)`,
      [ROBINHOOD.chainId, String(row.punk_token_id), JSON.stringify({
        transactionHash: verified.transactionHash, userOperationHash: verified.userOpHash,
        reason: "MISSION_MINT_LIMIT_REACHED",
      }), new Date(now).toISOString()]);
    }
    await database.query("COMMIT");
  } catch (error) { await database.query("ROLLBACK"); throw error; }
  finally { database.release(); }
  return Object.freeze({ status: "CONFIRMED", operationId: row.operation_id,
    transactionHash: verified.transactionHash });
}

export async function runScheduledPunkAgentWorker({
  pool = getDatabase().pool, client = null, environment = process.env,
  manifest = deployment, now = new Date(), bundler = null, signer = null,
} = {}) {
  if (environment.PUNK_AGENT_WORKER_ENABLED !== "true") {
    return Object.freeze({ status: "DISABLED", submitted: false });
  }
  const background = backgroundRpcDecision(environment, "PUNK_AGENT_WORKER");
  if (!background.enabled) return Object.freeze({ status: "BACKGROUND_DISABLED",
    submitted: false, reason: background.reason });
  const readiness = punkAgentAccountReadiness(manifest);
  if (!readiness.ready) return Object.freeze({ status: "LOCKED", submitted: false,
    blockers: readiness.blockers });
  const lease = await pool.connect();
  let leaseHeld = false;
  try {
    const leaseResult = await lease.query("SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
      [ROBINHOOD.chainId, 8004]);
    leaseHeld = leaseResult.rows[0]?.acquired === true;
    if (!leaseHeld) return Object.freeze({ status: "WORKER_ALREADY_RUNNING", submitted: false });
    const liveBundler = bundler ?? createPunkAgentBundler({
      url: environment.PUNK_AGENT_BUNDLER_RPC_URL,
    });
    const liveClient = client ?? createClient();
    const liveSigner = signer ?? createPunkAgentSessionSigner(environment);
    const reconciliation = await reconcileOne(pool, liveClient, liveBundler, now);
    if (reconciliation?.status === "PENDING") return Object.freeze({
      status: "RECONCILIATION_PENDING", submitted: false, reconciliation });
    const gas = await gasEnvelope(liveClient, environment);
    const observation = { opportunitiesChecked: 0, liveSimulationsPassed: 0 };
    const run = await runPunkAgentMissionOnce({ deployment: manifest, client: liveClient,
      bundler: liveBundler, signer: liveSigner, gas, now,
      loadMission: () => loadMission(pool, now),
      loadCandidate: ({ mission, runtime }) => loadCandidate(
        pool, liveClient, mission, runtime, now, observation),
      reserveOperation: (input) => reserveOperation(pool, input),
      markSubmitted: (input) => markSubmitted(pool, input),
      markFailed: (input) => markFailed(pool, input) });
    if (run.status === "NO_ELIGIBLE_MATCH") {
      await recordWorkerActivity(pool, run.tokenId, "AGENT_SCOUTED", {
        status: "NO_ELIGIBLE_MATCH", authority: "OWNER_APPROVED_SESSION",
        transactionSubmitted: false, ...observation,
      }, now);
    } else if (run.status === "SUBMITTED") {
      await recordWorkerActivity(pool, run.tokenId, "USER_OPERATION_SUBMITTED", {
        userOperationHash: run.userOpHash, authority: "OWNER_APPROVED_SESSION",
        transactionSubmitted: true, ...observation,
      }, now);
    }
    return Object.freeze({ ...run, reconciliation });
  } finally {
    if (leaseHeld) await lease.query("SELECT pg_advisory_unlock($1::integer, $2::integer)",
      [ROBINHOOD.chainId, 8004]);
    lease.release();
  }
}

export default async function handler() {
  try { return new Response(JSON.stringify({ ok: true,
    ...(await runScheduledPunkAgentWorker()) }), { status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
  catch (error) { return new Response(JSON.stringify({ ok: false,
    code: error?.code ?? "PUNK_AGENT_WORKER_FAILED" }), { status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
}

export const config = { schedule: "* * * * *" };
