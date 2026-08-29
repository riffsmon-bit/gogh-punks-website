const MAX_METADATA_BYTES = 256_000;
const MAX_URI_LENGTH = 2_048;
const IPFS_GATEWAY_ORIGIN = "https://ipfs.io";
const CACHE_TTL_MS = 60 * 60 * 1_000;
const metadataCache = new Map();

function cleanText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

export function fixedIpfsGatewayUrl(value) {
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
  return `${IPFS_GATEWAY_ORIGIN}/ipfs/${encoded}`;
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
    imageUrl: fixedIpfsGatewayUrl(rawImage),
    source: "ONCHAIN_TOKEN_URI_IPFS",
  });
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
  const endpoint = fixedIpfsGatewayUrl(tokenUri);
  if (!endpoint) return null;
  const cached = metadataCache.get(endpoint);
  if (cached?.createdAt <= now && cached.expiresAt > now) return cached.value;
  if (typeof fetchFn !== "function") throw new TypeError("metadata fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15_000) {
    throw new TypeError("metadata timeout is invalid");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method: "GET", headers: Object.freeze({ accept: "application/json" }),
      redirect: "error", signal: controller.signal,
    });
    if (!response.ok) return null;
    const value = sanitizeOnchainNftDisplay(await boundedJson(response));
    metadataCache.set(endpoint, { createdAt: now, expiresAt: now + CACHE_TTL_MS, value });
    while (metadataCache.size > 256) metadataCache.delete(metadataCache.keys().next().value);
    return value;
  } finally {
    clearTimeout(timeout);
  }
}
