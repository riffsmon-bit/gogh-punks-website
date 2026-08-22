import { timingSafeEqual } from "node:crypto";
import { getRpcUrl } from "./_shared/config.mjs";
import { json } from "./_shared/http.mjs";

const ROBINHOOD_CHAIN_ID_HEX = "0x1237";
const GOGH_PUNKS = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const BALANCE_OF_SELECTOR = "0x70a08231";
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 4_096;
const MAX_WALLETS = 20;

class HolderVerificationError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "HolderVerificationError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 400) {
  throw new HolderVerificationError(code, status);
}

function token(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    fail("NOT_FOUND", 404);
  }
  return value;
}

function sameToken(actual, expected) {
  const left = Buffer.from(token(actual));
  const right = Buffer.from(token(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function wallet(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_WALLET");
  }
  return value.toLowerCase();
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(`INVALID_${label}`);
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) fail(`INVALID_${label}`);
}

function walletsFromBody(body) {
  if (Object.hasOwn(body, "wallet")) {
    exactKeys(body, ["wallet"], "BODY");
    return [wallet(body.wallet)];
  }
  exactKeys(body, ["wallets"], "BODY");
  if (!Array.isArray(body.wallets) || Object.getPrototypeOf(body.wallets) !== Array.prototype
    || body.wallets.length === 0 || body.wallets.length > MAX_WALLETS) {
    fail("INVALID_WALLETS");
  }
  const normalized = body.wallets.map(wallet);
  if (new Set(normalized).size !== normalized.length) fail("DUPLICATE_WALLET");
  return normalized;
}

async function boundedText(response) {
  const declared = Number(response.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("RPC_UNAVAILABLE", 503);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    fail("RPC_UNAVAILABLE", 503);
  }
  return text;
}

async function rpc(fetchFunction, rpcUrl, method, params, id) {
  let response;
  try {
    response = await fetchFunction(rpcUrl, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail("RPC_UNAVAILABLE", 503);
  }
  if (!response?.ok) fail("RPC_UNAVAILABLE", 503);
  let payload;
  try {
    payload = JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof HolderVerificationError) throw error;
    fail("RPC_UNAVAILABLE", 503);
  }
  exactKeys(payload, ["jsonrpc", "id", "result"], "RPC_RESPONSE");
  if (payload.jsonrpc !== "2.0" || payload.id !== id || typeof payload.result !== "string") {
    fail("RPC_UNAVAILABLE", 503);
  }
  return payload.result;
}

export async function verifyVulcanHolder(body, dependencies = {}) {
  const fetchFunction = dependencies.fetchFunction ?? fetch;
  const rpcUrl = dependencies.rpcUrl ?? getRpcUrl();
  const addresses = walletsFromBody(body);
  const chainId = await rpc(fetchFunction, rpcUrl, "eth_chainId", [], 1);
  if (chainId.toLowerCase() !== ROBINHOOD_CHAIN_ID_HEX) fail("RPC_WRONG_CHAIN", 503);
  const balances = await Promise.all(addresses.map(async (address, index) => {
    const data = `${BALANCE_OF_SELECTOR}${address.slice(2).padStart(64, "0")}`;
    const result = await rpc(fetchFunction, rpcUrl, "eth_call", [{
      to: GOGH_PUNKS,
      data,
    }, "latest"], index + 2);
    if (!/^0x[0-9a-fA-F]{64}$/.test(result)) fail("RPC_UNAVAILABLE", 503);
    return BigInt(result);
  }));
  return balances.some((balance) => balance > 0n);
}

export default async function handler(request) {
  const headers = {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  };
  if (request.method !== "POST") return json({ success: false }, 405, headers);
  try {
    const configured = process.env.VULCAN_HOLDER_WEBHOOK_TOKEN;
    const supplied = new URL(request.url).searchParams.get("token");
    if (!configured || !sameToken(supplied, configured)) fail("NOT_FOUND", 404);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) fail("REQUEST_TOO_LARGE", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      fail("REQUEST_TOO_LARGE", 413);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      fail("INVALID_JSON");
    }
    const success = await verifyVulcanHolder(body);
    return json({ success }, 200, headers);
  } catch (error) {
    const status = error instanceof HolderVerificationError ? error.status : 503;
    return json({ success: false }, status, headers);
  }
}

export const config = {
  path: "/api/vulcan/holder-verification",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 240,
    windowSize: 60,
  },
};
