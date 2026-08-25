import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { findOwnerPunkAccounts, requestedTokenIds } from
  "../netlify/functions/broker-owner-accounts.mjs";
import { externalFreeMintJournalEntries, readLivePunkState } from "../netlify/functions/broker-punk.mjs";
import { findBrowserOwnerAccounts } from "../site/owner-accounts.js";
import { readBrowserPunkDisplay } from "../site/live-punk-display.js";
import { keccak256Hex } from "../site/keccak256.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const OTHER = "0x9999999999999999999999999999999999999999";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const ACCOUNT_1797 = "0x2222222222222222222222222222222222222222";
const ACCOUNT_1639 = "0x3333333333333333333333333333333333333333";
const ART = "0x4444444444444444444444444444444444444444";

function abiWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function abiAddress(value) {
  return value.slice(2).padStart(64, "0");
}

const surface = Object.freeze({
  deploymentStatus: "DEPLOYED",
  accountRegistry: REGISTRY,
  canaryStatus: "DEPLOYED",
  canary: Object.freeze({
    punkTokenId: "1797",
    account: ACCOUNT_1797,
    collection: ART,
    tokenId: "9001",
  }),
});

function client() {
  return {
    async getBlockNumber() { return 200_000n; },
    async getLogs() {
      return [
        { args: { chainId: 4663n, collection: ROBINHOOD.canonicalCollection,
          tokenId: 1639n, owner: OWNER } },
        { args: { chainId: 4663n, collection: ROBINHOOD.canonicalCollection,
          tokenId: 88n, owner: OTHER } },
      ];
    },
    async readContract(request) {
      const id = request.args?.[0]?.toString();
      if (request.address === ROBINHOOD.canonicalCollection) return OWNER;
      if (request.address === ART && request.functionName === "minted") return true;
      if (request.address === ART && request.functionName === "ownerOf") return ACCOUNT_1797;
      if (request.functionName === "account") return id === "1639" ? ACCOUNT_1639 : ACCOUNT_1797;
      if (request.functionName === "isAccountCreated") return true;
      if (request.functionName === "owner") return OWNER;
      if (request.functionName === "token") {
        return [4663n, ROBINHOOD.canonicalCollection, BigInt(id ?? 1797)];
      }
      throw new Error(`unexpected ${request.functionName}`);
    },
    async getCode() { return "0x6000"; },
  };
}

test("live Punk state exposes an activated account and confirmed canary NFT", async () => {
  const result = await readLivePunkState("1797", surface, client());
  assert.equal(result.activated, true);
  assert.equal(result.account, ACCOUNT_1797);
  assert.equal(result.canaryAsset.tokenId, "9001");
  assert.equal(result.canaryAsset.status, "CONFIRMED_ONCHAIN");
});

test("Curator Journal exposes the confirmed #1797 autonomous mint and containment", () => {
  const entries = externalFreeMintJournalEntries("1797");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event_type, "AUTONOMOUS_FREE_MINT_COMPLETED_AND_CONTAINED");
  assert.equal(entries[0].nft_token_id, "233");
  assert.equal(entries[0].policy_version, "29");
  assert.equal(entries[0].acquisition_nonce, "1");
  assert.equal(entries[0].gas_used, "334751");
  assert.match(entries[0].transaction_url, /ccb0c093/);
  assert.deepEqual(externalFreeMintJournalEntries("1755"), []);
});

test("owner account discovery merges recent activation logs with requested Punk IDs", async () => {
  const result = await findOwnerPunkAccounts({
    owner: OWNER,
    requested: new Set(["1797"]),
    surface,
    client: client(),
  });
  assert.deepEqual(result.accounts.map(({ tokenId }) => tokenId), ["1639", "1797"]);
  assert.equal(result.accounts[0].account, ACCOUNT_1639);
  assert.equal(result.accounts[1].account, ACCOUNT_1797);
});

test("requested account token hints are strict, bounded, and contain no hosted default", () => {
  const tokens = requestedTokenIds("https://example.test/api?tokens=1639,01,9999,10000,nope");
  assert.deepEqual([...tokens], ["1639", "9999"]);
});

test("browser wallet fallback discovers only recent or explicitly requested activations", async () => {
  const provider = {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return "0x30d40";
      if (method === "eth_getLogs") return [{ data: `0x${abiWord(1639)}${abiAddress(OWNER)}${abiAddress(OTHER)}${abiWord(1)}` }];
      if (method === "eth_getCode") return "0x6000";
      if (method === "eth_call") {
        const [{ to, data }] = params;
        if (to === ART && data === "0x4f02c420") return `0x${abiWord(1)}`;
        const id = BigInt(`0x${data.replace(/^0x/, "").slice(-64)}`).toString();
        if (to === ROBINHOOD.canonicalCollection) return `0x${abiAddress(OWNER)}`;
        if (to === REGISTRY) return `0x${abiAddress(id === "1639" ? ACCOUNT_1639 : ACCOUNT_1797)}`;
        if (to === ART) return `0x${abiAddress(ACCOUNT_1797)}`;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const gate = { capability: true, bindings: {
    punkCollection: ROBINHOOD.canonicalCollection, accountRegistry: REGISTRY,
  } };
  const accounts = await findBrowserOwnerAccounts(provider, gate, OWNER, []);
  assert.deepEqual(accounts.map(({ tokenId }) => tokenId), ["1639"]);
  const status = {
    protocol: { deploymentStatus: "DEPLOYED", accountRegistry: REGISTRY },
    chain: { canonicalCollection: ROBINHOOD.canonicalCollection },
    canaryDisplay: { status: "DEPLOYED", punkTokenId: "1797", account: ACCOUNT_1797,
      collection: ART, tokenId: "9001" },
  };
  const display = await readBrowserPunkDisplay(provider, status, "1797");
  assert.equal(display.activated, true);
  assert.equal(display.canaryAsset.tokenId, "9001");
});

test("browser wallet verifies and displays the completed contained autonomous canary", async () => {
  const runtime = "0x6000";
  const provider = {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_getCode") return runtime;
      if (method === "eth_call") {
        const [{ to, data }] = params;
        if (to === ROBINHOOD.canonicalCollection) return `0x${abiAddress(OWNER)}`;
        if (to === REGISTRY) return `0x${abiAddress(ACCOUNT_1639)}`;
        if (to === ART && data === "0x4f02c420") return `0x${abiWord(1)}`;
        if (to === ART) return `0x${abiAddress(ACCOUNT_1639)}`;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const status = {
    protocol: { deploymentStatus: "DEPLOYED", accountRegistry: REGISTRY },
    chain: { canonicalCollection: ROBINHOOD.canonicalCollection },
    autonomousCanaryDisplay: {
      status: "COMPLETED_AND_CONTAINED", punkTokenId: "1639", account: ACCOUNT_1639,
      collection: ART, tokenId: "9002", runtimeCodeHash: keccak256Hex(runtime),
      transactionHash: `0x${"12".repeat(32)}`, executionMode: "AUTONOMOUS_FREE_MINT",
      containment: "AUTONOMY_OFF_AGENT_REVOKED_ACCOUNT_PAUSED_DISABLED",
    },
  };
  const display = await readBrowserPunkDisplay(provider, status, "1639");
  assert.equal(display.canaryAsset.tokenId, "9002");
  assert.equal(display.canaryAsset.executionMode, "AUTONOMOUS_FREE_MINT");
  assert.equal(display.canaryAsset.owner, ACCOUNT_1639);
});

test("browser wallet verifies and displays the contained external free mint", async () => {
  const runtime = "0x6001";
  const EXTERNAL = "0x5555555555555555555555555555555555555555";
  const provider = {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_getCode") {
        return params[0] === EXTERNAL ? runtime : "0x6000";
      }
      if (method === "eth_call") {
        const [{ to }] = params;
        if (to === ROBINHOOD.canonicalCollection) return `0x${abiAddress(OWNER)}`;
        if (to === REGISTRY) return `0x${abiAddress(ACCOUNT_1639)}`;
        if (to === EXTERNAL) return `0x${abiAddress(ACCOUNT_1639)}`;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const status = {
    protocol: { deploymentStatus: "DEPLOYED", accountRegistry: REGISTRY },
    chain: { canonicalCollection: ROBINHOOD.canonicalCollection },
    externalFreeMintTest: {
      status: "COMPLETED_AND_CONTAINED", punkTokenId: "1639", account: ACCOUNT_1639,
      executionMode: "AUTONOMOUS_FREE_MINT",
      candidate: { name: "External", collection: EXTERNAL,
        collectionRuntimeCodeHash: keccak256Hex(runtime) },
      result: { tokenId: "224", nftOwner: ACCOUNT_1639,
        transactionHash: `0x${"34".repeat(32)}`, containment: "CONTAINED" },
    },
  };
  const display = await readBrowserPunkDisplay(provider, status, "1639");
  assert.equal(display.canaryAsset.tokenId, "224");
  assert.equal(display.canaryAsset.name, "External #224");
  assert.equal(display.canaryAsset.owner, ACCOUNT_1639);
});

test("Punk recommendations are collapsed and token metrics avoid nested-label styling", async () => {
  const [punkHtml, brokerHtml, css, statusSource] = await Promise.all([
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-status.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(punkHtml, /<details class="section-block collapsible-section"/);
  assert.match(punkHtml, /data-punk-recommendation-total/);
  assert.doesNotMatch(brokerHtml, /data-owner-accounts/);
  assert.doesNotMatch(brokerHtml, /data-punk-account-count/);
  assert.match(brokerHtml, /data-owned-punk-count/);
  assert.match(brokerHtml, /data-selected-punk-display/);
  assert.match(brokerHtml, /data-public-scout-token-display/);
  assert.doesNotMatch(brokerHtml, /data-scout-token-display/);
  assert.match(brokerHtml, /Nothing is selected while the wallet is disconnected/);
  assert.match(brokerHtml, /data-live-summary/);
  assert.doesNotMatch(brokerHtml, /name="owner-workflow"/);
  assert.doesNotMatch(brokerHtml, /data-owner-policy-controls|data-account-activation/);
  assert.doesNotMatch(brokerHtml, /Legacy V1 Punk wallet controls/);
  assert.match(brokerHtml, /data-workspace-punk-picker/);
  assert.match(css, /\.metric > span/);
  assert.doesNotMatch(css, /\.metric span \{/);
  assert.match(statusSource, /canaryDisplay:/);
  assert.match(statusSource, /autonomousCanaryDisplay:/);
  assert.match(css, /\.journal-evidence/);
});
