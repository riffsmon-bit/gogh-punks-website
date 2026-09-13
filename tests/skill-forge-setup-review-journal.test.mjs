import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSetupReviewJournal } from '../scripts/dev/skill-forge/setup-review-journal.mjs';

test('setup claims survive restart and stale tabs cannot open a second wallet request', async () => {
  const dir = await mkdtemp(join(tmpdir(),'gogh-setup-journal-'));
  const config = { path: join(dir,'journal.sqlite'), binding: 'fixed-review-build' };
  let journal = openSetupReviewJournal(config);
  try {
    const prepared = journal.prepare(0,{ action:'REGISTER_RARITY_EYE', expiresAt:Date.now()+60000, transaction:{nonce:'0x1',data:'0x1234'} });
    const hash = prepared.records[0].reviewHash;
    assert.throws(()=>journal.claim(0,hash));
    journal.claim(1,hash); journal.close(); journal = openSetupReviewJournal(config);
    assert.equal(journal.snapshot().records[0].status,'WALLET_REQUESTED');
    assert.throws(()=>journal.claim(2,hash));
    assert.throws(()=>journal.prepare(2,{expiresAt:Date.now()+60000}));
    const tx = '0x'+'1'.repeat(64); journal.recover(2,tx);
    assert.throws(()=>journal.recover(3,'0x'+'2'.repeat(64)));
    assert.throws(()=>journal.include(3,{transactionHash:'0x'+'2'.repeat(64),status:'success'}));
    journal.include(3,{transactionHash:tx,status:'success',blockHash:'0x'+'3'.repeat(64)});
    assert.equal(journal.snapshot().records[0].status,'INCLUDED');
    assert.throws(()=>openSetupReviewJournal({...config,binding:'different-build'}));
  } finally { journal.close(); await rm(dir,{recursive:true,force:true}); }
});

test('an unclaimed review can be replaced but expired or altered reviews cannot be claimed', async () => {
  const dir = await mkdtemp(join(tmpdir(),'gogh-setup-journal-'));
  const journal = openSetupReviewJournal({path:join(dir,'journal.sqlite'),binding:'fixed'});
  try {
    let state=journal.prepare(0,{expiresAt:Date.now()-1});
    assert.throws(()=>journal.claim(1,state.records[0].reviewHash));
    state=journal.prepare(1,{expiresAt:Date.now()+60000});
    assert.equal(state.records[0].status,'CANCELLED_BEFORE_WALLET');
    assert.throws(()=>journal.claim(2,'altered-hash'));
    journal.claim(2,state.records[1].reviewHash);
    assert.equal(journal.snapshot().records[1].status,'WALLET_REQUESTED');
  } finally { journal.close(); await rm(dir,{recursive:true,force:true}); }
});

test('an explicit build migration preserves unchanged reviews and rejects incompatible deployment reviews', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gogh-setup-journal-')),path=join(dir,'journal.sqlite');
  let journal=openSetupReviewJournal({path,binding:'old'});
  try {
    const state=journal.prepare(0,{action:'REGISTER_RARITY_EYE',expiresAt:Date.now()+60000});
    const saved=state.records[0];journal.close();
    journal=openSetupReviewJournal({path,binding:'new',migrateBinding:prior=>prior.records.every(r=>r.review.action==='REGISTER_RARITY_EYE')});
    assert.deepEqual(journal.snapshot().records[0],saved);
    assert.equal(journal.snapshot().revision,2);
    assert.throws(()=>journal.claim(1,saved.reviewHash));
    journal.prepare(2,{action:'DEPLOY_DIRECTED_PAID_MINT',expiresAt:Date.now()+60000});
    journal.close();
    assert.throws(()=>openSetupReviewJournal({path,binding:'different',migrateBinding:prior=>prior.records.every(r=>r.review.action==='REGISTER_RARITY_EYE')}));
    journal=openSetupReviewJournal({path,binding:'new'});
    assert.equal(journal.snapshot().records.at(-1).review.action,'DEPLOY_DIRECTED_PAID_MINT');
  } finally { journal.close();await rm(dir,{recursive:true,force:true}); }
});

test('an explicit wallet decline permits a new review but cannot erase a submitted transaction', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gogh-setup-journal-'));
  const journal=openSetupReviewJournal({path:join(dir,'journal.sqlite'),binding:'fixed'});
  try {
    let state=journal.prepare(0,{expiresAt:Date.now()+60000}),hash=state.records[0].reviewHash;
    assert.throws(()=>journal.decline(1,hash));journal.claim(1,hash);
    journal.decline(2,hash);state=journal.prepare(3,{expiresAt:Date.now()+60000});hash=state.records.at(-1).reviewHash;
    journal.claim(4,hash);journal.recover(5,'0x'+'1'.repeat(64));
    assert.throws(()=>journal.decline(6,hash));
    assert.equal(journal.snapshot().records.at(-1).status,'SUBMITTED');
  } finally {journal.close();await rm(dir,{recursive:true,force:true});}
});
