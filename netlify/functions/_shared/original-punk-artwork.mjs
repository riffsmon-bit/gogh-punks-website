import { createPublicClient, http, parseAbi } from "viem";
import { ROBINHOOD } from "../../../broker/src/config.mjs";
import { readOnchainNftDisplay } from "../../../broker/src/metadata/onchain-nft-display.mjs";

const TOKEN_URI_ABI = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);
const CACHE_TTL_MS = 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15_000;
const MAX_METADATA_LENGTH = 512_000;
const MAX_IMAGE_LENGTH = 256_000;

function artworkClient(environment = process.env) {
  const url = new URL(environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL ?? ROBINHOOD.rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new TypeError("Punk artwork RPC is invalid");
  }
  return createPublicClient({ cacheTime: 0, transport: http(url.href, {
    retryCount: 0, timeout: 1_800,
  }) });
}

function originalTokenId(value) {
  return typeof value === "string" && /^(0|[1-9]\d{0,3})$/.test(value)
    && Number(value) <= 5_016;
}

async function bounded(read, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("ARTWORK_TIMEOUT")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Display only: neither metadata nor this cache establishes ownership or wallet
// authority. The caller's candidate identities and all other fields are retained.
export function createOriginalPunkArtworkEnricher({
  client, now = Date.now, maximumReads = 32, concurrency = 8, timeoutMs = 2_000,
  cacheEntries = 512,
} = {}) {
  if (typeof now !== "function" || !Number.isSafeInteger(maximumReads) || maximumReads < 1 || maximumReads > 32
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_000
    || !Number.isSafeInteger(cacheEntries) || cacheEntries < 1 || cacheEntries > 512) {
    throw new TypeError("Punk artwork bounds are invalid");
  }
  const cache = new Map(), pending = new Map();
  let lastAttempted = -1;
  function cached(id, timestamp) {
    const entry = cache.get(id);
    return entry && entry.createdAt <= timestamp && entry.expiresAt > timestamp ? entry : null;
  }
  function save(id, artwork) {
    const timestamp = now();
    cache.delete(id);
    cache.set(id, { artwork, createdAt: timestamp,
      expiresAt: timestamp + (artwork ? CACHE_TTL_MS : FAILURE_TTL_MS) });
    while (cache.size > cacheEntries) cache.delete(cache.keys().next().value);
  }
  return async function enrichOriginalPunkArtwork(punks) {
    if (!Array.isArray(punks) || punks.length > 5_017) throw new TypeError("Punk artwork candidates are invalid");
    const timestamp = now();
    const missing = [...new Set(punks.filter(item => originalTokenId(item?.tokenId)
      && !item.artwork?.imageUrl).map(item => item.tokenId))];
    if (!missing.length) return punks;
    const eligible = missing.filter(id => !cached(id, timestamp) && !pending.has(id))
      .sort((a, b) => Number(a) - Number(b));
    // Rotate across uncached IDs, including failed lookups, so repeated refreshes
    // do not permanently stop at the first bounded batch of a large roster.
    const ordered = [...eligible.filter(id => Number(id) > lastAttempted),
      ...eligible.filter(id => Number(id) <= lastAttempted)].slice(0, maximumReads);
    const results = new Map(missing.flatMap(id => {
      const entry = cached(id, timestamp);
      return entry?.artwork ? [[id, entry.artwork]] : [];
    }));
    const existing = missing.flatMap(id => pending.has(id) ? [[id, pending.get(id)]] : []);
    let source;
    if (ordered.length) {
      try {
        source = client ?? artworkClient();
        if (await bounded(() => source.getChainId(), timeoutMs) !== ROBINHOOD.chainId) source = null;
      } catch { source = null; }
    }
    const load = async id => {
      let artwork = null;
      try {
        if (source) {
          const uri = await bounded(() => source.readContract({ address: ROBINHOOD.canonicalCollection,
            abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [BigInt(id)],
          }), timeoutMs);
          // The original collection embeds its JSON and SVG. Do not follow
          // arbitrary token metadata URLs or add per-card gateway requests.
          if (typeof uri === "string" && uri.length <= MAX_METADATA_LENGTH
            && uri.startsWith("data:application/json")) {
            const display = await readOnchainNftDisplay(uri);
            if (display?.imageUrl?.length <= MAX_IMAGE_LENGTH
              && /^data:image\/(?:svg\+xml|png);base64,/.test(display.imageUrl)) {
              artwork = Object.freeze({ status: "AVAILABLE", name: display.name ?? `Gogh Punk #${id}`,
                description: null, imageUrl: display.imageUrl, collectionSlug: "gogh-punks-255843210",
                tokenStandard: "ERC721", traits: null,
                openSeaUrl: `https://opensea.io/assets/robinhood/${ROBINHOOD.canonicalCollection}/${id}`,
                fetchedAt: new Date(now()).toISOString() });
            }
          }
        }
      } catch { /* Decoration failures must never remove ownership candidates. */ }
      save(id, artwork);
      return artwork;
    };
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, async () => {
      while (cursor < ordered.length) {
        const id = ordered[cursor++];
        lastAttempted = Number(id);
        // Another request can populate the cache while this request checks its chain.
        const ready = cached(id, now());
        if (ready) { if (ready.artwork) results.set(id, ready.artwork); continue; }
        let read = pending.get(id);
        if (!read) {
          read = load(id);
          pending.set(id, read);
          read.finally(() => { if (pending.get(id) === read) pending.delete(id); });
        }
        const artwork = await read;
        if (artwork) results.set(id, artwork);
      }
    }));
    await Promise.all(existing.map(async ([id, read]) => {
      const artwork = await read;
      if (artwork) results.set(id, artwork);
    }));
    return Object.freeze(punks.map(item => !item?.artwork?.imageUrl && results.has(item?.tokenId)
      ? Object.freeze({ ...item, artwork: results.get(item.tokenId) }) : item));
  };
}

export const enrichOriginalPunkArtwork = createOriginalPunkArtworkEnricher();
