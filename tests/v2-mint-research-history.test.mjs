import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, encodeEventTopics, parseAbiItem } from 'viem';
import { mintResearchFixture, OWNER, GOGH } from './helpers/mint-research-context-fixture.mjs';
import { createMintResearchContextReader } from '../netlify/functions/_shared/v2-mint-research-context.mjs';
const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const hash = number => `0x${(number + 1n).toString(16).padStart(64,'0')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function fixture({from=99n,to=10100n}={}) {
  const f=mintResearchFixture();f.strategy.ownership_block=from.toString();
  f.clock=+f.time;f.contextOptions.now=()=>new Date(f.clock);
  f.pages=[];f.headers=[];f.inFlight=0;f.maxInFlight=0;f.headChanged=false;f.originChanged=false;
  f.header=query=>({number:query.blockNumber??to,hash:hash(query.blockNumber??to),timestamp:BigInt(+f.time/1000)});
  f.client.getBlock=async(query={})=>{f.headers.push(query);return f.header(query);};
  f.client.getBlockNumber=async()=>to;
  f.client.getLogs=async query=>{
    assert.equal(query.address,GOGH);assert.equal(query.args.tokenId,93n);assert.equal(query.strict,true);
    assert.ok(query.fromBlock>=from&&query.toBlock<=to&&query.toBlock-query.fromBlock<2000n,'provider-sized request bound');
    f.pages.push(query);f.inFlight++;f.maxInFlight=Math.max(f.maxInFlight,f.inFlight);
    try {await sleep(1);return f.page?await f.page(query):[];} finally {f.inFlight--;}
  };
  f.run=()=>createMintResearchContextReader(f.contextOptions)(f.identity);
  f.transfer=(blockNumber,tokenId=93n)=>({address:GOGH,blockNumber:`0x${blockNumber.toString(16)}`,blockHash:hash(blockNumber),removed:false,data:'0x',
    topics:encodeEventTopics({abi:[TRANSFER],eventName:'Transfer',args:{from:OWNER,to:`0x${'2'.repeat(40)}`,tokenId}})});
  return f;
}
test('valid old strategy scans every inclusive provider-sized page, including partial final page, at bounded concurrency',async()=>{
  const f=fixture(),context=await f.run();assert.equal(context.authority.blockNumber,'10100');
  assert.deepEqual(f.pages.map(q=>[q.fromBlock,q.toBlock]).sort((a,b)=>Number(a[0]-b[0])),[
    [99n,2098n],[2099n,4098n],[4099n,6098n],[6099n,8098n],[8099n,10098n],[10099n,10100n]]);
  assert.equal(f.maxInFlight,4);assert.equal(f.inFlight,0);
  assert.equal(f.headers.filter(q=>q.blockNumber===99n).length,2,'origin checked before and after pages');
  assert.ok(f.headers.filter(q=>q.blockNumber===10100n).length>=3,'same authority anchor rechecked');
});
for(let index=0;index<6;index++)test(`a transfer in history page ${index+1} rejects the strategy`,async()=>{
  const f=fixture(),block=99n+BigInt(index)*2000n;
  f.page=query=>query.fromBlock===block?[f.transfer(block)]:[];
  await assert.rejects(f.run(),/STRATEGY_OWNER_CHANGED/);await sleep(5);
  assert.ok(f.maxInFlight<=4);assert.ok(f.pages.length<=6);
});
test('a transfer at the final inclusive anchor rejects the strategy',async()=>{
  const f=fixture();f.page=query=>query.toBlock===10100n?[f.transfer(10100n)]:[];
  await assert.rejects(f.run(),/STRATEGY_OWNER_CHANGED/);
});
test('away and back across different pages never passes because the present owner matches',async()=>{
  const f=fixture();f.page=query=>[2098n,8099n].filter(n=>n>=query.fromBlock&&n<=query.toBlock).map(n=>f.transfer(n));
  await assert.rejects(f.run(),/STRATEGY_OWNER_CHANGED/);
});
for(const [name,response]of[
  ['missing page',()=>undefined],['null page',()=>null],['provider envelope',()=>({logs:[],next:'missing-page'})],
  ['sparse array',()=>new Array(1)],['truncated log',()=>[{}]],
  ['extra continuation metadata',()=>Object.assign([],{next:'unread'})],
  ['oversized page',()=>new Array(1001)],
])test(`${name} cannot become zero transfers`,async()=>{
  const f=fixture();f.page=query=>query.fromBlock===2099n?response():[];
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
for(const [name,mutate]of[
  ['wrong token',(_log,f)=>f.transfer(2099n,94n)],['removed log',log=>({...log,removed:true})],
  ['out-of-page block',log=>({...log,blockNumber:2098n})],['wrong collection',log=>({...log,address:OWNER})],
  ['malformed topics',log=>({...log,topics:['0x1234']})],['orphan block hash',log=>({...log,blockHash:hash(0n)})],
])test(`${name} rejects malformed history`,async()=>{
  const f=fixture();f.page=query=>query.fromBlock===2099n?[mutate(f.transfer(2099n),f)]:[];
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
test('failed page is sanitized and the failed scan stops scheduling more pages',async()=>{
  const f=fixture({to:100_000n});
  f.page=async query=>{if(query.fromBlock===99n)throw Error('https://private:key@provider.invalid');return [];};
  await assert.rejects(f.run(),{message:'MINT_RESEARCH_HISTORY_UNAVAILABLE'});await sleep(5);
  assert.equal(f.pages.length,4,'only the already-started bounded worker batch ran');
});
for(const which of['origin','current anchor'])test(`${which} reorg during pagination invalidates the common snapshot`,async()=>{
  const f=fixture(),original=f.header;let completed=false;
  f.page=()=>{completed=true;return [];};
  f.header=query=>{const block=original(query);return completed&&query.blockNumber===(which==='origin'?99n:10100n)?{...block,hash:hash(1n)}:block;};
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
test('history from a different chain is rejected',async()=>{
  const f=fixture();f.page=()=>{f.chain=1;return [];};await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
test('scan duration has its own bound and stops before issuing another page',async()=>{
  const f=fixture({to:100_000n});f.page=()=>{f.clock+=8001;return [];};
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);await sleep(5);assert.equal(f.pages.length,4);
});
test('30-second authority freshness is preserved while historical pages load',async()=>{
  const f=fixture();f.clock+=29_900;f.page=()=>{f.clock+=101;return [];};
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
test('maximum work is bounded before starting any log request',async()=>{
  const f=fixture({from:0n,to:1_024_000n});await assert.rejects(f.run(),/HISTORY_WINDOW_EXCEEDED/);assert.equal(f.pages.length,0);
});

test('actual viem transport cannot filter malformed raw logs into an approved empty page',async()=>{
  const f=fixture();const malformed={...f.transfer(2099n),topics:['0x1234'],transactionHash:hash(50n),transactionIndex:'0x0',logIndex:'0x0'};
  const rpc=createPublicClient({transport:custom({request:async({method,params})=>{
    assert.equal(method,'eth_getLogs');const q=params[0];assert.ok(BigInt(q.toBlock)-BigInt(q.fromBlock)<2000n);
    return BigInt(q.fromBlock)===2099n?[malformed]:[];
  }},{retryCount:0})});
  // Establish the library behavior which made an event-aware empty result unsafe.
  assert.deepEqual(await rpc.getLogs({address:GOGH,event:TRANSFER,args:{tokenId:93n},fromBlock:2099n,toBlock:4098n,strict:true}),[]);
  f.client.request=rpc.request;
  await assert.rejects(f.run(),/HISTORY_UNAVAILABLE/);
});
