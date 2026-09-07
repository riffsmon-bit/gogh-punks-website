import { backgroundRpcDecision, logBackgroundRpcSkip } from
  "./_shared/background-rpc-policy.mjs";
import { runV2DiscoveryIngest } from "./broker-v2-discovery-ingest.mjs";

export async function runScheduledV2Discovery({ environment = process.env,
  run = runV2DiscoveryIngest, report = console.log } = {}) {
  const decision = backgroundRpcDecision(environment, "V2_DISCOVERY_INGEST");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision, report);
    return Object.freeze({ status: "BACKGROUND_DISABLED", reason: decision.reason });
  }
  if (environment.GOGH_V2_DISCOVERY_INGEST_ENABLED !== "true") {
    return Object.freeze({ status: "DISABLED" });
  }
  return run({ environment });
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
