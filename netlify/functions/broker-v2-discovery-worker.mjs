import { backgroundRpcDecision, logBackgroundRpcSkip } from
  "./_shared/background-rpc-policy.mjs";
import { runV2DiscoveryIngest } from "./broker-v2-discovery-ingest.mjs";
import { getDatabase } from "@netlify/database";
import { runPersistentWatchBatch } from "./_shared/v2-persistent-watch-runtime.mjs";

export async function runScheduledV2Discovery({ environment = process.env,
  run = runV2DiscoveryIngest, report = console.log, pool = null,
  poolFactory = () => getDatabase().pool, runWatch = runPersistentWatchBatch,
  now = Date.now } = {}) {
  const startedAt = now();
  const decision = backgroundRpcDecision(environment, "V2_DISCOVERY_INGEST");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision, report);
    return Object.freeze({ status: "BACKGROUND_DISABLED", reason: decision.reason });
  }
  if (environment.GOGH_V2_DISCOVERY_INGEST_ENABLED !== "true") {
    return Object.freeze({ status: "DISABLED" });
  }
  // The shared ingest and watch pass use the same application database. Keep
  // disabled ticks free of database construction and all watch work.
  const watching = environment.GOGH_V2_PERSISTENT_WATCH_ENABLED === "true";
  const sharedPool = pool ?? (run === runV2DiscoveryIngest || watching ? poolFactory() : null);
  const result = await run({ environment, ...(sharedPool ? { pool: sharedPool } : {}) });
  if (!watching) return result;
  // One small shared batch, including idle discovery ticks. Leave time for the
  // already-started RPC to finish; this is a soft bound, not a new scheduler.
  const remaining = Math.floor(40_000 - (now() - startedAt));
  if (remaining < 1_000) return Object.freeze({ ...result, persistentWatch: {
    status: "TIME_BUDGET_EXHAUSTED", executionAuthorized: false, transactionSubmitted: false,
  } });
  let persistentWatch;
  try {
    persistentWatch = await runWatch({ pool: sharedPool, environment,
      opportunities: (result.results ?? []).slice(0, 100), limit: 5, maxDurationMs: Math.min(15_000, remaining) });
  } catch {
    // Watch storage/RPC outages do not turn a committed discovery into a failed
    // ingest. Do not expose provider errors or retry a second watch batch.
    persistentWatch = { status: "UNAVAILABLE", executionAuthorized: false, transactionSubmitted: false };
  }
  return Object.freeze({ ...result, persistentWatch });
}

export default async function handler() {
  try {
    const result = await runScheduledV2Discovery();
    console.log(JSON.stringify({ event: "V2_DISCOVERY_INGEST", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "V2_DISCOVERY_INGEST_FAILED",
      code: error?.code ?? "FAILED" }));
    throw error;
  }
}

// Refresh the shared queue before the independently scheduled Punk worker reads it.
// Exact contract screening is shared; live simulation remains per Punk at submission time.
export const config = { schedule: "* * * * *" };
