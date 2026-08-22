import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, keccak256 } from "viem";
import { accountManagementSnapshot } from
  "../netlify/functions/broker-account-management-status.mjs";
import {
  encodeOwnerWithdrawal,
  formatAccountEther,
  parseAccountEtherAmount,
  preflightAccountFunds,
  submitAccountFunds,
  validateAccountManagementGate,
} from "../site/account-funds.js";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const ACCOUNT = "0x89f6c15bfbf629e9c0d2f5d56be58a27b01446b3";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const CODE = "0x6001600055";
const CODE_HASH = keccak256(CODE);
const TX_HASH = `0x${"34".repeat(32)}`;

function surface() {
  return {
    deploymentStatus: "DEPLOYED",
    canaryStatus: "DEPLOYED",
    canary: {
      chainId: 4663,
      expectedOwner: OWNER,
      account: ACCOUNT,
      accountRuntimeCodeHash: CODE_HASH,
      punkCollection: COLLECTION,
      punkTokenId: "1797",
    },
  };
}

function gate() {
  return accountManagementSnapshot(surface());
}

function addressResult(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function providerWorld({ balance = 2_000_000_000_000_000n } = {}) {
  const calls = [];
  const provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [OWNER];
      if (method === "eth_getCode") return CODE;
      if (method === "eth_getBalance") return `0x${balance.toString(16)}`;
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return TX_HASH;
      if (method === "eth_call") {
        if (params[0].data.startsWith("0x6352211e")) return addressResult(OWNER);
        if (params[0].data === "0x8da5cb5b") return addressResult(OWNER);
        if (params[0].data === "0x") return "0x";
        if (params[0].data.startsWith("0x51945447")) {
          return `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
        }
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return { provider, calls };
}

test("parses only canonical positive ETH amounts bounded to one ETH", () => {
  assert.equal(parseAccountEtherAmount("0.001"), 1_000_000_000_000_000n);
  assert.equal(parseAccountEtherAmount("1"), 1_000_000_000_000_000_000n);
  assert.equal(parseAccountEtherAmount("0.000000000000000001"), 1n);
  assert.equal(formatAccountEther(1_230_000_000_000_000n), "0.00123");
  for (const value of ["0", "1.000000000000000001", "01", ".1", "1.", "1e-3", "-1", "", " 1"] ) {
    assert.throws(() => parseAccountEtherAmount(value));
  }
});

test("withdrawal encoding fixes the target to owner, empty data, and CALL operation", () => {
  const data = encodeOwnerWithdrawal(OWNER, 1_000_000_000_000_000n);
  const decoded = decodeFunctionData({
    abi: [{
      type: "function", name: "execute", stateMutability: "payable",
      inputs: [
        { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
      ],
      outputs: [{ name: "result", type: "bytes" }],
    }],
    data,
  });
  assert.equal(decoded.args[0].toLowerCase(), OWNER);
  assert.equal(decoded.args[1], 1_000_000_000_000_000n);
  assert.equal(decoded.args[2], "0x");
  assert.equal(decoded.args[3], 0);
});

test("status exposes only verified fixed Punk account management bindings", () => {
  const ready = gate();
  assert.equal(ready.capability, true);
  assert.deepEqual(validateAccountManagementGate(ready), {
    chainId: 4663,
    expectedOwner: OWNER,
    account: ACCOUNT,
    accountRuntimeCodeHash: CODE_HASH,
    punkCollection: COLLECTION,
    punkTokenId: "1797",
  });
  assert.equal(accountManagementSnapshot({ deploymentStatus: "NOT_DEPLOYED" }).capability, false);
});

test("deposit and withdrawal preflight bind owner, code, balance, simulation, and gas", async () => {
  const depositWorld = providerWorld();
  const deposit = await preflightAccountFunds(depositWorld.provider, gate(), "deposit", "0.001");
  assert.deepEqual(deposit.transaction, {
    from: OWNER, to: ACCOUNT, value: "0x38d7ea4c68000", data: "0x",
  });
  assert.equal(depositWorld.calls.some(({ method }) => method === "eth_sendTransaction"), false);

  const withdrawalWorld = providerWorld();
  const withdrawal = await preflightAccountFunds(
    withdrawalWorld.provider, gate(), "withdraw", "0.001",
  );
  assert.equal(withdrawal.transaction.from, OWNER);
  assert.equal(withdrawal.transaction.to, ACCOUNT);
  assert.equal(withdrawal.transaction.value, "0x0");
  assert.match(withdrawal.transaction.data, /^0x51945447/);

  await assert.rejects(preflightAccountFunds(
    providerWorld({ balance: 1n }).provider, gate(), "withdraw", "0.001",
  ), /exceeds/);
});

test("submission repeats the exact preflight and sends only one fixed transaction", async () => {
  const world = providerWorld();
  const initial = await preflightAccountFunds(world.provider, gate(), "withdraw", "0.001");
  const result = await submitAccountFunds(world.provider, initial, { isCurrent: () => true });
  assert.equal(result.hash, TX_HASH);
  const sends = world.calls.filter(({ method }) => method === "eth_sendTransaction");
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].params, [initial.transaction]);
});

test("browser source isolates account actions from read-only wallet and arbitrary targets", async () => {
  const [source, walletSource, html] = await Promise.all([
    readFile(new URL("../site/account-funds.js", import.meta.url), "utf8"),
    readFile(new URL("../site/wallet.js", import.meta.url), "utf8"),
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
  ]);
  assert.equal((source.match(/"eth_sendTransaction"/g) ?? []).length, 1);
  assert.doesNotMatch(walletSource, /eth_sendTransaction/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|privateKey|mnemonic/);
  assert.doesNotMatch(html, /data-account-(?:destination|calldata)/i);
  assert.match(html, /Deposit to Punk Account/);
  assert.match(html, /Withdraw to owner wallet/);
  assert.match(html, /autonomous agent actions/i);
});
