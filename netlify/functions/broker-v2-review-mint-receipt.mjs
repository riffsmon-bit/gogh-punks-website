import { getDatabase } from "@netlify/database";
import { createPublicClient, decodeEventLog, http, parseAbi } from "viem";

import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  buildOwnerAssistedSeaDropTransaction,
  ownerAssistedTransactionEnvelopeHash,
} from "../../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const HASH = /^0x[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ERC721_ABI = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

function requestBody(value) {
  const fields = ["attemptId", "owner", "tokenId", "transactionHash"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || Object.keys(value).some((field) => !fields.includes(field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The mint receipt request is invalid.");
  }
  const attemptId = String(value.attemptId ?? "").toLowerCase();
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  const transactionHash = String(value.transactionHash ?? "").toLowerCase();
  if (!UUID.test(attemptId) || !OWNER.test(owner) || !TOKEN.test(tokenId)
    || !HASH.test(transactionHash)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one valid owner-approved mint receipt.");
  }
  return Object.freeze({ attemptId, owner, tokenId, transactionHash });
}

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function normalizedAddress(value) {
  const output = String(value ?? "").toLowerCase();
  return OWNER.test(output) ? output : null;
}

function exactMintTransfer(receipt, collection, punkWallet) {
  const transfers = [];
  for (const log of receipt?.logs ?? []) {
    if (normalizedAddress(log.address) !== collection) continue;
    try {
      const decoded = decodeEventLog({ abi: ERC721_ABI, data: log.data, topics: log.topics,
        strict: true });
      if (decoded.eventName === "Transfer"
        && normalizedAddress(decoded.args.from) === ZERO_ADDRESS
        && normalizedAddress(decoded.args.to) === punkWallet
        && typeof decoded.args.tokenId === "bigint") transfers.push(decoded.args.tokenId);
    } catch { /* Non-Transfer logs from the same collection are irrelevant. */ }
  }
  if (transfers.length !== 1) {
    throw new PublicError(409, "MINT_TRANSFER_MISMATCH",
      "The receipt does not contain exactly one NFT mint into this Punk Wallet.");
  }
  return transfers[0];
}

function assertExactTransaction(transaction, expected, transactionHash) {
  let value = -1n;
  let chainId = null;
  let malformed = false;
  try {
    value = BigInt(transaction?.value ?? -1);
    chainId = transaction?.chainId === undefined ? null : BigInt(transaction.chainId);
  } catch { malformed = true; }
  if (malformed || !transaction || String(transaction.hash ?? "").toLowerCase() !== transactionHash
    || normalizedAddress(transaction.from) !== expected.from
    || normalizedAddress(transaction.to) !== expected.to || value !== 0n
    || String(transaction.input ?? "").toLowerCase() !== expected.data
    || (chainId !== null && chainId !== 4663n)) {
    throw new PublicError(409, "TRANSACTION_MISMATCH",
      "That transaction is not the exact owner-approved Punk Wallet mint.");
  }
}

async function markSubmitted(pool, body, envelopeHash, now) {
  try {
    const result = await pool.query(`UPDATE broker_v2_execution_attempts
      SET state = 'SUBMITTED', transaction_hash = $1, submitted_at = COALESCE(submitted_at, $2),
        updated_at = $2
      WHERE attempt_id = $3 AND transaction_envelope_hash = $4
        AND (transaction_hash IS NULL OR transaction_hash = $1)
        AND state IN ('OWNER_APPROVAL_PENDING', 'OWNER_APPROVED', 'SUBMISSION_RESERVED',
          'SUBMITTED', 'RECONCILIATION_REQUIRED') RETURNING attempt_id`, [body.transactionHash,
      new Date(now).toISOString(), body.attemptId, envelopeHash]);
    if (!result.rows[0]) throw new PublicError(409, "ATTEMPT_MISMATCH",
      "The transaction does not match an open owner-approved mint attempt.");
  } catch (error) {
    if (error?.code === "23505") throw new PublicError(409, "TRANSACTION_ALREADY_RECORDED",
      "That transaction is already bound to another mint attempt.");
    throw error;
  }
}

export async function handleV2ReviewMintReceipt(request, { pool = getDatabase().pool,
  readAuthority = readV2PunkAuthority, client = null, now = new Date(),
  requireSession = requireV2Session } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = requestBody(await readJson(request, 8_000));
    const session = await requireSession(request, pool, now);
    if (session.walletAddress !== body.owner) {
      throw new PublicError(403, "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    }
    const attemptResult = await pool.query(`SELECT attempt.attempt_id::text, attempt.punk_account,
        attempt.owner_snapshot, attempt.opportunity_id, attempt.state,
        attempt.transaction_envelope_hash, attempt.transaction_hash,
        opportunity.collection_contract, opportunity.normalized
      FROM broker_v2_execution_attempts attempt
      JOIN broker_v2_opportunities opportunity ON opportunity.opportunity_id = attempt.opportunity_id
      WHERE attempt.attempt_id = $1 AND attempt.chain_id = $2
        AND attempt.punk_token_id = $3::numeric AND attempt.owner_snapshot = $4 LIMIT 1`,
    [body.attemptId, ROBINHOOD.chainId, body.tokenId, body.owner]);
    const attempt = attemptResult.rows[0];
    if (!attempt) throw new PublicError(404, "ATTEMPT_NOT_FOUND",
      "That owner-approved mint attempt was not found.");
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    const punkWallet = normalizedAddress(attempt.punk_account);
    const collection = normalizedAddress(attempt.collection_contract);
    if (!punkWallet || !collection || punkWallet !== authority.punkWallet) {
      throw new PublicError(409, "ATTEMPT_AUTHORITY_CHANGED",
        "The mint attempt no longer matches current Punk authority.");
    }
    const expected = buildOwnerAssistedSeaDropTransaction({ owner: body.owner, punkWallet, collection });
    const envelopeHash = ownerAssistedTransactionEnvelopeHash(expected);
    if (attempt.transaction_envelope_hash !== envelopeHash
      || (attempt.transaction_hash && attempt.transaction_hash !== body.transactionHash)) {
      throw new PublicError(409, "ATTEMPT_MISMATCH",
        "The mint attempt does not match that exact transaction.");
    }
    const rpc = client ?? liveClient();
    const transaction = await rpc.getTransaction({ hash: body.transactionHash });
    assertExactTransaction(transaction, expected, body.transactionHash);
    let receipt;
    try { receipt = await rpc.getTransactionReceipt({ hash: body.transactionHash }); }
    catch {
      await markSubmitted(pool, body, envelopeHash, now);
      return json({ ok: true, confirmed: false, state: "SUBMITTED",
        transactionHash: body.transactionHash }, 202);
    }
    if (!receipt || String(receipt.transactionHash ?? "").toLowerCase() !== body.transactionHash
      || normalizedAddress(receipt.from) !== expected.from
      || normalizedAddress(receipt.to) !== expected.to
      || typeof receipt.blockNumber !== "bigint") {
      throw new PublicError(409, "RECEIPT_MISMATCH", "The on-chain receipt is malformed or mismatched.");
    }
    if (receipt.status !== "success") {
      await pool.query(`UPDATE broker_v2_execution_attempts
        SET state = 'REVERTED', transaction_hash = $1, submitted_at = COALESCE(submitted_at, $2),
          updated_at = $2, rejection_code = 'ON_CHAIN_REVERT'
        WHERE attempt_id = $3 AND transaction_envelope_hash = $4
          AND (transaction_hash IS NULL OR transaction_hash = $1)`, [body.transactionHash,
        new Date(now).toISOString(), body.attemptId, envelopeHash]);
      throw new PublicError(409, "MINT_REVERTED", "The owner-approved mint reverted on-chain.");
    }
    if (transaction.blockNumber !== receipt.blockNumber) {
      throw new PublicError(409, "RECEIPT_MISMATCH", "The transaction and receipt blocks disagree.");
    }
    const mintedTokenId = exactMintTransfer(receipt, collection, punkWallet);
    const [mintedOwner, block] = await Promise.all([
      rpc.readContract({ address: collection, abi: ERC721_ABI, functionName: "ownerOf",
        args: [mintedTokenId], blockNumber: receipt.blockNumber }),
      rpc.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    if (normalizedAddress(mintedOwner) !== punkWallet || typeof block?.timestamp !== "bigint") {
      throw new PublicError(409, "POSTCONDITION_FAILED",
        "The confirmed NFT was not held by the Punk Wallet at the mint block.");
    }
    const occurredAt = new Date(Number(block.timestamp) * 1_000).toISOString();
    const database = await pool.connect();
    let replayed = false;
    try {
      await database.query("BEGIN");
      await database.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        [ROBINHOOD.chainId, Number(body.tokenId)]);
      const lockedResult = await database.query(`SELECT state, transaction_envelope_hash,
          transaction_hash FROM broker_v2_execution_attempts
        WHERE attempt_id = $1 AND chain_id = $2 AND punk_token_id = $3::numeric
          AND owner_snapshot = $4 FOR UPDATE`, [body.attemptId, ROBINHOOD.chainId,
        body.tokenId, body.owner]);
      const locked = lockedResult.rows[0];
      if (!locked || locked.transaction_envelope_hash !== envelopeHash
        || (locked.transaction_hash && locked.transaction_hash !== body.transactionHash)) {
        throw new PublicError(409, "ATTEMPT_MISMATCH",
          "The mint attempt changed before receipt reconciliation.");
      }
      replayed = locked.state === "CONFIRMED";
      if (!replayed && ["OWNER_APPROVAL_PENDING", "OWNER_APPROVED", "SUBMISSION_RESERVED",
        "SUBMITTED", "RECONCILIATION_REQUIRED"].includes(locked.state)) {
        await database.query(`UPDATE broker_v2_execution_attempts
          SET state = 'CONFIRMED', transaction_hash = $1,
            submitted_at = COALESCE(submitted_at, $2), confirmed_at = $2,
            updated_at = $2, rejection_code = NULL
          WHERE attempt_id = $3`, [body.transactionHash, new Date(now).toISOString(), body.attemptId]);
      } else if (!replayed) {
        throw new PublicError(409, "ATTEMPT_STATE_INVALID",
          "This mint receipt cannot reconcile from the attempt's terminal state.");
      }
      await database.query(`INSERT INTO broker_v2_activity
        (chain_id, punk_token_id, activity_type, opportunity_id, attempt_id, public_detail, occurred_at)
        VALUES ($1, $2::numeric, 'COLLECTED', $3, $4, $5::jsonb, $6)
        ON CONFLICT DO NOTHING`, [ROBINHOOD.chainId, body.tokenId, attempt.opportunity_id,
        body.attemptId, JSON.stringify({ collection, tokenId: mintedTokenId.toString(),
          transactionHash: body.transactionHash, mintPriceWei: "0", quantity: 1,
          ownerApproved: true, executionAuthority: "OWNER_WALLET" }), occurredAt]);
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK");
      if (error?.code === "23505") throw new PublicError(409, "TRANSACTION_ALREADY_RECORDED",
        "That transaction is already bound to another mint attempt.");
      throw error;
    } finally { database.release(); }
    return json({ ok: true, confirmed: true, state: "CONFIRMED", replayed,
      attemptId: body.attemptId, opportunityId: attempt.opportunity_id,
      transactionHash: body.transactionHash, collection, tokenId: mintedTokenId.toString(),
      punkWallet }, 200, { "cache-control": "private, no-store",
      "netlify-cdn-cache-control": "no-store" });
  } catch (error) { return v2Failure(error); }
}

export default handleV2ReviewMintReceipt;

export const config = { path: "/api/v2/review/mint-receipt", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 12, windowSize: 60,
} };
