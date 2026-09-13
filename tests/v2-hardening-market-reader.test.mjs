import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMarketReaderV2 } from '../broker/src/v4/skill-forge/market-reader-v2.mjs';
import { createSkillToolGate, manifestHash, instructionHash, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';

const CONTRACT = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, ZERO = `0x${'0'.repeat(40)}`;
const HASH = `0x${'a'.repeat(64)}`, SEAPORT = '0x0000000000000068f116a894984e2db1123eb395';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const NOW = 1_789_320_000_000;
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function listing({ weth = false } = {}) {
  const consideration = { itemType: weth ? 1 : 0, token: weth ? WETH : ZERO, identifierOrCriteria: '0',
    startAmount: '900719925474099312345', endAmount: '900719925474099312345', recipient: OTHER };
  return { chain: 'robinhood', order_hash: HASH, protocol_address: SEAPORT, status: 'ACTIVE',
    asset: { contract: CONTRACT, identifier: '900719925474099312345' }, remaining_quantity: 1,
    price: { current: { value: consideration.startAmount, decimals: 18, currency: weth ? 'WETH' : 'ETH' } },
    protocol_data: { signature: 'DO_NOT_FORWARD_SIGNATURE', parameters: {
      offer: [{ itemType: 2, token: CONTRACT, identifierOrCriteria: '900719925474099312345', startAmount: '1', endAmount: '1' }],
      consideration: [consideration], totalOriginalConsiderationItems: 1,
      offerer: OTHER, zone: ZERO, startTime: '1789319000', endTime: '1789321000', orderType: 0,
      salt: 'DO_NOT_FORWARD_SALT', conduitKey: 'DO_NOT_FORWARD_CONDUIT',
    } }, transaction: { data: 'DO_NOT_FORWARD_CALLDATA' } };
}
function fixture({ listings = [listing()], pages, fetchImpl, now = () => NOW, ...bounds } = {}) {
  const calls = []; let index = 0;
  const reader = createMarketReaderV2({ apiKey: 'TEST_ONLY_SECRET', now, ...bounds,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      if (url.includes('/collections/')) return response({ name: 'Example', contracts: [{ chain: 'robinhood', address: CONTRACT }] });
      const value = pages ? pages[index++] : { listings, next: null };
      if (value instanceof Response) return value;
      return response(value);
    } });
  return { reader, calls };
}
const get = (f, options = {}) => f.reader.getListings({ slug: 'example', contract: CONTRACT, ...options });

test('v2 exposes exact asset identity, native ETH sum, unit price, quantity, expiry and explicit unknown validity', async () => {
  const raw = listing();
  raw.protocol_data.parameters.consideration.push({ ...raw.protocol_data.parameters.consideration[0], startAmount: '5', endAmount: '5' });
  raw.protocol_data.parameters.totalOriginalConsiderationItems = 2;
  raw.price.current.value = '900719925474099312350';
  const f = fixture({ listings: [raw] }), result = await get(f);
  assert.equal(result.identityVerified, true); assert.equal(result.walletAuthority, 'NONE');
  assert.equal(result.executable, false); assert.equal(result.coverage.status, 'BOUNDED_SAMPLE');
  assert.equal(result.coverage.collectionFloor, null); assert.equal(result.coverage.collectionFloorVerified, false);
  assert.equal(result.coverage.providerPaginationExhausted, true);
  assert.deepEqual(result.listings[0].asset, { chainId: 4663, contract: CONTRACT, tokenId: '900719925474099312345', standard: 'ERC721' });
  assert.deepEqual(result.listings[0].paymentToken, { chainId: 4663, address: ZERO, symbol: 'ETH', decimals: 18, kind: 'NATIVE' });
  assert.equal(result.listings[0].price.totalAmount, '900719925474099312350');
  assert.equal(result.listings[0].price.unitAmount, result.listings[0].price.totalAmount);
  assert.equal(result.listings[0].price.includesListedFees, true);
  assert.equal(result.listings[0].price.includesGas, false);
  assert.equal(result.listings[0].quantity, '1'); assert.equal(result.listings[0].remainingQuantity, '1');
  assert.equal(result.listings[0].expiresAtUnix, '1789321000');
  assert.equal(result.listings[0].validity, 'UNVERIFIED_ON_CHAIN');
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_FORWARD|protocol_data|TEST_ONLY_SECRET/);
  assert.ok(f.calls.every(c => c.url.startsWith('https://api.opensea.io/api/v2/') && c.options.method === 'GET' && c.options.redirect === 'error'));
});

test('WETH is a distinct fixed Robinhood token, not inferred from its symbol', async () => {
  const result = await get(fixture({ listings: [listing({ weth: true })] }));
  assert.deepEqual(result.listings[0].paymentToken, { chainId: 4663, address: WETH, symbol: 'WETH', decimals: 18, kind: 'ERC20' });
  assert.equal(result.listings[0].price.currency, 'WETH');
});

test('listings expiring during read are removed before delivery, and clock regression withholds results', async () => {
  for (const end of [NOW + 1_000_000, NOW - 1]) {
    let reads = 0;
    const result = await get(fixture({ now: () => reads++ ? end : NOW }));
    assert.equal(result.listings.length, 0);
    if (end > NOW) assert.equal(result.coverage.excluded.EXPIRED_DURING_READ, 1);
    else assert.equal(result.coverage.unavailable, 'MARKET_CLOCK_UNAVAILABLE');
  }
});

const cases = {
  unsafePriceNumber: v => { v.price.current.value = 900719925474099300000; },
  safePriceNumber: v => { v.price.current.value = 1; },
  unsafeProtocolAmount: v => { v.protocol_data.parameters.consideration[0].startAmount = 900719925474099300000; },
  numericTokenId: v => { v.asset.identifier = 900719925474099300000; },
  wrongChain: v => { v.chain = 'ethereum'; },
  wrongNFTContract: v => { v.protocol_data.parameters.offer[0].token = OTHER; },
  wrongAssetContract: v => { v.asset.contract = OTHER; },
  wrongAssetId: v => { v.asset.identifier = '1'; },
  wrongCurrencyAddress: v => { v.protocol_data.parameters.consideration[0].token = OTHER; },
  ETHLabeledWETH: v => { v.price.current.currency = 'WETH'; },
  wrongDecimals: v => { v.price.current.decimals = 6; },
  stringDecimals: v => { v.price.current.decimals = '18'; },
  mixedCurrency: v => { v.protocol_data.parameters.consideration.push({ ...v.protocol_data.parameters.consideration[0], token: WETH, itemType: 1 }); v.protocol_data.parameters.totalOriginalConsiderationItems = 2; },
  wrongPaymentId: v => { v.protocol_data.parameters.consideration[0].identifierOrCriteria = '1'; },
  priceSumMismatch: v => { v.price.current.value = '1'; },
  dynamicPrice: v => { v.protocol_data.parameters.consideration[0].endAmount = '1'; },
  oversizedInteger: v => { v.price.current.value = ((1n << 256n) + 1n).toString(); },
  considerationOverflow: v => { for (const key of ['startAmount', 'endAmount']) v.protocol_data.parameters.consideration[0][key] = ((1n << 256n) - 1n).toString(); v.protocol_data.parameters.consideration.push({ ...v.protocol_data.parameters.consideration[0] }); v.protocol_data.parameters.totalOriginalConsiderationItems = 2; },
  signedInteger: v => { v.price.current.value = '-1'; },
  exponentInteger: v => { v.price.current.value = '1e18'; },
  decimalInteger: v => { v.price.current.value = '1.0'; },
  paddedInteger: v => { v.price.current.value = '01'; },
  expired: v => { v.protocol_data.parameters.endTime = '1789320000'; },
  notStarted: v => { v.protocol_data.parameters.startTime = '1789320001'; },
  missingExpiry: v => { delete v.protocol_data.parameters.endTime; },
  filled: v => { v.remaining_quantity = 0; },
  tooManyRemaining: v => { v.remaining_quantity = 2; },
  invalidRemaining: v => { v.remaining_quantity = 1.1; },
  missingRemaining: v => { delete v.remaining_quantity; },
  nftQuantityMismatch: v => { v.protocol_data.parameters.offer[0].startAmount = '2'; },
  bundle: v => { v.protocol_data.parameters.offer.push({ ...v.protocol_data.parameters.offer[0] }); },
  ERC1155: v => { v.protocol_data.parameters.offer[0].itemType = 3; },
  criteria: v => { v.protocol_data.parameters.offer[0].itemType = 4; },
  unrecognizedProtocol: v => { v.protocol_address = OTHER; },
  cancelled: v => { v.status = 'CANCELLED'; },
  missingStatus: v => { delete v.status; },
  unsupportedOrderType: v => { v.protocol_data.parameters.orderType = 4; },
  missingConsiderationFee: v => { v.protocol_data.parameters.totalOriginalConsiderationItems = 2; },
  invalidRecipient: v => { v.protocol_data.parameters.consideration[0].recipient = 'javascript:bad'; },
  noProtocol: v => { delete v.protocol_data; },
};
for (const [name, alter] of Object.entries(cases)) {
  test(`v2 excludes ${name} without turning it into a usable price or false floor`, async () => {
    const raw = listing(); alter(raw);
    const result = await get(fixture({ listings: [raw] }));
    assert.equal(result.listings.length, 0); assert.equal(result.coverage.listingsRead, 1);
    assert.equal(Object.values(result.coverage.excluded).reduce((a, b) => a + b, 0), 1);
    assert.equal(result.coverage.collectionFloorVerified, false); assert.equal(result.coverage.collectionFloor, null);
  });
}

test('pagination uses only an encoded cursor on the fixed GET route and deduplicates hashes', async () => {
  const other = listing(); other.order_hash = `0x${'b'.repeat(64)}`;
  const f = fixture({ pages: [{ listings: [listing()], next: 'abc/=+' }, { listings: [listing(), other], next: null }] });
  const result = await get(f);
  assert.equal(result.listings.length, 2); assert.equal(result.coverage.pagesRead, 2);
  assert.equal(result.coverage.excluded.DUPLICATE_ORDER, 1);
  assert.match(f.calls[2].url, /&next=abc%2F%3D%2B$/);
});

test('bounded pagination stops at the result/page limit and never labels the sample a floor', async () => {
  const f = fixture({ pages: [{ listings: [listing()], next: 'more' }] });
  const result = await get(f, { limit: 1, maxPages: 3 });
  assert.equal(f.calls.length, 2); assert.equal(result.coverage.providerPaginationExhausted, false);
  const raw = listing(); raw.chain = 'ethereum';
  const g = fixture({ pages: [{ listings: [raw], next: 'one' }, { listings: [raw], next: 'two' }] });
  const out = await get(g); assert.equal(out.coverage.pagesRead, 2);
  assert.equal(out.coverage.providerPaginationExhausted, false);
  assert.equal(out.coverage.status, 'BOUNDED_SAMPLE');
});

test('repeated, hostile and oversized cursors cannot redirect fetches', async () => {
  for (const cursor of ['https://evil.example?secret=x', '../private?api_key=x', 'x'.repeat(1025)]) {
    const f = fixture({ pages: [{ listings: [listing()], next: cursor }] });
    const result = await get(f);
    assert.equal(f.calls.length, 2); assert.equal(result.coverage.unavailable, 'INVALID_PAGINATION');
    assert.doesNotMatch(JSON.stringify(result), /evil\.example|api_key/);
  }
  const f = fixture({ pages: [{ listings: [listing()], next: 'same' }, { listings: [listing()], next: 'same' }] });
  assert.equal((await get(f)).coverage.unavailable, 'PAGINATION_REPEATED');
  assert.equal(f.calls.length, 3);
});

test('second-page outage retains supported observations with explicit partial coverage', async () => {
  const f = fixture({ pages: [{ listings: [listing()], next: 'more' }, new Response('SECRET_BODY', { status: 429 })] });
  const result = await get(f);
  assert.equal(result.listings.length, 1); assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.unavailable, 'OPENSEA_HTTP_429');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_BODY/);
});

test('empty successful response is a bounded empty sample, not unavailable or a zero floor', async () => {
  const result = await get(fixture({ listings: [] }));
  assert.equal(result.coverage.status, 'BOUNDED_SAMPLE'); assert.equal(result.coverage.unavailable, null);
  assert.equal(result.coverage.collectionFloor, null); assert.deepEqual(result.listings, []);
});

test('upstream, collection mismatch, malformed and oversized payloads expose fixed unavailable codes only', async () => {
  for (const fetchImpl of [async () => new Response('KEY_PRIVATE', { status: 403 }),
    async () => response({ contracts: [{ chain: 'ethereum', address: CONTRACT }] }),
    async () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } }),
    async () => new Response('SECRET_MALFORMED', { headers: { 'content-type': 'application/json' } }),
    async () => { throw Error('SECRET_UPSTREAM_URL'); }]) {
    const result = await get(fixture({ fetchImpl }));
    assert.equal(result.coverage.status, 'UNAVAILABLE'); assert.equal(result.identityVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|KEY_PRIVATE/);
  }
});

test('a stuck fetch or streamed body obeys the deadline even if the transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } })]) {
    const f = fixture({ fetchImpl, timeoutMs: 30, callTimeoutMs: 15 });
    let settled = false;
    const pending = get(f).then(result => { settled = true; return result; });
    await Promise.resolve();
    t.mock.timers.tick(14); await Promise.resolve(); assert.equal(settled, false);
    t.mock.timers.tick(1); const result = await pending;
    assert.equal(result.coverage.unavailable, 'MARKET_TIMEOUT'); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.signal.aborted, true);
  }
});

test('invalid user inputs and credentials cannot choose a host, method or unbounded pages', async () => {
  for (const options of [{ slug: '../../x' }, { slug: 'https://evil.example' }, { contract: 'bad' },
    { limit: 21 }, { maxPages: 4 }, { maxPages: 0 }]) {
    const f = fixture(); await assert.rejects(get(f, options)); assert.equal(f.calls.length, 0);
  }
  for (const apiKey of ['', 'x\r\nx']) assert.throws(() => createMarketReaderV2({ apiKey }), /CREDENTIAL/);
});

test('new package pins only v2 and preserves independently registered v1 implementation hashes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../broker/skills/market-scout/v2/manifest.json', import.meta.url)));
  const source = await readFile(new URL(`../${manifest.implementation}`, import.meta.url));
  assert.equal(manifest.version, 2); assert.equal(manifest.walletAuthority, 'NONE');
  assert.equal(createHash('sha256').update(source).digest('hex'), manifest.implementationSha256);
  for (const slug of ['rarity-eye', 'market-scout', 'contract-detective']) {
    const original = JSON.parse(await readFile(new URL(`../broker/skills/${slug}/v1/manifest.json`, import.meta.url)));
    const bytes = await readFile(new URL(`../${original.implementation}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.implementationSha256);
  }
});

test('v2 package works behind the existing learned/equipped gate and unequip removes the real tool', async () => {
  const manifest = JSON.parse(await readFile(new URL('../broker/skills/market-scout/v2/manifest.json', import.meta.url)));
  const instructions = await readFile(new URL('../broker/skills/market-scout/v2/SKILL.md', import.meta.url), 'utf8');
  const pack = { manifest, instructions, approved: true, status: 'READY' }; // Disposable acceptance fixture only.
  const state = { owner: OTHER, tokenId: '93', chainId: 4663, slots: 1, mask: '4', blockHash: HASH,
    blockTime: Date.now(), equipped: [{ key: skillKey(8, 2), slot: 0, level: 1, available: true,
      definition: { status: 4, disabled: false, deprecated: false, capabilities: 4n,
        manifestHash: manifestHash(manifest), instructionHash: instructionHash(instructions) } }] };
  const f = fixture(), gate = createSkillToolGate({ packages: [pack], readState: async () => state,
    implementations: { get_market_listings: args => f.reader.getListings(args) } });
  const context = await gate.resolve({ tokenId: '93', owner: OTHER });
  assert.deepEqual(context.effectiveMcpTools, ['get_market_listings']); assert.equal(context.walletAuthority, 'NONE');
  const call = () => gate.call({ tokenId: '93', owner: OTHER, name: 'get_market_listings', arguments: { slug: 'example', contract: CONTRACT } });
  assert.equal((await call()).listings.length, 1);
  state.equipped = [];
  assert.deepEqual((await gate.resolve({ tokenId: '93', owner: OTHER })).effectiveMcpTools, []);
  await assert.rejects(call(), /SKILL_TOOL_DENIED/);
  assert.equal(f.calls.length, 2, 'unequipped call makes no provider request');
});
