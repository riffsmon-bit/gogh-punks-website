import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { defaultAskIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { interpretPunkCollectingIntent } from "../../broker/src/v4/ai/intent-interpreter.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";

function tokenIdFrom(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/v2\/punks\/(\d+)\/chat$/);
  if (!match || !/^(?:0|[1-9]\d{0,3})$/.test(match[1])) {
    throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk.");
  }
  return match[1];
}
function message(value) {
  if (typeof value !== "string") throw new PublicError(400, "INVALID_MESSAGE", "Write a message to your Punk.");
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!clean || Buffer.byteLength(clean, "utf8") > 8_000) {
    throw new PublicError(400, "INVALID_MESSAGE", "The message is empty or too long.");
  }
  return clean;
}
function punkReply(confirmation) {
  const taste = confirmation.lookingFor.length ? confirmation.lookingFor.join(" + ").replaceAll("_", " ") : "OPEN TASTE";
  return `GOT IT. ${confirmation.mintPrice.toUpperCase()}. ${taste}. ${confirmation.dailyLimit} MAX PER DAY. REVIEW THE RULES BEFORE THEY CHANGE.`;
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    requireSameOrigin(request);
    const tokenId = tokenIdFrom(request);
    const session = await requireV2Session(request, pool);
    const authority = await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    const body = await readJson(request, 12_000);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, "message")) {
      throw new PublicError(400, "INVALID_REQUEST", "The chat request is invalid.");
    }
    const ownerMessage = message(body.message);
    const latest = await pool.query(`SELECT intent FROM broker_v2_strategies
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
        AND state IN ('ACTIVE', 'PAUSED') AND expires_at > NOW()
      ORDER BY version DESC LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
    const now = new Date();
    const currentIntent = latest.rows[0]?.intent ?? defaultAskIntent({ punkTokenId: tokenId,
      expectedOwner: session.walletAddress, punkWallet: authority.punkWallet }, now);
    const intelligence = createDatabaseBackedGoghIntelligence(pool);
    const interpreted = await interpretPunkCollectingIntent({ router: intelligence.router,
      message: ownerMessage, currentIntent, context: { ownerFingerprint: session.walletAddress,
        punkTokenId: tokenId }, now });
    const client = await pool.connect();
    let version;
    let conversationId;
    try {
      await client.query("BEGIN");
      const lock = (BigInt(ROBINHOOD.chainId) * 10_000n + BigInt(tokenId)).toString();
      await client.query("SELECT pg_advisory_xact_lock($1)", [lock]);
      await client.query(`INSERT INTO broker_punks
        (chain_id, collection_address, token_id, account_address, account_version, owner_snapshot)
        VALUES ($1, $2, $3::numeric, $4, 3, $5)
        ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE SET
          account_address = EXCLUDED.account_address, account_version = EXCLUDED.account_version,
          owner_snapshot = EXCLUDED.owner_snapshot, updated_at = NOW()`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, authority.punkWallet, session.walletAddress]);
      await client.query(`UPDATE broker_v2_conversations SET state = 'OWNER_CHANGED', updated_at = NOW()
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND state = 'ACTIVE' AND owner_snapshot <> $4`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, session.walletAddress]);
      const conversation = await client.query(`SELECT conversation_id FROM broker_v2_conversations
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND owner_snapshot = $4 AND state = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, session.walletAddress]);
      if (conversation.rows[0]) conversationId = conversation.rows[0].conversation_id;
      else {
        const created = await client.query(`INSERT INTO broker_v2_conversations
          (chain_id, collection_address, token_id, owner_snapshot)
          VALUES ($1, $2, $3::numeric, $4) RETURNING conversation_id`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, session.walletAddress]);
        conversationId = created.rows[0].conversation_id;
      }
      const next = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
          AND token_id = $3::numeric`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
      version = Number(next.rows[0].version);
      await client.query(`INSERT INTO broker_v2_strategies
        (chain_id, collection_address, token_id, version, schema_name, intent_hash, intent,
         state, configured_by, ownership_block, expires_at)
        VALUES ($1, $2, $3::numeric, $4, 'PUNK_COLLECTING_INTENT_V1',
          $5, $6::jsonb, 'PENDING_OWNER_CONFIRMATION', $7, $8::bigint, $9)`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, version,
        interpreted.confirmation.intentHash, JSON.stringify(interpreted.intent),
        session.walletAddress, authority.blockNumber, interpreted.intent.expiration]);
      const reply = punkReply(interpreted.confirmation);
      await client.query(`INSERT INTO broker_v2_conversation_messages
        (conversation_id, role, content) VALUES ($1, 'OWNER', $2), ($1, 'PUNK', $3)`,
      [conversationId, ownerMessage, reply]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return json({ ok: true, tokenId, conversationId, reply: punkReply(interpreted.confirmation),
      draft: { version, state: "PENDING_OWNER_CONFIRMATION", intent: interpreted.intent,
        intentHash: interpreted.confirmation.intentHash, confirmation: interpreted.confirmation,
        provider: interpreted.provider }, economicPermissionsActivated: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/chat", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
