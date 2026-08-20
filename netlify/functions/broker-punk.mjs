import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  attachNftDisplayMetadata,
  NFT_DISPLAY_METADATA_SELECT,
  nftDisplayMetadata,
} from "./_shared/broker-display-metadata.mjs";
import { json } from "./_shared/http.mjs";

function tokenIdFrom(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/punk\/(\d+)$/);
  if (!match) return null;
  try {
    const tokenId = BigInt(match[1]);
    return tokenId >= 0n && tokenId < 10_000n ? tokenId.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const tokenId = tokenIdFrom(request);
  if (tokenId === null) return json({ ok: false, code: "INVALID_TOKEN_ID" }, 400);
  try {
    const [punkResult, acquisitionResult, recommendationResult, decisionResult] = await Promise.all([
      getDatabase().pool.query(
        `SELECT punk.*, ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_punks AS punk
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = punk.chain_id
            AND nft_metadata.collection_address = punk.collection_address
            AND nft_metadata.token_id = punk.token_id
          WHERE punk.chain_id = $1
            AND punk.collection_address = $2
            AND punk.token_id = $3`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT acquisition.*, ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_acquisitions AS acquisition
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = acquisition.chain_id
            AND nft_metadata.collection_address = acquisition.nft_collection_address
            AND nft_metadata.token_id = acquisition.nft_token_id
          WHERE acquisition.chain_id = $1
            AND acquisition.punk_collection_address = $2
            AND acquisition.punk_token_id = $3
          ORDER BY acquisition.acquired_at DESC LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT recommendation.id, recommendation.recommendation,
                recommendation.scores, recommendation.explanation,
                recommendation.reasoning_hash, recommendation.agent_version_hash,
                recommendation.policy_version, recommendation.created_at,
                opportunity.collection_address,
                opportunity.token_id, opportunity.source, opportunity.opportunity_type,
                opportunity.creator_address, opportunity.marketplace_address,
                opportunity.currency_address, opportunity.expected_price,
                opportunity.maximum_price, opportunity.metadata,
                opportunity.risk_label, opportunity.discovered_at,
                opportunity.source_transaction_hash,
                decision.public_detail AS decision_detail,
                ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_recommendations AS recommendation
           JOIN broker_opportunities AS opportunity
             ON opportunity.id = recommendation.opportunity_id
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = opportunity.chain_id
            AND nft_metadata.collection_address = opportunity.collection_address
            AND nft_metadata.token_id = opportunity.token_id
           LEFT JOIN broker_decision_logs AS decision
             ON decision.recommendation_id = recommendation.id
            AND decision.event_type = 'SCOUT_RECOMMENDATION'
          WHERE recommendation.punk_chain_id = $1
            AND recommendation.punk_collection_address = $2
            AND recommendation.punk_token_id = $3
            AND opportunity.canonical = TRUE
          ORDER BY recommendation.created_at DESC, recommendation.id
          LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT * FROM broker_decision_logs
          WHERE punk_chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3
          ORDER BY occurred_at DESC LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
    ]);
    const rawPunk = punkResult.rows[0] ?? null;
    const punk = attachNftDisplayMetadata(rawPunk);
    return json({
      ok: true,
      identity: {
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        tokenId,
        artwork: nftDisplayMetadata(rawPunk ?? {}),
      },
      punk,
      acquisitions: acquisitionResult.rows.map(attachNftDisplayMetadata),
      recommendations: recommendationResult.rows.map(attachNftDisplayMetadata),
      decisions: decisionResult.rows,
      managementEnabled: false,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_PUNK_READ_FAILED", type: error?.name }));
    return json(
      {
        ok: true,
        identity: {
          chainId: ROBINHOOD.chainId,
          collection: ROBINHOOD.canonicalCollection,
          tokenId,
        },
        punk: null,
        acquisitions: [],
        recommendations: [],
        decisions: [],
        managementEnabled: false,
        dataStatus: "INDEXER_NOT_READY",
      },
      200,
      { "cache-control": "public, max-age=30" },
    );
  }
}

export const config = {
  path: "/api/punk/:tokenId",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 120,
    windowSize: 60,
  },
};
