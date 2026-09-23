import { decodeEventLog, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { assertTrainingOwnerContinuity, checkedTrainingBlock } from './training-state.mjs';

export const PAID_PRICE_WEI = '500000000000000';
export const PAID_TREASURY = '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
export const PAID_OPERATIONS = Object.freeze(['buy','activate','learn','unlock','equip','unequip']);
export const PAID_ZERO = `0x${'0'.repeat(64)}`;
export const PAID_ABI = parseAbi([
  'function collection() view returns(address)', 'function registry() view returns(address)',
  'function legacyProgression() view returns(address)', 'function treasury() view returns(address)',
  'function creditPriceWei() view returns(uint256)', 'function purchasesPaused() view returns(bool)',
  'function activated(uint256) view returns(bool)', 'function purchasedCredits(uint256) view returns(uint256)',
  'function reviewNonce(uint256) view returns(uint256)', 'function reviewStateHash(uint256) view returns(bytes32)',
  'function learnedLevel(uint256,bytes32) view returns(uint8)', 'function unlockedSlots(uint256) view returns(uint8)',
  'function equipped(uint256,uint8) view returns(bytes32)', 'function effectiveCapabilities(uint256) view returns(uint256)',
  'function allowedSkill(bytes32) view returns(bool)', 'function ownerOf(uint256) view returns(address)',
  'function trainingCredits(uint256) view returns(uint256)', 'function claimedStartingSlots(uint256) view returns(uint8)',
  'function trainingSource() view returns(address)', 'function getApproved(uint256) view returns(address)',
  'function isApprovedForAll(address,address) view returns(bool)',
  'function available(bytes32) view returns(bool)',
  'function definition(bytes32) view returns((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))',
  'function applyReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint256 nonce,bytes32 stateHash,uint64 deadline)) payable',
  'event PaidTrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,uint8 operation)',
]);
const fail = code => { throw Error(code); };
const check = (value, code = 'PAID_TRAINING_UNVERIFIED') => { if (!value) fail(code); };
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && v !== PAID_ZERO;
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) !== 0n;
const uint = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n**256n;
const hex = v => `0x${BigInt(v).toString(16)}`;
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const keys = (v, fields) => v && Object.getPrototypeOf(v) === Object.prototype
  && Reflect.ownKeys(v).length === fields.length && fields.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v,k) ?? {},'value'));

export function validatePaidRelease(input) {
  check(keys(input,['schema','status','chainId','collection','collectionCodeHash','registry','registryCodeHash',
    'legacyProgression','legacyProgressionCodeHash','extension','extensionCodeHash','treasury','priceWei',
    'allowedOwners','skills','feeCeilingWei','canonicalReadersReviewed','productionPaymentsAuthorized']), 'PAID_RELEASE_INVALID');
  const r = structuredClone(input);
  check(r.schema === 'GOGH_PAID_TRAINING_RELEASE_V1' && ['UNDEPLOYED','OWNER_CANARY','PAUSED'].includes(r.status)
    && r.chainId === 4663 && r.collection === '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
    && r.treasury === PAID_TREASURY && r.priceWei === PAID_PRICE_WEI
    && ['collection','registry','legacyProgression'].every(k => address(r[k]) && hash(r[`${k}CodeHash`]))
    && Array.isArray(r.allowedOwners) && r.allowedOwners.length <= 20 && r.allowedOwners.every(address)
    && new Set(r.allowedOwners).size === r.allowedOwners.length
    && uint(r.feeCeilingWei) && BigInt(r.feeCeilingWei) > 0n && BigInt(r.feeCeilingWei) <= 100000000000000n
    && Array.isArray(r.skills) && r.skills.length > 0 && r.skills.length <= 32
    && new Set(r.skills.map(s => s.key)).size === r.skills.length
    && r.skills.every(s => keys(s,['key','name','manifestHash','instructionHash']) && hash(s.key)
      && hash(s.manifestHash) && hash(s.instructionHash) && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 150)
    && typeof r.canonicalReadersReviewed === 'boolean' && typeof r.productionPaymentsAuthorized === 'boolean', 'PAID_RELEASE_INVALID');
  if (r.status === 'UNDEPLOYED') check(r.extension === null && r.extensionCodeHash === null
    && !r.productionPaymentsAuthorized && !r.canonicalReadersReviewed && r.allowedOwners.length === 0, 'PAID_RELEASE_INVALID');
  else check(address(r.extension) && hash(r.extensionCodeHash)
    && new Set([r.collection,r.registry,r.legacyProgression,r.extension]).size === 4
    && r.canonicalReadersReviewed && r.allowedOwners.length > 0
    && r.productionPaymentsAuthorized === (r.status === 'OWNER_CANARY'), 'PAID_RELEASE_INVALID');
  return Object.freeze({...r,allowedOwners:Object.freeze(r.allowedOwners),skills:Object.freeze(r.skills.map(Object.freeze))});
}

export function assertPaidSkillCoverage(paid,training) {
  check(paid.collection===training.collection && paid.collectionCodeHash===training.collectionCodeHash
    && paid.registry===training.registry && paid.registryCodeHash===training.registryCodeHash
    && paid.legacyProgression===training.progression && paid.legacyProgressionCodeHash===training.progressionCodeHash
    && paid.skills.every(skill=>training.skills.some(accepted=>['key','manifestHash','instructionHash'].every(k=>accepted[k]===skill[k]))),
    'PAID_SKILL_NOT_RELEASED');
  return paid;
}

export function paidAction(input) {
  check(keys(input,['operation','skillKey','slot']) && PAID_OPERATIONS.includes(input.operation)
    && /^0x[0-9a-f]{64}$/.test(input.skillKey) && Number.isInteger(input.slot) && input.slot >= 0 && input.slot < 7
    && (['learn','equip'].includes(input.operation) ? input.skillKey !== PAID_ZERO : input.skillKey === PAID_ZERO)
    && (['equip','unequip'].includes(input.operation) || input.slot === 0),'PAID_ACTION_INVALID');
  return {...input};
}
export function paidCalldata(review) {
  return encodeFunctionData({abi:PAID_ABI,functionName:'applyReview',args:[{tokenId:BigInt(review.tokenId),
    operation:PAID_OPERATIONS.indexOf(review.action.operation),skillKey:review.action.skillKey,slot:review.action.slot,
    nonce:BigInt(review.guard.nonce),stateHash:review.guard.stateHash,deadline:BigInt(review.guard.deadline)}]});
}
export function validatePaidReview(review, release) {
  check(keys(review,['schema','chainId','collection','registry','legacyProgression','extension','extensionCodeHash',
    'treasury','priceWei','owner','tokenId','action','guard','anchor','transaction'])
    && review.schema === 'GOGH_PAID_TRAINING_REVIEW_V1'
    && ['chainId','collection','registry','legacyProgression','extension','extensionCodeHash','treasury','priceWei']
      .every(k => review[k] === release[k]) && address(review.owner) && release.allowedOwners.includes(review.owner)
    && typeof review.tokenId === 'string' && /^[1-9][0-9]{0,3}$/.test(review.tokenId),'PAID_REVIEW_INVALID');
  paidAction(review.action);
  check(keys(review.guard,['nonce','stateHash','deadline']) && uint(review.guard.nonce) && hash(review.guard.stateHash)
    && uint(review.guard.deadline) && BigInt(review.guard.deadline) < 2n**64n
    && keys(review.anchor,['number','hash','timestamp']) && uint(review.anchor.number) && hash(review.anchor.hash)
    && uint(review.anchor.timestamp) && BigInt(review.guard.deadline) > BigInt(review.anchor.timestamp)
    && BigInt(review.guard.deadline) <= BigInt(review.anchor.timestamp)+60n,'PAID_REVIEW_INVALID');
  const tx = review.transaction;
  check(keys(tx,['from','to','data','value','chainId','nonce','gas','maxFeePerGas','maxPriorityFeePerGas'])
    && tx.from === review.owner && tx.to === release.extension && tx.chainId === '0x1237'
    && ['value','nonce','gas','maxFeePerGas','maxPriorityFeePerGas'].every(k => typeof tx[k] === 'string'
      && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(tx[k]))
    && tx.data === paidCalldata(review)
    && BigInt(tx.value) === (review.action.operation === 'buy' ? BigInt(release.priceWei) : 0n)
    && BigInt(tx.gas) > 0n && BigInt(tx.gas) <= 2000000n && BigInt(tx.maxFeePerGas) > 0n
    && BigInt(tx.nonce) <= BigInt(Number.MAX_SAFE_INTEGER)
    && BigInt(tx.maxPriorityFeePerGas) <= BigInt(tx.maxFeePerGas)
    && BigInt(tx.gas)*BigInt(tx.maxFeePerGas) <= BigInt(release.feeCeilingWei),'PAID_REVIEW_INVALID');
  check(!['learn','equip'].includes(review.action.operation) || release.skills.some(s => s.key === review.action.skillKey),'PAID_REVIEW_INVALID');
  return structuredClone(review);
}

// Code, authority and state are anchored; errors are sanitized at the API boundary.
export async function readPaidState({client,release,owner,tokenId,now=Date.now,anchor:requestedAnchor}) {
  check(release.status !== 'UNDEPLOYED' && address(owner)
    && typeof tokenId === 'string' && /^[1-9][0-9]{0,3}$/.test(tokenId) && await client.getChainId() === 4663);
  const anchor = checkedTrainingBlock(await client.getBlock(requestedAnchor?{blockNumber:BigInt(requestedAnchor.number)}:{blockTag:'latest'}),now());
  if(requestedAnchor)check(anchor.hash===requestedAnchor.hash && anchor.timestamp===requestedAnchor.timestamp);
  const blockNumber=BigInt(anchor.number),args=[BigInt(tokenId)];
  const read=(address,functionName,args=[])=>client.readContract({address,abi:PAID_ABI,functionName,args,blockNumber});
  const ext=(name,values=[])=>read(release.extension,name,values);
  const [codes,constants,currentOwner,purchasesPaused,activated,purchasedCredits,reviewNonce,reviewStateHash,
    unlockedSlots,burnCredits,legacyAllocationClaimed] = await Promise.all([
    Promise.all(['collection','registry','legacyProgression','extension'].map(name=>client.getCode({address:release[name],blockNumber}))),
    Promise.all(['collection','registry','legacyProgression','treasury','creditPriceWei'].map(name=>ext(name))),
    read(release.collection,'ownerOf',args),ext('purchasesPaused'),ext('activated',args),ext('purchasedCredits',args),
    ext('reviewNonce',args),ext('reviewStateHash',args),ext('unlockedSlots',args),
    read(release.legacyProgression,'trainingCredits',args),read(release.legacyProgression,'claimedStartingSlots',args),
  ]);
  check(codes.every((code,i)=>typeof code==='string' && code!=='0x' && keccak256(code)===release[`${['collection','registry','legacyProgression','extension'][i]}CodeHash`])
    && constants.slice(0,4).every((v,i)=>equal(v,release[['collection','registry','legacyProgression','treasury'][i]]))
    && constants[4]===BigInt(PAID_PRICE_WEI) && equal(currentOwner,owner)
    && typeof purchasesPaused==='boolean' && typeof activated==='boolean' && hash(reviewStateHash)
    && [purchasedCredits,reviewNonce,burnCredits].every(v=>typeof v==='bigint' && uint(String(v)))
    && Number.isInteger(unlockedSlots) && unlockedSlots>=1 && unlockedSlots<=7
    && Number.isInteger(legacyAllocationClaimed) && legacyAllocationClaimed>=0 && legacyAllocationClaimed<=3);
  const equipped=await Promise.all(Array.from({length:unlockedSlots},(_,i)=>ext('equipped',[...args,i])));
  check(equipped.every(k=>/^0x[0-9a-f]{64}$/.test(k)) && new Set(equipped.filter(k=>k!==PAID_ZERO)).size===equipped.filter(k=>k!==PAID_ZERO).length);
  const burnSource=await read(release.legacyProgression,'trainingSource');
  check(typeof burnSource==='string' && /^0x[0-9a-f]{40}$/i.test(burnSource));
  const [approved,burnOperator]=await Promise.all([read(release.collection,'getApproved',args),read(release.collection,'isApprovedForAll',[owner,burnSource])]);
  check(typeof approved==='string' && /^0x[0-9a-f]{40}$/i.test(approved) && typeof burnOperator==='boolean');
  const skills=await Promise.all(release.skills.map(async skill=>{
    const [definition,available,level,allowed]=await Promise.all([read(release.registry,'definition',[skill.key]),
      read(release.registry,'available',[skill.key]),ext('learnedLevel',[...args,skill.key]),ext('allowedSkill',[skill.key])]);
    check(typeof available==='boolean' && typeof allowed==='boolean' && Number.isInteger(level) && level>=0 && level<=255);
    return {...skill,level,available:available && allowed && definition.manifestHash===skill.manifestHash
      && definition.instructionHash===skill.instructionHash && definition.prerequisite===PAID_ZERO
      && definition.riskTier===0 && definition.capabilities>0n && (definition.capabilities & ~205n)===0n
      && definition.status===4 && !definition.disabled && !definition.deprecated};
  }));
  await assertTrainingOwnerContinuity({client,release,owner,tokenId,anchor,now});
  return {owner,tokenId,chainId:4663,anchor,purchasesPaused,activated,purchasedCredits:String(purchasedCredits),
    burnCredits:String(burnCredits),reviewNonce:String(reviewNonce),reviewStateHash,unlockedSlots,
    legacyAllocationClaimed,skills,equipped,burnApprovalActive:equal(approved,burnSource)||burnOperator};
}

function actionAllowed(action,state) {
  const {operation,skillKey,slot}=action,skill=state.skills.find(s=>s.key===skillKey);
  const usefulCredits=state.skills.filter(s=>s.available && s.level===0).length
    +(state.legacyAllocationClaimed>0?7-state.unlockedSlots:0);
  if(operation==='buy'){
    check(!state.burnApprovalActive,'PAID_BURN_APPROVAL_ACTIVE');
    check(!state.purchasesPaused && BigInt(state.purchasedCredits)<BigInt(usefulCredits),'PAID_PURCHASE_UNAVAILABLE');
  }
  else if(operation==='activate')check(!state.activated,'PAID_ALREADY_ACTIVATED');
  else check(state.activated,'PAID_ACTIVATION_REQUIRED');
  if(['learn','equip'].includes(operation))check(skill?.available && (operation==='learn'?skill.level===0:skill.level>0),'PAID_SKILL_UNAVAILABLE');
  if(['learn','unlock'].includes(operation))check(BigInt(state.purchasedCredits)>0n,'PAID_NO_CREDIT');
  if(operation==='unlock')check(state.legacyAllocationClaimed>0 && state.unlockedSlots<7,'PAID_SLOT_UNAVAILABLE');
  if(['equip','unequip'].includes(operation))check(slot<state.unlockedSlots,'PAID_SLOT_UNAVAILABLE');
  if(operation==='equip')check(!state.equipped.includes(skillKey),'PAID_ALREADY_EQUIPPED');
  if(operation==='unequip')check(state.equipped[slot]!==PAID_ZERO,'PAID_SLOT_EMPTY');
}
const callOf=review=>({account:review.owner,to:review.extension,data:review.transaction.data,value:BigInt(review.transaction.value),
  gas:BigInt(review.transaction.gas),maxFeePerGas:BigInt(review.transaction.maxFeePerGas),maxPriorityFeePerGas:BigInt(review.transaction.maxPriorityFeePerGas)});

export function createPaidTrainingCoordinator({clients,release:input,now=Date.now}) {
  const release=validatePaidRelease(input);
  check(release.status!=='UNDEPLOYED' && Array.isArray(clients) && clients.length===2 && clients[0]!==clients[1],'PAID_NOT_RELEASED');
  const client=clients[1];
  const state=identity=>readPaidState({client,release,...identity,now});
  const identityOf=r=>({owner:r.owner,tokenId:r.tokenId});
  const mutable=()=>check(release.status==='OWNER_CANARY' && release.productionPaymentsAuthorized,'PAID_NOT_RELEASED');
  async function nonce(owner) {
    const [latest,pending]=await Promise.all(['latest','pending'].map(blockTag=>client.getTransactionCount({address:owner,blockTag})));
    check(Number.isSafeInteger(latest) && latest>=0 && latest===pending,'PAID_WALLET_PENDING');return latest;
  }
  async function verify(inputReview) {
    mutable();const review=validatePaidReview(inputReview,release),current=await state(identityOf(review));
    check(current.reviewNonce===review.guard.nonce && current.reviewStateHash===review.guard.stateHash,'PAID_STATE_CHANGED');
    check(BigInt(current.anchor.timestamp)+5n<BigInt(review.guard.deadline),'PAID_REVIEW_EXPIRED');
    actionAllowed(review.action,current);
    check(BigInt(await nonce(review.owner))===BigInt(review.transaction.nonce),'PAID_NONCE_CHANGED');
    const call=callOf(review),[estimate,balance,block]=await Promise.all([client.estimateGas(call),
      client.getBalance({address:review.owner,blockTag:'pending'}),client.getBlock({blockTag:'latest'})]);
    check(typeof estimate==='bigint' && estimate>0n && estimate<=call.gas && typeof balance==='bigint'
      && balance>=call.value+call.gas*call.maxFeePerGas && typeof block.baseFeePerGas==='bigint'
      && block.baseFeePerGas+call.maxPriorityFeePerGas<=call.maxFeePerGas,'PAID_FEE_CHANGED');
    await client.call(call);
    await assertTrainingOwnerContinuity({client,release,...identityOf(review),anchor:review.anchor,now});
    return {review};
  }
  async function prepare({owner,tokenId,action:inputAction}) {
    mutable();const action=paidAction(inputAction),current=await state({owner,tokenId});actionAllowed(action,current);
    const [ownerNonce,fees]=await Promise.all([nonce(owner),client.estimateFeesPerGas({type:'eip1559'})]);
    check(typeof fees.maxFeePerGas==='bigint' && fees.maxFeePerGas>0n && typeof fees.maxPriorityFeePerGas==='bigint'
      && fees.maxPriorityFeePerGas>=0n && fees.maxPriorityFeePerGas<=fees.maxFeePerGas,'PAID_FEE_UNAVAILABLE');
    const review={schema:'GOGH_PAID_TRAINING_REVIEW_V1',...Object.fromEntries(['chainId','collection','registry','legacyProgression',
      'extension','extensionCodeHash','treasury','priceWei'].map(k=>[k,release[k]])),owner,tokenId,action,
      guard:{nonce:current.reviewNonce,stateHash:current.reviewStateHash,deadline:String(BigInt(current.anchor.timestamp)+60n)},anchor:current.anchor,
      transaction:{from:owner,to:release.extension,data:'0x',value:hex(action.operation==='buy'?release.priceWei:0),chainId:'0x1237',
        nonce:hex(ownerNonce),gas:hex(2000000),maxFeePerGas:hex(fees.maxFeePerGas),maxPriorityFeePerGas:hex(fees.maxPriorityFeePerGas)}};
    review.transaction.data=paidCalldata(review);
    const estimate=await client.estimateGas(callOf(review));
    check(typeof estimate==='bigint' && estimate>0n && estimate<1600000n,'PAID_GAS_UNAVAILABLE');
    review.transaction.gas=hex((estimate*120n+99n)/100n);
    await verify(review);
    return {review,maximumNetworkFeeWei:String(BigInt(review.transaction.gas)*fees.maxFeePerGas)};
  }
  async function recover({owner,tokenId,review:inputReview,transactionHash}) {
    const review=validatePaidReview(inputReview,release);
    check(review.owner===owner && review.tokenId===tokenId && hash(transactionHash),'PAID_RECOVERY_INVALID');
    // Current owner session protects history access; recovery remains usable when paused.
    await state({owner,tokenId});
    const results=await Promise.all(clients.map(c=>paidReceipt({client:c,release,review,transactionHash})));
    check(JSON.stringify(results[0])===JSON.stringify(results[1]),'PAID_RECEIPT_DISAGREEMENT');return {...results[0],review};
  }
  async function abandon({owner,tokenId,review:inputReview}) {
    const review=validatePaidReview(inputReview,release);
    check(review.owner===owner && review.tokenId===tokenId,'PAID_RECOVERY_INVALID');
    const current=await state({owner,tokenId});
    check(current.reviewNonce===review.guard.nonce,'PAID_RECOVERY_REQUIRED');
    const heads=await Promise.all(clients.map(c=>c.getBlock({blockTag:'finalized'})));
    check(heads.every(b=>typeof b.number==='bigint' && typeof b.timestamp==='bigint' && hash(b.hash)));
    const number=heads.reduce((min,b)=>b.number<min?b.number:min,heads[0].number);
    const results=await Promise.all(clients.map(async c=>{
      check(await c.getChainId()===4663);
      const block=await c.getBlock({blockNumber:number});
      check(block.number===number && hash(block.hash) && block.timestamp>BigInt(review.guard.deadline),'PAID_EXPIRY_NOT_FINAL');
      const read=(name,blockNumber=number)=>c.readContract({address:release.extension,abi:PAID_ABI,functionName:name,args:[BigInt(tokenId)],blockNumber});
      const [atFinal,atLatest,latestNonce,pendingNonce,code,ownerAtFinal]=await Promise.all([
        read('reviewNonce'),c.readContract({address:release.extension,abi:PAID_ABI,functionName:'reviewNonce',args:[BigInt(tokenId)],blockTag:'latest'}),
        c.getTransactionCount({address:owner,blockTag:'latest'}),c.getTransactionCount({address:owner,blockTag:'pending'}),
        c.getCode({address:release.extension,blockNumber:number}),
        c.readContract({address:release.collection,abi:PAID_ABI,functionName:'ownerOf',args:[BigInt(tokenId)],blockNumber:number}),
      ]);
      check(atFinal===BigInt(review.guard.nonce) && atLatest===atFinal && equal(ownerAtFinal,owner)
        && Number.isSafeInteger(latestNonce) && latestNonce===pendingNonce && BigInt(latestNonce)===BigInt(review.transaction.nonce)
        && keccak256(code??'0x')===release.extensionCodeHash,'PAID_RECOVERY_REQUIRED');
      check((await c.getBlock({blockNumber:number})).hash===block.hash);
      return {status:'EXPIRED_UNUSED',blockNumber:String(number),blockHash:block.hash};
    }));
    check(JSON.stringify(results[0])===JSON.stringify(results[1]),'PAID_RECEIPT_DISAGREEMENT');return {...results[0],review};
  }
  return Object.freeze({get:state,prepare,verify,recover,abandon});
}

async function paidReceipt({client,release,review,transactionHash}) {
  check(await client.getChainId()===4663);
  const tx=await client.getTransaction({hash:transactionHash}),want=review.transaction;
  check(tx && equal(tx.hash,transactionHash) && tx.chainId===4663 && tx.type==='eip1559' && tx.authorizationList==null
    && (tx.accessList==null || Array.isArray(tx.accessList) && tx.accessList.length===0)
    && equal(tx.from,want.from) && equal(tx.to,want.to) && tx.input===want.data
    && Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce)===BigInt(want.nonce)
    && ['value','gas','maxFeePerGas','maxPriorityFeePerGas'].every(k=>typeof tx[k]==='bigint' && tx[k]===BigInt(want[k])), 'PAID_RECEIPT_TRANSACTION_MISMATCH');
  let receipt;try{receipt=await client.getTransactionReceipt({hash:transactionHash});}
  catch(error){if(error?.name!=='TransactionReceiptNotFoundError')throw error;}
  if(!receipt)return {status:'PENDING',transactionHash};
  check(equal(receipt.transactionHash,transactionHash) && typeof receipt.blockNumber==='bigint' && hash(receipt.blockHash)
    && tx.blockNumber===receipt.blockNumber && equal(tx.blockHash,receipt.blockHash)
    && equal(receipt.from,review.owner) && equal(receipt.to,release.extension)
    && ['success','reverted'].includes(receipt.status) && Array.isArray(receipt.logs) && receipt.logs.length<=64
    && typeof receipt.gasUsed==='bigint' && receipt.gasUsed>0n && receipt.gasUsed<=BigInt(want.gas)
    && typeof receipt.effectiveGasPrice==='bigint' && receipt.effectiveGasPrice>=0n && receipt.effectiveGasPrice<=BigInt(want.maxFeePerGas)
    && receipt.blockNumber>=BigInt(review.anchor.number),'PAID_RECEIPT_INVALID');
  const [block,anchor,code,finalized]=await Promise.all([client.getBlock({blockNumber:receipt.blockNumber}),
    client.getBlock({blockNumber:BigInt(review.anchor.number)}),client.getCode({address:release.extension,blockNumber:receipt.blockNumber}),
    client.getBlock({blockTag:'finalized'})]);
  check(block.number===receipt.blockNumber && block.hash===receipt.blockHash && anchor.number===BigInt(review.anchor.number) && anchor.hash===review.anchor.hash
    && String(anchor.timestamp)===review.anchor.timestamp && keccak256(code??'0x')===release.extensionCodeHash
    && typeof finalized.number==='bigint' && hash(finalized.hash),'PAID_RECEIPT_INVALID');
  if(receipt.status==='success') {
    check(block.timestamp>=BigInt(review.anchor.timestamp) && block.timestamp<=BigInt(review.guard.deadline));
    let priorIndex=-1;
    for(const log of receipt.logs){
      check(log.removed===false && log.blockHash===block.hash && log.blockNumber===block.number
        && equal(log.transactionHash,transactionHash) && Number.isSafeInteger(log.logIndex) && log.logIndex>priorIndex);
      priorIndex=log.logIndex;
    }
    const applied=receipt.logs.filter(log=>equal(log.address,release.extension)).flatMap(log=>{
      check(log.removed===false && log.blockHash===block.hash && log.blockNumber===block.number && equal(log.transactionHash,transactionHash));
      try{const event=decodeEventLog({abi:PAID_ABI,data:log.data,topics:log.topics,strict:true});return event.eventName==='PaidTrainingReviewApplied'?[event]:[];}catch{return [];}
    });
    check(applied.length===1 && applied[0].args.tokenId===BigInt(review.tokenId)
      && applied[0].args.nonce===BigInt(review.guard.nonce) && applied[0].args.operation===PAID_OPERATIONS.indexOf(review.action.operation),'PAID_RECEIPT_EVENT_MISMATCH');
  }else check(receipt.logs.length===0);
  const [closing,closingFinal]=await Promise.all([client.getBlock({blockNumber:block.number}),client.getBlock({blockNumber:finalized.number})]);
  check(closing.number===block.number && closing.hash===block.hash && closingFinal.number===finalized.number
    && closingFinal.hash===finalized.hash && await client.getChainId()===4663);
  return {status:`${finalized.number>=block.number?'CONFIRMED':'INCLUDED'}_${receipt.status==='success'?'SUCCESS':'REVERT'}`,
    transactionHash,blockNumber:String(block.number),blockHash:block.hash};
}
