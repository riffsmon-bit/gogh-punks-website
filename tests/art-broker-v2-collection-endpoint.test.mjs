import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeEventTopics,parseAbi} from 'viem';
import {handleV2Collection} from '../netlify/functions/broker-v2-collection.mjs';
import {discoverCollectionReceipts} from '../netlify/functions/_shared/v2-collection-discovery.mjs';
import {PublicError} from '../netlify/functions/_shared/http.mjs';

const owner='0x'+'1'.repeat(40),wallet='0x'+'2'.repeat(40),agent='0x'+'3'.repeat(40),other='0x'+'4'.repeat(40);
const collection='0x'+'5'.repeat(40),hash='0x'+'a'.repeat(64);
const request=()=>new Request('https://goghpunks.xyz/api/v2/punks/93/collection');
const hanging=()=>new Promise(()=>{});
const paid=()=>({available:true,candidates:[{collection,tokenId:'1599',standard:'ERC721',custodyAccount:agent,
  custodyType:'PUNK_AGENT_ACCOUNT',acquisitionType:'V2_DIRECTED_PAID_MINT',provenance:'V2',artwork:null,transactionHash:hash}]});
function options(overrides={}){
  return {pool:{query:async()=>({rows:[]})},sessionReader:async()=>({walletAddress:owner}),
    authorityReader:async(_tokenId,{expectedOwner})=>{assert.equal(expectedOwner,owner);return {owner,punkWallet:wallet,blockNumber:'100'};},
    client:{readContract:async q=>q.functionName==='account'?agent:q.functionName==='ownerOf'?(q.args[0]===1599n?agent:other):'data:application/json,{}'},
    paidHistoryReader:async()=>paid(),receiptDiscovery:async()=>({candidates:[],available:true}),
    displayReader:async()=>({name:'Peppies #1599',imageUrl:'https://i.seadn.io/example.png'}),environment:{},
    budgets:{requestMs:1000,sessionMs:50,authorityMs:50,discoveryMs:40,registryMs:30,ownershipMs:100,ownerReadMs:20,metadataMs:20,displayReadMs:10},
    ...overrides};
}
test('slow optional acquisition/index/receipt/metadata sources still return the live-verified paid NFT', {timeout:1500},async()=>{
  const started=[];const response=await handleV2Collection(request(),options({
    pool:{query:()=>{started.push('acquisitions');return hanging();}},
    receiptDiscovery:()=>{started.push('receipts');return hanging();},
    portfolioReader:account=>{started.push(account);return hanging();},displayReader:hanging,
    paidHistoryReader:async()=>{started.push('paid');return paid();},
  }));
  assert.equal(response.status,200);const body=await response.json();
  assert.deepEqual(body.holdings.map(item=>item.tokenId),['1599']);assert.equal(body.holdings[0].ownershipStatus,'LIVE_VERIFIED');
  assert.equal(body.holdings[0].custodyType,'PUNK_AGENT_ACCOUNT');assert.equal(body.holdings[0].artwork,null);
  assert.equal(body.holdings[0].withdrawControlUrl,'/broker/v2/?tab=fund&tokenId=93#agent-recovery');
  assert.equal(body.paidMintHistoryAvailable,true);assert.equal(body.inventoryComplete,false);assert.equal(body.metadataUnavailable,1);
  assert.deepEqual(body.discoverySourcesUnavailable,['ACQUISITIONS','AGENT_INDEX','WALLET_INDEX','WALLET_RECEIPTS']);
  assert.deepEqual(new Set(started),new Set(['acquisitions','receipts','paid',wallet,agent]));
});
test('failed optional sources expose fixed partial notes without hiding verified paid art or leaking provider details',async()=>{
  const fail=()=>{throw Error('https://provider.invalid/SECRET_PATH');};
  const response=await handleV2Collection(request(),options({pool:{query:fail},receiptDiscovery:fail,portfolioReader:fail}));
  const body=await response.json();assert.equal(body.holdings[0].tokenId,'1599');assert.equal(body.holdings[0].artwork.name,'Peppies #1599');
  assert.equal(body.metadataUnavailable,0);assert.equal(body.discoverySourcesUnavailable.length,4);
  assert.equal(JSON.stringify(body).includes('SECRET_PATH'),false);
});
test('a completed paid receipt and index entry cannot establish custody after the NFT is sent away',async()=>{
  const response=await handleV2Collection(request(),options({client:{readContract:async q=>q.functionName==='account'?agent:other},
    portfolioReader:async()=>[{collection,tokenId:'1599',name:'Indexed NFT',imageUrl:'https://i.seadn.io/a'}]}));
  const body=await response.json();assert.deepEqual(body.holdings,[]);assert.equal(body.ownershipChecksUnavailable,0);
  assert.equal(body.inventoryComplete,false);assert.equal(body.paidMintHistoryAvailable,true);
});
test('unknown agent account is excluded instead of taking custody authority from paid history',async()=>{
  const response=await handleV2Collection(request(),options({client:{readContract:async q=>{
    if(q.functionName==='account')throw Error('unavailable');return other;
  }}}));
  const body=await response.json();assert.deepEqual(body.holdings,[]);assert.ok(body.discoverySourcesUnavailable.includes('AGENT_ACCOUNT'));
  assert.equal(body.inventoryComplete,false);
});
test('missing paid history is partial availability and never an assertion of an empty complete inventory',{timeout:1500},async()=>{
  const response=await handleV2Collection(request(),options({paidHistoryReader:hanging}));
  const body=await response.json();assert.equal(body.paidMintHistoryAvailable,false);assert.equal(body.inventoryComplete,false);
  assert.deepEqual(body.holdings,[]);assert.ok(body.discoverySourcesUnavailable.includes('PAID_MINT_HISTORY'));
});
test('paid candidates precede a capped acquisition backlog and duplicates do not consume the custody budget',async()=>{
  const checked=[];const rows=Array.from({length:300},(_,i)=>({nft_collection_address:collection,nft_token_id:String(i),
    punk_account_address:wallet,acquired_at:'2026-09-13T00:00:00Z',asset_amount:'1',acquisition_mode:'V1',price:'0'}));
  const response=await handleV2Collection(request(),options({pool:{query:async()=>({rows})},
    paidHistoryReader:async()=>({available:true,candidates:[...paid().candidates,...paid().candidates]}),
    client:{readContract:async q=>{
      if(q.functionName==='account')return agent;
      if(q.functionName==='ownerOf'){checked.push(String(q.args[0]));return q.args[0]===1599n?agent:wallet;}
      return 'data:application/json,{}';
    }}}));
  const body=await response.json();assert.equal(checked[0],'1599');assert.equal(checked.length,128);
  assert.equal(body.holdings.length,128);assert.equal(body.holdings[0].tokenId,'1599');assert.equal(body.inventoryComplete,false);
});
test('session rejection prevents authority, discovery and all NFT reads',async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('must not run');};
  const response=await handleV2Collection(request(),options({sessionReader:async()=>{throw new PublicError(401,'AUTH_REQUIRED','Sign in.');},
    authorityReader:forbidden,paidHistoryReader:forbidden,receiptDiscovery:forbidden,pool:{query:forbidden}}));
  assert.equal(response.status,401);assert.equal(calls,0);
});
test('the real authority reader rejects a signed-in former owner before discovery',async()=>{
  let discoveries=0;
  const response=await handleV2Collection(request(),options({authorityReader:undefined,
    client:{getBlockNumber:async()=>100n,readContract:async q=>q.functionName==='ownerOf'?other:q.functionName==='account'?wallet:true},
    paidHistoryReader:async()=>{discoveries++;return paid();},pool:{query:async()=>{discoveries++;return {rows:[]};}}}));
  assert.equal(response.status,403);assert.equal((await response.json()).code,'NOT_CURRENT_OWNER');assert.equal(discoveries,0);
});
test('stalled mandatory authority fails without returning holdings',{timeout:1500},async()=>{
  let discoveries=0;const response=await handleV2Collection(request(),options({authorityReader:hanging,
    paidHistoryReader:async()=>{discoveries++;return paid();}}));
  assert.equal(response.status,503);assert.equal((await response.json()).code,'COLLECTION_AUTHORITY_UNAVAILABLE');assert.equal(discoveries,0);
});
test('receipt discovery is read-only, bounded and requires a matching mint event before live custody verification',async()=>{
  let reads=0;const transfer=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
  const row={account_address:wallet,collection_address:collection,transaction_hash:hash,completed_at:'2026-09-13T00:00:00Z'};
  const result=await discoverCollectionReceipts({tokenId:'93',account:wallet,pool:{query:async(sql,args)=>{
    assert.match(sql,/^SELECT /);assert.match(sql,/LIMIT 64/);assert.deepEqual(args,['93',wallet]);return {rows:[row]};}},
    client:{getTransactionReceipt:async()=>{reads++;return {status:'success',transactionHash:hash,logs:[{address:collection,data:'0x',
      topics:encodeEventTopics({abi:transfer,eventName:'Transfer',args:{from:'0x'+'0'.repeat(40),to:wallet,tokenId:42n}})}]};}}});
  assert.equal(reads,1);assert.equal(result.available,true);assert.equal(result.candidates[0].tokenId,'42');
  assert.equal(result.candidates[0].ownershipStatus,undefined);
});
test('receipt discovery caps database hints at64 and caps simultaneous receipt reads at4',async()=>{
  const transfer=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
  let reads=0,active=0,peak=0;
  const rows=Array.from({length:300},()=>({account_address:wallet,collection_address:collection,
    transaction_hash:hash,completed_at:'2026-09-13T00:00:00Z'}));
  const result=await discoverCollectionReceipts({tokenId:'93',account:wallet,pool:{query:async()=>({rows})},
    client:{getTransactionReceipt:async()=>{reads++;active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;
      return {status:'success',transactionHash:hash,logs:[{address:collection,data:'0x',topics:encodeEventTopics({
        abi:transfer,eventName:'Transfer',args:{from:'0x'+'0'.repeat(40),to:wallet,tokenId:42n}})}]};}}});
  assert.equal(reads,64);assert.equal(peak,4);assert.equal(active,0);assert.equal(result.candidates.length,64);
});
