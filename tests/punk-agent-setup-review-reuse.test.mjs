import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { reuseAgentStrategyReview } from "../netlify/functions/broker-v2-agent-account-setup.mjs";
const input = { tokenId: "93", intentHash: `0x${"a".repeat(64)}`, owner: `0x${"1".repeat(40)}` };
for (const state of ["PAUSED", "PENDING_OWNER_CONFIRMATION"]) test(`setup reuses ${state} without duplicate insert or activation`, async () => {
  const queries = [];
  const db = { query: async (sql, args) => {
    queries.push(sql); assert.equal(args[2], input.tokenId); assert.equal(args[3], input.intentHash); assert.equal(args[4], input.owner);
    return { rows: [{ version: "3", state }] };
  } };
  assert.equal(await reuseAgentStrategyReview(db, input), 3);
  assert.equal(queries.length, state === "PAUSED" ? 2 : 1);
  assert.doesNotMatch(queries.join("\n"), /SET state = 'ACTIVE'|INSERT|owner_confirmation_hash|authorization_transaction_hash/);
  if (state === "PAUSED") assert.match(queries[1], /SET state = 'PENDING_OWNER_CONFIRMATION'/);
});
test("setup refuses active/retired hashes and leaves missing rows for normal insertion", async () => {
  assert.equal(await reuseAgentStrategyReview({ query: async () => ({ rows: [] }) }, input), null);
  for (const state of ["ACTIVE", "EXPIRED", "SUPERSEDED"]) await assert.rejects(
    reuseAgentStrategyReview({ query: async () => ({ rows: [{ version: 3, state }] }) }, input),
    { code: "STRATEGY_ALREADY_RECORDED" });
});
test("chat and setup use the same per-Punk lock and receipt activation remains gated", async () => {
  const setup = await readFile(new URL("../netlify/functions/broker-v2-agent-account-setup.mjs", import.meta.url), "utf8");
  const receipt = await readFile(new URL("../netlify/functions/broker-v2-agent-account-receipt.mjs", import.meta.url), "utf8");
  assert.match(setup, /BigInt\(ROBINHOOD.chainId\) \* 10_000n \+ BigInt\(body.tokenId\)/);
  assert.match(receipt, /authorizationTransactionHash/);
  assert.match(receipt, /AND state = 'PENDING_OWNER_CONFIRMATION'/);
});
