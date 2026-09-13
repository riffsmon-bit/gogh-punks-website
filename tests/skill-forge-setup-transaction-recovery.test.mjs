import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSetupReviewJournal } from '../scripts/dev/skill-forge/setup-review-journal.mjs';
import { recoverSetupTransaction } from '../scripts/dev/skill-forge/setup-transaction-recovery.mjs';

const hash='0x'+'a'.repeat(64), otherHash='0x'+'b'.repeat(64);
function fixture(t, {creation=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'gogh-setup-recovery-'));
  const options={path:join(dir,'reviews.sqlite'),binding:'fixture'};
  let journal=openSetupReviewJournal(options);
  const review={expiresAt:Date.now()+60000,transaction:{from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),
    data:'0x1234',nonce:'0x1',gas:'0x10000',maxFeePerGas:'0x10',maxPriorityFeePerGas:'0x0'}};
  if(creation)delete review.transaction.to;
  const prepared=journal.prepare(0,review);journal.claim(prepared.revision,prepared.records[0].reviewHash);
  t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
  return {get journal(){return journal;},review,reopen(){journal.close();journal=openSetupReviewJournal(options);return journal;}};
}
const transaction=review=>({hash,from:review.transaction.from,to:review.transaction.to??null,input:review.transaction.data,
  chainId:4663,nonce:1,gas:0x10000n,maxFeePerGas:16n,maxPriorityFeePerGas:0n,value:0n,type:'eip1559'});

test('a wallet hash is durable before lookup and survives unavailable providers and restart without enabling resend', async t=>{
  const f=fixture(t);
  const missing={getTransaction:async()=>{
    assert.equal(f.journal.snapshot().records[0].reportedTransactionHash,hash);
    throw Object.assign(Error('not propagated'),{name:'TransactionNotFoundError'});
  }};
  const result=await recoverSetupTransaction({journal:f.journal,revision:2,transactionHash:hash,clients:[missing,missing]});
  assert.equal(result.pending,true);assert.equal(result.state.records[0].status,'WALLET_REQUESTED');
  assert.equal(result.state.records[0].transactionHash,null);
  const journal=f.reopen(),state=journal.snapshot();
  assert.equal(state.records[0].reportedTransactionHash,hash);
  assert.throws(()=>journal.prepare(state.revision,f.review),/SETUP_REVIEW_STATE_CHANGED/);
  assert.throws(()=>journal.decline(state.revision,state.records[0].reviewHash),/SETUP_REVIEW_STATE_CHANGED/);
  const visible={getTransaction:async()=>transaction(f.review)};
  const recovered=await recoverSetupTransaction({journal,revision:state.revision,transactionHash:hash,clients:[missing,visible]});
  assert.equal(recovered.pending,false);assert.equal(recovered.state.records[0].status,'SUBMITTED');
  assert.equal(recovered.state.records[0].transactionHash,hash);
  assert.throws(()=>journal.report(recovered.state.revision,otherHash),/SETUP_REVIEW_STATE_CHANGED/);
});

test('repeated pending checks preserve the revision and never promote an unverified hash', async t=>{
  const f=fixture(t),missing={getTransaction:async()=>null};
  const first=await recoverSetupTransaction({journal:f.journal,revision:2,transactionHash:hash,clients:[missing]});
  const replay=await recoverSetupTransaction({journal:f.journal,revision:first.state.revision,transactionHash:hash,clients:[missing]});
  assert.equal(replay.state.revision,first.state.revision);assert.equal(replay.pending,true);
});

test('mismatched transactions remain unverified and can be corrected without releasing the original claim', async t=>{
  const f=fixture(t),wrong={getTransaction:async()=>({...transaction(f.review),hash:otherHash,nonce:2})};
  await assert.rejects(recoverSetupTransaction({journal:f.journal,revision:2,transactionHash:otherHash,clients:[wrong]}),/SETUP_RECOVERY_MISMATCH/);
  const state=f.journal.snapshot();assert.equal(state.records[0].status,'WALLET_REQUESTED');
  assert.equal(state.records[0].transactionHash,null);
  const result=await recoverSetupTransaction({journal:f.journal,revision:state.revision,transactionHash:hash,
    clients:[{getTransaction:async()=>transaction(f.review)}]});
  assert.equal(result.state.records[0].transactionHash,hash);
});

test('a reported deployment hash must match the reviewed creation transaction and fee bounds', async t=>{
  const f=fixture(t,{creation:true});
  await assert.rejects(recoverSetupTransaction({journal:f.journal,revision:2,transactionHash:hash,
    clients:[{getTransaction:async()=>({...transaction(f.review),to:null,maxFeePerGas:17n})}]}),/SETUP_RECOVERY_MISMATCH/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
  const result=await recoverSetupTransaction({journal:f.journal,revision:f.journal.snapshot().revision,transactionHash:hash,
    clients:[{getTransaction:async()=>transaction(f.review)}]});
  assert.equal(result.state.records[0].status,'SUBMITTED');
});
