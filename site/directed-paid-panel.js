import {PAID_RELEASE} from './directed-paid-release.js';
import {validatePaidEnvelope,submitDirectedPaid} from './directed-paid-wallet.js';
import {paidReviewStatus} from './directed-paid-status.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
const eth=n=>{const v=BigInt(n),f=(v%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${v/10n**18n}${f?'.'+f:''} ETH`;};
export function createDirectedPaidPanel({root,getSelection,ensureSession,request,getProvider=()=>window.__GOGH_WALLET_PROVIDER__}){
 if(!root)return null;let envelope=null,key='',sequence=0,busy=false,message='',maximumPriceWei=null,expiryTimer;
 const available=()=>{const s=getSelection();return PAID_RELEASE.status==='OWNER_CANARY'&&PAID_RELEASE.productionPaidMintAuthorized===true
  &&s?.owner?.toLowerCase()===PAID_RELEASE.owner&&String(s.tokenId)==='93'&&s.chainId===4663&&!s.preview;};
 const storage=id=>`gogh-directed-paid-v1:${id}`;
 const saved=id=>{const value=localStorage.getItem(storage(id));return value?JSON.parse(value):null;};
 const persist=(id,value)=>{const text=JSON.stringify(value);localStorage.setItem(storage(id),text);if(localStorage.getItem(storage(id))!==text)throw Error('The mint recovery record could not be saved.');};
 const api=body=>request('/api/v2/punks/93/directed-paid-mint',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),timeoutMs:55000}:{timeoutMs:45000});
 function selectionChanged(){const s=getSelection(),next=`${s?.owner}:${s?.tokenId}:${s?.chainId}:${s?.preview}`;
  if(next!==key){key=next;++sequence;busy=false;envelope=null;message='';maximumPriceWei=null;render();}}
 async function work(fn){if(busy||!available())return;const ticket=++sequence,selection={...getSelection()},original=key;
  const current=()=>ticket===sequence&&original===key&&available();busy=true;render();
  try{await ensureSession();if(current())await fn(selection,current);}catch(error){if(current())message=error.message;}
  finally{if(current()){busy=false;render();}}}
 async function refresh(selection,current){
  const result=validatePaidEnvelope(await api(),selection);if(!current())return;envelope=result;
  const r=result.record,local=r&&saved(r.review.intentId),hash=local?.hash??r?.reportedHash;
  if(r?.status==='WALLET_REQUESTED'&&(!hash&&local?.rejectionCode===4001||hash)){
   const body=hash?{operation:'recover',intentId:r.review.intentId,revision:r.revision,transactionHash:hash}:
    {operation:'decline',intentId:r.review.intentId,revision:r.revision,rejectionCode:4001};
   await api(body);if(!current())return;envelope=validatePaidEnvelope(await api(),selection);
  }
  if(current())message='';
 }
 const check=()=>work(refresh);
 const prepare=action=>work(async(selection,current)=>{const result=validatePaidEnvelope(await api({operation:'prepare',action,maximumPriceWei:action==='AUTHORIZE'?maximumPriceWei:null}),selection);
  if(current()){envelope=result;message='';}});
 function button(label,action,disabled=false){const b=el('button',label);b.type='button';b.className='filter-button';b.disabled=busy||disabled;b.addEventListener('click',()=>void action());root.append(b);return b;}
 function render(){clearTimeout(expiryTimer);root.replaceChildren();root.hidden=!available();if(!available())return;
  root.append(el('h3','DIRECTED PAID MINT · PUNK #93'),el('p','One Peppies World NFT. Approve the exact mint price and fixed worker fee once; the worker mints and delivers to #93’s Agent wallet before the mission expires.'));
  const matchingExecution=Boolean(envelope?.execution&&envelope.execution.intent_id===envelope?.record?.review.intentId);
  const status=el('p',message||paidReviewStatus(envelope));status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
  const deadline=envelope?.record?.status==='CONFIRMED'&&envelope.record.review.action==='AUTHORIZE'?Number(envelope.record.review.deadline)*1000:null;
  if(deadline>Date.now())expiryTimer=setTimeout(()=>{if(!message)status.textContent=paidReviewStatus(envelope);},deadline-Date.now()+10);
  button(busy?'CHECKING…':'RECHECK PAID MINT',check);
  const execution=envelope?.execution;
  if(execution){
   const text=execution.status==='COMPLETED'?`Delivered Peppies World #${execution.receipt.tokenId} to #93’s Agent wallet.`:
    execution.status==='STOPPED'?`Mint stopped: ${execution.reason.replaceAll('_',' ').toLowerCase()}. Cancel the mission and withdraw the unused funds below.`:
    execution.status==='REVERTED'?'The worker transaction reverted. The mint budget remains in escrow; cancel the mission and withdraw unused funds.':
    'The worker transaction is being reconciled. Recheck for verified delivery.';
   root.append(el('p',(matchingExecution?'':'Previous mint: ')+text));if(execution.transaction_hash){const link=el('a','View mint transaction');link.href=`https://explorer.mainnet.chain.robinhood.com/tx/${execution.transaction_hash}`;link.target='_blank';link.rel='noopener noreferrer';root.append(link);}
  }
  const record=envelope?.record;
  if(record?.status==='PREPARED'){
   const v=record.review;
   root.append(el('h4',v.action==='AUTHORIZE'?'REVIEW ONE MINT':v.action==='CANCEL_MISSION'?'CANCEL FUNDED MISSION':'WITHDRAW REFUND'));
   if(v.action==='AUTHORIZE'){
    root.append(el('p',`Mint price: ${eth(v.priceWei)}. Fixed worker fee: ${eth(v.executionFeeWei)}. Total escrow: ${eth(BigInt(v.priceWei)+BigInt(v.executionFeeWei))}.`),
     el('p',`Peppies World contract: ${v.targetCollection}`),el('p',`NFT destination: #93 Agent · ${v.recipient}`),
     el('p',`Mission expires ${new Date(Number(v.deadline)*1000).toLocaleTimeString()}. The worker fee is paid only after successful delivery. If the mint cannot complete, cancel the mission and then withdraw its refund in two wallet transactions.`));
   }else if(v.action==='WITHDRAW_REFUND')root.append(el('p',`${eth(v.refundWei)} returns to your connected owner wallet.`));
   else root.append(el('p','Cancellation moves unused escrow to your refund balance. Withdraw it in a separate wallet transaction. A mint already completed cannot be cancelled.'));
   root.append(el('p',`Maximum wallet network fee: ${eth(v.maximumNetworkFeeWei)}. Quote expires ${new Date(v.expiresAt).toLocaleTimeString()}.`));
   const confirm=button(v.action==='AUTHORIZE'?'CONFIRM MINT BUDGET IN WALLET':'CONFIRM IN WALLET',()=>work(async(selection,current)=>{
    const before=envelope;
    try{await submitDirectedPaid({envelope:before,selected:selection,provider:getProvider(),isCurrent:current,
     persistAttempt:async id=>persist(id,{attempted:true}),persistHash:async(id,hash)=>persist(id,{attempted:true,hash}),
     claim:r=>api({operation:'claim',intentId:r.review.intentId,revision:r.revision,reviewHash:r.reviewHash})});}
    catch(error){if(error.code===4001)persist(before.record.review.intentId,{...saved(before.record.review.intentId),attempted:true,rejectionCode:4001});throw error;}
    finally{if(current())await refresh(selection,current);}
   }),saved(v.intentId)?.attempted===true||Date.now()+5000>=v.expiresAt);
   if(Date.now()+5000<v.expiresAt)expiryTimer=setTimeout(()=>{confirm.disabled=true;if(!message)status.textContent=paidReviewStatus(envelope);},v.expiresAt-Date.now()-5000+10);
   button('CANCEL UNSENT REVIEW',()=>work(async(selection,current)=>{await api({operation:'cancel',intentId:v.intentId,revision:record.revision});if(current())await refresh(selection,current);}));
   const details=el('details');details.append(el('summary','Exact transaction'),el('pre',JSON.stringify(v,null,2)));root.append(details);return;
  }
  if(record?.status==='WALLET_REQUESTED'){
   const label=el('label','Transaction hash from wallet activity'),input=el('input');input.placeholder='0x…';input.maxLength=66;input.value=saved(record.review.intentId)?.hash??record.reportedHash??'';label.append(input);root.append(label);
   button('RECOVER ORIGINAL TRANSACTION',()=>{const hash=input.value.trim().toLowerCase();return work(async(selection,current)=>{
    if(!/^0x[0-9a-f]{64}$/.test(hash))throw Error('Enter the full transaction hash.');persist(record.review.intentId,{attempted:true,hash});await refresh(selection,current);});});return;
  }
  if(envelope?.state?.missionStatus===1)button('REVIEW MISSION CANCELLATION',()=>prepare('CANCEL_MISSION'));
  else button('REVIEW ONE PEPPIES WORLD MINT',()=>prepare('AUTHORIZE'));
  if(BigInt(envelope?.state?.refundWei??0)>0n)button(`REVIEW REFUND · ${eth(envelope.state.refundWei)}`,()=>prepare('WITHDRAW_REFUND'));
 }
 async function openDraft(draft){if(!available())return;
  if(draft?.collection!==PAID_RELEASE.targetCollection||draft.quantity!==1||!(draft.maximumPriceWei===null||/^[1-9][0-9]{0,15}$/.test(draft.maximumPriceWei)))throw Error('The paid-mint request does not match this test.');
  maximumPriceWei=draft.maximumPriceWei;await check();root.scrollIntoView({behavior:'smooth',block:'start'});
  if(!busy&&(!envelope?.record||['CONFIRMED','REVERTED','CANCELLED','DECLINED'].includes(envelope.record.status))&&envelope?.state?.missionStatus!==1)await prepare('AUTHORIZE');
 }
 selectionChanged();return {selectionChanged,openDraft,destroy(){++sequence;clearTimeout(expiryTimer);}};
}
