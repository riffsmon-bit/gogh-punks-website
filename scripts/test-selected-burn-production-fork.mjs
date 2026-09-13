import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {tmpdir,userInfo} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:net';
import pg from 'pg';import {createPublicClient,http} from 'viem';
import release from '../deployments/robinhood-forge-training.json' with {type:'json'};
import {createSelectedBurnStore} from '../broker/src/v4/skill-forge/selected-burn-store.mjs';
import {createSelectedBurnCoordinator} from '../broker/src/v4/skill-forge/selected-burn-coordinator.mjs';
import {SELECTED_BURN_OWNER} from '../broker/src/v4/skill-forge/selected-burn-source.mjs';
import {validateSelectedBurnEnvelope} from '../site/forge-selected-burn-wallet.js';
if(process.argv.length!==4||process.argv[2]!=='--disposable-only'||!process.argv[3].startsWith('--postgres-bin=/'))throw Error('Requires --disposable-only --postgres-bin=/absolute/path');
const bin=process.argv[3].slice('--postgres-bin='.length),run=promisify(execFile);
const dir=await mkdtemp(join(tmpdir(),'gogh-selected-burn-test-')),data=join(dir,'data');
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const [dbPort,chainPort]=await Promise.all([port(),port()]);
const command=(name,args)=>run(join(bin,name),args,{timeout:60000,maxBuffer:100000});
let started=false,child,admin,requestPool,browserPool;
try {
 await command('initdb',['-D',data,'--no-locale','-E','UTF8','--auth=trust']);
 await command('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} -k ${dir}`,'-w','start']);started=true;
 const settings={host:'127.0.0.1',port:dbPort,database:'postgres',max:3,connectionTimeoutMillis:5000};
 admin=new pg.Pool({...settings,user:userInfo().username});
 await admin.query(await readFile(new URL('../netlify/database/migrations/20260913040000_stage_selected_burn_reviews.sql',import.meta.url),'utf8'));
 await admin.query('CREATE ROLE forge_request LOGIN; CREATE ROLE anon LOGIN; CREATE ROLE authenticated; CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO forge_request;');
 await admin.query(await readFile(new URL('../netlify/database/review/selected-burn-roles.sql',import.meta.url),'utf8'));
 requestPool=new pg.Pool({...settings,user:'forge_request'});browserPool=new pg.Pool({...settings,user:'anon'});
 await assert.rejects(browserPool.query('SELECT * FROM broker_selected_burn_reviews'),e=>e.code==='42501');
 await assert.rejects(requestPool.query('DELETE FROM broker_selected_burn_reviews'),e=>e.code==='42501');
 await assert.rejects(requestPool.query('INSERT INTO broker_selected_burn_events(intent_id,revision,status) VALUES ($1,0,$2)',['a'.repeat(64),'CONFIRMED']),e=>e.code==='42501');
 const pub=createPublicClient({cacheTime:0,transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:12000,retryCount:0})});
 const anchor=await pub.getBlock();
 child=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(chainPort),'--chain-id','4663','--fork-url','https://rpc.mainnet.chain.robinhood.com','--fork-block-number',String(anchor.number)],{stdio:'ignore'});
 let startupError;child.once('error',e=>{startupError=e;});
 const clients=[0,1].map(()=>createPublicClient({cacheTime:0,transport:http(`http://127.0.0.1:${chainPort}`,{timeout:20000,retryCount:0})})),c=clients[0];
 for(let i=0;i<80;i++){if(startupError||child.exitCode!==null)throw Error('OWNED_FORK_START_FAILED');try{if(await c.getChainId()===4663)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.match(await c.request({method:'web3_clientVersion'}),/anvil/i);assert.equal((await c.getBlock({blockNumber:anchor.number})).hash,anchor.hash);
 await c.request({method:'anvil_impersonateAccount',params:[SELECTED_BURN_OWNER]});
 let at=Number((await c.getBlock()).timestamp)*1000,checks=0;
 const sourceEvidence={scope:'DISPOSABLE_FORK_FIXTURE',clear:true};
 const store=createSelectedBurnStore(requestPool,SELECTED_BURN_OWNER,'1753');
 const options={clients,release,store,now:()=>at,checkSource:async()=>{checks++;return sourceEvidence;}};
 const selected={owner:SELECTED_BURN_OWNER,tokenId:'93',chainId:4663,preview:false};
 const envelope=result=>({ok:true,mode:'SELECTED_OWNER_BURN',owner:SELECTED_BURN_OWNER,chainId:4663,sourceTokenId:'1753',targetTokenId:'93',...result});
 const rejectedCoordinator=createSelectedBurnCoordinator(options);
 const rejected=(await rejectedCoordinator.prepare('ENABLE_FORGE')).record;
 const claimedReject=await rejectedCoordinator.claim({intentId:rejected.review.intentId,revision:rejected.revision,reviewHash:rejected.reviewHash,confirmation:'',obligationsReviewed:false});
 await assert.rejects(rejectedCoordinator.decline({intentId:rejected.review.intentId,revision:claimedReject.record.revision,rejectionCode:4002}),/BURN_JOURNAL_CHANGED/);
 const declined=await rejectedCoordinator.decline({intentId:rejected.review.intentId,revision:claimedReject.record.revision,rejectionCode:4001});
 assert.equal(declined.record.status,'DECLINED');
 const completed=[];
 for(const action of ['ENABLE_FORGE','APPROVE','BURN']){
  at=Number((await c.getBlock()).timestamp)*1000;let coordinator=createSelectedBurnCoordinator(options);
  const prepared=await coordinator.prepare(action),r=prepared.record;validateSelectedBurnEnvelope(envelope(prepared),selected,release);
  await assert.rejects(coordinator.prepare(action),/RECOVER_EXISTING_BURN_REVIEW/);
  if(action==='BURN')await assert.rejects(coordinator.claim({intentId:r.review.intentId,revision:r.revision,reviewHash:r.reviewHash,confirmation:'BURN 93',obligationsReviewed:true}),/BURN_CONFIRMATION_REQUIRED/);
  if(action!=='ENABLE_FORGE')await assert.rejects(coordinator.claim({intentId:r.review.intentId,revision:r.revision,reviewHash:r.reviewHash,confirmation:'BURN 1753',obligationsReviewed:false}),/BURN_OWNER_REVIEW_REQUIRED/);
  const input={intentId:r.review.intentId,revision:r.revision,reviewHash:r.reviewHash,confirmation:'BURN 1753',obligationsReviewed:true};
  const claims=await Promise.allSettled([coordinator.claim(input),coordinator.claim(input)]);
  assert.equal(claims.filter(v=>v.status==='fulfilled').length,1);const claimed=claims.find(v=>v.status==='fulfilled').value;
  validateSelectedBurnEnvelope(envelope(claimed),selected,release);
  // Recreate the service after the claim, as on another serverless instance.
  coordinator=createSelectedBurnCoordinator({...options,store:createSelectedBurnStore(requestPool,SELECTED_BURN_OWNER,'1753')});
  await assert.rejects(coordinator.claim(input),/BURN_JOURNAL_CHANGED/);
  await assert.rejects(coordinator.cancel({intentId:r.review.intentId,revision:claimed.record.revision}),/BURN_JOURNAL_CHANGED/);
  const hash=await c.request({method:'eth_sendTransaction',params:[claimed.transaction]});
  await c.request({method:'anvil_mine',params:['0xc','0x1']});
  const originalReceipt=c.getTransactionReceipt;
  c.getTransactionReceipt=async()=>{const e=Error('NOT_VISIBLE');e.name='TransactionReceiptNotFoundError';throw e;};
  const pending=await coordinator.recover({intentId:r.review.intentId,revision:claimed.record.revision,transactionHash:hash});
  assert.equal(pending.pending,true);assert.equal(pending.record.reportedHash,hash);assert.equal(pending.record.status,'WALLET_REQUESTED');
  c.getTransactionReceipt=originalReceipt;
  const recovered=await coordinator.recover({intentId:r.review.intentId,revision:pending.record.revision,transactionHash:hash});
  assert.equal(recovered.record.status,'CONFIRMED');assert.equal(recovered.record.receipt.verifiedProviders,2);
  await assert.rejects(coordinator.recover({intentId:r.review.intentId,revision:recovered.record.revision,transactionHash:hash}),/BURN_JOURNAL_CHANGED/);
  completed.push({action,receipt:recovered.record.receipt});
 }
 at=Number((await c.getBlock()).timestamp)*1000;const after=await createSelectedBurnCoordinator(options).get();
 assert.equal(after.state.credited,true);assert.equal(after.state.credits,'1');assert.ok(checks>=4);
 const events=(await admin.query('SELECT count(*)::int AS n FROM broker_selected_burn_events')).rows[0].n;assert.equal(events,15);
 await assert.rejects(requestPool.query("UPDATE broker_selected_burn_reviews SET review_json='{}'"),e=>e.code==='42501');
 const result={status:'PASS',environment:'DISPOSABLE_POSTGRES_AND_ANVIL_FORK',publicAnchor:{number:String(anchor.number),hash:anchor.hash},
  realDeployedContracts:true,sourceChecks:'MOCKED_IN_FORK_SEE_FRESH_SOURCE_CHECK_FOR_LIVE_EVIDENCE',source:'1753',recipient:'93',steps:completed.map(v=>({action:v.action,status:v.receipt.status})),
  creditsGained:1,concurrentClaimWinner:1,persistedHashDuringProviderLag:true,recreatedServerRecovery:true,browserDatabaseDenied:true,auditEvents:events,publicTransactions:0};
 await writeFile(new URL('../docs/review/2026-09-12/selected-launch/production-burn-integration-fork.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({status:'FAILED',type:e.name,code:e.code??null,message:e.shortMessage??e.message}));process.exitCode=1;}
finally{await Promise.all([requestPool?.end(),browserPool?.end(),admin?.end()]);if(child?.exitCode===null)child.kill('SIGTERM');if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await rm(dir,{recursive:true,force:true});}
