import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {acquirePunkAgentWorkerLease} from '../netlify/functions/_shared/punk-agent-worker-lease.mjs';

function fixture({acquired=true}={}) {
  const client=new EventEmitter(),queries=[];
  let at=0,identity={pid:12,transaction_id:'34',held:true},released;
  client.query=async(sql,args)=>{queries.push(sql);
    if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{acquired,...identity}]};
    if(sql.includes('pg_locks')){assert.deepEqual(args,[4663,8005]);return {rows:[identity]};}
    return {rows:[]};};
  client.release=broken=>{released=broken;};
  return {client,queries,pool:{connect:async()=>client},now:()=>at,
    expire:()=>{at=110000;},change:()=>{identity={...identity,transaction_id:'35'};},released:()=>released};
}
test('busy transaction lease rolls back and returns the connection',async()=>{
  const f=fixture({acquired:false}),lease=await acquirePunkAgentWorkerLease(f.pool);
  assert.equal(lease.acquired,false);assert.equal(f.queries.at(-1),'ROLLBACK');assert.equal(f.released(),false);
});
test('lease validates the original transaction, expires, and rejects a resumed connection',async()=>{
  for(const stop of ['expire','change','disconnect','release']){
    const f=fixture(),lease=await acquirePunkAgentWorkerLease(f.pool,{now:f.now});
    await lease.assertHeld();
    if(stop==='disconnect')f.client.emit('error',Error('private database detail'));
    else if(stop==='release')await lease.release();
    else f[stop]();
    await assert.rejects(lease.assertHeld(),{code:'WORKER_LEASE_LOST'});
    await lease.release();await lease.release();
    assert.equal(f.queries.filter(q=>q==='ROLLBACK').length,1);
  }
});
