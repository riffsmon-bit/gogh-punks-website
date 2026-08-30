import assert from "node:assert/strict";
import test from "node:test";

import {
  agentCardPresentation, agentRotationCountdown, forwardOnlyWizardStep, setupAgentWizard,
  wizardStepIndex,
} from "../site/agent-setup-wizard.js";
import { automationSnapshotStats } from "../site/autonomous-minting.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const PUNK_WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const VALID_UNTIL = "1790000000";
const STORAGE_KEY = "gogh.artBroker.setup.v1";

const WIZARD_STEPS = ["choose", "wallet", "limits", "activate", "power", "success"];
const SINGLE = [
  "[data-wizard-punks]", "[data-wizard-empty]", "[data-wizard-state]", "[data-wizard-activate]",
  "[data-wizard-retirement]", "[data-wizard-fund]", "[data-wizard-send]",
  "[data-wizard-gas-status]", "[data-wizard-transaction]", "[data-wizard-custom-cap]",
  "[data-wizard-custom-days]", "[data-wizard-gas-amount]", "[data-wizard-watch]",
  "[data-wizard-portfolio]", "[data-wizard-another]", "[data-wizard-exit]",
  "[data-wizard-custom-cap-toggle]", "[data-wizard-custom-days-toggle]",
];
const MULTIPLE = [
  "[data-wizard-punk-image]", "[data-wizard-punk-label]", "[data-wizard-punk-wallet]",
  "[data-wizard-summary-cap]", "[data-wizard-summary-days]", "[data-wizard-cap]",
  "[data-wizard-days]", "[data-wizard-back]",
];
// The advanced automation panel the wizard drives by proxy.
const ADVANCED = [
  "[data-v2-cap]", "[data-v2-days]", "[data-retirement-confirm]", "[data-v2-setup]",
  "[data-v2-agent-fund-confirm]", "[data-v2-agent-fund-amount]", "[data-v2-agent-fund]",
  "[data-v3-run-now]", "[data-advanced-workspace]", "#automation-title", "#nft-portfolio-title",
];

class El {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.classes = new Set();
    this.clicks = 0;
    this.textContent = "";
    this.value = "";
    this.title = "";
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.classList = {
      toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); },
      contains: (name) => this.classes.has(name),
    };
  }

  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  dispatchEvent(event) { return this.listeners.get(event.type)?.(event); }
  focus() {}
  scrollIntoView() {}
  click() { this.clicks += 1; return this.listeners.get("click")?.(); }
}

function wizardFixture({ stored = null, punks = [], automation = null, wallet = true,
  fetchFunction = null } = {}) {
  const elements = new Map();
  const put = (selector, element) => {
    elements.set(selector, [...(elements.get(selector) ?? []), element]);
    return element;
  };
  for (const selector of SINGLE) put(selector, new El());
  for (const selector of MULTIPLE) { put(selector, new El()); put(selector, new El()); }
  for (const selector of ADVANCED) put(selector, new El());
  const screens = WIZARD_STEPS.map((step) => {
    const screen = new El("article");
    screen.dataset.wizardStep = step;
    return put("[data-wizard-step]", screen);
  });
  for (const index of ["1", "2", "3", "4", "5"]) {
    const item = new El("li");
    item.dataset.wizardProgress = index;
    put("[data-wizard-progress]", item);
  }
  // Only the "wallet" and "limits" screens carry a forward button in the shipped markup.
  for (const next of ["limits", "activate"]) {
    const button = new El("button");
    button.dataset.wizardNext = next;
    put("[data-wizard-next]", button);
  }
  const query = (selector) => elements.get(selector)?.[0] ?? null;
  const queryAll = (selector) => elements.get(selector) ?? [];
  const root = new El("section");
  root.querySelector = query;
  root.querySelectorAll = queryAll;

  const storage = new Map();
  if (stored) storage.set(STORAGE_KEY, JSON.stringify(stored));
  const listeners = new Map();
  const dispatched = [];
  const windowObject = {
    location: { assigned: [], assign(value) { this.assigned.push(value); } },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    dispatchEvent(event) { dispatched.push(event); },
    __GOGH_WALLET_SNAPSHOT__: wallet ? { account: OWNER, chainId: 4663 } : null,
    __GOGH_OWNER_PUNKS__: { punks },
    __GOGH_AUTOMATION_SNAPSHOT__: automation,
  };
  const documentObject = {
    visibilityState: "visible",
    querySelector: (selector) => (selector === "[data-agent-wizard]" ? root : query(selector)),
    querySelectorAll: queryAll,
    createElement: (tag) => new El(tag),
    addEventListener() {},
  };
  put("[data-active-agent-grid]", new El());
  put("[data-active-agent-empty]", new El());
  return {
    root, screens, windowObject, documentObject, listeners, dispatched, storage, fetchFunction,
    element: query,
    elements: queryAll,
    step: () => screens.find((screen) => !screen.hidden)?.dataset.wizardStep ?? null,
    choosePunk: (tokenId) => {
      const picker = query("[data-wizard-punks]");
      picker.value = tokenId;
      return picker.dispatchEvent({ type: "change" });
    },
    next: (step) => queryAll("[data-wizard-next]")
      .find((button) => button.dataset.wizardNext === step),
    automationState: (detail) => listeners.get("gogh:automation-state")?.({ detail }),
  };
}

function agentCardFacts(fixture, index = 0) {
  const card = fixture.element("[data-active-agent-grid]").children[index];
  const facts = card.children[1].children[2].children;
  const entries = {};
  for (let position = 0; position < facts.length; position += 2) {
    entries[facts[position].textContent] = facts[position + 1].textContent;
  }
  return entries;
}

function agentCardActions(fixture, index = 0) {
  const card = fixture.element("[data-active-agent-grid]").children[index];
  const actions = card.children[2].children;
  return [...actions].map(({ textContent, href }) => ({ textContent, href }));
}

const ACTIVE_PUNK = Object.freeze({
  tokenId: "93", activated: true, account: PUNK_WALLET, automationConfigured: true,
  agentSummary: Object.freeze({
    status: "IDLE", reason: "NO_ELIGIBLE_TARGETS", enrolled: true,
    lastActualScan: "2026-08-29T12:00:00.000Z",
  }),
});

// The shape `readAutomationV3PunkState` publishes: the authorization expiry is nested, never flat.
const LIVE_STATE = Object.freeze({
  tokenId: "93", account: PUNK_WALLET, created: true, active: true,
  maxAcquisitionsPerDay: 3, acquisitionsToday: 1,
  authorization: Object.freeze({
    active: true, authorizingOwner: OWNER, validUntil: VALID_UNTIL,
    generation: "1", effective: true,
  }),
});

// Built exactly the way the automation panel builds the snapshot it broadcasts to the wizard, so
// these cases bind the producer and the consumer together rather than restating one of them.
function automationFor(livePunkState, overrides = {}) {
  return {
    tokenId: livePunkState.tokenId,
    account: livePunkState.account,
    active: livePunkState.active === true,
    agentLive: false,
    version: 3,
    running: false,
    setupSubmission: null,
    lastActionError: null,
    lastTransactionHash: null,
    hostedGas: null,
    heartbeat: null,
    ...automationSnapshotStats(livePunkState),
    ...overrides,
  };
}

const activeAutomation = (overrides = {}) => automationFor(LIVE_STATE, overrides);

test("a stored setup step never re-offers activation for an authorized agent", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "activate", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK],
    automation: activeAutomation(),
  });
  setupAgentWizard(fixture);
  assert.equal(fixture.step(), "power", "an active agent must resume past every setup screen");
  assert.equal(fixture.element("[data-wizard-activate]").disabled, true);
  assert.equal(fixture.element("[data-wizard-activate]").textContent, "Agent already active");
  assert.equal(fixture.element("[data-wizard-retirement]").disabled, true);
});

test("a late live snapshot cannot leave an authorized agent on the activation screen", () => {
  const fixture = wizardFixture({ punks: [ACTIVE_PUNK] });
  setupAgentWizard(fixture);
  // The status round trip has not answered yet, so the owner walks the setup screens freely.
  fixture.choosePunk("93");
  assert.equal(fixture.step(), "wallet");
  fixture.next("limits").click();
  fixture.next("activate").click();
  assert.equal(fixture.step(), "activate");
  fixture.element("[data-wizard-retirement]").checked = true;
  fixture.automationState(activeAutomation());
  assert.equal(fixture.step(), "power");
  assert.equal(fixture.element("[data-wizard-activate]").disabled, true);
});

test("an authorized agent is skipped past setup however late the owner taps Continue", () => {
  const fixture = wizardFixture({ punks: [ACTIVE_PUNK] });
  setupAgentWizard(fixture);
  fixture.choosePunk("93");
  fixture.next("limits").click();
  assert.equal(fixture.step(), "limits");
  // A recorded error is what keeps the render pass from rescuing this on its own, leaving the
  // forward transition itself as the only guard. It has to hold.
  const stranded = activeAutomation({ lastActionError: "Setup stopped safely." });
  fixture.windowObject.__GOGH_AUTOMATION_SNAPSHOT__ = stranded;
  fixture.automationState(stranded);
  fixture.next("activate").click();
  assert.equal(fixture.step(), "power", "limits -> activate must be guarded too");
});

test("a recorded action error never strands an authorized agent on the activation screen", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "activate", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK],
    automation: activeAutomation({ lastActionError: "Setup stopped safely." }),
  });
  setupAgentWizard(fixture);
  assert.equal(fixture.step(), "power");
  assert.equal(fixture.element("[data-wizard-state]").textContent, "Setup stopped safely.");
  assert.equal(fixture.element("[data-wizard-activate]").disabled, true);
});

test("activating an already-authorized agent never re-runs the owner setup batch", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "activate", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK],
    automation: activeAutomation(),
  });
  setupAgentWizard(fixture);
  fixture.element("[data-wizard-activate]").click();
  assert.equal(fixture.element("[data-v2-setup]").clicks, 0, "no setup transaction batch");
  assert.equal(fixture.element("[data-retirement-confirm]").checked, false,
    "the advanced panel's disclosure must not be force-checked for an active Punk");
  assert.equal(fixture.step(), "power");
});

test("agent cards report the authorization expiry the live reader actually publishes", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "power", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK],
    automation: activeAutomation(),
  });
  setupAgentWizard(fixture);
  const facts = agentCardFacts(fixture);
  assert.equal(facts["Mints today"], "1 / 3");
  assert.equal(facts["NFTs collected"], "Syncing");
  assert.equal(facts["Last result"], "No mint passed every check");
});

test("active-agent cards separate same-page monitoring, wallet assets, and safe restart", () => {
  const fixture = wizardFixture({
    punks: [ACTIVE_PUNK],
    automation: activeAutomation(),
  });
  setupAgentWizard(fixture);
  assert.deepEqual(agentCardActions(fixture), [
    { textContent: "Watch agent", href: "/broker/?punk=93#agent-matrix-title" },
    { textContent: "Open wallet", href: "/broker/punk/93#assets" },
    { textContent: "Restart agent", href: undefined },
  ]);
});

test("wizard Watch Agent selects the Punk and opens same-page monitoring", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "success", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK], automation: activeAutomation(),
  });
  setupAgentWizard(fixture);
  fixture.element("[data-wizard-watch]").click();
  assert.equal(fixture.dispatched.at(-2).type, "gogh:select-punk-request");
  assert.equal(fixture.dispatched.at(-2).detail.tokenId, "93");
  assert.equal(fixture.dispatched.at(-1).type, "gogh:matrix-focus");
  assert.equal(fixture.dispatched.at(-1).detail.tokenId, "93");
});

test("agent cards never present a local draft limit as an on-chain cap", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "wallet", dailyLimit: 3, durationDays: 7 },
    punks: [{ tokenId: "93", activated: true, account: PUNK_WALLET }],
    automation: automationFor({ ...LIVE_STATE, active: false, acquisitionsToday: 0 }),
  });
  setupAgentWizard(fixture);
  const facts = agentCardFacts(fixture);
  assert.equal(facts["Mints today"], "—");
  assert.equal(facts["NFTs collected"], "Syncing");
});

test("indexed worker evidence distinguishes enrollment from actual processing", () => {
  assert.equal(agentCardPresentation({ tokenId: "93", agentSummary: {
    configured: true, enrolled: false, status: "NEEDS_ENROLLMENT",
  } }).label, "Needs enrollment repair");
  assert.equal(agentCardPresentation({ tokenId: "94", agentSummary: {
    configured: true, enrolled: true, status: "WAITING_FOR_FIRST_SCAN",
  } }).label, "Enrolled · waiting for first scan");
  assert.equal(agentCardPresentation({ tokenId: "95", agentSummary: {
    configured: true, enrolled: true, status: "ACTIVE",
    lastActualScan: "2026-08-29T12:00:00.000Z",
  } }).label, "Active · worker verified");
  assert.equal(agentCardPresentation({ tokenId: "96", agentSummary: {
    configured: true, enrolled: true, status: "AWAITING_WORKER_EVIDENCE",
  } }).label, "Awaiting worker evidence");
  assert.equal(agentCardPresentation({ tokenId: "97", agentSummary: {
    configured: true, enrolled: true, status: "MINTING", workerState: "CONFIRMING",
  } }).label, "Minting now");
  assert.equal(agentCardPresentation({ tokenId: "98", agentSummary: {
    configured: true, enrolled: true, status: "RETRY_SCHEDULED",
    reason: "DISCOVERY_SCAN_FAILED",
  } }).label, "Safe retry scheduled");
});

test("agent rotation countdown explains long fair turns without implying a failure", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  assert.equal(agentRotationCountdown("2026-08-30T14:20:00Z", now), "~2h 20m");
  assert.equal(agentRotationCountdown("2026-08-30T11:59:00Z", now),
    "Due in fair rotation");
  assert.equal(agentRotationCountdown(null, now), "Waiting for first assignment");
});

test("Restart Agent uses only the fixed Punk run endpoint and reports queue state", async () => {
  const calls = [];
  const fixture = wizardFixture({
    punks: [{ ...ACTIVE_PUNK, automationCreated: true }],
    automation: activeAutomation(),
    fetchFunction: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 202, json: async () => ({ ok: true,
        run: { status: "RUN_IN_PROGRESS" } }) };
    },
  });
  setupAgentWizard(fixture);
  const card = fixture.element("[data-active-agent-grid]").children[0];
  const status = card.children[1].children[1];
  const restart = card.children[2].children[2];
  await restart.click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/broker/autonomy-v3-run");
  assert.deepEqual(JSON.parse(calls[0].options.body), { tokenId: "93" });
  assert.equal(status.textContent, "Queued · worker is finishing another scan");
  assert.equal(restart.textContent, "Restart agent");
});

test("shared hosted gas is optional and never blocks an otherwise-live agent", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "power", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK], automation: activeAutomation({ agentLive: true, hostedGas: null }),
  });
  setupAgentWizard(fixture);
  assert.equal(fixture.step(), "success");
  assert.equal(fixture.element("[data-wizard-send]").disabled, false);
  assert.equal(fixture.element("[data-wizard-gas-status]").textContent,
    "No payment required to launch");
  assert.equal(fixture.element("[data-wizard-fund]").hidden, false);
});

test("an authorized Punk can request worker recovery without funding or a healthy heartbeat", () => {
  const fixture = wizardFixture({
    stored: { selectedPunk: "93", step: "power", dailyLimit: 3, durationDays: 7 },
    punks: [ACTIVE_PUNK], automation: activeAutomation({ agentLive: false, hostedGas: {
      address: "0x1111111111111111111111111111111111111111", balanceWei: "1", ready: true,
    } }),
  });
  setupAgentWizard(fixture);
  const send = fixture.element("[data-wizard-send]");
  assert.equal(send.disabled, false);
  send.click();
  assert.equal(fixture.element("[data-v3-run-now]").clicks, 1);
  assert.equal(fixture.step(), "power", "requesting a run is not itself proof of success");
  assert.equal(fixture.element("[data-wizard-gas-status]").textContent,
    "Ready — no payment required ✓");
});

test("snapshot statistics are chain evidence or null", () => {
  assert.deepEqual(automationSnapshotStats({
    active: true, maxAcquisitionsPerDay: 5, acquisitionsToday: 2,
    authorization: { validUntil: VALID_UNTIL, active: true },
  }), { cap: 5, acquisitionsToday: 2, authorizationValidUntil: VALID_UNTIL });
  // The expiry is nested under `authorization`; a flat lookup silently yields nothing.
  assert.equal(automationSnapshotStats({
    active: true, authorizationValidUntil: VALID_UNTIL,
  }).authorizationValidUntil, null);
  assert.deepEqual(automationSnapshotStats({
    active: false, maxAcquisitionsPerDay: 5, acquisitionsToday: 2,
    authorization: { validUntil: VALID_UNTIL },
  }), { cap: null, acquisitionsToday: null, authorizationValidUntil: null });
  assert.deepEqual(automationSnapshotStats(null), {
    cap: null, acquisitionsToday: null, authorizationValidUntil: null,
  });
});

test("resuming only ever carries an owner forward", () => {
  assert.equal(forwardOnlyWizardStep("activate", "power"), "power");
  assert.equal(forwardOnlyWizardStep("activate", "limits"), "activate");
  assert.equal(forwardOnlyWizardStep("power", "power"), "power");
  assert.equal(forwardOnlyWizardStep("choose", "success"), "success");
  assert.equal(wizardStepIndex("choose"), 0);
  assert.equal(wizardStepIndex("success"), 5);
  assert.equal(wizardStepIndex("nonsense"), 0);
});
