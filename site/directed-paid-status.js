export function paidReviewStatus(envelope,now=Date.now()) {
 const r=envelope?.record;
 if(!r)return 'Request a directed paid mint in chat, or review one Peppies World mint here.';
 const job=envelope.execution?.intent_id===r.review.intentId?envelope.execution:null;
 if(job?.status==='COMPLETED')return 'Mint complete. Delivery was verified by both chain providers.';
 if(['SIGNED','SUBMITTED'].includes(job?.status))return 'A mint transaction is awaiting verification. Recheck its receipt; do not fund a replacement.';
 if(job?.status==='STOPPED')return 'Mint stopped before submission. Review mission cancellation, then withdraw the unused funds.';
 if(job?.status==='REVERTED')return 'The mint transaction reverted. Review mission cancellation, then withdraw unused funds.';
 if(r.status==='PREPARED')return now+5000>=r.review.expiresAt
  ?'This quote expired before a wallet request. Cancel the unsent review and prepare a fresh quote.'
  :'Quote ready. Review the amounts, then confirm once in your wallet.';
 if(r.status==='CONFIRMED'&&r.review.action==='AUTHORIZE')return now>=Number(r.review.deadline)*1000
  ?'Mission deadline passed. Recheck for a verified result. If no mint completed, cancel the mission and withdraw unused funds.'
  :'Budget confirmed. Waiting for the worker to submit the mint. Recheck for its result.';
 return {WALLET_REQUESTED:'Wallet confirmation requested. Recheck or recover the original transaction.',
  CONFIRMED:r.review.action==='CANCEL_MISSION'?'Mission cancelled. Withdraw the refund below.':'Refund returned to your wallet.',
  REVERTED:'The wallet transaction reverted. Recheck before preparing another review.',CANCELLED:'Unsent review cancelled.',
  DECLINED:'Wallet confirmation declined. You can prepare a fresh review.'}[r.status];
}
