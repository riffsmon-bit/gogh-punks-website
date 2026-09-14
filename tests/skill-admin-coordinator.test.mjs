import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import {createSkillAdminCoordinator} from '../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import {skillAdminFixture,ADMIN,KEY,TX}from'./fixtures/skill-admin.mjs';
const create=()=>{const f=skillAdminFixture();return{...f,f,c:createSkillAdminCoordinator(f)};};
const prepare=c=>c.prepare({administrator:ADMIN,key:KEY,requestKey:randomUUID()});
const claim=(c,row)=>c.claim({administrator:ADMIN,id:row.id,revision:row.revision,reviewHash:row.reviewHash});
test('concurrent claims grant exactly one wallet request and restart recovers exact confirmed receipt',async()=>{
  const{f,c}=create();const{record}=await prepare(c);
  const attempts=await Promise.allSettled(Array.from({length:8},()=>claim(c,record)));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.row.status,'WALLET_REQUESTED');
  const restarted=createSkillAdminCoordinator(f);f.skill.registeredStatus=0;
  const result=await restarted.recover({administrator:ADMIN,id:record.id,transactionHash:TX});
  assert.equal(result.record.status,'CONFIRMED');assert.equal(result.record.receipt.minimumConfirmations,12);
  assert.equal(result.transaction,undefined);assert.deepEqual(f.log,['prepare','WALLET_REQUESTED','SUBMITTED','CONFIRMED']);
  const again=await restarted.recover({administrator:ADMIN,id:record.id,transactionHash:TX});assert.equal(again.record.revision,3);
});
test('wrong administrator is rejected before reading or writing stored wallet reviews',async()=>{
  const{f,c}=create();let reads=0;f.store.get=async()=>{reads++;throw Error();};
  await assert.rejects(c.get({administrator:`0x${'2'.repeat(40)}`}),/NOT_ADMINISTRATOR/);assert.equal(reads,0);
});
test('wallet request can never be cancelled or reclaimed after the claim',async()=>{
  const{f,c}=create();const{record}=await prepare(c);await claim(c,record);
  await assert.rejects(claim(c,f.row),/REVIEW_CONFLICT/);
  await assert.rejects(c.cancel({administrator:ADMIN,id:record.id,revision:1}),/RECOVERY_REQUIRED/);
  assert.equal((await prepare(c)).record.id,record.id);
});
test('unrelated recovery hash does not poison the saved record',async()=>{
  const{f,c}=create();const{record}=await prepare(c);await claim(c,record);f.observed.nonce=8;
  await assert.rejects(c.recover({administrator:ADMIN,id:record.id,transactionHash:TX}),/TRANSACTION_MISMATCH/);
  assert.equal(f.row.transactionHash,null);assert.equal(f.row.status,'WALLET_REQUESTED');
});
for(const[field,value]of[['from',`0x${'2'.repeat(40)}`],['to',`0x${'2'.repeat(40)}`],['input','0x'],['value',1n],['chainId',1],['gas',100001n],['gasPrice',101n]])test(`recovery rejects changed ${field}`,async()=>{
  const{f,c}=create();const{record}=await prepare(c);await claim(c,record);f.observed[field]=value;
  await assert.rejects(c.recover({administrator:ADMIN,id:record.id,transactionHash:TX}),/TRANSACTION_MISMATCH/);assert.equal(f.row.transactionHash,null);
});
test('pending or insufficiently confirmed receipts remain submitted without a second wallet transaction',async()=>{
  for(const mode of ['missing','young']){const{f,c}=create();const{record}=await prepare(c);await claim(c,record);
    for(const client of f.clients)if(mode==='missing')client.getTransactionReceipt=async()=>{throw Object.assign(Error(),{name:'TransactionReceiptNotFoundError'});};else client.getBlockNumber=async()=>109n;
    const result=await c.recover({administrator:ADMIN,id:record.id,transactionHash:TX});assert.equal(result.record.status,'SUBMITTED');assert.equal(result.transaction,undefined);
  }
});
test('registry divergence, provider disagreement and reorg cannot report confirmation',async()=>{
  for(const mode of ['registry','provider','reorg']){const{f,c}=create();const{record}=await prepare(c);await claim(c,record);f.skill.registeredStatus=0;
    if(mode==='registry')f.skill.manifestHash=`0x${'1'.repeat(64)}`;
    if(mode==='provider')f.clients[1].getTransactionReceipt=async()=>({...f.receipt,status:'reverted'});
    if(mode==='reorg')f.clients[1].getBlock=async()=>({hash:`0x${'9'.repeat(64)}`});
    await assert.rejects(c.recover({administrator:ADMIN,id:record.id,transactionHash:TX}),/REGISTRY_DIVERGED|PROVIDERS_DISAGREE|RECEIPT_REORG/);assert.equal(f.row.status,'SUBMITTED');
  }
});
test('reverted receipt closes review without claiming skill registration',async()=>{
  const{f,c}=create();const{record}=await prepare(c);await claim(c,record);f.receipt.status='reverted';
  assert.equal((await c.recover({administrator:ADMIN,id:record.id,transactionHash:TX})).record.status,'REVERTED');
});
test('changed review, expired review, nonce change and increased fee prevent claim',async()=>{
  for(const mode of ['hash','expiry','nonce','fee']){const{f,c}=create();const{record}=await prepare(c);
    if(mode==='hash')f.row.preparation.name='changed';
    if(mode==='expiry'){f.row.preparation.expiresAt=0;f.row.reviewHash=f.hash();}
    if(mode==='nonce')f.preparation.transaction.nonce='0x8';
    if(mode==='fee')f.preparation.maximumNetworkFeeWei='10000001';
    await assert.rejects(claim(c,record));assert.equal(f.row.status,'PREPARED');
  }
});
