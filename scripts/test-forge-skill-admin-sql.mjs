import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPinnedMemoryPostgres} from './dev/skill-forge/pinned-pglite-memory.mjs';
import {createSkillAdminStore,verifySkillAdminDatabaseRole} from '../broker/src/v4/skill-forge/skill-admin-store.mjs';
import {createSkillAdminCancellationReview} from '../broker/src/v4/skill-forge/skill-admin-cancellation.mjs';
import {manifestHash} from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import {skillAdminFixture,ADMIN,REGISTRY,TX} from '../tests/fixtures/skill-admin.mjs';
if(process.argv.slice(2).join(' ')!=='--disposable-memory-only')throw Error('Requires --disposable-memory-only');
const db=await createPinnedMemoryPostgres();let passed=0;
try{
  await db.exec(await readFile(new URL('../netlify/database/migrations/20260914030000_forge_skill_admin_reviews.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../netlify/database/migrations/20260914033000_forge_skill_admin_nonce_recovery.sql',import.meta.url),'utf8'));
  const pool={...db.pool,query:db.query};
  await assert.rejects(verifySkillAdminDatabaseRole(pool),/ROLE_UNSAFE/);passed++;
  await db.exec('SET ROLE gogh_forge_skill_admin_request');await verifySkillAdminDatabaseRole(pool);passed++;
  const store=createSkillAdminStore({pool,registry:REGISTRY}),{preparation}=skillAdminFixture(),requestKey=randomUUID();
  const reviews=await Promise.all(Array.from({length:8},()=>store.prepare(ADMIN,requestKey,preparation,manifestHash(preparation))));
  assert.equal(new Set(reviews.map(row=>row.id)).size,1);passed++;
  const row=reviews[0];assert.equal((await store.get(ADMIN)).id,row.id);assert.equal(await store.get(`0x${'2'.repeat(40)}`,row.id),null);passed++;
  const claims=await Promise.allSettled(Array.from({length:8},()=>store.update(ADMIN,row.id,0,['PREPARED'],'WALLET_REQUESTED')));
  assert.equal(claims.filter(result=>result.status==='fulfilled').length,1);passed++;
  const restart=createSkillAdminStore({pool,registry:REGISTRY});assert.equal((await restart.get(ADMIN,row.id)).status,'WALLET_REQUESTED');passed++;
  await assert.rejects(store.update(ADMIN,row.id,1,['WALLET_REQUESTED'],'CANCELLED'),/INVALID_TRANSITION/);passed++;
  await assert.rejects(pool.query('UPDATE public.broker_forge_skill_admin_reviews SET preparation=$1 WHERE id=$2',[{},row.id]),/permission denied/);passed++;
  await assert.rejects(pool.query('DELETE FROM public.broker_forge_skill_admin_reviews WHERE id=$1',[row.id]),/permission denied/);passed++;
  await assert.rejects(pool.query('TRUNCATE public.broker_forge_skill_admin_reviews'),/permission denied/);passed++;
  const submitted=await store.update(ADMIN,row.id,1,['WALLET_REQUESTED'],'SUBMITTED',{transactionHash:TX});
  assert.equal(submitted.transactionHash,TX);passed++;
  await assert.rejects(store.update(ADMIN,row.id,2,['SUBMITTED'],'CONFIRMED',{transactionHash:`0x${'9'.repeat(64)}`}),/HASH_IMMUTABLE/);passed++;
  const confirmed=await store.update(ADMIN,row.id,2,['SUBMITTED'],'CONFIRMED',{receipt:{transactionHash:TX,blockHash:'0x'+'c'.repeat(64),blockNumber:'100',status:'success',minimumConfirmations:12,kind:'ORIGINAL',valueWei:'0'}});assert.equal(confirmed.revision,3);passed++;
  await assert.rejects(store.update(ADMIN,row.id,3,['CONFIRMED'],'CONFIRMED',{receipt:{status:'changed'}}),/INVALID_TRANSITION/);passed++;
  const expired={...preparation,expiresAt:Date.now()-1000};const old=await store.prepare(ADMIN,randomUUID(),expired,manifestHash(expired));
  await assert.rejects(store.update(ADMIN,old.id,0,['PREPARED'],'WALLET_REQUESTED'),/REVIEW_EXPIRED/);passed++;
  await store.update(ADMIN,old.id,0,['PREPARED'],'CANCELLED');passed++;
  for(const mutate of [p=>delete p.expiresAt,p=>p.expiresAt=null,p=>p.expiresAt='1',p=>delete p.transaction,p=>p.transaction=null,
    p=>p.transaction.from='0x'+'2'.repeat(40),p=>p.transaction.to=ADMIN,p=>delete p.key,p=>p.chainId='4663',
    p=>p.maximumNetworkFeeWei='1',p=>p.transaction.data=null,p=>p.transaction.gas='0xffffffffffffffff']){
    const invalid=structuredClone(preparation);mutate(invalid);
    await assert.rejects(store.prepare(ADMIN,randomUUID(),invalid,manifestHash(invalid)));passed++;
  }
  const pending=await store.prepare(ADMIN,randomUUID(),preparation,manifestHash(preparation));
  const requested=await store.update(ADMIN,pending.id,0,['PREPARED'],'WALLET_REQUESTED');
  const cancelPreparation=await createSkillAdminCancellationReview(skillAdminFixture()).prepare({row:requested});
  const cancel=await store.prepareCancellation(ADMIN,pending.id,randomUUID(),cancelPreparation,manifestHash(cancelPreparation));
  const cancelClaims=await Promise.allSettled(Array.from({length:8},()=>store.claimCancellation(ADMIN,pending.id,cancel.id,0)));
  assert.equal(cancelClaims.filter(item=>item.status==='fulfilled').length,1);passed++;
  assert.equal((await store.get(ADMIN,pending.id)).status,'WALLET_REQUESTED');passed++;
  await assert.rejects(pool.query('UPDATE public.broker_forge_skill_admin_cancellations SET preparation=$1 WHERE id=$2',[{},cancel.id]),/permission denied/);passed++;
  const pointed=await store.update(ADMIN,pending.id,1,['WALLET_REQUESTED'],'WALLET_REQUESTED',{recoveryHash:TX});
  for(const proof of [{},{transactionHash:TX},{transactionHash:TX,blockHash:'0x'+'c'.repeat(64),blockNumber:'100',status:'success',minimumConfirmations:11,kind:'REPLACEMENT',valueWei:'0'}]){
    await assert.rejects(store.update(ADMIN,pending.id,pointed.revision,['WALLET_REQUESTED'],'REPLACED',{receipt:proof}),/TERMINAL_PROOF_INVALID/);passed++;
  }
  const replacement=await store.update(ADMIN,pending.id,pointed.revision,['WALLET_REQUESTED'],'REPLACED',{receipt:{transactionHash:TX,blockHash:'0x'+'c'.repeat(64),blockNumber:'100',status:'success',minimumConfirmations:12,kind:'REPLACEMENT',valueWei:'0'}});
  assert.equal(replacement.status,'REPLACED');assert.equal(await store.get(ADMIN),null);passed++;
  const events=await pool.query('SELECT status FROM public.broker_forge_skill_admin_events WHERE parent_id=$1 ORDER BY event_id',[pending.id]);
  assert.deepEqual(events.rows.map(row=>row.status),['PREPARED','WALLET_REQUESTED','PREPARED','WALLET_REQUESTED','WALLET_REQUESTED','REPLACED']);passed++;
  for(const sql of [`INSERT INTO public.broker_forge_skill_admin_events(parent_id,administrator,revision,status) VALUES($1,$2,0,'FORGED')`,
    `UPDATE public.broker_forge_skill_admin_events SET status='FORGED' WHERE parent_id=$1 AND administrator=$2`,
    'DELETE FROM public.broker_forge_skill_admin_events WHERE parent_id=$1 AND administrator=$2']){
    await assert.rejects(pool.query(sql,[pending.id,ADMIN]),/permission denied/);passed++;
  }
  await db.exec('RESET ROLE');
  await db.exec('GRANT UPDATE ON public.broker_forge_skill_admin_reviews TO gogh_forge_skill_admin_request');
  await db.exec('SET ROLE gogh_forge_skill_admin_request');await assert.rejects(verifySkillAdminDatabaseRole(pool),/ROLE_UNSAFE/);passed++;
  console.log(JSON.stringify({status:'PASS',assertions:passed,engine:'Pinned PGlite PostgreSQL in memory',nativeMultiSessionDurabilityProven:false,publicTransactions:0,productionDatabaseWrites:0}));
}finally{await db.close();}
