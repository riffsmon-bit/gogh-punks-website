import { BlockscoutAbiInspector } from "../broker/src/analysis/blockscout-abi-inspector.mjs";
import { CollectionEnricher } from "../broker/src/analysis/collection-enricher.mjs";
import { RpcContractInspector } from "../broker/src/analysis/rpc-contract-inspector.mjs";
import { RpcNftEvidenceInspector } from "../broker/src/analysis/rpc-nft-evidence-inspector.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { RobinhoodJsonRpcSource } from "../broker/src/indexer/json-rpc-source.mjs";
import {
  PostgresCollectionAnalysisRepository,
} from "../netlify/functions/broker/analysis-repository.mjs";

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function exactBoolean(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value !== "true" && value !== "false") {
    throw new TypeError(`${name} must be exactly true or false`);
  }
  return value === "true";
}

async function main() {
  if (process.env.BROKER_ANALYZER_ENABLED !== "true") {
    throw new Error("BROKER_ANALYZER_ENABLED must be exactly true");
  }
  const confirmations = boundedInteger("BROKER_CONFIRMATIONS", 20, 0, 10_000);
  const batchLimit = boundedInteger("BROKER_ANALYSIS_BATCH_SIZE", 10, 1, 100);
  const retryHours = boundedInteger("BROKER_ANALYSIS_RETRY_HOURS", 24, 1, 720);
  const activityLimit = boundedInteger("BROKER_ANALYSIS_ACTIVITY_LIMIT", 200, 1, 500);
  const useBlockscout = exactBoolean("BROKER_BLOCKSCOUT_ABI_ENABLED", "true");
  const source = new RobinhoodJsonRpcSource({
    rpcUrl: process.env.ROBINHOOD_RPC_URL,
    streams: {},
  });
  const contractInspector = new RpcContractInspector({
    rpc: (method, params) => source.call(method, params),
    confirmations,
  });
  const enricher = new CollectionEnricher({
    contractInspector,
    abiInspector: useBlockscout ? new BlockscoutAbiInspector() : null,
    nftEvidenceInspector: new RpcNftEvidenceInspector({
      rpc: (method, params) => source.call(method, params),
      confirmations,
    }),
  });
  const repository = new PostgresCollectionAnalysisRepository();

  const result = await repository.withChainLock(ROBINHOOD.chainId, async (locked) => {
    const pending = await locked.pendingCollections(ROBINHOOD.chainId, {
      limit: batchLimit,
      retryHours,
    });
    const analyzed = [];
    const failures = [];
    for (const collection of pending) {
      try {
        const activity = await locked.collectionActivity(
          ROBINHOOD.chainId,
          collection.address,
          { limit: activityLimit },
        );
        const analysis = await enricher.enrich(collection, {
          activityRows: activity.rows,
          activityTruncated: activity.truncated,
          tokenIds: activity.tokenIds,
        });
        const persisted = await locked.saveAnalysis(analysis);
        analyzed.push(Object.freeze({
          collection: collection.address,
          riskLabel: analysis.riskLabel,
          riskConfidence: analysis.riskConfidence,
          artStatus: analysis.art.status,
          artScore: analysis.art.artScore ?? null,
          marketStatus: analysis.market.status,
          marketScore: analysis.market.marketScore,
          observedBlock: analysis.observedBlock,
          opportunitiesUpdated: persisted.opportunitiesUpdated,
        }));
      } catch (error) {
        await locked.recordFailure(ROBINHOOD.chainId, collection.address, error);
        failures.push(Object.freeze({
          collection: collection.address,
          failureType: error?.name ?? "Error",
        }));
      }
    }
    return Object.freeze({ queued: pending.length, analyzed, failures });
  });
  console.log(JSON.stringify({
    ok: result.failures.length === 0,
    chainId: ROBINHOOD.chainId,
    readOnly: true,
    executionEnabled: false,
    ...result,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.name ?? "Error",
    message: error?.message ?? "Collection analysis failed",
  }));
  process.exitCode = 1;
});
