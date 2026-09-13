import { isIP } from "node:net";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const LOCAL_DOMAINS = ["localhost", "localdomain", "local", "internal", "home.arpa"];
// ROBINHOOD_CONTRACT is a mainnet-only kind (4663). Keep testnet out of
// that resolver lane without changing the established normalized link shape.
const MAINNET_EXPLORERS = new Set([
  "explorer.chain.robinhood.com", "robinhoodchain.blockscout.com",
]);

export class ArtBrokerLinkError extends Error {
  constructor(code, message) { super(message); this.name = "ArtBrokerLinkError"; this.code = code; }
}
function fail(code, message) { throw new ArtBrokerLinkError(code, message); }

function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  // WHATWG parsing canonicalizes numeric IPv4 aliases before this check.
  // Reject all IP literals, including IPv6 and mapped IPv4; only DNS names
  // are supported. This is syntactic validation, not DNS/redirect protection.
  if (isIP(literal) !== 0 || !host.includes(".")
    || LOCAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    fail("PRIVATE_URL_BLOCKED", "IP literals and local network links are not accepted.");
  }
  if (host.length > 253 || !host.split(".").every((label) => DNS_LABEL.test(label))) {
    fail("INVALID_URL", "The link must have a valid public hostname.");
  }
  return host;
}

export function normalizeArtBrokerLink(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length > 2_048
    || /[\u0000-\u0020\u007f\\]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) {
    fail("INVALID_URL", "Paste a complete HTTPS link.");
  }
  // Require an explicit authority and reject parser repairs such as https:host,
  // extra slashes, credentials, default-port elision and empty fragments.
  const parts = /^https:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?$/i.exec(value);
  if (!parts) fail("INVALID_URL", "Only clean HTTPS links are supported.");
  let url;
  try { url = new URL(value); } catch { fail("INVALID_URL", "This is not a valid URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    fail("INVALID_URL", "Only clean HTTPS links are supported.");
  }
  const host = publicHost(url.hostname);
  if (/[@:%]/.test(parts[1])) fail("INVALID_URL", "Only clean HTTPS links are supported.");
  if (host === "explorer.testnet.chain.robinhood.com") {
    fail("UNSUPPORTED_CHAIN", "Only Robinhood mainnet (4663) explorer links are supported.");
  }
  const knownPlatform = host === "opensea.io" || host === "x.com" || host === "twitter.com"
    || MAINNET_EXPLORERS.has(host);
  if (knownPlatform && (parts[2] !== url.pathname || /\/\//.test(url.pathname))) {
    fail("INVALID_URL", "Use a direct platform link without ambiguous path segments.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "opensea.io") {
    const collection = segments[0] === "collection" && SLUG.test(segments[1] ?? "")
      && (segments.length === 2 || segments.length === 3 && segments[2] === "overview");
    const drop = segments[0] === "drops" && SLUG.test(segments[1] ?? "") && segments.length === 2;
    if (!collection && !drop) fail("UNSUPPORTED_URL", "This OpenSea link is not a collection or drop.");
    if (value.includes("?")) fail("INVALID_URL", "Remove query parameters from this OpenSea link.");
    const kind = drop ? "DROP" : "COLLECTION";
    return Object.freeze({ kind: `OPENSEA_${kind}`, host, identity: segments[1],
      canonicalUrl: `https://opensea.io/${drop ? "drops" : "collection"}/${segments[1]}` });
  }
  if (host === "x.com" || host === "twitter.com") {
    const status = segments.length === 3 && X_HANDLE.test(segments[0])
      && segments[1] === "status" && /^\d{5,24}$/.test(segments[2]);
    if (!status || value.includes("?") && !/^\?s=\d{1,3}$/.test(url.search)) {
      fail("UNSUPPORTED_URL", "Paste a direct X post link.");
    }
    return Object.freeze({ kind: "X_POST", host: "x.com", identity: segments[2],
      canonicalUrl: `https://x.com/${segments[0]}/status/${segments[2]}` });
  }
  if (MAINNET_EXPLORERS.has(host)) {
    if (segments.length !== 2 || segments[0] !== "address"
      || !ADDRESS.test(segments[1].toLowerCase())) {
      fail("UNSUPPORTED_URL", "Paste a direct Robinhood mainnet contract address link.");
    }
    if (value.includes("?")) fail("INVALID_URL", "Remove query parameters from this explorer link.");
    return Object.freeze({ kind: "ROBINHOOD_CONTRACT", host,
      identity: segments[1].toLowerCase(), canonicalUrl: `https://${host}/address/${segments[1].toLowerCase()}` });
  }
  return Object.freeze({ kind: "PROJECT_WEBSITE", host, identity: null,
    canonicalUrl: `https://${host}${url.pathname}${url.search}` });
}

export async function inspectArtBrokerLink(value, { resolvers = {} } = {}) {
  const normalized = normalizeArtBrokerLink(value);
  const resolver = resolvers[normalized.kind];
  if (typeof resolver !== "function") return Object.freeze({ link: normalized,
    status: "NEEDS_REVIEW", executable: false, reason: "NO_TRUSTED_RESOLVER",
    externalTransactionAccepted: false });
  const evidence = await resolver(normalized);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail("INVALID_RESOLVER_RESULT", "The trusted resolver returned invalid evidence.");
  }
  return Object.freeze({ link: normalized, status: evidence.status ?? "NEEDS_REVIEW",
    executable: false, reason: evidence.reason ?? null, evidence: Object.freeze({ ...evidence }),
    externalTransactionAccepted: false });
}
