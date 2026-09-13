import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { normalizePunkCollectingIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { json, PublicError } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export async function handleV2Fund(request, {
  pool = null, requireSession = requireV2Session, readAuthority = readV2PunkAuthority,
  now = () => new Date(),
} = {}) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    pool ??= getDatabase().pool;
    const tokenId = v2TokenIdFrom(request, "/fund");
    const session = await requireSession(request, pool);
    const authority = await readAuthority(tokenId, { expectedOwner: session.walletAddress });
    // A seller's strategy, an expired strategy, or an Agent-account strategy cannot
    // reserve this current owner's separate V3 Punk Wallet display balance.
    const result = await pool.query(`SELECT intent
      FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
        AND token_id = $3::numeric AND state = 'ACTIVE' AND expires_at > NOW()
        AND configured_by = $4::text AND intent->>'expectedOwner' = $4::text
        AND intent->>'punkWallet' = $5::text AND intent->>'punkTokenId' = $3::text
        AND intent->'chainId' = to_jsonb($1::bigint)
      ORDER BY version DESC LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, authority.owner, authority.punkWallet]);
    let minimumReserveWei = "0";
    if (result.rows[0]) {
      let intent;
      try {
        const stored = result.rows[0].intent;
        // Wei must arrive as exact decimal text; JSON numbers may already have
        // lost precision before the intent normalizer can inspect them.
        if (typeof stored?.minimumReserveWei !== "string"
          || !/^(0|[1-9]\d{0,77})$/.test(stored.minimumReserveWei)
          || BigInt(stored.minimumReserveWei) >= 2n ** 256n) throw new Error("invalid reserve");
        intent = normalizePunkCollectingIntent(stored, now());
        if (intent.expectedOwner !== authority.owner || intent.punkWallet !== authority.punkWallet
          || intent.punkTokenId !== tokenId) throw new Error("invalid binding");
      }
      catch { throw new PublicError(503, "FUND_RULES_UNAVAILABLE",
        "Your Punk's reserve could not be checked. Refresh before moving funds."); }
      minimumReserveWei = intent.minimumReserveWei;
    }
    const availableBudgetWei = (BigInt(authority.nativeBalanceWei) > BigInt(minimumReserveWei)
      ? BigInt(authority.nativeBalanceWei) - BigInt(minimumReserveWei) : 0n).toString();
    return json({ ok: true, tokenId, destination: authority.punkWallet,
      nativeBalanceWei: authority.nativeBalanceWei, minimumReserveWei, availableBudgetWei,
      custody: "PUNK_WALLET", projectCustody: false, transactionPrepared: false }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(error); }
}

export default handleV2Fund;

export const config = { path: "/api/v2/punks/:tokenId/fund", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
