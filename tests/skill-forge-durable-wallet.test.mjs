import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, toFunctionSelector } from 'viem';
import { createDurableTrainingWallet, validateDurableWalletReview } from '../site/forge-durable-wallet.js';
import { durableTrainingTransaction, serializeDurableTrainingReview, trainingDigest } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { validateTrainingRelease, trainingDeploymentBinding } from '../broker/src/v4/skill-forge/training-release.mjs';
import { durableReviewFixture, fixtureHash } from './fixtures/durable-training-review.mjs';
import artifact from '../deployments/robinhood-forge-training.json' with { type:'json' };

const word=value=>`0x${BigInt(value).toString(16).padStart(64,'0')}`;
function fixture() {
  const initial=durableReviewFixture(),code='0x60016000';
  const release=validateTrainingRelease({...artifact,status:'OWNER_CANARY',chainId:31337,
    collection:initial.collection,registry:`0x${'5'.repeat(40)}`,progression:initial.progression,trainingSource:`0x${'6'.repeat(40)}`,
    collectionCodeHash:keccak256(code),registryCodeHash:keccak256(code),progressionCodeHash:keccak256(code),trainingSourceCodeHash:keccak256(code),
    allowedOwners:[initial.owner],skills:[{key:initial.action.skillKey,name:'Contract Detective',manifestHash:fixtureHash('e'),instructionHash:fixtureHash('f')}]},{localFixture:true});
  const binding=trainingDeploymentBinding(release),review={...initial,...binding};
  const record={intentId:'11111111-1111-4111-8111-111111111111',revision:0,status:'PREPARED',review,
    reviewHash:trainingDigest(serializeDurableTrainingReview(review)),expiresAt:new Date(Number(review.guard.deadline)*1000).toISOString()};
  const envelope={record,transaction:durableTrainingTransaction(review)};
  const selection={owner:review.owner,tokenId:review.tokenId,chainId:31337,preview:false};
  const snapshot={ok:true,mode:'OWNER_CANARY',canBurn:false,...selection,held:true,record,
    release:{...binding,registry:release.registry,progressionCodeHash:release.progressionCodeHash,snapshotHash:release.snapshotHash},
    state:{owner:review.owner,tokenId:review.tokenId,credits:'1',nonce:review.guard.nonce,stateHash:review.guard.stateHash,
      slots:1,claimed:1,anchor:review.anchor,equipped:[`0x${'0'.repeat(64)}`],skills:release.skills.map(skill=>({...skill,level:1,available:true}))}};
  const latest={number:'0x66',hash:fixtureHash('9'),timestamp:`0x${BigInt(review.anchor.timestamp).toString(16)}`};
  const events=[];let attempted=false;
  const deps={release,binding,now:Date.now,isCurrent:()=>true,wasAttempted:()=>attempted,
    markAttempted:async()=>{events.push('persist');attempted=true;},readCurrent:async()=>structuredClone(snapshot),
    claim:async()=>{events.push('claim');return {...structuredClone(envelope),claimed:true,record:{...structuredClone(record),revision:1,status:'WALLET_REQUESTED'}};},
    provider:{request:async({method,params})=>{
      if(method==='eth_chainId')return '0x7a69';if(method==='eth_accounts')return [review.owner];
      if(method==='eth_getTransactionCount')return '0x8';if(method==='eth_getCode')return code;
      if(method==='eth_getLogs')return [];
      if(method==='eth_getBlockByNumber')return params[0]==='0x65'?{...latest,number:'0x65',hash:review.anchor.hash}:latest;
      if(method==='eth_estimateGas')return '0x186a0';if(method==='eth_getBalance')return '0xde0b6b3a7640000';
      if(method==='eth_call'){
        if(params[0].data.startsWith('0x6352211e'))return `0x${review.owner.slice(2).padStart(64,'0')}`;
        if(params[0].data.startsWith(toFunctionSelector('trainingReviewNonce(uint256)')))return word(review.guard.nonce);
        if(params[0].data.startsWith(toFunctionSelector('trainingReviewStateHash(uint256)')))return review.guard.stateHash;
        return '0x';
      }
      if(method==='eth_sendTransaction'){events.push('send');assert.equal(params[0].data,envelope.transaction.data);assert.equal(params[0].value,'0x0');return fixtureHash('a');}
      throw Error(`UNEXPECTED_RPC_${method}`);
    }}};
  const create=()=>createDurableTrainingWallet(deps);
  return {release,binding,review,envelope,selection,snapshot,deps,events,create,run:()=>create().submit(envelope,selection,review.action)};
}

test('durable wallet independently rebuilds calldata and persists before the single committed claim/send',async()=>{
  const f=fixture();const result=await f.run();assert.equal(result.transactionHash,fixtureHash('a'));
  assert.deepEqual(f.events,['persist','claim','send']);
  await assert.rejects(f.run,/already reached/);assert.deepEqual(f.events,['persist','claim','send']);
});
test('lost server claim response cannot reopen a wallet request after a browser restart',async()=>{
  const f=fixture();f.deps.claim=async()=>{f.events.push('claim');throw Error('RESPONSE_LOST');};
  await assert.rejects(f.run,/RESPONSE_LOST/);await assert.rejects(f.run,/already reached/);
  assert.deepEqual(f.events,['persist','claim']);
});
test('wallet rejection and missing hash retain the attempted marker without resend',async()=>{
  for(const missing of [false,true]){const f=fixture(),rpc=f.deps.provider.request;
    f.deps.provider.request=async args=>{if(args.method==='eth_sendTransaction'){f.events.push('send');if(missing)return null;throw Object.assign(Error('Rejected'),{code:4001});}return rpc(args);};
    await assert.rejects(f.run);await assert.rejects(f.run,/already reached/);assert.deepEqual(f.events,['persist','claim','send']);}
});
test('failure to persist the attempted marker prevents the server claim and wallet request',async()=>{
  const f=fixture();f.deps.markAttempted=async()=>{throw Error('STORAGE_UNAVAILABLE');};await assert.rejects(f.run,/STORAGE_UNAVAILABLE/);assert.deepEqual(f.events,[]);
});
for(const [name,change] of [
  ['wrong owner',f=>{f.snapshot.owner=`0x${'7'.repeat(40)}`;}],
  ['changed review',f=>{f.snapshot.record.reviewHash='b'.repeat(64);}],
  ['stale snapshot',f=>{f.snapshot.state.anchor.timestamp=String(Math.floor(Date.now()/1000)-31);}],
  ['changed destination',f=>{f.envelope.transaction.to=`0x${'7'.repeat(40)}`;}],
  ['changed calldata',f=>{f.envelope.transaction.data='0x';}],
  ['nonzero value',f=>{f.envelope.transaction.value='1';}],
  ['fee beyond review',f=>{f.envelope.transaction.maxFeePerGas='99999999999999999';}],
  ['expired review',f=>{f.deps.now=()=>Number(f.review.guard.deadline)*1000;}],
  ['another tab already claimed',f=>{f.snapshot.record.status='WALLET_REQUESTED';}],
  ['selection changed',f=>{f.deps.isCurrent=()=>false;}],
])test(`durable wallet rejects ${name} before reserving or sending`,async()=>{
  const f=fixture();change(f);await assert.rejects(f.run);assert.deepEqual(f.events,[]);
});
for(const [name,method,response] of [
  ['wrong wallet chain','eth_chainId','0x1'],['changed nonce','eth_getTransactionCount','0x9'],
  ['code mismatch','eth_getCode','0x6002'],['away-and-back transfer','eth_getLogs',[{},{}]],
  ['insufficient balance','eth_getBalance','0x0'],['larger gas estimate','eth_estimateGas','0x989680'],
])test(`wallet RPC ${name} prevents a claim`,async()=>{const f=fixture(),rpc=f.deps.provider.request;
  f.deps.provider.request=async args=>args.method===method?response:rpc(args);await assert.rejects(f.run);assert.deepEqual(f.events,[]);
});
test('chain/selection change after the committed claim withholds send and leaves recovery available',async()=>{
  const f=fixture(),claim=f.deps.claim;f.deps.claim=async()=>{const result=await claim();f.deps.provider.request=async()=> '0x1';return result;};
  await assert.rejects(f.run);assert.deepEqual(f.events,['persist','claim']);
});
test('browser review hash and encoder match server canonicalization for all five operations',async()=>{
  for(const operation of ['learn','unlock','equip','unequip','claim_rarity']){
    const f=fixture();f.review.action={operation,skillKey:['learn','equip'].includes(operation)?fixtureHash('b'):`0x${'0'.repeat(64)}`,
      slot:0,startingSlots:operation==='claim_rarity'?2:0,rarityProof:operation==='claim_rarity'?[fixtureHash('f')]:[]};
    f.envelope.record.reviewHash=trainingDigest(serializeDurableTrainingReview(f.review));f.envelope.transaction=durableTrainingTransaction(f.review);
    const tx=await validateDurableWalletReview(f.envelope,f.snapshot,{release:f.release,binding:f.binding,action:f.review.action});
    assert.equal(tx.data,f.envelope.transaction.data);assert.equal(tx.type,'0x2');
  }
});
test('pausing or changing canary policy preserves the deployment binding needed by old reconciliation jobs',()=>{
  const f=fixture();
  const paused=validateTrainingRelease({...f.release,status:'PAUSED',allowedOwners:[],skills:[],feeCeilingWei:'1'},{localFixture:true});
  assert.deepEqual(trainingDeploymentBinding(paused),f.binding);
  assert.notDeepEqual(trainingDeploymentBinding({...f.release,progression:`0x${'8'.repeat(40)}`}),f.binding);
});
