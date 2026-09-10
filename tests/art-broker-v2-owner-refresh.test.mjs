import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createOwnerRefresh } from '../site/broker-v2-owner-refresh.js';

const ALICE = `0x${'1'.repeat(40)}`, BOB = `0x${'2'.repeat(40)}`;
const punk = tokenId => ({ tokenId });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture() {
  const f = { context: { owner: ALICE, chainId: 4663, visible: true }, punks: [punk('93')],
    next: [punk('93')], time: 0, changes: 0, failures: 0, reads: 0 };
  f.read = async () => f.next;
  f.refresh = createOwnerRefresh({ getContext: () => f.context, getPunks: () => f.punks, now: () => f.time,
    readOwned: async owner => { f.reads++; assert.equal(owner, f.context.owner); return f.read(); },
    onChanged: punks => { f.punks = punks; f.changes++; },
    onUnavailable: () => { f.punks = []; f.failures++; } });
  return f;
}
test('same-wallet NFT purchase appears and sale disappears without a reconnect or signature', async () => {
  const f=fixture(); f.next=[punk('93'),punk('119')];
  assert.equal((await f.refresh.refresh()).status, 'CHANGED');
  assert.deepEqual(f.punks.map(p=>p.tokenId), ['93','119']);
  f.time+=30000; f.next=[punk('119')];
  assert.equal((await f.refresh.refresh()).status, 'CHANGED');
  assert.deepEqual(f.punks.map(p=>p.tokenId), ['119']);
  assert.equal(f.changes,2);
});
test('unchanged roster does not reset the current conversation, selection, or draft', async () => {
  const f=fixture();
  assert.equal((await f.refresh.refresh()).status, 'UNCHANGED');
  assert.equal(f.changes,0);
});
test('reordered IDs are unchanged, not a reason to rehydrate the selected Punk', async () => {
  const f=fixture(); f.punks=[punk('119'),punk('93')]; f.next=[punk('93'),punk('119')];
  assert.equal((await f.refresh.refresh()).status, 'UNCHANGED');
});
test('refresh is throttled, single-flight and paused on hidden pages or wrong networks', async () => {
  const f=fixture(), pending=deferred(); f.read=()=>pending.promise;
  const first=f.refresh.refresh();
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  pending.resolve(f.next); await first;
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  f.time+=30000; f.context.visible=false;
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  f.context.visible=true; f.context.chainId=1;
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  f.context.chainId=4663; f.context.loading=true;
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  assert.equal(f.reads,1);
});
for (const change of ['owner','chain','roundtrip']) test(`discard late responses after ${change}`, async()=>{
  const f=fixture(), pending=deferred(); f.read=()=>pending.promise;
  const first=f.refresh.refresh();
  if(change==='owner') f.context.owner=BOB;
  if(change==='chain') f.context.chainId=1;
  if(change==='roundtrip') { f.context.owner=BOB; f.refresh.invalidate(); f.context.owner=ALICE; }
  pending.resolve([punk('119')]);
  assert.equal((await first).status,'DISCARDED'); assert.equal(f.changes,0);
});
test('a stale failed request cannot clear the next wallet roster or unlock a concurrent read',async()=>{
  const f=fixture(), old=deferred(), fresh=deferred(); f.read=()=>old.promise;
  const first=f.refresh.refresh(); f.refresh.invalidate(); f.context.owner=BOB; f.read=()=>fresh.promise;
  const second=f.refresh.refresh(); old.reject(Error('RPC'));
  assert.equal((await first).status,'DISCARDED'); assert.equal(f.failures,0);
  assert.equal((await f.refresh.refresh()).status,'SKIPPED');
  fresh.resolve([punk('119')]); await second; assert.deepEqual(f.punks,[punk('119')]);
});
test('unknown ownership clears controls, then a verified empty roster automatically recovers',async()=>{
  const f=fixture(); f.read=async()=>{throw Error('RPC details never shown');};
  assert.equal((await f.refresh.refresh()).status,'UNAVAILABLE'); assert.equal(f.failures,1);
  f.time+=30000; f.read=async()=>[];
  assert.equal((await f.refresh.refresh()).status,'CHANGED'); assert.deepEqual(f.punks,[]);
});
for(const next of [null,[punk('93'),punk('93')],[punk('-1')],[punk(93)]]) {
  test(`malformed roster fails closed: ${JSON.stringify(next)}`,async()=>{
    const f=fixture(); f.next=next;
    assert.equal((await f.refresh.refresh()).status,'UNAVAILABLE'); assert.equal(f.changes,0);
  });
}
test('main V2 has no wrapped-receipt enrollment and automatically reconciles original NFT ownership',async()=>{
  const html=await readFile(new URL('../site/broker/v2/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../site/broker-v2.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/data-epoch-control|broker-v2-epoch.css/);
  assert.doesNotMatch(js,/createEpochControl|\/api\/v2\/epoch\//);
  assert.match(js,/createOwnerRefresh/); assert.match(js,/setInterval\(\(\) => void ownerRefresh.refresh\(\), 30_000\)/);
  assert.match(js,/window.addEventListener\('focus'/); assert.match(js,/visibilitychange/);
  assert.match(js,/clearTransferredPunkReview/);
  assert.match(html,/original Gogh Punk is the ownership key/);
});
