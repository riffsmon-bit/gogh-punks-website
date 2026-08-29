import { runBrokerIndexer } from "../../scripts/run-broker-indexer.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

function mintStreamEnabled(environment = process.env) {
  return (environment.BROKER_INDEX_STREAMS ?? "")
    .split(",")
    .map((stream) => stream.trim())
    .includes("nft_transfers");
}

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "CHAIN_WIDE_NFT_INDEXER");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  if (process.env.BROKER_INDEXER_ENABLED !== "true"
    || process.env.BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER !== "true"
    || !mintStreamEnabled()) {
    console.log(JSON.stringify({ event: "BROKER_MINT_INDEXER_SKIPPED", reason: "DISABLED" }));
    return;
  }
  try {
    const result = await runBrokerIndexer({
      environment: { ...process.env, BROKER_INDEX_STREAMS: "nft_transfers" },
    });
    console.log(JSON.stringify({ event: "BROKER_MINT_INDEXER_RUN", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "BROKER_MINT_INDEXER_ERROR",
      type: error?.name ?? "Error",
      message: String(error?.message ?? "Mint indexer failed").slice(0, 300),
    }));
    throw error;
  }
}

// Odd minutes alternate with the core indexer's even-minute schedule.
export const config = { schedule: "1-59/2 * * * *" };
