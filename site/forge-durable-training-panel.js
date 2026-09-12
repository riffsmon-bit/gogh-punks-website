import { TRAINING_RELEASE, TRAINING_BINDING } from './forge-training-release.js';
import { createDurableTrainingWallet, validateDurableTrainingSnapshot } from './forge-durable-wallet.js';
import { keccak256Hex } from './keccak256.js';

const ZERO=`0x${'0'.repeat(64)}`;
const TERMINAL=['EXPIRED','CANCELLED','SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED'];
const element=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
const eth=value=>{const n=BigInt(value),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${n/10n**18n}${fraction?`.${fraction}`:''} ETH`;};
const randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const researchActions=new Map([[3,'inspect_contract'],[4,'rank_trait_sample'],[8,'get_market_listings']].map(([id,action])=>[
  keccak256Hex(`0x${BigInt(id).toString(16).padStart(64,'0')}${'1'.padStart(64,'0')}`),action]));

// Lives inside the existing V2 Forge tab. Talk, mint review and the shared gas
// funding component retain their current behavior. No wallet request on mount.
export function createDurableTrainingPanel({root,getSelection,ensureSession,request,
  release=TRAINING_RELEASE,binding=TRAINING_BINDING,getProvider=()=>window.__GOGH_WALLET_PROVIDER__}) {
  if(!root)return null;
  let key='',sequence=0,busy=false,snapshot=null,envelope=null,journal=null,message='',researchResult=null;
  const selectionKey=()=>{const s=getSelection();return s?.owner?`${s.owner.toLowerCase()}:${s.tokenId}:${s.chainId}:${s.preview}`:'';};
  const storageKey=()=>`gogh-forge-review-v1:${binding?.deploymentHash??'unreleased'}:${key}`;
  const readJournal=storage=>{const raw=localStorage.getItem(storage);if(!raw)return null;
    const value=JSON.parse(raw);if(!value || !/^[0-9a-f]{64}$/.test(value.requestKey)
      || typeof value.attempted!=='boolean' || !value.action || typeof value.action.operation!=='string')throw Error('Saved training review could not be read.');return value;};
  const persist=(value,storage=storageKey())=>{localStorage.setItem(storage,JSON.stringify(value));
    if(localStorage.getItem(storage)!==JSON.stringify(value))throw Error('Save the pending review before continuing.');
    if(storage===storageKey())journal=value;};
  const api=(selected,body=null,intentId=null)=>request(`/api/v2/punks/${selected.tokenId}/forge/training${intentId?`?intentId=${encodeURIComponent(intentId)}`:''}`,
    body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),timeoutMs:45000}:{});
  const available=()=>{const s=getSelection();return release.status==='OWNER_CANARY' && binding && s && !s.preview
    && s.chainId===4663 && release.allowedOwners.includes(s.owner?.toLowerCase());};
  function selectionChanged(){const current=selectionKey();if(current===key)return;
    key=current;++sequence;busy=false;snapshot=null;envelope=null;journal=null;message='';researchResult=null;
    if(available())try{journal=readJournal(storageKey());}catch(error){message=error.message;}
    render();
  }
  function button(parent,label,action,disabled=false){const node=element('button',label);node.type='button';node.className='filter-button';node.disabled=busy||disabled;
    node.addEventListener('click',()=>void action());parent.append(node);return node;}
  async function work(fn){if(busy)return;const ticket=++sequence,selected={...getSelection()},original=key;
    busy=true;render();try{await fn(selected,()=>ticket===sequence&&original===selectionKey());}
    catch(error){if(ticket===sequence&&original===selectionKey())message=error.message;}
    finally{if(ticket===sequence&&original===selectionKey()){busy=false;render();}}}
  const validate=(payload,selected)=>validateDurableTrainingSnapshot(payload,selected,{release,binding});
  async function refresh(selected,current){
    let saved=journal;
    if(saved && !saved.intentId){const prepared=await api(selected,{operation:'prepare',requestKey:saved.requestKey,action:saved.action});
      if(!current())return;saved={...saved,intentId:prepared.record.intentId};persist(saved);envelope=prepared;}
    let payload=validate(await api(selected,null,saved?.intentId),selected);
    if(!current())return;
    if(saved?.transactionHash && payload.record && !payload.record.transactionHash && !TERMINAL.includes(payload.record.status)){
      await api(selected,{operation:'recover',intentId:saved.intentId,revision:payload.record.revision,transactionHash:saved.transactionHash});
      if(!current())return;payload=validate(await api(selected,null,saved.intentId),selected);
    }
    if(!current())return;
    if(snapshot?.state.nonce!==payload.state.nonce||snapshot?.state.stateHash!==payload.state.stateHash)researchResult=null;
    snapshot=payload;
    if(payload.record?.status==='PREPARED' && saved){const prepared=await api(selected,{operation:'prepare',requestKey:saved.requestKey,action:saved.action});if(!current())return;envelope=prepared;}
    if(payload.record && TERMINAL.includes(payload.record.status)){localStorage.removeItem(storageKey());journal=null;envelope=null;}
    message=payload.record?statusText(payload.record.status):payload.held?'A previous training transaction is still settling. Recheck before starting another.':'Training state verified. Choose an action to review.';
  }
  const check=()=>work(async(selected,current)=>{await ensureSession();if(current())await refresh(selected,current);});
  const research=skillKey=>work(async(selected,current)=>{
    researchResult=null;const action=researchActions.get(skillKey);if(!action)throw Error('This research action is not available.');
    const sampleTokenIds=action==='rank_trait_sample'?[String(selected.tokenId),
      document.querySelector('[data-forge-sample-two]')?.value.trim(),document.querySelector('[data-forge-sample-three]')?.value.trim()]:undefined;
    const result=await request(`/api/v2/punks/${selected.tokenId}/forge/skill`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action,skillKey,...(sampleTokenIds?{sampleTokenIds}:{})}),timeoutMs:45000});
    if(!current())return;
    if(result.ok!==true||result.mode!=='EQUIPPED_RESEARCH'||result.owner!==selected.owner?.toLowerCase()||result.tokenId!==String(selected.tokenId)
      ||result.skillKey!==skillKey||result.action!==action||result.chainId!==4663||result.walletAuthority!=='NONE'||result.canBurn!==false)throw Error('Research response could not be verified.');
    researchResult=result;message='Equipped research completed.';
  });
  const prepare=action=>work(async(selected,current)=>{
    await ensureSession();if(!current())return;
    researchResult=null;
    const saved={requestKey:randomKey(),action,intentId:null,attempted:false,transactionHash:null};persist(saved);
    const result=await api(selected,{operation:'prepare',requestKey:saved.requestKey,action});if(!current())return;
    persist({...saved,intentId:result.record.intentId});
    const verified=validate(await api(selected,null,result.record.intentId),selected);if(!current())return;
    snapshot=verified;envelope=result;
    message='Review this exact action and maximum network fee before confirming.';
  });
  const confirm=()=>work(async(selected,current)=>{
    if(!envelope || !journal)throw Error('Prepare a training review first.');
    const saved=structuredClone(journal),storage=storageKey();
    const wallet=createDurableTrainingWallet({provider:getProvider(),release,binding,isCurrent:current,
      wasAttempted:()=>readJournal(storage)?.attempted===true,
      markAttempted:async()=>persist({...saved,attempted:true},storage),
      readCurrent:intentId=>api(selected,null,intentId),
      claim:(intentId,revision,reviewHash)=>api(selected,{operation:'claim',intentId,revision,reviewHash})});
    try{
      const result=await wallet.submit(envelope,selected,saved.action);
      persist({...saved,attempted:true,transactionHash:result.transactionHash},storage);
      if(current())await refresh(selected,current);
    }catch(error){if(current())try{await refresh(selected,current);}catch{/* Preserve the attempted marker for the next recheck. */}throw error;}
  });
  const cancel=()=>work(async(selected,current)=>{
    const record=envelope?.record;if(!record)return;
    await api(selected,{operation:'cancel',intentId:record.intentId,revision:record.revision});
    if(current())await refresh(selected,current);
  });
  function statusText(status){return ({PREPARED:'Review ready. A wallet transaction has not been requested.',
    WALLET_REQUESTED:'Confirmation was reserved. Recheck or recover the transaction hash; this review will not open another wallet request.',
    SUBMISSION_UNKNOWN:'The wallet result is unknown. Recover the transaction hash or complete/cancel the pending transaction in your wallet, then recheck.',
    SUBMITTED:'Transaction submitted. Waiting for its receipt.',INCLUDED_SUCCESS:'Training confirmed. Waiting for settlement before the next action.',
    INCLUDED_REVERT:'The transaction reverted. Waiting for settlement before the next review.',REORGED:'The receipt changed. Checking the canonical transaction again.',
    SETTLED_SUCCESS:'Training settled. You can review the next action.',SETTLED_REVERT:'The reverted transaction settled. Refresh and prepare a new review.',
    NONCE_CONSUMED:'The pending wallet reservation has settled. Check the current loadout before continuing.',
    REVIEW_EXPIRED:'The old review expired on chain. A delayed transaction cannot train, but may still use its reviewed gas. Complete or cancel any pending wallet transaction before retrying.',
    CANCELLED:'Review cancelled.',EXPIRED:'The unsent review expired. Prepare a new review.'})[status]??'Recheck training status.';}
  function render(){root.replaceChildren();root.append(element('h3','PERMANENT TRAINING'));
    if(!available()){root.append(element('p',release.status==='UNDEPLOYED'
      ?'Live training contracts are awaiting deployment. The existing mint missions and gas controls remain available in Talk.'
      :'Training is not enabled for the selected owner.'));
      button(root,'LEARN · NOT LIVE',()=>{},true);button(root,'EQUIP · NOT LIVE',()=>{},true);button(root,'SACRIFICE · LOCKED',()=>{},true);return;}
    const status=element('p',message||'Check your current owner and training state.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
    button(root,busy?'CHECKING…':'RECHECK TRAINING',check);
    if(envelope?.record.status==='PREPARED' && journal && !journal.attempted){const review=envelope.record.review,skill=release.skills.find(item=>item.key===review.action.skillKey);
      root.append(element('h4',`${review.action.operation.replace('_',' ').toUpperCase()}${skill?` · ${skill.name}`:''}`),
        element('p',`Punk #${review.tokenId}${['equip','unequip'].includes(review.action.operation)?` · Slot ${review.action.slot+1}`:''} · ${['learn','unlock'].includes(review.action.operation)?'1 training credit':'No training credit charged'}`),
        element('p',`Maximum network fee: ${eth(BigInt(review.transaction.gas)*BigInt(review.transaction.maxFeePerGas))}. No ETH is sent to the contract.`),
        element('p',`Expires ${new Date(Number(review.guard.deadline)*1000).toLocaleTimeString()}.`));
      const details=element('details');details.append(element('summary','Transaction details'),element('pre',JSON.stringify(envelope.transaction,null,2)));root.append(details);
      button(root,'CONFIRM IN WALLET',confirm,Number(review.guard.deadline)*1000<=Date.now()+5000);button(root,'CANCEL REVIEW',cancel);return;}
    if(journal?.attempted){
      if(snapshot?.record?.transactionHash){const link=element('a','VIEW TRAINING TRANSACTION ↗');
        link.href=`https://robinhoodchain.blockscout.com/tx/${snapshot.record.transactionHash}`;link.target='_blank';link.rel='noopener noreferrer';root.append(link);return;}
      if(snapshot?.record?.status==='PREPARED' && envelope){button(root,'CANCEL IF UNSENT',cancel);return;}
      root.append(element('p','A wallet request may have been submitted. Recheck its status; do not resend it.'));
      const label=element('label','Transaction hash from your wallet');const input=element('input');input.type='text';input.maxLength=66;input.placeholder='0x…';label.append(input);root.append(label);
      button(root,'RECOVER TRANSACTION',()=>work(async(selected,current)=>{const value=input.value.trim().toLowerCase();
        if(!/^0x[0-9a-f]{64}$/.test(value))throw Error('Enter the full transaction hash from your wallet.');
        persist({...journal,transactionHash:value});await refresh(selected,current);}));return;}
    if(!snapshot || snapshot.held || journal)return;
    const s=snapshot.state;root.append(element('p',`${s.credits} training credit(s) · ${s.slots} unlocked slot(s)`));
    if(s.claimed===0)button(root,'REVIEW RARITY SLOTS',()=>prepare({operation:'claim_rarity'}));
    button(root,'REVIEW UNLOCK SLOT · 1 CREDIT',()=>prepare({operation:'unlock'}),s.claimed===0||s.slots>=7||BigInt(s.credits)<1n);
    for(const skill of s.skills){const row=element('article');row.append(element('h4',skill.name));
      if(skill.level===0)button(row,'REVIEW LEARN · 1 CREDIT',()=>prepare({operation:'learn',skillKey:skill.key}),!skill.available||BigInt(s.credits)<1n);
      else{const label=element('label','Equip in slot');const select=element('select');for(let slot=0;slot<s.slots;slot++){const option=element('option',`Slot ${slot+1}`);option.value=String(slot);select.append(option);}label.append(select);row.append(label);
        button(row,'REVIEW EQUIP',()=>prepare({operation:'equip',skillKey:skill.key,slot:Number(select.value)}),!skill.available||s.equipped.includes(skill.key));}
      if(skill.level===1&&skill.available&&s.equipped.includes(skill.key)&&researchActions.has(skill.key))button(row,'RUN EQUIPPED RESEARCH',()=>research(skill.key));
      root.append(row);
    }
    s.equipped.forEach((skillKey,slot)=>{if(skillKey!==ZERO)button(root,`REVIEW UNEQUIP · SLOT ${slot+1}`,()=>prepare({operation:'unequip',slot}));});
    if(researchResult){const details=element('details');details.append(element('summary','View equipped research result'),
      element('p',`Observed ${new Date(researchResult.observedAt).toLocaleString()}. Re-run for a fresh result.`),element('pre',JSON.stringify(researchResult.result,null,2)));root.append(details);}
    root.append(element('p','Sacrifice remains locked. Training never starts a mint mission or grants spending permission.'));
  }
  const timer=window.setInterval(()=>{if(available()&&journal?.attempted&&!busy&&!document.hidden&&!root.closest('[hidden]'))void work(refresh);},30000);
  selectionChanged();render();
  return {selectionChanged,destroy(){++sequence;window.clearInterval(timer);}};
}
