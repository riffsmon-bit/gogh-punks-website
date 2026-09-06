const ADDRESS = /^0x[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "0.0.0.0", "127.0.0.1", "::1"]);

export class ArtBrokerLinkError extends Error {
  constructor(code, message) { super(message); this.name = "ArtBrokerLinkError"; this.code = code; }
}
function fail(code, message) { throw new ArtBrokerLinkError(code, message); }

function publicHost(hostname) {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) {
    fail("PRIVATE_URL_BLOCKED", "Local and private network links are not accepted.");
  }
  return host;
}

export function normalizeArtBrokerLink(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length > 2_048) {
    fail("INVALID_URL", "Paste a complete HTTPS link.");
  }
  let url;
  try { url = new URL(value); } catch { fail("INVALID_URL", "This is not a valid URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    fail("INVALID_URL", "Only clean HTTPS links are supported.");
  }
  const host = publicHost(url.hostname);
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "opensea.io") {
    const collection = segments[0] === "collection" && SLUG.test(segments[1] ?? "")
      && (segments.length === 2 || segments.length === 3 && segments[2] === "overview");
    const drop = segments[0] === "drops" && SLUG.test(segments[1] ?? "") && segments.length === 2;
    if (!collection && !drop) fail("UNSUPPORTED_URL", "This OpenSea link is not a collection or drop.");
    if ([...url.searchParams].length) fail("INVALID_URL", "Remove query parameters from this OpenSea link.");
    const kind = drop ? "DROP" : "COLLECTION";
    return Object.freeze({ kind: `OPENSEA_${kind}`, host, identity: segments[1],
      canonicalUrl: `https://opensea.io/${drop ? "drops" : "collection"}/${segments[1]}` });
  }
  if (host === "x.com" || host === "twitter.com") {
    const status = segments.length === 3 && segments[1] === "status" && /^\d{5,24}$/.test(segments[2]);
    if (!status || [...url.searchParams].some(([key]) => key !== "s")) {
      fail("UNSUPPORTED_URL", "Paste a direct X post link.");
    }
    return Object.freeze({ kind: "X_POST", host: "x.com", identity: segments[2],
      canonicalUrl: `https://x.com/${segments[0]}/status/${segments[2]}` });
  }
  if ((host === "explorer.testnet.chain.robinhood.com" || host === "explorer.chain.robinhood.com")
    && segments.length === 2 && segments[0] === "address"
    && ADDRESS.test(segments[1].toLowerCase())) {
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
