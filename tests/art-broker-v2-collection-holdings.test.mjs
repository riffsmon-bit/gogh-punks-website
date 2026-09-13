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
test('stalled metadata cannot block custody checks or erase verified holdings', {timeout:1000}, async()=>{
  const reads=[];
  const result=await verifyCollectionHoldings({candidates:[nft('1599',agent),nft('2')],accounts:[wallet,agent],
    readOwner:async item=>{reads.push(item.tokenId);return item.custodyAccount;},readDisplay:()=>new Promise(()=>{}),
    metadataMs:20,displayReadMs:10});
  assert.deepEqual(reads,['1599','2']);assert.deepEqual(result.holdings.map(item=>item.tokenId),['1599','2']);
  assert.equal(result.metadataUnavailable,2);assert.equal(result.inventoryComplete,false);
});
test('ownership budget excludes stalled and deferred checks and cannot accept a late owner result', {timeout:1000}, async()=>{
  let resolveOwner,calls=0;
  const pending=new Promise(resolve=>{resolveOwner=resolve;});
  const result=await verifyCollectionHoldings({candidates:Array.from({length:20},(_,i)=>nft(String(i))),accounts:[wallet],
    readOwner:()=>{calls++;return pending;},readDisplay:async()=>null,ownershipMs:20,ownerReadMs:20,metadataMs:5});
  assert.deepEqual(result.holdings,[]);assert.equal(result.ownershipChecksUnavailable,20);assert.ok(calls<=4);
  resolveOwner(wallet);await Promise.resolve();assert.deepEqual(result.holdings,[]);assert.equal(result.inventoryComplete,false);
});
test('deduplication and the 128-candidate cap retain the first priority candidate and bound metadata work',async()=>{
  let owners=0,displays=0;
  const candidates=[nft('1599',agent),nft('1599',agent),nft('01599',agent),
    ...Array.from({length:300},(_,i)=>nft(String(i)))];
  const result=await verifyCollectionHoldings({candidates,accounts:[wallet,agent],
    readOwner:async item=>{owners++;return item.custodyAccount;},readDisplay:async()=>{displays++;return null;}});
  assert.equal(owners,128);assert.equal(result.holdings.length,128);assert.equal(result.holdings[0].tokenId,'1599');
  assert.equal(displays,16);assert.equal(result.metadataUnavailable,128);assert.equal(result.inventoryComplete,false);
});
test('foreign custody, malformed collection and oversized token IDs never trigger ownership reads',async()=>{
  let reads=0;const result=await verifyCollectionHoldings({accounts:[wallet],candidates:[null,nft('1',other),
    {...nft('2'),collection:'bad'},nft('9'.repeat(79)),nft(String(1n<<256n))],
    readOwner:async()=>{reads++;return wallet;},readDisplay:async()=>null});
  assert.equal(reads,0);assert.deepEqual(result.holdings,[]);assert.equal(result.inventoryComplete,false);
});
test('a duplicate index entry supplies artwork without replacing paid provenance or causing another metadata fetch',async()=>{
  let displays=0;const result=await verifyCollectionHoldings({accounts:[agent],candidates:[
    {...nft('1599',agent),acquisitionType:'V2_DIRECTED_PAID_MINT',transactionHash:'paid-receipt',artwork:null},
    {...nft('1599',agent),acquisitionType:'RECEIVED',artwork:{name:'Peppies #1599',imageUrl:'https://i.seadn.io/example.png'}}],
    readOwner:async()=>agent,readDisplay:async()=>{displays++;throw Error('must use cached display');}});
  assert.equal(result.holdings.length,1);assert.equal(result.holdings[0].acquisitionType,'V2_DIRECTED_PAID_MINT');
  assert.equal(result.holdings[0].transactionHash,'paid-receipt');assert.equal(result.holdings[0].artwork.name,'Peppies #1599');
  assert.equal(displays,0);assert.equal(result.metadataUnavailable,0);
});
test('custody verification runs no more than four reads concurrently',async()=>{
  let active=0,peak=0;
  const result=await verifyCollectionHoldings({accounts:[wallet],candidates:Array.from({length:12},(_,i)=>nft(String(i))),
    readOwner:async()=>{active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;return wallet;},readDisplay:async()=>null});
  assert.equal(peak,4);assert.equal(active,0);assert.equal(result.holdings.length,12);
});
