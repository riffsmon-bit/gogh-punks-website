import { getDatabase } from "@netlify/database";
import { createPublicClient, encodeFunctionData, http } from "viem";

import deployment from "../../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { PUNK_AGENT_ACCOUNT_SETUP_ABI } from
  "../../broker/src/agent-account/punk-agent-account-setup.mjs";
import { readPunkAgentAccountRuntime } from
  "../../broker/src/agent-account/punk-agent-account-runtime.mjs";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { isV2DeployPreviewUrl, requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const HASH = /^0x[0-9a-f]{64}$/;

function requireOrigin(request) {
  if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request);
  else requireSameOrigin(request);
}

function bodyValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicError(400, "INVALID_REQUEST", "The recall request is invalid.");
  }
  const action = String(value.action ?? "");
  const fields = action === "prepare" ? ["action", "owner", "tokenId"]
    : ["action", "owner", "tokenId", "transactionHash"];
  if (Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The recall request is invalid.");
  }
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  const transactionHash = action === "confirm"
    ? String(value.transactionHash ?? "").toLowerCase() : null;
  if (!["prepare", "confirm"].includes(action) || !OWNER.test(owner) || !TOKEN.test(tokenId)
    || action === "confirm" && !HASH.test(transactionHash)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose a valid Punk recall action.");
  }
  return Object.freeze({ action, owner, tokenId, transactionHash });
}

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function successful(status) {
  return status === "success" || status === 1 || status === 1n || status === "0x1";
}

export async function handleV2AgentAccountRecall(request, {
  pool = getDatabase().pool, readAuthority = readV2PunkAuthority, client = null,
  manifest = deployment, now = new Date(), requireSession = requireV2Session,
  confirmations = 1,
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireOrigin(request);
    const body = bodyValue(await readJson(request, 8_000));
    const auth = await requireSession(request, pool, now);
    if (auth.walletAddress !== body.owner) throw new PublicError(403,
      "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    await readAuthority(body.tokenId, { expectedOwner: body.owner });
    const result = await pool.query(`SELECT session_id::text, punk_account
      FROM broker_v2_agent_sessions WHERE chain_id = $1 AND punk_token_id = $2::numeric
        AND status IN ('ACTIVE', 'PAUSED') ORDER BY created_at DESC LIMIT 1`,
    [ROBINHOOD.chainId, body.tokenId]);
    const row = result.rows[0];
    if (!row) throw new PublicError(409, "NO_ACTIVE_AGENT_SESSION",
      "This Punk has no active on-chain mission to recall.");
    const rpc = client ?? liveClient();
    const before = await readPunkAgentAccountRuntime({ client: rpc, deployment: manifest,
      tokenId: body.tokenId, expectedOwner: body.owner });
    if (!before.accountCreated || before.account !== row.punk_account) {
      throw new PublicError(409, "RECALL_ACCOUNT_MISMATCH",
        "The persisted mission account differs from the live Punk Agent Account.");
    }
    const data = encodeFunctionData({ abi: PUNK_AGENT_ACCOUNT_SETUP_ABI,
      functionName: "revokeAutonomousSession", args: [] }).toLowerCase();
    const transaction = Object.freeze({ from: body.owner, to: row.punk_account,
      value: "0x0", data });
    if (body.action === "prepare") return json({ ok: true, tokenId: body.tokenId,
      sessionId: row.session_id, transaction, transactionPrepared: true,
      transactionSubmitted: false });
    const [chainTransaction, receipt, head] = await Promise.all([
      rpc.getTransaction({ hash: body.transactionHash }),
      rpc.getTransactionReceipt({ hash: body.transactionHash }),
      rpc.getBlockNumber(),
    ]);
    if (!chainTransaction || String(chainTransaction.from).toLowerCase() !== body.owner
      || String(chainTransaction.to).toLowerCase() !== row.punk_account
      || BigInt(chainTransaction.value ?? -1) !== 0n
      || String(chainTransaction.input ?? "").toLowerCase() !== data
      || !receipt || !successful(receipt.status)
      || String(receipt.transactionHash).toLowerCase() !== body.transactionHash
      || BigInt(head) - BigInt(receipt.blockNumber) + 1n < BigInt(confirmations)) {
      throw new PublicError(409, "RECALL_TRANSACTION_UNCONFIRMED",
        "The exact session-revocation transaction is not confirmed.");
    }
    const runtime = await readPunkAgentAccountRuntime({ client: rpc, deployment: manifest,
      tokenId: body.tokenId, expectedOwner: body.owner });
    if (runtime.sessionActive) throw new PublicError(409, "RECALL_STATE_MISMATCH",
      "The Punk Agent Account session is still active on chain.");
    const database = await pool.connect();
    try {
      await database.query("BEGIN");
      const updated = await database.query(`UPDATE broker_v2_agent_sessions
        SET status = 'REVOKED', updated_at = $1 WHERE session_id = $2
          AND status IN ('ACTIVE', 'PAUSED') RETURNING session_id`,
      [new Date(now).toISOString(), row.session_id]);
      if (!updated.rows[0]) throw new PublicError(409, "RECALL_STATE_CHANGED",
        "The mission state changed during recall reconciliation.");
      await database.query(`UPDATE broker_v2_strategies SET state = 'PAUSED'
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND state = 'ACTIVE'`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId]);
      await database.query(`INSERT INTO broker_v2_activity
        (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
        VALUES ($1, $2::numeric, 'AGENT_RECALLED', $3::jsonb, $4)`, [ROBINHOOD.chainId,
        body.tokenId, JSON.stringify({ sessionId: row.session_id,
          transactionHash: body.transactionHash }), new Date(now).toISOString()]);
      await database.query("COMMIT");
    } catch (error) { await database.query("ROLLBACK"); throw error; }
    finally { database.release(); }
    return json({ ok: true, tokenId: body.tokenId, sessionId: row.session_id,
      status: "REVOKED", transactionHash: body.transactionHash,
      strategyPaused: true });
  } catch (error) { return v2Failure(error); }
}

export default handleV2AgentAccountRecall;

export const config = { path: "/api/v2/agent-account/recall", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 10, windowSize: 60,
} };
