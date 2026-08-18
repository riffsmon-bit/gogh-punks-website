import { getDatabase } from "@netlify/database";
import { json } from "./_shared/http.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 24);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(50, Math.max(1, requestedLimit))
    : 24;
  try {
    const result = await getDatabase().pool.query(
      `SELECT id, chain_id, collection_address, token_id, source, opportunity_type,
              creator_address, marketplace_address, currency_address, expected_price,
              maximum_price, supply, metadata, scores, risk_label, confidence,
              scoutable, autonomous_execution_eligible, discovered_at, expires_at,
              source_block_number, source_block_hash, source_transaction_hash,
              source_log_index, canonical, source_block_timestamp
         FROM broker_opportunities
        WHERE scoutable = TRUE
          AND canonical = TRUE
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY discovered_at DESC, id
        LIMIT $1`,
      [limit],
    );
    return json({
      ok: true,
      opportunities: result.rows,
      feedMode: "SCOUT",
      analysisMode: "EVIDENCE_ONLY",
      activityMode: "CONFIRMED_HISTORICAL_SALES",
      holderMode: "BOUNDED_TOKEN_SAMPLE",
      liveLiquidityAvailable: false,
      executionEnabled: false,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_OPPORTUNITY_READ_FAILED", type: error?.name }));
    return json(
      {
        ok: false,
        code: "SCOUT_DATA_UNAVAILABLE",
        message: "Scout data is not available yet. No transaction capability was affected.",
      },
      503,
    );
  }
}

export const config = {
  path: "/api/broker/opportunities",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 120,
    windowSize: 60,
  },
};
