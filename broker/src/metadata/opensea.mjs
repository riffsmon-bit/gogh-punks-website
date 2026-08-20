import { createHash } from "node:crypto";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";

export const OPENSEA_CHAIN = "robinhood";
export const OPENSEA_SOURCE = "OPENSEA_V2";
export const MAX_OPENSEA_RESPONSE_BYTES = 1_000_000;

const MAX_TRAITS = 64;
const OPENSEA_IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);

function boundedText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, maximum) : null;
}

function canonicalTokenId(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new TypeError();
    return parsed.toString();
  } catch {
    throw new TypeError("OpenSea token ID must be a non-negative integer");
  }
}

function displayImage(value) {
  const text = boundedText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:"
      || !OPENSEA_IMAGE_HOSTS.has(url.hostname)
      || url.port
      || url.username
      || url.password
      || url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizedTraits(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.slice(0, MAX_TRAITS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const traitType = boundedText(entry.trait_type ?? entry.type, 96);
    const rawValue = entry.value;
    if (!["string", "number", "boolean", "bigint"].includes(typeof rawValue)) return [];
    const traitValue = boundedText(String(rawValue), 160);
    if (!traitType || !traitValue) return [];
    return [Object.freeze({ traitType, value: traitValue })];
  }));
}

function baseRecord(collection, identifier, status) {
  const canonicalCollection = normalizeAddress(collection, "OpenSea collection");
  const tokenId = canonicalTokenId(identifier);
  return {
    chainId: ROBINHOOD.chainId,
    collection: canonicalCollection,
    tokenId,
    source: OPENSEA_SOURCE,
    status,
    name: null,
    description: null,
    displayImageUrl: null,
    collectionSlug: null,
    tokenStandard: "UNKNOWN",
    traits: Object.freeze([]),
    openSeaUrl: openSeaAssetUrl(canonicalCollection, tokenId),
    payloadHash: null,
  };
}

async function boundedResponseText(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && /^\d+$/.test(contentLength)
    && Number(contentLength) > MAX_OPENSEA_RESPONSE_BYTES) {
    throw new RangeError("OpenSea metadata response exceeds the size limit");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_OPENSEA_RESPONSE_BYTES) {
      throw new RangeError("OpenSea metadata response exceeds the size limit");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_OPENSEA_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RangeError("OpenSea metadata response exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export function openSeaAssetUrl(collection, identifier) {
  return `https://opensea.io/assets/${OPENSEA_CHAIN}/${normalizeAddress(collection)}/${canonicalTokenId(identifier)}`;
}

export function notFoundOpenSeaNft(collection, identifier) {
  return Object.freeze(baseRecord(collection, identifier, "NOT_FOUND"));
}

export function failedOpenSeaNft(collection, identifier) {
  return Object.freeze(baseRecord(collection, identifier, "ERROR"));
}

export function sanitizeOpenSeaNft(payload, { collection, identifier, payloadHash }) {
  const expectedCollection = normalizeAddress(collection, "OpenSea collection");
  const expectedTokenId = canonicalTokenId(identifier);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("OpenSea metadata response must be an object");
  }

  // The current AssetMetadataResponse does not echo an NFT identity. Identity is
  // therefore bound to the fixed request path (with redirects prohibited). If a
  // provider revision does echo either identity, it must match before use.
  const echoedCollection = payload.contract_address ?? payload.contract;
  if (echoedCollection !== undefined && (
    typeof echoedCollection !== "string"
    || normalizeAddress(echoedCollection, "OpenSea response contract") !== expectedCollection
  )) {
    throw new TypeError("OpenSea response contract does not match the request");
  }
  const echoedTokenId = payload.token_id ?? payload.identifier;
  if (echoedTokenId !== undefined && canonicalTokenId(echoedTokenId) !== expectedTokenId) {
    throw new TypeError("OpenSea response token ID does not match the request");
  }

  // AssetMetadataResponse requires traits. Optional fields are accepted only at
  // their documented types; a legacy nested `nft` response fails this check.
  if (!Array.isArray(payload.traits)) {
    throw new TypeError("OpenSea metadata response traits must be an array");
  }
  for (const field of ["name", "description", "image", "animation_url", "external_link"]) {
    if (
      payload[field] !== undefined
      && payload[field] !== null
      && typeof payload[field] !== "string"
    ) {
      throw new TypeError(`OpenSea metadata response ${field} must be null or a string`);
    }
  }
  if (payload.decimals !== undefined && payload.decimals !== null && (
    !Number.isInteger(payload.decimals)
    || payload.decimals < -2_147_483_648
    || payload.decimals > 2_147_483_647
  )) {
    throw new TypeError("OpenSea metadata response decimals must be null or a 32-bit integer");
  }

  return Object.freeze({
    ...baseRecord(expectedCollection, expectedTokenId, "AVAILABLE"),
    name: boundedText(payload.name, 200),
    description: boundedText(payload.description, 2_000),
    displayImageUrl: displayImage(payload.image),
    traits: sanitizedTraits(payload.traits),
    payloadHash,
  });
}

export class OpenSeaMetadataSource {
  #apiKey;

  constructor({ apiKey, fetchFn = fetch, timeoutMs = 8_000 } = {}) {
    if (typeof apiKey !== "string" || apiKey.trim().length < 8 || apiKey.length > 512) {
      throw new TypeError("OPENSEA_API_KEY is required and must remain server-side");
    }
    if (typeof fetchFn !== "function") throw new TypeError("fetchFn must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
      throw new TypeError("OpenSea timeout must be between 1000 and 30000 milliseconds");
    }
    this.#apiKey = apiKey.trim();
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
  }

  async nft({ collection, tokenId: identifier }) {
    const canonicalCollection = normalizeAddress(collection, "OpenSea collection");
    const canonicalId = canonicalTokenId(identifier);
    const endpoint = new URL(
      `https://api.opensea.io/api/v2/metadata/${OPENSEA_CHAIN}/${canonicalCollection}/${canonicalId}`,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "GET",
        headers: Object.freeze({ accept: "application/json", "x-api-key": this.#apiKey }),
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 404) return notFoundOpenSeaNft(canonicalCollection, canonicalId);
      if (!response.ok) {
        const error = new Error(`OpenSea metadata request failed with status ${response.status}`);
        error.code = `OPENSEA_HTTP_${response.status}`;
        throw error;
      }
      const body = await boundedResponseText(response);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new TypeError("OpenSea metadata response is not valid JSON");
      }
      const payloadHash = `0x${createHash("sha256").update(body).digest("hex")}`;
      return sanitizeOpenSeaNft(payload, {
        collection: canonicalCollection,
        identifier: canonicalId,
        payloadHash,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
