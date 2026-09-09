import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCollectionHoldings } from '../netlify/functions/_shared/v2-collection-holdings.mjs';
const wallet = `0x${'1'.repeat(40)}`, agent = `0x${'2'.repeat(40)}`, other = `0x${'3'.repeat(40)}`;
const collection = `0x${'4'.repeat(40)}`;
const nft = (tokenId, custodyAccount = wallet) => ({ collection, tokenId, custodyAccount });
test('merges both canonical custody accounts, deduplicates and excludes NFTs sent away', async () => {
  const result = await verifyCollectionHoldings({ candidates: [nft('1'), nft('1'), nft('2', agent), nft('3'), nft('4', other)],
    accounts: [wallet, agent], readOwner: async item => item.tokenId === '3' ? other : item.custodyAccount,
    readDisplay: async () => ({ name: 'Test art', imageUrl: null }) });
  assert.deepEqual(result.holdings.map(item => item.tokenId), ['1', '2']);
  assert.ok(result.holdings.every(item => item.ownershipStatus === 'LIVE_VERIFIED'));
  assert.equal(result.inventoryComplete, false);
});
test('metadata failure never hides a verified NFT; ownership failure is counted, not assumed empty', async () => {
  const result = await verifyCollectionHoldings({ candidates: [nft('1'), nft('2')], accounts: [wallet],
    readOwner: async item => { if (item.tokenId === '2') throw new Error('offline'); return wallet; },
    readDisplay: async () => { throw new Error('missing metadata'); } });
  assert.equal(result.holdings.length, 1); assert.equal(result.holdings[0].artwork, null);
  assert.equal(result.ownershipChecksUnavailable, 1);
});
test('ERC1155 holdings use current balance rather than receipt quantity', async () => {
  const result = await verifyCollectionHoldings({ candidates: [{ ...nft('1'), standard: 'ERC1155', amount: '100' }],
    accounts: [wallet], readBalance: async () => 2n, readOwner: async () => { throw new Error('wrong method'); },
    readDisplay: async () => null });
  assert.equal(result.holdings[0].amount, '2');
});
