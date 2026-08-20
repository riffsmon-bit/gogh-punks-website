import { runBrokerAnalysis } from "../../scripts/run-broker-analysis.mjs";

export default async function handler() {
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
