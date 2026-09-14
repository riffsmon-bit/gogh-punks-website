const REGISTRY='0xc2a1bd47fbc0fe33e53c85f130be53591c898e83',BASE='/api/v2/admin/forge/skills';
const HASH=/^0x[0-9a-f]{64}$/i,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL=new Set(['CONFIRMED','REVERTED','CANCELLED']);
const word=value=>BigInt(value).toString(16).padStart(64,'0');
const eth=value=>{const n=BigInt(value),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${n/10n**18n}${fraction?`.${fraction}`:''} ETH`;};
export function validateSkillAdminWalletReview(record,snapshot,owner,now=Date.now()) {
  const skill=snapshot?.skills?.find(item=>item.key===record?.key),p=record?.preparation,t=p?.transaction;
  if(!skill||!p||!t||!UUID.test(record.id)||record.administrator!==owner||snapshot.administrator?.toLowerCase()!==owner
    ||snapshot.chainId!==4663||snapshot.registry?.toLowerCase()!==REGISTRY||record.registry!==REGISTRY
    ||record.status!=='PREPARED'||p.key!==skill.key||p.name!==skill.name||p.action!==record.action
    ||p.manifestHash!==skill.manifestHash||p.instructionHash!==skill.instructionHash||p.reviewEvidenceHash!==skill.evidenceHash
    ||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now+5000||p.expiresAt>now+65000
    ||t.from?.toLowerCase()!==owner||t.to?.toLowerCase()!==REGISTRY||t.chainId!=='0x1237'||t.value!=='0x0'
    ||Object.keys(t).sort().join(',')!=='chainId,data,from,gas,gasPrice,nonce,to,value'
    ||!['nonce','gas','gasPrice'].every(key=>/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(t[key])))throw Error('The exact skill release review could not be verified. Recheck it.');
  const expected=record.action==='REGISTER'?'0x63576a2c'+[word(skill.skillId),word(skill.version),skill.manifestHash.slice(2),
    skill.instructionHash.slice(2),'0'.repeat(64),word(skill.capabilities),word(0)].join('')
    :['MARK_TESTING','MARK_READY'].includes(record.action)?'0x9a956214'+skill.key.slice(2)+word(record.action==='MARK_TESTING'?3:4)+skill.evidenceHash.slice(2):null;
  if(t.data!==expected||BigInt(t.gas)<=0n||BigInt(t.gas)>600000n||BigInt(t.gasPrice)<=0n
    ||BigInt(t.gas)*BigInt(t.gasPrice)!==BigInt(p.maximumNetworkFeeWei)||BigInt(p.maximumNetworkFeeWei)>100000000000000n)throw Error('The skill release transaction does not match its review.');
  return structuredClone(t);
}

// An administrator-only panel. It never runs a wallet request during mount/reload/recovery.
export function createForgeSkillAdminPanel({root,getSelection,ensureSession,request,
  getProvider=()=>window.__GOGH_WALLET_PROVIDER__,storage=localStorage}) {
  if(!root)return null;
  const document=root.ownerDocument,element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let identity='',generation=0,busy=false,snapshot=null,record=null,journal=null,message='';
  const selection=()=>{const s=getSelection();return s?.owner&&s.chainId===4663&&!s.preview?{owner:s.owner.toLowerCase(),chainId:4663}:null;};
  const currentIdentity=()=>selection()?.owner??'';
  const storageKey=owner=>`gogh-forge-admin-v1:${REGISTRY}:${owner}`;
  function persist(value,owner=identity){const encoded=JSON.stringify(value);storage.setItem(storageKey(owner),encoded);
    if(storage.getItem(storageKey(owner))!==encoded)throw Error('Save the pending skill review before continuing.');if(owner===identity)journal=value;}
  const api=(body,id)=>request(`${BASE}${id?`?id=${encodeURIComponent(id)}`:''}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),timeoutMs:45000}:{});
  const button=(parent,label,action,disabled=false)=>{const node=element('button',label);node.type='button';node.className='filter-button';node.disabled=busy||disabled;node.addEventListener('click',()=>void action());parent.append(node);return node;};
  function update(){const next=currentIdentity();if(next===identity)return;identity=next;++generation;busy=false;snapshot=null;record=null;journal=null;message='';
    if(identity)try{const raw=storage.getItem(storageKey(identity));if(raw){journal=JSON.parse(raw);if(!UUID.test(journal.requestKey)||typeof journal.attempted!=='boolean')throw Error();}}
    catch{message='The saved administrator review could not be read. Recheck its server record before continuing.';journal={attempted:true};}render();}
  async function work(fn){if(busy)return;const owner=identity,ticket=++generation,current=()=>identity===owner&&currentIdentity()===owner&&ticket===generation;
    busy=true;render();try{await fn(owner,current);}catch(error){if(current())message=error?.message??'The review could not be checked. Recheck the original transaction.';}
    finally{if(current()){busy=false;render();}}}
  function accept(payload,owner){if(payload?.ok!==true||payload.snapshot?.administrator?.toLowerCase()!==owner
    ||payload.snapshot.registry?.toLowerCase()!==REGISTRY||payload.snapshot.chainId!==4663)throw Error('Only the current Forge administrator can review skill releases.');
    if(payload.record&&payload.record.administrator!==owner)throw Error('Saved review belongs to another administrator.');
    snapshot=payload.snapshot;record=payload.record;
    if(record&&!journal)persist({requestKey:record.requestKey,id:record.id,attempted:record.status!=='PREPARED',transactionHash:record.transactionHash});
    if(record&&TERMINAL.has(record.status)){storage.removeItem(storageKey(owner));journal=null;}
  }
  async function refresh(owner,current){let payload=await api(null,journal?.id);if(!current())return;
    accept(payload,owner);
    if(record&&journal?.transactionHash&&!TERMINAL.has(record.status)){
      await api({operation:'recover',id:record.id,transactionHash:journal.transactionHash});if(!current())return;
      payload=await api(null,record.id);if(!current())return;accept(payload,owner);
    }
    message=record?({PREPARED:'Review ready. Check the skill, action and network fee before opening your wallet.',
      WALLET_REQUESTED:'A wallet confirmation was reserved. Recover its transaction hash; this request will not be sent again.',
      SUBMITTED:'Transaction found. Waiting for both chain providers to verify 12 confirmations.',
      CONFIRMED:'Registry step confirmed. Recheck skills to prepare the next step.',REVERTED:'The registry transaction reverted. Recheck skills before a new review.',
      CANCELLED:'Unsent review cancelled.'}[record.status]??'Recheck the saved release review.'):'Choose a reviewed skill to prepare its next registry step.';
  }
  const check=()=>work(async(owner,current)=>{await ensureSession();if(current())await refresh(owner,current);});
  const prepare=key=>work(async(owner,current)=>{await ensureSession();if(!current())return;
    const saved={requestKey:crypto.randomUUID(),id:null,attempted:false,transactionHash:null};persist(saved,owner);
    const payload=await api({operation:'prepare',key,requestKey:saved.requestKey});if(!current())return;
    if(!payload.record||payload.record.administrator!==owner)throw Error('The review could not be saved. Recheck skills.');
    persist({...saved,id:payload.record.id,requestKey:payload.record.requestKey},owner);await refresh(owner,current);
  });
  const confirm=()=>work(async(owner,current)=>{
    await ensureSession();if(!current())return;
    if(!record||journal?.attempted)throw Error('Recover the original wallet request before continuing.');
    const tx=validateSkillAdminWalletReview(record,snapshot,owner),provider=getProvider(),saved={...journal,id:record.id},original=record;
    const checkWallet=async()=>{const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
      if(!current()||accounts?.[0]?.toLowerCase()!==owner||BigInt(chain)!==4663n)throw Error('Wallet selection changed. Recheck the saved review.');};
    if(!provider?.request)throw Error('Connect the administrator wallet first.');await checkWallet();
    persist({...saved,attempted:true},owner);
    const claim=await api({operation:'claim',id:original.id,revision:original.revision,reviewHash:original.reviewHash});
    if(!current())return;
    if(claim?.record?.status!=='WALLET_REQUESTED'||!claim.transaction||Object.keys(claim.transaction).length!==Object.keys(tx).length
      ||Object.keys(tx).some(key=>claim.transaction[key]!==tx[key]))throw Error('The wallet claim could not be verified. Recover the saved request.');
    await checkWallet();if(Date.now()>=original.preparation.expiresAt)throw Error('The review expired before the wallet opened. Recheck its saved state.');
    const transactionHash=await provider.request({method:'eth_sendTransaction',params:[tx]});
    if(!HASH.test(transactionHash??''))throw Error('The wallet did not return a transaction hash. Recover it from wallet activity.');
    persist({...saved,attempted:true,transactionHash:transactionHash.toLowerCase()},owner);
    if(current())await refresh(owner,current);
  });
  const cancel=()=>work(async(owner,current)=>{await api({operation:'cancel',id:record.id,revision:record.revision});if(current())await refresh(owner,current);});
  function render(){root.replaceChildren();root.append(element('h3','SKILL RELEASE ADMINISTRATION'));
    root.append(element('p','Publish reviewed research skills to the registry. These steps do not burn a Punk, teach a skill or authorize purchases. Each step requires the current administrator wallet.'));
    const status=element('p',message||'Check the live registry to see which reviewed skills can be released.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
    button(root,busy?'CHECKING…':'RECHECK SKILL RELEASES',check,!identity);
    if(!snapshot)return;
    if(record&&!TERMINAL.has(record.status)){
      const p=record.preparation;root.append(element('h4',`${p.name} · ${{REGISTER:'Register skill',MARK_TESTING:'Record testing',MARK_READY:'Make available'}[record.action]??record.action}`),
        element('p',`Maximum network fee: ${eth(p.maximumNetworkFeeWei)}. No ETH is sent to the registry.`));
      if(record.status==='PREPARED'){
        root.append(element('p',`Review expires ${new Date(p.expiresAt).toLocaleTimeString()}.`));
        button(root,'CONFIRM REGISTRY STEP IN WALLET',confirm,journal?.attempted||Date.now()+5000>=p.expiresAt);
        button(root,'CANCEL UNSENT REVIEW',cancel);return;
      }
      const label=element('label','Original transaction hash from wallet activity'),input=element('input');input.type='text';input.maxLength=66;input.placeholder='0x…';input.value=journal?.transactionHash??record.transactionHash??'';label.append(input);root.append(label);
      button(root,'RECOVER ORIGINAL TRANSACTION',()=>work(async(owner,current)=>{const hash=input.value.trim().toLowerCase();if(!HASH.test(hash))throw Error('Enter the full transaction hash from your wallet.');
        await api({operation:'recover',id:record.id,transactionHash:hash});if(current()){persist({...journal,id:record.id,transactionHash:hash,attempted:true},owner);await refresh(owner,current);}}));return;
    }
    for(const skill of snapshot.skills){const row=element('article');row.append(element('h4',skill.name));
      row.append(element('p',skill.action==='REGISTERED_READY'?'Registry ready. Holder learning and equipment still follow the active app release.':skill.action==='EMERGENCY_DISABLED'?'Temporarily disabled by the safety controls.':
        ({REGISTER:'Next: register this reviewed version.',MARK_TESTING:'Next: record its testing evidence.',MARK_READY:'Next: make this reviewed skill available.'}[skill.action]??'Release unavailable.')));
      if(skill.nextCalldata)button(row,'REVIEW NEXT REGISTRY STEP',()=>prepare(skill.key));root.append(row);
    }
  }
  render();update();return Object.freeze({update,refresh:check,destroy(){++generation;root.replaceChildren();}});
}
