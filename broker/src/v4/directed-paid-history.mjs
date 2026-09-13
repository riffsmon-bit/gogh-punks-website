import {paidAssert,paidSame,validatePaidRelease} from './directed-paid-mint.mjs';
import {paidDigest} from './directed-paid-store.mjs';
// Read only the columns granted to the request role. Never select or return
// the worker's signed bytes. Collection still verifies current NFT custody.
export async function readDirectedPaidHistory(pool,release){
 const r=validatePaidRelease(release);
 const rows=(await pool.query(`SELECT e.intent_id,e.status,e.transaction_hash,e.receipt,e.reason,e.created_at,
  r.review_json,r.review_hash FROM broker_selected_paid_executions e JOIN broker_selected_paid_reviews r USING(intent_id)
  ORDER BY e.created_at DESC LIMIT 250`)).rows;
 const activity=[],candidates=[];
 for(const row of rows){
  const review=JSON.parse(row.review_json);paidAssert(paidDigest(review)===row.review_hash&&review.owner===r.owner&&review.tokenId==='93'
   &&review.action==='AUTHORIZE'&&review.intentId===row.intent_id,'PAID_HISTORY_CHANGED');
  const receipt=row.receipt,acquiredAt=receipt?.blockTimestamp?new Date(Number(receipt.blockTimestamp)*1000).toISOString():new Date(row.created_at).toISOString();
  if(row.status==='COMPLETED'){
   paidAssert(receipt?.status==='COMPLETED'&&receipt.transactionHash===row.transaction_hash&&paidSame(receipt.collection,r.targetCollection)
    &&paidSame(receipt.recipient,r.recipient)&&receipt.verifiedProviders===2&&/^[0-9]+$/.test(receipt.tokenId),'PAID_HISTORY_CHANGED');
   candidates.push({collection:r.targetCollection,tokenId:receipt.tokenId,standard:'ERC721',amount:'1',acquiredAt,
    provenance:'V2',acquisitionType:'V2_DIRECTED_PAID_MINT',mintCostWei:review.priceWei,executionFeeWei:review.executionFeeWei,
    custodyAccount:r.recipient,custodyType:'PUNK_AGENT_ACCOUNT',transactionHash:row.transaction_hash,artwork:null,withdrawControlUrl:null});
  }
  activity.push({id:`paid:${row.intent_id}`,type:`PAID_MINT_${row.status}`,provenance:'V2',occurred_at:acquiredAt,
   detail:{collection:r.targetCollection,tokenId:receipt?.tokenId??null,priceWei:review.priceWei,executionFeeWei:review.executionFeeWei,
    transactionHash:row.transaction_hash,recipient:r.recipient,reason:row.reason}});
 }
 return {activity,candidates};
}
