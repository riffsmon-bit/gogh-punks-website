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
    const tokenId = v2TokenIdFrom(request, "/activity");
    const session = await requireV2Session(request, pool);
    await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    const [v2, v1] = await Promise.all([
      pool.query(`SELECT activity_id::text AS id, activity_type AS type, public_detail AS detail,
          occurred_at FROM broker_v2_activity WHERE chain_id = $1 AND punk_token_id = $2::numeric
        ORDER BY occurred_at DESC LIMIT 100`, [ROBINHOOD.chainId, tokenId]),
      pool.query(`SELECT id::text, event_type AS type, public_detail AS detail, occurred_at
        FROM broker_decision_logs WHERE punk_chain_id = $1 AND punk_collection_address = $2
          AND punk_token_id = $3::numeric ORDER BY occurred_at DESC LIMIT 100`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]),
    ]);
    const entries = [
      ...v2.rows.map((row) => ({ ...row, provenance: "V2" })),
      ...v1.rows.map((row) => ({ ...row, provenance: "V1" })),
    ].sort((left, right) => new Date(right.occurred_at) - new Date(left.occurred_at)).slice(0, 150)
      .map((row) => ({ id: row.id, type: row.type, detail: row.detail,
        occurredAt: new Date(row.occurred_at).toISOString(), provenance: row.provenance }));
    return json({ ok: true, tokenId, entries, includesV1History: true });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/activity", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
