import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {tmpdir,userInfo} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:net';
import pg from 'pg';import {createPublicClient,http,keccak256,encodeFunctionData} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import deployment from '../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
import {createPaidStore} from '../broker/src/v4/directed-paid-store.mjs';
import {createPaidCoordinator} from '../broker/src/v4/directed-paid-coordinator.mjs';
import {runDirectedPaidWorker} from '../broker/src/v4/directed-paid-worker.mjs';
import {PAID_ABI,paidRead} from '../broker/src/v4/directed-paid-mint.mjs';
import {readDirectedPaidHistory} from '../broker/src/v4/directed-paid-history.mjs';
if(process.argv.length!==4||process.argv[2]!=='--disposable-only'||!process.argv[3].startsWith('--postgres-bin=/'))throw Error('Requires --disposable-only --postgres-bin=/absolute/path');
const bin=process.argv[3].slice('--postgres-bin='.length),run=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'gogh-directed-paid-test-')),data=join(dir,'data');
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const [dbPort,chainPort]=await Promise.all([port(),port()]),command=(name,args)=>run(join(bin,name),args,{timeout:60000,maxBuffer:100000});
let started=false,child,admin,requestPool,workerPool,browserPool;
try {
 await command('initdb',['-D',data,'--no-locale','-E','UTF8','--auth=trust']);
 await command('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} -k ${dir}`,'-w','start']);started=true;
 const settings={host:'127.0.0.1',port:dbPort,database:'postgres',max:3,connectionTimeoutMillis:5000};
 admin=new pg.Pool({...settings,user:userInfo().username});
 await admin.query(await readFile(new URL('../netlify/database/migrations/20260913050000_stage_directed_paid_reviews.sql',import.meta.url),'utf8'));
 await admin.query('CREATE ROLE forge_request LOGIN; CREATE ROLE forge_worker LOGIN; CREATE ROLE anon LOGIN; CREATE ROLE authenticated; CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO forge_request,forge_worker;');
 await admin.query(await readFile(new URL('../netlify/database/review/directed-paid-roles.sql',import.meta.url),'utf8'));
 requestPool=new pg.Pool({...settings,user:'forge_request'});workerPool=new pg.Pool({...settings,user:'forge_worker'});browserPool=new pg.Pool({...settings,user:'anon'});
 await assert.rejects(browserPool.query('SELECT * FROM broker_selected_paid_reviews'),e=>e.code==='42501');
 await assert.rejects(requestPool.query('SELECT raw_transaction FROM broker_selected_paid_executions'),e=>e.code==='42501');
 await assert.rejects(requestPool.query('INSERT INTO broker_selected_paid_executions(intent_id,status) VALUES ($1,$2)',['a'.repeat(64),'SIGNED']),e=>e.code==='42501');
 await assert.rejects(workerPool.query("UPDATE broker_selected_paid_reviews SET review_json='{}'"),e=>e.code==='42501');
 const pub=createPublicClient({cacheTime:0,transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:12000,retryCount:0})}),anchor=await pub.getBlock();
 child=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(chainPort),'--chain-id','4663','--gas-price',String(await pub.getGasPrice()),'--base-fee',String(anchor.baseFeePerGas??0n),'--fork-url','https://rpc.mainnet.chain.robinhood.com','--fork-block-number',String(anchor.number)],{stdio:'ignore'});
 const clients=[0,1].map(()=>createPublicClient({cacheTime:0,transport:http(`http://127.0.0.1:${chainPort}`,{timeout:20000,retryCount:0})})),c=clients[0];
 for(let i=0;i<80;i++){try{if(await c.getChainId()===4663)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.match(await c.request({method:'web3_clientVersion'}),/anvil/i);assert.equal((await c.getBlock({blockNumber:anchor.number})).hash,anchor.hash);
 // Fixture key is generated for this disposable test only; no real signer key is loaded.
 const signer=privateKeyToAccount('0x'+'11'.repeat(32)),r={...deployment,status:'OWNER_CANARY',allowedOwners:[deployment.owner],productionPaidMintAuthorized:true,executor:signer.address.toLowerCase()};
 await c.request({method:'anvil_impersonateAccount',params:[r.owner]});await c.request({method:'anvil_setBalance',params:[signer.address,'0xde0b6b3a7640000']});
 const initialSignerNonce=await c.getTransactionCount({address:signer.address});
 let at=Number((await c.getBlock()).timestamp)*1000;
 // Anvil adds a default 1-gwei tip to eth_gasPrice. Use the observed public
 // chain quote for this fee-bound test; execution still uses the real EVM.
 const observedGasPrice=await pub.getGasPrice();for(const client of clients)client.getGasPrice=async()=>observedGasPrice;
 const store=createPaidStore(requestPool),workerStore=createPaidStore(workerPool);
 const options={clients,release:r,now:()=>at};
 const coordinator=createPaidCoordinator({...options,store}),workerCoordinator=createPaidCoordinator({...options,store:workerStore});
 const relay={getChainId:()=>c.getChainId(),getTransactionCount:v=>c.getTransactionCount(v),sendRawTransaction:v=>c.sendRawTransaction(v)};
 const tick=()=>runDirectedPaidWorker({...options,store:workerStore,coordinator:workerCoordinator,relay,signer});
 const mine=async()=>{await c.request({method:'anvil_mine',params:['0xc','0x1']});at=Number((await c.getBlock()).timestamp)*1000;};
 let ownerSends=0;
 async function authorize(action='AUTHORIZE'){
  at=Number((await c.getBlock()).timestamp)*1000;
  const review=(await coordinator.prepare({action,maximumPriceWei:action==='AUTHORIZE'?'100000000000000':null})).record;
  const input={intentId:review.review.intentId,revision:review.revision,reviewHash:review.reviewHash};
  const claims=await Promise.allSettled([coordinator.claim(input),coordinator.claim(input)]);
  assert.equal(claims.filter(v=>v.status==='fulfilled').length,1);const claimed=claims.find(v=>v.status==='fulfilled').value;
  const hash=await c.request({method:'eth_sendTransaction',params:[claimed.transaction]});ownerSends++;
  const reported=await coordinator.recover({intentId:review.review.intentId,revision:claimed.record.revision,transactionHash:hash});
  assert.equal(reported.record.reportedHash,hash);await mine();
  return reported.record.review.intentId;
 }
 const rejected=(await coordinator.prepare({action:'AUTHORIZE',maximumPriceWei:null})).record;
 const claim=await coordinator.claim({intentId:rejected.review.intentId,revision:rejected.revision,reviewHash:rejected.reviewHash});
 await assert.rejects(coordinator.decline({intentId:rejected.review.intentId,revision:claim.record.revision,rejectionCode:4002}),/PAID_JOURNAL_CHANGED/);
 await coordinator.decline({intentId:rejected.review.intentId,revision:claim.record.revision,rejectionCode:4001});
 const id=await authorize();
 // Emulate worker crash after durable signature but before network broadcast.
 const normal=relay.sendRawTransaction;let broadcastCalls=0;
 relay.sendRawTransaction=async()=>{throw Error('FIXTURE_BROADCAST_LOST');};
 await assert.rejects(tick(),/FIXTURE_BROADCAST_LOST/);
 const signed=(await workerPool.query('SELECT * FROM broker_selected_paid_executions WHERE intent_id=$1',[id])).rows[0];
 assert.equal(signed.status,'SIGNED');assert.equal(keccak256(signed.raw_transaction),signed.transaction_hash);
 relay.sendRawTransaction=async args=>{broadcastCalls++;assert.equal(args.serializedTransaction,signed.raw_transaction);const hash=await normal(args);throw Object.assign(Error('FIXTURE_RESPONSE_LOST'),{fixtureHash:hash});};
 await assert.rejects(tick(),/FIXTURE_RESPONSE_LOST/);await mine();relay.sendRawTransaction=normal;
 const completed=await tick();assert.equal(completed.status,'PAID_COMPLETED');assert.equal(broadcastCalls,1);assert.equal(ownerSends,1);
 assert.equal((await paidRead(c,r.targetCollection,'ownerOf',[BigInt(completed.receipt.tokenId)])).toLowerCase(),r.recipient);
 assert.equal(await c.getBalance({address:r.vault}),0n);
 assert.equal(await c.getTransactionCount({address:signer.address}),initialSignerNonce+1);
 const history=await readDirectedPaidHistory(requestPool,r);assert.equal(history.candidates.length,1);assert.equal(history.candidates[0].tokenId,completed.receipt.tokenId);
 assert.equal(history.candidates[0].custodyAccount,r.recipient);assert.equal(history.activity[0].type,'PAID_MINT_COMPLETED');assert.equal(JSON.stringify(history).includes(signed.raw_transaction),false);
 await assert.rejects(requestPool.query('DELETE FROM broker_selected_paid_reviews'),e=>e.code==='42501');
 await assert.rejects(workerPool.query("UPDATE broker_selected_paid_executions SET raw_transaction='0x00'"),e=>e.code==='42501');
 const second=await authorize();
 // Transfer away and back must invalidate the worker's authority even though
 // the deployed original NFT has no on-chain ownership epoch.
 const tokenABI=[...PAID_ABI,{type:'function',name:'transferFrom',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'address'},{type:'uint256'}],outputs:[]}];
 await c.request({method:'anvil_impersonateAccount',params:[signer.address]});
 await c.request({method:'eth_sendTransaction',params:[{from:r.owner,to:r.collection,data:encodeFunctionData({abi:tokenABI,functionName:'transferFrom',args:[r.owner,signer.address,93n]})}]});
 await c.request({method:'eth_sendTransaction',params:[{from:signer.address,to:r.collection,data:encodeFunctionData({abi:tokenABI,functionName:'transferFrom',args:[signer.address,r.owner,93n]})}]});
 await mine();const stopped=await tick();assert.equal(stopped.status,'PAID_STOPPED');assert.equal(stopped.reason,'PAID_OWNERSHIP_CHANGED');
 assert.equal((await workerPool.query('SELECT raw_transaction FROM broker_selected_paid_executions WHERE intent_id=$1',[second])).rows[0].raw_transaction,null);
 const secondReview=await store.get(second);
 await authorize('CANCEL_MISSION');await tick();assert.equal((await coordinator.get()).state.refundWei,String(BigInt(secondReview.review.executionFeeWei)+100000000000000n));
 await authorize('WITHDRAW_REFUND');await tick();assert.equal((await coordinator.get()).state.refundWei,'0');
 const third=await authorize();
 // A changed collection runtime stops the worker but must not prevent the
 // original funder from cancelling and withdrawing escrow.
 const collectionCode=await c.getCode({address:r.targetCollection});
 await c.request({method:'anvil_setCode',params:[r.targetCollection,'0x60006000fd']});
 await mine();const runtimeStopped=await tick();assert.equal(runtimeStopped.status,'PAID_STOPPED');assert.equal(runtimeStopped.reason,'PAID_PRICE_CHANGED');
 await authorize('CANCEL_MISSION');await tick();await authorize('WITHDRAW_REFUND');await tick();
 assert.equal((await coordinator.get()).state.refundWei,'0');
 await c.request({method:'anvil_setCode',params:[r.targetCollection,collectionCode]});await mine();
 const fourth=await authorize();await c.request({method:'evm_increaseTime',params:[600]});await mine();
 const expired=await tick();assert.equal(expired.status,'PAID_STOPPED');assert.equal(expired.reason,'PAID_MISSION_EXPIRED');
 for(const intent of [third,fourth])assert.equal((await workerPool.query('SELECT raw_transaction FROM broker_selected_paid_executions WHERE intent_id=$1',[intent])).rows[0].raw_transaction,null);
 await authorize('CANCEL_MISSION');await tick();await authorize('WITHDRAW_REFUND');await tick();assert.equal((await coordinator.get()).state.refundWei,'0');
 const result={status:'PASS',environment:'DISPOSABLE_POSTGRES_AND_ANVIL_FORK',publicAnchor:{number:String(anchor.number),hash:anchor.hash},
  deployedFactory:r.factory,compiledVaultRuntimeVerified:r.vaultCodeHash,oneOwnerConfirmationForMint:true,workerExecuted:true,deliveredToken:completed.receipt.tokenId,
  lostBroadcastRecovery:true,sameSignedBytes:true,concurrentClaimWinner:1,ownershipRoundTripBlocked:true,cancelAndRefundVerified:true,
  runtimeDriftBlockedAndRefundable:true,expiredMissionNotSigned:true,collectionAndActivityHistoryVerified:true,publicGasQuoteWei:String(observedGasPrice),
  browserDatabaseDenied:true,requestCannotReadOrWriteSignedTransactions:true,publicTransactions:0};
 await writeFile(new URL('../docs/review/2026-09-12/selected-launch/production-paid-integration-fork.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({status:'FAILED',type:e.name,code:e.code??null,message:e.shortMessage??e.message,stack:e.stack?.split('\n').slice(0,5)}));process.exitCode=1;}
finally{await Promise.all([requestPool?.end(),workerPool?.end(),browserPool?.end(),admin?.end()]);if(child?.exitCode===null)child.kill('SIGTERM');if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await rm(dir,{recursive:true,force:true});}
