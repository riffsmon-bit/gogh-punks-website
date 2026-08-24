import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ROBINHOOD_CHAIN_ID,
  normalizeWalletAddress,
  parseWalletChainId,
  setupReadOnlyWallet,
  walletPresentation,
} from "../site/wallet.js";

const OWNER = "0x1234567890123456789012345678901234567890";

test("wallet values are strictly normalized for Robinhood Chain", () => {
  assert.equal(ROBINHOOD_CHAIN_ID, 4663);
  assert.equal(parseWalletChainId("0x1237"), 4663);
  assert.equal(parseWalletChainId("4663"), null);
  assert.equal(parseWalletChainId("0xnothex"), null);
  assert.equal(normalizeWalletAddress(OWNER.toUpperCase().replace("0X", "0x")), OWNER);
  assert.equal(normalizeWalletAddress(`${OWNER}00`), null);
});

test("wallet presentation follows the selected Punk instead of a hosted default", () => {
  const owner = { address: OWNER, tokenId: "4242" };
  const verified = walletPresentation({
    available: true,
    pending: false,
    account: OWNER,
    chainId: 4663,
    owner,
  });
  assert.equal(verified.state, "owner");
  assert.match(verified.statusText, /Punk #4242 selected/);
  assert.match(verified.statusText, /live ownership verified/);

  const viewer = walletPresentation({
    available: true,
    pending: false,
    account: "0x1111111111111111111111111111111111111111",
    chainId: 4663,
    owner,
  });
  assert.equal(viewer.state, "viewer");
  assert.match(viewer.statusText, /not its current holder/);

  const wrongNetwork = walletPresentation({
    available: true,
    pending: false,
    account: OWNER,
    chainId: 1,
    owner,
  });
  assert.equal(wrongNetwork.state, "wrong-network");
  assert.match(wrongNetwork.statusText, /select Robinhood Chain \(4663\)/);
});

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.textContent = "";
    this.title = "";
    this.disabled = false;
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { return this.listeners.get("click")?.(); }
}

test("provider access begins only after a click and remains read-only", async () => {
  const calls = [];
  const providerListeners = new Map();
  const provider = {
    async request({ method }) {
      calls.push(method);
      if (method === "eth_requestAccounts") return [OWNER];
      if (method === "eth_chainId") return "0x1237";
      throw new Error("unexpected provider method");
    },
    on(type, listener) { providerListeners.set(type, listener); },
    removeListener(type) { providerListeners.delete(type); },
  };
  const button = new FakeElement();
  const status = new FakeElement();
  const windowListeners = new Map();
  const windowObject = {
    ethereum: provider,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const documentObject = {
    querySelectorAll(selector) {
      if (selector === "[data-wallet-connect]") return [button];
      if (selector === "[data-wallet-state]") return [status];
      return [];
    },
  };

  const controller = setupReadOnlyWallet({ windowObject, documentObject });
  assert.deepEqual(calls, []);
  assert.equal(button.textContent, "Connect wallet");

  windowListeners.get("gogh:owner-snapshot")({
    detail: { address: OWNER, tokenId: "4242", source: "punk" },
  });
  await button.click();
  assert.deepEqual(calls, ["eth_requestAccounts", "eth_chainId"]);
  assert.equal(button.dataset.walletStatus, "owner");
  assert.match(status.textContent, /Punk #4242 selected/);

  windowListeners.get("gogh:punk-selected")({
    detail: { owner: OWNER, tokenId: "93" },
  });
  assert.match(status.textContent, /Punk #93 selected/);

  providerListeners.get("chainChanged")("0x1");
  assert.equal(button.dataset.walletStatus, "wrong-network");
  providerListeners.get("accountsChanged")([]);
  assert.equal(button.dataset.walletStatus, "disconnected");
  assert.equal(button.disabled, false);
  controller.destroy();
});

test("browser wallet code contains no signing, switching, approval, or transaction request", async () => {
  const source = await readFile(new URL("../site/wallet.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /eth_sendTransaction|eth_sign|personal_sign|wallet_switchEthereumChain|wallet_addEthereumChain|wallet_requestPermissions/,
  );
  assert.match(source, /method: "eth_requestAccounts"/);
  assert.match(source, /method: "eth_chainId"/);
});
