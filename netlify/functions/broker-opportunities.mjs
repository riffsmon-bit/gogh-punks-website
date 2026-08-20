import { getDatabase } from "@netlify/database";
import {
  attachNftDisplayMetadata,
  NFT_DISPLAY_METADATA_SELECT,
} from "./_shared/broker-display-metadata.mjs";
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
      `SELECT opportunity.id, opportunity.chain_id, opportunity.collection_address,
              opportunity.token_id, opportunity.source, opportunity.opportunity_type,
              opportunity.creator_address, opportunity.marketplace_address,
              opportunity.currency_address, opportunity.expected_price,
              opportunity.maximum_price, opportunity.supply, opportunity.metadata,
              opportunity.scores, opportunity.risk_label, opportunity.confidence,
              opportunity.scoutable, opportunity.autonomous_execution_eligible,
              opportunity.discovered_at, opportunity.expires_at,
              opportunity.source_block_number, opportunity.source_block_hash,
              opportunity.source_transaction_hash, opportunity.source_log_index,
              opportunity.canonical, opportunity.source_block_timestamp,
              ${NFT_DISPLAY_METADATA_SELECT}
         FROM broker_opportunities AS opportunity
         LEFT JOIN broker_nft_metadata AS nft_metadata
           ON nft_metadata.chain_id = opportunity.chain_id
          AND nft_metadata.collection_address = opportunity.collection_address
          AND nft_metadata.token_id = opportunity.token_id
        WHERE opportunity.scoutable = TRUE
          AND opportunity.canonical = TRUE
          AND (opportunity.expires_at IS NULL OR opportunity.expires_at > NOW())
        ORDER BY opportunity.discovered_at DESC, opportunity.id
        LIMIT $1`,
      [limit],
    );
    return json({
      ok: true,
      opportunities: result.rows.map(attachNftDisplayMetadata),
      feedMode: "SCOUT",
      analysisMode: "EVIDENCE_ONLY",
      activityMode: "CONFIRMED_HISTORICAL_SALES_AND_MINT_SIGNALS",
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
