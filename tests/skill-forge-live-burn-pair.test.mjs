import test from 'node:test';
import assert from 'node:assert/strict';
import selection from '../ops/forge-burn-test-selection.json' with { type: 'json' };
import { readLiveBurnPair, validateBurnTestSelection } from '../broker/src/v4/skill-forge/live-burn-pair.mjs';

test('the live test selection binds the two distinct owner-selected original Punks', () => {
  const pair=validateBurnTestSelection(selection);
  assert.equal(pair.sourceTokenId,'1753');assert.equal(pair.targetTokenId,'93');
  assert.ok(Object.isFrozen(pair));assert.equal(pair.canBurn,undefined);
});
test('selection rejects same token, malformed identities, other chains and added authority', () => {
  for(const changes of [{targetTokenId:'1753'},{sourceTokenId:'01753'},{targetTokenId:93},{owner:`0x${'0'.repeat(40)}`},
    {chainId:31337},{collection:`0x${'1'.repeat(40)}`},{canBurn:true},{transaction:{}}]) {
    assert.throws(()=>validateBurnTestSelection({...selection,...changes}),/INVALID_BURN_TEST_SELECTION/);
  }
});
const head={number:100n,hash:`0x${'1'.repeat(64)}`,timestamp:1000n};
const client=(overrides={})=>({getChainId:async()=>4663,getBlock:async()=>head,
  getCode:async()=>{throw Error('UNEXPECTED_STATE_READ');},...overrides});
const run=clients=>readLiveBurnPair({clients,selection,now:()=>1000000});
test('preflight requires two separate clients and the correct chain before state reads',async()=>{
  const c=client();await assert.rejects(run([c]),/BURN_PAIR_RPC_PAIR_REQUIRED/);
  await assert.rejects(run([c,c]),/BURN_PAIR_RPC_PAIR_REQUIRED/);
  await assert.rejects(run([c,client({getChainId:async()=>1})]),/BURN_PAIR_CHAIN_CHANGED/);
});
test('stale or divergent heads cannot produce a usable live preflight',async()=>{
  const stale=()=>client({getBlock:async()=>({...head,timestamp:800n})});
  await assert.rejects(run([stale(),stale()]),/BURN_PAIR_STALE_HEAD/);
  await assert.rejects(run([client(),client({getBlock:async()=>({...head,number:221n})})]),/BURN_PAIR_STALE_HEAD/);
});
test('disagreement on canonical block identity fails before that provider reads state',async()=>{
  const diverged=()=>client({getBlock:async({blockTag})=>blockTag?head:{...head,hash:`0x${'2'.repeat(64)}`}});
  await assert.rejects(run([diverged(),diverged()]),/BURN_PAIR_PROVIDERS_DISAGREE/);
});
test('RPC failures stay failures instead of becoming empty inventories',async()=>{
  await assert.rejects(run([client(),client()]),/UNEXPECTED_STATE_READ/);
});
