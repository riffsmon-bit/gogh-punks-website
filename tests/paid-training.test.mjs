import test from 'node:test';
import assert from 'node:assert/strict';
import artifact from '../deployments/robinhood-paid-training.json' with {type:'json'};
import { createPaidTrainingCoordinator,validatePaidRelease,validatePaidReview,readPaidState } from '../broker/src/v4/skill-forge/paid-training.mjs';
import { guardLegacyPaidAction,paidCanonicalState } from '../broker/src/v4/skill-forge/paid-canonical.mjs';
import { handlePaidTraining } from '../netlify/functions/broker-v2-forge-paid-training.mjs';
import { paidFixture } from './fixtures/paid-training.mjs';
const setup=()=>{const f=paidFixture();return {...f,coordinator:createPaidTrainingCoordinator({clients:[new Proxy(f.client,{}),f.client],release:f.release,now:f.now})};};

test('undeployed release remains fixed-price and cannot accept payment',async()=>{
  const inactive={...artifact,status:'UNDEPLOYED',extension:null,extensionCodeHash:null,allowedOwners:[],canonicalReadersReviewed:false,productionPaymentsAuthorized:false};
  assert.equal(validatePaidRelease(artifact).priceWei,'500000000000000');
  assert.throws(()=>createPaidTrainingCoordinator({clients:[],release:inactive}),/PAID_NOT_RELEASED/);
  for(const change of [{productionPaymentsAuthorized:true},{canonicalReadersReviewed:true},{priceWei:'1'},{treasury:'0x'+'11'.repeat(20)}])
    assert.throws(()=>validatePaidRelease({...inactive,...change}));
  const deps={releaseReader:()=>inactive,runtimeFactory:()=>assert.fail('RPC'),sessionPool:()=>assert.fail('database'),sessionReader:()=>assert.fail('session')};
  const get=await handlePaidTraining(new Request('https://goghpunks.xyz/api/v2/punks/93/forge/paid-training'),deps);
  assert.equal(get.status,200);assert.equal((await get.json()).release.status,'UNDEPLOYED');
  const post=await handlePaidTraining(new Request('https://goghpunks.xyz/api/v2/punks/93/forge/paid-training',{method:'POST',body:'{}'}),deps);
  assert.equal(post.status,503);
});

test('purchase preparation simulates exactly one 0.0005ETH payment; never sends',async()=>{
  const f=setup(),result=await f.coordinator.prepare({...f.identity,action:f.action('buy')});
  assert.equal(BigInt(result.review.transaction.value),500000000000000n);
  assert.equal(result.maximumNetworkFeeWei,'120000000000');
  assert.deepEqual(await f.coordinator.verify(result.review),{review:result.review});
  for(const mutate of [r=>r.transaction.value='0x0',r=>r.transaction.to=f.owner,r=>r.transaction.data='0x',r=>r.chainId=1,
    r=>r.transaction.maxFeePerGas='0xffffffffffff',r=>r.transaction.authorizationList=[],r=>r.guard.deadline='1800000061']){
    const bad=structuredClone(result.review);mutate(bad);assert.throws(()=>validatePaidReview(bad,f.release));
  }
});

for(const [name,mutate] of Object.entries({
  'old owner':f=>f.state.owner='0x'+'22'.repeat(20),
  'paused purchases':f=>f.state.paused=true,
  'burn-approved source':f=>f.state.burnApproved=true,
  'unavailable skill':f=>f.state.available=false,
  'credit would be unusable':f=>f.state.credits=1n,
  'ownership round trip':f=>f.state.logs=[{}],
  'wrong runtime':f=>f.client.getCode=async()=> '0x1234',
  'wrong chain':f=>f.client.getChainId=async()=>1,
  'insufficient ETH':f=>f.client.getBalance=async()=>500000000000000n,
  'pending wallet request':f=>f.client.getTransactionCount=async({blockTag})=>blockTag==='pending'?8:7,
  'simulation failure':f=>f.client.call=async()=>{throw Error('simulation reverted');},
}))test(`purchase blocks ${name}`,async()=>{const f=setup();mutate(f);await assert.rejects(f.coordinator.prepare({...f.identity,action:f.action('buy')}));});

test('known skills still allow buying a useful slot credit; all used slots block',async()=>{
  const f=setup();f.state.level=1;f.state.claimed=1;
  assert.ok((await f.coordinator.prepare({...f.identity,action:f.action('buy')})).review);
  f.state.slots=7;f.state.equipped=Array(7).fill('0x'+'0'.repeat(64));
  await assert.rejects(f.coordinator.prepare({...f.identity,action:f.action('buy')}),/PURCHASE_UNAVAILABLE/);
});

test('learning consumes purchased ledger only; activation and no duplicate requirements',async()=>{
  const f=setup();await assert.rejects(f.coordinator.prepare({...f.identity,action:f.action('learn')}),/ACTIVATION/);
  f.state.activated=true;await assert.rejects(f.coordinator.prepare({...f.identity,action:f.action('learn')}),/NO_CREDIT/);
  f.state.credits=1n;const learned=await f.coordinator.prepare({...f.identity,action:f.action('learn')});
  assert.equal(learned.review.transaction.value,'0x0');f.state.level=1;
  await assert.rejects(f.coordinator.verify(learned.review),/SKILL_UNAVAILABLE/);
});

test('fresh verification invalidates nonce, state and expired review',async()=>{
  const f=setup(),{review}=await f.coordinator.prepare({...f.identity,action:f.action('buy')});
  f.state.reviewNonce=1n;await assert.rejects(f.coordinator.verify(review),/STATE_CHANGED/);f.state.reviewNonce=0n;
  f.state.stateHash='0x'+'de'.repeat(32);await assert.rejects(f.coordinator.verify(review),/STATE_CHANGED/);f.state.stateHash=review.guard.stateHash;
  f.state.now+=56000;await assert.rejects(f.coordinator.verify(review),/REVIEW_EXPIRED/);
});

test('expiry alone cannot clear uncertain wallet attempts; finalized unused proof can',async()=>{
  const f=setup(),{review}=await f.coordinator.prepare({...f.identity,action:f.action('buy')});
  await assert.rejects(f.coordinator.abandon({...f.identity,review}),/EXPIRY_NOT_FINAL/);
  f.state.now+=61000;f.state.finalizedTime=BigInt(f.state.now/1000);
  assert.equal((await f.coordinator.abandon({...f.identity,review})).status,'EXPIRED_UNUSED');
  f.state.walletNonce=8;await assert.rejects(f.coordinator.abandon({...f.identity,review}),/RECOVERY_REQUIRED/);
  f.state.walletNonce=7;f.state.reviewNonce=1n;await assert.rejects(f.coordinator.abandon({...f.identity,review}),/RECOVERY_REQUIRED/);
});

test('current owner after transfer can read permanent paid state outside purchase allowlist',async()=>{
  const f=setup();f.state.owner='0x'+'22'.repeat(20);f.state.activated=true;f.state.level=1;f.state.credits=1n;
  const state=await readPaidState({client:f.client,release:f.release,owner:f.state.owner,tokenId:f.tokenId,now:f.now});
  assert.equal(state.purchasedCredits,'1');assert.equal(state.skills[0].level,1);
});

test('legacy API rejects duplicate paid learning, obsolete loadout and full canonical slots',()=>{
  const f=setup(),paid={activated:true,unlockedSlots:7,skills:[{key:f.key,level:1}]};
  for(const operation of ['learn','equip','unequip','unlock'])assert.throws(()=>guardLegacyPaidAction(f.action(operation),paid));
  assert.doesNotThrow(()=>guardLegacyPaidAction({...f.action('learn'),skillKey:'0x'+'11'.repeat(32)},paid));
  assert.doesNotThrow(()=>guardLegacyPaidAction(f.action('learn'),null));
});

test('unreleased canonical path makes no extra request; deployed errors never restore legacy',async()=>{
  const f=setup();assert.equal(await paidCanonicalState({client:null,release:null,paidRelease:{status:'UNDEPLOYED'}}),null);
  f.client.getCode=async()=> '0x';
  await assert.rejects(paidCanonicalState({client:f.client,release:{...f.release,progression:f.release.legacyProgression},
    owner:f.owner,tokenId:f.tokenId,now:f.now,paidRelease:f.release}));
});

test('recovery requires exact transaction, applied event, code and both providers finality',async()=>{
  const {encodeEventTopics,encodeAbiParameters}=await import('viem');
  const {PAID_ABI}=await import('../broker/src/v4/skill-forge/paid-training.mjs');
  const f=setup(),{review}=await f.coordinator.prepare({...f.identity,action:f.action('buy')});
  const transactionHash='0x'+'12'.repeat(32),blockHash=f.state.hash;
  const tx={hash:transactionHash,chainId:4663,type:'eip1559',from:f.owner,to:f.release.extension,input:review.transaction.data,
    nonce:7,blockNumber:100n,blockHash,...Object.fromEntries(['value','gas','maxFeePerGas','maxPriorityFeePerGas'].map(k=>[k,BigInt(review.transaction[k])]))};
  const log={address:f.release.extension,logIndex:0,removed:false,transactionHash,blockHash,blockNumber:100n,
    topics:encodeEventTopics({abi:PAID_ABI,eventName:'PaidTrainingReviewApplied',args:{tokenId:93n,nonce:0n}}),
    data:encodeAbiParameters([{type:'uint8'}],[0])};
  const receipt={transactionHash,blockNumber:100n,blockHash,from:f.owner,to:f.release.extension,status:'success',logs:[log],gasUsed:100000n,effectiveGasPrice:1n};
  f.client.getTransaction=async()=>tx;f.client.getTransactionReceipt=async()=>receipt;
  assert.equal((await f.coordinator.recover({...f.identity,review,transactionHash})).status,'CONFIRMED_SUCCESS');
  tx.value=0n;await assert.rejects(f.coordinator.recover({...f.identity,review,transactionHash}),/TRANSACTION_MISMATCH/);tx.value=500000000000000n;
  receipt.logs=[];await assert.rejects(f.coordinator.recover({...f.identity,review,transactionHash}),/EVENT_MISMATCH/);
  receipt.status='reverted';assert.equal((await f.coordinator.recover({...f.identity,review,transactionHash})).status,'CONFIRMED_REVERT');
  f.client.getTransactionReceipt=async()=>{throw Object.assign(Error(),{name:'TransactionReceiptNotFoundError'});};
  assert.equal((await f.coordinator.recover({...f.identity,review,transactionHash})).status,'PENDING');
});

test('release pause retains original receipt/recovery but denies new purchases',async()=>{
  const f=paidFixture();f.release.status='PAUSED';f.release.productionPaymentsAuthorized=false;
  const coordinator=createPaidTrainingCoordinator({clients:[new Proxy(f.client,{}),f.client],release:f.release,now:f.now});
  assert.equal((await coordinator.get(f.identity)).purchasedCredits,'0');
  await assert.rejects(coordinator.prepare({...f.identity,action:f.action('buy')}),/NOT_RELEASED/);
});

test('HTTP rejects foreign review and sanitizes provider secrets',async()=>{
  const f=setup(),{review}=await f.coordinator.prepare({...f.identity,action:f.action('buy')});
  const deps={releaseReader:()=>f.release,sessionPool:()=>null,sessionReader:async()=>({walletAddress:f.owner}),originCheck:()=>{},
    runtimeFactory:()=>f.coordinator};
  const request=body=>new Request('https://goghpunks.xyz/api/v2/punks/93/forge/paid-training',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await handlePaidTraining(request({operation:'verify',review:{...review,tokenId:'94'}}),deps)).status,403);
  const broken=await handlePaidTraining(request({operation:'prepare',action:f.action('buy')}),{...deps,runtimeFactory:()=>{throw Error('https://user:secret@provider.invalid');}});
  assert.equal(broken.status,503);assert.doesNotMatch(await broken.text(),/secret|provider.invalid/);
});

test('paid skills must have identical pins in the actual holder tool release',async()=>{
  const {assertPaidSkillCoverage}=await import('../broker/src/v4/skill-forge/paid-training.mjs');
  const {default:training}=await import('../deployments/robinhood-forge-training.json',{with:{type:'json'}});
  assert.equal(assertPaidSkillCoverage(artifact,training),artifact);
  assert.throws(()=>assertPaidSkillCoverage({...artifact,skills:[{...artifact.skills[0],manifestHash:'0x'+'11'.repeat(32)}]},training),/NOT_RELEASED/);
});

test('canonical resolver chooses one loadout, including during purchase pause',async()=>{
  const {createCanonicalProgressionReader,readCanonicalTrainingState}=await import('../broker/src/v4/skill-forge/paid-canonical.mjs');
  const f=setup();f.state.activated=true;f.state.credits=1n;f.state.level=1;f.state.equipped=[f.key];
  const oldKey='0x'+'12'.repeat(32),old={owner:f.owner,tokenId:f.tokenId,slots:1,equipped:[oldKey],skills:[{...f.release.skills[0],level:0,available:true}],
    credits:'1',nonce:'2',stateHash:'0x'+'33'.repeat(32),anchor:{number:'100',hash:f.state.hash,timestamp:String(f.state.now/1000)}};
  const options={client:f.client,release:{...f.release,progression:f.release.legacyProgression},owner:f.owner,tokenId:f.tokenId,
    paidRelease:f.release,now:f.now,legacyStateReader:async()=>old};
  const combined=await readCanonicalTrainingState(options);
  assert.deepEqual(combined.equipped,[f.key]);assert.equal(combined.skills[0].level,1);assert.equal(combined.credits,'1');assert.equal(combined.purchasedCredits,'1');
  assert.notEqual(combined.stateHash,old.stateHash);
  const factory=({progression})=>async()=>({owner:f.owner,blockNumber:'100',blockHash:f.state.hash,blockTime:f.state.now,
    mask:progression===f.release.extension?'8':'1',equipped:progression===f.release.extension?[f.key]:[oldKey]});
  const reader=createCanonicalProgressionReader({...options.release,progression:f.release.legacyProgression,progressionCodeHash:f.release.legacyProgressionCodeHash,
    client:f.client,readerFactory:factory,paidRelease:f.release,now:f.now});
  assert.equal((await reader(f.tokenId)).mask,'8');assert.deepEqual((await reader(f.tokenId)).equipped,[f.key]);
  f.release.status='PAUSED';f.release.productionPaymentsAuthorized=false;
  assert.equal((await reader(f.tokenId)).mask,'8');
  f.client.getCode=async()=>{throw Error('RPC unavailable');};await assert.rejects(reader(f.tokenId));
});

test('burn review blocks stranded paid credits and fails closed on extension read failure',async()=>{
  const {assertNoPaidBurnCredits}=await import('../broker/src/v4/skill-forge/paid-canonical.mjs');
  const f=setup(),options={client:f.client,release:{...f.release,progression:f.release.legacyProgression},
    owner:f.owner,tokenId:f.tokenId,now:f.now,paidRelease:f.release};
  assert.equal((await assertNoPaidBurnCredits(options)).purchasedCredits,'0');
  f.state.credits=1n;await assert.rejects(assertNoPaidBurnCredits(options),/BURN_SOURCE_PURCHASED_CREDITS_REMAIN/);
  f.client.getCode=async()=>{throw Error('RPC offline');};await assert.rejects(assertNoPaidBurnCredits(options));
});
