import { getDatabase } from "@netlify/database";

import { PostgresV2OpportunityRepository } from
  "../../broker/src/v4/postgres-opportunity-repository.mjs";
import { ingestSeaDropObservations } from
  "../../broker/src/v4/discovery/seadrop-ingestor.mjs";
import { advanceRobinhoodDiscoveryCheckpoint, createRobinhoodDiscoveryClient,
  readCurrentRobinhoodSeaDropObservations } from
  "../../broker/src/v4/discovery/robinhood-seadrop-source.mjs";
import { PublicError, json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { verifyAdminBearer } from "./_shared/v2-session.mjs";

export async function handleV2DiscoveryIngest(request, { environment = process.env,
  pool = getDatabase().pool, client = null, now = new Date(), repository = null,
  readSource = readCurrentRobinhoodSeaDropObservations,
  ingest = ingestSeaDropObservations,
  advanceCheckpoint = advanceRobinhoodDiscoveryCheckpoint } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    verifyAdminBearer(request, environment);
    if (environment.GOGH_V2_DISCOVERY_INGEST_ENABLED !== "true") {
      throw new PublicError(503, "V2_DISCOVERY_DISABLED",
        "V2 discovery ingestion is disabled until the review environment is explicitly authorized.");
    }
    const source = await readSource({ pool,
      client: client ?? createRobinhoodDiscoveryClient(environment.ROBINHOOD_RPC_URL), now });
    const results = await ingest({ observations: source.observations,
      repository: repository ?? new PostgresV2OpportunityRepository(pool), pool, now });
    await advanceCheckpoint(pool, source.confirmedBlock);
    return json({ ok: true, chainId: 4663, source: source.sourceKey,
      confirmedBlock: source.confirmedBlock, discoveredCount: results.length,
      passedScreenCount: results.filter(({ screeningStatus }) => screeningStatus === "PASSED").length,
      needsReviewCount: results.filter(({ screeningStatus }) => screeningStatus === "NEEDS_REVIEW").length,
      blockedCount: results.filter(({ screeningStatus }) => screeningStatus === "BLOCKED").length,
      eligibleCount: 0, simulationRequiredPerPunk: true, results,
      transactionPrepared: false, executionAttemptCreated: false });
  } catch (error) { return v2Failure(error); }
}

export default handleV2DiscoveryIngest;

// Deliberately not scheduled. Production/preview activation requires a separate environment flag
// and admin-authenticated invocation after the target database has been verified.
export const config = { path: "/api/v2/admin/discovery/ingest", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 6, windowSize: 60,
} };
