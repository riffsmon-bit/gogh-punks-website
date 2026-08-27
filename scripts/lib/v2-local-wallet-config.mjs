const PROJECT_ID = /^[0-9a-f]{32}$/;
const UPSTREAM = "https://goghpunks.xyz/api/broker/wallet-config";
const MAX_RESPONSE_BYTES = 4_096;

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("local wallet origin is invalid");
  }
  return url.origin;
}

function publicProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    throw new TypeError("public Reown project ID is unavailable");
  }
  return value;
}

function ownData(record, key) {
  const descriptor = record && typeof record === "object"
    ? Reflect.getOwnPropertyDescriptor(record, key) : null;
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new TypeError("wallet configuration response is invalid");
  }
  return descriptor.value;
}

export function localWalletReferer(value, port) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.port !== String(port) || !/^\/broker\/punk\/\d+\/?$/.test(url.pathname)) return null;
  return url.origin;
}

export async function localWalletConfiguration({
  origin,
  environment = process.env,
  fetchFunction = globalThis.fetch,
} = {}) {
  const metadataUrl = localOrigin(origin);
  const configured = environment.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();
  if (PROJECT_ID.test(configured ?? "")) {
    return Object.freeze({ configured: true, projectId: configured,
      metadataUrl, reason: null });
  }
  if (typeof fetchFunction !== "function") throw new TypeError("wallet configuration fetch is unavailable");
  const response = await fetchFunction(UPSTREAM, {
    method: "GET", headers: { accept: "application/json" }, redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  const length = response.headers?.get?.("content-length");
  if (!response.ok || (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES)) {
    throw new TypeError("public wallet configuration is unavailable");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new TypeError("public wallet configuration is too large");
  }
  const payload = JSON.parse(body);
  if (ownData(payload, "ok") !== true) throw new TypeError("public wallet configuration is invalid");
  const wallet = ownData(payload, "wallet");
  if (ownData(wallet, "configured") !== true) throw new TypeError("public wallet is not configured");
  return Object.freeze({ configured: true,
    projectId: publicProjectId(ownData(wallet, "projectId")), metadataUrl, reason: null });
}
