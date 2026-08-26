import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildWithdrawableNftAssets,
  erc721MintFromReceipt,
} from "../netlify/functions/broker-nft-withdrawal-assets.mjs";
import { validateWithdrawableNftAssets } from "../site/nft-withdrawal.js";

const ACCOUNT = "0x06d5e0df2eb9512777403bf017031618f4713e19";
const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const COLLECTION = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function addressTopic(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function receipt({ owner = ACCOUNT, extra = false } = {}) {
  const logs = [{
    address: COLLECTION,
    topics: [TRANSFER, `0x${"0".repeat(64)}`, addressTopic(owner), `0x${99n.toString(16).padStart(64, "0")}`],
  }];
  if (extra) logs.push(logs[0]);
  return { status: "success", transactionHash: HASH, logs };
}

function row() {
  return {
    account_address: ACCOUNT,
    collection_address: COLLECTION,
    transaction_hash: HASH,
    completed_at: "2026-08-24T20:00:00.000Z",
  };
}

function gate() {
  return {
    capability: true,
    bindings: { account: ACCOUNT, expectedOwner: OWNER },
  };
}

test("extracts one exact ERC-721 mint to the selected Punk wallet", () => {
  const item = erc721MintFromReceipt(row(), receipt());
  assert.equal(item.tokenId, "99");
  assert.equal(item.collection, COLLECTION);
  assert.equal(item.openSeaUrl, `https://opensea.io/item/robinhood/${COLLECTION}/99`);
  assert.equal(erc721MintFromReceipt(row(), receipt({ owner: OWNER })), null);
  assert.equal(erc721MintFromReceipt(row(), receipt({ extra: true })), null);
});

test("returns only confirmed worker mints still owned by the Punk wallet", async () => {
  const database = { query: async (sql, values) => {
    assert.match(sql, /broker_automation_v3_worker_runs/);
    assert.deepEqual(values, ["93", ACCOUNT]);
    return { rows: [row(), row()] };
  } };
  let ownerReads = 0;
  const assets = await buildWithdrawableNftAssets("93", {
    database,
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => { ownerReads += 1; return ACCOUNT; },
  });
  assert.equal(assets.capability, true);
  assert.equal(assets.items.length, 1);
  assert.equal(ownerReads, 2);
  assert.equal(validateWithdrawableNftAssets(assets, "93").length, 1);

  const withdrawn = await buildWithdrawableNftAssets("93", {
    database,
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => OWNER,
  });
  assert.deepEqual(withdrawn.items, []);
});

test("asset list fails closed on a closed gate, malformed evidence, and hostile links", async () => {
  const unavailable = await buildWithdrawableNftAssets("93", {
    gateBuilder: async () => ({ capability: false, reason: "ACCOUNT_NOT_ACTIVATED" }),
  });
  assert.equal(unavailable.capability, false);
  assert.deepEqual(unavailable.items, []);

  const valid = await buildWithdrawableNftAssets("93", {
    database: { query: async () => ({ rows: [row()] }) },
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => ACCOUNT,
  });
  const changed = structuredClone(valid);
  changed.items[0].openSeaUrl = "https://example.com/attacker";
  assert.throws(() => validateWithdrawableNftAssets(changed, "93"), /link/);
  assert.throws(() => validateWithdrawableNftAssets(valid, "94"), /unavailable/);
});

test("site exposes a selectable NFT list while retaining a live-checked manual fallback", async () => {
  const html = await readFile(new URL("../site/broker/index.html", import.meta.url), "utf8");
  const browser = await readFile(new URL("../site/nft-withdrawal.js", import.meta.url), "utf8");
  const endpoint = await readFile(
    new URL("../netlify/functions/broker-nft-withdrawal-assets.mjs", import.meta.url), "utf8",
  );
  assert.match(html, /data-nft-owned-asset/);
  assert.match(html, /data-nft-owned-cards/);
  assert.match(html, /Manual contract and token entry/);
  assert.match(browser, /nft-withdrawal-assets\?tokenId=/);
  assert.match(endpoint, /status = 'MINT_CONFIRMED'/);
  assert.doesNotMatch(endpoint, /eth_send|sendTransaction|privateKey|mnemonic/);
});
