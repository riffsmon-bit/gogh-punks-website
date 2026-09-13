import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, zeroAddress } from 'viem';
import { createReviewedBurnPreparation } from '../broker/src/v4/skill-forge/reviewed-burn.mjs';

function fixture() {
  const address=n=>'0x'+String(n).repeat(40),owner=address(1),code='0x6000';
  const deployment={chainId:4663,collection:address(2),registry:address(3),progression:address(4),burnSource:address(5),feeCeilingWei:'1000000000000000'};
  for(const role of ['collection','registry','progression','burnSource'])deployment[role+'CodeHash']=keccak256(code);
  const block={number:10n,hash:'0x'+'a'.repeat(64),timestamp:1800000000n};
  const client={getChainId:async()=>4663,getBlock:async()=>block,getCode:async()=>code,
    getTransactionCount:async()=>0,getBalance:async()=>10n**18n,getGasPrice:async()=>10n,
    estimateGas:async()=>100000n,call:async()=>({}),getLogs:async()=>[],
    readContract:async({functionName})=>({collection:deployment.collection,progression:deployment.progression,
      registry:deployment.registry,trainingSource:deployment.burnSource,ownerOf:owner,getApproved:zeroAddress,
      isApprovedForAll:false,totalSupply:4295n,trainingCredits:0n,burnReviewNonce:0n,
      burnReviewStateHash:'0x'+'b'.repeat(64),globallyDisabled:false})[functionName]};
  return {client,deployment,owner,now:()=>Number(block.timestamp)*1000};
}

test('burn review verification survives service recreation with an asynchronous persistent store', async()=>{
  const f=fixture(),rows=new Map();
  const reviewStore={get:async id=>rows.has(id)?JSON.parse(rows.get(id)):undefined,
    set:async(id,review)=>{await Promise.resolve();rows.set(id,JSON.stringify(review));}};
  const first=createReviewedBurnPreparation({...f,reviewStore});
  const review=await first.prepare({owner:f.owner,sourceTokenId:'1753',targetTokenId:'93',action:'APPROVE'});
  assert.equal(rows.size,1);
  const restarted=createReviewedBurnPreparation({...f,reviewStore});
  assert.equal((await restarted.recheck(review)).status,'REVIEW_RECHECKED');
  const changed=structuredClone(review);changed.transaction.data='0x1234';
  await assert.rejects(restarted.recheck(changed),/BURN_REVIEW_TAMPERED/);
  assert.equal(review.productionAuthority,false);assert.equal(review.walletInventoryReviewed,false);
});

test('failed persistence cannot return an apparently prepared burn review', async()=>{
  const f=fixture();
  const service=createReviewedBurnPreparation({...f,reviewStore:{get:async()=>undefined,set:async()=>{throw Error('STORE_UNAVAILABLE');}}});
  await assert.rejects(service.prepare({owner:f.owner,sourceTokenId:'1753',targetTokenId:'93',action:'APPROVE'}),/STORE_UNAVAILABLE/);
});

test('the default burn review store remains scoped to its own service instance', async()=>{
  const f=fixture(),first=createReviewedBurnPreparation(f);
  const review=await first.prepare({owner:f.owner,sourceTokenId:'1753',targetTokenId:'93',action:'APPROVE'});
  assert.equal((await first.recheck(review)).status,'REVIEW_RECHECKED');
  await assert.rejects(createReviewedBurnPreparation(f).recheck(review),/BURN_REVIEW_TAMPERED/);
});
