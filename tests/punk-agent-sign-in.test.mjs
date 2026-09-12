import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {prepareV2Session,completeV2Session} from '../netlify/functions/_shared/v2-session.mjs';
import {requireV2SessionOrigin} from '../netlify/functions/broker-v2-session.mjs';
import {parseSiweMessage} from 'viem/siwe';
const source=await readFile(new URL('../site/broker-v2.js',import.meta.url),'utf8');
const owner=`0x${'1'.repeat(40)}`;
const unauthorized=()=>Object.assign(Error('Sign in with your wallet.'),{code:'V2_SESSION_REQUIRED'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(overrides={}) {
  const state={selected:{tokenId:'93'},punks:[{tokenId:'93'}],wallet:{account:owner,chainId:4663},
    agentAccounts:new Map(),agentAccountLoading:new Map()};
  const context=vm.createContext({PREVIEW:false,CHAIN_ID:4663,state,Promise,
    renderAgentAccount(){},renderReviewAgent(){},renderMissionMonitor(){},renderWelcomeMessage(){},
    jsonRequest:async()=>({readiness:{setupAvailable:true}}),ensureV2Session:async()=>{},...overrides});
  vm.runInContext(source.slice(source.indexOf('async function loadAgentAccountStatus('),source.indexOf('\nfunction renderAgentAccount(')),context);
  return context;
}
test('sign-in supersedes a background read and a late 401 cannot relock autonomy',async()=>{
  const old=deferred();let reads=0,signIns=0;
  const f=fixture({jsonRequest:()=>++reads===1?old.promise:Promise.resolve({readiness:{setupAvailable:true}}),ensureV2Session:async()=>{signIns++;}});
  const background=f.loadAgentAccountStatus();await Promise.resolve();
  const fresh=await f.loadAgentAccountStatus({authenticate:true});
  assert.equal(signIns,1);assert.equal(fresh.readiness.setupAvailable,true);
  old.reject(unauthorized());await background;
  assert.equal(f.state.agentAccounts.get('93'),fresh);
});
test('repeated sign-in and background callers await the authenticated request',async()=>{
  const login=deferred();let signIns=0;
  const f=fixture({ensureV2Session:()=>{signIns++;return login.promise;}});
  const calls=[f.loadAgentAccountStatus({authenticate:true}),f.loadAgentAccountStatus({authenticate:true}),f.loadAgentAccountStatus()];
  await Promise.resolve();assert.equal(signIns,1);login.resolve();
  const values=await Promise.all(calls);assert.ok(values.every(v=>v===values[0]));
});
test('an old owner response cannot restore cleared mission state',async()=>{
  const read=deferred(),f=fixture({jsonRequest:()=>read.promise});
  const pending=f.loadAgentAccountStatus();await Promise.resolve();
  f.state.wallet.account=`0x${'2'.repeat(40)}`;f.state.agentAccounts.clear();f.state.agentAccountLoading.clear();
  read.resolve({mission:{status:'ACTIVE'}});assert.equal(await pending,null);assert.equal(f.state.agentAccounts.size,0);
});
function sessionFixture(request,provider) {
  const state={wallet:{account:owner,chainId:4663}};
  const context=vm.createContext({PREVIEW:false,CHAIN_ID:4663,state,jsonRequest:request,
    window:{__GOGH_WALLET_PROVIDER__:{request:provider}}});
  vm.runInContext(source.slice(source.indexOf('async function ensureV2Session('),source.indexOf('\nasync function activatePunkAgentMission(')),context);
  return context;
}
test('sign-in verifies the cookie before returning and sends no transaction',async()=>{
  const methods=[];let reads=0;
  const f=sessionFixture(async(path,options)=>{
    assert.equal(path,'/api/v2/session');
    if(!options){if(++reads===1)throw unauthorized();return {walletAddress:owner};}
    const body=JSON.parse(options.body);
    if(body.action==='prepare')return {challenge:{message:'Login only',challengeId:'fixture'}};
    assert.equal(body.action,'complete');return {walletAddress:owner};
  },async({method,params})=>{methods.push(method);assert.equal(params[1],owner);return '0xfixture';});
  assert.equal((await f.ensureV2Session()).walletAddress,owner);assert.equal(reads,2);assert.deepEqual(methods,['personal_sign']);
});
test('service failure does not cause a wallet prompt; owner change stops before signing',async()=>{
  let prompts=0;
  const f=sessionFixture(async()=>{throw Object.assign(Error('Service unavailable'),{code:'SERVICE_NOT_CONFIGURED'});},async()=>{prompts++;});
  await assert.rejects(f.ensureV2Session(),/Service unavailable/);assert.equal(prompts,0);
  f.jsonRequest=async(path,options)=>{if(!options)throw unauthorized();f.state.wallet.account=null;return {challenge:{message:'Login'}};};
  await assert.rejects(f.ensureV2Session(),/current owner/);assert.equal(prompts,0);
});
test('a blocked cookie is not reported as a successful sign-in',async()=>{
  const f=sessionFixture(async(path,options)=>{
    if(!options)throw unauthorized();return JSON.parse(options.body).action==='prepare'?{challenge:{message:'Login',challengeId:'fixture'}}:{walletAddress:owner};
  },async()=> '0xfixture');
  await assert.rejects(f.ensureV2Session(),{code:'V2_SESSION_REQUIRED'});
});
for(const origin of ['https://goghpunks.xyz','https://deploy-preview-47.preview.goghpunks.xyz','https://deploy-preview-47--gogh-punks.netlify.app'])test(`login message names the requesting host: ${origin}`,async()=>{
  process.env.SITE_URL='https://goghpunks.xyz';
  const request=new Request(`${origin}/api/v2/session`,{method:'POST',headers:{origin}});
  const approved=requireV2SessionOrigin(request),now=new Date();let row;
  const challenge=await prepareV2Session({query:async(sql,args)=>{row=args;}},owner,now,approved);
  const message=parseSiweMessage(challenge.message);assert.equal(message.domain,new URL(origin).host);assert.equal(message.uri,`${origin}/broker/v2/`);
  const queries=[],client={release(){},query:async sql=>{queries.push(sql);return {rows:sql.startsWith('SELECT')?[{wallet_address:owner,message:row[2],expires_at:row[3],purpose:'SESSION'}]:[]};}};
  await assert.rejects(completeV2Session({connect:async()=>client},{walletAddress:owner,challengeId:challenge.challengeId,signature:`0x${'1'.repeat(130)}`},now,'https://deploy-preview-48.preview.goghpunks.xyz'),{code:'SESSION_ORIGIN_MISMATCH'});
  assert.ok(queries.includes('ROLLBACK'));assert.equal(queries.some(sql=>sql.startsWith('INSERT INTO broker_v2_sessions')),false);
});
