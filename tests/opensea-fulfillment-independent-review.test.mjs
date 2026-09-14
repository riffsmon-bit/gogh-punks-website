import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, hashStruct, keccak256, toFunctionSignature } from 'viem';
import { createOpenSeaFulfillmentListingReader } from '../broker/src/v4/marketplace/opensea-fulfillment-listings.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_ORDER_TYPES, SEAPORT_ABI } from '../broker/src/v4/marketplace/contracts.mjs';
import { normalizeNativeListing } from '../broker/src/v4/marketplace/review.mjs';

// Independent synthetic wire fixtures. No live OpenSea, wallet, RPC, signature
// vending, order creation or transaction broadcasting is performed by this file.
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const collection = address('1'), seller = address('2'), wallet = address('3'), feeRecipient = address('4');
const zero = address('0'), zeroHash = hash('0'), other = address('5'), now = 1_900_000_000_000;
const anchor = { number: '937483', hash: hash('6'), timestamp: String(now / 1000) };
const apiKey = 'independent-offline-review-key';
const fullSignature = toFunctionSignature(SEAPORT_ABI.find(value => value.name === 'fulfillAdvancedOrder'));
const clone = value => structuredClone(value);

function fixture(tokenId = '340282366920938463463374607431768211456') {
  const fee = (amount, recipient) => ({ itemType: 0, token: zero, identifierOrCriteria: '0', startAmount: amount, endAmount: amount, recipient });
  const parameters = { offerer: seller, zone: zero, offer: [{ itemType: 2, token: collection, identifierOrCriteria: tokenId, startAmount: '1', endAmount: '1' }],
    consideration: [fee('900719925474099300003', seller), fee('213', feeRecipient), fee('1', other)],
    orderType: 0, startTime: String(now / 1000 - 1), endTime: String(now / 1000 + 3600), zoneHash: zeroHash,
    salt: '340282366920938463463374607431768211507', conduitKey: hash('7'), totalOriginalConsiderationItems: 3,
    counter: '9007199254740993' };
  const original = { chain: 'robinhood', protocol_address: P.seaport,
    order_hash: hashStruct({ types: MARKETPLACE_ORDER_TYPES, primaryType: 'OrderComponents', data: parameters }),
    status: 'ACTIVE', remaining_quantity: '1', asset: { contract: collection, identifier: tokenId },
    price: { current: { currency: 'ETH', decimals: 18, value: '900719925474099300217' } }, protocol_data: { parameters, signature: null } };
  const signed = { parameters: clone(parameters), signature: `0x${'18'.repeat(64)}` };
  const { counter, ...callParameters } = clone(parameters);
  const response = { protocol: 'seaport1.6', fulfillment_data: { orders: [signed], transaction: {
    chain: 4663, to: P.seaport, value: original.price.current.value, function: fullSignature, calldata_suffix: '0x01020304',
    input_data: { advancedOrder: { parameters: callParameters, numerator: '1', denominator: '1', signature: signed.signature, extraData: '0x' },
      criteriaResolvers: [], fulfillerConduitKey: zeroHash, recipient: wallet } } } };
  return { original, response };
}
const inputFor = fixtures => ({ collection, wallet, anchor: clone(anchor), orderHashes: fixtures.map(value => value.original.order_hash) });
const signed = value => value.response.fulfillment_data.orders[0];
const transaction = value => value.response.fulfillment_data.transaction;
const advanced = value => transaction(value).input_data.advancedOrder;

function harness(fixtures = [fixture()], { respond, readerOptions = {} } = {}) {
  const calls = [];
  const reader = createOpenSeaFulfillmentListingReader({ apiKey, now: () => now, ...readerOptions, fetchImpl: async (url, request) => {
    calls.push({ url, request });
    const selectedHash = request.method === 'GET' ? url.split('/').at(-1) : JSON.parse(request.body).listing.hash;
    const selected = fixtures.find(value => value.original.order_hash === selectedHash);
    assert.ok(selected, 'Request must match an exact selected order');
    return respond ? respond(selected, request, url) : Response.json(request.method === 'GET' ? { order: selected.original } : selected.response);
  } });
  return { fixtures, reader, calls, run: (input = inputFor(fixtures)) => reader.loadListings(input) };
}

test('independent exact-large-value fixture preserves original fees/counter and excludes executable attribution', async () => {
  const h = harness(), [listing] = await h.run(), expected = h.fixtures[0];
  assert.deepEqual(listing.protocol_data.parameters, expected.original.protocol_data.parameters);
  assert.equal(listing.protocol_data.signature, signed(expected).signature);
  assert.equal(listing.protocol_data.parameters.counter, '9007199254740993');
  assert.equal(listing.price.current.value, '900719925474099300217');
  assert.deepEqual(listing.protocol_data.parameters.consideration.map(value => value.recipient), [seller, feeRecipient, other]);
  const normalized = normalizeNativeListing(listing, { collection, nowSeconds: BigInt(anchor.timestamp) });
  const calldata = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', args: [
    { parameters: normalized.parameters, numerator: 1n, denominator: 1n, signature: normalized.signature, extraData: '0x' }, [], zeroHash, wallet] });
  assert.equal(listing.sourceProvenance.verifiedCall.dataHash, keccak256(calldata));
  assert.notEqual(listing.sourceProvenance.verifiedCall.dataHash, keccak256(`${calldata}01020304`));
  assert.equal(listing.sourceProvenance.attributionAppended, false);
  assert.equal(listing.sourceProvenance.executionAuthority, 'NONE');
  assert.equal(listing.sourceProvenance.signatureVerification, 'REQUIRES_PINNED_SEAPORT_SIMULATION');
  assert.equal(listing.sourceProvenance.providerState, 'OBSERVED_LATEST_NOT_BLOCK_PINNED');
  assert.equal(listing.transaction, undefined); assert.equal(listing.fulfillment_data, undefined);
  assert.ok(Object.isFrozen(listing.protocol_data.parameters.consideration));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, `https://api.opensea.io/api/v2/orders/chain/robinhood/protocol/${P.seaport}/${listing.order_hash}`);
  assert.equal(h.calls[1].url, 'https://api.opensea.io/api/v2/listings/fulfillment_data');
  assert.deepEqual(JSON.parse(h.calls[1].request.body), { listing: { hash: listing.order_hash, chain: 'robinhood', protocol_address: P.seaport },
    fulfiller: { address: wallet }, recipient: wallet, units_to_fill: 1, include_optional_creator_fees: false });
  for (const { request } of h.calls) {
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.referrerPolicy, 'no-referrer');
  }
  assert.ok(!JSON.stringify(listing).includes(apiKey));
});

for (const [name, mutate] of [
  ['redirect required fee while preserving all amounts', f => {
    signed(f).parameters.consideration[1].recipient = seller; advanced(f).parameters.consideration[1].recipient = seller;
  }],
  ['redistribute fees while preserving transaction total', f => {
    for (const p of [signed(f).parameters, advanced(f).parameters]) {
      p.consideration[1].startAmount = p.consideration[1].endAmount = '212';
      p.consideration[2].startAmount = p.consideration[2].endAmount = '2';
    }
  }],
  ['drop listed creator fee and lower all copied totals', f => {
    for (const p of [signed(f).parameters, advanced(f).parameters]) { p.consideration.pop(); p.totalOriginalConsiderationItems = 2; }
    transaction(f).value = '900719925474099300216';
  }],
  ['change seller in both vended order and advanced call', f => {
    signed(f).parameters.offerer = other; advanced(f).parameters.offerer = other;
  }],
  ['change NFT in both vended order and advanced call', f => {
    signed(f).parameters.offer[0].identifierOrCriteria = '9'; advanced(f).parameters.offer[0].identifierOrCriteria = '9';
  }],
  ['replace exact counter with adjacent integer', f => { signed(f).parameters.counter = '9007199254740994'; }],
  ['round exact counter through an unsafe JS number', f => { signed(f).parameters.counter = Number('9007199254740993'); }],
  ['replace previously observed signature in both vended copies', f => {
    f.original.protocol_data.signature = `0x${'29'.repeat(64)}`;
  }],
  ['redirect recipient away from resolved Agent', f => { transaction(f).input_data.recipient = seller; }],
  ['turn structured call into arbitrary calldata', f => { transaction(f).input_data = '0xe7acab24'; }],
  ['inject executable raw data beside structured call', f => { transaction(f).data = '0xdeadbeef'; }],
  ['extend canonical function signature', f => { transaction(f).function += ' '; }],
  ['add a fulfillment resolver', f => { transaction(f).input_data.criteriaResolvers = [{ orderIndex: 0 }]; }],
  ['append more than four attribution bytes', f => { transaction(f).calldata_suffix = '0x0102030405'; }],
]) test(`coordinated POST attack fails closed: ${name}`, async () => {
  const f = fixture(); mutate(f); const h = harness([f]); await assert.rejects(h.run);
  assert.deepEqual(h.calls.map(value => value.request.method), ['GET', 'POST']);
});

test('one invalid original prevents vending for the entire selected batch', async () => {
  const h = harness([fixture('1'), fixture('2'), fixture('3')]);
  h.fixtures[2].original.protocol_data.parameters.counter = '4';
  await assert.rejects(h.run, /ORDER_COMPONENTS_MISMATCH/);
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(value => value.request.method === 'GET'));
});

test('input is snapshotted before awaiting GET, so later caller mutation cannot redirect POST', async () => {
  let resolveGet;
  const h = harness([fixture()], { respond: (f, request) => request.method === 'GET'
    ? new Promise(resolve => { resolveGet = () => resolve(Response.json({ order: f.original })); }) : Response.json(f.response) });
  const input = inputFor(h.fixtures), pending = h.run(input);
  while (!resolveGet) await new Promise(resolve => setImmediate(resolve));
  input.wallet = other; input.collection = other; input.anchor.hash = hash('9'); input.orderHashes[0] = hash('9');
  resolveGet(); const [listing] = await pending;
  assert.equal(JSON.parse(h.calls[1].request.body).recipient, wallet);
  assert.equal(listing.sourceProvenance.anchor.hash, anchor.hash);
  assert.equal(listing.asset.contract, collection);
});

test('caller accessors, sparse selections and arbitrary endpoints reject before any IO', async () => {
  const h = harness(); let invoked = false;
  await assert.rejects(() => h.run({ ...inputFor(h.fixtures), get wallet() { invoked = true; return wallet; } }));
  await assert.rejects(() => h.run({ ...inputFor(h.fixtures), orderHashes: new Array(2) }));
  await assert.rejects(() => h.run({ ...inputFor(h.fixtures), endpoint: 'http://169.254.169.254/latest/meta-data' }));
  await assert.rejects(() => h.run({ ...inputFor(h.fixtures), orderHashes: [`${hash('9')}/../../private`] }));
  assert.equal(invoked, false); assert.equal(h.calls.length, 0);
});

for (const stage of ['GET', 'POST']) test(`${stage} redirect, final URL change and rate limit never follow or retry`, async () => {
  for (const kind of ['redirect', 'final-url', 'rate-limit']) {
    const h = harness([fixture()], { respond: (f, request) => {
      if (request.method !== stage) return Response.json({ order: f.original });
      if (kind === 'redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
      if (kind === 'rate-limit') return new Response(apiKey, { status: 429, headers: { 'retry-after': '1' } });
      const response = Response.json(request.method === 'GET' ? { order: f.original } : f.response);
      Object.defineProperty(response, 'url', { value: 'http://169.254.169.254/latest/meta-data' }); return response;
    } });
    await assert.rejects(h.run, error => !error.message.includes(apiKey));
    assert.equal(h.calls.length, stage === 'GET' ? 1 : 2);
    assert.ok(h.calls.every(value => value.url.startsWith('https://api.opensea.io/api/v2/')));
  }
});

test('a late fulfillment body after the deadline cannot produce a listing or initiate another request', async () => {
  let resolvePost, cancelled = false;
  const h = harness([fixture()], { readerOptions: { callTimeoutMs: 25 }, respond: (f, request) => request.method === 'GET'
    ? Response.json({ order: f.original }) : new Promise(resolve => { resolvePost = resolve; }) });
  await assert.rejects(h.run, /TIMEOUT/);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].request.signal.aborted, true);
  resolvePost(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cancelled, true); assert.equal(h.calls.length, 2);
});

test('post-vending expiry is rechecked instead of returning stale listing evidence', async () => {
  let time = now;
  const h = harness([fixture()], { readerOptions: { now: () => time }, respond: (f, request) => {
    if (request.method === 'POST') time += 3_600_000;
    return Response.json(request.method === 'GET' ? { order: f.original } : f.response);
  } });
  await assert.rejects(h.run, /ORDER_EXPIRED_OR_TOO_SOON/); assert.equal(h.calls.length, 2);
});

test('bounded streamed response cancellation rejects oversized fulfillment data', async () => {
  let cancelled = false;
  const h = harness([fixture()], { respond: (f, request) => request.method === 'GET' ? Response.json({ order: f.original }) : new Response(
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel() { cancelled = true; } }),
    { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(h.run, /RESPONSE_TOO_LARGE/); assert.equal(cancelled, true); assert.equal(h.calls.length, 2);
});
