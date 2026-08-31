import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { walletConfiguration } from "../netlify/functions/broker-wallet-config.mjs";
import {
  setupReownWallet,
  walletErrorMessage,
} from "../site/wallet.js";
import {
  agentRosterPunks, safeWizardState, wizardResumeStep,
} from "../site/agent-setup-wizard.js";

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
  const disconnectButton = new Element();
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
  const sessionStorage = new Map();
  const dispatched = [];
  const session = {
    open: async () => { calls.push("open"); },
    openAccount: async () => { calls.push("account"); },
    close: async () => { calls.push("close"); },
    ready: async () => {},
    disconnect: async () => { calls.push("disconnect"); },
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
    setTimeout,
    clearTimeout,
    localStorage: {
      get length() { return storage.size; },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: {
      get length() { return sessionStorage.size; },
      key: (index) => [...sessionStorage.keys()][index] ?? null,
      getItem: (key) => sessionStorage.get(key) ?? null,
      setItem: (key, value) => sessionStorage.set(key, String(value)),
      removeItem: (key) => sessionStorage.delete(key),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name) { windowListeners.delete(name); },
    dispatchEvent(event) { dispatched.push(event); },
  };
  const documentObject = {
    visibilityState: "visible",
    querySelectorAll(selector) {
      if (selector === "[data-wallet-connect]") return [button];
      if (selector === "[data-wallet-switch]") return [switchButton];
      if (selector === "[data-wallet-disconnect]") return [disconnectButton];
      if (selector === "[data-wallet-state]") return [status];
      return [];
    },
    addEventListener(name, listener) { documentListeners.set(name, listener); },
  };
  return { button, switchButton, disconnectButton, status, callbacks, calls, current,
    session, storage, sessionStorage, dispatched, windowObject, documentObject,
    windowListeners, documentListeners };
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.button.textContent, "0x1234…7890");
  assert.match(fixture.status.textContent, /Connected · 0x1234…7890 · Robinhood Chain/);

  fixture.current.chainId = 1;
  fixture.callbacks.network({ chainId: 1 });
  assert.equal(fixture.switchButton.hidden, false);
  await fixture.switchButton.click();
  assert.deepEqual(fixture.calls, ["open", "close", "switch"]);

  fixture.current.provider = null;
  fixture.callbacks.provider(null);
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, PROVIDER,
    "a connected account keeps its last working provider through a transient provider gap");
  fixture.current.error = "WalletConnect session expired";
  fixture.callbacks.state({});
  assert.match(fixture.status.textContent, /session expired/i);

  fixture.current.account = { address: undefined, isConnected: false, status: "disconnected" };
  fixture.callbacks.account(fixture.current.account);
  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, null,
    "a settled disconnect still clears the provider");
  assert.equal(fixture.storage.get("gogh.wallet.reown.returning.v1"), "1",
    "an SDK disconnect frame must not erase cross-page restoration intent");

  fixture.current.provider = PROVIDER;
  fixture.current.chainId = 4663;
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.windowListeners.get("pageshow")();
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  controller.destroy();
});

test("a known prior Reown session restores immediately without opening a wallet prompt", async () => {
  const fixture = reownFixture();
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.storage.set("gogh.wallet.reown.returning.v1", "1");
  let queuedCallback;
  fixture.windowObject.queueMicrotask = (callback) => { queuedCallback = callback; };
  let factoryCalls = 0;
  await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => { factoryCalls += 1; return fixture.session; },
  });
  assert.equal(factoryCalls, 0);
  assert.equal(typeof queuedCallback, "function");
  await queuedCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(factoryCalls, 1);
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  assert.deepEqual(fixture.calls, ["close"], "restoration closes stale UI without opening a selector");
});

test("desktop restoration waits for AppKit before reading its restored account", async () => {
  const fixture = reownFixture();
  fixture.storage.set("gogh.wallet.reown.returning.v1", "1");
  let queuedCallback;
  let finishReady;
  fixture.session.ready = () => new Promise((resolve) => { finishReady = resolve; });
  fixture.windowObject.queueMicrotask = (callback) => { queuedCallback = callback; };
  const controller = await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
    restoreProbeDelaysMs: [],
  });
  await queuedCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, null);

  // Desktop AppKit can restore its injected provider before this page subscribes to
  // account events. The post-ready snapshot must therefore be authoritative.
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  finishReady();
  await controller.ensureSession();
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, PROVIDER);
  assert.deepEqual(fixture.calls, ["close"]);
  controller.destroy();
});

test("a stalled AppKit ready promise cannot leave desktop wallet preparation hanging", async () => {
  const fixture = reownFixture();
  fixture.storage.set("gogh.wallet.reown.returning.v1", "1");
  let queuedCallback;
  fixture.session.ready = () => new Promise(() => {});
  fixture.windowObject.queueMicrotask = (callback) => { queuedCallback = callback; };
  const controller = await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
    sessionReadyTimeoutMs: 5,
    restoreProbeDelaysMs: [],
  });
  queuedCallback();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await controller.ensureSession();

  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.restoring, false);

  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  fixture.callbacks.account(fixture.current.account);
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER,
    "a late desktop account event still restores the session after the ready timeout");
  controller.destroy();
});

test("a stale Reown reconnect stops visibly connecting without forgetting the cross-page session", async () => {
  const fixture = reownFixture();
  fixture.storage.set("gogh.wallet.reown.returning.v1", "1");
  let queuedCallback;
  fixture.windowObject.queueMicrotask = (callback) => { queuedCallback = callback; };
  await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
    connectionTimeoutMs: 5,
    restoreProbeDelaysMs: [],
  });
  await queuedCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.callbacks.account({ address: undefined, isConnected: false, status: "reconnecting" });
  assert.equal(fixture.button.textContent, "Connecting…");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.match(fixture.status.textContent, /restoration timed out/i);
  assert.equal(fixture.storage.get("gogh.wallet.reown.returning.v1"), "1",
    "a page timeout must not turn a still-restorable wallet into a first-time visit");
  assert.ok(fixture.calls.includes("close"));
});

test("a transient Reown reconnect preserves the connected account and Disconnect control", async () => {
  const fixture = reownFixture();
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  const controller = await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
  });
  await controller.ensureSession();
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER);
  assert.equal(fixture.disconnectButton.hidden, false);

  fixture.current.account = { address: undefined, isConnected: false, status: "reconnecting" };
  fixture.callbacks.account(fixture.current.account);
  fixture.callbacks.provider(null);
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER,
    "a reconnect frame must not erase the last settled account");
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, PROVIDER,
    "a temporary missing provider must not invalidate the whole page");
  assert.equal(fixture.disconnectButton.hidden, false);

  fixture.windowListeners.get("pageshow")();
  assert.equal(fixture.windowObject.__GOGH_WALLET_SNAPSHOT__.account, OWNER,
    "an incomplete pageshow snapshot must remain advisory");
  controller.destroy();
});

test("a wallet modal that does not settle times out and can be retried", async () => {
  const fixture = reownFixture();
  fixture.session.open = () => new Promise(() => {});
  await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
    connectionTimeoutMs: 5,
  });
  await fixture.button.click();
  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.match(fixture.status.textContent, /did not respond in time/i);
  assert.ok(fixture.calls.includes("close"));
});

test("disconnect clears only wallet-scoped state and prevents stale Punk controls", async () => {
  const fixture = reownFixture();
  fixture.current.account = { address: OWNER, isConnected: true, status: "connected" };
  for (const key of ["gogh.wallet.reown.returning.v1", "gogh.artBroker.setup.v1",
    "gogh:activated-punk-ids:v1", "gogh.controlCenter.v2",
    `gogh.controlCenter.v2:${OWNER}:93`]) {
    fixture.storage.set(key, "wallet-data");
    fixture.sessionStorage.set(key, "wallet-data");
  }
  fixture.storage.set("gogh.global.metadata", "keep");
  const controller = await setupReownWallet({
    windowObject: fixture.windowObject, documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
  });
  await controller.ensureSession();
  assert.equal(fixture.disconnectButton.hidden, false);
  assert.equal(fixture.disconnectButton.textContent, "Disconnect Wallet");
  await fixture.button.click();
  assert.equal(fixture.calls.at(-1), "account", "connected button opens account menu");
  await fixture.disconnectButton.click();
  assert.equal(fixture.calls.at(-1), "disconnect");
  assert.equal(fixture.button.textContent, "Connect wallet");
  assert.equal(fixture.disconnectButton.hidden, true);
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, null);
  assert.equal(fixture.storage.get("gogh.global.metadata"), "keep");
  assert.equal(fixture.windowObject.__GOGH_OWNER_PUNKS__.punks.length, 0);
  for (const key of ["gogh.wallet.reown.returning.v1", "gogh.artBroker.setup.v1",
    "gogh:activated-punk-ids:v1", "gogh.controlCenter.v2",
    `gogh.controlCenter.v2:${OWNER}:93`]) {
    assert.equal(fixture.storage.has(key), false);
    assert.equal(fixture.sessionStorage.has(key), false);
  }
  assert.ok(fixture.dispatched.some(({ type }) => type === "gogh:wallet-disconnected"));
  controller.destroy();
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

test("active-agent roster includes every created or configured V3 Punk without calling them live", () => {
  const visible = agentRosterPunks([
    { tokenId: "93", activated: true, automationConfigured: false },
    { tokenId: "94", activated: false, automationConfigured: true },
    { tokenId: "95", activated: false, automationConfigured: false, automationCreated: true },
    { tokenId: "96", activated: false, automationConfigured: false },
  ]);
  assert.deepEqual(visible.map(({ tokenId }) => tokenId), ["93", "94", "95"]);
});

test("every wallet-enabled page restores the one Reown session and exposes disconnect", async () => {
  const pages = await Promise.all([
    "../site/broker/index.html",
    "../site/broker/punk/index.html",
    "../site/punk/index.html",
    "../site/discover/index.html",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const page of pages) {
    assert.match(page, /\/wallet\.js\?v=reown-8/);
    assert.match(page, /data-wallet-connect/);
    assert.match(page, /data-wallet-disconnect/);
    assert.match(page, /Disconnect(?: Wallet)?/);
  }
});

test("mobile Punk launcher and activation flow bind the required production experience", async () => {
  const [launcher, html, css, client, wallet, packageJson, netlify] = await Promise.all([
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
    readFile(new URL("../client/reown-wallet-app.js", import.meta.url), "utf8"),
    readFile(new URL("../site/wallet.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  ]);
  for (const copy of ["Punk Control Center", "Activate Art Broker", "Daily mint limit",
    "Authorization duration", "Activate Art Broker", "Agent", "NFTs", "Activity"]) {
    assert.match(html, new RegExp(copy));
  }
  assert.match(launcher, /Turn your Gogh Punk into an autonomous art collector/);
  assert.match(launcher, /data-owner-accounts/);
  assert.match(html, /data-control-activation-cap/);
  assert.match(html, /data-control-activation-days/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(client, /caipNetworkId: "eip155:4663"/);
  assert.match(client, /new EthersAdapter\(\)/);
  assert.match(client, /ready: \(\) => appKit\.ready\(\)/);
  assert.match(client, /appKit\.getWalletProvider\(\)/);
  assert.match(client, /close: \(\) => appKit\.close\(\)/);
  assert.doesNotMatch(client, /appKit\.getProviders\(\)/);
  assert.doesNotMatch(client, /projectId:\s*["'][0-9a-f]{32}/);
  assert.doesNotMatch(wallet, /setupReadOnlyWallet\(\{ windowObject: window/);
  assert.match(wallet, /First-time visitors load no AppKit code/);
  assert.match(html, /\/wallet\.js\?v=reown-8/);
  assert.match(wallet, /\/reown-wallet-app\.js\?v=reown-8/);
  assert.match(packageJson, /@reown\/appkit/);
  assert.match(netlify, /wss:\/\/relay\.walletconnect\.com/);
  assert.match(netlify, /script-src 'self'; style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(netlify, /script-src[^;]*'unsafe-inline'/);
});

test("partial AppKit initialization never opens a misleading wallet modal", async () => {
  const fixture = reownFixture();
  fixture.session.getProvider = () => {
    throw new TypeError("unsupported provider accessor");
  };
  await setupReownWallet({
    windowObject: fixture.windowObject,
    documentObject: fixture.documentObject,
    sessionFactory: () => fixture.session,
  });

  await fixture.button.click();
  assert.deepEqual(fixture.calls, [], "a partially initialized session must never open");
  assert.equal(fixture.button.textContent, "Wallet unavailable");
  assert.equal(fixture.windowObject.__GOGH_WALLET_PROVIDER__, null);
});
