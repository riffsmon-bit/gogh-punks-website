import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileTrainingBatch } from '../broker/src/v4/skill-forge/training-reconciler.mjs';
import { durableReviewFixture,fixtureHash } from './fixtures/durable-training-review.mjs';

function fixture(){const review=durableReviewFixture(),time=BigInt(review.guard.deadline)+100n;
  const record={intentId:'11111111-1111-4111-8111-111111111111',review,status:'SUBMISSION_UNKNOWN',revision:2,holdsTraining:true,transactionHash:null};
  const jobs=[],proofs=[];
  const store={claimPendingReconciliation:async()=>({leaseToken:'22222222-2222-4222-8222-222222222222',records:[record]}),
    get:async scope=>{assert.equal(scope.owner,review.owner);return record;},
    recordVerifiedSettlement:async(scope,revision,proof)=>{assert.equal(revision,2);proofs.push(proof);},
    finishReconciliation:async job=>{jobs.push(job);return true;}};
  const final={number:150n,hash:fixtureHash('f'),timestamp:time},head={number:200n,hash:fixtureHash('a'),timestamp:time+1n};
  const clients=[0,1].map(()=>({getChainId:async()=>review.chainId,
    getBlock:async({blockTag})=>blockTag==='latest'?head:final,request:async()=> '0x9'}));
  const args={store,clients,expectedRuntimeHash:fixtureHash('b'),expectedSnapshotHash:fixtureHash('c'),now:()=>Number(time+1n)*1000};
  return {args,record,jobs,proofs,run:()=>reconcileTrainingBatch(args)};
}
test('worker settles an expired consumed nonce without exposing private review fields',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.settled,1);assert.equal(f.proofs[0].status,'NONCE_CONSUMED');
  assert.equal(f.jobs[0].result,'NONCE_CONSUMED');assert.equal(result.publicTransactions,0);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(f.record.review.owner));
});
test('worker reschedules an unresolved nonce and never releases the hold on elapsed time alone',async()=>{
  const f=fixture();f.args.clients.forEach(client=>{client.request=async()=> '0x8';});
  for(const client of f.args.clients){const get=client.getBlock;client.getBlock=async args=>{
    const block=await get(args);return args.blockTag==='latest'?block:{...block,timestamp:BigInt(f.record.review.guard.deadline)};};}
  const result=await f.run();assert.equal(result.pending,1);assert.equal(f.proofs.length,0);
  assert.equal(f.jobs[0].result,'WAITING_FOR_FINALIZED_NONCE');assert.equal(f.jobs[0].delaySeconds,30);
});
test('provider and database races are retried without returning private error details',async()=>{
  for(const conflict of [false,true]){const f=fixture();if(conflict)f.args.store.recordVerifiedSettlement=async()=>{throw Error('TRAINING_STORE_CONFLICT');};
    else f.args.clients[1].getChainId=async()=>{throw Error('https://secret-provider.invalid/private-token');};
    const result=await f.run();assert.equal(result.settled,0);assert.equal(f.jobs[0].delaySeconds,60);
    assert.doesNotMatch(JSON.stringify(result),/private-token|secret-provider/);assert.equal(Object.values(result.errors)[0],1);}
});
test('worker budget defers leased work without starting RPC or settlement',async()=>{
  const f=fixture();let ticks=0;const base=f.args.now();f.args.now=()=>base+(ticks++===0?0:20000);
  f.args.clients[0].getChainId=async()=>{throw Error('SHOULD_NOT_RUN');};
  const result=await f.run();assert.equal(result.deferred,1);assert.deepEqual(result.errors,{});
  assert.equal(f.jobs[0].result,'WORKER_TIME_BUDGET');assert.equal(f.proofs.length,0);
});
test('lost rescheduling acknowledgment leaves recovery to the durable expiring lease',async()=>{
  const f=fixture();f.args.store.finishReconciliation=async()=>{throw Error('FINISH_ACK_LOST');};
  await assert.rejects(f.run,/FINISH_ACK_LOST/);assert.equal(f.proofs.length,1);
});
