import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionResult, parseAbi } from "viem";

import {
  setupOwnerAccounts,
  validatedServerOwnedPunkIds,
  walletDiscoveryIntent,
} from "../site/owner-accounts.js";

const OWNER = "0x645cf432e829f9def6eb8e3974d3aee4580cbcdd";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const REGISTRY = "0xdca07046b4f95e79bbb421c97949473e75dffc65";
const PUNK_ACCOUNT = "0x1111111111111111111111111111111111111111";
const TOKEN_ID = "1738";
const MULTICALL_ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
]);

// The lightweight Broker page carries the verified launcher roster. Legacy pickers remain optional
// consumers of the same module on older routes, so this fixture exercises only the launcher surface.
const SINGLE = ["[data-owner-accounts]", "[data-ownership-state]"];
const MANY = [
  "[data-owned-punk-count]", "[data-owned-punk-detail]", "[data-punk-account-count]",
  "[data-punk-account-detail]", "[data-selected-punk-display]", "[data-selected-gallery-link]",
  "[data-punk-gallery-primary]", "[data-public-scout-token-display]",
];

class El {
  constructor(tag = "div", ownerDocument = null) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
  }

  get options() { return this.children; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  click() { return this.listeners.get("click")?.(); }
}

function word(value) { return BigInt(value).toString(16).padStart(64, "0"); }
const addressWord = (value) => `0x${value.slice(2).padStart(64, "0")}`;

// Resolves ownership for exactly one Punk. maxSupply is deliberately unavailable so the bounded
// wallet scan fails the way a wallet that will not serve it does, leaving the indexed candidate
// path — the same path the live site takes.
function punkProvider() {
  let multicallIndex = 0;
  const aggregate = (value) => encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    result: [[true, value]],
  });
  return {
    async request({ method, params }) {
      const [call] = params ?? [];
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const data = call?.data ?? "";
      if (data.startsWith("0xd5abeb01")) return "0x";
      if (data.startsWith("0x70a08231")) return `0x${word(1)}`;
      if (call?.to === "0xca11bde05977b3631167028862be2a173976ca11") {
        const field = multicallIndex % 3;
        multicallIndex += 1;
        if (field === 0) return aggregate(addressWord(OWNER));
        if (field === 1) return aggregate(addressWord(PUNK_ACCOUNT));
        return aggregate(`0x${0n.toString(16).padStart(64, "0")}`);
      }
      if (data.startsWith("0xc87b56dd")) return "0x";
      throw new Error(`unexpected call ${data.slice(0, 10)}`);
    },
  };
}

function ownerFixture({ provider = punkProvider(), ownerPayload = null } = {}) {
  const elements = new Map();
  const put = (selector, element) => {
    elements.set(selector, [...(elements.get(selector) ?? []), element]);
    return element;
  };
  const documentObject = {
    querySelector: (selector) => elements.get(selector)?.[0] ?? null,
    querySelectorAll: (selector) => elements.get(selector) ?? [],
    createElement: (tag) => new El(tag, documentObject),
  };
  for (const selector of SINGLE) put(selector, new El("div", documentObject));
  for (const selector of MANY) put(selector, new El("span", documentObject));

  const listeners = new Map();
  const announced = [];
  const timers = [];
  const windowObject = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    addEventListener(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      if (event.type === "gogh:owner-punks") announced.push(event.detail);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    __GOGH_WALLET_PROVIDER__: provider,
  };

  // Both API calls stay pending until the test releases them, which is what holds a scan in
  // flight while the next wallet frame arrives.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const payloads = {
    "/api/broker/account-activation-status": {
      ok: true,
      activationGate: {
        status: "READY_FOR_OWNER_ACTIVATION_CHECK",
        capability: true,
        reason: null,
        bindings: { chainId: 4663, punkCollection: COLLECTION, accountRegistry: REGISTRY },
      },
    },
    "/api/broker/owner-punks": ownerPayload ?? {
      ok: true, candidateTokenIds: [TOKEN_ID],
      candidatePunks: [{ tokenId: TOKEN_ID, artwork: null, rarity: null, automationConfigured: true }],
    },
  };
  const fetchFunction = async (url) => {
    await gate;
    const key = Object.keys(payloads).find((path) => url.startsWith(path));
    return { ok: true, json: async () => payloads[key] };
  };

  const walletState = (detail) => windowObject.dispatchEvent(
    Object.assign(new windowObject.CustomEvent("gogh:wallet-state", { detail }), {}),
  );
  return {
    windowObject, documentObject, fetchFunction, announced, timers, walletState,
    releaseApis: () => { release(); },
    element: (selector) => elements.get(selector)?.[0],
    setSnapshot: (detail) => { windowObject.__GOGH_WALLET_SNAPSHOT__ = detail; },
    runTimers: () => { const queued = timers.splice(0); for (const fn of queued) fn(); },
  };
}

const CONNECTED = Object.freeze({
  account: OWNER, chainId: 4663, owner: null, status: "owner", providerType: "reown-appkit",
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a wallet frame is classified by whether it can be acted on", () => {
  assert.equal(walletDiscoveryIntent(CONNECTED), "ready");
  assert.equal(walletDiscoveryIntent({ account: OWNER, chainId: 4663, status: "connected" }), "ready");
  // Mid-restore frames AppKit publishes before the session settles.
  assert.equal(walletDiscoveryIntent({ account: null, chainId: null, status: "pending" }), "transient");
  assert.equal(walletDiscoveryIntent({ account: OWNER, chainId: null, status: "wrong-network" }), "transient");
  assert.equal(walletDiscoveryIntent({ account: null, chainId: null, status: "unavailable" }), "transient");
  assert.equal(walletDiscoveryIntent({ account: null, chainId: null, status: "disconnected",
    restoring: true }), "transient");
  // Settled states that really should clear the roster.
  assert.equal(walletDiscoveryIntent({ account: null, chainId: null, status: "disconnected" }), "settled");
  assert.equal(walletDiscoveryIntent({ account: OWNER, chainId: 1, status: "wrong-network" }), "read-only");
  assert.equal(walletDiscoveryIntent(null), "settled");
});

function completeServerRoster(tokenId = "3111") {
  return {
    ok: true,
    chainId: 4663,
    collection: COLLECTION,
    owner: OWNER,
    complete: true,
    reconciliationState: "VERIFIED",
    balanceOf: 1,
    candidateTokenIds: [tokenId],
    candidatePunks: [{ tokenId, automationCreated: true, artwork: null }],
  };
}

test("complete server reconciliation keeps a Smart Wallet Punk visible after eth_call fails", async () => {
  const calls = [];
  const fixture = ownerFixture({
    provider: { request: async (call) => {
      calls.push(call);
      throw new Error("unsupported chain");
    } },
    ownerPayload: completeServerRoster(),
  });
  setupOwnerAccounts(fixture);
  fixture.setSnapshot(CONNECTED);
  fixture.walletState(CONNECTED);
  fixture.releaseApis();
  for (let tick = 0; tick < 16; tick += 1) await settle();

  const published = fixture.announced.at(-1);
  assert.deepEqual([...published.tokenIds], ["3111"]);
  assert.equal(published.punks[0].ownershipMode, "SERVER_VERIFIED_READ_ONLY");
  assert.equal(published.punks[0].transactionAuthorized, false);
  assert.equal(fixture.element("[data-ownership-state]").textContent,
    "SERVER VERIFIED · READ ONLY");
  assert.ok(calls.every(({ method }) => method === "eth_call"),
    "fallback must never invoke a transaction method");
});

test("unsupported connected network renders a complete server roster without touching provider", async () => {
  const calls = [];
  const fixture = ownerFixture({
    provider: { request: async (call) => { calls.push(call); throw new Error("must not run"); } },
    ownerPayload: completeServerRoster(),
  });
  setupOwnerAccounts(fixture);
  const wrongNetwork = { ...CONNECTED, chainId: 1, status: "wrong-network" };
  fixture.setSnapshot(wrongNetwork);
  fixture.walletState(wrongNetwork);
  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();

  assert.deepEqual([...fixture.announced.at(-1).tokenIds], ["3111"]);
  assert.equal(fixture.announced.at(-1).punks[0].transactionAuthorized, false);
  assert.equal(calls.length, 0);
});

test("unsupported connected network makes no ownership claim from incomplete server evidence", async () => {
  const calls = [];
  const fixture = ownerFixture({
    provider: { request: async (call) => { calls.push(call); throw new Error("must not run"); } },
    ownerPayload: { ...completeServerRoster(), complete: false, reconciliationState: "RPC_UNAVAILABLE" },
  });
  setupOwnerAccounts(fixture);
  const wrongNetwork = { ...CONNECTED, chainId: 1, status: "wrong-network" };
  fixture.setSnapshot(wrongNetwork);
  fixture.walletState(wrongNetwork);
  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();

  assert.deepEqual([...fixture.announced.at(-1).tokenIds], []);
  assert.equal(fixture.element("[data-ownership-state]").textContent, "RPC UNAVAILABLE");
  assert.equal(fixture.element("[data-owner-accounts]").children.length, 0);
  assert.equal(calls.length, 0);
});

test("server ownership evidence rejects incomplete and mismatched claims", () => {
  const valid = completeServerRoster();
  assert.deepEqual([...validatedServerOwnedPunkIds(valid, {
    owner: OWNER, collection: COLLECTION,
  })], ["3111"]);
  for (const changed of [
    { complete: false },
    { reconciliationState: "RPC_UNAVAILABLE" },
    { owner: REGISTRY },
    { chainId: 1 },
    { collection: REGISTRY },
    { balanceOf: 2 },
    { candidateTokenIds: ["3111", "3111"] },
  ]) {
    assert.throws(() => validatedServerOwnedPunkIds({ ...valid, ...changed }, {
      owner: OWNER, collection: COLLECTION,
    }), /evidence|roster/);
  }
});

test("a reconnect frame never cancels the scan already running for that owner", async () => {
  const fixture = ownerFixture();
  setupOwnerAccounts(fixture);
  fixture.setSnapshot(CONNECTED);
  fixture.walletState(CONNECTED);
  await settle();

  // The session republishes an intermediate frame while the scan is still awaiting its APIs.
  fixture.walletState({ account: null, chainId: null, status: "pending" });
  fixture.walletState({ account: OWNER, chainId: null, status: "wrong-network" });
  await settle();

  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();

  const final = fixture.announced.at(-1);
  assert.deepEqual([...final.tokenIds], [TOKEN_ID],
    "the completed scan must still publish the owner's Punk");
  assert.equal(final.owner, OWNER);
  assert.equal(fixture.element("[data-owned-punk-count]").textContent, "1");
  assert.equal(fixture.element("[data-owned-punk-detail]").textContent,
    "Canonical balance and indexed ownership agree.");
  assert.equal(fixture.element("[data-owner-accounts]").children.length, 1);
});

test("a settled disconnect still clears the roster", async () => {
  const fixture = ownerFixture();
  setupOwnerAccounts(fixture);
  fixture.setSnapshot(CONNECTED);
  fixture.walletState(CONNECTED);
  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();
  assert.deepEqual([...fixture.announced.at(-1).tokenIds], [TOKEN_ID]);

  fixture.setSnapshot(null);
  fixture.walletState({ account: null, chainId: null, status: "disconnected" });
  await settle();
  const cleared = fixture.announced.at(-1);
  assert.deepEqual([...cleared.tokenIds], []);
  assert.equal(cleared.owner, null);
  assert.equal(fixture.element("[data-owned-punk-count]").textContent, "—");
});

test("a failed refresh preserves the last live-verified Punk roster", async () => {
  const fixture = ownerFixture();
  setupOwnerAccounts(fixture);
  fixture.setSnapshot(CONNECTED);
  fixture.walletState(CONNECTED);
  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();
  assert.deepEqual([...fixture.announced.at(-1).tokenIds], [TOKEN_ID]);

  fixture.windowObject.__GOGH_WALLET_PROVIDER__ = {
    request: async () => { throw new Error("temporary provider reconnect"); },
  };
  fixture.walletState(CONNECTED);
  for (let tick = 0; tick < 12; tick += 1) await settle();

  assert.deepEqual([...fixture.announced.at(-1).tokenIds], [TOKEN_ID],
    "a temporary refresh failure must not publish an empty replacement roster");
  assert.equal(fixture.element("[data-owned-punk-count]").textContent, "1");
  assert.match(fixture.element("[data-owned-punk-detail]").textContent, /refresh retrying/i);
  assert.equal(fixture.element("[data-owner-accounts]").children.length, 1);
});

test("a settled snapshot that arrives without an event of its own is picked up", async () => {
  const fixture = ownerFixture();
  setupOwnerAccounts(fixture);
  // Nothing is connected yet, so the initial pass clears and arms a re-check.
  fixture.walletState({ account: null, chainId: null, status: "disconnected" });
  await settle();
  assert.deepEqual([...fixture.announced.at(-1).tokenIds], []);

  // The restore completes but publishes no further wallet event.
  fixture.setSnapshot(CONNECTED);
  fixture.runTimers();
  fixture.releaseApis();
  for (let tick = 0; tick < 12; tick += 1) await settle();
  assert.deepEqual([...fixture.announced.at(-1).tokenIds], [TOKEN_ID],
    "the armed re-check must recover the settled wallet");
});
