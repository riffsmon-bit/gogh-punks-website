import {randomBytes} from 'node:crypto';
import {verifyPaidHistoryAccess,paidReceiptState} from './directed-paid-archive.mjs';
import {paidAssert,paidSame,paidHex,paidCall,readPaidState,paidRead,missionMatches,
 paidEvents,verifyPaidTransaction,paidReceiptPending,validatePaidRelease} from './directed-paid-mint.mjs';

export function createPaidCoordinator({clients,release,store,now=Date.now,historyClients=()=>clients,checkHistoryAccess=verifyPaidHistoryAccess}) {
 const r=validatePaidRelease(release),state=()=>readPaidState(clients,r,now);
 const terminal=['CONFIRMED','REVERTED','CANCELLED','DECLINED'];
 function verifyReview(review){
  paidAssert(review.schema==='GOGH_DIRECTED_PAID_REVIEW_V1'&&review.owner===r.owner&&review.tokenId==='93'
   &&review.vault===r.vault&&review.targetCollection===r.targetCollection&&review.recipient===r.recipient,'PAID_REVIEW_CHANGED');
  const call=paidCall(review,r),tx=review.transaction;
  paidAssert(paidSame(tx.from,r.owner)&&paidSame(tx.to,call.to)&&tx.data===call.data&&BigInt(tx.value)===call.value
   &&tx.chainId==='0x1237'&&tx.type==='0x0'&&Object.keys(tx).length===9
   &&Object.keys(tx).every(k=>['from','to','data','value','chainId','type','nonce','gas','gasPrice'].includes(k))
   &&BigInt(tx.gas)>0n&&BigInt(tx.gas)<=3000000n&&BigInt(tx.gasPrice)>0n
   &&BigInt(tx.gas)*BigInt(tx.gasPrice)===BigInt(review.maximumNetworkFeeWei)
   &&BigInt(review.maximumNetworkFeeWei)<=BigInt(r.ownerFeeCeilingWei),'PAID_REVIEW_CHANGED');
  if(review.action==='AUTHORIZE')paidAssert(review.quantity===1&&BigInt(review.priceWei)>0n&&BigInt(review.priceWei)<=BigInt(review.maximumPriceWei)
   &&BigInt(review.maximumPriceWei)<=BigInt(r.maximumPriceWei)&&BigInt(review.executionFeeWei)>0n
   &&BigInt(review.executionFeeWei)<=BigInt(r.maximumExecutionFeeWei)
   &&BigInt(review.deadline)>BigInt(review.anchor.timestamp)&&BigInt(review.deadline)<=BigInt(review.anchor.timestamp)+600n,'PAID_REVIEW_CHANGED');
 }
 async function preflight(review){
  verifyReview(review);
  paidAssert(now()+5000<review.expiresAt,'PAID_REVIEW_EXPIRED');
  paidAssert(review.owner===r.owner&&review.tokenId==='93'&&review.vault===r.vault,'PAID_REVIEW_CHANGED');
  const call=paidCall(review,r),tx=review.transaction,current=await state();
  paidAssert(paidSame(tx.from,r.owner)&&paidSame(tx.to,call.to)&&tx.data===call.data&&BigInt(tx.value)===call.value
   &&tx.chainId==='0x1237'&&tx.type==='0x0'&&BigInt(tx.gas)*BigInt(tx.gasPrice)===BigInt(review.maximumNetworkFeeWei)
   &&BigInt(review.maximumNetworkFeeWei)<=BigInt(r.ownerFeeCeilingWei),'PAID_REVIEW_CHANGED');
  if(review.action==='AUTHORIZE'){
   paidAssert(current.owner===r.owner&&current.missionStatus!==1&&current.generation===review.expectedGeneration,'PAID_MISSION_CHANGED');
   paidAssert(current.priceWei===review.priceWei&&BigInt(review.priceWei)>0n&&BigInt(review.priceWei)<=BigInt(review.maximumPriceWei)
    &&BigInt(review.maximumPriceWei)<=BigInt(r.maximumPriceWei)&&BigInt(review.executionFeeWei)>0n
    &&BigInt(review.executionFeeWei)<=BigInt(r.maximumExecutionFeeWei)&&current.targetCodeHash===r.targetCollectionCodeHash,'PAID_PRICE_CHANGED');
   paidAssert(BigInt(review.deadline)>BigInt(current.anchor.timestamp)+60n&&BigInt(review.deadline)<=BigInt(current.anchor.timestamp)+600n,'PAID_REVIEW_EXPIRED');
   await checkHistoryAccess(historyClients(),r,current.anchor);
  }else if(review.action==='CANCEL_MISSION')paidAssert(current.missionStatus===1&&current.generation===review.expectedGeneration
    &&paidSame(current.mission[0],r.owner),'PAID_MISSION_CHANGED');
  else paidAssert(BigInt(current.refundWei)>0n&&current.refundWei===review.refundWei,'PAID_REFUND_CHANGED');
  await Promise.all(clients.map(async c=>{
   const [latest,pending,balance]=await Promise.all([
    ...['latest','pending'].map(blockTag=>c.getTransactionCount({address:r.owner,blockTag})),c.getBalance({address:r.owner})]);
   const counts=[latest,pending];
   paidAssert(counts.every(n=>n===Number(BigInt(tx.nonce))),'PAID_OWNER_NONCE_CHANGED');
   paidAssert(balance>=call.value+BigInt(review.maximumNetworkFeeWei),'PAID_OWNER_UNFUNDED');
   await c.call({account:r.owner,...call,gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)});
  }));
  paidAssert(now()+1000<review.expiresAt,'PAID_REVIEW_EXPIRED');
 }
 async function prepare({action,maximumPriceWei=null}){
  paidAssert(['AUTHORIZE','CANCEL_MISSION','WITHDRAW_REFUND'].includes(action),'PAID_INVALID_ACTION');
  const previous=await store.current();paidAssert(!previous||terminal.includes(previous.status),'PAID_RECOVER_EXISTING_REVIEW');
  const current=await state(),c=clients[0];
  const review={schema:'GOGH_DIRECTED_PAID_REVIEW_V1',intentId:randomBytes(32).toString('hex'),action,
   owner:r.owner,tokenId:'93',targetCollection:r.targetCollection,recipient:r.recipient,vault:r.vault,
   expectedGeneration:current.generation,anchor:current.anchor,expiresAt:now()+90000};
  if(action==='AUTHORIZE'){
   paidAssert(maximumPriceWei===null||typeof maximumPriceWei==='string'&&/^[1-9][0-9]{0,15}$/.test(maximumPriceWei),'PAID_INVALID_PRICE_LIMIT');
   const cap=maximumPriceWei??r.maximumPriceWei;
   paidAssert(BigInt(cap)<=BigInt(r.maximumPriceWei),'PAID_PRICE_LIMIT_TOO_HIGH');
   const prices=await Promise.all(clients.map(c=>c.getGasPrice()));
   const fee=BigInt(r.workerGasCeiling)*prices.reduce((a,b)=>a>b?a:b)*2n;
   paidAssert(fee>0n&&fee<=BigInt(r.maximumExecutionFeeWei),'PAID_EXECUTION_FEE_BOUND');
   Object.assign(review,{quantity:1,priceWei:current.priceWei,maximumPriceWei:cap,executionFeeWei:String(fee),deadline:String(BigInt(current.anchor.timestamp)+540n)});
  }else if(action==='WITHDRAW_REFUND')review.refundWei=current.refundWei;
  const call=paidCall(review,r);
  const [estimate,price,nonce]=await Promise.all([c.estimateGas({account:r.owner,...call}),c.getGasPrice(),c.getTransactionCount({address:r.owner,blockTag:'pending'})]);
  const gas=(estimate*120n+99n)/100n,gasPrice=price*2n;
  paidAssert(gas>0n&&gas<=3000000n&&gasPrice>0n&&gas*gasPrice<=BigInt(r.ownerFeeCeilingWei),'PAID_NETWORK_FEE_TOO_HIGH');
  review.maximumNetworkFeeWei=String(gas*gasPrice);
  review.transaction={from:r.owner,to:call.to,data:call.data,value:paidHex(call.value),chainId:'0x1237',type:'0x0',nonce:paidHex(nonce),gas:paidHex(gas),gasPrice:paidHex(gasPrice)};
  await preflight(review);return {record:await store.save(review)};
 }
 async function claim({intentId,revision,reviewHash}){
  const record=await store.get(intentId);
  paidAssert(record?.status==='PREPARED'&&record.revision===revision&&record.reviewHash===reviewHash,'PAID_JOURNAL_CHANGED');
  await preflight(record.review);
  const claimed=await store.update(intentId,revision,'WALLET_REQUESTED',null);
  return {record:claimed,transaction:claimed.review.transaction};
 }
 async function verifyOwnerReceipt(review,hash){
  verifyReview(review);
  const {receipt,block}=await verifyPaidTransaction(clients,review.transaction,hash);
  const status=receipt.status==='success'?'CONFIRMED':'REVERTED';
  if(status==='CONFIRMED'){
   if(review.action==='AUTHORIZE'){
    const events=paidEvents(receipt,r.vault,'MissionAuthorized');paidAssert(events.length===1,'PAID_AUTHORIZATION_MISMATCH');
    const e=events[0];paidAssert(paidSame(e.owner,r.owner)&&paidSame(e.executor,r.executor)&&paidSame(e.collection,r.targetCollection)
     &&paidSame(e.recipient,r.recipient)&&String(e.generation)===String(BigInt(review.expectedGeneration)+1n)
     &&String(e.priceWei)===review.priceWei&&String(e.executionFeeWei)===review.executionFeeWei&&String(e.deadline)===review.deadline,'PAID_AUTHORIZATION_MISMATCH');
    await paidReceiptState(historyClients(),receipt,async c=>{const m=await paidRead(c,r.vault,'mission',[],receipt.blockNumber);
     paidAssert(missionMatches(m,review,r)&&Number(m[8])===1,'PAID_AUTHORIZATION_MISMATCH');});
   }else if(review.action==='CANCEL_MISSION'){
    const e=paidEvents(receipt,r.vault,'MissionCancelled');paidAssert(e.length===1&&String(e[0].generation)===review.expectedGeneration
     &&paidSame(e[0].funder,r.owner)&&e[0].refundWei>0n,'PAID_CANCEL_MISMATCH');
   }else{
    const e=paidEvents(receipt,r.vault,'RefundWithdrawn');paidAssert(e.length===1&&paidSame(e[0].funder,r.owner)
     &&paidSame(e[0].recipient,r.owner)&&String(e[0].amount)===review.refundWei,'PAID_REFUND_MISMATCH');
   }
  }
  return {status,transactionHash:hash,blockNumber:String(receipt.blockNumber),blockHash:block.hash,action:review.action,verifiedProviders:2,finalized:false};
 }
 async function recover({intentId,revision,transactionHash},{worker=false}={}){
  let record=await store.get(intentId);
  paidAssert(record?.status==='WALLET_REQUESTED'&&record.revision===revision&&/^0x[0-9a-f]{64}$/i.test(transactionHash),'PAID_JOURNAL_CHANGED');
  const hash=transactionHash.toLowerCase();
  if(worker)paidAssert(record.reportedHash===hash,'PAID_JOURNAL_CHANGED');
  if(record.reportedHash!==hash)record=await store.update(intentId,revision,'WALLET_REQUESTED',hash);
  let receipt;try{receipt=await verifyOwnerReceipt(record.review,hash);}catch(error){if(paidReceiptPending(error))return {record,pending:true};throw error;}
  return {record:await store.update(intentId,record.revision,receipt.status,hash,receipt,{worker})};
 }
 async function cancel({intentId,revision}){
  const record=await store.get(intentId);paidAssert(record?.status==='PREPARED'&&record.revision===revision,'PAID_JOURNAL_CHANGED');
  return {record:await store.update(intentId,revision,'CANCELLED',null)};
 }
 async function decline({intentId,revision,rejectionCode}){
  const record=await store.get(intentId);paidAssert(record?.status==='WALLET_REQUESTED'&&record.revision===revision&&!record.reportedHash&&rejectionCode===4001,'PAID_JOURNAL_CHANGED');
  for(const c of clients){const counts=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:r.owner,blockTag})));
   paidAssert(counts.every(n=>n===Number(BigInt(record.review.transaction.nonce))),'PAID_OWNER_NONCE_CHANGED');}
  return {record:await store.update(intentId,revision,'DECLINED',null)};
 }
 return {prepare,claim,recover,cancel,decline,verifyOwnerReceipt,get:async()=>({record:await store.current(),state:await state(),execution:await store.execution()})};
}
