import test from 'node:test';
import assert from 'node:assert/strict';
import selection from '../ops/forge-burn-test-selection.json' with { type: 'json' };
import { createLiveBurnPairClients, createLiveBurnPairReader, readLiveBurnPair, validateBurnTestSelection } from '../broker/src/v4/skill-forge/live-burn-pair.mjs';

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
test('disagreement on canonical block identity prevents a preflight result',async()=>{
  const diverged=()=>client({getBlock:async({blockTag})=>blockTag?head:{...head,hash:`0x${'2'.repeat(64)}`},getCode:async()=>'0x'});
  await assert.rejects(run([diverged(),diverged()]),/BURN_PAIR_PROVIDERS_DISAGREE/);
});
test('RPC failures stay failures instead of becoming empty inventories',async()=>{
  await assert.rejects(run([client(),client()]),/UNEXPECTED_STATE_READ/);
});

test('batched read transports preserve provider identity, block pins and out-of-order RPC results',async()=>{
  const requests=[];
  const clients=createLiveBurnPairClients({fetchFn:async(input,init)=>{
    const request=new Request(input,init),body=await request.json();
    assert.ok(Array.isArray(body));assert.ok(body.length<=20);
    requests.push({host:new URL(request.url).hostname,count:body.length});
    const responses=body.map(item=>{
      assert.equal(item.method,'eth_getBalance');assert.equal(item.params[1],'0x64');
      return {jsonrpc:'2.0',id:item.id,result:`0x${BigInt(item.params[0]).toString(16)}`};
    }).reverse();
    return Response.json(responses);
  }});
  const balances=await Promise.all(clients.map(c=>Promise.all(Array.from({length:25},(_,i)=>
    c.getBalance({address:`0x${BigInt(i+1).toString(16).padStart(40,'0')}`,blockNumber:100n})))));
  for(const result of balances)assert.deepEqual(result,Array.from({length:25},(_,i)=>BigInt(i+1)));
  assert.deepEqual(new Set(requests.map(r=>r.host)),new Set(['robinhood-rpc.publicnode.com','rpc.mainnet.chain.robinhood.com']));
  assert.equal(requests.reduce((n,r)=>n+r.count,0),50);assert.ok(requests.length<50);
});
test('one RPC error inside a batch remains an error for that read',async()=>{
  let requests=0;
  const [c]=createLiveBurnPairClients({fetchFn:async(input,init)=>{
    requests++;
    const body=await new Request(input,init).json();
    return Response.json(body.map(item=>({jsonrpc:'2.0',id:item.id,
      ...(item.method==='eth_getBalance'?{error:{code:-32000,message:'Test balance unavailable'}}:{result:'0x1237'})})));
  }});
  const [chain,balance]=await Promise.allSettled([c.getChainId(),c.getBalance({address:selection.owner,blockNumber:100n})]);
  assert.equal(chain.value,4663);assert.equal(balance.status,'rejected');assert.equal(requests,1);
});
test('transient RPC failure gets one retry with the identical provider and block',async()=>{
  const requests=[];
  const [c]=createLiveBurnPairClients({fetchFn:async(input,init)=>{
    const request=new Request(input,init),body=await request.json();
    requests.push({url:request.url,reads:body.map(({method,params})=>({method,params}))});
    if(requests.length===1)return new Response('Temporary upstream failure',{status:503});
    return Response.json(body.map(item=>({jsonrpc:'2.0',id:item.id,result:'0x7'})));
  }});
  assert.equal(await c.getBalance({address:selection.owner,blockNumber:100n}),7n);
  assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);
  assert.equal(requests[1].reads[0].params[1],'0x64');
});
test('persistent transport failure stops after the single retry without an empty balance',async()=>{
  let requests=0;
  const [c]=createLiveBurnPairClients({fetchFn:async()=>{requests++;return new Response('Temporary upstream failure',{status:503});}});
  await assert.rejects(c.getBalance({address:selection.owner,blockNumber:100n}));
  assert.equal(requests,2);
});
test('concurrent clicks share one running read, then a later click gets a new snapshot',async()=>{
  let calls=0,finish;
  const read=createLiveBurnPairReader(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const first=read(),second=read();assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
  finish({block:'100'});assert.deepEqual(await first,{block:'100'});
  const next=read();assert.notEqual(next,first);await Promise.resolve();assert.equal(calls,2);
  finish({block:'200'});assert.deepEqual(await next,{block:'200'});
});
test('failed shared reads are cleared so a retry cannot reuse a stale result or error',async()=>{
  let calls=0;
  const read=createLiveBurnPairReader(()=>{if(++calls===1)throw Error('BURN_PAIR_STALE_HEAD');return {block:'200'};});
  await assert.rejects(read(),/BURN_PAIR_STALE_HEAD/);
  assert.deepEqual(await read(),{block:'200'});assert.equal(calls,2);
});
