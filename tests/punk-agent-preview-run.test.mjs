import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleV2AgentAccountRun} from '../netlify/functions/broker-v2-agent-account-run.mjs';
import {runScheduledPunkAgentWorker} from '../netlify/functions/broker-punk-agent-worker.mjs';
import {defaultAskIntent,punkCollectingIntentHash} from '../broker/src/v4/collecting-intent.mjs';
import {ROBINHOOD} from '../broker/src/config.mjs';
import {PublicError} from '../netlify/functions/_shared/http.mjs';
const owner=`0x${'1'.repeat(40)}`,other=`0x${'2'.repeat(40)}`,account=`0x${'3'.repeat(40)}`;
const hash=`0x${'a'.repeat(64)}`,origin='https://deploy-preview-47.preview.goghpunks.xyz';
const now=new Date('2026-09-11T22:00:00Z');
const environment={CONTEXT:'deploy-preview',PUNK_AGENT_PREVIEW_RUN_ENABLED:'true',PUNK_AGENT_WORKER_ENABLED:'true',ENABLE_PREVIEW_BACKGROUND_RPC:'true',BACKGROUND_RPC_ALLOWED_TASKS:'PUNK_AGENT_WORKER'};
let db,pool,sessions,runs,authOwner,liveOwner;
before(async()=>{
 db=new PGlite();
 for(const file of ['20260817224000_create_art_broker_foundation.sql','20260906010000_create_art_broker_v2.sql','20260907010000_add_punk_agent_accounts.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
 pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
});
after(async()=>{await db?.close();});
async function seed(tokenId,wallet){
 const punkAccount=tokenId==='93'?account:`0x${'4'.repeat(40)}`;
 const intent={...defaultAskIntent({punkTokenId:tokenId,expectedOwner:wallet,punkWallet:punkAccount},now),operatingMode:'AUTONOMOUS'};
 const intentHash=punkCollectingIntentHash(intent,now);
 await db.query('INSERT INTO broker_punks (chain_id,collection_address,token_id,account_address,account_version,owner_snapshot) VALUES (4663,$1,$2,$3,3,$4)',[ROBINHOOD.canonicalCollection,tokenId,punkAccount,wallet]);
 await db.query(`INSERT INTO broker_v2_strategies (chain_id,collection_address,token_id,version,schema_name,intent_hash,intent,state,configured_by,ownership_block,expires_at,owner_confirmation_hash,activated_at)
 VALUES (4663,$1,$2,1,'PUNK_COLLECTING_INTENT_V1',$3,$4,'ACTIVE',$5,100,$6,$3,NOW())`,[ROBINHOOD.canonicalCollection,tokenId,intentHash,JSON.stringify(intent),wallet,intent.expiration]);
 return (await db.query(`INSERT INTO broker_v2_agent_sessions
 (chain_id,collection_address,punk_token_id,punk_account,owner_snapshot,strategy_version,strategy_hash,session_key,session_generation,adapter_address,venue_address,adapter_code_hash,target_collection,max_mints_per_day,max_mints_total,max_gas_cost_wei,minimum_native_reserve_wei,valid_after,valid_until,status,setup_artifact_hash,authorization_transaction_hash,activated_at)
 VALUES (4663,$1,$2,$3,$4,1,$5,$3,1,$3,$3,$6,$3,1,1,500000000000000,0,$7,$8,'ACTIVE',$6,$9,$7) RETURNING session_id`,[ROBINHOOD.canonicalCollection,tokenId,punkAccount,wallet,intentHash,hash,new Date(now.getTime()-60000).toISOString(),new Date(now.getTime()+300000).toISOString(),`0x${tokenId.padStart(64,'0')}`])).rows[0].session_id;
}
beforeEach(async()=>{
 await db.exec('TRUNCATE broker_punks, broker_v2_opportunities CASCADE; TRUNCATE broker_v2_activity CASCADE;');
 sessions={};sessions['93']=await seed('93',owner);sessions['94']=await seed('94',other);
 runs=0;authOwner=owner;liveOwner=owner;
});
function request(body={sessionId:sessions['93']},options={}){return new Request((options.origin??origin)+'/api/v2/punks/93/agent-account/run',{method:options.method??'POST',headers:{origin:options.headerOrigin??options.origin??origin,'content-type':'application/json'},...(options.method==='GET'?{}:{body:JSON.stringify(body)})});}
async function invoke(req=request(),extras={}){return handleV2AgentAccountRun(req,{pool,environment,now,
 requireSession:async()=>{if(!authOwner)throw new PublicError(401,'V2_SESSION_REQUIRED','Sign in.');return {walletAddress:authOwner};},
 readAuthority:async(tokenId,{expectedOwner})=>{assert.equal(tokenId,'93');if(expectedOwner!==liveOwner)throw new PublicError(403,'NOT_CURRENT_OWNER','Owner changed.');return {owner:liveOwner,punkWallet:account};},
 run:async options=>{runs++;return runScheduledPunkAgentWorker({...options,client:{getGasPrice:async()=>1n},bundler:{},signer:{},runMission:async({loadMission})=>{
 const mission=await loadMission();assert.equal(mission.tokenId,'93');assert.equal(mission.owner,owner);assert.equal(mission.sessionId,sessions['93']);return {status:'NO_ELIGIBLE_MATCH',submitted:false,tokenId:mission.tokenId};}});},...extras});}
test('owner button runs the real SQL worker selection for only its approved session',async()=>{
 const response=await invoke(),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(body.status,'NO_ELIGIBLE_MATCH');assert.equal(body.submitted,false);assert.equal(runs,1);
 const rows=(await db.query('SELECT punk_token_id,activity_type FROM broker_v2_activity')).rows;
 assert.deepEqual(rows,[{punk_token_id:'93',activity_type:'AGENT_SCOUTED'}]);
});
for(const scenario of ['signed_out','wrong_owner','transferred','other_session','revoked','expired','disabled','cross_origin','production','get','forged_owner'])test(`${scenario} cannot run a mission`,async()=>{
 let req=request(),extras={};
 if(scenario==='signed_out')authOwner=null;
 if(scenario==='wrong_owner')authOwner=other;
 if(scenario==='transferred')liveOwner=other;
 if(scenario==='other_session')req=request({sessionId:sessions['94']});
 if(scenario==='revoked')await db.query("UPDATE broker_v2_agent_sessions SET status='REVOKED' WHERE session_id=$1",[sessions['93']]);
 if(scenario==='expired')await db.query('UPDATE broker_v2_agent_sessions SET valid_until=$1 WHERE session_id=$2',[new Date(now.getTime()-1000).toISOString(),sessions['93']]);
 if(scenario==='disabled')extras.environment={};
 if(scenario==='cross_origin')req=request(undefined,{headerOrigin:'https://attacker.example'});
 if(scenario==='production')req=request(undefined,{origin:'https://goghpunks.xyz'});
 if(scenario==='get')req=request(undefined,{method:'GET'});
 if(scenario==='forged_owner')req=request({sessionId:sessions['93'],owner});
 const response=await invoke(req,extras);assert.ok(response.status>=400,String(response.status));assert.equal(runs,0);
 assert.equal((await db.query('SELECT * FROM broker_v2_activity')).rows.length,0);
});
test('worker rechecks scope after the endpoint check and never selects a different active mission',async()=>{
 for(const missionScope of [{tokenId:'93',owner:other,sessionId:sessions['93']},{tokenId:'94',owner,sessionId:sessions['93']},{tokenId:'93',owner,sessionId:sessions['94']}]){
 const result=await runScheduledPunkAgentWorker({pool,environment,now,missionScope,client:{getGasPrice:async()=>1n},bundler:{},signer:{},runMission:async({loadMission})=>{assert.equal(await loadMission(),null);return {status:'IDLE',submitted:false};}});
 assert.equal(result.status,'IDLE');
 }
 await assert.rejects(runScheduledPunkAgentWorker({pool,environment,missionScope:{tokenId:'93'}}),/Invalid mission scope/);
});
async function pendingOperation(tokenId){
 const punkAccount=tokenId==='93'?account:`0x${'4'.repeat(40)}`,wallet=tokenId==='93'?owner:other;
 const key=tokenId.padStart(64,'0'),opportunityId=`pending:${tokenId}`,operationHash=`0x${key}`;
 await db.query(`INSERT INTO broker_v2_opportunities (opportunity_id,dedupe_key,chain_id,collection_contract,mint_contract,adapter_address,mint_stage,normalized,screening_status,simulation_status,risk_score,first_seen_at)
 VALUES ($1,$2,4663,$3,$3,$3,'PUBLIC','{}','PASSED','PASSED',0,$4)`,[opportunityId,key,punkAccount,now.toISOString()]);
 const attempt=(await db.query(`INSERT INTO broker_v2_execution_attempts
 (idempotency_key,chain_id,punk_token_id,punk_account,owner_snapshot,opportunity_id,strategy_version,strategy_hash,account_nonce,operating_mode,state)
 VALUES ($1,4663,$2,$3,$4,$5,1,$6,0,'AUTONOMOUS','RECONCILIATION_REQUIRED') RETURNING attempt_id`,[key,tokenId,punkAccount,wallet,opportunityId,hash])).rows[0].attempt_id;
 await db.query(`INSERT INTO broker_v2_agent_user_operations
 (session_id,attempt_id,user_operation_hash,opportunity_id,opportunity_hash,account_nonce,session_generation,call_data_hash,maximum_gas_cost_wei,screening_input_hash,simulation_input_hash,expected_collection,expected_token_id,state,signed_at,submitted_at)
 VALUES ($1,$2,$3,$4,$3,0,1,$3,1000,'screen','sim',$5,1,'SUBMITTED',$6,$6)`,[sessions[tokenId],attempt,operationHash,opportunityId,punkAccount,now.toISOString()]);
 return operationHash;
}
test('scoped reconciliation ignores another Punk and waits for its own pending operation without resubmitting',async()=>{
 await pendingOperation('94');
 let missionReads=0,receiptReads=0;
 const options={pool,environment,now,missionScope:{tokenId:'93',owner,sessionId:sessions['93']},client:{getGasPrice:async()=>1n},signer:{},
 bundler:{request:async()=>{throw Error('Must not read another Punk receipt');}},runMission:async({loadMission})=>{missionReads++;assert.equal((await loadMission()).tokenId,'93');return {status:'NO_ELIGIBLE_MATCH',tokenId:'93',submitted:false};}};
 assert.equal((await runScheduledPunkAgentWorker(options)).status,'NO_ELIGIBLE_MATCH');
 const ownHash=await pendingOperation('93');
 const result=await runScheduledPunkAgentWorker({...options,bundler:{request:async({method,params})=>{receiptReads++;assert.equal(method,'eth_getUserOperationReceipt');assert.deepEqual(params,[ownHash]);return null;}}});
 assert.equal(result.status,'RECONCILIATION_PENDING');assert.equal(result.submitted,false);
 assert.equal(missionReads,1);assert.equal(receiptReads,1);
 assert.equal((await db.query("SELECT * FROM broker_v2_agent_user_operations WHERE state='SUBMITTED'")).rows.length,2);
});
