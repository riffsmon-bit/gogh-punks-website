import { normalizeAddress } from "../config.mjs";

const ROBINHOOD_BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api";
const MAXIMUM_RESPONSE_BYTES = 1_000_000;
const MAXIMUM_ABI_ITEMS = 5_000;

async function limitedText(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (declaredLength > maximumBytes) throw new RangeError("Blockscout ABI response is too large");
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
      throw new RangeError("Blockscout ABI response is too large");
    }
    return value;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = "";
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    total += chunk.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RangeError("Blockscout ABI response is too large");
    }
    value += decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
}

function writeSurface(abi) {
  if (!Array.isArray(abi) || abi.length > MAXIMUM_ABI_ITEMS) {
    throw new TypeError("Blockscout returned an invalid ABI");
  }
  const functions = abi.filter((item) =>
    item?.type === "function" && typeof item.name === "string");
  const writes = functions.filter((item) =>
    item.stateMutability !== "view" && item.stateMutability !== "pure");
  const names = Object.freeze([...new Set(writes.map((item) => item.name))].sort());
  const has = (pattern) => names.some((name) => pattern.test(name));
  return Object.freeze({
    abiFunctionCount: functions.length,
    writeFunctionCount: writes.length,
    writeFunctionNames: names,
    mintFunctionExposed: has(/mint|airdrop/i),
    pauseFunctionExposed: has(/pause/i),
    metadataSetterExposed: has(/(?:set|update).*(?:uri|metadata|renderer)/i),
    transferControlFunctionExposed: has(/(?:set|update).*(?:transfer|validator|operator)/i),
    blacklistFunctionExposed: has(/blacklist|blocklist|denylist/i),
    royaltySetterExposed: has(/(?:set|update).*royalt/i),
    upgradeFunctionExposed: has(/upgrade|implementation/i),
  });
}

export class BlockscoutAbiInspector {
  constructor({
    fetchImpl = fetch,
    endpoint = ROBINHOOD_BLOCKSCOUT_API,
    timeoutMs = 12_000,
    clock = () => new Date(),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    const parsed = new URL(endpoint);
    if (
      parsed.protocol !== "https:"
      || parsed.origin !== "https://robinhoodchain.blockscout.com"
      || parsed.pathname !== "/api"
    ) throw new TypeError("endpoint must be the Robinhood Blockscout API");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new RangeError("timeoutMs must be between 1 and 60000");
    }
    this.fetchImpl = fetchImpl;
    this.endpoint = parsed;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
  }

  async inspect(contractAddress) {
    const address = normalizeAddress(contractAddress, "contractAddress");
    const url = new URL(this.endpoint);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getabi");
    url.searchParams.set("address", address);
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Blockscout ABI request failed with HTTP ${response.status}`);
    const payload = JSON.parse(await limitedText(response, MAXIMUM_RESPONSE_BYTES));
    if (payload?.status !== "1" || typeof payload.result !== "string") {
      return Object.freeze({
        sourceVerified: false,
        explorerEvidence: "NOT_VERIFIED",
        explorer: this.endpoint.origin,
        observedAt: new Date(this.clock()).toISOString(),
      });
    }
    const surface = writeSurface(JSON.parse(payload.result));
    return Object.freeze({
      sourceVerified: true,
      explorerEvidence: "VERIFIED_ABI",
      explorer: this.endpoint.origin,
      observedAt: new Date(this.clock()).toISOString(),
      ...surface,
      caveat: "A verified ABI exposes callable surface, not access-control correctness or safety.",
    });
  }
}
