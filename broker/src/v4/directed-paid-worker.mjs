import {encodeFunctionData,keccak256,parseTransaction,recoverTransactionAddress} from 'viem';
import {PAID_ABI,paidAssert,paidSame,paidHex,paidJson,paidRead,readPaidState,missionMatches,
 paidEvents,verifyPaidTransaction,paidReceiptPending,validatePaidRelease} from './directed-paid-mint.mjs';

// The caller holds the SAME application-database advisory lock (4663,8004)
// used by the existing free-mint relay. A raw transaction is committed before
// its first broadcast; retries can only broadcast those identical bytes.
export async function runDirectedPaidWorker({clients,relay,signer,release,store,coordinator,now=Date.now,allowBroadcast=true}) {
 const r=validatePaidRelease(release),pool=store.pool;
 paidAssert(paidSame(signer.address,r.executor)&&await relay.getChainId()===4663,'PAID_EXECUTOR_CHANGED');
 const summarize=(status,extra={})=>({status,tokenId:'93',submitted:false,...extra});
 async function updateExecution(job,status,receipt=null,reason=null){
  const row=(await pool.query(`UPDATE broker_selected_paid_executions SET revision=revision+1,status=$3,receipt=$4,reason=$5
   WHERE intent_id=$1 AND revision=$2 RETURNING *`,[job.intent_id,job.revision,status,receipt,reason])).rows[0];
  paidAssert(row,'PAID_EXECUTION_CHANGED');return row;
 }
 async function verifyContinuity(record,current){
  paidAssert(current.owner===r.owner&&current.missionStatus===1&&missionMatches(current.mission,record.review,r),'PAID_MISSION_CHANGED');
  paidAssert(BigInt(current.anchor.timestamp)+15n<BigInt(record.review.deadline),'PAID_MISSION_EXPIRED');
  paidAssert(current.priceWei===record.review.priceWei&&current.targetCodeHash===r.targetCollectionCodeHash,'PAID_PRICE_CHANGED');
  const from=BigInt(record.receipt.blockNumber),to=BigInt(current.anchor.number);
  paidAssert(to>=from&&to-from<=20000n,'PAID_OWNERSHIP_WINDOW_EXCEEDED');
  const all=await Promise.all(clients.map(async c=>{
   paidAssert(paidSame((await c.getBlock({blockNumber:from})).hash,record.receipt.blockHash),'PAID_AUTHORIZATION_REORG');
   const logs=await c.getLogs({address:r.collection,event:PAID_ABI.find(v=>v.type==='event'&&v.name==='Transfer'),args:{tokenId:93n},fromBlock:from,toBlock:to,strict:true});
   paidAssert(logs.length===0,'PAID_OWNERSHIP_CHANGED');
  }));return all;
 }
 async function validateSigned(job,record){
  const tx=parseTransaction(job.raw_transaction),e=job.transaction_json;
  paidAssert(keccak256(job.raw_transaction)===job.transaction_hash&&paidSame(await recoverTransactionAddress({serializedTransaction:job.raw_transaction}),r.executor)
   &&tx.chainId===4663&&paidSame(tx.to,r.vault)&&tx.data===encodeFunctionData({abi:PAID_ABI,functionName:'execute',args:[BigInt(record.review.expectedGeneration)+1n]})
   &&(tx.value??0n)===0n&&tx.type==='legacy'&&!tx.authorizationList?.length
   &&tx.gas<=BigInt(r.workerGasCeiling)&&tx.gas*tx.gasPrice<=BigInt(record.review.executionFeeWei)
   &&paidSame(e.from,r.executor)&&paidSame(e.to,tx.to)&&e.data===tx.data&&BigInt(e.value)===0n
   &&Number(BigInt(e.nonce))===tx.nonce&&BigInt(e.gas)===tx.gas&&BigInt(e.gasPrice)===tx.gasPrice,'PAID_SIGNED_TRANSACTION_CHANGED');
 }
 async function reconcile(job){
  const record=await store.get(job.intent_id);paidAssert(record?.status==='CONFIRMED'&&record.review.action==='AUTHORIZE','PAID_AUTHORIZATION_REQUIRED');
  await validateSigned(job,record);
  let observed;
  try{observed=await verifyPaidTransaction(clients,job.transaction_json,job.transaction_hash);}
  catch(error){if(!paidReceiptPending(error))throw error;}
  if(observed){
   const {receipt,block}=observed,status=receipt.status==='success'?'COMPLETED':'REVERTED';let tokenId=null;
   if(status==='COMPLETED'){
    const events=paidEvents(receipt,r.vault,'MissionCompleted');paidAssert(events.length===1,'PAID_DELIVERY_UNVERIFIED');const e=events[0];
    paidAssert(String(e.generation)===String(BigInt(record.review.expectedGeneration)+1n)&&paidSame(e.collection,r.targetCollection)
     &&paidSame(e.recipient,r.recipient)&&String(e.priceWei)===record.review.priceWei&&String(e.executionFeeWei)===record.review.executionFeeWei,'PAID_DELIVERY_UNVERIFIED');
    tokenId=String(e.tokenId);
    const transfers=paidEvents(receipt,r.targetCollection,'Transfer').filter(t=>t.tokenId===e.tokenId);
    paidAssert(transfers.length===2&&paidSame(transfers[0].from,'0x0000000000000000000000000000000000000000')
     &&paidSame(transfers[0].to,r.vault)&&paidSame(transfers[1].from,r.vault)&&paidSame(transfers[1].to,r.recipient),'PAID_DELIVERY_UNVERIFIED');
    for(const c of clients){paidAssert(paidSame(await paidRead(c,r.targetCollection,'ownerOf',[e.tokenId],receipt.blockNumber),r.recipient),'PAID_DELIVERY_UNVERIFIED');
     const m=await paidRead(c,r.vault,'mission',[],receipt.blockNumber);paidAssert(missionMatches(m,record.review,r)&&Number(m[8])===2,'PAID_DELIVERY_UNVERIFIED');}
   }
   const evidence={status,transactionHash:job.transaction_hash,blockNumber:String(receipt.blockNumber),blockHash:block.hash,
    collection:r.targetCollection,tokenId,recipient:r.recipient,priceWei:record.review.priceWei,executionFeeWei:record.review.executionFeeWei,
    blockTimestamp:String(block.timestamp),verifiedProviders:2,finalized:false};
   await updateExecution(job,status,evidence);return summarize(`PAID_${status}`,{receipt:evidence});
  }
  // A receipt waiting for confirmations must never be treated as a fresh send.
  const visible=await Promise.all(clients.map(async c=>{try{return await c.getTransaction({hash:job.transaction_hash});}catch(e){if(paidReceiptPending(e))return null;throw e;}}));
  if(visible.some(Boolean))return summarize('PAID_RECEIPT_PENDING');
  if(!allowBroadcast)return summarize('PAID_SIGNED_WORKER_PAUSED');
  const current=await readPaidState(clients,r,now);
  // Keep the signer reservation if the result is ambiguous or the deadline
  // passed. Never create a new signed payload/nonce as a recovery shortcut.
  await verifyContinuity(record,current);
  for(const c of [...clients,relay])paidAssert(await c.getTransactionCount({address:r.executor,blockTag:'latest'})<=Number(BigInt(job.transaction_json.nonce)),'PAID_SIGNER_NONCE_AMBIGUOUS');
  const reported=await relay.sendRawTransaction({serializedTransaction:job.raw_transaction});
  paidAssert(paidSame(reported,job.transaction_hash),'PAID_BROADCAST_HASH_MISMATCH');
  if(job.status==='SIGNED')await updateExecution(job,'SUBMITTED');
  return summarize('PAID_SUBMITTED',{submitted:true,transactionHash:job.transaction_hash});
 }
 const pending=(await pool.query(`SELECT * FROM broker_selected_paid_executions WHERE status IN('SIGNED','SUBMITTED') ORDER BY created_at LIMIT 1`)).rows[0];
 if(pending)return reconcile(pending);
 // Finish owner-receipt verification even if the browser closed after saving
 // its candidate hash. No wallet request is generated by the worker.
 const candidates=(await pool.query(`SELECT intent_id,revision,reported_hash FROM broker_selected_paid_reviews WHERE status='WALLET_REQUESTED' AND reported_hash IS NOT NULL LIMIT 3`)).rows;
 for(const candidate of candidates)await coordinator.recover({intentId:candidate.intent_id,revision:candidate.revision,transactionHash:candidate.reported_hash},{worker:true});
 const row=(await pool.query(`SELECT r.intent_id FROM broker_selected_paid_reviews r LEFT JOIN broker_selected_paid_executions e USING(intent_id)
  WHERE r.status='CONFIRMED' AND r.review_json::jsonb->>'action'='AUTHORIZE' AND e.intent_id IS NULL ORDER BY r.created_at LIMIT 1`)).rows[0];
 if(!row)return summarize('PAID_NO_MISSION');
 if(!allowBroadcast)return summarize('PAID_WORKER_PAUSED');
 const record=await store.get(row.intent_id);
 await coordinator.verifyOwnerReceipt(record.review,record.reportedHash);
 const current=await readPaidState(clients,r,now);
 try{await verifyContinuity(record,current);}catch(error){
  if(!['PAID_MISSION_CHANGED','PAID_MISSION_EXPIRED','PAID_OWNERSHIP_CHANGED','PAID_OWNERSHIP_WINDOW_EXCEEDED','PAID_PRICE_CHANGED'].includes(error.code))throw error;
  await pool.query(`INSERT INTO broker_selected_paid_executions(intent_id,status,reason) VALUES($1,'STOPPED',$2)`,[row.intent_id,error.code]);
  return summarize('PAID_STOPPED',{reason:error.code});
 }
 const data=encodeFunctionData({abi:PAID_ABI,functionName:'execute',args:[BigInt(record.review.expectedGeneration)+1n]});
 const call={account:r.executor,to:r.vault,data,value:0n};
 const estimates=await Promise.all(clients.map(c=>c.estimateGas(call)));
 const prices=await Promise.all(clients.map(c=>c.getGasPrice()));
 const gas=(estimates.reduce((a,b)=>a>b?a:b)*120n+99n)/100n,gasPrice=prices.reduce((a,b)=>a>b?a:b)*2n;
 paidAssert(gas>0n&&gas<=BigInt(r.workerGasCeiling)&&gasPrice>0n&&gas*gasPrice<=BigInt(record.review.executionFeeWei),'PAID_EXECUTION_FEE_BOUND');
 const nonces=await Promise.all([...clients,relay].flatMap(c=>['latest','pending'].map(blockTag=>c.getTransactionCount({address:r.executor,blockTag}))));
 paidAssert(nonces.every(n=>n===nonces[0]),'PAID_SIGNER_BUSY');
 for(const c of clients)paidAssert(await c.getBalance({address:r.executor})>=gas*gasPrice+200000000000000n,'PAID_WORKER_UNFUNDED');
 // Recheck after simulation/nonce reads, immediately before signing.
 await verifyContinuity(record,await readPaidState(clients,r,now));
 const raw=await signer.signTransaction({chainId:4663,type:'legacy',to:r.vault,data,value:0n,gas,gasPrice,nonce:nonces[0]});
 const expected={from:r.executor,to:r.vault,data,value:'0x0',chainId:'0x1237',type:'0x0',gas:paidHex(gas),gasPrice:paidHex(gasPrice),nonce:paidHex(nonces[0])};
 const job=(await pool.query(`INSERT INTO broker_selected_paid_executions(intent_id,status,transaction_json,raw_transaction,transaction_hash)
  VALUES($1,'SIGNED',$2,$3,$4) RETURNING *`,[row.intent_id,paidJson(expected),raw,keccak256(raw)])).rows[0];
 return reconcile(job);
}
