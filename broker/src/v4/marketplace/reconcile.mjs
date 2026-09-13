import { decodeEventLog, decodeFunctionData, keccak256 } from 'viem';
import { MARKETPLACE_REVIEW_SCHEMA, MARKETPLACE_EVENTS_ABI, ACCOUNT_ABI, MARKETPLACE_BID_ABI, MARKETPLACE_PINS as P } from './contracts.mjs';
const HASH = /^0x[0-9a-f]{64}$/i;
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const fail = code => { throw new Error(code); };
const positiveBigInt = value => typeof value === 'bigint' && value > 0n;
const legacyType = value => value === 'legacy' || value === '0x0' || value === 0;
const absent = value => value === undefined || value === null;
const canonicalUint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);

async function readBoundBid(review, client, blockNumber) {
  const binding = review.selection?.bidBinding, escrow = review.bidEscrow;
  if (!escrow || !HASH.test(escrow.codeHash ?? '') || !same(escrow.address, review.transaction.to)
    || !binding || !HASH.test(review.selection.orderHash ?? '')) fail('BID_RECOVERY_BINDING_MISSING');
  let decoded;
  try { decoded = decodeFunctionData({ abi: MARKETPLACE_BID_ABI, data: review.transaction.data }); } catch { fail('BID_RECOVERY_BINDING_MISMATCH'); }
  if (decoded.functionName !== 'cancelBid' || !same(decoded.args[0], review.selection.orderHash)) fail('BID_RECOVERY_BINDING_MISMATCH');
  const runtime = await client.getCode({ address: escrow.address, blockNumber });
  if (!runtime || runtime === '0x' || keccak256(runtime) !== escrow.codeHash) fail('SETTLEMENT_CODE_MISMATCH');
  const bid = await client.readContract({ address: escrow.address, abi: MARKETPLACE_BID_ABI, functionName: 'bids',
    args: [review.selection.orderHash], blockNumber, ccipRead: false });
  const fields = ['tokenId', 'priceWei', 'salt', 'counter', 'createdAt', 'deadline'];
  if (!same(bid[0], review.owner) || !same(bid[1], review.wallet) || String(bid[3]) !== review.punkId
    || !same(bid[2], binding.collection) || !same(bid[11], binding.collectionCodeHash)
    || !same(bid[12], binding.recipientCodeHash) || bid[10] !== binding.anyToken
    || fields.some((field, index) => !canonicalUint(binding[field]) || String(bid[index + 4]) !== binding[field])
    || binding.priceWei !== review.selection.maximumRefundWei) fail('BID_RECOVERY_BINDING_MISMATCH');
  return bid;
}
const decode = (receipt,address,eventName) => receipt.logs.filter(log=>same(log.address,address)).flatMap(log=>{try{const event=decodeEventLog({abi:MARKETPLACE_EVENTS_ABI,data:log.data,topics:log.topics,strict:true});return event.eventName===eventName?[event.args]:[];}catch{return [];}});

// The journal owns state transitions; this only verifies the already-sent exact
// transaction. It never broadcasts, retries a send, or adds another gas charge.
export async function reconcileMarketplaceReview(review,{client,transactionHash,minConfirmations=12}) {
  if (review?.schema!==MARKETPLACE_REVIEW_SCHEMA || !review.transaction || !HASH.test(transactionHash??'')
    || !Number.isSafeInteger(minConfirmations) || minConfirmations<1 || minConfirmations>100) fail('INVALID_MARKETPLACE_RECOVERY');
  if (await client.getChainId()!==P.chainId) fail('WRONG_CHAIN');
  const tx=review.transaction;
  if (tx.type !== '0x0') fail('INVALID_MARKETPLACE_RECOVERY');
  let actual,receipt;
  try { actual=await client.getTransaction({hash:transactionHash});receipt=await client.getTransactionReceipt({hash:transactionHash}); }
  catch(error) { if (/Transaction(NotFound|ReceiptNotFound)Error/.test(error?.name??'')) return {status:'PENDING',transactionHash,publicTransactions:0}; fail('RECEIPT_READ_UNAVAILABLE'); }
  if (!same(actual.hash,transactionHash)||!same(actual.from,tx.from)||!same(actual.to,tx.to)||!same(actual.input,tx.data)
    ||actual.value!==BigInt(tx.value)||!Number.isSafeInteger(actual.nonce)||BigInt(actual.nonce)!==BigInt(tx.nonce)
    ||actual.chainId!==P.chainId||!same(receipt.transactionHash,transactionHash)
    ||!HASH.test(receipt.blockHash??'')||typeof receipt.blockNumber!=='bigint'||receipt.blockNumber<0n
    ||actual.blockNumber!==receipt.blockNumber||!same(actual.blockHash,receipt.blockHash)
    ||!same(receipt.from,tx.from)||!same(receipt.to,tx.to)||!legacyType(actual.type)
    ||!positiveBigInt(actual.gas)||actual.gas>BigInt(tx.gas)||!positiveBigInt(actual.gasPrice)||actual.gasPrice>BigInt(tx.gasPrice)
    ||!absent(actual.maxFeePerGas)||!absent(actual.maxPriorityFeePerGas)||!absent(actual.maxFeePerBlobGas)
    ||(actual.blobVersionedHashes?.length??0)!==0||(actual.accessList?.length??0)!==0
    ||(actual.authorizationList?.length??0)!==0) fail('ORIGINAL_TRANSACTION_MISMATCH');
  if(receipt.status!=='success'&&receipt.status!=='reverted')fail('RECEIPT_STATUS_UNAVAILABLE');
  if(!positiveBigInt(receipt.gasUsed)||receipt.gasUsed>actual.gas||!positiveBigInt(receipt.effectiveGasPrice)
    ||receipt.effectiveGasPrice>actual.gasPrice)fail('RECEIPT_FEE_EVIDENCE_MISMATCH');
  const assertCanonicalReceipt = async () => {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.number !== receipt.blockNumber || !same(block.hash, receipt.blockHash)) fail('RECEIPT_NOT_CANONICAL');
  };
  await assertCanonicalReceipt();
  const head=await client.getBlockNumber();
  if(typeof head!=='bigint'||head<receipt.blockNumber)fail('RECEIPT_NOT_CANONICAL');
  const confirmations=head-receipt.blockNumber+1n;
  if(confirmations<BigInt(minConfirmations))return {status:'PENDING_FINALITY',transactionHash,confirmations:String(confirmations),publicTransactions:0};
  if(receipt.status!=='success') {
    // A terminal revert releases the journal hold too. Recheck after the head
    // read, just as on successful settlement, before allowing that transition.
    await assertCanonicalReceipt();
    return {status:'REVERTED',transactionHash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,
      confirmations:String(confirmations),publicTransactions:0,warning:'Purchase did not complete. The transaction reverted; the wallet may have paid its network fee.'};
  }
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
    if(!review.bidEscrow||!same(review.bidEscrow.address,tx.to)||!HASH.test(review.bidEscrow.codeHash??''))fail('BID_RECOVERY_BINDING_MISSING');
    const escrowCode=await client.getCode({address:tx.to,blockNumber:receipt.blockNumber});
    if(!escrowCode||escrowCode==='0x'||keccak256(escrowCode)!==review.bidEscrow.codeHash)fail('SETTLEMENT_CODE_MISMATCH');
    const events=decode(receipt,tx.to,'BidCreated');
    if(events.length!==1)fail('BID_CREATION_EVIDENCE_MISSING');
    const e=events[0],s=review.selection;
    if(!same(e.funder,review.owner)||!same(e.recipient,review.wallet)||e.punkId!==BigInt(review.punkId)
      ||!same(e.collection,s.collection)||e.tokenId!==BigInt(s.tokenId)||e.priceWei!==BigInt(s.priceWei)
      ||e.anyToken!==s.anyToken||e.deadline!==Number(s.deadline))fail('BID_CREATION_EVIDENCE_MISMATCH');
    result.status='BID_ACTIVE';result.orderHash=e.orderHash;
  } else if(review.action==='CANCEL_WETH_BID') {
    const bid=await readBoundBid(review,client,receipt.blockNumber);
    const cancelled=decode(receipt,tx.to,'BidCancelled').filter(e=>same(e.orderHash,review.selection.orderHash));
    const settled=decode(receipt,tx.to,'BidSettled').filter(e=>same(e.orderHash,review.selection.orderHash));
    if(cancelled.length>1||settled.length>1||(cancelled.length&&settled.length))fail('BID_RECOVERY_EVIDENCE_MISMATCH');
    if(bid[13]===3&&cancelled.length===1){
      if(!same(cancelled[0].funder,review.owner)||cancelled[0].refundedWeth!==bid[5])fail('BID_RECOVERY_EVIDENCE_MISMATCH');
      result.status='BID_CANCELLED';result.refundedWethWei=String(cancelled[0].refundedWeth);result.refundInThisTransaction=true;
    } else if(bid[13]===3&&!cancelled.length&&!settled.length){
      // This transaction performed no refund. Historical terminal state proves
      // that the original refund already occurred in an earlier transaction.
      result.status='BID_ALREADY_CANCELLED';result.refundedWethWei='0';result.refundInThisTransaction=false;
    } else if(bid[13]===2&&!cancelled.length){
      result.status='BID_ALREADY_SETTLED';result.refundedWethWei='0';result.refundInThisTransaction=false;
    } else fail('BID_RECOVERY_EVIDENCE_MISSING');
  } else fail('INVALID_MARKETPLACE_ACTION');
  await assertCanonicalReceipt();
  return result;
}
