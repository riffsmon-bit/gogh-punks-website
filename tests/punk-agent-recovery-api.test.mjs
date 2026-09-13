import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAgentRecovery, config} from '../netlify/functions/broker-v2-agent-account-recovery.mjs';
import {PublicError} from '../netlify/functions/_shared/http.mjs';
const priorSiteUrl = process.env.SITE_URL;
test.before(() => { process.env.SITE_URL = 'https://goghpunks.xyz'; });
test.after(() => { if (priorSiteUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = priorSiteUrl; });
const OWNER=`0x${'1'.repeat(40)}`, OTHER=`0x${'2'.repeat(40)}`;
const intent={schema:'GOGH_AGENT_RECOVERY_INTENT_V1',tokenId:'93',action:'NATIVE',amountWei:'100',assetContract:null,assetTokenId:null};
const request=(body={intent},origin='https://goghpunks.xyz',method='POST')=>new Request('https://goghpunks.xyz/api/v2/agent-account/recovery',{
  method,headers:{origin,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function fixture(){const f={authorizations:0,prepared:[]};f.dependencies={pool:{},client:{},now:()=>1789308000000,
  requireSession:async()=>{f.authorizations++;return {walletAddress:OWNER};},prepare:async value=>{f.prepared.push(value);return {fixture:'review'};}};return f;}
test('recovery endpoint derives owner from authentication and never returns submitted authority',async()=>{
  const f=fixture(),response=await handleAgentRecovery(request(),f.dependencies),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.transactionSubmitted,false);
  assert.equal(f.authorizations,1);assert.equal(f.prepared[0].owner,OWNER);assert.deepEqual(f.prepared[0].intent,intent);
  assert.equal(config.path,'/api/v2/agent-account/recovery');
});
for(const body of [{intent,owner:OTHER},{intent,transaction:{to:OTHER}},{intent:{...intent,destination:OTHER}},
  {intent:{...intent,action:'ARBITRARY'}},{intent:{...intent,tokenId:'093'}},[],null])test(`malformed request cannot reach preparation: ${JSON.stringify(body)}`,async()=>{
  const f=fixture(),response=await handleAgentRecovery(request(body),f.dependencies);
  assert.equal(response.status,400);assert.equal(f.prepared.length,0);
});
test('missing session rejects preparation',async()=>{
  const f=fixture();f.dependencies.requireSession=async()=>{throw new PublicError(401,'SESSION_REQUIRED','Sign in.');};
  const response=await handleAgentRecovery(request(),f.dependencies);assert.equal(response.status,401);assert.equal(f.prepared.length,0);
});
test('cross-origin requests and wrong method cannot read authority or prepare transactions',async()=>{
  const f=fixture();assert.equal((await handleAgentRecovery(request({intent},'https://evil.example'),f.dependencies)).status,403);
  assert.equal((await handleAgentRecovery(request({},'https://goghpunks.xyz','GET'),f.dependencies)).status,405);
  assert.equal(f.authorizations,0);assert.equal(f.prepared.length,0);
});
test('current owner changes and recall requirements have safe bounded error responses',async()=>{
  for(const code of ['OWNER_CHANGED','AGENT_RECOVERY_RECALL_REQUIRED']){
    const f=fixture();f.dependencies.prepare=async()=>{throw Object.assign(Error('https://rpc.example/PRIVATE_KEY'),{code});};
    const response=await handleAgentRecovery(request(),f.dependencies),body=await response.json();
    assert.equal(response.status,409);assert.match(body.code,/^AGENT_RECOVERY_/);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_KEY/);
  }
});
test('unexpected provider errors expose neither URLs nor credentials',async()=>{
  const f=fixture();f.dependencies.prepare=async()=>{throw Object.assign(Error('https://rpc.example/SECRET'),{code:'SECRET'});};
  const response=await handleAgentRecovery(request(),f.dependencies),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,'AGENT_RECOVERY_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(body),/SECRET/);
});
