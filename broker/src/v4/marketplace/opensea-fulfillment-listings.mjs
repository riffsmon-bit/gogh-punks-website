import { createHash } from 'node:crypto';
import { encodeFunctionData, decodeFunctionData, hashStruct, keccak256, toFunctionSignature } from 'viem';
import { snapshotRecord, snapshotExactRecord, snapshotDenseArray } from '../../control-center/strict-record.mjs';
import { normalizeNativeListing } from './review.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_ORDER_TYPES, SEAPORT_ABI } from './contracts.mjs';

const ORIGIN = 'https://api.opensea.io', POST_URL = `${ORIGIN}/api/v2/listings/fulfillment_data`;
const ZERO = `0x${'0'.repeat(40)}`, ZERO_HASH = `0x${'0'.repeat(64)}`;
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i, DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
const HEX_UINT = /^0x[0-9a-f]{1,64}$/i, SIGNATURE = /^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/i;
const FUNCTION = toFunctionSignature(SEAPORT_ABI.find(item => item.name === 'fulfillAdvancedOrder'));
const PARAMETER_KEYS = ['offerer', 'zone', 'offer', 'consideration', 'orderType', 'startTime', 'endTime',
  'zoneHash', 'salt', 'conduitKey', 'totalOriginalConsiderationItems'];
export const OPENSEA_FULFILLMENT_LISTING_LIMITS = Object.freeze({ maxOrders: 5, maxRequests: 10,
  maxResponseBytes: 65_536, callTimeoutMs: 4_000, timeoutMs: 8_000, retries: 0 });
export class OpenSeaFulfillmentListingError extends Error {
  constructor(code) { super(`OPENSEA_FULFILLMENT_${code}`); this.name = 'OpenSeaFulfillmentListingError'; this.code = this.message; }
}
const fail = code => { throw new OpenSeaFulfillmentListingError(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const digest = value => createHash('sha256').update(value).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const cancel = body => { try { void body?.cancel().catch(() => {}); } catch {} };
const addr = (value, nonzero = true) => {
  check(typeof value === 'string' && ADDRESS.test(value) && (!nonzero || value.toLowerCase() !== ZERO), 'ADDRESS_INVALID');
  return value.toLowerCase();
};
const hash = value => { check(typeof value === 'string' && HASH.test(value), 'HASH_INVALID'); return value.toLowerCase(); };
function uint(value, { number = false, hex = false } = {}) {
  if (number && Number.isSafeInteger(value) && value >= 0) value = String(value);
  check(typeof value === 'string' && (DECIMAL.test(value) || (hex && HEX_UINT.test(value))), 'EXACT_AMOUNT_REQUIRED');
  check(BigInt(value) < 2n ** 256n, 'EXACT_AMOUNT_REQUIRED'); return BigInt(value).toString();
}
const record = (value, required, optional = []) => {
  const result = snapshotRecord(value);
  check(required.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => required.includes(key) || optional.includes(key)), 'RESPONSE_SHAPE_UNSUPPORTED');
  return result;
};
function selection(value) {
  try {
    const input = snapshotExactRecord(value, ['collection', 'orderHashes', 'anchor', 'wallet']);
    const anchor = snapshotExactRecord(input.anchor, ['number', 'hash', 'timestamp']);
    const collection = addr(input.collection), wallet = addr(input.wallet);
    check(wallet === input.wallet, 'SERVER_WALLET_REQUIRED');
    check(collection !== P.collection, 'CONTROLLING_COLLECTION_UNSUPPORTED');
    const hashes = snapshotDenseArray(input.orderHashes).map(hash);
    check(hashes.length >= 1 && hashes.length <= 5 && new Set(hashes).size === hashes.length, 'SELECTION_INVALID');
    return { collection, wallet, orderHashes: hashes, anchor: { number: uint(anchor.number), hash: hash(anchor.hash), timestamp: uint(anchor.timestamp) } };
  } catch (error) {
    if (error instanceof OpenSeaFulfillmentListingError) throw error;
    fail('SELECTION_INVALID');
  }
}

// Structural validation without any placeholder signature. Decimal, safe integer
// and (salt only) hex forms are compared as exact uint256 values, never floats.
function parameters(value, { withCounter, fromGet = false }) {
  const p = record(value, [...PARAMETER_KEYS, ...(withCounter ? ['counter'] : [])]);
  const exact = value => uint(value, { number: !fromGet });
  const item = (value, consideration) => {
    const i = record(value, ['itemType', 'token', 'identifierOrCriteria', 'startAmount', 'endAmount', ...(consideration ? ['recipient'] : [])]);
    check(i.itemType === (consideration ? 0 : 2), consideration ? 'NATIVE_ETH_ONLY' : 'EXACT_ERC721_REQUIRED');
    return { itemType: i.itemType, token: addr(i.token, !consideration), identifierOrCriteria: exact(i.identifierOrCriteria),
      startAmount: exact(i.startAmount), endAmount: exact(i.endAmount), ...(consideration ? { recipient: addr(i.recipient) } : {}) };
  };
  const offer = snapshotDenseArray(p.offer), consideration = snapshotDenseArray(p.consideration);
  check(offer.length === 1 && consideration.length >= 1 && consideration.length <= 16, 'ORDER_ITEMS_UNSUPPORTED');
  check(p.orderType === 0 && addr(p.zone, false) === ZERO && hash(p.zoneHash) === ZERO_HASH, 'RESTRICTED_OR_PARTIAL_ORDER_UNSUPPORTED');
  const count = uint(p.totalOriginalConsiderationItems, { number: true });
  check(BigInt(count) === BigInt(consideration.length), 'REQUIRED_FEES_CHANGED');
  return { offerer: addr(p.offerer), zone: ZERO, offer: offer.map(i => item(i, false)),
    consideration: consideration.map(i => item(i, true)), orderType: 0, startTime: exact(p.startTime), endTime: exact(p.endTime),
    zoneHash: ZERO_HASH, salt: uint(p.salt, { number: !fromGet, hex: true }), conduitKey: hash(p.conduitKey),
    totalOriginalConsiderationItems: Number(count), ...(withCounter ? { counter: uint(p.counter, { number: !fromGet }) } : {}) };
}
function unsignedOriginal(raw, input, orderHash, observedAt) {
  check(raw && raw.chain === 'robinhood' && addr(raw.protocol_address) === P.seaport, 'CHAIN_OR_PROTOCOL_MISMATCH');
  check(hash(raw.order_hash) === orderHash, 'ORDER_HASH_MISMATCH');
  check(raw.status === 'ACTIVE' && [1, '1'].includes(raw.remaining_quantity), 'ORDER_INACTIVE');
  const protocol = record(raw.protocol_data, ['parameters'], ['signature']);
  const p = parameters(protocol.parameters, { withCounter: true, fromGet: true });
  check(p.offerer !== input.wallet, 'SELF_PURCHASE_UNSUPPORTED');
  const nft = p.offer[0], asset = record(raw.asset, ['contract', 'identifier']);
  check(nft.token === input.collection && addr(asset.contract) === input.collection && uint(asset.identifier) === nft.identifierOrCriteria
    && nft.startAmount === '1' && nft.endAmount === '1', 'NFT_IDENTITY_OR_AMOUNT');
  const current = BigInt(Math.floor(observedAt / 1000)), nowSeconds = current > BigInt(input.anchor.timestamp) ? current : BigInt(input.anchor.timestamp);
  check(BigInt(p.startTime) <= nowSeconds && BigInt(p.endTime) > nowSeconds + 60n && BigInt(p.startTime) < BigInt(p.endTime), 'ORDER_EXPIRED_OR_TOO_SOON');
  let total = 0n;
  for (const item of p.consideration) {
    check(item.token === ZERO && item.identifierOrCriteria === '0', 'NATIVE_ETH_ONLY');
    check(item.startAmount === item.endAmount, 'FIXED_PRICE_REQUIRED'); total += BigInt(item.startAmount);
  }
  const price = record(raw.price?.current, ['currency', 'decimals', 'value']);
  check(total > 0n && total < 2n ** 256n && price.currency === 'ETH' && price.decimals === 18 && uint(price.value) === String(total), 'PRICE_TOTAL_MISMATCH');
  check(hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: p }) === orderHash, 'ORDER_COMPONENTS_MISMATCH');
  const signature = protocol.signature ?? null;
  check(signature === null || (typeof signature === 'string' && SIGNATURE.test(signature)), 'SIGNATURE_UNSUPPORTED');
  return { chain: 'robinhood', protocol_address: P.seaport, order_hash: orderHash, status: raw.status,
    remaining_quantity: raw.remaining_quantity, asset: { contract: input.collection, identifier: nft.identifierOrCriteria },
    price: { current: { currency: price.currency, decimals: price.decimals, value: price.value } },
    protocol_data: { parameters: p, signature } };
}

async function readJson(response, endpoint, signal) {
  if (signal.aborted) { cancel(response.body); fail('TIMEOUT'); }
  if (response.redirected || (response.url && response.url !== endpoint)) { cancel(response.body); fail('ENDPOINT_CHANGED'); }
  if (response.status !== 200) { cancel(response.body); fail([401, 403, 404, 409, 429].includes(response.status) ? `HTTP_${response.status}` : 'HTTP_UNAVAILABLE'); }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 65_536)) { cancel(response.body); fail('RESPONSE_TOO_LARGE'); }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body?.getReader) { cancel(response.body); fail('RESPONSE_INVALID'); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const abort = () => cancel(reader); signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      check(!signal.aborted, 'TIMEOUT'); const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; check(bytes <= 65_536, 'RESPONSE_TOO_LARGE'); chunks.push(value);
    }
    check(!signal.aborted, 'TIMEOUT'); const buffer = Buffer.concat(chunks);
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { fail('RESPONSE_INVALID'); }
    check(payload && typeof payload === 'object' && !Array.isArray(payload), 'RESPONSE_INVALID');
    return { payload, responseSha256: digest(buffer) };
  } finally { signal.removeEventListener('abort', abort); cancel(reader); }
}

function signedOriginal(response, original, input, source, observedAt) {
  const payload = record(response.payload, ['protocol', 'fulfillment_data']);
  check(payload.protocol === 'seaport1.6', 'PROTOCOL_UNSUPPORTED');
  const fulfillment = record(payload.fulfillment_data, ['orders', 'transaction']);
  const orders = snapshotDenseArray(fulfillment.orders); check(orders.length === 1, 'ORDER_COUNT_CHANGED');
  const order = record(orders[0], ['parameters', 'signature']);
  const p = parameters(order.parameters, { withCounter: true });
  check(JSON.stringify(p) === JSON.stringify(original.protocol_data.parameters), 'SIGNED_ORDER_CHANGED');
  check(typeof order.signature === 'string' && SIGNATURE.test(order.signature), 'SIGNATURE_UNAVAILABLE');
  const signature = order.signature.toLowerCase();
  check(original.protocol_data.signature === null || original.protocol_data.signature.toLowerCase() === signature, 'SIGNATURE_CHANGED');
  check(hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: p }) === original.order_hash, 'ORDER_COMPONENTS_MISMATCH');
  const tx = record(fulfillment.transaction, ['chain', 'to', 'value', 'function', 'input_data'], ['value_hex', 'calldata_suffix']);
  check(tx.chain === 4663 && addr(tx.to) === P.seaport && uint(tx.value) === original.price.current.value, 'TRANSACTION_BINDING_MISMATCH');
  if (Object.hasOwn(tx, 'value_hex')) check(typeof tx.value_hex === 'string' && HEX_UINT.test(tx.value_hex)
    && uint(tx.value_hex, { hex: true }) === tx.value, 'TRANSACTION_VALUE_HEX_MISMATCH');
  check(tx.function === 'fulfillAdvancedOrder' || tx.function === FUNCTION, 'FUNCTION_UNSUPPORTED');
  if (Object.hasOwn(tx, 'calldata_suffix')) check(typeof tx.calldata_suffix === 'string' && /^0x[0-9a-f]{8}$/i.test(tx.calldata_suffix), 'ATTRIBUTION_SUFFIX_UNSUPPORTED');
  const call = record(tx.input_data, ['advancedOrder', 'criteriaResolvers', 'fulfillerConduitKey', 'recipient']);
  const advanced = record(call.advancedOrder, ['parameters', 'numerator', 'denominator', 'signature', 'extraData']);
  const callParameters = parameters(advanced.parameters, { withCounter: false });
  const { counter, ...originalParameters } = p;
  check(JSON.stringify(callParameters) === JSON.stringify(originalParameters), 'CALL_ORDER_CHANGED');
  check(typeof advanced.signature === 'string' && advanced.signature.toLowerCase() === signature, 'CALL_SIGNATURE_CHANGED');
  check(uint(advanced.numerator, { number: true }) === '1' && uint(advanced.denominator, { number: true }) === '1'
    && advanced.extraData === '0x' && snapshotDenseArray(call.criteriaResolvers).length === 0
    && hash(call.fulfillerConduitKey) === ZERO_HASH && addr(call.recipient) === input.wallet, 'CALL_AUTHORITY_CHANGED');
  const encode = args => encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', args });
  const data = encode([{ parameters: callParameters, numerator: BigInt(advanced.numerator), denominator: BigInt(advanced.denominator),
    signature: advanced.signature, extraData: advanced.extraData }, call.criteriaResolvers, call.fulfillerConduitKey, call.recipient]);
  const expected = encode([{ parameters: originalParameters, numerator: 1n, denominator: 1n, signature, extraData: '0x' }, [], ZERO_HASH, input.wallet]);
  check(data.toLowerCase() === expected && data.slice(0, 10) === '0xe7acab24'
    && decodeFunctionData({ abi: SEAPORT_ABI, data }).functionName === 'fulfillAdvancedOrder', 'CALLDATA_BINDING_MISMATCH');
  const result = unsignedOriginal(original, input, original.order_hash, observedAt);
  result.protocol_data.signature = signature;
  // Final existing-core check uses actual vended bytes, never a placeholder.
  normalizeNativeListing(result, { collection: input.collection, nowSeconds: BigInt(Math.floor(observedAt / 1000)) });
  result.sourceProvenance = { schema: 'GOGH_OPENSEA_FULFILLMENT_SOURCE_V1', source: 'OPENSEA_SIGNED_FULFILLMENT_LOOKUP',
    chainId: 4663, requestedOrderHash: original.order_hash, anchor: input.anchor, observedAt, wallet: input.wallet,
    original: { endpoint: source.endpoint, responseSha256: source.responseSha256 },
    fulfillment: { endpoint: POST_URL, requestSha256: source.requestSha256, responseSha256: response.responseSha256 },
    verifiedCall: { chainId: 4663, to: P.seaport, value: tx.value, selector: '0xe7acab24', dataHash: keccak256(expected) },
    attributionSuffix: tx.calldata_suffix?.toLowerCase() ?? null, attributionAppended: false,
    providerState: 'OBSERVED_LATEST_NOT_BLOCK_PINNED', signatureVerification: 'REQUIRES_PINNED_SEAPORT_SIMULATION',
    signatureVending: 'MAY_OCCUR', executionAuthority: 'NONE', transactionBroadcasts: 0, orderCreations: 0, collectionFloorVerified: false };
  return freeze(result);
}

// Staged server dependency only. No runtime automatically installs this reader.
// A canonical Agent wallet must already have been resolved by trusted core reads.
export function createOpenSeaFulfillmentListingReader({ apiKey, fetchImpl = fetch, now = Date.now,
  timeoutMs = 8_000, callTimeoutMs = 4_000 } = {}) {
  check(typeof apiKey === 'string' && apiKey.length >= 8 && apiKey.length <= 512 && !/\s/.test(apiKey)
    && typeof fetchImpl === 'function' && typeof now === 'function', 'CONFIGURATION_INVALID');
  check([timeoutMs, callTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
    && timeoutMs <= 8_000 && callTimeoutMs <= 4_000, 'BOUNDS_INVALID');
  return Object.freeze({ async loadListings(value) {
    const input = selection(value), start = now();
    check(Number.isSafeInteger(start) && start >= 0 && start <= 8.64e15, 'CLOCK_UNAVAILABLE');
    let previous = start;
    const time = () => { const value = now(); check(Number.isSafeInteger(value) && value >= previous && value <= 8.64e15, 'CLOCK_UNAVAILABLE'); previous = value; return value; };
    const controller = new AbortController(); let overallTimer;
    const request = async (endpoint, body) => {
      const attempt = new AbortController(), signal = AbortSignal.any([controller.signal, attempt.signal]); let timer;
      try {
        check(!signal.aborted, 'TIMEOUT');
        return await Promise.race([Promise.resolve().then(async () => readJson(await fetchImpl(endpoint, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
          headers: { accept: 'application/json', 'x-api-key': apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body }),
        }), endpoint, signal)), new Promise((_, reject) => { timer = setTimeout(() => { attempt.abort(); reject(new OpenSeaFulfillmentListingError('TIMEOUT')); }, callTimeoutMs); })]);
      } finally { clearTimeout(timer); attempt.abort(); }
    };
    try {
      return await Promise.race([(async () => {
        const fetched = await Promise.all(input.orderHashes.map(async orderHash => {
          const endpoint = `${ORIGIN}/api/v2/orders/chain/robinhood/protocol/${P.seaport}/${orderHash}`;
          const response = await request(endpoint); return { ...response, endpoint, orderHash };
        }));
        // Every GET in the selection is validated before the first signature POST.
        const observedAt = time();
        const originals = fetched.map(source => unsignedOriginal(record(source.payload, ['order']).order, input, source.orderHash, observedAt));
        check(new Set(originals.map(order => order.asset.identifier)).size === originals.length, 'DUPLICATE_NFT');
        const fulfilled = await Promise.all(originals.map(async (original, index) => {
          const body = JSON.stringify({ listing: { hash: original.order_hash, chain: 'robinhood', protocol_address: P.seaport },
            fulfiller: { address: input.wallet }, recipient: input.wallet, units_to_fill: 1, include_optional_creator_fees: false });
          return { response: await request(POST_URL, body), source: { ...fetched[index], requestSha256: digest(body) } };
        }));
        const finishedAt = time();
        return Object.freeze(fulfilled.map(({ response, source }, index) => signedOriginal(response, originals[index], input, source, finishedAt)));
      })(), new Promise((_, reject) => { overallTimer = setTimeout(() => { controller.abort(); reject(new OpenSeaFulfillmentListingError('TIMEOUT')); }, timeoutMs); })]);
    } catch (error) {
      if (error instanceof OpenSeaFulfillmentListingError) throw error;
      fail('SOURCE_UNAVAILABLE');
    } finally { clearTimeout(overallTimer); controller.abort(); }
  } });
}
