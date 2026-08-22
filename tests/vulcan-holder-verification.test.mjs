import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import handler, {
  verifyVulcanHolder,
} from "../netlify/functions/vulcan-holder-verification.mjs";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const OTHER = "0x1111111111111111111111111111111111111111";
const TOKEN = "a".repeat(64);

function rpcWorld({ balances = { [OWNER]: 1n }, chainId = "0x1237" } = {}) {
  const calls = [];
  return {
    calls,
    fetchFunction: async (url, options) => {
      calls.push({ url, options });
      const request = JSON.parse(options.body);
      const result = request.method === "eth_chainId"
        ? chainId
        : `0x${(balances[`0x${request.params[0].data.slice(-40)}`] ?? 0n)
          .toString(16).padStart(64, "0")}`;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("checks one or many wallets against the canonical Robinhood collection", async () => {
  const world = rpcWorld();
  assert.equal(await verifyVulcanHolder({ wallet: OWNER }, {
    rpcUrl: "https://rpc.example",
    fetchFunction: world.fetchFunction,
  }), true);
  assert.equal(await verifyVulcanHolder({ wallets: [OTHER, OWNER] }, {
    rpcUrl: "https://rpc.example",
    fetchFunction: world.fetchFunction,
  }), true);
  assert.equal(world.calls.every(({ options }) => options.method === "POST"
    && options.redirect === "error"), true);
  const balanceCalls = world.calls.filter(({ options }) => (
    JSON.parse(options.body).method === "eth_call"
  ));
  assert.equal(balanceCalls.every(({ options }) => (
    JSON.parse(options.body).params[0].to
      === "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6"
  )), true);
});

test("returns false for a valid non-holder and fails closed on wrong-chain RPC", async () => {
  const empty = rpcWorld({ balances: {} });
  assert.equal(await verifyVulcanHolder({ wallet: OTHER }, {
    rpcUrl: "https://rpc.example",
    fetchFunction: empty.fetchFunction,
  }), false);
  const wrong = rpcWorld({ chainId: "0x1" });
  await assert.rejects(verifyVulcanHolder({ wallet: OWNER }, {
    rpcUrl: "https://rpc.example",
    fetchFunction: wrong.fetchFunction,
  }), /RPC_WRONG_CHAIN/);
});

test("rejects ambiguous, duplicate, malformed, and excessive wallet inputs", async () => {
  const world = rpcWorld();
  for (const body of [
    {},
    { wallet: OWNER, wallets: [OWNER] },
    { wallet: "not-an-address" },
    { wallets: [OWNER, OWNER] },
    { wallets: [] },
    { wallets: Array.from({ length: 21 }, (_, index) => (
      `0x${index.toString(16).padStart(40, "0")}`
    )) },
  ]) {
    await assert.rejects(verifyVulcanHolder(body, {
      rpcUrl: "https://rpc.example",
      fetchFunction: world.fetchFunction,
    }));
  }
  assert.equal(world.calls.length, 0);
});

test("HTTP boundary hides an invalid token and emits only Vulcan's success shape", async () => {
  const priorToken = process.env.VULCAN_HOLDER_WEBHOOK_TOKEN;
  const priorRpc = process.env.RPC_URL;
  process.env.VULCAN_HOLDER_WEBHOOK_TOKEN = TOKEN;
  process.env.RPC_URL = "https://rpc.example";
  try {
    const denied = await handler(new Request(
      "https://gogh.example/api/vulcan/holder-verification?token=wrong",
      { method: "POST", body: JSON.stringify({ wallet: OWNER }) },
    ));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { success: false });
    assert.equal(denied.headers.get("cache-control"), "no-store, max-age=0");
  } finally {
    if (priorToken === undefined) delete process.env.VULCAN_HOLDER_WEBHOOK_TOKEN;
    else process.env.VULCAN_HOLDER_WEBHOOK_TOKEN = priorToken;
    if (priorRpc === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = priorRpc;
  }
});

test("source exposes no role mutation, wallet signing, transaction, or secret value", async () => {
  const source = await readFile(new URL(
    "../netlify/functions/vulcan-holder-verification.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /guilds\/.+roles|DISCORD_BOT_TOKEN|eth_send|personal_sign|privateKey|mnemonic/);
  assert.match(source, /BALANCE_OF_SELECTOR/);
  assert.match(source, /VULCAN_HOLDER_WEBHOOK_TOKEN/);
  assert.match(source, /aggregateBy: \["ip"\]/);
});
