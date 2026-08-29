import { getAddress } from "viem";
import { isIP } from "node:net";

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_CANDIDATES = 64;
const DEFAULT_MAXIMUM = 3;
const CACHE_TTL_MS = 15 * 60_000;
const profileCache = new Map();
const IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);

function cleanText(value, maximum = 160) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean.length <= maximum ? clean : null;
}

function privateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)
    || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
}

function privateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host.endsWith(".internal") || host === "0" || isIP(unbracketed) !== 0 || privateIpv4(host)
    || host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd")
    || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea")
    || host.startsWith("feb");
}

export function normalizeProjectWebsite(value) {
  const text = cleanText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password
      || url.hash || privateHostname(url.hostname) || url.port && !new Set(["80", "443"]).has(url.port)) {
      return null;
    }
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeXProfile(value) {
  const text = cleanText(value, 2_048);
  if (!text) return null;
  const candidate = text.startsWith("@") ? `https://x.com/${text.slice(1)}` : text;
  try {
    const url = new URL(candidate);
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || !X_HOSTS.has(url.hostname.toLowerCase())
      || url.username || url.password || url.port || url.search || url.hash
      || segments.length !== 1 || !X_HANDLE.test(segments[0])) return null;
    return `https://x.com/${segments[0]}`;
  } catch {
    return null;
  }
}

export function normalizeProjectImage(value) {
  const text = cleanText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname.toLowerCase())
      || url.username || url.password || url.port || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizedSignals(raw = {}) {
  const websiteUrl = normalizeProjectWebsite(raw.websiteUrl);
  const xUrl = normalizeXProfile(raw.xUrl);
  return Object.freeze({
    projectName: cleanText(raw.projectName, 160),
    imageUrl: normalizeProjectImage(raw.imageUrl),
    websiteUrl,
    xUrl,
    hasWebsite: websiteUrl !== null,
    hasX: xUrl !== null,
    websiteCrossReferenced: websiteUrl !== null && raw.websiteCrossReferenced === true,
    xCrossReferenced: xUrl !== null && raw.xCrossReferenced === true,
    metadataComplete: raw.metadataComplete === true,
    supportedRuntime: raw.supportedRuntime === true,
    freeMint: raw.freeMint === true,
    knownSupportedPlatform: raw.knownSupportedPlatform === true,
  });
}

export function scoreFreeMintCandidate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("candidate profile is invalid");
  }
  const collection = getAddress(raw.collection).toLowerCase();
  const signals = normalizedSignals(raw.signals);
  if (!signals.supportedRuntime || !signals.freeMint) {
    return Object.freeze({ collection, eligibleForSecurityReview: false, score: 0,
      tier: "REJECTED", signals, reasons: Object.freeze([]) });
  }
  let score = 0;
  const reasons = ["Free mint", "Supported contract runtime"];
  if (signals.hasWebsite) { score += 15; reasons.push("Project website found"); }
  if (signals.hasX) { score += 15; reasons.push("X profile found"); }
  if (signals.hasWebsite && signals.hasX) score += 10;
  if (signals.websiteCrossReferenced || signals.xCrossReferenced) {
    score += 15;
    reasons.push("Public metadata links are consistent");
  }
  if (signals.metadataComplete) { score += 10; reasons.push("Project metadata is complete"); }
  if (signals.knownSupportedPlatform) score += 10;
  const tier = signals.hasWebsite && signals.hasX
    && (signals.websiteCrossReferenced || signals.xCrossReferenced) ? "HIGH"
    : signals.hasWebsite || signals.hasX ? "MEDIUM" : "LOW";
  return Object.freeze({ collection, eligibleForSecurityReview: true, score, tier,
    signals, reasons: Object.freeze(reasons) });
}

export function rankFreeMintCandidates(rawCandidates, { maximum = DEFAULT_MAXIMUM } = {}) {
  if (!Array.isArray(rawCandidates) || rawCandidates.length > MAX_CANDIDATES
    || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8) {
    throw new TypeError("candidate ranking input is invalid");
  }
  const ranked = rawCandidates.map(scoreFreeMintCandidate).sort((left, right) => (
    right.eligibleForSecurityReview - left.eligibleForSecurityReview
    || right.score - left.score || left.collection.localeCompare(right.collection)
  ));
  const eligible = ranked.filter((candidate) => candidate.eligibleForSecurityReview);
  return Object.freeze({
    ranked: Object.freeze(ranked),
    selected: Object.freeze(eligible.slice(0, maximum)),
    diagnostics: Object.freeze({
      discovered: ranked.length,
      withWebsite: ranked.filter(({ signals }) => signals.hasWebsite).length,
      withX: ranked.filter(({ signals }) => signals.hasX).length,
      highPriority: ranked.filter(({ tier }) => tier === "HIGH").length,
      sentToOnchainValidation: Math.min(eligible.length, maximum),
      maximumOnchainValidations: maximum,
    }),
  });
}

function collectionProfile(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const websiteUrl = payload.project_url ?? payload.external_url ?? payload.website_url ?? null;
  const xRaw = payload.twitter_username ?? payload.twitter_url ?? payload.x_url ?? null;
  const xUrl = typeof xRaw === "string" && !xRaw.includes(":") && !xRaw.startsWith("@")
    ? `https://x.com/${xRaw}` : xRaw;
  const website = normalizeProjectWebsite(websiteUrl);
  const x = normalizeXProfile(xUrl);
  return {
    projectName: cleanText(payload.name, 160),
    imageUrl: normalizeProjectImage(payload.image_url ?? payload.image_url_svg),
    websiteUrl: website,
    xUrl: x,
    // OpenSea can establish that both advisory links were published with the
    // collection. It cannot establish that either destination links back to
    // the other without fetching untrusted project-controlled pages. Keep
    // cross-reference claims false until a separate SSRF-safe verifier proves
    // them.
    websiteCrossReferenced: false,
    xCrossReferenced: false,
    metadataComplete: Boolean(cleanText(payload.name, 160) && (payload.image_url
      || payload.image_url_svg || payload.banner_image_url)),
  };
}

async function boundedJson(response) {
  const declared = response.headers?.get?.("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 500_000)) {
    throw new TypeError("collection response is too large");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 500_000) throw new TypeError("collection response is too large");
  if (!response.ok) throw new TypeError("collection response is unavailable");
  return JSON.parse(text);
}

export function createOpenSeaSocialProfileSource({ apiKey, fetchImpl = fetch,
  now = () => Date.now() } = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)
    || typeof fetchImpl !== "function" || typeof now !== "function") {
    throw new TypeError("social metadata source is not configured");
  }
  return Object.freeze({
    async profile(collection) {
      const canonical = getAddress(collection).toLowerCase();
      const cached = profileCache.get(canonical);
      if (cached && cached.expiresAt > now()) return cached.value;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const contractResponse = await fetchImpl(
          `https://api.opensea.io/api/v2/chain/robinhood/contract/${canonical}`,
          { headers: { accept: "application/json", "x-api-key": apiKey }, redirect: "error",
            signal: controller.signal },
        );
        const contract = await boundedJson(contractResponse);
        const slug = cleanText(contract.collection, 100);
        if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return Object.freeze({});
        const collectionResponse = await fetchImpl(
          `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
          { headers: { accept: "application/json", "x-api-key": apiKey }, redirect: "error",
            signal: controller.signal },
        );
        const value = Object.freeze(collectionProfile(await boundedJson(collectionResponse)));
        profileCache.set(canonical, { expiresAt: now() + CACHE_TTL_MS, value });
        return value;
      } catch {
        return Object.freeze({});
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export async function rankSeaDropCollections(collections, { source, maximum = DEFAULT_MAXIMUM } = {}) {
  if (!Array.isArray(collections) || collections.length > MAX_CANDIDATES) {
    throw new TypeError("SeaDrop collections are invalid");
  }
  const profiles = [];
  for (let offset = 0; offset < collections.length; offset += 4) {
    const batch = await Promise.all(collections.slice(offset, offset + 4).map(async (collection) => ({
      collection,
      signals: {
        ...(source && typeof source.profile === "function" ? await source.profile(collection) : {}),
        supportedRuntime: true,
        freeMint: true,
        knownSupportedPlatform: true,
      },
    })));
    profiles.push(...batch);
  }
  return rankFreeMintCandidates(profiles, { maximum });
}
