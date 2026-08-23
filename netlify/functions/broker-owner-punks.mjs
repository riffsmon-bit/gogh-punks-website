import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";

const MAX_CANDIDATES = 50;

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

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const owner = address(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ ok: false, code: "INVALID_OWNER" }, 400);
  try {
    return json({
      ok: true,
      chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection,
      owner,
      candidateTokenIds: await indexedOwnerPunkIds(owner),
      evidence: "INDEXED_CANDIDATES_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK",
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
