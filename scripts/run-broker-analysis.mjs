import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlockscoutAbiInspector } from "../broker/src/analysis/blockscout-abi-inspector.mjs";
import { CollectionEnricher } from "../broker/src/analysis/collection-enricher.mjs";
import { RpcContractInspector } from "../broker/src/analysis/rpc-contract-inspector.mjs";
import { RpcNftEvidenceInspector } from "../broker/src/analysis/rpc-nft-evidence-inspector.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { RobinhoodJsonRpcSource } from "../broker/src/indexer/json-rpc-source.mjs";
import {
  PostgresCollectionAnalysisRepository,
} from "../netlify/functions/broker/analysis-repository.mjs";

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function exactBoolean(environment, name, fallback) {
  const value = environment[name] ?? fallback;
  if (value !== "true" && value !== "false") {
    throw new TypeError(`${name} must be exactly true or false`);
  }
  return value === "true";
}

export async function runBrokerAnalysis({
  environment = process.env,
  repository = new PostgresCollectionAnalysisRepository(),
  source = null,
} = {}) {
  if (environment.BROKER_ANALYZER_ENABLED !== "true") {
    throw new Error("BROKER_ANALYZER_ENABLED must be exactly true");
  }
  const confirmations = boundedInteger(environment, "BROKER_CONFIRMATIONS", 20, 0, 10_000);
  const batchLimit = boundedInteger(environment, "BROKER_ANALYSIS_BATCH_SIZE", 10, 1, 100);
  const retryHours = boundedInteger(environment, "BROKER_ANALYSIS_RETRY_HOURS", 24, 1, 720);
  const activityLimit = boundedInteger(environment, "BROKER_ANALYSIS_ACTIVITY_LIMIT", 200, 1, 500);
  const useBlockscout = exactBoolean(environment, "BROKER_BLOCKSCOUT_ABI_ENABLED", "true");
  const rpcSource = source ?? new RobinhoodJsonRpcSource({
    rpcUrl: environment.ROBINHOOD_RPC_URL,
    streams: {},
  });
  const contractInspector = new RpcContractInspector({
    rpc: (method, params) => rpcSource.call(method, params),
    confirmations,
  });
  const enricher = new CollectionEnricher({
    contractInspector,
    abiInspector: useBlockscout ? new BlockscoutAbiInspector() : null,
    nftEvidenceInspector: new RpcNftEvidenceInspector({
      rpc: (method, params) => rpcSource.call(method, params),
      confirmations,
    }),
  });
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
  return Object.freeze({
    ok: result.failures.length === 0,
    chainId: ROBINHOOD.chainId,
    readOnly: true,
    executionEnabled: false,
    ...result,
  });
}

function isMainModule() {
  return process.argv[1]
    && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runBrokerAnalysis().then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.name ?? "Error",
      message: error?.message ?? "Collection analysis failed",
    }));
    process.exitCode = 1;
  });
}
