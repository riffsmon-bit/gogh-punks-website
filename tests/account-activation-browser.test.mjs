import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inspectPunkActivation,
  submitPunkActivation,
  validateActivationGate,
} from "../site/account-activation.js";
import { keccak256Hex } from "../site/keccak256.js";
import { accountActivationSnapshot } from
  "../netlify/functions/broker-account-activation-status.mjs";

const OWNER = "0x1234567890abcdef1234567890abcdef12345678";
const ACCOUNT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222";
const CANONICAL = "0x000000006551c19487814612e58fe06813775758";
const REGISTRY_CODE = "0x6001";
const IMPLEMENTATION_CODE = "0x6002";
const CANONICAL_CODE = "0x6003";

function addressWord(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function gate() {
  return {
    status: "READY_FOR_OWNER_ACTIVATION_CHECK",
    capability: true,
    reason: null,
    bindings: {
      chainId: 4663,
      punkCollection: COLLECTION,
      accountRegistry: REGISTRY,
      accountRegistryRuntimeCodeHash: keccak256Hex(REGISTRY_CODE),
      accountImplementation: IMPLEMENTATION,
      accountImplementationRuntimeCodeHash: keccak256Hex(IMPLEMENTATION_CODE),
      canonicalERC6551Registry: CANONICAL,
      canonicalERC6551RegistryRuntimeCodeHash: keccak256Hex(CANONICAL_CODE),
      accountSalt: `0x${"00".repeat(32)}`,
    },
  };
}

function provider({ owner = OWNER, activated = false } = {}) {
  const calls = [];
  return {
    calls,
    async request({ method, params = [] }) {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [OWNER];
      if (method === "eth_getCode") {
        const target = params[0].toLowerCase();
        if (target === REGISTRY) return REGISTRY_CODE;
        if (target === IMPLEMENTATION) return IMPLEMENTATION_CODE;
        if (target === CANONICAL) return CANONICAL_CODE;
        if (target === ACCOUNT) return activated ? "0x6004" : "0x";
      }
      if (method === "eth_call") {
        const transaction = params[0];
        const selector = transaction.data.slice(0, 10);
        if (transaction.to.toLowerCase() === COLLECTION && selector === "0x6352211e") {
          return addressWord(owner);
        }
        if (transaction.to.toLowerCase() === REGISTRY) {
          if (selector === "0x2dd7c658" || selector === "0xcab13915") return addressWord(ACCOUNT);
          if (selector === "0x5c60da1b") return addressWord(IMPLEMENTATION);
          if (selector === "0x6c74921e") return `0x${"00".repeat(32)}`;
          if (selector === "0x93bbfb4a") return addressWord(COLLECTION);
          if (selector === "0xa66ea95a") return addressWord(CANONICAL);
        }
      }
      if (method === "eth_estimateGas") return "0x186a0";
      if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("activation status exposes only verified core account bindings", () => {
  const snapshot = accountActivationSnapshot();
  assert.equal(snapshot.status, "READY_FOR_OWNER_ACTIVATION_CHECK");
  assert.equal(snapshot.capability, true);
  assert.equal(snapshot.bindings.chainId, 4663);
  assert.match(snapshot.bindings.accountRegistryRuntimeCodeHash, /^0x[0-9a-f]{64}$/);
  assert.equal(validateActivationGate(gate()).chainId, 4663);
});

test("inspects ownership and submits exactly one fixed createAccount call", async () => {
  const wallet = provider();
  const reviewed = await inspectPunkActivation(wallet, gate(), "1798");
  assert.equal(reviewed.account, ACCOUNT);
  assert.equal(reviewed.activated, false);
  assert.equal(reviewed.transaction.to, REGISTRY);
  assert.equal(reviewed.transaction.value, "0x0");
  assert.equal(reviewed.transaction.data, `0xcab13915${(1798n).toString(16).padStart(64, "0")}`);
  const result = await submitPunkActivation(wallet, reviewed, gate(), () => true);
  assert.match(result.hash, /^0x[0-9a-f]{64}$/);
  const sends = wallet.calls.filter((call) => call.method === "eth_sendTransaction");
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].params, [reviewed.transaction]);
});

test("already activated accounts never request another transaction", async () => {
  const wallet = provider({ activated: true });
  const reviewed = await inspectPunkActivation(wallet, gate(), "1798");
  assert.equal(reviewed.activated, true);
  assert.equal(reviewed.transaction, null);
  assert.equal(wallet.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("wrong owner, wrong runtime, and changed review fail closed", async () => {
  await assert.rejects(inspectPunkActivation(provider({ owner: REGISTRY }), gate(), "1798"),
    (error) => error.code === "NOT_CURRENT_OWNER");
  const wrongCode = provider();
  const original = wrongCode.request.bind(wrongCode);
  wrongCode.request = async (request) => request.method === "eth_getCode"
    && request.params[0].toLowerCase() === IMPLEMENTATION ? "0x60ff" : original(request);
  await assert.rejects(inspectPunkActivation(wrongCode, gate(), "1798"),
    (error) => error.code === "CODE_MISMATCH");
  const wallet = provider();
  const reviewed = await inspectPunkActivation(wallet, gate(), "1798");
  await assert.rejects(submitPunkActivation(wallet, reviewed, gate(), () => false),
    (error) => error.code === "STATE_CHANGED");
});

test("legacy activation compatibility remains inert and is absent from the current broker UI", async () => {
  const source = await readFile(new URL("../site/account-activation.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../site/broker/index.html", import.meta.url), "utf8");
  const control = await readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8");
  assert.match(source, /createAccount/);
  assert.doesNotMatch(source, /privateKey|mnemonic|personal_sign|eth_sign|wallet_addEthereumChain/);
  assert.doesNotMatch(html, /data-account-activation|account-activation\.js/);
  assert.match(html, /Choose a Punk you own to activate its Art Broker/);
  assert.match(control, /data-control-activate/);
  assert.match(control, /Your Punk stays in your main wallet/);
});
