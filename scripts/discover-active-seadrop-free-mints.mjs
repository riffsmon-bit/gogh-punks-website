#!/usr/bin/env node
import { createPublicClient, http } from "viem";

import {
  PUBLIC_DROP_UPDATED_EVENT,
  buildSeaDropPublicDropHintIndex,
} from "../broker/src/discovery/seadrop-public-drop-index.mjs";
import { SEA_DROP } from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const LOOKBACK = 100_000n;
const CONFIRMATIONS = 20n;

function rawLog(log) {
  return {
    address: log.address,
    blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    removed: log.removed ?? false,
    topics: log.topics,
    data: log.data,
  };
}

export async function discoverActiveSeaDropFreeMints(argv, dependencies = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) throw new TypeError("this command accepts no arguments");
  const client = dependencies.client ?? createPublicClient({ transport: http(RPC_URL) });
  const now = dependencies.now ?? (() => Date.now());
  const head = await client.getBlockNumber();
  if (head <= CONFIRMATIONS) throw new TypeError("confirmed chain head is unavailable");
  const confirmedBlock = head - CONFIRMATIONS;
  const fromBlock = confirmedBlock > LOOKBACK ? confirmedBlock - LOOKBACK : 0n;
  const block = await client.getBlock({ blockNumber: confirmedBlock });
  const logs = await client.getLogs({
    address: SEA_DROP,
    event: PUBLIC_DROP_UPDATED_EVENT,
    fromBlock,
    toBlock: confirmedBlock,
  });
  const closing = await client.getBlock({ blockNumber: confirmedBlock });
  if (closing.hash !== block.hash || closing.timestamp !== block.timestamp) {
    throw new TypeError("confirmed discovery block changed during the scan");
  }
  return buildSeaDropPublicDropHintIndex(logs.map(rawLog), {
    chainId: 4663,
    fromBlock: fromBlock.toString(),
    confirmedBlock: confirmedBlock.toString(),
    confirmedBlockHash: block.hash,
    confirmedBlockTimestamp: block.timestamp.toString(),
    checkedAt: new Date(now()).toISOString(),
    sourceOrigin: RPC_URL,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  discoverActiveSeaDropFreeMints(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => { process.stderr.write("SEADROP_DISCOVERY_FAIL\n"); process.exitCode = 1; },
  );
}
