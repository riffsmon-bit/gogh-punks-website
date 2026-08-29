import { ROBINHOOD, normalizeAddress } from "../config.mjs";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ITEMS = 64;
const MAX_COLLECTIONS = 24;
const IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const portfolioCache = new Map();

function cleanText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function tokenId(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError("OpenSea token ID is invalid");
  }
}

function imageUrl(value) {
  const text = cleanText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname) || url.port
      || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function boundedJson(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && /^\d+$/.test(contentLength)
    && Number(contentLength) > MAX_RESPONSE_BYTES) throw new RangeError("response too large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new RangeError("response too large");
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("response must be an object");
  }
  return value;
}

function floorValue(value) {
  if (value === null || value === undefined) return null;
  const string = typeof value === "number" ? String(value) : value;
  if (typeof string !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(string)) return null;
  const parsed = Number(string);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return string;
}

export function sanitizeOpenSeaAccountNfts(payload, expectedAccount) {
  normalizeAddress(expectedAccount, "Punk Wallet");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !Array.isArray(payload.nfts) || payload.nfts.length > MAX_ITEMS) {
    throw new TypeError("OpenSea account inventory is invalid");
  }
  return Object.freeze(payload.nfts.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    try {
      const collection = normalizeAddress(entry.contract, "OpenSea NFT contract");
      const identifier = tokenId(entry.identifier);
      const slug = typeof entry.collection === "string" && SLUG.test(entry.collection)
        ? entry.collection : null;
      return [Object.freeze({
        identity: `${collection}:${identifier}`,
        collection,
        tokenId: identifier,
        collectionSlug: slug,
        name: cleanText(entry.name, 200),
        imageUrl: imageUrl(entry.display_image_url ?? entry.image_url),
      })];
    } catch {
      return [];
    }
  }));
}

export function sanitizeOpenSeaExactNft(payload, expectedCollection, expectedTokenId) {
  const collection = normalizeAddress(expectedCollection, "OpenSea NFT contract");
  const identifier = tokenId(expectedTokenId);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("OpenSea NFT response is invalid");
  }
  if (normalizeAddress(payload.contract, "OpenSea NFT contract") !== collection
    || tokenId(payload.identifier) !== identifier) {
    throw new TypeError("OpenSea NFT response identity does not match the request");
  }
  const slug = typeof payload.collection === "string" && SLUG.test(payload.collection)
    ? payload.collection : null;
  return Object.freeze({
    identity: `${collection}:${identifier}`,
    collection,
    tokenId: identifier,
    collectionSlug: slug,
    name: cleanText(payload.name, 200),
    imageUrl: imageUrl(payload.display_image_url ?? payload.image_url),
  });
}

export function sanitizeOpenSeaCollectionFloor(payload, slug, checkedAt) {
  if (typeof slug !== "string" || !SLUG.test(slug)
    || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = floorValue(payload.total?.floor_price ?? payload.total?.floorPrice);
  if (value === null || typeof checkedAt !== "string" || !Number.isFinite(Date.parse(checkedAt))) {
    return null;
  }
  return Object.freeze({
    amount: value,
    currency: ROBINHOOD.nativeCurrency.symbol,
    source: "OPENSEA_COLLECTION_FLOOR",
    checkedAt,
    collectionSlug: slug,
    sourceUrl: `https://opensea.io/collection/${slug}`,
  });
}

export class OpenSeaPortfolioSource {
  #apiKey;

  constructor({ apiKey, fetchFn = fetch, timeoutMs = 5_000 } = {}) {
    if (typeof apiKey !== "string" || apiKey.trim().length < 8 || apiKey.length > 512) {
      throw new TypeError("OPENSEA_API_KEY is required and must remain server-side");
    }
    if (typeof fetchFn !== "function") throw new TypeError("fetchFn must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15_000) {
      throw new TypeError("OpenSea timeout is invalid");
    }
    this.#apiKey = apiKey.trim();
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
  }

  async #get(endpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(endpoint, {
        method: "GET",
        headers: Object.freeze({ accept: "application/json", "x-api-key": this.#apiKey }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OpenSea request failed (${response.status})`);
      return boundedJson(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  async accountNfts(account) {
    const canonical = normalizeAddress(account, "Punk Wallet");
    const endpoint = new URL(
      `https://api.opensea.io/api/v2/chain/robinhood/account/${canonical}/nfts`,
    );
    endpoint.searchParams.set("limit", String(MAX_ITEMS));
    return sanitizeOpenSeaAccountNfts(await this.#get(endpoint), canonical);
  }

  async exactNft(collection, identifier) {
    const canonicalCollection = normalizeAddress(collection, "OpenSea NFT contract");
    const canonicalIdentifier = tokenId(identifier);
    const endpoint = new URL(
      `https://api.opensea.io/api/v2/chain/robinhood/contract/${canonicalCollection}`
      + `/nfts/${canonicalIdentifier}`,
    );
    return sanitizeOpenSeaExactNft(
      await this.#get(endpoint), canonicalCollection, canonicalIdentifier,
    );
  }

  async collectionFloor(slug) {
    if (typeof slug !== "string" || !SLUG.test(slug)) return null;
    const checkedAt = new Date().toISOString();
    const endpoint = new URL(`https://api.opensea.io/api/v2/collections/${slug}/stats`);
    return sanitizeOpenSeaCollectionFloor(await this.#get(endpoint), slug, checkedAt);
  }
}

function trimCache(now) {
  for (const [key, value] of portfolioCache) {
    if (value.expiresAt <= now) portfolioCache.delete(key);
  }
  while (portfolioCache.size > 128) portfolioCache.delete(portfolioCache.keys().next().value);
}

export async function enrichOpenSeaPortfolio(items, account, {
  apiKey, fetchFn = fetch, now = Date.now(), source,
} = {}) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new TypeError("portfolio items are invalid");
  }
  const canonicalAccount = normalizeAddress(account, "Punk Wallet");
  if (!items.length || (typeof apiKey !== "string" && !source)) return items;
  trimCache(now);
  const identities = items.map((item) => `${item.collection}:${item.tokenId}`).sort();
  const cacheKey = `${canonicalAccount}:${identities.join(",")}`;
  const cached = portfolioCache.get(cacheKey);
  if (cached?.createdAt <= now && cached.expiresAt > now) return cached.items;
  const provider = source ?? new OpenSeaPortfolioSource({ apiKey, fetchFn });
  let openSeaItems = [];
  try {
    openSeaItems = await provider.accountNfts(canonicalAccount);
  } catch {
    // OpenSea's account inventory can lag a confirmed Robinhood transfer. Exact
    // contract/token reads below are the bounded display fallback; receipt logs and
    // live ownerOf remain the only authority for whether an item is withdrawable.
  }
  const displayByIdentity = new Map(openSeaItems.map((item) => [item.identity, item]));
  const missing = items.filter((item) => {
    const display = displayByIdentity.get(`${item.collection}:${item.tokenId}`);
    return !display || (!display.name && !display.imageUrl && !display.collectionSlug);
  });
  if (typeof provider.exactNft === "function") {
    // Bound concurrency so a portfolio with several items does not burst the
    // marketplace API. Only exact, receipt/live-owner-verified identities are read.
    for (let offset = 0; offset < missing.length; offset += 4) {
      const exact = await Promise.all(missing.slice(offset, offset + 4).map(async (item) => {
        try { return await provider.exactNft(item.collection, item.tokenId); }
        catch { return null; }
      }));
      for (const display of exact) {
        if (display) displayByIdentity.set(display.identity, display);
      }
    }
  }
  // Request collection stats only for the exact authoritative assets being rendered.
  // A Punk Wallet may hold many unrelated/spam NFTs; fetching every wallet collection
  // would waste API credits and delay this small recovery inventory.
  const slugs = [...new Set(items.flatMap((item) => {
    const display = displayByIdentity.get(`${item.collection}:${item.tokenId}`);
    return [display?.collectionSlug ?? item.collectionSlug].filter(Boolean);
  }))].slice(0, MAX_COLLECTIONS);
  const floorEntries = await Promise.all(slugs.map(async (slug) => {
    try { return [slug, await provider.collectionFloor(slug)]; }
    catch { return [slug, null]; }
  }));
  const floors = new Map(floorEntries);
  const enriched = Object.freeze(items.map((item) => {
    const display = displayByIdentity.get(`${item.collection}:${item.tokenId}`);
    return Object.freeze({
      ...item,
      name: item.name ?? display?.name ?? null,
      imageUrl: item.imageUrl ?? display?.imageUrl ?? null,
      collectionSlug: display?.collectionSlug ?? null,
      floorPrice: display?.collectionSlug ? floors.get(display.collectionSlug) ?? null : null,
    });
  }));
  portfolioCache.set(cacheKey, { createdAt: now, expiresAt: now + CACHE_TTL_MS, items: enriched });
  return enriched;
}
