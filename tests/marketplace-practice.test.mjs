import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { recoverPracticeTransaction, startMarketplacePractice } from '../scripts/dev/marketplace/practice-server.mjs';
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const owner=address('1'),target=address('2'),txHash=hash('3'),blockHash=hash('4');
const claim={from:owner,to:target,data:'0x1234',value:'0',nonce:'7',fromBlock:'99'};
const transaction={from:owner,to:target,input:'0x1234',value:0n,nonce:7,hash:txHash,blockNumber:100n,blockHash};
function recoveryFixture(){let asserted=0,read=[];const client={getBlockNumber:async()=>100n,getBlock:async request=>{read.push(request);return {number:100n,hash:blockHash,transactions:[transaction]};},getTransactionCount:async()=>7};return {client,claim,assertDisposable:async()=>{asserted++;},read,get assertions(){return asserted;}};}
test('unknown local send recovers only original sender nonce and exact transaction',async()=>{const f=recoveryFixture();assert.equal(await recoverPracticeTransaction(f),txHash);assert.equal(f.assertions,1);assert.deepEqual(f.read,[{blockNumber:100n,includeTransactions:true}]);});
for(const [field,value] of [['to',address('8')],['input','0x5678'],['value',1n],['blockHash',hash('8')],['blockNumber',99n]])test(`original-nonce recovery rejects substituted ${field}`,async()=>{const f=recoveryFixture();f.client.getBlock=async()=>({number:100n,hash:blockHash,transactions:[{...transaction,[field]:value}]});await assert.rejects(recoverPracticeTransaction(f),/PRACTICE_NONCE_CONFLICT/);});
test('pending original nonce remains pending without any send',async()=>{const f=recoveryFixture();f.client.getBlock=async()=>({number:100n,hash:blockHash,transactions:[]});assert.equal(await recoverPracticeTransaction(f),null);});
test('already used nonce missing from bounded history fails closed',async()=>{const f=recoveryFixture();f.client.getBlock=async()=>({number:100n,hash:blockHash,transactions:[]});f.client.getTransactionCount=async()=>8;await assert.rejects(recoverPracticeTransaction(f),/PRACTICE_NONCE_CONFLICT/);});
test('recovery never scans public history or an unbounded local range',async()=>{const f=recoveryFixture();f.client.getBlockNumber=async()=>1000n;await assert.rejects(recoverPracticeTransaction(f),/PRACTICE_RECOVERY_LIMIT/);assert.equal(f.read.length,0);});
test('recovery refuses bare hashes where complete transactions are required',async()=>{const f=recoveryFixture();f.client.getBlock=async()=>({number:100n,hash:blockHash,transactions:[txHash]});await assert.rejects(recoverPracticeTransaction(f),/PRACTICE_RECONCILIATION_FAILED/);});
test('wrong owned-node assertion prevents all recovery reads',async()=>{const f=recoveryFixture();f.assertDisposable=async()=>{throw Error('NOT_OWNED');};await assert.rejects(recoverPracticeTransaction(f),/NOT_OWNED/);assert.equal(f.read.length,0);});

async function serverFixture(t,{failFirstRead=false}={}){
 let mines=0,balanceReads=0,release=null,started=null;
 const client={transport:{url:'http://127.0.0.1:45678'},getChainId:async()=>4663,
  request:async({method})=>{if(method==='web3_clientVersion')return 'anvil/test';assert.equal(method,'evm_mine');mines++;if(started){started();await new Promise(r=>{release=r;});}return '0x0';},
  getBalance:async()=>{if(failFirstRead&&balanceReads++===0)throw Error('secret https://provider.example/api/key');return 100n;},
  readContract:async()=>0n};
 const session=await startMarketplacePractice({client,owner,wallet:'0xcadcfd37e715bc031cf0cec7fa2335091c878c83',collection:address('5'),escrow:address('6'),deps:{disposableBidDeployment:{environment:'OWNED_DISPOSABLE_CHAIN',address:address('6')}},budget:{},makeListing:async()=>{throw Error('UNEXPECTED_FIXTURE_MUTATION');},sendReview:async()=>{throw Error('UNEXPECTED_SEND');},send:async()=>{throw Error('UNEXPECTED_SEND');},seller:address('7'),assertDisposable:async()=>{},anchor:{number:99n,hash:blockHash}});
 t.after(()=>session.close());
 const headers=async()=>{const state=await fetch(session.url+'/api/state').then(r=>r.json());return {'content-type':'application/json',origin:session.url,'x-practice-nonce':state.nonce};};
 return {...session,headers,get mines(){return mines;},blockMine:()=>new Promise(r=>{started=r;}),releaseMine:()=>{started=null;release?.();}};
}
test('practice API accepts only matching Host Origin nonce and exact action schema',async t=>{
 const f=await serverFixture(t),headers=await f.headers(),body=JSON.stringify({operation:'recheck',input:{}});
 const bad=[{headers:{...headers,origin:'https://attacker.example'},body},{headers:{...headers,'x-practice-nonce':'wrong'},body},
  {headers:{...headers,'content-type':'text/plain'},body},{headers,body:JSON.stringify({operation:'recheck',input:{rpc:'https://attacker.example'}})},
  {headers,body:JSON.stringify({operation:'eth_sendTransaction',input:{}})},{headers,body:JSON.stringify({operation:'prepare_purchase',input:{quantity:99}})},
  {headers,body:'x'.repeat(4097)},{headers,body:'{invalid'}];
 for(const [index,options] of bad.entries()){const r=await fetch(f.url+'/api/action',{method:'POST',...options});assert.equal(r.status,409,`rejected request index ${index}`);const x=await r.json();assert.equal(x.publicTransactions,0);assert.doesNotMatch(JSON.stringify(x),/attacker|provider|key|RPC/);}
 const spoof=await new Promise((resolve,reject)=>{const req=httpRequest(f.url+'/api/action',{method:'POST',headers:{...headers,host:'localhost:1'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(body);});assert.equal(spoof,409);
 const cross=await fetch(f.url+'/api/state',{headers:{origin:'https://attacker.example'}});assert.equal(cross.status,409);
 assert.equal(f.mines,0);
});
test('initial failed GET is sanitized and a later retry succeeds',async t=>{const f=await serverFixture(t,{failFirstRead:true});const first=await fetch(f.url+'/api/state');assert.equal(first.status,409);assert.doesNotMatch(await first.text(),/provider|secret|key/);const next=await fetch(f.url+'/api/state');assert.equal(next.status,200);assert.equal((await next.json()).localOnly,true);});
test('concurrent actions cannot claim the same operation twice',async t=>{const f=await serverFixture(t),headers=await f.headers(),body=JSON.stringify({operation:'recheck',input:{}});const entered=f.blockMine();const first=fetch(f.url+'/api/action',{method:'POST',headers,body});await entered;const second=await fetch(f.url+'/api/action',{method:'POST',headers,body});assert.equal(second.status,409);assert.equal((await second.json()).code,'PRACTICE_BUSY');f.releaseMine();assert.equal((await first).status,200);assert.equal(f.mines,1);});
test('no alternate API endpoint forwards transactions or raw RPC',async t=>{const f=await serverFixture(t),headers=await f.headers();for(const path of ['/rpc','/api/send','/api/action?method=eth_sendTransaction']){const response=await fetch(f.url+path,{method:'POST',headers,body:'{}'});assert.equal(response.status,409);}assert.equal(f.mines,0);});
