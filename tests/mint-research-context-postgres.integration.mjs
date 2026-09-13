// Explicitly creates a private loopback cluster from local PostgreSQL binaries.
// Production DDL is loaded unchanged for every table queried by this reader.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { mintResearchFixture, OWNER, WALLET, GOGH, COLLECTION, HASH, ZERO } from './helpers/mint-research-context-fixture.mjs';
import { createMintResearchContextReader, readMintResearchUsage, readSelectedPaidMintResearchUsage } from '../netlify/functions/_shared/v2-mint-research-context.mjs';
import release from '../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
if(process.argv.length!==4||process.argv[2]!=='--disposable-only'||!process.argv[3].startsWith('--postgres-bin=/'))
  throw Error('Explicit disposable-only local PostgreSQL binaries are required.');
const bin=process.argv[3].slice('--postgres-bin='.length),base=await mkdtemp(path.join(tmpdir(),'gogh-mint-research-sql-'));
const data=path.join(base,'data'),listener=net.createServer();
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const command=(name,args)=>execFileSync(path.join(bin,name),args,{stdio:'pipe',timeout:30_000});
const config={host:'127.0.0.1',port,database:'postgres',max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:1000};
const f=mintResearchFixture(),now=f.time,dayBefore=new Date(+now-86_400_000),hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
let running=false,admin,app,paid,assertions=0;
const check=(value,label)=>{assert.ok(value,label);assertions++;};
const readMigration=name=>readFile(new URL(`../netlify/database/migrations/${name}`,import.meta.url),'utf8');
async function table(migration,name){const sql=await readMigration(migration),start=sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.ok(start>=0);const end=sql.indexOf('\n);',start);assert.ok(end>start);await admin.query(sql.slice(start,end+3));}
try{
  command('initdb',['-D',data,'-A','trust','-U','gogh_mint_admin','--no-locale']);
  command('pg_ctl',['-D',data,'-l',path.join(base,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${base}`,'-w','start']);running=true;
  admin=new pg.Pool({...config,user:'gogh_mint_admin'});
  // Unqueried foreign-key parents; the production query tables themselves use
  // exact repository migrations, including checks, numeric types and FKs.
  await admin.query(`CREATE TABLE broker_punks(chain_id bigint,collection_address char(42),token_id numeric(78,0),PRIMARY KEY(chain_id,collection_address,token_id));
    CREATE TABLE broker_v4_executable_opportunities(opportunity_id text PRIMARY KEY);
    CREATE TABLE broker_v4_punk_policy_proposals(policy_id uuid PRIMARY KEY)`);
  for(const name of['broker_v2_strategies','broker_v2_opportunities','broker_v2_execution_attempts','broker_v2_activity'])
    await table('20260906010000_create_art_broker_v2.sql',name);
  await table('20260817224000_create_art_broker_foundation.sql','broker_acquisitions');
  const {readdir}=await import('node:fs/promises');
  const migrations=await readdir(new URL('../netlify/database/migrations/',import.meta.url));
  const sessionMigration=migrations.find(name=>name.startsWith('20260907010000'));
  for(const name of['broker_v2_agent_sessions','broker_v2_agent_user_operations'])await table(sessionMigration,name);
  await table('20260827010000_create_paid_mint_spend_ledger.sql','broker_paid_mint_jobs');
  await table(migrations.find(name=>name.startsWith('20260902044000')),'broker_v4_execution_attempts');
  await admin.query(await readMigration('20260913050000_stage_directed_paid_reviews.sql'));
  await admin.query(`CREATE ROLE mint_app_reader LOGIN; CREATE ROLE mint_paid_reader LOGIN;
    GRANT USAGE ON SCHEMA public TO mint_app_reader,mint_paid_reader;
    GRANT SELECT ON broker_v2_strategies,broker_v2_opportunities,broker_v2_execution_attempts,broker_acquisitions,
      broker_v2_activity,broker_v2_agent_user_operations,broker_v2_agent_sessions,broker_paid_mint_jobs,broker_v4_execution_attempts TO mint_app_reader;
    GRANT SELECT ON broker_selected_paid_reviews TO mint_paid_reader;
    GRANT SELECT(intent_id,status,transaction_hash,receipt) ON broker_selected_paid_executions TO mint_paid_reader;
    CREATE POLICY paid_review_full ON broker_selected_paid_reviews FOR SELECT TO mint_paid_reader USING(true);
    CREATE POLICY paid_execution_full ON broker_selected_paid_executions FOR SELECT TO mint_paid_reader USING(true)`);
  app=new pg.Pool({...config,user:'mint_app_reader'});paid=new pg.Pool({...config,user:'mint_paid_reader'});
  await admin.query('INSERT INTO broker_punks VALUES(4663,$1,93),(4663,$1,94)',[GOGH]);
  const s=f.strategy;
  await admin.query(`INSERT INTO broker_v2_strategies(chain_id,collection_address,token_id,version,schema_name,intent_hash,intent,state,configured_by,
    ownership_block,owner_confirmation_hash,expires_at,activated_at) VALUES(4663,$1,93,1,'PUNK_COLLECTING_INTENT_V1',$2,$3,'ACTIVE',$4,99,$5,$6,$7)`,
    [GOGH,s.intent_hash,s.intent,OWNER,HASH,s.expires_at,s.activated_at]);
  const o=f.opportunity;
  await admin.query(`INSERT INTO broker_v2_opportunities(opportunity_id,dedupe_key,chain_id,collection_contract,mint_contract,adapter_address,mint_stage,
    normalized,screening_status,simulation_status,risk_score,first_seen_at) VALUES($1,$2,4663,$3,$4,$5,'PUBLIC',$6,'PASSED','PENDING',5,$7)`,
    [o.opportunityId,o.dedupeKey,COLLECTION,o.mintContract,o.adapter,o,now]);
  const selectedPaidUsageReader=args=>readSelectedPaidMintResearchUsage({...args,runtimeReader:async()=>({pool:paid})});
  const usage=()=>readMintResearchUsage({pool:app,tokenId:'93',wallet:WALLET,collection:COLLECTION,now,selectedPaidUsageReader});
  check(JSON.stringify(await usage())===JSON.stringify({dailyMints:0,totalMints:0,opportunityMints:0}),'Verified empty actual SELECT returns explicit zero');
  const initial=await createMintResearchContextReader({...f.contextOptions,pool:app,selectedPaidUsageReader})(f.identity);
  check(initial.authority.punkWallet===WALLET&&initial.strategyVersion===1,'Full context uses native SQL and exact Agent runtime');
  const acquisition=async(tx,{at=now,account=WALLET,punk=93,amount=1,log=0}={})=>admin.query(`INSERT INTO broker_acquisitions(
    chain_id,transaction_hash,log_index,punk_collection_address,punk_token_id,punk_account_address,nft_collection_address,nft_token_id,asset_amount,
    currency_address,price,marketplace_address,acquisition_mode,policy_version,reasoning_hash,block_number,block_hash,acquired_at)
    VALUES(4663,$1,$2,$3,$4,$5,$6,1599,$7,$8,0,$8,'V2_AGENT_AUTONOMOUS',1,$9,99,$9,$10)`,[tx,log,GOGH,punk,account,COLLECTION,amount,ZERO,HASH,at]);
  await acquisition(hash(1),{at:dayBefore});
  check(JSON.stringify(await usage())===JSON.stringify({dailyMints:0,totalMints:1,opportunityMints:1}),'Completed lifetime count and UTC day are distinct');
  const attempt=async(tx,state='CONFIRMED')=>{
    const id=randomUUID();await admin.query(`INSERT INTO broker_v2_execution_attempts(attempt_id,idempotency_key,chain_id,punk_token_id,punk_account,
      owner_snapshot,opportunity_id,strategy_version,strategy_hash,account_nonce,operating_mode,state,transaction_envelope_hash,
      transaction_hash,created_at,submitted_at,confirmed_at) VALUES($1,$2,4663,93,$3,$4,$5,1,$6,0,'ASSIST',$7,$2,$8,$9,$10,$11)`,
      [id,hash(Math.floor(Math.random()*1_000_000)+100).slice(2),WALLET,OWNER,o.opportunityId,HASH,state,tx,dayBefore,
        state==='CONFIRMED'?now:null,state==='CONFIRMED'?now:null]);return id;};
  await attempt(hash(1));
  check((await usage()).totalMints===1&&(await usage()).dailyMints===1,'Same completed transaction in two native ledgers counts once, later timestamp conservatively counts today');
  const pending=await attempt(null,'RESERVED');
  check((await usage()).totalMints===2&&(await usage()).dailyMints===2,'Unresolved previous-day attempt reserves current daily and lifetime usage');
  await acquisition(hash(2),{account:OWNER});await acquisition(hash(3),{punk:94});
  check((await usage()).totalMints===2,'Different wallet and Punk do not enter canonical Agent usage');
  let sequence=10;
  const paidReview=async(completed=false,tx=hash(++sequence))=>{
    const id=(++sequence).toString(16).padStart(64,'0');const review={schema:'GOGH_DIRECTED_PAID_REVIEW_V1',intentId:id,action:'AUTHORIZE',
      owner:OWNER,tokenId:'93',targetCollection:COLLECTION,recipient:WALLET,vault:release.vault,expiresAt:Date.now()+3_600_000,
      transaction:{chainId:'0x1237'}};
    const json=JSON.stringify(review),digest=createHash('sha256').update(json).digest('hex');
    await admin.query('INSERT INTO broker_selected_paid_reviews(intent_id,review_json,review_hash) VALUES($1,$2,$3)',[id,json,digest]);
    await admin.query("UPDATE broker_selected_paid_reviews SET status='WALLET_REQUESTED',revision=1 WHERE intent_id=$1",[id]);
    await admin.query("UPDATE broker_selected_paid_reviews SET status='CONFIRMED',revision=2,reported_hash=$2,receipt=$3 WHERE intent_id=$1",[id,hash(999),{status:'CONFIRMED',transactionHash:hash(999)}]);
    if(completed){
      await admin.query("INSERT INTO broker_selected_paid_executions(intent_id,status,transaction_json,raw_transaction,transaction_hash) VALUES($1,'SIGNED','{}','0x1234',$2)",[id,tx]);
      await admin.query("UPDATE broker_selected_paid_executions SET status='COMPLETED',revision=1,receipt=$2 WHERE intent_id=$1",[id,{status:'COMPLETED',transactionHash:tx,
        collection:COLLECTION,tokenId:'1599',recipient:WALLET,blockTimestamp:String(+now/1000),blockNumber:'100',blockHash:HASH,verifiedProviders:2}]);
    }return id;
  };
  await paidReview(true,hash(1));
  check((await usage()).totalMints===2,'Selected-paid completion and V2/acquisition copy of same transaction dedupe across database readers');
  await paidReview(true,hash(4));
  check((await usage()).totalMints===3,'Selected-paid completed NFT with no application acquisition is counted');
  await paidReview(false);
  check((await usage()).totalMints===4&&(await usage()).dailyMints===4,'Confirmed paid budget is counted as reserved, never labeled completed mint');
  await assert.rejects(paid.query('SELECT raw_transaction FROM broker_selected_paid_executions'),e=>e.code==='42501');assertions++;
  await assert.rejects(app.query("UPDATE broker_v2_strategies SET state='PAUSED'"),e=>e.code==='42501');assertions++;
  await assert.rejects(paid.query('DELETE FROM broker_selected_paid_reviews'),e=>e.code==='42501');assertions++;
  await admin.query(`ALTER TABLE broker_acquisitions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY hidden_acquisitions ON broker_acquisitions FOR SELECT TO mint_app_reader USING(false)`);
  check((await app.query('SELECT count(*)::integer AS n FROM broker_acquisitions')).rows[0].n===0,'RLS can hide actual records');
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('DROP POLICY hidden_acquisitions ON broker_acquisitions; CREATE POLICY readable_acquisitions ON broker_acquisitions FOR SELECT TO mint_app_reader USING(true)');
  check((await usage()).totalMints===4,'Explicit full SELECT policy restores complete coverage');
  await admin.query('CREATE POLICY restrictive_filter ON broker_acquisitions AS RESTRICTIVE FOR SELECT TO mint_app_reader USING(false)');
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('DROP POLICY restrictive_filter ON broker_acquisitions');
  await admin.query('DROP POLICY paid_execution_full ON broker_selected_paid_executions');
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('CREATE POLICY paid_execution_full ON broker_selected_paid_executions FOR SELECT TO mint_paid_reader USING(true)');
  await admin.query('GRANT SELECT(raw_transaction) ON broker_selected_paid_executions TO mint_paid_reader');
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('REVOKE SELECT(raw_transaction) ON broker_selected_paid_executions FROM mint_paid_reader');
  await admin.query(`INSERT INTO broker_paid_mint_jobs(chain_id,punk_token_id,utc_day,job_id,status,amount_wei,mint_contract,collection_address)
    VALUES(4663,93,current_date,'legacy-unbound-paid','RESERVED',1,$1,$1)`,[COLLECTION]);
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query("UPDATE broker_paid_mint_jobs SET status='RELEASED'");
  const policy=randomUUID();await admin.query('INSERT INTO broker_v4_punk_policy_proposals VALUES($1)',[policy]);
  await admin.query("INSERT INTO broker_v4_executable_opportunities VALUES('v4:fixture')");
  await admin.query(`INSERT INTO broker_v4_execution_attempts(idempotency_key,chain_id,punk_collection_address,punk_token_id,punk_account_address,opportunity_id,policy_id)
    VALUES($1,4663,$2,93,$3,'v4:fixture',$4)`,[hash(700).slice(2),GOGH,WALLET,policy]);
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query("UPDATE broker_v4_execution_attempts SET state='CANCELLED'");
  await admin.query("INSERT INTO broker_v2_activity(chain_id,punk_token_id,activity_type,occurred_at) VALUES(4663,93,'COLLECTED',$1)",[now]);
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('DELETE FROM broker_v2_activity');
  await acquisition(hash(88),{amount:3});
  check((await usage()).totalMints===7,'Exact asset quantities count multiple units, never one per receipt');
  await admin.query('DELETE FROM broker_acquisitions WHERE transaction_hash=$1',[hash(88)]);
  await acquisition(hash(89),{at:new Date(+now+60_000)});
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('DELETE FROM broker_acquisitions WHERE transaction_hash=$1',[hash(89)]);
  const session=randomUUID();
  await admin.query(`INSERT INTO broker_v2_agent_sessions(session_id,chain_id,collection_address,punk_token_id,punk_account,owner_snapshot,
    strategy_version,strategy_hash,session_key,session_generation,adapter_address,venue_address,adapter_code_hash,target_collection,
    max_mints_per_day,max_mints_total,max_gas_cost_wei,minimum_native_reserve_wei,valid_after,valid_until,status,setup_artifact_hash)
    VALUES($1,4663,$2,93,$3,$4,1,$5,$4,1,$6,$7,$5,$8,2,2,1,0,$9,$10,'PENDING_RECEIPT',$5)`,
    [session,GOGH,WALLET,OWNER,HASH,o.adapter,o.mintContract,COLLECTION,dayBefore,new Date(+now+60_000)]);
  await admin.query(`INSERT INTO broker_v2_agent_user_operations(session_id,attempt_id,opportunity_id,opportunity_hash,account_nonce,
    session_generation,call_data_hash,maximum_gas_cost_wei,screening_input_hash,simulation_input_hash,expected_collection,expected_token_id,
    state,user_operation_hash,signed_at) VALUES($1,$2,$3,$4,0,1,$4,1,'screened','simulated',$5,1600,'SIGNED',$4,$6)`,
    [session,pending,o.opportunityId,HASH,COLLECTION,now]);
  check((await usage()).totalMints===4,'Signed UserOperation shares its existing attempt reservation');
  await admin.query('UPDATE broker_v2_agent_user_operations SET expected_collection=$1',[OWNER]);
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query('UPDATE broker_v2_agent_user_operations SET expected_collection=$1',[COLLECTION]);
  await admin.query("UPDATE broker_v2_execution_attempts SET state='CANCELLED' WHERE attempt_id=$1",[pending]);
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  await admin.query("UPDATE broker_v2_agent_user_operations SET state='REJECTED'");
  await admin.query("UPDATE broker_v2_execution_attempts SET state='CANCELLED' WHERE attempt_id=$1",[pending]);
  check((await usage()).totalMints===3,'Recorded cancellation releases an actual V2 reservation');
  await admin.query('REVOKE SELECT ON broker_acquisitions FROM mint_app_reader');
  await assert.rejects(usage(),/ACCOUNTING_UNAVAILABLE/);assertions++;
  console.log(JSON.stringify({schema:'GOGH_MINT_RESEARCH_NATIVE_POSTGRES_V1',ok:true,assertions,actualRepositoryTableDDL:true,
    fullContextRead:true,canonicalAgent:WALLET,readOnlyApplicationRole:true,restrictedPaidRole:true,rawTransactionReadDenied:true,
    completedAndPendingUsage:true,crossSourceTransactionDedupe:true,rlsCoverageVerified:true,publicTransactions:0,productionDatabaseUsed:false},null,2));
}finally{
  await app?.end();await paid?.end();await admin?.end();
  if(running)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await rm(base,{recursive:true,force:true});
}
