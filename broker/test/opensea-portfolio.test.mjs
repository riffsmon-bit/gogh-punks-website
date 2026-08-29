import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichOpenSeaPortfolio,
  OpenSeaPortfolioSource,
  sanitizeOpenSeaAccountNfts,
  sanitizeOpenSeaCollectionFloor,
  sanitizeOpenSeaExactNft,
} from "../src/metadata/opensea-portfolio.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const COLLECTION = "0x2222222222222222222222222222222222222222";
const OTHER_COLLECTION = "0x3333333333333333333333333333333333333333";

function baseItem() {
  return { standard: "ERC721", collection: COLLECTION, tokenId: "7", amount: "1",
    transactionHash: `0x${"ab".repeat(32)}`, acquiredAt: "2026-08-29T04:00:00.000Z",
    openSeaUrl: `https://opensea.io/item/robinhood/${COLLECTION}/7`,
    collectionName: "On-chain Name", name: null, imageUrl: null,
    collectionSlug: null, floorPrice: null };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

test("sanitizes only exact Robinhood account NFT display fields", () => {
  const items = sanitizeOpenSeaAccountNfts({ nfts: [{
    identifier: "7", collection: "example-collection", contract: COLLECTION,
    name: "Example\u0000 #7", display_image_url: "https://i.seadn.io/gcs/files/example.png",
  }, {
    identifier: "8", collection: "BAD SLUG", contract: COLLECTION,
    name: "No hostile image", image_url: "https://evil.test/nft.png",
  }, { identifier: "-1", collection: "ignored", contract: COLLECTION }] }, ACCOUNT);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    identity: `${COLLECTION}:7`, collection: COLLECTION, tokenId: "7",
    standard: "ERC721", amount: "1",
    collectionSlug: "example-collection", name: "Example #7",
    imageUrl: "https://i.seadn.io/gcs/files/example.png",
  });
  assert.equal(items[1].collectionSlug, null);
  assert.equal(items[1].imageUrl, null);
  assert.throws(() => sanitizeOpenSeaAccountNfts({ nfts: new Array(65).fill({}) }, ACCOUNT));
});

test("accepts only bounded native collection-floor estimates", () => {
  const at = "2026-08-29T04:00:00.000Z";
  assert.deepEqual(sanitizeOpenSeaCollectionFloor({ total: { floor_price: 0.0042 } },
    "example-collection", at), {
    amount: "0.0042", currency: "ETH", source: "OPENSEA_COLLECTION_FLOOR",
    checkedAt: at, collectionSlug: "example-collection",
    sourceUrl: "https://opensea.io/collection/example-collection",
  });
  assert.equal(sanitizeOpenSeaCollectionFloor({ total: { floor_price: -1 } },
    "example-collection", at), null);
  assert.equal(sanitizeOpenSeaCollectionFloor({ total: { floor_price: "Infinity" } },
    "example-collection", at), null);
});

test("sanitizes an exact NFT only when contract and token identity match", () => {
  assert.deepEqual(sanitizeOpenSeaExactNft({
    identifier: "7", collection: "example-collection", contract: COLLECTION,
    name: "Example #7", image_url: "https://i.seadn.io/example.png",
  }, COLLECTION, "7"), {
    identity: `${COLLECTION}:7`, collection: COLLECTION, tokenId: "7",
    collectionSlug: "example-collection", name: "Example #7",
    imageUrl: "https://i.seadn.io/example.png",
  });
  assert.throws(() => sanitizeOpenSeaExactNft({
    identifier: "8", collection: "example-collection", contract: COLLECTION,
  }, COLLECTION, "7"), /identity/);
  assert.throws(() => sanitizeOpenSeaExactNft({
    identifier: "7", collection: "example-collection", contract: OTHER_COLLECTION,
  }, COLLECTION, "7"), /identity/);
});

test("OpenSea source keeps the key server-side and uses fixed read-only endpoints", async () => {
  const calls = [];
  const source = new OpenSeaPortfolioSource({ apiKey: "server-secret-key", fetchFn: async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return response({ nfts: [{
      identifier: "7", collection: "example-collection", contract: COLLECTION,
      name: "Example #7", image_url: "https://raw2.seadn.io/example.png",
    }] });
    if (calls.length === 2) return response({
      identifier: "7", collection: "example-collection", contract: COLLECTION,
      name: "Example #7", image_url: "https://raw2.seadn.io/example.png",
    });
    return response({ total: { floor_price: 0.01 } });
  } });
  assert.equal((await source.accountNfts(ACCOUNT))[0].tokenId, "7");
  assert.equal((await source.exactNft(COLLECTION, "7")).tokenId, "7");
  assert.equal((await source.collectionFloor("example-collection")).amount, "0.01");
  assert.equal(calls[0].url,
    `https://api.opensea.io/api/v2/chain/robinhood/account/${ACCOUNT}/nfts?limit=64`);
  assert.equal(calls[1].url,
    `https://api.opensea.io/api/v2/chain/robinhood/contract/${COLLECTION}/nfts/7`);
  assert.equal(calls[2].url,
    "https://api.opensea.io/api/v2/collections/example-collection/stats");
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers["x-api-key"], "server-secret-key");
  }
});

test("enrichment falls back to bounded exact NFT reads when account inventory lags", async () => {
  const requested = [];
  const source = {
    accountNfts: async () => { throw new Error("index lag"); },
    exactNft: async (collection, identifier) => {
      requested.push(`${collection}:${identifier}`);
      return { identity: `${collection}:${identifier}`, collection, tokenId: identifier,
        collectionSlug: "exact-collection", name: "Exact #7",
        imageUrl: "https://i.seadn.io/exact.png" };
    },
    collectionFloor: async (slug) => ({ amount: "0.03", currency: "ETH",
      source: "OPENSEA_COLLECTION_FLOOR", checkedAt: "2026-08-29T04:00:00.000Z",
      collectionSlug: slug, sourceUrl: `https://opensea.io/collection/${slug}` }),
  };
  const [item] = await enrichOpenSeaPortfolio([baseItem()], ACCOUNT, { source, now: 1_200_000 });
  assert.deepEqual(requested, [`${COLLECTION}:7`]);
  assert.equal(item.name, "Exact #7");
  assert.equal(item.imageUrl, "https://i.seadn.io/exact.png");
  assert.equal(item.floorPrice.amount, "0.03");
});

test("enrichment adds advisory art and floor without changing authoritative identity", async () => {
  const checkedAt = "2026-08-29T04:00:00.000Z";
  const source = {
    accountNfts: async () => [{ identity: `${COLLECTION}:7`, collection: COLLECTION,
      tokenId: "7", collectionSlug: "example-collection", name: "Example #7",
      imageUrl: "https://i.seadn.io/example.png" }],
    collectionFloor: async () => ({ amount: "0.02", currency: "ETH",
      source: "OPENSEA_COLLECTION_FLOOR", checkedAt,
      collectionSlug: "example-collection",
      sourceUrl: "https://opensea.io/collection/example-collection" }),
  };
  const authoritative = Object.freeze([baseItem()]);
  const [item] = await enrichOpenSeaPortfolio(authoritative, ACCOUNT, { source, now: 1 });
  assert.equal(item.collection, COLLECTION);
  assert.equal(item.tokenId, "7");
  assert.equal(item.name, "Example #7");
  assert.equal(item.floorPrice.amount, "0.02");
  assert.equal(authoritative[0].name, null);
});

test("enrichment requests floor data only for authoritative rendered assets", async () => {
  const requested = [];
  const source = {
    accountNfts: async () => [
      { identity: `${COLLECTION}:7`, collection: COLLECTION, tokenId: "7",
        collectionSlug: "shown-collection", name: "Shown #7", imageUrl: null },
      { identity: `${OTHER_COLLECTION}:8`, collection: OTHER_COLLECTION, tokenId: "8",
        collectionSlug: "unrelated-spam", name: "Spam #8", imageUrl: null },
    ],
    collectionFloor: async (slug) => { requested.push(slug); return null; },
  };
  await enrichOpenSeaPortfolio([baseItem()], ACCOUNT, { source, now: 600_000 });
  assert.deepEqual(requested, ["shown-collection"]);
});
