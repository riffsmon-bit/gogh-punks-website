import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";
import { enrichOriginalPunkArtwork } from "./_shared/original-punk-artwork.mjs";

// Public display metadata only. These IDs do not establish who owns a Punk;
// browser ownership verification and every action's live checks remain required.
export default async function handler(request, { enrich = enrichOriginalPunkArtwork } = {}) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const parameters = new URL(request.url).searchParams;
  const raw = parameters.get("tokenIds");
  if (parameters.getAll("tokenIds").length !== 1 || typeof raw !== "string" || raw.length > 159) {
    return json({ ok: false, code: "INVALID_PUNK_ARTWORK_IDS" }, 400);
  }
  const tokenIds = raw.split(",");
  if (!tokenIds.length || tokenIds.length > 32 || new Set(tokenIds).size !== tokenIds.length
    || tokenIds.some(id => !/^(0|[1-9]\d{0,3})$/.test(id) || Number(id) > 5_016)) {
    return json({ ok: false, code: "INVALID_PUNK_ARTWORK_IDS" }, 400);
  }
  let artworks = tokenIds.map(tokenId => ({ tokenId, artwork: null }));
  try { artworks = await enrich(artworks); } catch { /* Display outage, never an ownership failure. */ }
  // Keep even maximum-sized allowed embedded images below the function's
  // response limit. The browser can request unavailable IDs in its next batch.
  let imageCharacters = 0;
  artworks = artworks.map(item => {
    const length = item.artwork?.imageUrl?.length ?? 0;
    if (imageCharacters + length > 2_000_000) return { tokenId: item.tokenId, artwork: null };
    imageCharacters += length;
    return item;
  });
  const complete = artworks.every(item => Boolean(item.artwork?.imageUrl));
  return json({ ok: true, chainId: ROBINHOOD.chainId, collection: ROBINHOOD.canonicalCollection,
    artworks, complete }, 200, { "cache-control": complete ? "public, max-age=3600" : "public, max-age=15" });
}

export const config = { path: "/api/broker/punk-artwork", method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowLimit: 30, windowSize: 60 } };
