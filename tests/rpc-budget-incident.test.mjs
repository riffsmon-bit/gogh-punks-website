import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  backgroundRpcDecision,
} from "../netlify/functions/_shared/background-rpc-policy.mjs";
import {
  incrementalSeaDropCollections,
} from "../scripts/run-automated-seadrop-v3-worker.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";

test("deploy previews and the emergency switch suppress autonomous background RPC", () => {
  assert.deepEqual(backgroundRpcDecision({ CONTEXT: "deploy-preview" }, "WORKER"), {
    enabled: false, reason: "PREVIEW_DISABLED", task: "WORKER", context: "deploy-preview",
  });
  assert.equal(backgroundRpcDecision({
    CONTEXT: "deploy-preview", ENABLE_PREVIEW_BACKGROUND_RPC: "true",
  }).enabled, true);
  assert.equal(backgroundRpcDecision({ CONTEXT: "production" }).enabled, true);
  assert.equal(backgroundRpcDecision({
    CONTEXT: "production", PAUSE_BACKGROUND_RPC: "true",
  }).reason, "EMERGENCY_PAUSE");
});

test("SeaDrop discovery advances from its checkpoint instead of rescanning 80,000 blocks", async () => {
  const ranges = [];
  const client = {
    async getBlockNumber() { return 10_020n; },
    async getLogs(range) {
      ranges.push({ fromBlock: range.fromBlock, toBlock: range.toBlock });
      return [{
        args: {
          nftContract: COLLECTION,
          publicDrop: {
            mintPrice: 0n, startTime: 1n, endTime: 4_000_000_000n,
            maxTotalMintableByWallet: 1,
          },
        },
        blockNumber: 9_999n,
        blockHash: `0x${"2".repeat(64)}`,
        transactionHash: `0x${"3".repeat(64)}`,
      }];
    },
  };
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (calls.length === 1) return { rows: [{ indexed_through_block: "9000" }] };
      if (calls.length === 2) return { rows: [] };
      return { rows: [{ collection_address: COLLECTION }] };
    },
  };
  const collections = await incrementalSeaDropCollections(client, database, 20n, {
    pause: async () => {}, nowMs: 2_000_000,
  });
  assert.deepEqual(ranges, [{ fromBlock: 8_937n, toBlock: 10_000n }]);
  assert.deepEqual(collections, [COLLECTION]);
  assert.equal(calls[1].parameters.at(-1), "10000");
});

test("incident controls keep chain-wide portfolio scans opt-in and defer global live reads", async () => {
  const [mintIndexer, worker, ownerUi, statusUi, statusRoute] = await Promise.all([
    readFile(new URL("../netlify/functions/broker-mint-indexer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-automated-seadrop-v3-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../site/owner-accounts.js", import.meta.url), "utf8"),
    readFile(new URL("../site/autonomous-minting.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-autonomy-v3-status.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(mintIndexer, /BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER/);
  assert.ok(worker.indexOf("if (candidates.length === 0)")
    < worker.indexOf('"GLOBAL_STATE_READ_FAILED"'));
  assert.doesNotMatch(ownerUi, /void reconcileOwnerRoster\(/);
  assert.doesNotMatch(statusUi, /new URLSearchParams\(\{ refresh:/);
  assert.doesNotMatch(statusUi, /autonomy-v\$\{version\}-status\$\{query\}[\s\S]{0,160}cache: "no-store"/);
  assert.match(statusRoute, /s-maxage=15, stale-while-revalidate=15/);
});

test("every scheduled Art Broker network job uses the preview and emergency guard", async () => {
  const paths = [
    "broker-analyzer.mjs",
    "broker-autonomy-v2-worker.mjs",
    "broker-autonomy-v3-worker.mjs",
    "broker-indexer.mjs",
    "broker-metadata.mjs",
    "broker-mint-indexer.mjs",
    "broker-scout.mjs",
    "discord-sales.mjs",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../netlify/functions/${path}`, import.meta.url), "utf8");
    assert.match(source, /backgroundRpcDecision\(process\.env,/);
    assert.match(source, /if \(!decision\.enabled\)/);
  }
});
