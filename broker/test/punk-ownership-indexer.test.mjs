import assert from "node:assert/strict";
import test from "node:test";

import { ROBINHOOD } from "../src/config.mjs";
import { TRANSFER_TOPIC } from "../src/discovery/onchain-events.mjs";
import { projectPunkOwnershipTransfer } from "../src/indexer/punk-ownership-projection.mjs";
import { PostgresIndexerRepository } from "../../netlify/functions/broker/indexer-repository.mjs";

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";
const topic = (value) => `0x${value.slice(2).padStart(64, "0")}`;
const tokenTopic = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

function transferRecord({ from = OWNER_A, to = OWNER_B, tokenId = 93, blockNumber = "42",
  logIndex = "7", address = ROBINHOOD.canonicalCollection } = {}) {
  return {
    id: `gogh_punk_transfers:${HASH_B}:${logIndex}`,
    blockNumber,
    blockHash: HASH_A,
    transactionHash: HASH_B,
    logIndex,
    address,
    topics: [TRANSFER_TOPIC, topic(from), topic(to), tokenTopic(tokenId)],
    data: "0x",
    blockTimestamp: "1788062400",
  };
}

test("canonical Punk transfers project mint, transfer, and burn ownership", () => {
  const moved = projectPunkOwnershipTransfer({
    chainId: 4663, stream: "gogh_punk_transfers", record: transferRecord(),
  });
  assert.deepEqual(moved, {
    kind: "PUNK_OWNERSHIP_TRANSFER",
    collection: ROBINHOOD.canonicalCollection,
    tokenId: "93",
    from: OWNER_A,
    owner: OWNER_B,
    blockNumber: "42",
    logIndex: 7,
  });
  assert.equal(projectPunkOwnershipTransfer({ chainId: 4663, stream: "gogh_punk_transfers",
    record: transferRecord({ from: ZERO }) }).from, null);
  assert.equal(projectPunkOwnershipTransfer({ chainId: 4663, stream: "gogh_punk_transfers",
    record: transferRecord({ to: ZERO }) }).owner, null);
});

test("ownership projection rejects malformed, wrong-chain, and noncanonical evidence", () => {
  const valid = transferRecord();
  for (const input of [
    { chainId: 1, stream: "gogh_punk_transfers", record: valid },
    { chainId: 4663, stream: "seaport_activity", record: valid },
    { chainId: 4663, stream: "gogh_punk_transfers", record: transferRecord({ address: "bad" }) },
    { chainId: 4663, stream: "gogh_punk_transfers", record: { ...valid, data: "0x00" } },
    { chainId: 4663, stream: "gogh_punk_transfers", record: transferRecord({ tokenId: 5017 }) },
  ]) assert.equal(projectPunkOwnershipTransfer(input), null);
});

test("ownership materialization and checkpoint commit atomically", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/INSERT INTO broker_indexed_logs/.test(sql)) return { rowCount: 1 };
      return { rowCount: 1, rows: [] };
    },
  };
  const inserted = await new PostgresIndexerRepository(database).insertLogs(
    4663, "gogh_punk_transfers", [transferRecord()],
    { checkpoint: { blockNumber: "42", blockHash: HASH_A } },
  );
  assert.equal(inserted, 1);
  const ownership = calls.find(({ sql }) => /INSERT INTO broker_punks/.test(sql));
  const checkpoint = calls.find(({ sql }) => /INSERT INTO broker_indexer_checkpoints/.test(sql));
  assert.deepEqual(ownership.values, [4663, ROBINHOOD.canonicalCollection, "93", OWNER_B, "42"]);
  assert.ok(calls.indexOf(ownership) < calls.indexOf(checkpoint));
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("a failed ownership write rolls back before checkpoint advancement", async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (/INSERT INTO broker_indexed_logs/.test(sql)) return { rowCount: 1 };
      if (/INSERT INTO broker_punks/.test(sql)) throw new Error("ownership write failed");
      return { rowCount: 1, rows: [] };
    },
  };
  await assert.rejects(new PostgresIndexerRepository(database).insertLogs(
    4663, "gogh_punk_transfers", [transferRecord()],
    { checkpoint: { blockNumber: "42", blockHash: HASH_A } },
  ), /ownership write failed/);
  assert.ok(!calls.some((sql) => /INSERT INTO broker_indexer_checkpoints/.test(sql)));
  assert.equal(calls.at(-1), "ROLLBACK");
});
