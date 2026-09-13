const $=selector=>document.querySelector(selector),text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
const eth=value=>{const n=BigInt(value),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${n/10n**18n}${fraction?'.'+fraction:''}`;};
let state=null,busy=false,reviewId=null,notice=null;
const finished=new Set(['COMPLETED','BID_ACTIVE','BID_EXPIRED','BID_FILLED','BID_CANCELLED','BID_ALREADY_CANCELLED','BID_ALREADY_SETTLED','REVERTED','CANCELLED']);
const names={BUY_LISTINGS:'Buy selected practice NFTs',CREATE_WETH_BID:'Create a practice WETH offer',CANCEL_WETH_BID:'Cancel this practice offer'};
const labels={COMPLETED:'Purchase complete. The copied Punk received its NFTs.',BID_ACTIVE:'Offer active. Play the seller below, or cancel it.',
 BID_EXPIRED:'Offer expired. Cancel it to return the unused WETH; expiry alone does not refund it.',
 BID_CANCELLED:'Offer cancelled. Unused WETH was returned.',BID_ALREADY_CANCELLED:'This offer was already cancelled. No second refund was made.',
 BID_ALREADY_SETTLED:'This offer already filled. No refund was made.',BID_FILLED:'Offer filled. The practice NFT is in the copied Punk Wallet.',
 REVERTED:'The copied transaction reverted. No purchase completed; its network fee may have been paid.',REVIEW_CANCELLED:'Unsent review discarded. Choose another practice mission.'};
const errors={PRACTICE_REVIEW_EXPIRED:'This review expired. Nothing was sent. Discard it and prepare a fresh review.',
 PRACTICE_TRANSACTION_PENDING:'A copied transaction is still pending. Recheck its original result before continuing.',
 PRACTICE_TRANSACTION_CLAIMED:'A copied transaction needs verification. Recheck its original result; it will not be sent again.',
 PRACTICE_RECOVERY_LIMIT:'The original copied transaction needs a longer history than this practice can check. It will not send a replacement.',
 PRACTICE_NONCE_CONFLICT:'Another copied transaction used this review’s place. This review will not be sent again.',
 PRACTICE_SESSION_FULL:'This practice session is full. Start a fresh disposable practice to continue.'};
function render(){
 const r=state?.review,prepared=r?.status==='PREPARED',pending=r&&!prepared&&!finished.has(r.status),expired=prepared&&Date.now()+5000>=r.expiresAt;
 for(const b of document.querySelectorAll('[data-action]'))b.disabled=busy||state?.busy||(!state&&b.dataset.action!=='recheck');
 for(const action of ['buy-one','buy-two','bid-one','bid-collection'])$(`[data-action="${action}"]`).disabled=!state||busy||state.busy||prepared||pending;
 $('#review').hidden=!prepared;$('#bids').hidden=!state?.bids.length;
 if(reviewId!==r?.id){reviewId=r?.id;$('#confirmation').value='';}
 if(prepared){const detail=$('#review-detail');detail.replaceChildren(text('p',names[r.action]),
  text('p',`Price: ${eth(r.cost.totalPriceWei)} ${r.action==='CANCEL_WETH_BID'?'ETH to cancel':'ETH in copied funds'}`),
  text('p',`Maximum network fee: ${eth(r.cost.maximumNetworkFeeWei)} ETH.`),text('p',expired?'Review expired. Discard it and prepare a fresh one.':`Review expires ${new Date(r.expiresAt).toLocaleTimeString()}.`));
  if(r.selection.items)detail.append(text('p',`Practice NFT${r.selection.items.length>1?'s':''}: ${r.selection.items.map(i=>'#'+i.tokenId).join(', ')}`));
  if(r.action==='CREATE_WETH_BID')detail.append(text('p',`If funded, the offer ends ${new Date(Number(r.selection.deadline)*1000).toLocaleString()}. This is separate from the review expiry above.`));
  if(r.action==='CANCEL_WETH_BID')detail.append(text('p',`Up to ${eth(r.selection.maximumRefundWei)} WETH returns to the copied funder if this offer is still unfilled. A filled or previously cancelled offer does not pay another refund.`));
  $('[data-action="confirm"]').disabled=busy||state.busy||expired||$('#confirmation').value!=='CONFIRM COPY';}
 const error=notice??state?.lastError;
 $('#status').textContent=busy?'Checking the copied chain…':error?(errors[error]??'The check could not finish. Retry the saved result; no replacement is sent automatically.'):
  !state?'Could not load practice. Retry the connection below.':labels[state.lastResult?.status]??(expired?'This review expired. Nothing was sent. Discard it to choose another mission.':prepared?'Review ready. Confirm only when the copied amounts look right.':pending?'A copied transaction needs verification. Recheck its original result; it will not be sent again.':'Choose a practice mission.');
 $('[data-action="recheck"]').textContent=state?'RECHECK ORIGINAL RESULT':'RETRY CONNECTION';
 $('#balances').textContent=state?`Copied Punk Wallet: ${eth(state.balance.nativeWei)} ETH · Copied funder: ${eth(state.balance.funderWethWei)} WETH`:'';
 $('#result').replaceChildren();if(state?.lastResult?.items)$('#result').append(text('p',`Received ${state.lastResult.items.map(i=>'#'+i.tokenId).join(', ')}.`));
 if(state?.lastResult?.status==='BID_FILLED')$('#result').append(text('p',`Received practice NFT #${state.lastResult.tokenId}. Delivery checked on the copied chain.`));
 const list=$('#bid-list');list.replaceChildren();for(const bid of state?.bids??[]){const row=text('div','');row.className='bid';row.dataset.orderHash=bid.orderHash;
  const status=bid.status==='FILLED'?'Filled · NFT received':bid.status==='BID_CANCELLED'?'Cancelled':bid.fillState==='REQUESTED'?'Checking original seller transaction':bid.fillState==='REVERTED'?'Seller attempt reverted · cancel to recover WETH':bid.status==='BID_EXPIRED'?'Expired · cancel to recover WETH':'Active';
  row.append(text('p',`${bid.anyToken?'Collection offer':'NFT #'+bid.tokenId+' offer'} · ${status}`));
  if(Number.isSafeInteger(bid.expiresAt))row.append(text('p',`Offer deadline: ${new Date(bid.expiresAt).toLocaleString()}.`));
  for(const [label,operation]of [['PLAY SELLER · FILL OFFER','fill_bid'],['REVIEW CANCELLATION','prepare_cancel']]){const b=text('button',label);b.dataset.operation=operation;
   b.disabled=busy||state.busy||prepared||pending||(operation==='fill_bid'&&(bid.status!=='BID_ACTIVE'||bid.fillState!=null));
   b.addEventListener('click',()=>act(operation,{orderHash:bid.orderHash}));row.append(b);}list.append(row);}
}
async function fetchState(){const r=await fetch('/api/state',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('STATE_UNAVAILABLE');const next=await r.json();if(next.schema!=='GOGH_MARKETPLACE_PRACTICE_V1'||next.localOnly!==true||next.productionAuthority!==false)throw Error('STATE_UNAVAILABLE');return next;}
async function reload(){if(busy)return;busy=true;notice=null;render();try{state=await fetchState();}catch{notice='PRACTICE_CHECK_UNAVAILABLE';}finally{busy=false;render();}}
async function act(operation,input={}){if(busy||!state)return;busy=true;notice=null;render();try{
 const r=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json','x-practice-nonce':state.nonce},body:JSON.stringify({operation,input}),signal:AbortSignal.timeout(60000)});
 const payload=await r.json();if(!r.ok){notice=typeof payload.code==='string'?payload.code:'PRACTICE_CHECK_UNAVAILABLE';state=await fetchState();}else state=payload;
 }catch{try{state=await fetchState();}catch{}notice='PRACTICE_CHECK_UNAVAILABLE';}finally{busy=false;render();}}
const actions={'buy-one':()=>act('prepare_purchase',{quantity:1}),'buy-two':()=>act('prepare_purchase',{quantity:2}),'bid-one':()=>act('prepare_bid',{anyToken:false}),'bid-collection':()=>act('prepare_bid',{anyToken:true}),
 confirm:()=>act('confirm',{reviewId:state.review.id,phrase:$('#confirmation').value}),
 'cancel-review':()=>act('cancel_review',{reviewId:state.review.id}),recheck:()=>state?act('recheck'):reload()};
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',()=>actions[b.dataset.action]?.());
$('#confirmation').addEventListener('input',render);setInterval(()=>{if(state?.review?.status==='PREPARED')render();},1000);
reload();
