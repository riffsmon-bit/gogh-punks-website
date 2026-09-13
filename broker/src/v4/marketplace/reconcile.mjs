import { decodeEventLog, keccak256 } from 'viem';
import { MARKETPLACE_REVIEW_SCHEMA, MARKETPLACE_EVENTS_ABI, ACCOUNT_ABI, MARKETPLACE_PINS as P } from './contracts.mjs';
const HASH = /^0x[0-9a-f]{64}$/i;
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const fail = code => { throw new Error(code); };
const decode = (receipt,address,eventName) => receipt.logs.filter(log=>same(log.address,address)).flatMap(log=>{try{const event=decodeEventLog({abi:MARKETPLACE_EVENTS_ABI,data:log.data,topics:log.topics,strict:true});return event.eventName===eventName?[event.args]:[];}catch{return [];}});

// The journal owns state transitions; this only verifies the already-sent exact
// transaction. It never broadcasts, retries a send, or adds another gas charge.
export async function reconcileMarketplaceReview(review,{client,transactionHash,minConfirmations=12}) {
  if (review?.schema!==MARKETPLACE_REVIEW_SCHEMA || !review.transaction || !HASH.test(transactionHash??'')
    || !Number.isSafeInteger(minConfirmations) || minConfirmations<1 || minConfirmations>100) fail('INVALID_MARKETPLACE_RECOVERY');
  if (await client.getChainId()!==P.chainId) fail('WRONG_CHAIN');
  const tx=review.transaction;
  let actual,receipt;
  try { actual=await client.getTransaction({hash:transactionHash});receipt=await client.getTransactionReceipt({hash:transactionHash}); }
  catch(error) { if (/Transaction(NotFound|ReceiptNotFound)Error/.test(error?.name??'')) return {status:'PENDING',transactionHash,publicTransactions:0}; fail('RECEIPT_READ_UNAVAILABLE'); }
  if (!same(actual.from,tx.from)||!same(actual.to,tx.to)||!same(actual.input,tx.data)||actual.value!==BigInt(tx.value)
    || BigInt(actual.nonce)!==BigInt(tx.nonce)||actual.chainId!==P.chainId||!same(receipt.transactionHash,transactionHash)
    || !same(receipt.from,tx.from)||!same(receipt.to,tx.to)||actual.gas>BigInt(tx.gas)
    || (actual.gasPrice??actual.maxFeePerGas??0n)>BigInt(tx.gasPrice)||(actual.authorizationList?.length??0)!==0) fail('ORIGINAL_TRANSACTION_MISMATCH');
  const block=await client.getBlock({blockNumber:receipt.blockNumber});
  if (!same(block.hash,receipt.blockHash)) fail('RECEIPT_NOT_CANONICAL');
  const head=await client.getBlockNumber(),confirmations=head-receipt.blockNumber+1n;
  if(confirmations<BigInt(minConfirmations))return {status:'PENDING_FINALITY',transactionHash,confirmations:String(confirmations),publicTransactions:0};
  if(receipt.status!=='success')return {status:'REVERTED',transactionHash,confirmations:String(confirmations),publicTransactions:0,warning:'Purchase did not complete. The transaction reverted; the wallet may have paid its network fee.'};
  const result={status:'COMPLETED',action:review.action,transactionHash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,confirmations:String(confirmations),publicTransactions:0};
  if(review.action==='BUY_LISTINGS') {
    const transfers=decode(receipt,review.selection.collection,'Transfer'),fills=decode(receipt,P.seaport,'OrderFulfilled');
    if(fills.length!==review.selection.items.length)fail('MARKETPLACE_FILL_EVIDENCE_MISSING');
    const protocolCode=await client.getCode({address:P.seaport,blockNumber:receipt.blockNumber});
    const guardCode=await client.getCode({address:review.purchaseGuard.address,blockNumber:receipt.blockNumber});
    if(!protocolCode||keccak256(protocolCode)!==P.seaportCodeHash||!guardCode||keccak256(guardCode)!==review.purchaseGuard.codeHash)fail('SETTLEMENT_CODE_MISMATCH');
    for(const item of review.selection.items) {
      const matching=transfers.filter(t=>same(t.to,review.wallet)&&t.tokenId===BigInt(item.tokenId));
      const fill=fills.filter(f=>same(f.orderHash,item.orderHash)&&same(f.recipient,review.wallet));
      if(matching.length!==1||fill.length!==1||fill[0].offer.length!==1||fill[0].offer[0].itemType!==2
        || !same(fill[0].offer[0].token,review.selection.collection)||fill[0].offer[0].identifier!==BigInt(item.tokenId)
        || fill[0].offer[0].amount!==1n)fail('NFT_DELIVERY_EVIDENCE_MISMATCH');
      const price=fill[0].consideration.reduce((sum,payment)=>{
        if(payment.itemType!==0||payment.token!=='0x0000000000000000000000000000000000000000'||payment.identifier!==0n)fail('PAYMENT_EVIDENCE_MISMATCH');return sum+payment.amount;
      },0n);
      if(price!==BigInt(item.totalWei))fail('PAYMENT_EVIDENCE_MISMATCH');
      const holder=await client.readContract({address:review.selection.collection,abi:ACCOUNT_ABI,functionName:'ownerOf',args:[BigInt(item.tokenId)],blockNumber:receipt.blockNumber,ccipRead:false});
      if(!same(holder,review.wallet))fail('NFT_POSTSTATE_UNAVAILABLE');
    }
    result.items=review.selection.items;
  } else if(review.action==='CREATE_WETH_BID') {
    const events=decode(receipt,tx.to,'BidCreated');
    if(events.length!==1)fail('BID_CREATION_EVIDENCE_MISSING');
    const e=events[0],s=review.selection;
    if(!same(e.funder,review.owner)||!same(e.recipient,review.wallet)||e.punkId!==BigInt(review.punkId)
      ||!same(e.collection,s.collection)||e.tokenId!==BigInt(s.tokenId)||e.priceWei!==BigInt(s.priceWei)
      ||e.anyToken!==s.anyToken||e.deadline!==Number(s.deadline))fail('BID_CREATION_EVIDENCE_MISMATCH');
    result.status='BID_ACTIVE';result.orderHash=e.orderHash;
  } else if(review.action==='CANCEL_WETH_BID') {
    const cancelled=decode(receipt,tx.to,'BidCancelled').filter(e=>same(e.orderHash,review.selection.orderHash)&&same(e.funder,review.owner));
    const settled=decode(receipt,tx.to,'BidSettled').filter(e=>same(e.orderHash,review.selection.orderHash));
    if(cancelled.length===1){result.status='BID_CANCELLED';result.refundedWethWei=String(cancelled[0].refundedWeth);}
    else if(settled.length===1)result.status='BID_ALREADY_SETTLED';
    else fail('BID_RECOVERY_EVIDENCE_MISSING');
  } else fail('INVALID_MARKETPLACE_ACTION');
  if(!same((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash))fail('RECEIPT_NOT_CANONICAL');
  return result;
}
