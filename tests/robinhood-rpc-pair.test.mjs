import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { checkRobinhoodRpcPair } from "../scripts/check-robinhood-rpc-pair.mjs";

const HASH = `0x${"ab".repeat(32)}`;
const ENV = {
  ROBINHOOD_RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
  ROBINHOOD_SECONDARY_RPC_URL: "https://robinhood-mainnet.g.alchemy.com/v2/private-key",
};

function client(head = 1_000n, hash = HASH, chainId = 4663) {
  return {
    getChainId: async () => chainId,
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash }),
  };
}

test("RPC CLI checks one exact common block and redacts provider credential paths", async () => {
  const result = await checkRobinhoodRpcPair(ENV, {
    clients: [client(1_000n), client(1_004n)], now: 1_000,
  });
  assert.equal(result.chainId, 4663);
  assert.equal(result.headSkew, 4);
  assert.equal(result.commonConfirmedBlock, "988");
  assert.deepEqual(result.providerOrigins, [
    "https://rpc.mainnet.chain.robinhood.com", "https://robinhood-mainnet.g.alchemy.com",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private-key/);
});

test("RPC CLI fails closed on wrong chains, head skew, common-block drift, or one provider", async () => {
  await assert.rejects(() => checkRobinhoodRpcPair(ENV, {
    clients: [client(), client(1_000n, HASH, 1)],
  }), /Robinhood Chain/);
  await assert.rejects(() => checkRobinhoodRpcPair(ENV, {
    clients: [client(1_000n), client(1_013n)],
  }), /too far apart/);
  await assert.rejects(() => checkRobinhoodRpcPair(ENV, {
    clients: [client(), client(1_000n, `0x${"cd".repeat(32)}`)],
  }), /disagree/);
  await assert.rejects(() => checkRobinhoodRpcPair({
    ...ENV, ROBINHOOD_SECONDARY_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/other",
  }, { clients: [client(), client()] }), /distinct providers/);
});

test("RPC CLI source has no signer, wallet, submission, or write method", async () => {
  const source = await readFile(new URL(
    "../scripts/check-robinhood-rpc-pair.mjs", import.meta.url,
  ), "utf8");
  for (const forbidden of ["sendRawTransaction", "sendTransaction", "privateKeyToAccount",
    "writeContract", "walletClient", "eth_send", "signMessage"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }
});
