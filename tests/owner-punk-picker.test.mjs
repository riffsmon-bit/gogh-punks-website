import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { indexedOwnerPunkIds } from "../netlify/functions/broker-owner-punks.mjs";
import { findBrowserOwnedPunks } from "../site/owner-accounts.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const ACCOUNT_A = "0x2222222222222222222222222222222222222222";
const ACCOUNT_B = "0x3333333333333333333333333333333333333333";

function addressWord(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

test("indexed owner picker candidates are bounded, ordered, and explicitly non-authorizing", async () => {
  let captured;
  const result = await indexedOwnerPunkIds(OWNER, async (sql, values) => {
    captured = { sql, values };
    return { rows: [{ token_id: "12" }, { token_id: "1639" }, { token_id: "1639" }] };
  });
  assert.deepEqual(result, ["12", "1639"]);
  assert.match(captured.sql, /LOWER\(owner_snapshot\)/);
  assert.equal(captured.values[2], OWNER.toLowerCase());
  assert.equal(captured.values[3], 51);
});

test("wallet rechecks ownership and labels activated versus activatable Punks", async () => {
  const provider = {
    async request({ method, params }) {
      if (method === "eth_call") {
        const [{ to, data }] = params;
        const token = BigInt(`0x${data.slice(-64)}`).toString();
        if (to === COLLECTION) return addressWord(token === "9" ? REGISTRY : OWNER);
        if (to === REGISTRY) return addressWord(token === "7" ? ACCOUNT_A : ACCOUNT_B);
      }
      if (method === "eth_getCode") return params[0] === ACCOUNT_A ? "0x6000" : "0x";
      throw new Error(`unexpected ${method}`);
    },
  };
  const gate = { capability: true, bindings: { punkCollection: COLLECTION,
    accountRegistry: REGISTRY } };
  const result = await findBrowserOwnedPunks(provider, gate, OWNER, ["7", "8", "9"]);
  assert.deepEqual(result.map(({ tokenId, activated }) => ({ tokenId, activated })), [
    { tokenId: "7", activated: true },
    { tokenId: "8", activated: false },
  ]);
});

test("picker UI selects a live-verified Punk while preserving manual entry", async () => {
  const [html, accounts, activation, endpoint] = await Promise.all([
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/owner-accounts.js", import.meta.url), "utf8"),
    readFile(new URL("../site/account-activation.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-owner-punks.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-owned-punk-picker/);
  assert.match(html, /data-activation-token/);
  assert.match(accounts, /findBrowserOwnedPunks/);
  assert.match(accounts, /gogh:punk-selected/);
  assert.match(activation, /gogh:punk-selected/);
  assert.match(endpoint, /INDEXED_CANDIDATES_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK/);
  assert.doesNotMatch(endpoint, /eth_send|privateKey|mnemonic/);
});
