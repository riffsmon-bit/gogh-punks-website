import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { walletConfiguration } from "../netlify/functions/broker-wallet-config.mjs";
import {
  setupReownWallet,
  walletErrorMessage,
} from "../site/wallet.js";
import { safeWizardState, wizardResumeStep } from "../site/agent-setup-wizard.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const PROVIDER = Object.freeze({ request: async () => null });

class Element {
  constructor() {
    this.listeners = new Map(); this.dataset = {}; this.textContent = "";
    this.disabled = false; this.hidden = false; this.title = "";
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute(name, value) { this[name] = value; }
  click() { return this.listeners.get("click")?.(); }
}

function reownFixture() {
  const button = new Element();
  const switchButton = new Element();
  const status = new Element();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const callbacks = {};
  const current = {
    account: { address: undefined, isConnected: false, status: "disconnected" },
    chainId: 4663,
    provider: PROVIDER,
    error: "",
  };
  const calls = [];
  const storage = new Map();
  const session = {
    open: async () => { calls.push("open"); },
    switchNetwork: async () => { calls.push("switch"); },
    getAccount: () => current.account,
    getNetwork: () => ({ chainId: current.chainId }),
    getProvider: () => current.provider,
    getError: () => current.error,
    subscribeAccount(callback) { callbacks.account = callback; return () => {}; },
    subscribeNetwork(callback) { callbacks.network = callback; return () => {}; },
    subscribeProvider(callback) { callbacks.provider = callback; return () => {}; },
    subscribeState(callback) { callbacks.state = callback; return () => {}; },
  };
  const windowObject = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name) { windowListeners.delete(name); },
    dispatchEvent() {},
  };
  const documentObject = {
    visibilityState: "visible",
    querySelectorAll(selector) {
      if (selector === "[data-wallet-connect]") return [button];
      if (selector === "[data-wallet-switch]") return [switchButton];
      if (selector === "[data-wallet-state]") return [status];
      return [];
    },
    addEventListener(name, listener) { documentListeners.set(name, listener); },
  };
  return { button, switchButton, status, callbacks, calls, current, session, storage,
    windowObject, documentObject, windowListeners, documentListeners };
}

test("Reown runtime config is environment-only and fail-closed", () => {
  assert.deepEqual(walletConfiguration({}, "https://goghpunks.xyz"), {
    configured: false, projectId: null, metadataUrl: null,
    reason: "REOWN_PROJECT_ID_NOT_CONFIGURED",
  });
  const configured = walletConfiguration({
    NEXT_PUBLIC_REOWN_PROJECT_ID: "a".repeat(32),
  }, "https://goghpunks.xyz");
  assert.equal(configured.configured, true);
  assert.equal(configured.projectId, "a".repeat(32));
  assert.equal(configured.metadataUrl, "https://goghpunks.xyz");
  assert.equal(walletConfiguration({ NEXT_PUBLIC_REOWN_PROJECT_ID: "secret" }).configured, false);
});

test("Reown is the authoritative reconnecting wallet and provider session", async () => {
  const fixture = reownFixture();
  let factoryCalls = 0;
  const controller = await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => { factoryCalls += 1; return fixture.session; },
  });
  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, null);
  assert.equal(factoryCalls, 0, "AppKit must remain unloaded until Connect is selected");
  await fixture.button.click();
  assert.equal(factoryCalls, 1);
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, PROVIDER);
  assert.deepEqual(fixture.calls, ["open"]);

  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.callbacks.account(fixture.current.account);
  assert.equal(fixture.button.textContent, "0x1234…7890");
  assert.match(fixture.status.textContent, /Connected · 0x1234…7890 · Robinhood Chain/);

  fixture.current.chainId = 1;
  fixture.callbacks.network({ chainId: 1 });
  assert.equal(fixture.switchButton.hidden, false);
  await fixture.switchButton.click();
  assert.deepEqual(fixture.calls, ["open", "switch"]);

  fixture.current.provider = null;
  fixture.callbacks.provider(null);
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, null);
  fixture.current.error = "WalletConnect session expired";
  fixture.callbacks.state({});
  assert.match(fixture.status.textContent, /session expired/i);

  fixture.current.account = { address: undefined, isConnected: false, status: "disconnected" };
  fixture.callbacks.account(fixture.current.account);
  assert.equal(fixture.button.textContent, "Connect wallet");

  fixture.current.provider = PROVIDER;
  fixture.current.chainId = 4663;
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.windowListeners.get("pageshow")();
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  controller.destroy();
});

test("a known prior Reown session restores idly without opening a wallet prompt", async () => {
  const fixture = reownFixture();
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.storage.set("gogh.wallet.reown.returning.v1", "1");
  let idleCallback;
  fixture.windowObject.requestIdleCallback = (callback) => { idleCallback = callback; };
  let factoryCalls = 0;
  await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => { factoryCalls += 1; return fixture.session; },
  });
  assert.equal(factoryCalls, 0);
  assert.equal(fixture.button.textContent, "Connect wallet");
  await idleCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(factoryCalls, 1);
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  assert.deepEqual(fixture.calls, [], "restoration must not open a wallet selector");
});

test("wallet failures are plain-language across mobile rejection, timeout, and expiry", () => {
  assert.match(walletErrorMessage({ code: 4001 }), /cancelled/i);
  assert.match(walletErrorMessage({ code: 4001 }, "switch"), /not selected/i);
  assert.match(walletErrorMessage({ message: "QR request timed out" }), /did not respond/i);
  assert.match(walletErrorMessage({ message: "session expired" }), /session expired/i);
  assert.match(walletErrorMessage({ code: "APKT002" }), /not enabled for this site/i);
  assert.match(walletErrorMessage({ code: "APKT001" }), /Robinhood Chain is not available/i);
  assert.doesNotMatch(walletErrorMessage(new Error("provider raw stack 0xdead")), /0xdead/);
});

test("wizard persistence is bounded and resumes from authoritative state", () => {
  assert.deepEqual(safeWizardState({
    selectedPunk: "93", step: "activation", dailyLimit: 999, durationDays: "7",
  }), { selectedPunk: "93", step: "choose", dailyLimit: 3, durationDays: 7 });
  assert.deepEqual(safeWizardState({
    selectedPunk: "93", step: "limits", dailyLimit: 2, durationDays: 6,
  }), { selectedPunk: "93", step: "limits", dailyLimit: 2, durationDays: 6 });
  assert.equal(wizardResumeStep({ selectedPunk: null }), "choose");
  assert.equal(wizardResumeStep({ selectedPunk: "93", automation: null }), "wallet");
  assert.equal(wizardResumeStep({ selectedPunk: "93", automation: { tokenId: "93", active: false } }), "limits");
  assert.equal(wizardResumeStep({ selectedPunk: "93", automation: { tokenId: "93", active: true } }), "power");
  assert.equal(wizardResumeStep({
    selectedPunk: "93", hostedGasReady: true,
    automation: { tokenId: "93", active: true, agentLive: true },
  }), "success");
});

test("mobile wizard and AppKit source bind the required production experience", async () => {
  const [html, css, client, wallet, packageJson, netlify] = await Promise.all([
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
    readFile(new URL("../client/reown-wallet-app.js", import.meta.url), "utf8"),
    readFile(new URL("../site/wallet.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  ]);
  for (const copy of ["Choose Your Punk", "Your Punk Gets Its Own Wallet", "Set the Rules",
    "Activate Your Art Broker", "Power Up Your Agent", "Send Agent", "Activate Another Punk",
    "Your Active Agents"]) {
    assert.match(html, new RegExp(copy));
  }
  assert.match(html, /data-wizard-step="choose"/);
  assert.match(html, /data-wizard-step="success"/);
  assert.match(html, /Custom daily limit \(1–10\)/);
  assert.match(html, /Custom run time \(1–30 days\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(client, /caipNetworkId: "eip155:4663"/);
  assert.match(client, /new EthersAdapter\(\)/);
  assert.doesNotMatch(client, /projectId:\s*["'][0-9a-f]{32}/);
  assert.doesNotMatch(wallet, /setupReadOnlyWallet\(\{ windowObject: window/);
  assert.match(wallet, /First-time visitors load no AppKit code/);
  assert.match(packageJson, /@reown\/appkit/);
  assert.match(netlify, /wss:\/\/relay\.walletconnect\.com/);
});
