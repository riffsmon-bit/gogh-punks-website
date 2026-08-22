import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeOwnerArtMandate,
  ownerArtMandateSha256,
  storedOwnerArtMandate,
} from "../broker/src/owner-art-mandate.mjs";
import { setupMandateEditor } from "../site/mandate-editor.js";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";

function mandate() {
  return {
    chainId: 4663,
    collection: COLLECTION,
    tokenId: "1797",
    mode: "APPROVAL_REQUIRED",
    economicSettings: { inspectMints: true, allowFreeMints: true, maxMintsPerDay: 1 },
    riskSettings: { unknownMintMode: "OWNER_APPROVAL", maxContractRiskScore: 25 },
    artisticPreferences: {
      minimumTasteMatch: 70,
      dimensions: {
        pixelArt: 98,
        generativeArt: 82,
        oneOfOne: 63,
        emergingArtists: 91,
        onChainArt: 80,
        experimentalNFTs: 75,
      },
    },
  };
}

test("normalizes a narrow owner mandate and forces paid/autonomous authority off", () => {
  const normalized = normalizeOwnerArtMandate(mandate());
  const stored = storedOwnerArtMandate(normalized, OWNER, 3);
  assert.equal(stored.version, 3);
  assert.equal(stored.configuredBy, OWNER);
  assert.equal(stored.economicSettings.allowPaidMints, false);
  assert.equal(stored.economicSettings.maxMintPriceWei, "0");
  assert.equal(stored.autonomyEnabled, false);
  assert.deepEqual(stored.mintPermissions.approvedCollections, []);
  assert.match(ownerArtMandateSha256(normalized), /^0x[0-9a-f]{64}$/);
});

test("rejects autonomy, alternate Punks, excess daily mints, and ambiguous fields", () => {
  for (const mutate of [
    (value) => { value.mode = "AUTONOMOUS"; },
    (value) => { value.tokenId = "1798"; },
    (value) => { value.economicSettings.maxMintsPerDay = 2; },
    (value) => { value.economicSettings.allowPaidMints = true; },
    (value) => { value.artisticPreferences.dimensions.hidden = 100; },
    (value) => { value.unknown = true; },
  ]) {
    const value = structuredClone(mandate());
    mutate(value);
    assert.throws(() => normalizeOwnerArtMandate(value));
  }
});

function browserFixture() {
  const values = {
    mode: { value: "APPROVAL_REQUIRED" },
    inspectMints: { checked: true },
    allowFreeMints: { checked: true },
    maxMintsPerDay: { value: "1" },
    unknownMintMode: { value: "OWNER_APPROVAL" },
    maxContractRiskScore: { value: "25" },
    minimumTasteMatch: { value: "70" },
    pixelArt: { value: "98" },
    generativeArt: { value: "82" },
    oneOfOne: { value: "63" },
    emergingArtists: { value: "91" },
    onChainArt: { value: "80" },
    experimentalNFTs: { value: "75" },
  };
  const formListeners = {};
  const windowListeners = {};
  const form = {
    elements: { namedItem: (name) => values[name] ?? null },
    addEventListener: (name, handler) => { formListeners[name] = handler; },
    removeEventListener() {},
  };
  const save = { disabled: true, textContent: "" };
  const state = { textContent: "", dataset: {} };
  const badge = {
    textContent: "",
    classList: { toggle() {} },
  };
  const outputs = Object.keys(values)
    .filter((name) => !["mode", "inspectMints", "allowFreeMints", "maxMintsPerDay", "unknownMintMode"].includes(name))
    .map((name) => ({ dataset: { mandateValue: name }, value: "" }));
  const documentObject = {
    querySelector(selector) {
      return ({
        "[data-mandate-form]": form,
        "[data-mandate-save]": save,
        "[data-mandate-state]": state,
        "[data-mandate-badge]": badge,
      })[selector] ?? null;
    },
    querySelectorAll: () => outputs,
  };
  const providerCalls = [];
  const provider = {
    async request(call) {
      providerCalls.push(call);
      if (call.method === "personal_sign") return `0x${"11".repeat(65)}`;
      if (call.method === "eth_accounts") return [OWNER];
      if (call.method === "eth_chainId") return "0x1237";
      throw new Error("unexpected wallet method");
    },
  };
  const windowObject = {
    ethereum: provider,
    addEventListener: (name, handler) => { windowListeners[name] = handler; },
    removeEventListener() {},
  };
  return { values, formListeners, windowListeners, documentObject, windowObject,
    providerCalls, save, state };
}

test("browser editor requires the live owner and saves with personal_sign only", async () => {
  const fixture = browserFixture();
  const fetchCalls = [];
  const fetchFunction = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (options.method === "GET") return { ok: true, json: async () => ({ ok: true, mandate: null }) };
    const body = JSON.parse(options.body);
    if (body.action === "prepare") {
      return { ok: true, json: async () => ({
        ok: true,
        challengeId: "11111111-1111-4111-8111-111111111111",
        message: "Review and save mandate",
      }) };
    }
    return { ok: true, json: async () => ({
      ok: true,
      mandate: storedOwnerArtMandate(normalizeOwnerArtMandate(mandate()), OWNER, 1),
    }) };
  };
  const editor = setupMandateEditor({ ...fixture, fetchFunction });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.save.disabled, true);
  fixture.windowListeners["gogh:wallet-state"]({
    detail: { account: OWNER, chainId: 4663, status: "owner" },
  });
  assert.equal(fixture.save.disabled, false);
  await fixture.formListeners.submit({ preventDefault() {} });
  assert.deepEqual(fixture.providerCalls.map((call) => call.method), [
    "personal_sign", "eth_accounts", "eth_chainId",
  ]);
  assert.equal(fetchCalls.length, 3);
  assert.match(fixture.state.textContent, /Saved version 1/);
  assert.equal(editor.currentMandate().mode, "APPROVAL_REQUIRED");
});

test("mandate endpoint is same-origin, owner verified, rate limited, and has no send path", async () => {
  const source = await readFile(new URL("../netlify/functions/broker-mandate.mjs", import.meta.url), "utf8");
  assert.match(source, /requireSameOrigin\(request\)/);
  assert.match(source, /ownerOf/);
  assert.match(source, /verifyWalletSignature/);
  assert.match(source, /aggregateBy: \["ip"\]/);
  assert.doesNotMatch(source, /eth_send|sendTransaction|privateKey|mnemonic/);
});
