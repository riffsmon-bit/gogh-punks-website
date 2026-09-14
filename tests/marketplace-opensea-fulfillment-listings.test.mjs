import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, hashStruct, keccak256, toFunctionSignature } from 'viem';
import { createOpenSeaFulfillmentListingReader, OPENSEA_FULFILLMENT_LISTING_LIMITS as LIMITS } from '../broker/src/v4/marketplace/opensea-fulfillment-listings.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_ORDER_TYPES, SEAPORT_ABI } from '../broker/src/v4/marketplace/contracts.mjs';
import { normalizeNativeListing } from '../broker/src/v4/marketplace/review.mjs';
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const collection = address('1'), seller = address('2'), wallet = address('3'), zero = address('0'), zeroHash = hash('0');
const key = 'offline-only-opensea-test-key', now = 1_800_000_000_000;
const anchor = { number: '100', hash: hash('7'), timestamp: String(now / 1000) };
const functionSignature = toFunctionSignature(SEAPORT_ABI.find(item => item.name === 'fulfillAdvancedOrder'));
const clone = value => structuredClone(value);

// Synthetic OFFLINE full-open listing in the official wire shape, including
// string call count, hex order salt and attribution metadata. Signature bytes
// are test data: only pinned Seaport simulation can establish executability.
function fixture(id = '93') {
  const fee = (amount, recipient) => ({ itemType: 0, token: zero, identifierOrCriteria: '0', startAmount: amount, endAmount: amount, recipient });
  const parameters = { offerer: seller, zone: zero, offer: [{ itemType: 2, token: collection, identifierOrCriteria: id, startAmount: '1', endAmount: '1' }],
    consideration: [fee('900719925474099300000', seller), fee('170', address('4')), fee('30', address('5'))],
    orderType: 0, startTime: String(now / 1000 - 1), endTime: String(now / 1000 + 3600), zoneHash: zeroHash,
    salt: '999', conduitKey: hash('6'), totalOriginalConsiderationItems: 3, counter: '0' };
  const original = { chain: 'robinhood', protocol_address: P.seaport,
    order_hash: hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: parameters }),
    status: 'ACTIVE', remaining_quantity: 1, asset: { contract: collection, identifier: id },
    price: { current: { currency: 'ETH', decimals: 18, value: '900719925474099300200' } }, protocol_data: { parameters, signature: null } };
  const signed = { parameters: clone(parameters), signature: `0x${'1'.repeat(130)}` };
  signed.parameters.salt = '0x3e7';
  const { counter: _counter, ...callParameters } = clone(parameters); callParameters.totalOriginalConsiderationItems = '3';
  const response = { protocol: 'seaport1.6', fulfillment_data: { orders: [signed], transaction: {
    function: functionSignature, chain: 4663, to: P.seaport, value: original.price.current.value,
    value_hex: `0x${BigInt(original.price.current.value).toString(16)}`, calldata_suffix: '0xcdb44011',
    input_data: { advancedOrder: { parameters: callParameters, numerator: 1, denominator: 1, signature: signed.signature, extraData: '0x' },
      criteriaResolvers: [], fulfillerConduitKey: zeroHash, recipient: wallet } } } };
  return { original, response };
}
const input = fixtures => ({ collection, orderHashes: fixtures.map(f => f.original.order_hash), anchor, wallet });
function harness(fixtures = [fixture()], options = {}) {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    const f = fixtures.find(f => request.method === 'GET' ? url.endsWith(f.original.order_hash) : JSON.parse(request.body).listing.hash === f.original.order_hash);
    assert.ok(f, 'only a selected exact hash is requested');
    return options.respond ? options.respond(f, request, url) : Response.json(request.method === 'GET' ? { order: f.original } : f.response);
  };
  const reader = createOpenSeaFulfillmentListingReader({ apiKey: key, fetchImpl, now: () => now, ...options.reader });
  return { reader, calls, fixtures, run: () => reader.loadListings(input(fixtures)) };
}
const tx = f => f.response.fulfillment_data.transaction;
const signed = f => f.response.fulfillment_data.orders[0];
const advanced = f => tx(f).input_data.advancedOrder;

test('GET then fixed POST returns only bound signed originals preserving every required fee', async () => {
  const h = harness(), [result] = await h.run(), original = h.fixtures[0].original;
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, `https://api.opensea.io/api/v2/orders/chain/robinhood/protocol/${P.seaport}/${original.order_hash}`);
  assert.equal(h.calls[0].request.method, 'GET'); assert.equal(h.calls[0].request.body, undefined);
  assert.equal(h.calls[1].url, 'https://api.opensea.io/api/v2/listings/fulfillment_data');
  assert.equal(h.calls[1].request.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[1].request.body), { listing: { hash: original.order_hash, chain: 'robinhood', protocol_address: P.seaport },
    fulfiller: { address: wallet }, recipient: wallet, units_to_fill: 1, include_optional_creator_fees: false });
  for (const { request } of h.calls) {
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit');
    assert.equal(request.headers['x-api-key'], key); assert.equal(request.referrerPolicy, 'no-referrer');
  }
  assert.deepEqual(result.protocol_data.parameters, original.protocol_data.parameters);
  assert.equal(result.protocol_data.parameters.consideration.length, 3);
  assert.equal(result.protocol_data.signature, signed(h.fixtures[0]).signature);
  assert.equal(result.price.current.value, original.price.current.value);
  assert.equal(result.transaction, undefined); assert.equal(result.fulfillment_data, undefined);
  assert.ok(Object.isFrozen(result.protocol_data.parameters.consideration));
  const source = result.sourceProvenance;
  assert.equal(source.executionAuthority, 'NONE'); assert.equal(source.transactionBroadcasts, 0); assert.equal(source.orderCreations, 0);
  assert.equal(source.signatureVending, 'MAY_OCCUR'); assert.equal(source.wallet, wallet); assert.deepEqual(source.anchor, anchor);
  assert.match(source.original.responseSha256, /^[0-9a-f]{64}$/); assert.match(source.fulfillment.requestSha256, /^[0-9a-f]{64}$/);
  assert.match(source.fulfillment.responseSha256, /^[0-9a-f]{64}$/); assert.equal(source.providerState, 'OBSERVED_LATEST_NOT_BLOCK_PINNED');
  const normalized = normalizeNativeListing(result, { collection, nowSeconds: BigInt(anchor.timestamp) });
  const coreData = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', args: [
    { parameters: normalized.parameters, numerator: 1n, denominator: 1n, signature: normalized.signature, extraData: '0x' }, [], zeroHash, wallet] });
  assert.equal(source.verifiedCall.dataHash, keccak256(coreData)); assert.equal(source.verifiedCall.selector, '0xe7acab24');
  assert.equal(source.attributionSuffix, '0xcdb44011'); assert.equal(source.attributionAppended, false);
  assert.notEqual(source.verifiedCall.dataHash, keccak256(`${coreData}cdb44011`));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('all five originals pass before any POST; ten calls maximum and no retries', async () => {
  const h = harness(Array.from({ length: 5 }, (_, i) => fixture(String(i))));
  const result = await h.run(); assert.equal(result.length, 5); assert.equal(h.calls.length, LIMITS.maxRequests);
  assert.deepEqual(h.calls.map(call => call.request.method), [...Array(5).fill('GET'), ...Array(5).fill('POST')]);
});

test('wallet, selection and request authority validate before any network operation', async () => {
  const h = harness(), original = input(h.fixtures);
  for (const value of [undefined, null, zero, address('a').toUpperCase(), 'http://127.0.0.1']) {
    await assert.rejects(() => h.reader.loadListings({ ...original, wallet: value }), /WALLET|ADDRESS|SELECTION/);
  }
  for (const field of ['url', 'endpoint', 'rpcUrl', 'chain', 'protocol', 'apiKey', 'fulfiller', 'recipient', 'transaction', 'signature']) {
    await assert.rejects(() => h.reader.loadListings({ ...original, [field]: 'http://private.example' }));
  }
  for (const hashes of [[], [...original.orderHashes, ...original.orderHashes], ['http://127.0.0.1'], [`${original.orderHashes[0]}/../../private`]]) {
    await assert.rejects(() => h.reader.loadListings({ ...original, orderHashes: hashes }));
  }
  await assert.rejects(() => h.reader.loadListings({ ...original, collection: P.collection }), /CONTROLLING_COLLECTION/);
  await assert.rejects(() => h.reader.loadListings({ ...original, anchor: { ...anchor, rpcUrl: 'http://private.example' } }));
  await assert.rejects(() => h.reader.loadListings(input(Array.from({ length: 6 }, (_, i) => fixture(String(i))))));
  let invoked = false;
  await assert.rejects(() => h.reader.loadListings({ ...original, get wallet() { invoked = true; return wallet; } }));
  assert.equal(invoked, false); assert.equal(h.calls.length, 0);
});

for (const [name, mutate] of [
  ['wrong chain', f => { f.original.chain = 'ethereum'; }],
  ['alternate Seaport', f => { f.original.protocol_address = address('9'); }],
  ['restricted order', f => { f.original.protocol_data.parameters.orderType = 2; }],
  ['partial order', f => { f.original.protocol_data.parameters.orderType = 1; }],
  ['signed zone', f => { f.original.protocol_data.parameters.zone = address('9'); }],
  ['zone hash', f => { f.original.protocol_data.parameters.zoneHash = hash('9'); }],
  ['non-native quote', f => { f.original.price.current.currency = 'WETH'; }],
  ['non-native payment', f => { f.original.protocol_data.parameters.consideration[0].itemType = 1; }],
  ['price mismatch', f => { f.original.price.current.value = '1'; }],
  ['floating point price', f => { f.original.price.current.value = 900719925474099300200; }],
  ['missing original counter', f => { delete f.original.protocol_data.parameters.counter; }],
  ['changed counter', f => { f.original.protocol_data.parameters.counter = '1'; }],
  ['changed salt', f => { f.original.protocol_data.parameters.salt = '1'; }],
  ['malformed observed signature', f => { f.original.protocol_data.signature = '0x'; }],
  ['removed required fee', f => { f.original.protocol_data.parameters.consideration.pop(); }],
  ['invalid fee token', f => { f.original.protocol_data.parameters.consideration[0].token = address('9'); }],
  ['floating price', f => { f.original.protocol_data.parameters.consideration[0].endAmount = '1'; }],
  ['changed seller', f => { f.original.protocol_data.parameters.offerer = address('9'); }],
  ['self purchase', f => { f.original.protocol_data.parameters.offerer = wallet; }],
  ['wrong asset', f => { f.original.asset.contract = address('9'); }],
  ['wrong token ID', f => { f.original.asset.identifier = '900'; }],
  ['criteria NFT', f => { f.original.protocol_data.parameters.offer[0].itemType = 4; }],
  ['extra offered NFT', f => { f.original.protocol_data.parameters.offer.push(clone(f.original.protocol_data.parameters.offer[0])); }],
  ['inactive order', f => { f.original.status = 'INACTIVE'; }],
  ['filled order', f => { f.original.remaining_quantity = 0; }],
  ['expired order', f => { f.original.protocol_data.parameters.endTime = String(now / 1000 + 60); }],
]) test(`pre-vending validation rejects ${name} with zero POSTs`, async () => {
  const fixtures = [fixture(), fixture('94')]; mutate(fixtures[1]);
  const h = harness(fixtures); await assert.rejects(h.run);
  assert.equal(h.calls.filter(call => call.request.method === 'POST').length, 0);
});

test('wrong returned GET hash and duplicate NFTs fail before signature vending', async () => {
  const a = fixture(), b = fixture(); b.original.protocol_data.parameters.salt = '1';
  b.original.order_hash = hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: b.original.protocol_data.parameters });
  const h = harness([a, b]); await assert.rejects(h.run, /DUPLICATE_NFT/); assert.equal(h.calls.length, 2);
  const wrong = harness([fixture()], { respond: f => Response.json({ order: { ...f.original, order_hash: hash('9') } }) });
  await assert.rejects(wrong.run, /ORDER_HASH_MISMATCH/); assert.equal(wrong.calls.length, 1);
});

for (const [name, mutate] of [
  ['wrong protocol', f => { f.response.protocol = 'seaport1.5'; }],
  ['additional order', f => { f.response.fulfillment_data.orders.push(clone(signed(f))); }],
  ['missing signature', f => { delete signed(f).signature; }],
  ['null signature', f => { signed(f).signature = null; }],
  ['invalid signature', f => { signed(f).signature = '0x1234'; }],
  ['changed signed counter', f => { signed(f).parameters.counter = '1'; }],
  ['changed signed salt', f => { signed(f).parameters.salt = '1'; }],
  ['changed required fee', f => { signed(f).parameters.consideration[1].startAmount = '0'; }],
  ['removed required fee', f => { signed(f).parameters.consideration.pop(); }],
  ['extra signed field', f => { signed(f).parameters.arbitraryCallback = 'https://evil.example'; }],
  ['unsafe integer counter', f => { signed(f).parameters.counter = 9007199254740992; }],
  ['wrong chain', f => { tx(f).chain = 1; }],
  ['string chain', f => { tx(f).chain = '4663'; }],
  ['wrong target', f => { tx(f).to = address('9'); }],
  ['wrong native value', f => { tx(f).value = '1'; }],
  ['wrong hexadecimal value', f => { tx(f).value_hex = '0x1'; }],
  ['extra wallet calldata', f => { tx(f).data = '0x12345678'; }],
  ['extra wallet sender', f => { tx(f).from = wallet; }],
  ['basic function', f => { tx(f).function = 'fulfillBasicOrder'; }],
  ['batch function', f => { tx(f).function = 'fulfillAvailableAdvancedOrders'; }],
  ['selector-only function', f => { tx(f).function = '0xe7acab24'; }],
  ['wrong canonical signature', f => { tx(f).function = 'fulfillAdvancedOrder(bytes)'; }],
  ['function trailing payload', f => { tx(f).function += ';transfer(address,uint256)'; }],
  ['mismatching call signature', f => { advanced(f).signature = `0x${'2'.repeat(130)}`; }],
  ['mismatching call order', f => { advanced(f).parameters.salt = '1'; }],
  ['call removes fee', f => { advanced(f).parameters.consideration.pop(); }],
  ['call changes fee recipient', f => { advanced(f).parameters.consideration[1].recipient = address('9'); }],
  ['call adds counter', f => { advanced(f).parameters.counter = '0'; }],
  ['restricted call extraData', f => { advanced(f).extraData = '0x00'; }],
  ['partial numerator', f => { advanced(f).numerator = 0; }],
  ['partial denominator', f => { advanced(f).denominator = 2; }],
  ['criteria resolver', f => { tx(f).input_data.criteriaResolvers = [{}]; }],
  ['nonzero fulfiller conduit', f => { tx(f).input_data.fulfillerConduitKey = hash('6'); }],
  ['different recipient', f => { tx(f).input_data.recipient = seller; }],
  ['extra call field', f => { tx(f).input_data.approval = {}; }],
  ['short attribution', f => { tx(f).calldata_suffix = '0x'; }],
  ['long attribution', f => { tx(f).calldata_suffix = '0xcdb4401100'; }],
  ['trailing attribution', f => { tx(f).calldata_suffix = '0xcdb44011 '; }],
  ['unknown attribution format', f => { tx(f).calldata_suffix = 'https://evil.example'; }],
]) test(`signed fulfillment rejects ${name} without returning executable instructions`, async () => {
  const f = fixture(); mutate(f); const h = harness([f]); await assert.rejects(h.run);
  assert.equal(h.calls.length, 2);
});

test('accepted function and lossless number representations encode exactly the fixed core call', async () => {
  const f = fixture(); tx(f).function = 'fulfillAdvancedOrder';
  signed(f).parameters.counter = 0; advanced(f).parameters.startTime = Number(advanced(f).parameters.startTime);
  signed(f).parameters.salt = `0x${'3e7'.padStart(64, '0')}`;
  advanced(f).numerator = '1'; advanced(f).denominator = '1';
  delete tx(f).value_hex; delete tx(f).calldata_suffix;
  f.original.protocol_data.parameters.salt = '0x3e7';
  const [result] = await harness([f]).run(); assert.equal(result.protocol_data.parameters.salt, '999');
  assert.equal(result.sourceProvenance.attributionSuffix, null); assert.equal(result.sourceProvenance.attributionAppended, false);
});

test('a signature already observed by GET must equal the fulfilled signature', async () => {
  const f = fixture(); f.original.protocol_data.signature = `0x${'2'.repeat(130)}`;
  await assert.rejects(harness([f]).run, /SIGNATURE_CHANGED/);
});

test('HTTP and transport failures are sanitized and never retried in either stage', async () => {
  for (const stage of ['GET', 'POST']) for (const status of [401, 403, 404, 409, 429, 500]) {
    const h = harness([fixture()], { respond: (f, request) => request.method === stage
      ? new Response(`${key} private error`, { status }) : Response.json({ order: f.original }) });
    await assert.rejects(h.run, error => /HTTP/.test(error.code) && !error.message.includes(key));
    assert.equal(h.calls.length, stage === 'GET' ? 1 : 2);
  }
  const h = harness([fixture()], { respond: () => { throw Error(key); } });
  await assert.rejects(h.run, /^OpenSeaFulfillmentListingError: OPENSEA_FULFILLMENT_SOURCE_UNAVAILABLE$/);
});

test('POST redirects and unexpected final URLs are rejected without visiting alternate endpoints', async () => {
  for (const kind of ['status', 'redirected', 'url']) {
    const h = harness([fixture()], { respond: (f, request) => {
      if (request.method === 'GET') return Response.json({ order: f.original });
      const response = kind === 'status' ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }) : Response.json(f.response);
      if (kind !== 'status') Object.defineProperty(response, kind, { value: kind === 'url' ? 'https://evil.example' : true });
      return response;
    } });
    await assert.rejects(h.run, /ENDPOINT_CHANGED|HTTP_UNAVAILABLE/); assert.equal(h.calls.length, 2);
  }
});

test('declared/streamed oversized POST bodies and malformed responses fail closed', async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const h = harness([fixture()], { respond: (f, request) => request.method === 'GET' ? Response.json({ order: f.original }) : new Response(
      new ReadableStream({ start(controller) { if (!declared) controller.enqueue(new Uint8Array(65_537)); }, cancel() { cancelled = true; } }),
      { headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': '65537' } : {}) } }) });
    await assert.rejects(h.run, /RESPONSE_TOO_LARGE/); assert.equal(cancelled, true);
  }
  for (const response of [Response.json([]), new Response('{}'), new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } })]) {
    const h = harness([fixture()], { respond: (f, request) => request.method === 'GET' ? Response.json({ order: f.original }) : response });
    await assert.rejects(h.run, /RESPONSE_INVALID/);
  }
});

test('stalled POST fetch/body and one shared GET-plus-POST deadline abort without retry', async () => {
  for (const stalled of ['fetch', 'body']) {
    let aborted, cancelled = false;
    const h = harness([fixture()], { reader: { callTimeoutMs: 15 }, respond: (f, request) => {
      if (request.method === 'GET') return Response.json({ order: f.original });
      aborted = request.signal;
      return stalled === 'fetch' ? new Promise(() => {}) : new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(h.run, /TIMEOUT/); assert.equal(aborted.aborted, true);
    assert.equal(cancelled, stalled === 'body'); assert.equal(h.calls.length, 2);
  }
  const h = harness([fixture()], { reader: { timeoutMs: 30, callTimeoutMs: 80 }, respond: async (f, request) => {
    await new Promise(resolve => setTimeout(resolve, 20)); return Response.json(request.method === 'GET' ? { order: f.original } : f.response);
  } });
  await assert.rejects(h.run, /TIMEOUT/); assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.request.signal.aborted));
});

test('late GET completion after timeout cannot initiate a signature POST', async () => {
  let resolveGet, cancelled = false;
  const h = harness([fixture()], { reader: { timeoutMs: 10 }, respond: () => new Promise(resolve => { resolveGet = resolve; }) });
  await assert.rejects(h.run, /TIMEOUT/);
  resolveGet(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(h.calls.length, 1); assert.equal(cancelled, true);
});

test('expiry and server-clock regressions between stages never produce a signed result', async () => {
  let calls = 0;
  const h = harness([fixture()], { reader: { now: () => now + (calls++ >= 2 ? 3600_000 : 0) } });
  await assert.rejects(h.run, /EXPIRED/);
  const rewind = harness([fixture()], { reader: { now: () => now - calls++ } });
  await assert.rejects(rewind.run, /CLOCK_UNAVAILABLE/); assert.equal(rewind.calls.filter(call => call.request.method === 'POST').length, 0);
  assert.throws(() => createOpenSeaFulfillmentListingReader({ apiKey: `${key}\nheader` }), /CONFIGURATION/);
  assert.throws(() => createOpenSeaFulfillmentListingReader({ apiKey: key, timeoutMs: 8001 }), /BOUNDS/);
});
