import { getDatabase } from "@netlify/database";
import { FEATURE_DEFAULTS, ROBINHOOD, readFeatureFlags } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";

function configuredScoutToken() {
  try {
    const tokenId = BigInt(process.env.BROKER_SCOUT_TOKEN_ID);
    return tokenId >= 0n && tokenId < 10_000n ? tokenId.toString() : null;
  } catch {
    return null;
  }
}

async function scoutSnapshot(tokenId) {
  if (!tokenId) return { dataStatus: "NOT_CONFIGURED", tokenId: null };
  try {
    const [punk, opportunities, recommendations, checkpoint] = await Promise.all([
      getDatabase().pool.query(
        `SELECT token_id, account_address, owner_snapshot, owner_snapshot_block,
                persona_key, updated_at
           FROM broker_punks
          WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT COUNT(*)::integer AS count
           FROM broker_opportunities
          WHERE chain_id = $1 AND canonical = TRUE AND scoutable = TRUE`,
        [ROBINHOOD.chainId],
      ),
      getDatabase().pool.query(
        `SELECT COUNT(*)::integer AS count
           FROM broker_recommendations
          WHERE punk_chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT stream, block_number, block_hash, updated_at
           FROM broker_indexer_checkpoints
          WHERE chain_id = $1
          ORDER BY updated_at DESC`,
        [ROBINHOOD.chainId],
      ),
    ]);
    const opportunityCount = Number(opportunities.rows[0]?.count ?? 0);
    return {
      dataStatus: opportunityCount > 0 ? "LIVE" : "SYNCING",
      tokenId,
      punk: punk.rows[0] ?? null,
      opportunityCount,
      recommendationCount: Number(recommendations.rows[0]?.count ?? 0),
      checkpoints: checkpoint.rows,
    };
  } catch {
    return { dataStatus: "DATABASE_UNAVAILABLE", tokenId };
  }
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  let featureFlags = FEATURE_DEFAULTS;
  try {
    featureFlags = readFeatureFlags(process.env);
  } catch {
    // Fail closed if a production environment flag is malformed.
    featureFlags = FEATURE_DEFAULTS;
  }
  const scoutTokenId = configuredScoutToken();
  const scout = await scoutSnapshot(scoutTokenId);
  return json(
    {
      ok: true,
      chain: ROBINHOOD,
      protocol: {
        deploymentStatus: "NOT_DEPLOYED",
        accountRegistry: null,
        accountImplementation: null,
        policyModule: null,
        agentRegistry: null,
        adapterRegistry: null,
      },
      featureFlags,
      scoutStatus: {
        workerEnabled: process.env.BROKER_SCOUT_ENABLED === "true",
        indexerEnabled: process.env.BROKER_INDEXER_ENABLED === "true",
        analyzerEnabled: process.env.BROKER_ANALYZER_ENABLED === "true",
        settlementSource: "VERIFIED_SEAPORT_READ_ONLY",
        contractAnalysis: "STAGED_CONFIRMED_BLOCK_EVIDENCE",
        marketAnalysis: "CONFIRMED_HISTORICAL_ACTIVITY_ONLY",
        metadataAnalysis: "ONCHAIN_JSON_ONLY",
        holderMetrics: "BOUNDED_SAMPLE_NOT_TOTAL_COUNT",
        liveLiquidityAvailable: false,
        executionEnabled: false,
        ...scout,
      },
      autonomyStatus: "DISABLED",
      riskNotice: "Scout findings and valuation fields are estimates, not safety or profit claims.",
    },
    200,
    { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  );
}

export const config = {
  path: "/api/broker/status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 120,
    windowSize: 60,
  },
};
