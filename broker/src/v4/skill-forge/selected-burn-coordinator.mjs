import { randomBytes } from 'node:crypto';
import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import { createReviewedBurnPreparation } from './reviewed-burn.mjs';
import { SELECTED_BURN_OWNER } from './selected-burn-source.mjs';

const ABI=parseAbi(['function owner() view returns(address)','function globallyDisabled() view returns(bool)',
  'function ownerOf(uint256) view returns(address)','function getApproved(uint256) view returns(address)',
  'function trainingCredits(uint256) view returns(uint256)','function sacrificeCredited(uint256) view returns(bool)',
  'function setEmergencyControls(bool,uint256)']);
// Only Rarity Eye's research capability is enabled by this administrative review.
export const SELECTED_FORGE_DISABLED_MASK=(2n**256n-1n)^8n;
const valid=(v,code)=>{if(!v)throw Error(code);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hex=n=>`0x${BigInt(n).toString(16)}`;
export function createSelectedBurnCoordinator({clients,release,store,checkSource,now=Date.now}) {
  valid(clients.length===2&&clients[0]!==clients[1]&&release.status==='OWNER_CANARY'
    && release.allowedOwners.includes(SELECTED_BURN_OWNER),'SELECTED_BURN_NOT_RELEASED');
  const pins={...release,burnSource:release.trainingSource,burnSourceCodeHash:release.trainingSourceCodeHash};
  const services=clients.map(client=>createReviewedBurnPreparation({client,deployment:pins,reviewStore:store.reviewStore,now}));
  const read=(c,address,functionName,args=[],blockNumber)=>c.readContract({address,abi:ABI,functionName,args,blockNumber});
  async function state() {
    const heads=await Promise.all(clients.map(c=>c.getBlock()));const block=heads.reduce((a,b)=>a.number<b.number?a:b);
    valid(Math.abs(now()/1000-Number(block.timestamp))<30,'BURN_REVIEW_EXPIRED');
    const values=await Promise.all(clients.map(async c=>{
      valid(await c.getChainId()===4663&&same((await c.getBlock({blockNumber:block.number})).hash,block.hash),'BURN_CHAIN_CHANGED');
      for(const role of ['collection','registry','progression','trainingSource'])
        valid(keccak256(await c.getCode({address:release[role],blockNumber:block.number})??'0x')===release[`${role}CodeHash`],'BURN_RUNTIME_CHANGED');
      const [admin,paused,credited,targetOwner,credits]=await Promise.all([
        read(c,release.registry,'owner',[],block.number),read(c,release.registry,'globallyDisabled',[],block.number),
        read(c,release.progression,'sacrificeCredited',[1753n],block.number),read(c,release.collection,'ownerOf',[93n],block.number),
        read(c,release.progression,'trainingCredits',[93n],block.number)]);
      valid(same(targetOwner,SELECTED_BURN_OWNER)&&same(admin,SELECTED_BURN_OWNER),'BURN_OWNER_CHANGED');
      let approved=null;
      if(!credited){valid(same(await read(c,release.collection,'ownerOf',[1753n],block.number),SELECTED_BURN_OWNER),'BURN_OWNER_CHANGED');
        approved=await read(c,release.collection,'getApproved',[1753n],block.number);}
      return {paused,credited,credits:String(credits),approved:approved?.toLowerCase()??null};
    }));
    valid(JSON.stringify(values[0])===JSON.stringify(values[1]),'BURN_PROVIDERS_DISAGREE');
    return {...values[0],anchor:{number:String(block.number),hash:block.hash,timestamp:String(block.timestamp)}};
  }
  async function prepareEnable(current) {
    valid(current.paused,'FORGE_ALREADY_ENABLED');const c=clients[0];
    const data=encodeFunctionData({abi:ABI,functionName:'setEmergencyControls',args:[false,SELECTED_FORGE_DISABLED_MASK]});
    const call={account:SELECTED_BURN_OWNER,to:release.registry,data,value:0n};
    const [estimate,price,nonce]=await Promise.all([c.estimateGas(call),c.getGasPrice(),c.getTransactionCount({address:SELECTED_BURN_OWNER,blockTag:'pending'})]);
    const gas=(estimate*120n+99n)/100n,gasPrice=price*2n;
    valid(gas>0n&&gas<500000n&&gasPrice>0n&&gas*gasPrice<=BigInt(release.feeCeilingWei),'BURN_FEE_OR_NONCE_BOUND');
    return {schema:'GOGH_SELECTED_FORGE_ENABLE_V1',intentId:randomBytes(32).toString('hex'),action:'ENABLE_FORGE',
      state:{owner:SELECTED_BURN_OWNER,sourceTokenId:'1753',targetTokenId:'93',...current},expiresAt:now()+600000,
      maximumNetworkFeeWei:String(gas*gasPrice),transaction:{from:SELECTED_BURN_OWNER,to:release.registry,data,value:'0x0',
        chainId:'0x1237',type:'0x0',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)},
      warning:'This administrator transaction unpauses the shared Forge contracts for all owners. Only Rarity Eye research is enabled; it does not burn a Punk or spend a training credit.'};
  }
  async function preflightEnable(review) {
    valid(review.action==='ENABLE_FORGE'&&now()<review.expiresAt,'BURN_REVIEW_EXPIRED');
    valid((await state()).paused,'FORGE_ALREADY_ENABLED');
    const tx=review.transaction;
    valid(tx.data===encodeFunctionData({abi:ABI,functionName:'setEmergencyControls',args:[false,SELECTED_FORGE_DISABLED_MASK]})&&same(tx.to,release.registry),'BURN_REVIEW_TAMPERED');
    for(const c of clients){const nonces=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:SELECTED_BURN_OWNER,blockTag})));
      valid(nonces.every(n=>n===Number(BigInt(tx.nonce))),'BURN_WALLET_NONCE_CHANGED');
      valid(await c.getBalance({address:SELECTED_BURN_OWNER})>=BigInt(review.maximumNetworkFeeWei),'BURN_GAS_UNFUNDED');
      await c.call({account:tx.from,to:tx.to,data:tx.data,value:0n,gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)});}
    valid(now()<review.expiresAt,'BURN_REVIEW_EXPIRED');
  }
  async function prepare(action) {
    valid(['ENABLE_FORGE','APPROVE','BURN'].includes(action),'INVALID_BURN_ACTION');
    const prior=await store.current();
    valid(!prior||['CANCELLED','DECLINED','CONFIRMED','REVERTED'].includes(prior.status),'RECOVER_EXISTING_BURN_REVIEW');
    const current=await state();let review;
    if(action==='ENABLE_FORGE'){review=await prepareEnable(current);await preflightEnable(review);}
    else {
      valid(!current.paused&&!current.credited,'TRAINING_PAUSED_OR_ALREADY_BURNED');
      const sourceEvidence=await checkSource();
      // Persist the entire source evidence together with the immutable transaction.
      const service=createReviewedBurnPreparation({client:clients[0],deployment:pins,now});
      review={...await service.prepare({owner:SELECTED_BURN_OWNER,sourceTokenId:'1753',targetTokenId:'93',action}),sourceEvidence};
    }
    const record=await store.save(review);
    if(action!=='ENABLE_FORGE')await Promise.all(services.map(s=>s.recheck(review)));
    return {record};
  }
  async function claim({intentId,revision,reviewHash,confirmation,obligationsReviewed}) {
    const record=await store.get(intentId);
    valid(record?.status==='PREPARED'&&record.revision===revision&&record.reviewHash===reviewHash,'BURN_JOURNAL_CHANGED');
    if(record.review.action==='ENABLE_FORGE')await preflightEnable(record.review);
    else {
      valid(obligationsReviewed===true,'BURN_OWNER_REVIEW_REQUIRED');
      if(record.review.action==='BURN')valid(confirmation==='BURN 1753','BURN_CONFIRMATION_REQUIRED');
      await checkSource();await Promise.all(services.map(s=>s.recheck(record.review)));
    }
    // This CAS commits before returning the one wallet request. No timeout or
    // rejection can silently release it. Recovery always refers to this intent.
    const claimed=await store.update(intentId,revision,'WALLET_REQUESTED',null);
    return {record:claimed,transaction:claimed.review.transaction};
  }
  async function inspectEnable(review,hash) {
    const results=[];
    for(const c of clients){const [tx,r]=await Promise.all([c.getTransaction({hash}),c.getTransactionReceipt({hash})]),e=review.transaction;
      const block=await c.getBlock({blockNumber:r.blockNumber});
      valid(same(tx.hash,hash)&&same(r.transactionHash,hash)&&same(tx.from,e.from)&&same(tx.to,e.to)&&tx.input===e.data
        &&tx.value===0n&&tx.chainId===4663&&tx.nonce===Number(BigInt(e.nonce))&&tx.gas===BigInt(e.gas)
        &&tx.gasPrice===BigInt(e.gasPrice)&&!tx.authorizationList?.length&&same(tx.blockHash,block.hash)
        &&same(r.blockHash,block.hash)&&r.gasUsed<=tx.gas&&r.effectiveGasPrice<=tx.gasPrice,'BURN_RECEIPT_MISMATCH');
      valid((await c.getBlockNumber())>=r.blockNumber+12n,'BURN_CONFIRMATIONS_PENDING');
      if(r.status==='success'){
        const controls=parseAbi(['function globallyDisabled() view returns(bool)','function disabledCapabilities() view returns(uint256)']);
        valid(await c.readContract({address:release.registry,abi:controls,functionName:'globallyDisabled',blockNumber:r.blockNumber})===false
          &&await c.readContract({address:release.registry,abi:controls,functionName:'disabledCapabilities',blockNumber:r.blockNumber})===SELECTED_FORGE_DISABLED_MASK,'FORGE_ENABLE_STATE_MISMATCH');
      }
      valid(['success','reverted'].includes(r.status),'BURN_RECEIPT_MISMATCH');
      results.push({status:r.status==='success'?'CONFIRMED':'REVERTED',transactionHash:hash,blockNumber:String(r.blockNumber),blockHash:block.hash,action:'ENABLE_FORGE'});
    }
    valid(JSON.stringify(results[0])===JSON.stringify(results[1]),'BURN_PROVIDERS_DISAGREE');return results[0];
  }
  async function recover({intentId,revision,transactionHash}) {
    let record=await store.get(intentId);
    valid(record?.status==='WALLET_REQUESTED'&&record.revision===revision&&/^0x[0-9a-f]{64}$/i.test(transactionHash),'BURN_JOURNAL_CHANGED');
    const hash=transactionHash.toLowerCase();
    // A candidate hash is only a hint until both providers verify the exact call.
    if(record.reportedHash!==hash)record=await store.update(intentId,revision,'WALLET_REQUESTED',hash);
    let receipt;
    try {
      if(record.review.action==='ENABLE_FORGE')receipt=await inspectEnable(record.review,hash);
      else {
        const results=await Promise.all(services.map(s=>s.verifyReceipt(record.review,hash)));
        if(results.some(r=>r.status==='PENDING'))return {record,pending:true};
        valid(JSON.stringify(results[0])===JSON.stringify(results[1]),'BURN_PROVIDERS_DISAGREE');receipt=results[0];
        for(const c of clients){const blockNumber=receipt.blockNumber?BigInt(receipt.blockNumber):(await c.getTransactionReceipt({hash})).blockNumber;
          valid((await c.getBlockNumber())>=blockNumber+12n,'BURN_CONFIRMATIONS_PENDING');}
      }
    }catch(error){if(['TransactionNotFoundError','TransactionReceiptNotFoundError','BlockNotFoundError'].includes(error.name)
      ||error.message==='BURN_CONFIRMATIONS_PENDING')return {record,pending:true};throw error;}
    return {record:await store.update(intentId,record.revision,receipt.status,hash,{...receipt,verifiedProviders:2,finalized:false})};
  }
  async function cancel({intentId,revision}) {
    const record=await store.get(intentId);valid(record?.status==='PREPARED'&&record.revision===revision,'BURN_JOURNAL_CHANGED');
    return {record:await store.update(intentId,revision,'CANCELLED',null)};
  }
  async function decline({intentId,revision,rejectionCode}) {
    const r=await store.get(intentId);
    valid(rejectionCode===4001&&r?.status==='WALLET_REQUESTED'&&r.revision===revision&&!r.reportedHash,'BURN_JOURNAL_CHANGED');
    for(const c of clients){const nonces=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:SELECTED_BURN_OWNER,blockTag})));
      valid(nonces.every(n=>n===Number(BigInt(r.review.transaction.nonce))),'BURN_WALLET_NONCE_CHANGED');}
    return {record:await store.update(intentId,revision,'DECLINED',null)};
  }
  return {prepare,claim,recover,cancel,decline,get:async()=>({record:await store.current(),state:await state()})};
}
