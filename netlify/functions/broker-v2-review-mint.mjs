import { getDatabase } from "@netlify/database";
import { createPublicClient, http, parseAbi } from "viem";

import {
  normalizePunkCollectingIntent,
  punkCollectingIntentHash,
} from "../../broker/src/v4/collecting-intent.mjs";
import { v2ExecutionIdentity } from "../../broker/src/v4/execution-boundary.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { matchV2Opportunity } from "../../broker/src/v4/policy-matcher.mjs";
import {
  ownerAssistedMintArtifact,
  ownerAssistedTransactionEnvelopeHash,
  simulateOwnerAssistedSeaDropMint,
  V2OwnerAssistedMintError,
} from "../../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const OPPORTUNITY = /^[a-zA-Z0-9:_-]{8,256}$/;
const ACCOUNT_ABI = parseAbi(["function state() view returns (uint256)"]);

function bodyValue(value) {
  const fields = ["intent", "opportunityId", "owner", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || Object.keys(value).some((field) => !fields.includes(field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The live mint review request is invalid.");
  }
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  const opportunityId = String(value.opportunityId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !OPPORTUNITY.test(opportunityId)
    || !value.intent || typeof value.intent !== "object" || Array.isArray(value.intent)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one owned Punk and one reviewed opportunity.");
  }
  return Object.freeze({ owner, tokenId, opportunityId, intent: value.intent });
}

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function publicPreparationError(error) {
  if (!(error instanceof V2OwnerAssistedMintError)) return error;
  return new PublicError(409, error.code,
    `${error.message}. No transaction was prepared or submitted.`);
}

export async function handleV2ReviewMint(request, { pool = getDatabase().pool,
  readAuthority = readV2PunkAuthority, client = null, now = new Date(),
  simulate = simulateOwnerAssistedSeaDropMint, requireSession = requireV2Session } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = bodyValue(await readJson(request, 20_000));
    const session = await requireSession(request, pool, now);
    if (session.walletAddress !== body.owner) {
      throw new PublicError(403, "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    }
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    let intent;
    try { intent = normalizePunkCollectingIntent(body.intent, now); }
    catch { throw new PublicError(400, "INVALID_STRATEGY", "The confirmed strategy is invalid."); }
    if (intent.operatingMode !== "ASSIST" || intent.punkTokenId !== body.tokenId
      || intent.expectedOwner !== body.owner || intent.punkWallet !== authority.punkWallet) {
      throw new PublicError(409, "ASSIST_REQUIRED",
        "Confirm an ASSIST strategy for this Punk before preparing a real mint.");
    }
    const [opportunityResult, strategyResult] = await Promise.all([
      pool.query(`SELECT normalized FROM broker_v2_opportunities
        WHERE opportunity_id = $1 AND chain_id = 4663
          AND screening_status = 'PASSED'
          AND (expires_at IS NULL OR expires_at > $2) LIMIT 1`,
      [body.opportunityId, new Date(now).toISOString()]),
      pool.query(`SELECT version, intent_hash, intent FROM broker_v2_strategies
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND state = 'ACTIVE' AND expires_at > $4
        ORDER BY version DESC LIMIT 1`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection,
        body.tokenId, new Date(now).toISOString()]),
    ]);
    if (!opportunityResult.rows[0]) throw new PublicError(409, "OPPORTUNITY_UNAVAILABLE",
      "That opportunity is no longer open with a passed contract screen.");
    const strategyRow = strategyResult.rows[0];
    if (!strategyRow) throw new PublicError(409, "ASSIST_REQUIRED",
      "Confirm an active ASSIST strategy for this Punk before preparing a real mint.");
    let activeIntent;
    try { activeIntent = normalizePunkCollectingIntent(strategyRow.intent, now); }
    catch { throw new PublicError(409, "ACTIVE_STRATEGY_INVALID", "The active strategy is no longer valid."); }
    const suppliedHash = punkCollectingIntentHash(intent, now);
    const activeHash = punkCollectingIntentHash(activeIntent, now);
    if (suppliedHash !== activeHash || activeHash !== String(strategyRow.intent_hash).toLowerCase()
      || activeIntent.operatingMode !== "ASSIST") {
      throw new PublicError(409, "STRATEGY_CHANGED",
        "The confirmed ASSIST strategy changed. Refresh it before preparing a real mint.");
    }
    intent = activeIntent;
    const opportunity = normalizeV2Opportunity(opportunityResult.rows[0].normalized, now);
    const rpc = client ?? liveClient();
    let simulation;
    try { simulation = await simulate({ client: rpc, authority, opportunity, now }); }
    catch (error) { throw publicPreparationError(error); }
    const executableOpportunity = normalizeV2Opportunity({ ...opportunity,
      simulationStatus: "PASSED", estimatedGasCostWei: simulation.evidence.estimatedGasWei,
      expectedNftReceiver: authority.punkWallet, updatedAt: new Date(now).toISOString() }, now);
    await pool.query(`INSERT INTO broker_v2_simulations
      (opportunity_id, punk_account, input_hash, pinned_block, status, gas_estimate,
       expected_receiver, effects, simulated_at)
      VALUES ($1, $2, $3, $4::numeric, 'PASSED', $5::numeric, $2, $6::jsonb, $7)
      ON CONFLICT (opportunity_id, punk_account, input_hash) DO NOTHING`,
    [body.opportunityId, authority.punkWallet, simulation.evidence.inputHash,
      simulation.evidence.pinnedBlock, simulation.evidence.estimatedGasWei,
      JSON.stringify({ expectedTokenId: simulation.evidence.expectedTokenId,
        quantity: 1, mintPriceWei: "0", callDidNotRevert: true,
        effectTraceAvailable: false, postconditionPendingReceipt: true,
        ownerApprovalRequired: true }), simulation.evidence.simulatedAt]);
    const accountState = await rpc.readContract({ address: authority.punkWallet,
      abi: ACCOUNT_ABI, functionName: "state", blockNumber: BigInt(simulation.evidence.pinnedBlock) });
    if (typeof accountState !== "bigint" || accountState < 0n) {
      throw new PublicError(503, "ACCOUNT_STATE_UNAVAILABLE", "The Punk Wallet state is unavailable.");
    }
    const strategyVersion = Number(strategyRow.version);
    if (!Number.isSafeInteger(strategyVersion) || strategyVersion < 1) {
      throw new PublicError(503, "ACTIVE_STRATEGY_INVALID", "The active strategy version is invalid.");
    }
    const idempotencyKey = v2ExecutionIdentity({ chainId: ROBINHOOD.chainId,
      punkWallet: authority.punkWallet, opportunityId: body.opportunityId,
      strategyHash: activeHash, accountNonce: accountState.toString(), operatingMode: "ASSIST" });
    const envelopeHash = ownerAssistedTransactionEnvelopeHash(simulation.transaction);
    const database = await pool.connect();
    let reservation;
    let match;
    try {
      await database.query("BEGIN");
      await database.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        [ROBINHOOD.chainId, Number(body.tokenId)]);
      const lockedStrategy = await database.query(`SELECT version, intent_hash, state
        FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
          AND token_id = $3::numeric AND version = $4 FOR UPDATE`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId, strategyVersion]);
      const lockedStrategyRow = lockedStrategy.rows[0];
      if (!lockedStrategyRow || lockedStrategyRow.state !== "ACTIVE"
        || String(lockedStrategyRow.intent_hash).toLowerCase() !== activeHash) {
        throw new PublicError(409, "STRATEGY_CHANGED",
          "The confirmed ASSIST strategy changed before the mint reservation.");
      }
      const existingResult = await database.query(`SELECT attempt_id::text, state,
          transaction_envelope_hash FROM broker_v2_execution_attempts
        WHERE idempotency_key = $1 FOR UPDATE`, [idempotencyKey]);
      const existing = existingResult.rows[0];
      if (existing && ["SUBMITTED", "CONFIRMED", "RECONCILIATION_REQUIRED"].includes(existing.state)) {
        throw new PublicError(409, "ATTEMPT_ALREADY_SUBMITTED",
          "This exact owner-approved mint has already been submitted or confirmed.");
      }
      if (existing && !["OWNER_APPROVAL_PENDING", "EXPIRED"].includes(existing.state)) {
        throw new PublicError(409, "ATTEMPT_UNAVAILABLE", "This exact mint attempt cannot be reused.");
      }
      if (existing?.transaction_envelope_hash
        && existing.transaction_envelope_hash !== envelopeHash) {
        throw new PublicError(409, "ATTEMPT_ENVELOPE_CHANGED",
          "The exact transaction changed. No owner approval was requested.");
      }
      const usageResult = await database.query(`SELECT
          COUNT(*) FILTER (WHERE occurred_at >=
            date_trunc('day', $3::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE opportunity_id = $2)::integer AS opportunity
        FROM broker_v2_activity WHERE chain_id = $4 AND punk_token_id = $1::numeric
          AND activity_type = 'COLLECTED'`, [body.tokenId, body.opportunityId,
        new Date(now).toISOString(), ROBINHOOD.chainId]);
      const pendingResult = await database.query(`SELECT
          COUNT(*)::integer AS daily,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE opportunity_id = $2)::integer AS opportunity
        FROM broker_v2_execution_attempts WHERE chain_id = $3 AND punk_token_id = $1::numeric
          AND idempotency_key <> $4
          AND state IN ('OWNER_APPROVAL_PENDING', 'OWNER_APPROVED', 'SUBMISSION_RESERVED',
            'SUBMITTED', 'RECONCILIATION_REQUIRED')`, [body.tokenId,
        body.opportunityId, ROBINHOOD.chainId, idempotencyKey]);
      const usage = usageResult.rows[0] ?? {};
      const pending = pendingResult.rows[0] ?? {};
      match = matchV2Opportunity(intent, executableOpportunity, {
        currentOwner: authority.owner, punkWallet: authority.punkWallet,
        punkWalletBalanceWei: authority.nativeBalanceWei,
        dailyMints: Number(usage.daily ?? 0) + Number(pending.daily ?? 0),
        totalMints: Number(usage.total ?? 0) + Number(pending.total ?? 0),
        opportunityMints: Number(usage.opportunity ?? 0) + Number(pending.opportunity ?? 0),
      }, now);
      if (!match.recommendationEligible) throw new PublicError(409, "POLICY_REJECTED",
        `The opportunity no longer fits the confirmed strategy: ${match.reasons.join(", ")}.`);
      const approvalExpiresAt = new Date(new Date(now).getTime() + 90_000).toISOString();
      if (existing) {
        const refreshed = await database.query(`UPDATE broker_v2_execution_attempts
          SET state = 'OWNER_APPROVAL_PENDING', transaction_envelope_hash = $1,
            approval_expires_at = $2, rejection_code = NULL, updated_at = $3
          WHERE attempt_id = $4 RETURNING attempt_id::text`, [envelopeHash, approvalExpiresAt,
          new Date(now).toISOString(), existing.attempt_id]);
        reservation = { attemptId: refreshed.rows[0].attempt_id, replayed: true };
      } else {
        const inserted = await database.query(`INSERT INTO broker_v2_execution_attempts
          (idempotency_key, chain_id, punk_token_id, punk_account, owner_snapshot,
           opportunity_id, strategy_version, strategy_hash, account_nonce, operating_mode,
           state, transaction_envelope_hash, approval_expires_at, created_at, updated_at)
          VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9::numeric, 'ASSIST',
            'OWNER_APPROVAL_PENDING', $10, $11, $12, $12)
          RETURNING attempt_id::text`, [idempotencyKey, ROBINHOOD.chainId, body.tokenId,
          authority.punkWallet, authority.owner, body.opportunityId, strategyVersion,
          activeHash, accountState.toString(), envelopeHash, approvalExpiresAt,
          new Date(now).toISOString()]);
        reservation = { attemptId: inserted.rows[0].attempt_id, replayed: false };
      }
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK");
      throw error;
    } finally { database.release(); }
    const attempt = Object.freeze({ attemptId: reservation.attemptId, idempotencyKey });
    return json({ ok: true, reviewOnlyUntilWalletApproval: true, authority: "OWNER_WALLET",
      attemptId: reservation.attemptId, replayed: reservation.replayed,
      mint: ownerAssistedMintArtifact(simulation, intent, now, attempt), match,
      transactionSubmitted: false }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(error); }
}

export default handleV2ReviewMint;

export const config = { path: "/api/v2/review/mint", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 5, windowSize: 60,
} };
