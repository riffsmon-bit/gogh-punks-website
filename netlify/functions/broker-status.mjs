import { getDatabase } from "@netlify/database";
import { FEATURE_DEFAULTS, ROBINHOOD, readFeatureFlags } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";
import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { COMPLETED_EXTERNAL_FREE_MINT } from
  "./_shared/external-free-mint-display.mjs";
import { brokerMigrationState } from "./_shared/broker-migration-state.mjs";

function configuredScoutToken() {
  try {
    const tokenId = BigInt(process.env.BROKER_SCOUT_TOKEN_ID);
    return tokenId >= 0n && tokenId < 10_000n ? tokenId.toString() : null;
  } catch {
    return null;
  }
}

async function scoutSnapshot(tokenId) {
  if (!tokenId) {
    return {
      dataStatus: "NOT_CONFIGURED",
      scope: "NO_PUNK_CONFIGURED",
      configuredPunkCount: 0,
      tokenId: null,
    };
  }
  try {
    const [punk, opportunities, recommendations, checkpoint, metadata] = await Promise.all([
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
      getDatabase().pool.query(
        `SELECT COUNT(*)::integer AS count
           FROM broker_nft_metadata
          WHERE chain_id = $1 AND metadata_status = 'AVAILABLE'`,
        [ROBINHOOD.chainId],
      ),
    ]);
    const opportunityCount = Number(opportunities.rows[0]?.count ?? 0);
    return {
      dataStatus: opportunityCount > 0 ? "READ_ONLY_DATA_AVAILABLE" : "SYNCING",
      scope: "ONE_CONFIGURED_PUNK",
      configuredPunkCount: punk.rows.length > 0 ? 1 : 0,
      tokenId,
      punk: punk.rows[0] ?? null,
      opportunityCount,
      recommendationCount: Number(recommendations.rows[0]?.count ?? 0),
      metadataCount: Number(metadata.rows[0]?.count ?? 0),
      checkpoints: checkpoint.rows,
    };
  } catch {
    return {
      dataStatus: "DATABASE_UNAVAILABLE",
      scope: "ONE_CONFIGURED_PUNK",
      configuredPunkCount: 0,
      tokenId,
    };
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
        deploymentStatus: CURRENT_BROKER_DEPLOYMENT_SURFACE.deploymentStatus,
        accountRegistry: CURRENT_BROKER_DEPLOYMENT_SURFACE.accountRegistry,
        accountImplementation: CURRENT_BROKER_DEPLOYMENT_SURFACE.accountImplementation,
        policyModule: CURRENT_BROKER_DEPLOYMENT_SURFACE.policyModule,
        agentRegistry: CURRENT_BROKER_DEPLOYMENT_SURFACE.agentRegistry,
        adapterRegistry: CURRENT_BROKER_DEPLOYMENT_SURFACE.adapterRegistry,
      },
      canaryDisplay: CURRENT_BROKER_DEPLOYMENT_SURFACE.canaryStatus === "DEPLOYED"
        ? {
          status: "DEPLOYED",
          punkTokenId: CURRENT_BROKER_DEPLOYMENT_SURFACE.canary.punkTokenId,
          account: CURRENT_BROKER_DEPLOYMENT_SURFACE.canary.account,
          collection: CURRENT_BROKER_DEPLOYMENT_SURFACE.canary.collection,
          tokenId: CURRENT_BROKER_DEPLOYMENT_SURFACE.canary.tokenId,
        }
        : null,
      autonomousCanaryDisplay: {
        status: "COMPLETED_AND_CONTAINED",
        punkTokenId: "1639",
        account: "0xb492268ab6f5b2791ff03ba4e536c22dac78de1f",
        collection: "0xa06763a30584585bae8dcbaf6999c4037f8444ba",
        tokenId: "9002",
        runtimeCodeHash: "0x949102366c9d82bbaf40d852e7558b00077e35bff8ade55e6354fdb4944caa25",
        transactionHash: "0xf56639e4f43d95f0bf69d3b7b7ee7e11dad3f0079e645d4523d570ab6735c00d",
        executionMode: "AUTONOMOUS_FREE_MINT",
        containment: "AUTONOMY_OFF_AGENT_REVOKED_ACCOUNT_PAUSED_DISABLED",
      },
      externalFreeMintTest: COMPLETED_EXTERNAL_FREE_MINT,
      featureFlags,
      v1Lifecycle: brokerMigrationState(process.env),
      scoutStatus: {
        workerEnabled: process.env.BROKER_SCOUT_ENABLED === "true",
        indexerEnabled: process.env.BROKER_INDEXER_ENABLED === "true",
        analyzerEnabled: process.env.BROKER_ANALYZER_ENABLED === "true",
        metadataWorkerEnabled: process.env.BROKER_METADATA_ENABLED === "true",
        metadataProviderConfigured: Boolean(process.env.OPENSEA_API_KEY?.trim()),
        settlementSource: "VERIFIED_SEAPORT_READ_ONLY",
        contractAnalysis: "STAGED_CONFIRMED_BLOCK_EVIDENCE",
        marketAnalysis: "CONFIRMED_HISTORICAL_ACTIVITY_ONLY",
        metadataAnalysis: "ONCHAIN_EVIDENCE_PLUS_SANITIZED_OPENSEA_DISPLAY",
        holderMetrics: "BOUNDED_SAMPLE_NOT_TOTAL_COUNT",
        liveLiquidityAvailable: false,
        executionEnabled: false,
        ...scout,
      },
      autonomyStatus: "DISABLED_AFTER_SUCCESSFUL_BOUNDED_CANARY",
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
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
