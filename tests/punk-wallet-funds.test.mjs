import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, keccak256 } from "viem";

import {
  preflightPunkWalletFunds,
  submitPunkWalletFunds,
} from "../site/punk-wallet-funds.js";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const ACCOUNT = "0x06d5e000000000000000000000000000000713e1";
const PUNK_COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const CODE = "0x6001600055";
const CODE_HASH = keccak256(CODE);
const TX_HASH = `0x${"ab".repeat(32)}`;

function addressResult(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function gate() {
  return {
    status: "READY_FOR_LIVE_OWNER_CHECK", capability: true, reason: null,
    checkedAt: "2026-08-30T20:00:00.000Z",
    bindings: {
      chainId: 4663, punkCollection: PUNK_COLLECTION,
      accountImplementation: "0xb24199845ca42966e755b2dad7c8a9a490afeb13",
      accountRegistry: "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52",
      punkTokenId: "93", account: ACCOUNT, expectedOwner: OWNER,
      accountRuntimeCodeHash: CODE_HASH, destination: OWNER,
      supportedStandards: ["ERC721", "ERC1155"],
    },
  };
}

function providerWorld() {
  const calls = [];
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_getCode") return CODE;
    if (method === "eth_getBalance") return "0x2386f26fc10000";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction") return TX_HASH;
    if (method === "eth_call") {
      const tx = params[0];
      if (tx.to.toLowerCase() === PUNK_COLLECTION) return addressResult(OWNER);
      if (tx.to.toLowerCase() === ACCOUNT && tx.data === "0x8da5cb5b") return addressResult(OWNER);
      if (tx.to.toLowerCase() === ACCOUNT && tx.data === "0x") return "0x";
      if (tx.to.toLowerCase() === ACCOUNT && tx.data.startsWith("0x51945447")) {
        return `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
      }
    }
    throw new Error(`unexpected ${method}`);
  } };
  return { provider, calls };
}

test("V3 Punk Wallet deposit simulates and submits one exact owner-to-account transfer", async () => {
  const world = providerWorld();
  const initial = await preflightPunkWalletFunds(world.provider, gate(), "93", "deposit", "0.01");
  assert.deepEqual(initial.transaction, {
    from: OWNER, to: ACCOUNT, value: "0x2386f26fc10000", data: "0x",
  });
  assert.equal(world.calls.some(({ method }) => method === "eth_sendTransaction"), false);
  const submitted = await submitPunkWalletFunds(world.provider, initial, {
    loadGate: async () => gate(), isCurrent: () => true,
  });
  assert.equal(submitted.hash, TX_HASH);
  assert.equal(world.calls.filter(({ method }) => method === "eth_sendTransaction").length, 1);
  assert.equal(world.calls.some(({ params }) => JSON.stringify(params).includes("owner-policy")), false);
});

test("V3 Punk Wallet withdrawal fixes its destination to the current Punk owner", async () => {
  const world = providerWorld();
  const initial = await preflightPunkWalletFunds(world.provider, gate(), "93", "withdraw", "0.001");
  assert.equal(initial.transaction.from, OWNER);
  assert.equal(initial.transaction.to, ACCOUNT);
  assert.equal(initial.transaction.value, "0x0");
  const executeAbi = [{ type: "function", name: "execute", stateMutability: "payable",
    inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }],
    outputs: [{ name: "result", type: "bytes" }] }];
  const decoded = decodeFunctionData({ abi: executeAbi, data: initial.transaction.data });
  assert.equal(decoded.args[0].toLowerCase(), OWNER);
  assert.equal(decoded.args[1], 1_000_000_000_000_000n);
  assert.equal(decoded.args[2], "0x");
  assert.equal(decoded.args[3], 0);
});

test("V3 funds path fails closed on owner, runtime, balance, and amount changes", async () => {
  const wrongOwner = providerWorld();
  wrongOwner.provider.request = async ({ method, params }) => method === "eth_accounts"
    ? ["0x1111111111111111111111111111111111111111"]
    : providerWorld().provider.request({ method, params });
  await assert.rejects(preflightPunkWalletFunds(wrongOwner.provider, gate(), "93", "deposit", "0.01"),
    /currently holds/);
  await assert.rejects(preflightPunkWalletFunds(providerWorld().provider, gate(), "93", "withdraw", "0.02"),
    /exceeds/);
  const wrongRuntime = providerWorld();
  wrongRuntime.provider.request = async ({ method, params }) => method === "eth_getCode"
    ? "0x6000"
    : providerWorld().provider.request({ method, params });
  await assert.rejects(
    preflightPunkWalletFunds(wrongRuntime.provider, gate(), "93", "deposit", "0.01"),
    /runtime does not match/,
  );
  for (const amount of ["0", "-1", "1e-3", "0.0000000000000000001", ""]) {
    await assert.rejects(preflightPunkWalletFunds(providerWorld().provider, gate(), "93", "deposit", amount));
  }
});
