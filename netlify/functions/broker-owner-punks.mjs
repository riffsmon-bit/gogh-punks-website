import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";

const MAX_CANDIDATES = 200;
const OPENSEA_COLLECTION_SLUG = "gogh-punks-255843210";
const OPENSEA_RESPONSE_BYTES = 1_000_000;
const OPENSEA_PAGE_LIMIT = 200;
const OPENSEA_MAX_PAGES = 3;
const AUTOMATION_ROSTER_LIMIT = 32;

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
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

export async function openSeaOwnerPunkIds(owner, {
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

  const output = new Set();
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
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || !Array.isArray(payload.nfts) || payload.nfts.length > OPENSEA_PAGE_LIMIT) {
        throw new TypeError("OpenSea owner response has an invalid NFT list");
      }
      for (const nft of payload.nfts) {
        if (!nft || typeof nft !== "object" || Array.isArray(nft)) continue;
        if (address(nft.contract) !== ROBINHOOD.canonicalCollection) continue;
        if (nft.collection !== undefined && nft.collection !== OPENSEA_COLLECTION_SLUG) continue;
        const tokenId = punkTokenId(nft.identifier);
        if (tokenId) output.add(tokenId);
        if (output.size > MAX_CANDIDATES) throw new RangeError("OpenSea Punk candidate set is too large");
      }
      if (payload.next === null || payload.next === undefined || payload.next === "") break;
      if (typeof payload.next !== "string" || payload.next.length > 1_024
        || cursors.has(payload.next)) throw new TypeError("OpenSea owner cursor is invalid");
      cursors.add(payload.next);
      cursor = payload.next;
    } finally {
      clearTimeout(timeout);
    }
  }
  return Object.freeze([...output].sort((left, right) => Number(left) - Number(right)));
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const owner = address(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ ok: false, code: "INVALID_OWNER" }, 400);
  try {
    const automationRoster = configuredAutomationPunkIds();
    const [indexedResult, openSeaResult] = await Promise.allSettled([
      indexedOwnerPunkIds(owner),
      openSeaOwnerPunkIds(owner, { apiKey: process.env.OPENSEA_API_KEY }),
    ]);
    if (indexedResult.status !== "fulfilled" && openSeaResult.status !== "fulfilled") {
      throw new Error("all owner candidate sources unavailable");
    }
    const candidateTokenIds = [...new Set([
      ...(indexedResult.status === "fulfilled" ? indexedResult.value : []),
      ...(openSeaResult.status === "fulfilled" ? openSeaResult.value : []),
      ...automationRoster,
    ])].sort((left, right) => Number(left) - Number(right));
    if (candidateTokenIds.length > MAX_CANDIDATES) throw new RangeError("owner candidate set is too large");
    return json({
      ok: true,
      chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection,
      owner,
      candidateTokenIds,
      candidateSources: Object.freeze({
        indexed: indexedResult.status === "fulfilled",
        openSea: openSeaResult.status === "fulfilled",
        automationRoster: automationRoster.length > 0,
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
