import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildWithdrawableNftAssets,
  buildWithdrawableNftPortfolio,
  erc721MintFromReceipt,
} from "../netlify/functions/broker-nft-withdrawal-assets.mjs";
import {
  validateWithdrawableNftAssets, validateWithdrawableNftPortfolio,
} from "../site/nft-withdrawal.js";

const ACCOUNT = "0x06d5e0df2eb9512777403bf017031618f4713e19";
const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const COLLECTION = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const IPFS_IMAGE = "https://ipfs.io/ipfs/bafybeifxubfqw4ijecm3adlgczd37x2kk3xu4mpsgelh7n4nxxq5ufmrsy";

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
    getCollectionName: async () => "The Doll Club NFTs",
  });
  assert.equal(assets.capability, true);
  assert.equal(assets.items.length, 1);
  assert.equal(ownerReads, 2);
  assert.equal(assets.items[0].collectionName, "The Doll Club NFTs");
  assert.equal(validateWithdrawableNftAssets(assets, "93").length, 1);

  const withdrawn = await buildWithdrawableNftAssets("93", {
    database,
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => OWNER,
  });
  assert.deepEqual(withdrawn.items, []);
});

test("adds advisory OpenSea art and floor while keeping receipt and live owner authority", async () => {
  let enrichCalls = 0;
  const assets = await buildWithdrawableNftAssets("93", {
    environment: { OPENSEA_API_KEY: "server-side-test-key" },
    database: { query: async (sql) => ({ rows: /worker_runs/.test(sql) ? [row()] : [] }) },
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => ACCOUNT,
    getCollectionName: async () => "Example Collection",
    openSeaSource: { accountNfts: async () => [] },
    enrichItems: async (items, account, options) => {
      enrichCalls += 1;
      assert.equal(account, ACCOUNT);
      assert.equal(options.apiKey, "server-side-test-key");
      return items.map((item) => ({ ...item, name: "Example #99",
        imageUrl: "https://i.seadn.io/example.png", collectionSlug: "example-collection",
        floorPrice: { amount: "0.01", currency: "ETH",
          source: "OPENSEA_COLLECTION_FLOOR", checkedAt: "2026-08-29T04:00:00.000Z",
          collectionSlug: "example-collection",
          sourceUrl: "https://opensea.io/collection/example-collection" } }));
    },
  });
  assert.equal(enrichCalls, 1);
  const [item] = validateWithdrawableNftAssets(assets, "93");
  assert.equal(item.name, "Example #99");
  assert.equal(item.imageUrl, "https://i.seadn.io/example.png");
  assert.equal(item.floorPrice.amount, "0.01");
  const hostile = structuredClone(assets);
  hostile.items[0].floorPrice.sourceUrl = "https://evil.test/floor";
  assert.throws(() => validateWithdrawableNftAssets(hostile, "93"), /floor/);
});

test("includes manually received indexed ERC-721 and ERC-1155 assets for live withdrawal preflight", async () => {
  const assets = await buildWithdrawableNftAssets("93", {
    environment: { OPENSEA_API_KEY: "server-side-test-key" },
    database: { query: async (sql) => ({ rows: /worker_runs/.test(sql) ? [] : [] }) },
    gateBuilder: async () => gate(),
    getReceipt: async () => null,
    getOwner: async () => ACCOUNT,
    openSeaSource: { accountNfts: async () => [{
      identity: `${COLLECTION}:7`, collection: COLLECTION, tokenId: "7",
      standard: "ERC1155", amount: "5", collectionSlug: "manual-edition",
      name: "Manual Edition #7", imageUrl: "https://i.seadn.io/manual.png",
    }] },
    enrichItems: async (items) => items,
  });
  const [item] = validateWithdrawableNftAssets(assets, "93");
  assert.equal(item.standard, "ERC1155");
  assert.equal(item.amount, "5");
  assert.equal(item.provenance, "RECEIVED");
  assert.equal(item.ownershipStatus, "LIVE_CHECK_REQUIRED");
  assert.equal(item.transactionHash, null);
  assert.equal(item.acquiredAt, null);
});

test("adds one exact live-owned ERC-721 when the marketplace account index omits it", async () => {
  const missingCollection = "0x505a22ffed8d37ebe580ffd98d2cdb0021189146";
  const assets = await buildWithdrawableNftAssets("93", {
    database: { query: async () => ({ rows: [] }) },
    gateBuilder: async () => gate(),
    getReceipt: async () => null,
    getOwner: async (collection, id) => {
      assert.equal(collection, missingCollection);
      assert.equal(id, "882");
      return ACCOUNT;
    },
    getCollectionName: async () => "CCFF00",
    exactAsset: { collection: missingCollection, tokenId: "882" },
  });
  const [item] = validateWithdrawableNftAssets(assets, "93");
  assert.equal(item.collection, missingCollection);
  assert.equal(item.tokenId, "882");
  assert.equal(item.collectionName, "CCFF00");
  assert.equal(item.provenance, "RECEIVED");
  assert.equal(item.ownershipStatus, "LIVE_CHECK_REQUIRED");
});

test("falls back to exact on-chain tokenURI display when marketplace indexing lags", async () => {
  let tokenUriReads = 0;
  const assets = await buildWithdrawableNftAssets("93", {
    database: { query: async (sql) => ({ rows: /worker_runs/.test(sql) ? [row()] : [] }) },
    gateBuilder: async () => gate(),
    getReceipt: async () => receipt(),
    getOwner: async () => ACCOUNT,
    getCollectionName: async () => "Pepe Brokers",
    getTokenUri: async () => { tokenUriReads += 1; return "ipfs://metadata"; },
    enrichItems: async (items) => items,
    readTokenDisplay: async (uri) => {
      assert.equal(uri, "ipfs://metadata");
      return { name: "Pepe Brokers #99", imageUrl: IPFS_IMAGE };
    },
  });
  assert.equal(tokenUriReads, 1);
  assert.equal(assets.items[0].name, "Pepe Brokers #99");
  assert.equal(assets.items[0].imageUrl, IPFS_IMAGE);
  assert.equal(assets.items[0].floorPrice, null);
  assert.equal(validateWithdrawableNftAssets(assets, "93")[0].imageUrl, IPFS_IMAGE);
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

test("one portfolio request groups confirmed NFTs across the holder's Punk agents", async () => {
  const checkedAt = "2026-08-26T13:00:00.000Z";
  const database = { query: async (sql, values) => {
    assert.match(sql, /GROUP BY punk_token_id/);
    assert.deepEqual(values, [["93", "94", "1659"]]);
    return { rows: [{ punk_token_id: "93" }, { punk_token_id: "1659" }] };
  } };
  const buildAssets = async (id) => ({
    status: "READY", capability: true, reason: null, checkedAt,
    punkTokenId: id, account: ACCOUNT, owner: OWNER,
    items: [{
      standard: "ERC721", collection: COLLECTION, tokenId: id, amount: "1",
      transactionHash: HASH, acquiredAt: checkedAt,
      provenance: "ART_BROKER", ownershipStatus: "LIVE_VERIFIED",
      openSeaUrl: `https://opensea.io/item/robinhood/${COLLECTION}/${id}`,
      collectionName: "Example Collection", name: `Mint ${id}`, imageUrl: null,
      collectionSlug: null, floorPrice: null,
    }],
  });
  const portfolio = await buildWithdrawableNftPortfolio(["93", "94", "1659"], {
    database, buildAssets,
  });
  assert.deepEqual(portfolio.groups.map(({ punkTokenId }) => punkTokenId), ["93", "1659"]);
  const items = validateWithdrawableNftPortfolio(portfolio, ["93", "94", "1659"]);
  assert.deepEqual(items.map(({ punkTokenId }) => punkTokenId), ["93", "1659"]);
  assert.throws(() => validateWithdrawableNftPortfolio(portfolio, ["93"]), /unavailable/);
});

test("site exposes a selectable NFT list while retaining a live-checked manual fallback", async () => {
  const html = await readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8");
  const browser = await readFile(new URL("../site/nft-withdrawal.js", import.meta.url), "utf8");
  const controlCenter = await readFile(
    new URL("../site/punk-control-center.js", import.meta.url), "utf8",
  );
  const endpoint = await readFile(
    new URL("../netlify/functions/broker-nft-withdrawal-assets.mjs", import.meta.url), "utf8",
  );
  assert.match(html, /data-asset-grid/);
  assert.match(html, /data-control-withdrawal/);
  assert.match(html, /Collected NFTs/);
  assert.match(html, /Withdraw to my wallet/i);
  assert.match(html, /Can’t Find an NFT/);
  assert.match(html, /data-find-nft-url/);
  assert.match(html, /data-withdrawal-submit/);
  assert.match(controlCenter, /nft-withdrawal-assets\?\$\{params\}/);
  assert.match(controlCenter, /assetTokenId/);
  assert.match(browser, /nft-withdrawal-assets\?tokenIds=/);
  assert.match(browser, /gogh:select-punk-request/);
  assert.match(browser, /waitForNftWithdrawalReceipt/);
  assert.match(browser, /gogh:portfolio-invalidated/);
  assert.match(endpoint, /status = 'MINT_CONFIRMED'/);
  assert.doesNotMatch(endpoint, /eth_send|sendTransaction|privateKey|mnemonic/);
});

test("Broker Collected NFTs view is an on-demand NFT gallery", async () => {
  const html = await readFile(new URL("../site/broker/index.html", import.meta.url), "utf8");
  const browser = await readFile(new URL("../site/owner-accounts.js", import.meta.url), "utf8");
  assert.match(html, /Collected NFTs/);
  assert.match(html, /data-owner-collected-gallery/);
  assert.match(html, /data-owner-collected-grid/);
  assert.match(browser, /fetchWithdrawableNftPortfolio\(request, tokenIds\)/);
  assert.match(browser, /provenance === "ART_BROKER"/);
  assert.match(browser, /Open \/ Withdraw/);
});
