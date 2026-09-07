import { getDatabase } from "@netlify/database";

import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  normalizePunkCollectingIntent,
  punkCollectingIntentHash,
} from "../../broker/src/v4/collecting-intent.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

function requestBody(value) {
  const fields = ["intent", "owner", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The review strategy draft is invalid.");
  }
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !value.intent
    || typeof value.intent !== "object" || Array.isArray(value.intent)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one owned Punk and complete strategy.");
  }
  return Object.freeze({ owner, tokenId, intent: value.intent });
}

export async function handleV2ReviewStrategyDraft(request, {
  pool = getDatabase().pool,
  readAuthority = readV2PunkAuthority,
  requireSession = requireV2Session,
  now = new Date(),
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = requestBody(await readJson(request, 20_000));
    const session = await requireSession(request, pool, now);
    if (session.walletAddress !== body.owner) {
      throw new PublicError(403, "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    }
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    let intent;
    try { intent = normalizePunkCollectingIntent(body.intent, now); }
    catch { throw new PublicError(400, "INVALID_STRATEGY", "The complete strategy is invalid."); }
    if (intent.operatingMode !== "ASSIST" || intent.punkTokenId !== body.tokenId
      || intent.expectedOwner !== body.owner || intent.punkWallet !== authority.punkWallet) {
      throw new PublicError(409, "ASSIST_REQUIRED",
        "Choose ASSIST and review the complete owner-bound strategy before live minting.");
    }
    const intentHash = punkCollectingIntentHash(intent, now);
    const client = await pool.connect();
    let version;
    try {
      await client.query("BEGIN");
      const lock = (BigInt(ROBINHOOD.chainId) * 10_000n + BigInt(body.tokenId)).toString();
      await client.query("SELECT pg_advisory_xact_lock($1)", [lock]);
      await client.query(`INSERT INTO broker_punks
        (chain_id, collection_address, token_id, account_address, account_version, owner_snapshot)
        VALUES ($1, $2, $3::numeric, $4, 3, $5)
        ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE SET
          account_address = EXCLUDED.account_address, account_version = EXCLUDED.account_version,
          owner_snapshot = EXCLUDED.owner_snapshot, updated_at = NOW()`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId,
        authority.punkWallet, body.owner]);
      const existing = await client.query(`SELECT version FROM broker_v2_strategies
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND intent_hash = $4 AND state = 'PENDING_OWNER_CONFIRMATION'
          AND expires_at > $5 LIMIT 1`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId, intentHash,
        new Date(now).toISOString()]);
      if (existing.rows[0]) version = Number(existing.rows[0].version);
      else {
        const next = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS version
          FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
            AND token_id = $3::numeric`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId]);
        version = Number(next.rows[0].version);
        await client.query(`INSERT INTO broker_v2_strategies
          (chain_id, collection_address, token_id, version, schema_name, intent_hash, intent,
           state, configured_by, ownership_block, expires_at)
          VALUES ($1, $2, $3::numeric, $4, 'PUNK_COLLECTING_INTENT_V1',
            $5, $6::jsonb, 'PENDING_OWNER_CONFIRMATION', $7, $8::bigint, $9)`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId, version,
          intentHash, JSON.stringify(intent), body.owner, authority.blockNumber, intent.expiration]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return json({ ok: true, tokenId: body.tokenId, draft: { version, intentHash,
      intent, state: "PENDING_OWNER_CONFIRMATION" }, transactionPrepared: false }, 200,
    { "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store" });
  } catch (error) { return v2Failure(error); }
}

export default handleV2ReviewStrategyDraft;

export const config = { path: "/api/v2/review/strategy-draft", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 10, windowSize: 60,
} };
