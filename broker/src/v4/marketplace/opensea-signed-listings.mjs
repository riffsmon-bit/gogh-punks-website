import { createHash } from 'node:crypto';
import { hashStruct } from 'viem';
import { snapshotExactRecord, snapshotDenseArray } from '../../control-center/strict-record.mjs';
import { normalizeNativeListing } from './review.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_ORDER_TYPES } from './contracts.mjs';

const ORIGIN = 'https://api.opensea.io';
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const MAX_UINT = 2n ** 256n - 1n;
export const OPENSEA_SIGNED_LISTING_LIMITS = Object.freeze({ maxOrders: 5, maxResponseBytes: 65_536,
  timeoutMs: 8_000, callTimeoutMs: 4_000, retries: 0 });
export class OpenSeaSignedListingError extends Error {
  constructor(code) { super(code); this.name = 'OpenSeaSignedListingError'; this.code = code; }
}
const fail = code => { throw new OpenSeaSignedListingError(code); };
const uint = value => typeof value === 'string' && UINT.test(value) && BigInt(value) <= MAX_UINT;
const cancel = body => { try { void body?.cancel().catch(() => {}); } catch {} };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function selection(value) {
  try {
    const input = snapshotExactRecord(value, ['collection', 'orderHashes', 'anchor', ...(Object.hasOwn(value ?? {}, 'wallet') ? ['wallet'] : [])]);
    if (Object.hasOwn(input, 'wallet') && (typeof input.wallet !== 'string' || !/^0x[0-9a-f]{40}$/.test(input.wallet)
      || input.wallet === `0x${'0'.repeat(40)}`)) fail('OPENSEA_SIGNED_SELECTION_INVALID');
    const anchor = snapshotExactRecord(input.anchor, ['number', 'hash', 'timestamp']);
    if (typeof input.collection !== 'string' || !ADDRESS.test(input.collection)
      || input.collection.toLowerCase() === `0x${'0'.repeat(40)}` || !uint(anchor.number) || !uint(anchor.timestamp)
      || typeof anchor.hash !== 'string' || !HASH.test(anchor.hash)) fail('OPENSEA_SIGNED_SELECTION_INVALID');
    const hashes = snapshotDenseArray(input.orderHashes);
    if (!hashes.length || hashes.length > OPENSEA_SIGNED_LISTING_LIMITS.maxOrders
      || hashes.some(hash => typeof hash !== 'string' || !HASH.test(hash))) fail('OPENSEA_SIGNED_SELECTION_INVALID');
    const orderHashes = hashes.map(hash => hash.toLowerCase());
    if (new Set(orderHashes).size !== orderHashes.length) fail('OPENSEA_SIGNED_DUPLICATE_ORDER');
    return { collection: input.collection.toLowerCase(), orderHashes,
      anchor: { number: anchor.number, hash: anchor.hash.toLowerCase(), timestamp: anchor.timestamp } };
  } catch (error) {
    if (error instanceof OpenSeaSignedListingError) throw error;
    fail('OPENSEA_SIGNED_SELECTION_INVALID');
  }
}

async function readResponse(response, endpoint, signal) {
  if (signal.aborted) { cancel(response.body); fail('OPENSEA_SIGNED_TIMEOUT'); }
  if (response.redirected || (response.url && response.url !== endpoint)) { cancel(response.body); fail('OPENSEA_SIGNED_ENDPOINT_CHANGED'); }
  if (response.status !== 200) {
    cancel(response.body);
    fail([401, 403, 404, 409, 429].includes(response.status) ? `OPENSEA_SIGNED_HTTP_${response.status}` : 'OPENSEA_SIGNED_HTTP_UNAVAILABLE');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > OPENSEA_SIGNED_LISTING_LIMITS.maxResponseBytes)) {
    cancel(response.body); fail('OPENSEA_SIGNED_RESPONSE_TOO_LARGE');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body?.getReader) {
    cancel(response.body); fail('OPENSEA_SIGNED_RESPONSE_INVALID');
  }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const abort = () => cancel(reader);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) fail('OPENSEA_SIGNED_TIMEOUT');
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > OPENSEA_SIGNED_LISTING_LIMITS.maxResponseBytes) fail('OPENSEA_SIGNED_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    if (signal.aborted) fail('OPENSEA_SIGNED_TIMEOUT');
    const buffer = Buffer.concat(chunks);
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { fail('OPENSEA_SIGNED_RESPONSE_INVALID'); }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !payload.order
      || typeof payload.order !== 'object' || Array.isArray(payload.order)) fail('OPENSEA_SIGNED_RESPONSE_INVALID');
    return { order: payload.order, responseSha256: createHash('sha256').update(buffer).digest('hex') };
  } finally { signal.removeEventListener('abort', abort); cancel(reader); }
}

function originalListing(order, { collection, orderHash, anchor, observedAt, endpoint, responseSha256 }) {
  if (order.chain !== 'robinhood' || typeof order.protocol_address !== 'string' || order.protocol_address.toLowerCase() !== P.seaport) fail('OPENSEA_SIGNED_CHAIN_OR_PROTOCOL_MISMATCH');
  if (typeof order.order_hash !== 'string' || order.order_hash.toLowerCase() !== orderHash) fail('OPENSEA_SIGNED_ORDER_HASH_MISMATCH');
  if (order.status !== 'ACTIVE') fail('OPENSEA_SIGNED_ORDER_INACTIVE');
  if (order.protocol_data?.signature == null || order.protocol_data.signature === '0x') fail('OPENSEA_SIGNED_SIGNATURE_UNAVAILABLE');
  if (!uint(order.protocol_data?.parameters?.counter)) fail('OPENSEA_SIGNED_COUNTER_UNAVAILABLE');
  const nowSeconds = BigInt(Math.floor(observedAt / 1000));
  let normalized;
  try { normalized = normalizeNativeListing(order, { collection, nowSeconds: nowSeconds > BigInt(anchor.timestamp) ? nowSeconds : BigInt(anchor.timestamp) }); }
  catch (error) {
    const codes = new Set(['UNSUPPORTED_SIGNATURE', 'PRICE_TOTAL_MISMATCH', 'INVALID_EXACT_AMOUNT', 'NFT_IDENTITY_OR_AMOUNT',
      'ORDER_EXPIRED_OR_TOO_SOON', 'RESTRICTED_OR_PARTIAL_ORDER_UNSUPPORTED', 'SINGLE_ERC721_REQUIRED', 'INVALID_CONSIDERATION',
      'NATIVE_ETH_ONLY', 'FIXED_PRICE_REQUIRED', 'ORDER_NOT_ACTIVE', 'INVALID_ADDRESS', 'INVALID_HASH']);
    fail(codes.has(error.message) ? `OPENSEA_SIGNED_${error.message}` : 'OPENSEA_SIGNED_ORDER_INVALID');
  }
  const calculated = hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents',
    data: { ...normalized.parameters, counter: normalized.counter } });
  if (calculated !== orderHash) fail('OPENSEA_SIGNED_ORDER_COMPONENTS_MISMATCH');
  const p = order.protocol_data.parameters;
  const item = value => ({ itemType: value.itemType, token: value.token, identifierOrCriteria: value.identifierOrCriteria,
    startAmount: value.startAmount, endAmount: value.endAmount });
  // Project only original order values needed by the reviewed normalizer. No
  // field, signature, counter, active status, asset identity or price is invented.
  return freeze({ chain: order.chain, protocol_address: order.protocol_address, order_hash: order.order_hash,
    status: order.status, remaining_quantity: order.remaining_quantity,
    asset: { contract: order.asset.contract, identifier: order.asset.identifier },
    price: { current: { currency: order.price.current.currency, decimals: order.price.current.decimals, value: order.price.current.value } },
    protocol_data: { signature: order.protocol_data.signature, parameters: { offerer: p.offerer, zone: p.zone,
      offer: p.offer.map(item), consideration: p.consideration.map(value => ({ ...item(value), recipient: value.recipient })),
      orderType: p.orderType, startTime: p.startTime, endTime: p.endTime, zoneHash: p.zoneHash, salt: p.salt,
      conduitKey: p.conduitKey, totalOriginalConsiderationItems: p.totalOriginalConsiderationItems, counter: p.counter } },
    sourceProvenance: { schema: 'GOGH_OPENSEA_SIGNED_LISTING_SOURCE_V1', source: 'OPENSEA_ORDER_BY_HASH',
      endpoint, observedAt, responseSha256, requestedOrderHash: orderHash, chainId: 4663, anchor,
      providerState: 'OBSERVED_LATEST_NOT_BLOCK_PINNED', signatureVerification: 'REQUIRES_PINNED_SEAPORT_SIMULATION',
      executionAuthority: 'NONE', collectionFloorVerified: false } });
}

// SERVER-OWNED constructor. Request inputs cannot choose a transport, endpoint,
// credential, timeout, chain, protocol, source record or fulfillment callback.
export function createOpenSeaSignedListingReader({ apiKey, fetchImpl = fetch, now = Date.now,
  timeoutMs = OPENSEA_SIGNED_LISTING_LIMITS.timeoutMs, callTimeoutMs = OPENSEA_SIGNED_LISTING_LIMITS.callTimeoutMs } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)
    || typeof fetchImpl !== 'function' || typeof now !== 'function') fail('OPENSEA_SIGNED_CONFIGURATION_INVALID');
  if (![timeoutMs, callTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
    || timeoutMs > OPENSEA_SIGNED_LISTING_LIMITS.timeoutMs || callTimeoutMs > OPENSEA_SIGNED_LISTING_LIMITS.callTimeoutMs) fail('OPENSEA_SIGNED_BOUNDS_INVALID');
  return Object.freeze({ async loadListings(value) {
    const input = selection(value), startedAt = now();
    if (!Number.isSafeInteger(startedAt) || startedAt < 0 || startedAt > 8.64e15) fail('OPENSEA_SIGNED_CLOCK_UNAVAILABLE');
    const controller = new AbortController(); let overallTimer;
    const timeout = (abort, milliseconds, assign) => new Promise((_, reject) => assign(setTimeout(() => {
      abort(); reject(new OpenSeaSignedListingError('OPENSEA_SIGNED_TIMEOUT'));
    }, milliseconds)));
    try {
      const records = await Promise.race([Promise.all(input.orderHashes.map(async orderHash => {
        const endpoint = `${ORIGIN}/api/v2/orders/chain/robinhood/protocol/${P.seaport}/${orderHash}`;
        const attempt = new AbortController(), signal = AbortSignal.any([controller.signal, attempt.signal]); let timer;
        try {
          const fetched = await Promise.race([Promise.resolve().then(async () => readResponse(await fetchImpl(endpoint, {
            method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
            headers: { accept: 'application/json', 'x-api-key': apiKey }, signal,
          }), endpoint, signal)), timeout(() => attempt.abort(), callTimeoutMs, value => { timer = value; })]);
          return { ...fetched, endpoint, orderHash };
        } finally { clearTimeout(timer); attempt.abort(); }
      })), timeout(() => controller.abort(), timeoutMs, value => { overallTimer = value; })]);
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < startedAt || observedAt > 8.64e15) fail('OPENSEA_SIGNED_CLOCK_UNAVAILABLE');
      const listings = records.map(record => originalListing(record.order, { ...input, ...record, observedAt }));
      if (new Set(listings.map(listing => listing.asset.identifier)).size !== listings.length) fail('OPENSEA_SIGNED_DUPLICATE_NFT');
      return Object.freeze(listings);
    } catch (error) {
      if (error instanceof OpenSeaSignedListingError) throw error;
      fail('OPENSEA_SIGNED_SOURCE_UNAVAILABLE');
    } finally { clearTimeout(overallTimer); controller.abort(); }
  } });
}
