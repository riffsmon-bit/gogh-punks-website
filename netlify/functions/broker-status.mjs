import { FEATURE_DEFAULTS, ROBINHOOD, readFeatureFlags } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  let featureFlags = FEATURE_DEFAULTS;
  try {
    featureFlags = readFeatureFlags(process.env);
  } catch {
    // Fail closed if a production environment flag is malformed.
    featureFlags = FEATURE_DEFAULTS;
  }
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
        settlementSource: "VERIFIED_SEAPORT_READ_ONLY",
        contractAnalysis: "STAGED_CONFIRMED_BLOCK_EVIDENCE",
        marketAnalysis: "CONFIRMED_HISTORICAL_ACTIVITY_ONLY",
        metadataAnalysis: "ONCHAIN_JSON_ONLY",
        holderMetrics: "BOUNDED_SAMPLE_NOT_TOTAL_COUNT",
        liveLiquidityAvailable: false,
        executionEnabled: false,
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
