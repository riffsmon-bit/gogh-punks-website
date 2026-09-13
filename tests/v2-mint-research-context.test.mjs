import test from 'node:test';
import assert from 'node:assert/strict';
import { mintResearchFixture, OWNER, WALLET, HASH, GOGH } from './helpers/mint-research-context-fixture.mjs';
import { createMintResearchContextReader, readMintResearchAgentAuthority, readMintResearchUsage } from '../netlify/functions/_shared/v2-mint-research-context.mjs';
import { punkCollectingIntentHash } from '../broker/src/v4/collecting-intent.mjs';

test('context resolves the exact pinned canonical Agent with anchored owner/balance/history and explicit usage',async()=>{
  const f=mintResearchFixture();f.usageRow={daily_mints:'2',total_mints:'7',opportunity_mints:'1',incomplete:false};
  const ctx=await createMintResearchContextReader(f.contextOptions)(f.identity);
  assert.equal(ctx.authority.punkWallet,WALLET);assert.equal(ctx.authority.collection,GOGH);
  assert.equal(ctx.authority.owner,OWNER);assert.equal(ctx.authority.activated,true);assert.equal(ctx.authority.blockHash,HASH);
  assert.deepEqual(ctx.usage,{dailyMints:2,totalMints:7,opportunityMints:1});
  assert.equal(ctx.strategyHash,punkCollectingIntentHash(ctx.intent,f.time));
  for(const [kind,query]of f.calls.filter(([kind])=>['balance','code','read'].includes(kind)))
    assert.ok(query.blockNumber===100n||kind==='read'&&query.functionName==='ownerOf'&&query.blockNumber===99n);
  assert.equal(f.calls.find(([kind])=>kind==='logs')[1].fromBlock,99n);
  assert.equal(f.calls.filter(([kind])=>kind==='call').length,0);
});
for(const [name,change]of[
  ['old owner',f=>f.owner=`0x${'2'.repeat(40)}`],['wrong chain',f=>f.chain=1],['wrong implementation',f=>f.code.implementation='0x6000'],
  ['wrong registry',f=>f.code.registry='0x6000'],['wrong proxy footer',f=>f.proxy='0x6000'],
  ['paused strategy',f=>f.strategy.state='PAUSED'],['old configured owner',f=>f.strategy.configured_by=`0x${'2'.repeat(40)}`],
  ['legacy V3 strategy wallet',f=>f.strategy.intent={...f.strategy.intent,punkWallet:`0x${'3'.repeat(40)}`}],
  ['unconfirmed strategy',f=>f.strategy.owner_confirmation_hash=null],['missing strategy',f=>f.strategy=null],
  ['expired strategy',f=>f.strategy.expires_at=new Date(+f.time-1)],['changed strategy hash',f=>f.strategy.intent_hash=`0x${'b'.repeat(64)}`],
  ['unreviewed opportunity',f=>f.source.screening_status='PENDING'],['missing opportunity',f=>f.source=null],
  ['expired opportunity',f=>f.source.expires_at=new Date(+f.time-1)],['wrong normalized collection',f=>f.source.collection_contract=OWNER],
  ['transfer away and back',f=>f.logs=[{args:{from:OWNER,to:WALLET}},{args:{from:WALLET,to:OWNER}}]],
  ['RLS hides accounting',f=>f.scopeComplete=false],['unknown accounting',f=>f.usageRow.incomplete=true],
  ['missing count',f=>delete f.usageRow.daily_mints],['imprecise count',f=>f.usageRow.total_mints='9007199254740992'],
])test(`research context fails closed: ${name}`,async()=>{
  const f=mintResearchFixture();change(f);await assert.rejects(createMintResearchContextReader(f.contextOptions)(f.identity));
  assert.equal(f.calls.filter(([kind])=>kind==='call').length,0);
});
test('archive/selected-paid failure cannot produce synthetic zero usage or leak its cause',async()=>{
  const f=mintResearchFixture();await assert.rejects(readMintResearchUsage({pool:f.pool,tokenId:'93',wallet:WALLET,
    collection:f.opportunity.collectionContract,now:f.time,selectedPaidUsageReader:async()=>{throw Error('private://key');}}),
    {message:'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE'});
});
test('canonical Agent authority rejects stale blocks before runtime reads',async()=>{
  const f=mintResearchFixture();await assert.rejects(readMintResearchAgentAuthority({client:f.client,...f.identity,
    now:()=>new Date(+f.time+31_000)}),/STALE_ANCHOR/);assert.equal(f.calls.length,0);
});
test('state changed after SQL/historical reads is rejected',async()=>{
  const f=mintResearchFixture(),original=f.client.getLogs;
  f.client.getLogs=async q=>{f.blockHash=`0x${'b'.repeat(64)}`;return original(q);};
  await assert.rejects(createMintResearchContextReader(f.contextOptions)(f.identity),/STALE_ANCHOR/);
});
