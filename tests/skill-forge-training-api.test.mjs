import assert from 'node:assert/strict';
import test from 'node:test';
import { handleForgeTraining } from '../netlify/functions/broker-v2-forge-training.mjs';
import { runForgeTrainingReconciliation } from '../netlify/functions/broker-forge-training-reconcile.mjs';
import { validateTrainingRelease } from '../broker/src/v4/skill-forge/training-release.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import artifact from '../deployments/robinhood-forge-training.json' with {type:'json'};
const OWNER=`0x${'1'.repeat(40)}`,HASH=`0x${'a'.repeat(64)}`;
const request=(body,method='POST',query='')=>new Request(`https://goghpunks.xyz/api/v2/punks/93/forge/training${query}`,{
  method,...(method==='POST'?{headers:{'content-type':'application/json',origin:'https://goghpunks.xyz'},body:JSON.stringify(body)}:{})});
function fixture(){const calls=[];const record={intentId:'11111111-1111-4111-8111-111111111111'};
  const deps={releaseReader:()=>({status:'OWNER_CANARY',allowedOwners:[OWNER]}),sessionPool:()=>null,
    sessionReader:async()=>({walletAddress:OWNER}),originCheck:()=>{calls.push('origin');},runtimeFactory:async()=>({coordinator:{
      get:async identity=>{calls.push(['get',identity]);return {record,held:true};},
      prepare:async input=>{calls.push(['prepare',input]);return {record};},
      claim:async(...args)=>{calls.push(['claim',...args]);return {claimed:false,record};},
      mutate:async(...args)=>{calls.push(['mutate',...args]);return record;},
    }})};return {calls,deps,record};}
test('unreleased production route and scheduled worker never open databases or clients',async()=>{
  const runtimeFactory=()=>{throw Error('MUST_NOT_RUN');};
  const response=await handleForgeTraining(request({},'GET'),{runtimeFactory,sessionPool:runtimeFactory});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'FORGE_TRAINING_NOT_RELEASED');
  assert.equal((await runForgeTrainingReconciliation({runtimeFactory})).skipped,true);
});
test('release flags alone cannot enable training and local fixtures cannot become production artifacts',()=>{
  assert.equal(validateTrainingRelease(artifact).status,'UNDEPLOYED');
  for(const change of [{productionTrainingAuthorized:true},{productionBurnAuthorized:true},{status:'OWNER_CANARY'},
    {chainId:31337},{allocationRoot:HASH},{registry:OWNER},{allowedOwners:[OWNER]},{status:'READY'}])assert.throws(()=>validateTrainingRelease({...artifact,...change}));
});
test('prepare takes its owner/token from the session and path and performs the origin check',async()=>{
  const f=fixture(),body={operation:'prepare',action:{operation:'equip',skillKey:HASH,slot:0},requestKey:'a'.repeat(64)};
  assert.equal((await handleForgeTraining(request(body),f.deps)).status,200);
  assert.equal(f.calls[0],'origin');assert.deepEqual(f.calls[1],['prepare',{owner:OWNER,tokenId:'93',action:body.action,requestKey:body.requestKey}]);
});
test('claim/recovery expose no arbitrary transaction or settlement write',async()=>{
  const f=fixture();
  const response=await handleForgeTraining(request({operation:'recover',intentId:f.record.intentId,revision:1,transactionHash:HASH}),f.deps);
  assert.equal(response.status,200);assert.deepEqual(f.calls[1],['mutate',{owner:OWNER,tokenId:'93',intentId:f.record.intentId},'recover',1,HASH]);
  for(const body of [{operation:'settle',settlement:{}},{operation:'claim',intentId:f.record.intentId,revision:0,reviewHash:'a'.repeat(64),owner:OWNER},
    {operation:'recover',intentId:f.record.intentId,revision:1,transactionHash:HASH,transaction:{to:OWNER}}]){
    assert.equal((await handleForgeTraining(request(body),f.deps)).status,400);
  }
});
test('authentication, owner allowlist and origin failures do not reach the coordinator',async()=>{
  for(const mutate of [f=>{f.deps.sessionReader=async()=>{throw new PublicError(401,'V2_SESSION_REQUIRED','Sign in.');};},
    f=>{f.deps.sessionReader=async()=>({walletAddress:`0x${'2'.repeat(40)}`});},
    f=>{f.deps.originCheck=()=>{throw new PublicError(403,'ORIGIN_REJECTED','Origin rejected.');};}]){
    const f=fixture();mutate(f);const response=await handleForgeTraining(request({}),f.deps);
    assert.ok([401,403].includes(response.status));assert.equal(f.calls.filter(Array.isArray).length,0);
  }
});
test('GET scopes the private intent and rejects owner or proof query overrides',async()=>{
  const f=fixture();assert.equal((await handleForgeTraining(request(null,'GET',`?intentId=${f.record.intentId}`),f.deps)).status,200);
  assert.deepEqual(f.calls[0],['get',{owner:OWNER,tokenId:'93',intentId:f.record.intentId}]);
  for(const query of ['?owner=other','?settlement=proof','?intentId=a&intentId=b'])assert.equal((await handleForgeTraining(request(null,'GET',query),f.deps)).status,400);
});
test('coordinator failures return recovery guidance without private driver errors or false submission claims',async()=>{
  const f=fixture();f.deps.runtimeFactory=async()=>{throw Error('SECRET_DATABASE_CONNECTION_STRING');};
  const response=await handleForgeTraining(request(null,'GET'),f.deps);assert.equal(response.status,503);
  const body=await response.text();assert.doesNotMatch(body,/SECRET_DATABASE|nothing was submitted/i);assert.match(body,/Recover any pending review/);
});
