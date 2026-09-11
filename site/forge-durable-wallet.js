import { keccak256Hex } from './keccak256.js';
import { encodeReviewedTrainingCall } from './forge-reviewed-calldata.js';

const ZERO = `0x${'0'.repeat(64)}`;
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value)<2n**256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value!==ZERO;
const fail = () => { throw Error('Training review changed or could not be verified. Refresh before continuing.'); };
const valid = value => { if (!value) fail(); };
const hex = value => `0x${BigInt(value).toString(16)}`;
const word = value => BigInt(value).toString(16).padStart(64,'0');
const textHex = value => `0x${Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
const selector = value => keccak256Hex(textHex(value)).slice(0,10);
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value==='object' ? `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
function exact(value,keys) {
  valid(value && Object.getPrototypeOf(value)===Object.prototype && Reflect.ownKeys(value).length===keys.length
    && keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value')));
}

export function validateDurableTrainingSnapshot(payload,selection,{release,binding},now=Date.now()) {
  valid(release.status==='OWNER_CANARY' && binding && payload?.ok===true && payload.mode==='OWNER_CANARY'
    && payload.canBurn===false && payload.chainId===binding.chainId && selection.chainId===binding.chainId && !selection.preview
    && payload.owner===selection.owner?.toLowerCase() && payload.tokenId===String(selection.tokenId)
    && release.allowedOwners.includes(payload.owner)
    && Object.entries(binding).every(([key,value])=>payload.release?.[key]===value)
    && payload.release.registry===release.registry && payload.release.progressionCodeHash===release.progressionCodeHash
    && payload.release.snapshotHash===release.snapshotHash && typeof payload.held==='boolean');
  const state=payload.state;
  valid(state?.owner===payload.owner && state.tokenId===payload.tokenId && uint(state.credits) && uint(state.nonce) && hash(state.stateHash)
    && Number.isInteger(state.slots) && state.slots>=1 && state.slots<=7 && Number.isInteger(state.claimed) && state.claimed>=0 && state.claimed<=3
    && state.slots>=(state.claimed||1) && uint(state.anchor?.number) && hash(state.anchor.hash) && uint(state.anchor.timestamp)
    && Number(state.anchor.timestamp)*1000<=now+5000 && Number(state.anchor.timestamp)*1000>=now-30000
    && Array.isArray(state.equipped) && state.equipped.length===state.slots && state.equipped.every(key=>key===ZERO||hash(key))
    && Array.isArray(state.skills) && state.skills.length===release.skills.length);
  state.skills.forEach((skill,index)=>valid(Object.entries(release.skills[index]).every(([key,value])=>skill[key]===value)
    && [0,1].includes(skill.level) && typeof skill.available==='boolean'));
  return payload;
}

export async function validateDurableWalletReview(envelope,snapshot,{release,binding,action},now=Date.now()) {
  const record=envelope?.record,review=record?.review;
  exact(review,['schema','chainId','collection','progression','deploymentHash','owner','tokenId','action','guard','anchor','transaction']);
  valid(review.schema==='GOGH_DURABLE_TRAINING_REVIEW_V1' && Object.entries(binding).every(([key,value])=>review[key]===value)
    && review.owner===snapshot.owner && review.tokenId===snapshot.tokenId && release.allowedOwners.includes(review.owner)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.intentId)
    && Number.isSafeInteger(record.revision) && record.revision>=0 && ['PREPARED','WALLET_REQUESTED'].includes(record.status)
    && typeof record.reviewHash==='string' && /^[0-9a-f]{64}$/.test(record.reviewHash));
  exact(review.action,['operation','skillKey','slot','startingSlots','rarityProof']);
  exact(review.guard,['nonce','stateHash','deadline']); exact(review.anchor,['number','hash','timestamp']);
  exact(review.transaction,['nonce','gas','maxFeePerGas','maxPriorityFeePerGas']);
  valid(['learn','unlock','equip','unequip','claim_rarity'].includes(review.action.operation)
    && ['operation','skillKey','slot'].every(key=>review.action[key]===(action[key]??(key==='skillKey'?ZERO:0)))
    && uint(review.guard.nonce) && review.guard.nonce===snapshot.state.nonce && review.guard.stateHash===snapshot.state.stateHash
    && uint(review.guard.deadline) && uint(review.anchor.number) && hash(review.anchor.hash) && uint(review.anchor.timestamp)
    && BigInt(review.guard.deadline)>BigInt(review.anchor.timestamp) && BigInt(review.guard.deadline)<=BigInt(review.anchor.timestamp)+60n
    && Number(review.anchor.timestamp)*1000<=now+5000 && Number(review.guard.deadline)*1000>now+5000
    && Date.parse(record.expiresAt)===Number(review.guard.deadline)*1000
    && Object.values(review.transaction).every(uint) && BigInt(review.transaction.nonce)<=BigInt(Number.MAX_SAFE_INTEGER)
    && BigInt(review.transaction.gas)>0n && BigInt(review.transaction.gas)<=2000000n
    && BigInt(review.transaction.maxFeePerGas)>0n && BigInt(review.transaction.maxPriorityFeePerGas)<=BigInt(review.transaction.maxFeePerGas)
    && BigInt(review.transaction.gas)*BigInt(review.transaction.maxFeePerGas)<=BigInt(release.feeCeilingWei));
  valid(Array.isArray(review.action.rarityProof) && review.action.rarityProof.length<=32 && review.action.rarityProof.every(hash));
  const data=encodeReviewedTrainingCall({tokenId:review.tokenId,...review.action,
    operation:review.action.operation.replace('_','-'),...review.guard});
  valid((await digest(stable(review)))===record.reviewHash);
  const expected={chainId:review.chainId,type:'eip1559',from:review.owner,to:review.progression,value:'0',...review.transaction,data};
  exact(envelope.transaction,Object.keys(expected));
  valid(Object.entries(expected).every(([key,value])=>envelope.transaction[key]===value));
  return {chainId:hex(review.chainId),type:'0x2',from:review.owner,to:review.progression,value:'0x0',data,
    ...Object.fromEntries(Object.entries(review.transaction).map(([key,value])=>[key,hex(value)]))};
}

// The caller persists the attempted marker BEFORE the server claim. Any lost claim
// response or wallet error is recovered by intent/hash, never by another send.
export function createDurableTrainingWallet({provider,release,binding,readCurrent,claim,markAttempted,
  wasAttempted,isCurrent,now=Date.now}) {
  let busy=false;
  return Object.freeze({async submit(envelope,selection,action) {
    if(busy || wasAttempted(envelope.record.intentId)) throw Error('This review already reached confirmation. Recheck its status.');
    busy=true;
    try {
      valid(isCurrent() && release.status==='OWNER_CANARY');
      const fixed=structuredClone(envelope),intentId=fixed.record.intentId;
      const snapshot=validateDurableTrainingSnapshot(await readCurrent(intentId),selection,{release,binding},now());
      valid(snapshot.record?.reviewHash===fixed.record.reviewHash && snapshot.record.status==='PREPARED');
      const transaction=await validateDurableWalletReview(fixed,snapshot,{release,binding,action},now());
      const rpc=(method,params=[])=>provider.request({method,params});
      const walletContext=async()=>{
        const [chain,accounts,pending,latest]=await Promise.all([rpc('eth_chainId'),rpc('eth_accounts'),
          rpc('eth_getTransactionCount',[transaction.from,'pending']),rpc('eth_getTransactionCount',[transaction.from,'latest'])]);
        valid(chain===transaction.chainId && Array.isArray(accounts) && accounts[0]?.toLowerCase()===transaction.from
          && /^0x[0-9a-f]+$/i.test(pending) && /^0x[0-9a-f]+$/i.test(latest)
          && BigInt(pending)===BigInt(transaction.nonce) && BigInt(latest)===BigInt(transaction.nonce) && isCurrent());
      };
      await walletContext();
      const head=await rpc('eth_getBlockByNumber',['latest',false]);
      valid(hash(head?.hash) && /^0x[0-9a-f]+$/i.test(head.number) && /^0x[0-9a-f]+$/i.test(head.timestamp)
        && Number(BigInt(head.timestamp))*1000>=now()-30000 && Number(BigInt(head.timestamp))*1000<=now()+5000);
      const from=BigInt(fixed.record.review.anchor.number),to=BigInt(head.number);
      valid(to>=from && to-from<=1000n);
      const [codes,owner,nonce,stateHash,logs,anchor,gas,balance]=await Promise.all([
        Promise.all(['collection','registry','progression','trainingSource'].map(key=>rpc('eth_getCode',[release[key],head.number]))),
        rpc('eth_call',[{to:release.collection,data:`0x6352211e${word(selection.tokenId)}`},head.number]),
        rpc('eth_call',[{to:release.progression,data:`${selector('trainingReviewNonce(uint256)')}${word(selection.tokenId)}`},head.number]),
        rpc('eth_call',[{to:release.progression,data:`${selector('trainingReviewStateHash(uint256)')}${word(selection.tokenId)}`},head.number]),
        rpc('eth_getLogs',[{address:release.collection,fromBlock:hex(from),toBlock:head.number,
          topics:[keccak256Hex(textHex('Transfer(address,address,uint256)')),null,null,`0x${word(selection.tokenId)}`]}]),
        rpc('eth_getBlockByNumber',[hex(from),false]),rpc('eth_estimateGas',[transaction]),rpc('eth_getBalance',[transaction.from,'pending']),
      ]);
      valid(codes.every((code,index)=>typeof code==='string' && code!=='0x' && keccak256Hex(code)===release[`${['collection','registry','progression','trainingSource'][index]}CodeHash`])
        && owner===`0x${transaction.from.slice(2).padStart(64,'0')}` && /^0x[0-9a-f]{64}$/i.test(nonce)
        && BigInt(nonce)===BigInt(snapshot.state.nonce) && stateHash===snapshot.state.stateHash
        && Array.isArray(logs) && logs.length===0 && anchor?.hash===fixed.record.review.anchor.hash
        && /^0x[0-9a-f]+$/i.test(gas) && BigInt(gas)>0n && BigInt(gas)<=BigInt(transaction.gas)
        && /^0x[0-9a-f]+$/i.test(balance) && BigInt(balance)>=BigInt(transaction.gas)*BigInt(transaction.maxFeePerGas));
      await rpc('eth_call',[transaction,'pending']);
      valid((await rpc('eth_getBlockByNumber',[head.number,false])).hash===head.hash && isCurrent());
      await validateDurableWalletReview(fixed,snapshot,{release,binding,action},now());
      await markAttempted(intentId);
      const claimed=await claim(intentId,fixed.record.revision,fixed.record.reviewHash);
      valid(claimed.claimed===true && claimed.record.intentId===intentId && claimed.record.reviewHash===fixed.record.reviewHash
        && claimed.record.revision===fixed.record.revision+1 && claimed.record.status==='WALLET_REQUESTED');
      await validateDurableWalletReview(claimed,snapshot,{release,binding,action},now());
      await walletContext();
      valid(Number(fixed.record.review.guard.deadline)*1000>now()+5000 && isCurrent());
      const transactionHash=await rpc('eth_sendTransaction',[transaction]);
      valid(hash(transactionHash));
      return {transactionHash,record:claimed.record};
    } finally {busy=false;}
  }});
}
