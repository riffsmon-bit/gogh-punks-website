import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const tokenId = v2TokenIdFrom(request);
    const session = await requireV2Session(request, pool);
    const authority = await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    const [strategy, acquired, activity] = await Promise.all([
      pool.query(`SELECT version, intent_hash, intent, state, expires_at, activated_at
        FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
          AND token_id = $3::numeric AND state IN ('ACTIVE', 'PAUSED')
        ORDER BY version DESC LIMIT 1`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]),
      pool.query(`SELECT COUNT(*)::integer AS count FROM broker_acquisitions
        WHERE chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3::numeric`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]),
      pool.query(`SELECT COUNT(*)::integer AS count FROM broker_v2_activity
        WHERE chain_id = $1 AND punk_token_id = $2::numeric
          AND occurred_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [ROBINHOOD.chainId, tokenId]),
    ]);
    const active = strategy.rows[0] ?? null;
    return json({ ok: true, authority, profile: { tokenId, owner: authority.owner,
      punkWallet: authority.punkWallet, activated: authority.activated,
      nativeBalanceWei: authority.nativeBalanceWei, collectionCount: Number(acquired.rows[0]?.count ?? 0),
      todayActivityCount: Number(activity.rows[0]?.count ?? 0),
      strategy: active ? { version: Number(active.version), intentHash: active.intent_hash,
        intent: active.intent, state: active.state, expiresAt: new Date(active.expires_at).toISOString(),
        activatedAt: active.activated_at ? new Date(active.activated_at).toISOString() : null } : null },
      withdrawals: { independentOfAI: true,
        legacyControlCenterUrl: `/broker/punk/${tokenId}?tab=assets` } });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
