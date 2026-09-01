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
  assert.equal(backgroundRpcDecision({
    CONTEXT: "production",
    BACKGROUND_RPC_ALLOWED_TASKS: "AUTOMATION_V3_WORKER",
  }, "AUTOMATION_V3_WORKER").enabled, true);
  assert.deepEqual(backgroundRpcDecision({
    CONTEXT: "production",
    BACKGROUND_RPC_ALLOWED_TASKS: "AUTOMATION_V3_WORKER",
  }, "DISCORD_SALES_FEED"), {
    enabled: false,
    reason: "TASK_NOT_ALLOWED",
    task: "DISCORD_SALES_FEED",
    context: "production",
  });
  assert.equal(backgroundRpcDecision({
    CONTEXT: "production",
    BACKGROUND_RPC_ALLOWED_TASKS: "",
  }, "AUTOMATION_V3_WORKER").reason, "TASK_NOT_ALLOWED");
  assert.equal(backgroundRpcDecision({
    CONTEXT: "production",
    PAUSE_BACKGROUND_RPC: "true",
    BACKGROUND_RPC_ALLOWED_TASKS: "AUTOMATION_V3_WORKER",
  }, "AUTOMATION_V3_WORKER").reason, "EMERGENCY_PAUSE");
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

test("incremental discovery uses one bounded secondary read only after primary RPC failure", async () => {
  const reports = [];
  let primaryHeads = 0;
  let primaryLogs = 0;
  let fallbackHeads = 0;
  let fallbackLogs = 0;
  const primary = {
    async getBlockNumber() { primaryHeads += 1; throw new Error("primary unavailable"); },
    async getLogs() { primaryLogs += 1; throw new Error("primary unavailable"); },
  };
  const fallback = {
    async getBlockNumber() { fallbackHeads += 1; return 10_020n; },
    async getLogs() { fallbackLogs += 1; return []; },
  };
  let databaseCalls = 0;
  const database = {
    async query() {
      databaseCalls += 1;
      if (databaseCalls === 1) return { rows: [{ indexed_through_block: "9000" }] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await incrementalSeaDropCollections(primary, database, 20n, {
    fallbackClient: fallback,
    pause: async () => {},
    report: (value) => reports.push(value),
  }), []);
  assert.equal(primaryHeads, 1);
  assert.equal(fallbackHeads, 1);
  assert.equal(primaryLogs, 1);
  assert.equal(fallbackLogs, 1);
  assert.equal(reports.length, 2);
  assert.match(reports[0], /"method":"HEAD"/);
  assert.match(reports[1], /"method":"LOGS"/);
});

test("incremental discovery does not hide index failures behind an RPC retry", async () => {
  let fallbackCalls = 0;
  await assert.rejects(() => incrementalSeaDropCollections({
    async getBlockNumber() { return 10_020n; },
  }, {
    async query() { throw new Error("database unavailable"); },
  }, 20n, {
    fallbackClient: {
      async getBlockNumber() { fallbackCalls += 1; return 10_020n; },
      async getLogs() { fallbackCalls += 1; return []; },
    },
  }), (error) => {
    assert.equal(error.code, "DISCOVERY_INDEX_READ_FAILED");
    return true;
  });
  assert.equal(fallbackCalls, 0);
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
