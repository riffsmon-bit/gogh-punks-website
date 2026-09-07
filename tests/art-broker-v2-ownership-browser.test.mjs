import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters } from "viem";
import { verifyOwnedPunkIds } from "../site/broker-v2-ownership.js";

const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const BALANCE_OF = "0x70a08231";
const MAX_SUPPLY = "0xd5abeb01";

function uintWord(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function addressWord(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function aggregateOwners(owners) {
  return encodeAbiParameters([{ type: "tuple[]", components: [
    { name: "success", type: "bool" }, { name: "returnData", type: "bytes" },
  ] }], [owners.map((owner) => ({ success: true, returnData: addressWord(owner) }))]);
}

test("V2 roster verifies indexed candidates at one pinned Robinhood block", async () => {
  const calls = [];
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_blockNumber") return "0xabc";
    if (params[0].to === COLLECTION && params[0].data.startsWith(BALANCE_OF)) return uintWord(2);
    if (params[0].to === MULTICALL3) return aggregateOwners([OWNER, OTHER, OWNER]);
    throw new Error("unexpected call");
  } };
  const result = await verifyOwnedPunkIds(provider, COLLECTION, OWNER, ["1", "2", "3"]);
  assert.deepEqual(result.tokenIds, ["1", "3"]);
  assert.equal(result.balance, 2);
  assert.equal(result.blockTag, "0xabc");
  assert.equal(calls.filter(({ method }) => method === "eth_call").length, 2);
  assert.ok(calls.filter(({ method }) => method === "eth_call")
    .every(({ params }) => params[1] === "0xabc"));
});

test("V2 roster repairs a stale candidate index with a bounded full scan", async () => {
  let multicalls = 0;
  const provider = { request: async ({ method, params }) => {
    if (method === "eth_blockNumber") return "0xdef";
    if (params[0].to === COLLECTION && params[0].data.startsWith(BALANCE_OF)) return uintWord(2);
    if (params[0].to === COLLECTION && params[0].data === MAX_SUPPLY) return uintWord(3);
    if (params[0].to === MULTICALL3) {
      multicalls += 1;
      return multicalls === 1 ? aggregateOwners([OWNER])
        : aggregateOwners([OTHER, OWNER, OWNER, OTHER]);
    }
    throw new Error("unexpected call");
  } };
  const result = await verifyOwnedPunkIds(provider, COLLECTION, OWNER, ["1"]);
  assert.deepEqual(result.tokenIds, ["1", "2"]);
  assert.equal(multicalls, 2);
});

test("V2 roster fails closed on invalid ownership evidence", async () => {
  await assert.rejects(() => verifyOwnedPunkIds(null, COLLECTION, OWNER, ["1"]),
    /unavailable/);
  const provider = { request: async ({ method }) => method === "eth_blockNumber"
    ? "latest" : uintWord(0) };
  await assert.rejects(() => verifyOwnedPunkIds(provider, COLLECTION, OWNER, ["1"]),
    /block number/);
});
