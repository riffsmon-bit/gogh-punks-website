import { getDatabase } from "@netlify/database";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import automationManifest from "../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { json } from "./_shared/http.mjs";
import { nftDisplayMetadata, NFT_DISPLAY_METADATA_SELECT } from
  "./_shared/broker-display-metadata.mjs";

const MAX_CANDIDATES = 200;
const OPENSEA_COLLECTION_SLUG = "gogh-punks-255843210";
const OPENSEA_RESPONSE_BYTES = 1_000_000;
const OPENSEA_PAGE_LIMIT = 200;
const OPENSEA_MAX_PAGES = 3;
const AUTOMATION_ROSTER_LIMIT = 32;
const GOGH_PUNKS_MAX_SUPPLY = 5_016;
const OPENSEA_IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);
const OWNER_DISCOVERY_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const AUTOMATION_REGISTRY_ABI = parseAbi([
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
]);
const OWNER_SCAN_CHUNK = 200;
const OWNER_SCAN_CONCURRENCY = 4;
const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";

function own(value, key) {
  return value && typeof value === "object" && Object.hasOwn(value, key)
    ? value[key] : undefined;
}

function boundedText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function openSeaImageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OPENSEA_IMAGE_HOSTS.has(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

export function proposedRetirementTierForOpenSeaRank(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > GOGH_PUNKS_MAX_SUPPLY) return null;
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.01)) return "MYTHIC";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.05)) return "LEGENDARY";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.15)) return "EPIC";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.35)) return "RARE";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.60)) return "UNCOMMON";
  return "COMMON";
}

function openSeaDecoration(nft, tokenId) {
  const imageUrl = ["display_image_url", "image_url", "original_image_url"]
    .map((key) => openSeaImageUrl(own(nft, key))).find(Boolean) ?? null;
  const rarityValue = own(nft, "rarity");
  const rankValue = own(rarityValue, "rank");
  const rank = Number.isSafeInteger(rankValue) && rankValue >= 1
    && rankValue <= GOGH_PUNKS_MAX_SUPPLY ? rankValue : null;
  const proposedTier = proposedRetirementTierForOpenSeaRank(rank);
  return Object.freeze({
    tokenId,
    artwork: Object.freeze({
      status: "AVAILABLE",
      name: boundedText(own(nft, "name"), 200) ?? `Gogh Punk #${tokenId}`,
      description: null,
      imageUrl,
      collectionSlug: OPENSEA_COLLECTION_SLUG,
      tokenStandard: "ERC721",
      traits: null,
      openSeaUrl: `https://opensea.io/assets/robinhood/${ROBINHOOD.canonicalCollection}/${tokenId}`,
      fetchedAt: null,
    }),
    rarity: rank && proposedTier ? Object.freeze({
      source: "OPENSEA_OPENRARITY_CURRENT",
      rank,
      proposedTier,
      rankBandSupply: GOGH_PUNKS_MAX_SUPPLY,
      strategyId: boundedText(own(rarityValue, "strategy_id"), 96),
      strategyVersion: boundedText(own(rarityValue, "strategy_version"), 96),
      permanentSnapshot: false,
    }) : null,
  });
}

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function ownerDiscoveryClient(environment = process.env) {
  const raw = environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL ?? ROBINHOOD.rpcUrl;
  let rpcUrl;
  try { rpcUrl = new URL(raw); } catch { throw new TypeError("owner discovery RPC is invalid"); }
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password || rpcUrl.hash) {
    throw new TypeError("owner discovery RPC is invalid");
  }
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: ROBINHOOD.name,
    nativeCurrency: ROBINHOOD.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl.href] } },
    contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
  });
  return createPublicClient({
    chain,
    transport: http(rpcUrl.href, { retryCount: 1, timeout: 5_000 }),
  });
}

async function liveOwnedFromCandidates(client, owner, tokenIds) {
  const output = [];
  for (let offset = 0; offset < tokenIds.length; offset += OWNER_SCAN_CHUNK) {
    const chunk = tokenIds.slice(offset, offset + OWNER_SCAN_CHUNK);
    const results = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((tokenId) => ({
        address: ROBINHOOD.canonicalCollection,
        abi: OWNER_DISCOVERY_ABI,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      })),
    });
    if (!Array.isArray(results) || results.length !== chunk.length) {
      throw new TypeError("owner discovery result count changed");
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const result = results[index];
      if (result?.status === "success" && address(result.result) === owner) output.push(chunk[index]);
    }
  }
  return output;
}

export async function liveOwnerPunkIds(owner, candidateTokenIds = [], {
  client = ownerDiscoveryClient(),
} = {}) {
  const normalized = address(owner);
  if (!normalized || !Array.isArray(candidateTokenIds)
    || candidateTokenIds.length > MAX_CANDIDATES
    || candidateTokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || typeof client?.readContract !== "function" || typeof client?.multicall !== "function") {
    throw new TypeError("live owner discovery input is invalid");
  }
  const balance = await client.readContract({
    address: ROBINHOOD.canonicalCollection,
    abi: OWNER_DISCOVERY_ABI,
    functionName: "balanceOf",
    args: [normalized],
  });
  if (typeof balance !== "bigint" || balance < 0n || balance > BigInt(MAX_CANDIDATES)) {
    throw new RangeError("live owner Punk balance is outside the UI bound");
  }
  if (balance === 0n) return Object.freeze([]);

  const boundedCandidates = [...new Set(candidateTokenIds)];
  const verifiedCandidates = await liveOwnedFromCandidates(client, normalized, boundedCandidates);
  if (BigInt(verifiedCandidates.length) === balance) {
    return Object.freeze(verifiedCandidates.sort((left, right) => Number(left) - Number(right)));
  }

  // The local ownership index and marketplace cache are acceleration hints, not completeness
  // evidence. Only when their live-verified count differs from balanceOf do we scan the bounded
  // 5,017-token collection. Four workers keep this to 26 server-side Multicall reads rather than
  // 5,017 wallet-provider requests; the browser still performs its own live verification.
  const chunks = [];
  for (let first = 0; first <= GOGH_PUNKS_MAX_SUPPLY; first += OWNER_SCAN_CHUNK) {
    chunks.push(Array.from({
      length: Math.min(OWNER_SCAN_CHUNK, GOGH_PUNKS_MAX_SUPPLY - first + 1),
    }, (_, index) => String(first + index)));
  }
  const output = [];
  let cursor = 0;
  const scan = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor];
      cursor += 1;
      output.push(...await liveOwnedFromCandidates(client, normalized, chunk));
    }
  };
  await Promise.all(Array.from({ length: Math.min(OWNER_SCAN_CONCURRENCY, chunks.length) }, scan));
  output.sort((left, right) => Number(left) - Number(right));
  if (BigInt(output.length) !== balance || new Set(output).size !== output.length) {
    throw new TypeError("live owner discovery did not reconcile the wallet balance");
  }
  return Object.freeze(output);
}

export async function createdAutomationV3PunkIds(tokenIds, {
  client = ownerDiscoveryClient(),
  registry = automationManifest?.contracts?.GoghPunkAccountRegistryV3?.address,
} = {}) {
  const normalizedRegistry = address(registry);
  if (!normalizedRegistry || !Array.isArray(tokenIds) || tokenIds.length > MAX_CANDIDATES
    || tokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || typeof client?.multicall !== "function") {
    throw new TypeError("V3 Punk wallet discovery input is invalid");
  }
  if (tokenIds.length === 0) return Object.freeze([]);
  const results = await client.multicall({
    allowFailure: true,
    contracts: tokenIds.map((tokenId) => ({
      address: normalizedRegistry,
      abi: AUTOMATION_REGISTRY_ABI,
      functionName: "isAccountCreated",
      args: [BigInt(tokenId)],
    })),
  });
  if (!Array.isArray(results) || results.length !== tokenIds.length) {
    throw new TypeError("V3 Punk wallet discovery result count changed");
  }
  return Object.freeze(tokenIds.filter((_, index) => (
    results[index]?.status === "success" && results[index].result === true
  )));
}

export async function indexedOwnerPunkIds(owner, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  const result = await query(
    `SELECT token_id
       FROM broker_punks
      WHERE chain_id = $1
        AND collection_address = $2
        AND LOWER(owner_snapshot) = $3
      ORDER BY token_id::numeric
      LIMIT $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized, MAX_CANDIDATES + 1],
  );
  if (!Array.isArray(result?.rows) || result.rows.length > MAX_CANDIDATES) {
    throw new RangeError("indexed owner Punk candidate set is unavailable or too large");
  }
  const tokenIds = result.rows.map(({ token_id: tokenId }) => String(tokenId));
  if (tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(tokenId))) {
    throw new TypeError("indexed owner Punk token is invalid");
  }
  return Object.freeze([...new Set(tokenIds)]);
}

export async function ownerPunkArtwork(tokenIds, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  if (!Array.isArray(tokenIds) || tokenIds.length > MAX_CANDIDATES
    || tokenIds.some((value) => punkTokenId(String(value)) !== String(value))) {
    throw new TypeError("owner Punk artwork input is invalid");
  }
  if (tokenIds.length === 0) return Object.freeze([]);
  const result = await query(
    `SELECT nft_metadata.token_id, ${NFT_DISPLAY_METADATA_SELECT}
       FROM broker_nft_metadata AS nft_metadata
      WHERE nft_metadata.chain_id = $1
        AND nft_metadata.collection_address = $2
        AND nft_metadata.token_id = ANY($3::numeric[])
      ORDER BY nft_metadata.token_id`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenIds],
  );
  const byToken = new Map((result.rows ?? []).map((row) => [String(row.token_id), row]));
  return Object.freeze(tokenIds.map((id) => Object.freeze({
    tokenId: id,
    artwork: Object.freeze(nftDisplayMetadata(byToken.get(id) ?? {})),
  })));
}

function punkTokenId(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9_999 ? String(parsed) : null;
}

export function configuredAutomationPunkIds(environment = process.env) {
  const raw = environment.BROKER_AUTOMATION_V3_PUNK_IDS;
  if (raw === undefined || raw === "") return Object.freeze([]);
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length > 384) {
    throw new TypeError("automation Punk roster is invalid");
  }
  const tokenIds = raw.split(",");
  if (tokenIds.length < 1 || tokenIds.length > AUTOMATION_ROSTER_LIMIT
    || tokenIds.some((tokenId) => punkTokenId(tokenId) !== tokenId)
    || new Set(tokenIds).size !== tokenIds.length) {
    throw new TypeError("automation Punk roster is invalid");
  }
  return Object.freeze([...tokenIds].sort((left, right) => Number(left) - Number(right)));
}

export async function enrolledAutomationPunkIds(owner, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  const result = await query(
    `SELECT token_id::text AS token_id
       FROM broker_automation_v3_enrollments
      WHERE chain_id = $1
        AND collection_address = $2
        AND LOWER(owner_snapshot) = $3
      ORDER BY token_id::numeric
      LIMIT $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized, MAX_CANDIDATES + 1],
  );
  if (!Array.isArray(result?.rows) || result.rows.length > MAX_CANDIDATES) {
    throw new RangeError("automation enrollment set is unavailable or too large");
  }
  const tokenIds = result.rows.map(({ token_id: value }) => punkTokenId(String(value)));
  if (tokenIds.some((value) => value === null)) {
    throw new TypeError("automation enrollment token is invalid");
  }
  return Object.freeze([...new Set(tokenIds)]);
}

async function boundedJson(response, source = "Owner candidate") {
  const declared = response.headers?.get?.("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > OPENSEA_RESPONSE_BYTES) {
    throw new RangeError(`${source} response is too large`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > OPENSEA_RESPONSE_BYTES) {
    throw new RangeError(`${source} response is too large`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new TypeError(`${source} response is not valid JSON`);
  }
}

export async function openSeaOwnerPunks(owner, {
  apiKey,
  fetchFn = fetch,
  timeoutMs = 8_000,
  maximumPages = OPENSEA_MAX_PAGES,
} = {}) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  if (typeof apiKey !== "string" || apiKey.trim().length < 8 || apiKey.length > 512) {
    throw new TypeError("OpenSea API key is unavailable");
  }
  if (typeof fetchFn !== "function" || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000 || timeoutMs > 30_000
    || !Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > 5) {
    throw new TypeError("OpenSea owner discovery configuration is invalid");
  }

  const output = new Map();
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maximumPages; page += 1) {
    const endpoint = new URL(`https://api.opensea.io/api/v2/chain/robinhood/account/${normalized}/nfts`);
    endpoint.searchParams.set("collection", OPENSEA_COLLECTION_SLUG);
    endpoint.searchParams.set("limit", String(OPENSEA_PAGE_LIMIT));
    if (cursor) endpoint.searchParams.set("next", cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(endpoint, {
        method: "GET",
        headers: Object.freeze({ accept: "application/json", "x-api-key": apiKey.trim() }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw new Error(`OpenSea owner request failed (${response?.status ?? "unknown"})`);
      }
      const payload = await boundedJson(response, "OpenSea owner");
      const nfts = own(payload, "nfts");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || !Array.isArray(nfts) || nfts.length > OPENSEA_PAGE_LIMIT) {
        throw new TypeError("OpenSea owner response has an invalid NFT list");
      }
      for (const nft of nfts) {
        if (!nft || typeof nft !== "object" || Array.isArray(nft)) continue;
        if (address(own(nft, "contract")) !== ROBINHOOD.canonicalCollection) continue;
        if (own(nft, "collection") !== undefined
          && own(nft, "collection") !== OPENSEA_COLLECTION_SLUG) continue;
        const tokenId = punkTokenId(own(nft, "identifier"));
        if (tokenId) output.set(tokenId, openSeaDecoration(nft, tokenId));
        if (output.size > MAX_CANDIDATES) throw new RangeError("OpenSea Punk candidate set is too large");
      }
      const next = own(payload, "next");
      if (next === null || next === undefined || next === "") break;
      if (typeof next !== "string" || next.length > 1_024
        || cursors.has(next)) throw new TypeError("OpenSea owner cursor is invalid");
      cursors.add(next);
      cursor = next;
    } finally {
      clearTimeout(timeout);
    }
  }
  return Object.freeze([...output.values()].sort((left, right) => (
    Number(left.tokenId) - Number(right.tokenId)
  )));
}

export async function openSeaOwnerPunkIds(owner, options) {
  const punks = await openSeaOwnerPunks(owner, options);
  return Object.freeze(punks.map(({ tokenId }) => tokenId));
}

export function mergeOwnerPunkDecorations(
  tokenIds,
  cachedPunks,
  openSeaPunks,
  automationTokenIds = [],
  automationCreatedTokenIds = [],
) {
  if (!Array.isArray(tokenIds) || !Array.isArray(cachedPunks)
    || !Array.isArray(openSeaPunks) || !Array.isArray(automationTokenIds)
    || !Array.isArray(automationCreatedTokenIds)
    || automationTokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || automationCreatedTokenIds.some((value) => punkTokenId(String(value)) !== String(value))) {
    throw new TypeError("owner Punk decorations are invalid");
  }
  const cached = new Map(cachedPunks.map((item) => [String(item?.tokenId), item]));
  const external = new Map(openSeaPunks.map((item) => [String(item?.tokenId), item]));
  const automation = new Set(automationTokenIds);
  const automationCreated = new Set(automationCreatedTokenIds);
  return Object.freeze(tokenIds.map((tokenId) => {
    const cacheItem = cached.get(tokenId);
    const openSeaItem = external.get(tokenId);
    const cachedArtwork = cacheItem?.artwork ?? null;
    const artwork = cachedArtwork?.imageUrl ? cachedArtwork : openSeaItem?.artwork ?? cachedArtwork;
    return Object.freeze({
      tokenId,
      artwork: artwork ?? null,
      rarity: openSeaItem?.rarity ?? null,
      automationConfigured: automation.has(tokenId),
      automationCreated: automationCreated.has(tokenId),
    });
  }));
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const owner = address(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ ok: false, code: "INVALID_OWNER" }, 400);
  try {
    const automationRoster = configuredAutomationPunkIds();
    const [indexedResult, enrollmentResult] = await Promise.allSettled([
      indexedOwnerPunkIds(owner),
      enrolledAutomationPunkIds(owner),
    ]);
    // This route only supplies discovery hints. The browser's bounded Multicall scan and the
    // selection-time ownerOf check remain authoritative, so an index outage may return an empty
    // hint set instead of blocking the holder behind an unrelated marketplace API.
    const enrolled = enrollmentResult.status === "fulfilled" ? enrollmentResult.value : [];
    const automationTokenIds = [...new Set([...automationRoster, ...enrolled])];
    let candidateTokenIds = [...new Set([
      ...(indexedResult.status === "fulfilled" ? indexedResult.value : []),
      ...automationTokenIds,
    ])].sort((left, right) => Number(left) - Number(right));
    if (candidateTokenIds.length > MAX_CANDIDATES) throw new RangeError("owner candidate set is too large");
    let openSeaPunks = [];
    let openSeaAvailable = false;
    if (process.env.OPENSEA_API_KEY) {
      try {
        // This route is called only after an owner connects. OpenSea is a bounded discovery hint
        // that fills recently transferred/activated Punks which have not reached the local index
        // yet; every returned ID is still live-verified through Multicall in the browser.
        openSeaPunks = await openSeaOwnerPunks(owner, {
          apiKey: process.env.OPENSEA_API_KEY,
          timeoutMs: 2_500,
        });
        openSeaAvailable = true;
        candidateTokenIds = [...new Set([
          ...candidateTokenIds,
          ...openSeaPunks.map(({ tokenId }) => tokenId),
        ])].sort((left, right) => Number(left) - Number(right));
      } catch (error) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_OPENSEA_FALLBACK_UNAVAILABLE", type: error?.name,
        }));
      }
    }
    let liveOwnerAvailable = false;
    try {
      // Complete the fast index/marketplace hints only when balanceOf proves they are stale. The
      // resulting list is still a server hint; browser Multicall remains the UI authority.
      candidateTokenIds = [...await liveOwnerPunkIds(owner, candidateTokenIds)];
      liveOwnerAvailable = true;
    } catch (primaryError) {
      try {
        // A keyed provider is preferred, but Punk discovery must not disappear when that provider
        // is rate-limited or misconfigured. The canonical public RPC is a read-only completion
        // fallback used only for this owner-triggered request.
        candidateTokenIds = [...await liveOwnerPunkIds(owner, candidateTokenIds, {
          client: ownerDiscoveryClient({ ROBINHOOD_RPC_URL: ROBINHOOD.rpcUrl }),
        })];
        liveOwnerAvailable = true;
      } catch (fallbackError) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_LIVE_COMPLETION_UNAVAILABLE",
          primaryType: primaryError?.name,
          fallbackType: fallbackError?.name,
        }));
      }
    }
    if (candidateTokenIds.length > MAX_CANDIDATES) throw new RangeError("owner candidate set is too large");
    let automationCreatedTokenIds = [];
    let automationWalletsAvailable = false;
    try {
      automationCreatedTokenIds = [...await createdAutomationV3PunkIds(candidateTokenIds)];
      automationWalletsAvailable = true;
    } catch (primaryError) {
      try {
        automationCreatedTokenIds = [...await createdAutomationV3PunkIds(candidateTokenIds, {
          client: ownerDiscoveryClient({ ROBINHOOD_RPC_URL: ROBINHOOD.rpcUrl }),
        })];
        automationWalletsAvailable = true;
      } catch (fallbackError) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_V3_WALLETS_UNAVAILABLE",
          primaryType: primaryError?.name,
          fallbackType: fallbackError?.name,
        }));
      }
    }
    let cachedPunks = [];
    let artworkAvailable = false;
    try {
      // Initial discovery does not need artwork for every inactive Punk. Active/enrolled cards
      // may use cached decoration immediately; a newly selected Punk hydrates from tokenURI.
      cachedPunks = await ownerPunkArtwork([...new Set([
        ...automationTokenIds, ...automationCreatedTokenIds,
      ])]);
      artworkAvailable = true;
    } catch (error) {
      // Artwork is decoration, never authority. A metadata/index outage must not prevent
      // a holder from seeing and live-verifying their Punk IDs.
      console.error(JSON.stringify({
        event: "BROKER_OWNER_PUNK_ARTWORK_UNAVAILABLE", type: error?.name,
      }));
    }
    const candidatePunks = mergeOwnerPunkDecorations(
      candidateTokenIds,
      cachedPunks,
      openSeaPunks,
      automationTokenIds,
      automationCreatedTokenIds,
    );
    return json({
      ok: true,
      chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection,
      owner,
      candidateTokenIds,
      candidatePunks,
      candidateSources: Object.freeze({
        indexed: indexedResult.status === "fulfilled",
        openSea: openSeaAvailable,
        liveOwnerComplete: liveOwnerAvailable,
        liveMulticall: true,
        automationRoster: automationRoster.length > 0,
        automationEnrollments: enrollmentResult.status === "fulfilled",
        automationWallets: automationWalletsAvailable,
        artwork: artworkAvailable,
      }),
      evidence: "DISCOVERY_CANDIDATES_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK",
      activationAuthorized: false,
      autonomyAuthorized: false,
    }, 200, { "cache-control": "private, no-store" });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_OWNER_PUNKS_FAILED", type: error?.name }));
    return json({ ok: false, code: "OWNER_PUNK_CANDIDATES_UNAVAILABLE" }, 503,
      { "cache-control": "private, no-store" });
  }
}

export const config = {
  path: "/api/broker/owner-punks",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 30,
    windowSize: 60,
  },
};
