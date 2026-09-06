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
    const tokenId = v2TokenIdFrom(request, "/fund");
    const session = await requireV2Session(request, pool);
    const authority = await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    const result = await pool.query(`SELECT intent->>'minimumReserveWei' AS reserve
      FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
        AND token_id = $3::numeric AND state = 'ACTIVE' ORDER BY version DESC LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
    const minimumReserveWei = result.rows[0]?.reserve ?? "0";
    const availableBudgetWei = (BigInt(authority.nativeBalanceWei) > BigInt(minimumReserveWei)
      ? BigInt(authority.nativeBalanceWei) - BigInt(minimumReserveWei) : 0n).toString();
    return json({ ok: true, tokenId, destination: authority.punkWallet,
      nativeBalanceWei: authority.nativeBalanceWei, minimumReserveWei, availableBudgetWei,
      custody: "PUNK_WALLET", projectCustody: false, transactionPrepared: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/fund", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
