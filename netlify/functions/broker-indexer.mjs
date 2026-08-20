import { runBrokerIndexer } from "../../scripts/run-broker-indexer.mjs";

export default async function handler() {
  if (process.env.BROKER_INDEXER_ENABLED !== "true") {
    console.log(JSON.stringify({ event: "BROKER_INDEXER_SKIPPED", reason: "DISABLED" }));
    return;
  }
  try {
    const result = await runBrokerIndexer();
    console.log(JSON.stringify({ event: "BROKER_INDEXER_RUN", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "BROKER_INDEXER_ERROR",
      type: error?.name ?? "Error",
      message: String(error?.message ?? "Indexer failed").slice(0, 300),
    }));
    throw error;
  }
}

export const config = { schedule: "* * * * *" };
