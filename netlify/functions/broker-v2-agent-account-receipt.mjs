import { getDatabase } from "@netlify/database";
import { createPublicClient, encodeFunctionData, http, keccak256 } from "viem";

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function origin(request) {
  if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request);
  else requireSameOrigin(request);
}

function bodyValue(value) {
  const fields = ["authorizationTransactionHash", "owner", "sessionId", "setupArtifactHash", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The session receipt request is invalid.");
  }
  const body = Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, typeof item === "string" ? item.toLowerCase() : item]));
  if (!OWNER.test(body.owner) || !TOKEN.test(body.tokenId) || !UUID.test(body.sessionId)
    || !HASH.test(body.setupArtifactHash) || !HASH.test(body.authorizationTransactionHash)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one valid Punk mission receipt.");
  }
  return Object.freeze(body);
}

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function successful(status) {
  return status === "success" || status === 1 || status === 1n || status === "0x1";
}

function seconds(value) {
  return BigInt(Math.floor(new Date(value).getTime() / 1_000));
}

function sessionConfig(row) {
  return { sessionKey: row.session_key, adapter: row.adapter_address,
    venue: row.venue_address, adapterCodeHash: row.adapter_code_hash,
    targetCollection: row.target_collection, validAfter: seconds(row.valid_after),
    validUntil: seconds(row.valid_until), maxMintsPerDay: Number(row.max_mints_per_day),
    maxMintsTotal: Number(row.max_mints_total), maxGasCostWei: BigInt(row.max_gas_cost_wei),
    minimumNativeReserveWei: BigInt(row.minimum_native_reserve_wei) };
}

function sameSession(live, row) {
  const expected = sessionConfig(row);
  return live.sessionActive && live.sessionGeneration === BigInt(row.session_generation)
    && live.session.generation === BigInt(row.session_generation)
    && live.session.sessionKey === row.session_key
    && live.session.authorizingOwner === row.owner_snapshot
    && live.session.adapter === row.adapter_address
    && live.session.venue === row.venue_address
    && live.session.adapterCodeHash === row.adapter_code_hash
    && live.session.targetCollection === row.target_collection
    && live.session.validAfter === expected.validAfter
    && live.session.validUntil === expected.validUntil
    && live.session.maxMintsPerDay === BigInt(expected.maxMintsPerDay)
    && live.session.remainingMints === BigInt(expected.maxMintsTotal)
    && live.session.maxGasCostWei === expected.maxGasCostWei
    && live.session.minimumNativeReserveWei === expected.minimumNativeReserveWei;
}

export async function handleV2AgentAccountReceipt(request, {
  pool = getDatabase().pool, readAuthority = readV2PunkAuthority, client = null,
  manifest = deployment, now = new Date(), requireSession = requireV2Session,
  confirmations = 1,
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    origin(request);
    const body = bodyValue(await readJson(request, 8_000));
    const auth = await requireSession(request, pool, now);
    if (auth.walletAddress !== body.owner) throw new PublicError(403,
      "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    await readAuthority(body.tokenId, { expectedOwner: body.owner });
    const sessionResult = await pool.query(`SELECT session_id::text, chain_id, punk_token_id,
        punk_account, owner_snapshot, strategy_version, strategy_hash, session_key,
        session_generation, adapter_address, venue_address, adapter_code_hash,
        target_collection, max_mints_per_day, max_mints_total, max_gas_cost_wei,
        minimum_native_reserve_wei, valid_after, valid_until, status, setup_artifact_hash,
        authorization_transaction_hash
      FROM broker_v2_agent_sessions WHERE session_id = $1 AND chain_id = $2
        AND punk_token_id = $3::numeric LIMIT 1`, [body.sessionId, ROBINHOOD.chainId, body.tokenId]);
    const row = sessionResult.rows[0];
    if (!row || row.owner_snapshot !== body.owner
      || row.setup_artifact_hash !== body.setupArtifactHash
      || !["PENDING_RECEIPT", "ACTIVE"].includes(row.status)) {
      throw new PublicError(409, "SESSION_RECEIPT_MISMATCH",
        "That transaction is not bound to the pending Punk mission.");
    }
    if (row.status === "ACTIVE") {
      if (row.authorization_transaction_hash !== body.authorizationTransactionHash) {
        throw new PublicError(409, "SESSION_RECEIPT_MISMATCH",
          "This mission was activated by a different transaction.");
      }
      return json({ ok: true, replayed: true, tokenId: body.tokenId,
        session: { sessionId: body.sessionId, status: "ACTIVE",
          transactionHash: body.authorizationTransactionHash }, strategyActivated: true });
    }
    const rpc = client ?? liveClient();
    const [transaction, receipt, head] = await Promise.all([
      rpc.getTransaction({ hash: body.authorizationTransactionHash }),
      rpc.getTransactionReceipt({ hash: body.authorizationTransactionHash }), rpc.getBlockNumber(),
    ]);
    const config = sessionConfig(row);
    const expectedData = encodeFunctionData({ abi: PUNK_AGENT_ACCOUNT_SETUP_ABI,
      functionName: "configureAutonomousSession", args: [config] }).toLowerCase();
    if (!transaction || String(transaction.from).toLowerCase() !== body.owner
      || String(transaction.to).toLowerCase() !== row.punk_account
      || BigInt(transaction.value ?? -1) !== 0n
      || String(transaction.input ?? "").toLowerCase() !== expectedData
      || !receipt || !successful(receipt.status)
      || String(receipt.transactionHash).toLowerCase() !== body.authorizationTransactionHash
      || BigInt(head) - BigInt(receipt.blockNumber) + 1n < BigInt(confirmations)) {
      throw new PublicError(409, "SESSION_TRANSACTION_UNCONFIRMED",
        "The exact owner-approved mission session is not yet confirmed.");
    }
    const runtime = await readPunkAgentAccountRuntime({ client: rpc, deployment: manifest,
      tokenId: body.tokenId, expectedOwner: body.owner, expectedSessionKey: row.session_key });
    if (!sameSession(runtime, row)) throw new PublicError(409, "SESSION_STATE_MISMATCH",
      "Confirmed on-chain session differs from the reviewed mission.");
    const database = await pool.connect();
    try {
      await database.query("BEGIN");
      const updated = await database.query(`UPDATE broker_v2_agent_sessions
        SET status = 'ACTIVE', authorization_transaction_hash = $1, activated_at = $2,
          updated_at = $2 WHERE session_id = $3 AND status = 'PENDING_RECEIPT'
        RETURNING session_id`, [body.authorizationTransactionHash,
        new Date(now).toISOString(), body.sessionId]);
      if (!updated.rows[0]) throw new PublicError(409, "SESSION_STATE_CHANGED",
        "Mission session changed before receipt reconciliation.");
      await database.query(`UPDATE broker_v2_strategies SET state = 'SUPERSEDED'
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND state = 'ACTIVE' AND version <> $4`, [ROBINHOOD.chainId,
        ROBINHOOD.canonicalCollection, body.tokenId, row.strategy_version]);
      const strategy = await database.query(`UPDATE broker_v2_strategies SET state = 'ACTIVE',
          owner_confirmation_hash = $1, activated_at = $2
        WHERE chain_id = $3 AND collection_address = $4 AND token_id = $5::numeric
          AND version = $6 AND intent_hash = $7 AND state = 'PENDING_OWNER_CONFIRMATION'
        RETURNING version`,
      [body.authorizationTransactionHash, new Date(now).toISOString(), ROBINHOOD.chainId,
        ROBINHOOD.canonicalCollection, body.tokenId, row.strategy_version, row.strategy_hash]);
      if (!strategy.rows[0]) throw new PublicError(409, "STRATEGY_STATE_CHANGED",
        "Mission strategy changed before receipt reconciliation.");
      await database.query(`INSERT INTO broker_v2_profiles
        (chain_id, collection_address, token_id, active_strategy_version)
        VALUES ($1, $2, $3::numeric, $4) ON CONFLICT (chain_id, collection_address, token_id)
        DO UPDATE SET active_strategy_version = EXCLUDED.active_strategy_version,
          updated_at = $5`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection,
        body.tokenId, row.strategy_version, new Date(now).toISOString()]);
      await database.query(`INSERT INTO broker_v2_activity
        (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
        VALUES ($1, $2::numeric, 'AGENT_SESSION_AUTHORIZED', $3::jsonb, $4)`,
      [ROBINHOOD.chainId, body.tokenId, JSON.stringify({ product: "Punk Agent Account",
        account: row.punk_account, sessionKey: row.session_key,
        sessionGeneration: Number(row.session_generation),
        strategyVersion: Number(row.strategy_version),
        authorizationTransactionHash: body.authorizationTransactionHash,
        setupArtifactHash: body.setupArtifactHash, calldataHash: keccak256(expectedData) }),
      new Date(now).toISOString()]);
      await database.query("COMMIT");
    } catch (error) { await database.query("ROLLBACK"); throw error; }
    finally { database.release(); }
    return json({ ok: true, replayed: false, tokenId: body.tokenId,
      session: { sessionId: body.sessionId, status: "ACTIVE",
        transactionHash: body.authorizationTransactionHash,
        account: row.punk_account, validUntil: new Date(row.valid_until).toISOString() },
      strategyActivated: true, automaticMintAuthorityActive: true }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(error); }
}

export default handleV2AgentAccountReceipt;

export const config = { path: "/api/v2/agent-account/receipt", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 10, windowSize: 60,
} };
