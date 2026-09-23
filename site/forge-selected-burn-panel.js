import { TRAINING_RELEASE } from './forge-training-release.js';
import { SELECTED_BURN_OWNER,validateSelectedBurnEnvelope,submitSelectedBurn } from './forge-selected-burn-wallet.js';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
const eth=n=>{const value=BigInt(n),f=(value%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${value/10n**18n}${f?'.'+f:''} ETH`;};
export function createSelectedBurnPanel({root,getSelection,ensureSession,request,getProvider=()=>window.__GOGH_WALLET_PROVIDER__,recoveryOnly=false}) {
  if(!root)return null;let envelope=null,busy=false,key='',sequence=0,message='',expiryTimer;
  let draft={reviewKey:null,checked:false,confirmation:'',recoveryId:null,hash:''};
  const available=()=>{const s=getSelection();return TRAINING_RELEASE.status==='OWNER_CANARY'&&s?.owner?.toLowerCase()===SELECTED_BURN_OWNER
    &&String(s.tokenId)==='93'&&s.chainId===4663&&!s.preview;};
  const storage=id=>`gogh-selected-burn-v1:${id}`;
  const saved=id=>{const raw=localStorage.getItem(storage(id));return raw?JSON.parse(raw):null;};
  const persist=(id,data)=>{localStorage.setItem(storage(id),JSON.stringify(data));if(localStorage.getItem(storage(id))!==JSON.stringify(data))throw Error('The wallet recovery record could not be saved.');};
  const api=body=>request('/api/v2/punks/93/forge/selected-burn',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),timeoutMs:55000}:{timeoutMs:45000});
  const statusText=r=>!r?'Check the selected Punks before preparing a transaction.':({PREPARED:Date.now()+5000>=r.review.expiresAt
    ?'This review expired before a wallet request. Cancel the unsent review, then prepare a fresh review. No burn was sent by this review.'
    :'Review ready. No wallet request has been made.',
    WALLET_REQUESTED:'Wallet confirmation is unresolved. Recover or recheck the original transaction; do not send a replacement. A transaction hash alone does not confirm a burn.',
    CONFIRMED:r.review.action==='BURN'?'Burn confirmed: #1753 was destroyed and #93 gained one training credit. Continue with training below.':'Receipt verified by both chain providers. Continue with the next step.',
    REVERTED:'The transaction reverted. Recheck the current state before preparing another review.',CANCELLED:'Unsent review cancelled.',DECLINED:'Wallet confirmation declined. You can prepare a new review.'})[r.status];
  function selectionChanged(){const s=getSelection(),next=`${s?.owner}:${s?.tokenId}:${s?.chainId}:${s?.preview}`;
    if(next!==key){key=next;++sequence;busy=false;envelope=null;message='';draft={reviewKey:null,checked:false,confirmation:'',recoveryId:null,hash:''};render();}}
  async function work(fn){if(busy||!available())return;const ticket=++sequence,selected={...getSelection()},original=key;
    const current=()=>ticket===sequence&&original===key&&available();busy=true;render();
    try{await ensureSession();if(current())await fn(selected,current);}catch(error){if(current())message=error.message;}
    finally{if(current()){busy=false;render();}}}
  async function refresh(selected,current){const result=validateSelectedBurnEnvelope(await api(),selected);if(!current())return;
    envelope=result;const r=result.record,local=r&&saved(r.review.intentId),hash=r&&(local?.hash??r.reportedHash);
    if(r?.status==='WALLET_REQUESTED'&&!hash&&local?.rejectionCode===4001){
      await api({operation:'decline',intentId:r.review.intentId,revision:r.revision,rejectionCode:4001});
      if(!current())return;envelope=validateSelectedBurnEnvelope(await api(),selected);
    }
    if(r?.status==='WALLET_REQUESTED'&&hash){const recovered=await api({operation:'recover',intentId:r.review.intentId,revision:r.revision,transactionHash:hash});
      validateSelectedBurnEnvelope(recovered,selected);if(!current())return;envelope=validateSelectedBurnEnvelope(await api(),selected);}
    if(current())message='';}
  const check=()=>work(refresh);
  const prepare=action=>work(async(selected,current)=>{const result=validateSelectedBurnEnvelope(await api({operation:'prepare',action}),selected);
    if(current()){envelope=result;message='';}});
  const cancel=()=>work(async(selected,current)=>{const r=envelope.record;await api({operation:'cancel',intentId:r.review.intentId,revision:r.revision});
    if(current())await refresh(selected,current);});
  function button(parent,label,action,disabled=false){const b=el('button',label);b.type='button';b.className='filter-button';b.disabled=busy||disabled;b.addEventListener('click',()=>void action());parent.append(b);return b;}
  function render(){clearTimeout(expiryTimer);root.replaceChildren();root.hidden=!available();if(!available())return;
    root.setAttribute('aria-busy',String(busy));
    root.append(el('h3',recoveryOnly?'Previous burn receipt':'BURN #1753 → TRAIN #93'),el('p',recoveryOnly
      ?'Check the original transaction for source #1753 and recipient #93. No new approval or burn can be prepared here.'
      :'Burning permanently destroys Punk #1753 and can remove access to all its wallets, including assets received later. Assets do not move to #93. The burn earns one credit; learning Rarity Eye and equipping it are separate transactions.'));
    const status=el('p',message||(recoveryOnly&&!envelope?'Check the saved transaction status.':statusText(envelope?.record)));status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
    button(root,busy?'CHECKING…':recoveryOnly?'CHECK PREVIOUS TRANSACTION':'RECHECK SELECTED TEST',check);
    const r=envelope?.record;
    if(recoveryOnly&&r?.status!=='WALLET_REQUESTED'){
      if(r?.status==='PREPARED'){root.append(el('p','An unsent review exists. It cannot be submitted from this recovery view.'));button(root,'CANCEL UNSENT REVIEW',cancel);}
      else if(envelope?.state?.credited)root.append(el('p','The original burn credit is recorded. Open Forge to check the current credit balance and skills.'));
      else if(envelope)root.append(el('p','No pending wallet request needs recovery. Public burning remains unavailable.'));
      return;
    }
    if(r?.status==='PREPARED'){
      const v=r.review,nextReviewKey=JSON.stringify([key,r.reviewHash,v]);
      if(draft.reviewKey!==nextReviewKey)draft={...draft,reviewKey:nextReviewKey,checked:false,confirmation:''};
      root.append(el('h4',v.action==='ENABLE_FORGE'?'ENABLE FORGE':v.action==='APPROVE'?'APPROVE ONLY #1753':'CONFIRM THE PERMANENT BURN'),
        el('p',`Maximum network fee: ${eth(v.maximumNetworkFeeWei)}. Transaction value: 0 ETH. Expires ${new Date(v.expiresAt).toLocaleTimeString()}.`));
      if(v.action==='ENABLE_FORGE')root.append(el('p',v.warning));
      if(v.action==='APPROVE')root.append(el('p','This approval applies only to #1753 and has no on-chain expiry. Revoke it in your wallet if you abandon the burn. Approval does not burn the NFT.'));
      let checked=null,confirmation=null;
      if(v.action!=='ENABLE_FORGE'){
        root.append(el('p','The saved checks found no incoming standard token transfers, ETH, WETH, Agent gas deposits or application obligations in #1753’s four wallets. These checks expire with the review. Nonstandard assets and off-chain obligations still require your review.'));
        const label=el('label');checked=el('input');checked.type='checkbox';checked.checked=draft.checked;checked.disabled=busy;
        checked.addEventListener('change',()=>{draft.checked=checked.checked;});label.append(checked,document.createTextNode('I reviewed #1753’s wallets and have no remaining assets, pending transactions or obligations to preserve.'));root.append(label);
      }
      if(v.action==='BURN'){const label=el('label','Type BURN 1753');confirmation=el('input');confirmation.autocomplete='off';confirmation.maxLength=9;
        confirmation.value=draft.confirmation;confirmation.disabled=busy;confirmation.addEventListener('input',()=>{draft.confirmation=confirmation.value;});label.append(confirmation);root.append(label);}
      const attempted=saved(v.intentId)?.attempted===true;
      const confirm=button(root,'CONFIRM IN WALLET',()=>{const accepted=checked?.checked??false,text=confirmation?.value??'';
        if(checked&&!accepted){message='Review the source wallets and check the confirmation first.';render();return;}
        if(confirmation&&text!=='BURN 1753'){message='Type BURN 1753 to confirm the permanent burn.';render();return;}
        return work(async(selected,current)=>{
          const before=envelope;
          try{await submitSelectedBurn({envelope:before,selected,provider:getProvider(),isCurrent:current,
            persistAttempt:async id=>persist(id,{attempted:true}),persistHash:async(id,hash)=>persist(id,{attempted:true,hash}),
            claim:record=>api({operation:'claim',intentId:record.review.intentId,revision:record.revision,reviewHash:record.reviewHash,
              confirmation:text,obligationsReviewed:accepted})});}
          catch(error){if(error.code===4001)persist(before.record.review.intentId,
            {...saved(before.record.review.intentId),attempted:true,rejectionCode:4001});throw error;}
          finally{if(current())await refresh(selected,current);}
        });},attempted||Date.now()+5000>=v.expiresAt);
      if(Date.now()+5000<v.expiresAt)expiryTimer=setTimeout(()=>{confirm.disabled=true;if(!message)status.textContent=statusText(envelope.record);},v.expiresAt-Date.now()-5000+10);
      button(root,'CANCEL UNSENT REVIEW',cancel);
      const d=el('details');d.append(el('summary','Exact transaction and source checks'),el('pre',JSON.stringify(v,null,2)));root.append(d);return;
    }
    if(r?.status==='WALLET_REQUESTED'){
      draft.reviewKey=null;draft.checked=false;draft.confirmation='';
      if(draft.recoveryId!==r.review.intentId)draft={...draft,recoveryId:r.review.intentId,hash:saved(r.review.intentId)?.hash??r.reportedHash??''};
      const label=el('label','Transaction hash from wallet activity'),input=el('input');input.maxLength=66;input.placeholder='0x…';input.value=draft.hash;input.disabled=busy;
      input.addEventListener('input',()=>{draft.hash=input.value;});label.append(input);root.append(label);
      button(root,'RECOVER ORIGINAL TRANSACTION',()=>{const hash=input.value.trim().toLowerCase();return work(async(selected,current)=>{
        if(!/^0x[0-9a-f]{64}$/.test(hash))throw Error('Enter the full transaction hash.');persist(r.review.intentId,{attempted:true,hash});await refresh(selected,current);});});return;
    }
    draft.reviewKey=null;draft.checked=false;draft.confirmation='';
    if(!envelope?.state)return;
    if(envelope.state.credited){root.append(el('p',`#93 currently has ${envelope.state.credits} training credit(s). Recheck training below to learn Rarity Eye.`));return;}
    if(envelope.state.paused)button(root,'REVIEW ENABLE FORGE',()=>prepare('ENABLE_FORGE'));
    else if(envelope.state.approved!==TRAINING_RELEASE.trainingSource)button(root,'REVIEW #1753 APPROVAL',()=>prepare('APPROVE'));
    else button(root,'REVIEW BURN #1753 → CREDIT #93',()=>prepare('BURN'));
  }
  selectionChanged();return {selectionChanged,destroy(){++sequence;clearTimeout(expiryTimer);}};
}
