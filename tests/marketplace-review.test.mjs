import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNativeListing, prepareMarketplaceReview } from '../broker/src/v4/marketplace/review.mjs';
import { MARKETPLACE_PINS as P } from '../broker/src/v4/marketplace/contracts.mjs';
const Z = `0x${'0'.repeat(40)}`, H = `0x${'0'.repeat(64)}`, collection = `0x${'1'.repeat(40)}`, owner = `0x${'2'.repeat(40)}`;
const raw = () => ({ chain: 'robinhood', protocol_address: P.seaport, order_hash: `0x${'3'.repeat(64)}`, status: 'ACTIVE', remaining_quantity: 1,
  asset: { contract: collection, identifier: '123' }, price: { current: { value: '900719925474099312345', currency: 'ETH', decimals: 18 } },
  protocol_data: { signature: `0x${'a'.repeat(130)}`, parameters: { offerer: owner, zone: Z, zoneHash: H, orderType: 0, startTime: '1', endTime: '1000',
    offer: [{ itemType: 2, token: collection, identifierOrCriteria: '123', startAmount: '1', endAmount: '1' }],
    consideration: [{ itemType: 0, token: Z, identifierOrCriteria: '0', startAmount: '900719925474099312345', endAmount: '900719925474099312345', recipient: owner }],
    salt: '9', counter: '0', conduitKey: H, totalOriginalConsiderationItems: 1 } } });
test('exact native listing retains uint256 precision and fixed recipient fees', () => {
  const value = normalizeNativeListing(raw(), { collection, nowSeconds: 10n });
  assert.equal(value.totalWei, '900719925474099312345'); assert.equal(value.parameters.consideration[0].startAmount, 900719925474099312345n);
});
const cases = [
  ['wrong chain', x => { x.chain = 'ethereum'; }, /CHAIN/],
  ['unknown venue', x => { x.protocol_address = collection; }, /PROTOCOL/],
  ['restricted zone', x => { x.protocol_data.parameters.orderType = 2; }, /RESTRICTED/],
  ['partial order', x => { x.protocol_data.parameters.orderType = 1; }, /PARTIAL/],
  ['external zone', x => { x.protocol_data.parameters.zone = owner; }, /RESTRICTED/],
  ['criteria NFT', x => { x.protocol_data.parameters.offer[0].itemType = 4; }, /ERC721/],
  ['bundle', x => { x.protocol_data.parameters.offer.push(x.protocol_data.parameters.offer[0]); }, /ERC721/],
  ['quantity', x => { x.remaining_quantity = 2; }, /ACTIVE/],
  ['native payment token substitution', x => { x.protocol_data.parameters.consideration[0].token = P.weth; }, /ETH_ONLY/],
  ['ERC20 payment', x => { x.protocol_data.parameters.consideration[0].itemType = 1; }, /ETH_ONLY/],
  ['floating point price', x => { x.price.current.value = 900719925474099300000; }, /EXACT/],
  ['dynamic price', x => { x.protocol_data.parameters.consideration[0].endAmount = '1'; }, /FIXED/],
  ['future start', x => { x.protocol_data.parameters.startTime = '50'; }, /EXPIRED/],
  ['near expiration', x => { x.protocol_data.parameters.endTime = '30'; }, /EXPIRED/],
  ['asset substitution', x => { x.asset.identifier = '124'; }, /IDENTITY/],
  ['additional consideration', x => { x.protocol_data.parameters.totalOriginalConsiderationItems = 0; }, /CONSIDERATION/],
  ['zero payment recipient', x => { x.protocol_data.parameters.consideration[0].recipient = Z; }, /ADDRESS/],
  ['invalid signature', x => { x.protocol_data.signature = '0x1234'; }, /SIGNATURE/],
  ['missing counter', x => { delete x.protocol_data.parameters.counter; }, /EXACT/],
  ['number token id', x => { x.asset.identifier = 123; }, /EXACT/],
];
for (const [name, mutate, error] of cases) test(`reject ${name}`, () => { const x = raw(); mutate(x); assert.throws(() => normalizeNativeListing(x, { collection, nowSeconds: 10n }), error); });
const bidRequest = { action: 'CREATE_WETH_BID', owner, punkId: '93', walletRole: 'AGENT', budget: { maxTotalPriceWei: '10', maxNetworkFeeWei: '10', minimumReserveWei: '0' } };
test('public WETH bid never returns dummy transaction or invokes RPC without reviewed deployment', async () => {
  const output = await prepareMarketplaceReview(bidRequest, { client: new Proxy({}, { get() { throw Error('RPC should not run'); } }) });
  assert.equal(output.transaction, null); assert.equal(output.availability, 'BLOCKED');
  assert.deepEqual(output.blockers, ['WETH_BID_ESCROW_NOT_DEPLOYED', 'OWNERSHIP_CONTINUITY_NOT_PROVEN']);
  assert.equal(output.automaticSubmission, false); assert.equal(output.publicTransactions, 0);
});
test('wrong wallet role cannot gain marketplace authority', async () => {
  await assert.rejects(prepareMarketplaceReview({ ...bidRequest, walletRole: 'V3' }, {}), /INVALID_MARKETPLACE_REQUEST/);
});
test('native budget never accepts imprecise numeric JSON', async () => {
  await assert.rejects(prepareMarketplaceReview({ ...bidRequest, budget: { ...bidRequest.budget, maxTotalPriceWei: 10 } }, {}), /INVALID_EXACT_AMOUNT/);
});
test('public purchase has no transaction before reserve/poststate guard deployment', async () => {
  const result = await prepareMarketplaceReview({ ...bidRequest, action: 'BUY_LISTINGS' }, {});
  assert.equal(result.transaction, null); assert.equal(result.availability, 'BLOCKED');
  assert.deepEqual(result.blockers, ['PURCHASE_POSTCONDITION_GUARD_NOT_DEPLOYED']);
});
