import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, keccak256 } from "viem";

import {
  expectedAutomationV3AccountRuntime,
  readAutomationV3RecoveryState,
} from "../netlify/functions/_shared/autonomy-v3-live.mjs";
import {
  buildNftWithdrawalGate,
  nftWithdrawalSurface,
} from "../netlify/functions/broker-nft-withdrawal-status.mjs";
import {
  encodeNftTransfer,
  encodeNftWithdrawal,
  preflightNftWithdrawal,
  submitNftWithdrawal,
  validateNftWithdrawalGate,
} from "../site/nft-withdrawal.js";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const ACCOUNT = "0x06d5e000000000000000000000000000000713e1";
const COLLECTION = "0x1111111111111111111111111111111111111111";
const PUNK_COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const IMPLEMENTATION = "0xb24199845ca42966e755b2dad7c8a9a490afeb13";
const REGISTRY = "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52";
const CODE = "0x6001600055";
const CODE_HASH = keccak256(CODE);
const TX_HASH = `0x${"ab".repeat(32)}`;

function gate() {
  return {
    status: "READY_FOR_LIVE_OWNER_CHECK",
    capability: true,
    reason: null,
    checkedAt: "2026-08-24T20:00:00.000Z",
    bindings: {
      chainId: 4663,
      punkCollection: PUNK_COLLECTION,
      accountImplementation: IMPLEMENTATION,
      accountRegistry: REGISTRY,
      punkTokenId: "93",
      account: ACCOUNT,
      expectedOwner: OWNER,
      accountRuntimeCodeHash: CODE_HASH,
      destination: OWNER,
      supportedStandards: ["ERC721", "ERC1155"],
    },
  };
}

function addressResult(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function uintResult(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function providerWorld({ standard = "ERC721" } = {}) {
  const calls = [];
  const provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [OWNER];
      if (method === "eth_getCode") return params[0].toLowerCase() === ACCOUNT ? CODE : "0x6000";
      if (method === "eth_estimateGas") return "0x186a0";
      if (method === "eth_sendTransaction") return TX_HASH;
      if (method === "eth_call") {
        const request = params[0];
        if (request.to.toLowerCase() === PUNK_COLLECTION
          && request.data.startsWith("0x6352211e")) return addressResult(OWNER);
        if (request.to.toLowerCase() === ACCOUNT && request.data === "0x8da5cb5b") {
          return addressResult(OWNER);
        }
        if (request.to.toLowerCase() === COLLECTION
          && request.data.startsWith("0x6352211e")) return addressResult(ACCOUNT);
        if (request.to.toLowerCase() === COLLECTION
          && request.data.startsWith("0x00fdd58e")) return uintResult(standard === "ERC1155" ? 5 : 0);
        if (request.to.toLowerCase() === ACCOUNT
          && request.data.startsWith("0x51945447")) {
          return `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
        }
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return { provider, calls };
}

test("verified V3 deployment exposes a withdrawal surface and exact 173-byte proxy runtime", () => {
  const surface = nftWithdrawalSurface();
  assert.equal(surface.capability, true);
  assert.equal(surface.bindings.chainId, 4663);
  const runtime = expectedAutomationV3AccountRuntime("93");
  assert.equal((runtime.length - 2) / 2, 173);
  assert.match(runtime, new RegExp(IMPLEMENTATION.slice(2)));
});

test("dual-provider recovery state requires the exact token-qualified runtime and live holder", async () => {
  const runtime = expectedAutomationV3AccountRuntime("93");
  const client = {
    readContract: async ({ functionName }) => {
      if (functionName === "account") return ACCOUNT;
      if (functionName === "ownerOf" || functionName === "owner") return OWNER;
      throw new Error("unexpected read");
    },
    getCode: async () => runtime,
  };
  const state = await readAutomationV3RecoveryState("93", {
    ROBINHOOD_RPC_URL: "https://one.example/rpc",
    ROBINHOOD_SECONDARY_RPC_URL: "https://two.example/rpc",
  }, { clients: [client, client] });
  assert.equal(state.created, true);
  assert.equal(state.accountRuntimeCodeHash, keccak256(runtime));
  await assert.rejects(readAutomationV3RecoveryState("93", {
    ROBINHOOD_RPC_URL: "https://one.example/rpc",
    ROBINHOOD_SECONDARY_RPC_URL: "https://two.example/rpc",
  }, { clients: [{ ...client, getCode: async () => CODE }, client] }), /runtime/);
});

test("withdrawal gate is token-qualified and fixes destination to the current holder", async () => {
  const built = await buildNftWithdrawalGate("93", {
    readRecovery: async () => ({
      tokenId: "93", account: ACCOUNT, owner: OWNER, created: true,
      accountRuntimeCodeHash: CODE_HASH,
    }),
  });
  assert.equal(built.capability, true);
  assert.equal(built.bindings.destination, OWNER);
  assert.equal(validateNftWithdrawalGate(gate(), "93").destination, OWNER);
  assert.throws(() => validateNftWithdrawalGate(gate(), "94"), /different Punk/);
  const changed = structuredClone(gate());
  changed.bindings.destination = "0x2222222222222222222222222222222222222222";
  assert.throws(() => validateNftWithdrawalGate(changed, "93"), /destination/);
});

test("ERC-721 and ERC-1155 encoders fix account source and current-holder destination", () => {
  const executeAbi = [{
    type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    ], outputs: [{ name: "result", type: "bytes" }],
  }];
  const erc721 = encodeNftTransfer({
    standard: "ERC721", account: ACCOUNT, owner: OWNER, tokenId: "99",
  });
  const outer = decodeFunctionData({ abi: executeAbi, data: encodeNftWithdrawal(COLLECTION, erc721) });
  assert.equal(outer.args[0].toLowerCase(), COLLECTION);
  assert.equal(outer.args[1], 0n);
  assert.equal(outer.args[2], erc721);
  assert.equal(outer.args[3], 0);
  assert.match(erc721, /^0x42842e0e/);
  assert.match(encodeNftTransfer({
    standard: "ERC1155", account: ACCOUNT, owner: OWNER, tokenId: "99", amount: "2",
  }), /^0xf242432a/);
});

test("preflight proves ownership, runtime, simulation, and submits one exact transaction", async () => {
  const world = providerWorld();
  const initial = await preflightNftWithdrawal(world.provider, gate(), "93", {
    collection: COLLECTION, standard: "ERC721", tokenId: "99", amount: "1",
  });
  assert.equal(initial.transaction.from, OWNER);
  assert.equal(initial.transaction.to, ACCOUNT);
  assert.equal(initial.transaction.value, "0x0");
  assert.match(initial.transaction.data, /^0x51945447/);
  assert.equal(world.calls.some(({ method }) => method === "eth_sendTransaction"), false);
  const result = await submitNftWithdrawal(world.provider, initial, {
    loadGate: async () => gate(), isCurrent: () => true,
  });
  assert.equal(result.hash, TX_HASH);
  assert.equal(world.calls.filter(({ method }) => method === "eth_sendTransaction").length, 1);

  const erc1155 = providerWorld({ standard: "ERC1155" });
  await preflightNftWithdrawal(erc1155.provider, gate(), "93", {
    collection: COLLECTION, standard: "ERC1155", tokenId: "99", amount: "2",
  });
});

test("withdrawal blocks the controlling Punk, arbitrary destination fields, and unsafe input", async () => {
  await assert.rejects(preflightNftWithdrawal(providerWorld().provider, gate(), "93", {
    collection: PUNK_COLLECTION, standard: "ERC721", tokenId: "93", amount: "1",
  }), /controlling Gogh Punk/);
  for (const tokenId of ["01", "-1", "1e2", ""]) {
    await assert.rejects(preflightNftWithdrawal(providerWorld().provider, gate(), "93", {
      collection: COLLECTION, standard: "ERC721", tokenId, amount: "1",
    }));
  }
  const html = await readFile(new URL("../site/broker/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../site/nft-withdrawal.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-nft-(?:destination|calldata)/i);
  assert.match(html, /destination is always the wallet that currently holds/i);
  assert.match(html, /data-nft-owned-asset/);
  assert.equal((source.match(/"eth_sendTransaction"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /localStorage|sessionStorage|privateKey|mnemonic/);
});
