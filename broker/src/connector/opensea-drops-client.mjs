import { snapshotExactRecord } from "../control-center/strict-record.mjs";

const API_ORIGIN = "https://api.opensea.io";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

export class OpenSeaDropsError extends Error {
  constructor(code, message) { super(message); this.name = "OpenSeaDropsError"; this.code = code; }
}
function fail(code, message) { throw new OpenSeaDropsError(code, message); }
function slug(value) {
  if (typeof value !== "string" || !SLUG.test(value)) fail("INVALID_DROP", "OpenSea drop slug is invalid.");
  return value;
}
function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) fail("UNVERIFIED_DROP", `${label} is invalid.`);
  return value.toLowerCase();
}
function uint(value, label) {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) fail("UNVERIFIED_DROP", `${label} is invalid.`);
  return text;
}
async function boundedJson(response) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_000_000)) {
    fail("OPENSEA_UNAVAILABLE", "OpenSea response was too large.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 1_000_000) {
    fail("OPENSEA_UNAVAILABLE", "OpenSea response was too large.");
  }
  let value;
  try { value = JSON.parse(text); } catch { fail("OPENSEA_UNAVAILABLE", "OpenSea returned invalid data."); }
  if (!response.ok) {
    const code = response.status === 409 ? "DROP_INACTIVE"
      : response.status === 422 ? "NOT_ELIGIBLE" : "OPENSEA_UNAVAILABLE";
    fail(code, code === "DROP_INACTIVE" ? "OpenSea reports that this drop is not active."
      : code === "NOT_ELIGIBLE" ? "The Punk Wallet is not currently eligible for this drop."
        : "OpenSea mint information could not be verified.");
  }
  return value;
}

export function createOpenSeaDropsClient({ apiKey, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)
    || typeof fetchImpl !== "function") throw new TypeError("OpenSea Drops client is not configured");
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${API_ORIGIN}${path}`, { method: options.body ? "POST" : "GET",
        redirect: "error", signal: controller.signal, headers: { accept: "application/json",
          "x-api-key": apiKey, ...(options.body ? { "content-type": "application/json" } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined });
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof OpenSeaDropsError) throw error;
      fail("OPENSEA_UNAVAILABLE", "OpenSea mint information could not be verified.");
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({
    getDrop: (dropSlug) => request(`/api/v2/drops/${encodeURIComponent(slug(dropSlug))}`),
    async buildMintTransaction(dropSlug, raw) {
      let input;
      try { input = snapshotExactRecord(raw, ["minter", "quantity"], "mint request"); }
      catch { fail("INVALID_MINT", "OpenSea mint request is invalid."); }
      const minter = address(input.minter, "Punk Wallet");
      if (input.quantity !== 1) fail("INVALID_MINT", "Only quantity 1 is supported.");
      const proposal = await request(`/api/v2/drops/${encodeURIComponent(slug(dropSlug))}/mint`,
        { body: { minter, quantity: 1 } });
      if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
        fail("UNVERIFIED_DROP", "OpenSea mint proposal is invalid.");
      }
      const target = address(proposal.target ?? proposal.to, "mint target");
      const calldata = proposal.calldata ?? proposal.data;
      if (typeof calldata !== "string" || !HEX.test(calldata) || calldata.length < 10
        || calldata.length > 100_000) fail("UNVERIFIED_DROP", "mint calldata is invalid.");
      return Object.freeze({ target, calldata: calldata.toLowerCase(), valueWei: uint(proposal.value, "mint value"),
        recipient: minter, quantity: 1, source: "OPENSEA_DROPS_API_UNTRUSTED_PROPOSAL" });
    },
  });
}
