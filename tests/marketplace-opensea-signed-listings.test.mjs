import test from 'node:test';
import assert from 'node:assert/strict';
import { hashStruct } from 'viem';
import { createOpenSeaSignedListingReader, OPENSEA_SIGNED_LISTING_LIMITS as LIMITS } from '../broker/src/v4/marketplace/opensea-signed-listings.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_ORDER_TYPES } from '../broker/src/v4/marketplace/contracts.mjs';
import { normalizeNativeListing } from '../broker/src/v4/marketplace/review.mjs';
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const collection = address('1'), owner = address('2'), now = 1_800_000_000_000;
const anchor = { number: '100', hash: hash('3'), timestamp: String(now / 1000) };
const key = 'test-only-api-key';
function order(id = '93') {
  const parameters = { offerer: owner, zone: address('0'),
    offer: [{ itemType: 2, token: collection, identifierOrCriteria: id, startAmount: '1', endAmount: '1' }],
    consideration: [{ itemType: 0, token: address('0'), identifierOrCriteria: '0', startAmount: '900719925474099300000', endAmount: '900719925474099300000', recipient: owner }],
    orderType: 0, startTime: String(now / 1000 - 1), endTime: String(now / 1000 + 3600),
    zoneHash: hash('0'), salt: '7', conduitKey: hash('0'), counter: '0', totalOriginalConsiderationItems: 1 };
  return { chain: 'robinhood', protocol_address: P.seaport,
    order_hash: hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: parameters }),
    status: 'ACTIVE', remaining_quantity: 1, asset: { contract: collection, identifier: id },
    price: { current: { currency: 'ETH', decimals: 18, value: '900719925474099300000' } },
    protocol_data: { parameters, signature: `0x${'1'.repeat(130)}` } };
}
const input = records => ({ collection, orderHashes: records.map(record => record.order_hash), anchor });
const json = value => Response.json(value);
const setup = (fetchImpl, options = {}) => createOpenSeaSignedListingReader({ apiKey: key, fetchImpl, now: () => now, ...options });

test('fixed GET lookup returns original signature/counter/price with selected provenance and exact hash', async () => {
  const records = [order(), order('94')], calls = [];
  const reader = setup(async (url, options) => { calls.push({ url, options });
    return json({ order: records.find(record => url.endsWith(record.order_hash)) }); });
  const result = await reader.loadListings(input(records));
  assert.equal(result.length, 2); assert.equal(calls.length, 2);
  for (let i = 0; i < result.length; i++) {
    const original = records[i], value = result[i], call = calls[i];
    assert.equal(call.url, `https://api.opensea.io/api/v2/orders/chain/robinhood/protocol/${P.seaport}/${original.order_hash}`);
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.body, undefined);
    assert.equal(call.options.headers['x-api-key'], key);
    assert.deepEqual(value.protocol_data, original.protocol_data);
    assert.equal(normalizeNativeListing(value, { collection, nowSeconds: BigInt(anchor.timestamp) }).totalWei, '900719925474099300000');
    assert.equal(value.sourceProvenance.requestedOrderHash, original.order_hash);
    assert.equal(value.sourceProvenance.endpoint, call.url); assert.equal(value.sourceProvenance.observedAt, now);
    assert.match(value.sourceProvenance.responseSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(value.sourceProvenance.anchor, anchor); assert.equal(value.sourceProvenance.executionAuthority, 'NONE');
    assert.equal(value.sourceProvenance.providerState, 'OBSERVED_LATEST_NOT_BLOCK_PINNED');
    assert.ok(Object.isFrozen(value.protocol_data.parameters));
    assert.ok(!JSON.stringify(value).includes(key));
  }
});

test('all-five selected hashes are fetched once, with no discovery, pagination or retry', async () => {
  const records = Array.from({ length: 5 }, (_, i) => order(String(i))), calls = [];
  const result = await setup(async url => { calls.push(url); return json({ order: records.find(record => url.endsWith(record.order_hash)) }); }).loadListings(input(records));
  assert.equal(result.length, 5); assert.equal(calls.length, 5); assert.equal(new Set(calls).size, 5);
});

test('SSRF, URL and authority fields cannot enter request paths or trigger any fetch', async () => {
  let calls = 0; const reader = setup(async () => { calls++; throw Error('UNREACHABLE'); }), base = input([order()]);
  for (const field of ['url', 'endpoint', 'protocol', 'chain', 'fetchImpl', 'apiKey', 'fulfiller', 'review', 'calldata']) {
    await assert.rejects(() => reader.loadListings({ ...base, [field]: 'http://127.0.0.1/private' }), /SELECTION_INVALID/);
  }
  for (const value of ['http://127.0.0.1', '//evil.example', '0x1/../../secret', `${order().order_hash}?redirect=http://evil.example`]) {
    await assert.rejects(() => reader.loadListings({ ...base, orderHashes: [value] }), /SELECTION_INVALID/);
    await assert.rejects(() => reader.loadListings({ ...base, collection: value }), /SELECTION_INVALID/);
  }
  await assert.rejects(() => reader.loadListings({ ...base, anchor: { ...anchor, rpcUrl: 'http://evil.example' } }), /SELECTION_INVALID/);
  await assert.rejects(() => reader.loadListings({ ...base, orderHashes: [] }), /SELECTION_INVALID/);
  const tooMany = input(Array.from({ length: 6 }, (_, i) => order(String(i))));
  await assert.rejects(() => reader.loadListings(tooMany), /SELECTION_INVALID/);
  await assert.rejects(() => reader.loadListings(input([order(), order()])), /DUPLICATE_ORDER/);
  let invoked = false;
  await assert.rejects(() => reader.loadListings({ ...base, get collection() { invoked = true; return collection; } }), /SELECTION_INVALID/);
  assert.equal(invoked, false); assert.equal(calls, 0);
});

for (const [name, mutate, error] of [
  ['wrong chain', o => { o.chain = 'ethereum'; }, /CHAIN_OR_PROTOCOL/],
  ['alternate protocol', o => { o.protocol_address = address('9'); }, /CHAIN_OR_PROTOCOL/],
  ['wrong selected hash', o => { o.order_hash = hash('9'); }, /ORDER_HASH_MISMATCH/],
  ['absent signature', o => { delete o.protocol_data.signature; }, /SIGNATURE_UNAVAILABLE/],
  ['null signature observed live', o => { o.protocol_data.signature = null; }, /SIGNATURE_UNAVAILABLE/],
  ['empty signature', o => { o.protocol_data.signature = '0x'; }, /SIGNATURE_UNAVAILABLE/],
  ['malformed signature', o => { o.protocol_data.signature = '0x1234'; }, /UNSUPPORTED_SIGNATURE/],
  ['missing counter', o => { delete o.protocol_data.parameters.counter; }, /COUNTER_UNAVAILABLE/],
  ['numeric counter', o => { o.protocol_data.parameters.counter = 9007199254740992; }, /COUNTER_UNAVAILABLE/],
  ['changed counter', o => { o.protocol_data.parameters.counter = '1'; }, /COMPONENTS_MISMATCH/],
  ['changed salt', o => { o.protocol_data.parameters.salt = '8'; }, /COMPONENTS_MISMATCH/],
  ['changed seller', o => { o.protocol_data.parameters.offerer = address('8'); }, /COMPONENTS_MISMATCH/],
  ['wrong asset', o => { o.asset.contract = address('8'); }, /NFT_IDENTITY/],
  ['wrong NFT ID', o => { o.asset.identifier = '94'; }, /NFT_IDENTITY/],
  ['price mismatch', o => { o.price.current.value = '1'; }, /PRICE_TOTAL/],
  ['imprecise numeric price', o => { o.price.current.value = 900719925474099300000; }, /INVALID_EXACT/],
  ['USDG quoted price', o => { o.price.current.currency = 'USDG'; o.price.current.decimals = 6; }, /PRICE_TOTAL/],
  ['WETH consideration', o => { o.protocol_data.parameters.consideration[0].itemType = 1; }, /NATIVE_ETH_ONLY/],
  ['restricted zone', o => { o.protocol_data.parameters.orderType = 2; }, /RESTRICTED/],
  ['partial order', o => { o.protocol_data.parameters.orderType = 1; }, /PARTIAL/],
  ['inactive', o => { o.status = 'INACTIVE'; }, /INACTIVE/],
  ['cancelled', o => { o.status = 'CANCELLED'; }, /INACTIVE/],
  ['fulfilled', o => { o.status = 'FULFILLED'; }, /INACTIVE/],
  ['zero remaining', o => { o.remaining_quantity = 0; }, /ORDER_NOT_ACTIVE/],
  ['expires within review', o => { o.protocol_data.parameters.endTime = String(now / 1000 + 60); }, /EXPIRED/],
]) test(`reject ${name} without a partial successful selection`, async () => {
  const original = order(), selected = input([original]); mutate(original);
  await assert.rejects(() => setup(async () => json({ order: original })).loadListings(selected), error);
});

test('duplicate NFT identities across distinct valid signed orders fail as a group', async () => {
  const a = order(), b = order(); b.protocol_data.parameters.salt = '8';
  b.order_hash = hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: b.protocol_data.parameters });
  await assert.rejects(() => setup(async url => json({ order: url.endsWith(a.order_hash) ? a : b })).loadListings(input([a, b])), /DUPLICATE_NFT/);
});

test('redirected responses, changed final URLs and redirect status never expose a second endpoint', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }), json({ order: order() })]) {
    if (response.status === 200) Object.defineProperty(response, 'redirected', { value: true });
    let calls = 0;
    await assert.rejects(() => setup(async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); return response; }).loadListings(input([order()])), /ENDPOINT_CHANGED|HTTP_UNAVAILABLE/);
    assert.equal(calls, 1);
  }
  const changed = json({ order: order() }); Object.defineProperty(changed, 'url', { value: 'https://evil.example/order' });
  await assert.rejects(() => setup(async () => changed).loadListings(input([order()])), /ENDPOINT_CHANGED/);
});

test('HTTP failures sanitize provider bodies, never retry, and discard all records', async () => {
  for (const status of [401, 403, 404, 409, 429, 500]) {
    let calls = 0;
    await assert.rejects(() => setup(async () => { calls++; return new Response(`${key} http://private.example`, { status }); }).loadListings(input([order()])), error => {
      assert.ok(!error.message.includes(key)); assert.ok(!error.message.includes('private')); return /OPENSEA_SIGNED_HTTP/.test(error.code);
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(() => setup(async () => { throw Error(`upstream ${key}`); }).loadListings(input([order()])), /^OpenSeaSignedListingError: OPENSEA_SIGNED_SOURCE_UNAVAILABLE$/);
});

test('declared and streamed oversized bodies are cancelled before acceptance', async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { if (!declared) controller.enqueue(new Uint8Array(LIMITS.maxResponseBytes + 1)); }, cancel() { cancelled = true; } });
    const response = new Response(body, { headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': String(LIMITS.maxResponseBytes + 1) } : {}) } });
    await assert.rejects(() => setup(async () => response).loadListings(input([order()])), /RESPONSE_TOO_LARGE/);
    assert.equal(cancelled, true);
  }
});

test('timeouts bound uncooperative fetch, stalled bodies, and the complete five-order request', async () => {
  let signal;
  await assert.rejects(() => setup(async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, { callTimeoutMs: 15 }).loadListings(input([order()])), /TIMEOUT/);
  assert.equal(signal.aborted, true);
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => setup(async () => response, { callTimeoutMs: 15 }).loadListings(input([order()])), /TIMEOUT/);
  assert.equal(cancelled, true);
  const signals = [];
  await assert.rejects(() => setup(async (_url, options) => { signals.push(options.signal); return new Promise(() => {}); }, { timeoutMs: 10, callTimeoutMs: 30 })
    .loadListings(input(Array.from({ length: 5 }, (_, i) => order(String(i))))), /TIMEOUT/);
  assert.equal(signals.length, 5); assert.ok(signals.every(value => value.aborted));
});

test('late fetch responses after timeout are cancelled and never parsed', async () => {
  let complete, cancelled = false;
  const pending = new Promise(resolve => { complete = resolve; });
  await assert.rejects(() => setup(async () => pending, { callTimeoutMs: 10 }).loadListings(input([order()])), /TIMEOUT/);
  complete(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(cancelled, true);
});

test('invalid envelopes, encoding, MIME types and clock rollback fail closed', async () => {
  for (const response of [json({ listings: [order()] }), json({ order: null }), json({ order: [order()] }),
    new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }), new Response('{}')]) {
    await assert.rejects(() => setup(async () => response).loadListings(input([order()])), /RESPONSE_INVALID/);
  }
  let n = 0;
  await assert.rejects(() => setup(async () => json({ order: order() }), { now: () => now - n++ }).loadListings(input([order()])), /CLOCK_UNAVAILABLE/);
  assert.throws(() => setup(fetch, { timeoutMs: 8001 }), /BOUNDS_INVALID/);
  assert.throws(() => createOpenSeaSignedListingReader({ apiKey: `${key}\nheader` }), /CONFIGURATION_INVALID/);
});
