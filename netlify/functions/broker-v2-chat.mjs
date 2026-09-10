import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { defaultAskIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { answerPunkConversation, isPunkConversationMessage } from
  "../../broker/src/v4/ai/punk-chat.mjs";
import { draftStrategyFromConversation } from "../../broker/src/v4/intent-draft.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";
import { readV2ChatAuthority, assertV2ChatAuthorityUnchanged } from "./_shared/v2-ownership.mjs";

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
  return `GOT IT. ${confirmation.mintPrice.toUpperCase()}. ${taste}. ${confirmation.dailyLimit} MAX PER DAY. ${confirmation.totalLimit} MAX FOR THIS STRATEGY. REVIEW THE RULES BEFORE THEY CHANGE.`;
}

export async function resolveV2PunkChat({ router, ownerMessage, currentIntent, tokenId,
  authority, owner, now = new Date(), context = {} }) {
  if (currentIntent?.expectedOwner?.toLowerCase() !== owner.toLowerCase()) {
    currentIntent = defaultAskIntent({ punkTokenId: tokenId, expectedOwner: owner, punkWallet: authority.punkWallet }, now);
  }
  // An autonomous strategy is bound to the owner-approved Punk Agent Account, while ASK and
  // ASSIST use the canonical Punk Wallet returned by the ownership check. Keep chat grounded in
  // the strategy's exact custody account so an owner can refine an active autonomous mission.
  const strategyWallet = currentIntent?.punkWallet ?? authority.punkWallet;
  const livePunkState = authority.nativeBalanceWei === undefined
    || strategyWallet !== authority.punkWallet ? null : {
        wallet: strategyWallet, nativeBalanceWei: authority.nativeBalanceWei,
        activated: authority.activated === true,
      };
  const conversation = async (intent = currentIntent) => {
    const answer = await answerPunkConversation({ router, message: ownerMessage, intent,
      punkTokenId: tokenId, punkState: livePunkState,
      strategyStatus: intent === currentIntent ? "ACTIVE" : "DEFAULT", context, now });
    return Object.freeze({ responseKind: "CONVERSATION", reply: answer.reply, draft: null,
      provider: { provider: answer.provider, registryKey: answer.registryKey },
      providerAvailable: answer.providerAvailable });
  };
  if (isPunkConversationMessage(ownerMessage)) return conversation();
  const interpreted = draftStrategyFromConversation({ message: ownerMessage, punkTokenId: tokenId,
    expectedOwner: owner, punkWallet: strategyWallet, currentIntent }, now);
  if (interpreted.ambiguous.length) {
    const fields = interpreted.ambiguous.map((field) => field.replaceAll("_", " "));
    return Object.freeze({ responseKind: "CLARIFICATION_REQUIRED",
      reply: `I NEED ONE DETAIL: give me an exact ${fields.join(" and ").toLowerCase()} before I change or activate anything.`,
      draft: null, provider: { provider: "DETERMINISTIC_REVIEW_PARSER", registryKey: null },
      providerAvailable: true });
  }
  if (!interpreted.changes.length) return conversation(interpreted.intent);
  return Object.freeze({ responseKind: "STRATEGY_DRAFT", reply: punkReply(interpreted.confirmation),
    draft: { state: interpreted.status, intent: interpreted.intent,
      intentHash: interpreted.confirmation.intentHash, confirmation: interpreted.confirmation,
      provider: { provider: "DETERMINISTIC_REVIEW_PARSER", modelId: null } },
    provider: { provider: "DETERMINISTIC_REVIEW_PARSER", registryKey: null },
    providerAvailable: true });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    requireSameOrigin(request);
    const tokenId = tokenIdFrom(request);
    const session = await requireV2Session(request, pool);
    // readV2PunkAuthority remains canonical underneath this block-anchored chat read.
    const authority = await readV2ChatAuthority(tokenId, { expectedOwner: session.walletAddress });
    const body = await readJson(request, 12_000);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, "message")) {
      throw new PublicError(400, "INVALID_REQUEST", "The chat request is invalid.");
    }
    const ownerMessage = message(body.message);
    const latest = await pool.query(`SELECT intent FROM broker_v2_strategies
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
        AND state IN ('ACTIVE', 'PAUSED') AND expires_at > NOW()
        AND configured_by = $4 AND intent->>'expectedOwner' = $4
      ORDER BY version DESC LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, session.walletAddress]);
    const now = new Date();
    const currentIntent = latest.rows[0]?.intent ?? defaultAskIntent({ punkTokenId: tokenId,
      expectedOwner: session.walletAddress, punkWallet: authority.punkWallet }, now);
    const intelligence = createDatabaseBackedGoghIntelligence(pool);
    const resolved = await resolveV2PunkChat({ router: intelligence.router, ownerMessage,
      currentIntent, tokenId, authority, owner: session.walletAddress, now,
      context: { ownerFingerprint: session.walletAddress, punkTokenId: tokenId } });
    const client = await pool.connect();
    let version;
    let conversationId;
    try {
      await client.query("BEGIN");
      const lock = (BigInt(ROBINHOOD.chainId) * 10_000n + BigInt(tokenId)).toString();
      await client.query("SELECT pg_advisory_xact_lock($1)", [lock]);
      await assertV2ChatAuthorityUnchanged(authority);
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
      if (resolved.draft) {
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
          resolved.draft.confirmation.intentHash, JSON.stringify(resolved.draft.intent),
          session.walletAddress, authority.blockNumber, resolved.draft.intent.expiration]);
      }
      await client.query(`INSERT INTO broker_v2_conversation_messages
        (conversation_id, role, content, provider, model_registry_key)
        VALUES ($1, 'OWNER', $2, NULL, NULL), ($1, 'PUNK', $3, $4, $5)`,
      [conversationId, ownerMessage, resolved.reply, resolved.provider.provider,
        resolved.provider.registryKey]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return json({ ok: true, tokenId, conversationId, responseKind: resolved.responseKind,
      reply: resolved.reply, provider: resolved.provider,
      providerAvailable: resolved.providerAvailable,
      draft: resolved.draft ? { ...resolved.draft, version } : null,
      economicPermissionsActivated: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/chat", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
