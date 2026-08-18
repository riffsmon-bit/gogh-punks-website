import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { RobinhoodJsonRpcSource } from "../broker/src/indexer/json-rpc-source.mjs";
import { ReorgAwareIndexer } from "../broker/src/indexer/reorg-indexer.mjs";
import { protocolStreams } from "../broker/src/indexer/streams.mjs";
import { PostgresIndexerRepository } from "../netlify/functions/broker/indexer-repository.mjs";

function unsignedInteger({
  name,
  required = false,
  fallback,
  minimum = 0,
  maximum = null,
}) {
  const configured = process.env[name];
  const value = configured === undefined || configured === "" ? fallback : configured;
  if ((value === undefined || value === "") && required) {
    throw new TypeError(`${name} is required`);
  }
  try {
    const parsed = BigInt(value);
    const lowerBound = BigInt(minimum);
    const upperBound = maximum === null ? null : BigInt(maximum);
    if (parsed < lowerBound || (upperBound !== null && parsed > upperBound)) {
      throw new RangeError();
    }
    return parsed;
  } catch {
    const range = maximum === null
      ? `at least ${minimum}`
      : `between ${minimum} and ${maximum}`;
    throw new TypeError(`${name} must be an integer ${range}`);
  }
}

async function main() {
  if (process.env.BROKER_INDEXER_ENABLED !== "true") {
    throw new Error("BROKER_INDEXER_ENABLED must be exactly true");
  }
  const deployment = JSON.parse(
    readFileSync(resolve(process.cwd(), "deployments/robinhood.json"), "utf8"),
  );
  const streams = protocolStreams(deployment);
  const requested = (
    process.env.BROKER_INDEX_STREAMS
      ?? "gogh_punk_transfers,seaport_activity"
  )
    .split(",")
    .map((stream) => stream.trim())
    .filter(Boolean);
  if (requested.length === 0) throw new TypeError("BROKER_INDEX_STREAMS cannot be empty");
  for (const stream of requested) {
    if (!Object.hasOwn(streams, stream)) throw new TypeError(`unknown stream ${stream}`);
  }

  const source = new RobinhoodJsonRpcSource({
    rpcUrl: process.env.ROBINHOOD_RPC_URL,
    streams,
  });
  const remoteChainId = Number(BigInt(await source.call("eth_chainId", [])));
  if (remoteChainId !== ROBINHOOD.chainId) {
    throw new Error(`RPC chain mismatch: expected ${ROBINHOOD.chainId}, received ${remoteChainId}`);
  }

  const repository = new PostgresIndexerRepository();
  const indexerConfiguration = {
    confirmations: unsignedInteger({
      name: "BROKER_CONFIRMATIONS",
      fallback: "20",
      maximum: 10_000,
    }),
    reorgWindow: unsignedInteger({
      name: "BROKER_REORG_WINDOW",
      fallback: "64",
      maximum: 100_000,
    }),
    batchSize: unsignedInteger({
      name: "BROKER_INDEX_BATCH_SIZE",
      fallback: "1000",
      minimum: 1,
      maximum: 10_000,
    }),
    maximumBlocksPerRun: unsignedInteger({
      name: "BROKER_INDEX_MAX_BLOCKS_PER_RUN",
      fallback: "10000",
      minimum: 1,
      maximum: 1_000_000,
    }),
  };

  const results = await repository.withChainLock(ROBINHOOD.chainId, async (lockedRepository) => {
    const completed = {};
    for (const stream of requested) {
      const streamStartName = `BROKER_INDEX_FROM_BLOCK_${stream.toUpperCase()}`;
      const startBlock = unsignedInteger({
        name: streamStartName,
        required: true,
        fallback: process.env.BROKER_INDEX_FROM_BLOCK,
      });
      const indexer = new ReorgAwareIndexer({
        chainId: ROBINHOOD.chainId,
        source,
        repository: lockedRepository,
        startBlock,
        ...indexerConfiguration,
      });
      completed[stream] = await indexer.run(stream);
    }
    return completed;
  });
  console.log(JSON.stringify({ ok: true, chainId: ROBINHOOD.chainId, results }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.name ?? "Error",
    message: error?.message ?? "Indexer failed",
  }));
  process.exitCode = 1;
});
