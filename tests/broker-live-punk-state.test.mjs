import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { findOwnerPunkAccounts, requestedTokenIds } from
  "../netlify/functions/broker-owner-accounts.mjs";
import { readLivePunkState } from "../netlify/functions/broker-punk.mjs";

const OWNER = "0x1234567890123456789012345678901234567890";
const OTHER = "0x9999999999999999999999999999999999999999";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const ACCOUNT_1797 = "0x2222222222222222222222222222222222222222";
const ACCOUNT_1639 = "0x3333333333333333333333333333333333333333";
const ART = "0x4444444444444444444444444444444444444444";

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

test("requested account token hints are strict, bounded, and always include Scout Punk", () => {
  const tokens = requestedTokenIds("https://example.test/api?tokens=1639,01,9999,10000,nope");
  assert.deepEqual([...tokens], ["1797", "1639", "9999"]);
});

test("Punk recommendations are collapsed and token metrics avoid nested-label styling", async () => {
  const [punkHtml, brokerHtml, css] = await Promise.all([
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
  ]);
  assert.match(punkHtml, /<details class="section-block collapsible-section"/);
  assert.match(punkHtml, /data-punk-recommendation-total/);
  assert.match(brokerHtml, /data-owner-accounts/);
  assert.match(brokerHtml, /data-punk-account-count/);
  assert.match(css, /\.metric > span/);
  assert.doesNotMatch(css, /\.metric span \{/);
});
