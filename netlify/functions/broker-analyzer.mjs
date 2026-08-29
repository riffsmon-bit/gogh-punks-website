import { runBrokerAnalysis } from "../../scripts/run-broker-analysis.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "BROKER_ANALYZER");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  if (process.env.BROKER_ANALYZER_ENABLED !== "true") {
    console.log(JSON.stringify({ event: "BROKER_ANALYZER_SKIPPED", reason: "DISABLED" }));
    return;
  }
  try {
    const result = await runBrokerAnalysis();
    console.log(JSON.stringify({ event: "BROKER_ANALYZER_RUN", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "BROKER_ANALYZER_ERROR",
      type: error?.name ?? "Error",
      message: String(error?.message ?? "Analyzer failed").slice(0, 300),
    }));
    throw error;
  }
}

export const config = { schedule: "*/5 * * * *" };
