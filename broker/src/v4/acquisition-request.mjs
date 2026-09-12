import { normalizeArtBrokerLink } from "./link-scanner.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO = `0x${"0".repeat(40)}`;
const SPECIFIC = /\b(?:this|that|specific)\s+(?:mint|collection|contract|project)\b/i;

// Recognize acquisition requests before applying ordinary collecting preferences.
// Marketplace execution is not part of the deployed free-mint strategy schema.
export function acquisitionRequest(message) {
  const text = String(message);
  const offerText = text.replace(/\b(?:no|without|never|do not|don't)\s+(?:(?:make|place|submit|create|any|weth|collection)\s+){0,3}(?:offers?|bids?)\b/gi, "");
  if (/\b(?:offers?|bids?)\b/i.test(offerText)
    && !/^(?:what|how|why|explain|tell me about)\b/i.test(text)) {
    return { kind: "COLLECTION_OFFER", blocked: "COLLECTION_OFFERS_UNAVAILABLE" };
  }
  if (/\bsweep(?:ing)?\b|\b(?:buy|purchase|pick up)\b.*\b(?:nfts?|floor|cheapest|tokens?|collection)\b/i.test(text)
    && !/^(?:what|how|why|explain|tell me about)\b/i.test(text)) {
    return { kind: "FLOOR_PURCHASE", blocked: "FLOOR_PURCHASES_UNAVAILABLE" };
  }
  const mint = /\b(?:mints?|minting|collect)\b/i.test(text);
  // Gas and reserve amounts are separate from a mint price. Preserve their
  // existing parser/defaults instead of making either mandatory in a prompt.
  const priced = /\bpaid\s+mints?\b|\b(?:price|pay|cost)\b[^.!?]*\b(?:eth|ether)\b|\bfor\s+(?:up to\s+)?(?:\.\d+|\d+(?:\.\d+)?)\s*(?:eth|ether)\b(?!\s+(?:gas|reserve))|\bspend\b[^.!?]*\b(?:eth|ether)\b[^.!?]*\b(?:on|per)\s+(?:a\s+)?mint\b/i.test(text);
  if (mint && priced) return { kind: "PAID_MINT", blocked: "PAID_MINTS_UNAVAILABLE" };

  const urls = [...text.matchAll(/https?:\/\/[^\s<>"“”]+/gi)]
    .map(([url]) => url.replace(/[.,;!?)]+$/, ""));
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"“”]+/gi, "");
  const addresses = [...new Set([...withoutUrls.matchAll(/\b0x[a-z0-9]+\b/gi)]
    .map(([address]) => address.toLowerCase()))];
  const directed = SPECIFIC.test(text) || mint && (urls.length > 0 || addresses.length > 0
    || /\bfrom\s+(?!Robinhood\b|(?:any|all)\s+(?:collection|source))|\b(?:collection|contract)\s+(?:called|named)\b/i.test(text));
  if (!directed) return null;
  if (urls.length + addresses.length > 1) return { kind: "DIRECTED_MINT", blocked: "TARGET_CONTRACT" };
  if (addresses.length === 1) return ADDRESS.test(addresses[0]) && addresses[0] !== ZERO
    ? { kind: "DIRECTED_MINT", targetContract: addresses[0] }
    : { kind: "DIRECTED_MINT", blocked: "TARGET_CONTRACT" };
  if (urls.length === 1) {
    try {
      const link = normalizeArtBrokerLink(urls[0]);
      if (link.kind === "ROBINHOOD_CONTRACT" && !link.host.includes("testnet") && link.identity !== ZERO) {
        return { kind: "DIRECTED_MINT", targetContract: link.identity };
      }
      if (link.kind === "OPENSEA_COLLECTION" || link.kind === "OPENSEA_DROP") {
        return { kind: "DIRECTED_MINT", link };
      }
    } catch { /* The owner must clarify an unsupported or malformed target. */ }
    return { kind: "DIRECTED_MINT", blocked: "TARGET_CONTRACT" };
  }
  return { kind: "DIRECTED_MINT" };
}

export function acquisitionClarification(field) {
  switch (field) {
    case "COLLECTION_OFFERS_UNAVAILABLE":
      return "WETH collection offers are not available in this broker yet. I have not created an offer or changed your mint mission. Offer review, publishing, cancellation, and settlement still need implementation.";
    case "FLOOR_PURCHASES_UNAVAILABLE":
      return "Floor purchases and sweeps are not available in this broker yet. I have not placed a purchase or changed your mint mission. Listing review, purchase execution, and receipt tracking still need implementation.";
    case "PAID_MINTS_UNAVAILABLE":
      return "Paid mint execution is not available in this V2 chat yet. I have not replaced your request with a free-mint mission. The paid-mint review and execution flow still needs to be connected.";
    case "TARGET_CONTRACT":
      return "Which exact collection should I mint from? Paste one Robinhood Chain collection contract address, or an OpenSea collection link already identified by discovery. An unknown link needs its contract address before I can create a directed mission.";
    default: return null;
  }
}

// Resolve only a server-indexed, unambiguous collection identity. This narrows
// the owner's target; live availability, code, policy and simulation still gate execution.
export async function readIndexedDirectedTarget(pool, request) {
  if (!request?.link || request.blocked) return null;
  const { identity, canonicalUrl } = request.link;
  const sources = [canonicalUrl, `https://opensea.io/collection/${identity}`,
    `https://opensea.io/collection/${identity}/overview`, `https://opensea.io/drops/${identity}`];
  const result = await pool.query(`SELECT DISTINCT collection_contract FROM broker_v2_opportunities
    WHERE chain_id = 4663 AND normalized->'sourceUrls' ?| $1::text[] LIMIT 2`, [sources]);
  const target = result.rows.length === 1 ? result.rows[0].collection_contract : null;
  return typeof target === "string" && ADDRESS.test(target) && target !== ZERO ? target : null;
}
