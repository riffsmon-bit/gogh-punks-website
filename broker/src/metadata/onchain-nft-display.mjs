const MAX_METADATA_BYTES = 256_000;
const MAX_URI_LENGTH = 2_048;
const IPFS_GATEWAY_ORIGINS = Object.freeze([
  "https://gateway.pinata.cloud",
  "https://ipfs.io",
]);
const CACHE_TTL_MS = 60 * 60 * 1_000;
const metadataCache = new Map();
const JSON_DATA_URI_HEADER = /^data:application\/json(?:;charset=(?:utf-8|utf8))?(?:;base64)?$/i;
const EMBEDDED_IMAGE = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/;

function cleanText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function fixedIpfsPath(value) {
  if (typeof value !== "string" || value.length > MAX_URI_LENGTH || !value.startsWith("ipfs://")) {
    return null;
  }
  let path = value.slice("ipfs://".length);
  if (path.startsWith("ipfs/")) path = path.slice("ipfs/".length);
  if (!path || /[?#\\]/.test(path)) return null;
  const segments = path.split("/");
  const cid = segments.shift();
  if (!/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(cid ?? "")
    || segments.length > 16
    || segments.some((segment) => segment === "." || segment === ".."
      || !/^[A-Za-z0-9._~-]{1,128}$/.test(segment))) return null;
  const encoded = [cid, ...segments.map(encodeURIComponent)].join("/");
  return `/ipfs/${encoded}`;
}

export function fixedIpfsGatewayUrl(value) {
  const path = fixedIpfsPath(value);
  return path ? `${IPFS_GATEWAY_ORIGINS[0]}${path}` : null;
}

function fixedIpfsGatewayUrls(value) {
  const path = fixedIpfsPath(value);
  return path ? IPFS_GATEWAY_ORIGINS.map((origin) => `${origin}${path}`) : [];
}

export function sanitizeOnchainNftDisplay(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("NFT metadata must be an object");
  }
  for (const field of ["name", "image", "image_url"]) {
    if (payload[field] !== undefined && payload[field] !== null
      && typeof payload[field] !== "string") throw new TypeError(`NFT metadata ${field} is invalid`);
  }
  const rawImage = payload.image ?? payload.image_url;
  return Object.freeze({
    name: cleanText(payload.name, 200),
    imageUrl: typeof rawImage === "string" && rawImage.length <= MAX_METADATA_BYTES
      && EMBEDDED_IMAGE.test(rawImage) ? rawImage : fixedIpfsGatewayUrl(rawImage),
    source: "ONCHAIN_TOKEN_URI",
  });
}

function decodeDataJson(uri) {
  if (typeof uri !== "string" || uri.length > MAX_METADATA_BYTES * 2) return null;
  const comma = uri.indexOf(",");
  if (comma <= 0 || comma > 160) return null;
  const header = uri.slice(0, comma);
  if (!JSON_DATA_URI_HEADER.test(header)) return null;
  const payload = uri.slice(comma + 1);
  let bytes;
  try {
    if (/;base64$/i.test(header)) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
        return null;
      }
      bytes = Buffer.from(payload, "base64");
    } else {
      bytes = Buffer.from(decodeURIComponent(payload), "utf8");
    }
    if (bytes.byteLength > MAX_METADATA_BYTES) return null;
    return sanitizeOnchainNftDisplay(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

async function boundedJson(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && /^\d+$/.test(contentLength)
    && Number(contentLength) > MAX_METADATA_BYTES) throw new RangeError("NFT metadata is too large");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_METADATA_BYTES) {
    throw new RangeError("NFT metadata is too large");
  }
  return JSON.parse(body);
}

export async function readOnchainNftDisplay(tokenUri, {
  fetchFn = fetch, timeoutMs = 5_000, now = Date.now(),
} = {}) {
  if (typeof tokenUri === "string" && tokenUri.startsWith("data:")) {
    return decodeDataJson(tokenUri);
  }
  const endpoints = fixedIpfsGatewayUrls(tokenUri);
  if (!endpoints.length) return null;
  const cacheKey = endpoints[0];
  const cached = metadataCache.get(cacheKey);
  if (cached?.createdAt <= now && cached.expiresAt > now) return cached.value;
  if (typeof fetchFn !== "function") throw new TypeError("metadata fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15_000) {
    throw new TypeError("metadata timeout is invalid");
  }
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(endpoint, {
        method: "GET", headers: Object.freeze({ accept: "application/json" }),
        redirect: "error", signal: controller.signal,
      });
      if (!response.ok) continue;
      const value = sanitizeOnchainNftDisplay(await boundedJson(response));
      metadataCache.set(cacheKey, { createdAt: now, expiresAt: now + CACHE_TTL_MS, value });
      while (metadataCache.size > 256) metadataCache.delete(metadataCache.keys().next().value);
      return value;
    } catch {
      // Both endpoints are fixed HTTPS IPFS gateways for the same content-addressed path.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}
