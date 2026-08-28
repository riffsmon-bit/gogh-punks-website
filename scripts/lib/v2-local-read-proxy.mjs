const UPSTREAM = "https://goghpunks.xyz";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const MAX_RESPONSE_BYTES = 2_000_000;

const ROUTES = Object.freeze({
  "/api/broker/owner-punks": Object.freeze({ parameter: "owner", pattern: ADDRESS }),
  "/api/broker/autonomy-v3-status": Object.freeze({ parameter: "tokenId", pattern: TOKEN_ID }),
  "/api/broker/autonomy-v3-activity": Object.freeze({ parameter: "tokenId", pattern: TOKEN_ID }),
  "/api/broker/nft-withdrawal-assets": Object.freeze({ parameter: "tokenId", pattern: TOKEN_ID }),
});

export function localBrokerReadUrl(pathname, searchParams) {
  const route = ROUTES[pathname];
  if (!route || !(searchParams instanceof URLSearchParams)) {
    throw new TypeError("local Broker read route is unsupported");
  }
  const keys = [...searchParams.keys()];
  const value = searchParams.get(route.parameter);
  if (keys.length !== 1 || keys[0] !== route.parameter || !route.pattern.test(value ?? "")) {
    throw new TypeError("local Broker read query is invalid");
  }
  const upstream = new URL(pathname, UPSTREAM);
  upstream.searchParams.set(route.parameter, value);
  return upstream;
}

export async function fetchLocalBrokerRead({ pathname, searchParams,
  fetchFunction = globalThis.fetch } = {}) {
  if (typeof fetchFunction !== "function") throw new TypeError("fetch is unavailable");
  const url = localBrokerReadUrl(pathname, searchParams);
  const response = await fetchFunction(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const declared = response.headers?.get?.("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new TypeError("upstream response is too large");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new TypeError("upstream response is too large");
  }
  let payload;
  try { payload = JSON.parse(body); } catch { throw new TypeError("upstream response is invalid"); }
  const ok = payload && typeof payload === "object"
    ? Reflect.getOwnPropertyDescriptor(payload, "ok") : null;
  if (!ok || !("value" in ok) || typeof ok.value !== "boolean") {
    throw new TypeError("upstream response is invalid");
  }
  return Object.freeze({ status: response.status, body });
}

export const LOCAL_BROKER_READ_PATHS = Object.freeze(Object.keys(ROUTES));
