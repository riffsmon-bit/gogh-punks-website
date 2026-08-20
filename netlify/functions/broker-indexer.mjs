import { runBrokerIndexer } from "../../scripts/run-broker-indexer.mjs";

function coreStreams(environment = process.env) {
  return (environment.BROKER_INDEX_STREAMS ?? "gogh_punk_transfers,seaport_activity")
    .split(",")
    .map((stream) => stream.trim())
    .filter((stream) => stream && stream !== "nft_transfers")
    .join(",");
}

export default async function handler() {
  if (process.env.BROKER_INDEXER_ENABLED !== "true") {
    console.log(JSON.stringify({ event: "BROKER_INDEXER_SKIPPED", reason: "DISABLED" }));
    return;
  }
  try {
    const streams = coreStreams();
    if (!streams) {
      console.log(JSON.stringify({ event: "BROKER_INDEXER_SKIPPED", reason: "NO_CORE_STREAMS" }));
      return;
    }
    const result = await runBrokerIndexer({
      environment: { ...process.env, BROKER_INDEX_STREAMS: streams },
    });
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

// Alternate with the broad mint scanner so both streams receive the shared
// chain advisory lock instead of racing each other every minute.
export const config = { schedule: "*/2 * * * *" };
