import {encodeFunctionData,keccak256,parseAbi,decodeEventLog,zeroAddress} from 'viem';

export const PAID_OWNER='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
export const PAID_ABI=parseAbi([
 'function ownerOf(uint256) view returns(address)', 'function account(uint256) view returns(address)',
 'function vaults(uint256) view returns(address)',
 'function authorize(uint256,address,address,bytes32,uint256,uint256,uint64,uint48) payable',
 'function mission() view returns(address,address,address,bytes32,uint256,uint256,uint64,uint48,uint8)',
 'function refundable(address) view returns(uint256)', 'function cancel(uint64)',
 'function withdrawRefund(address)', 'function execute(uint64)',
 'function getPublicDrop(address) view returns(uint80,uint48,uint48,uint16,uint16,bool)',
 'event MissionAuthorized(uint64 indexed generation,address indexed owner,address indexed collection,address executor,address recipient,uint256 priceWei,uint256 executionFeeWei,uint48 deadline)',
 'event MissionCompleted(uint64 indexed generation,address indexed collection,uint256 indexed tokenId,address recipient,uint256 priceWei,uint256 executionFeeWei)',
 'event MissionCancelled(uint64 indexed generation,address indexed funder,uint256 refundWei)',
 'event RefundWithdrawn(address indexed funder,address indexed recipient,uint256 amount)',
 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
export const paidSame=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const paidAssert=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
export const paidHex=value=>`0x${BigInt(value).toString(16)}`;
export const paidJson=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v);
export function validatePaidRelease(r) {
 paidAssert(r?.schema==='GOGH_DIRECTED_PAID_MINT_RELEASE_V1'&&r.status==='OWNER_CANARY'
  &&r.productionPaidMintAuthorized===true&&r.chainId===4663&&r.owner===PAID_OWNER&&r.tokenId==='93'
  &&r.allowedOwners?.length===1&&r.allowedOwners[0]===PAID_OWNER,'PAID_MINT_NOT_RELEASED');
 for(const key of ['collection','factory','adapter','agentRegistry','targetCollection','vault','recipient','recipientImplementation'])
  paidAssert(/^0x[0-9a-f]{40}$/.test(r[key])&&/^0x[0-9a-f]{64}$/.test(r[`${key}CodeHash`]),'PAID_MINT_RELEASE_INVALID');
 for(const key of ['executor','recipient'])paidAssert(/^0x[0-9a-f]{40}$/.test(r[key]),'PAID_MINT_RELEASE_INVALID');
 paidAssert(BigInt(r.maximumExecutionFeeWei)>0n&&BigInt(r.maximumExecutionFeeWei)<=100000000000000n
  &&BigInt(r.maximumPriceWei)>0n&&BigInt(r.maximumPriceWei)<=1000000000000000n
  &&BigInt(r.workerGasCeiling)===500000n&&BigInt(r.ownerFeeCeilingWei)<=1000000000000000n,'PAID_MINT_RELEASE_INVALID');
 return r;
}
export const paidRead=(c,address,functionName,args=[],blockNumber)=>c.readContract({address,abi:PAID_ABI,functionName,args,blockNumber});
export async function readPaidState(clients,release,now=Date.now) {
 paidAssert(clients.length===2&&clients[0]!==clients[1],'PAID_PROVIDERS_REQUIRED');
 const heads=await Promise.all(clients.map(c=>c.getBlock()));const block=heads.reduce((a,b)=>a.number<b.number?a:b);
 paidAssert(Math.abs(now()/1000-Number(block.timestamp))<45,'PAID_CHAIN_STALE');
 const results=await Promise.all(clients.map(async c=>{
  paidAssert(await c.getChainId()===4663&&paidSame((await c.getBlock({blockNumber:block.number})).hash,block.hash),'PAID_CHAIN_CHANGED');
  await Promise.all(['collection','factory','adapter','agentRegistry','recipient','recipientImplementation'].map(async key=>
   paidAssert(keccak256(await c.getCode({address:release[key],blockNumber:block.number})??'0x')===release[`${key}CodeHash`],'PAID_RUNTIME_CHANGED')));
  const [owner,recipient,vault,drop,targetCode]=await Promise.all([
   paidRead(c,release.collection,'ownerOf',[93n],block.number).catch(error=>{
    if(error.walk?.(e=>e.name==='ContractFunctionRevertedError'))return null;throw error;
   }),paidRead(c,release.agentRegistry,'account',[93n],block.number),
   paidRead(c,release.factory,'vaults',[93n],block.number),paidRead(c,'0x00005ea00ac477b1030ce78506496e8c2de24bf5','getPublicDrop',[release.targetCollection],block.number),
   c.getCode({address:release.targetCollection,blockNumber:block.number})]);
  paidAssert(paidSame(recipient,release.recipient)&&(await c.getCode({address:recipient,blockNumber:block.number}))?.length>2,'PAID_RECIPIENT_CHANGED');
  const deployed=!paidSame(vault,zeroAddress);
  const code=await c.getCode({address:release.vault,blockNumber:block.number});
  paidAssert(deployed?(paidSame(vault,release.vault)&&keccak256(code??'0x')===release.vaultCodeHash):(!code||code==='0x'),'PAID_VAULT_CHANGED');
  const [mission,refund]=deployed?await Promise.all([paidRead(c,vault,'mission',[],block.number),paidRead(c,vault,'refundable',[release.owner],block.number)]):[null,0n];
  return {owner:owner?.toLowerCase()??null,targetCodeHash:keccak256(targetCode??'0x'),deployed,mission:mission?JSON.parse(paidJson(mission)).map(v=>typeof v==='string'?v.toLowerCase():v):null,
   refundWei:String(refund),priceWei:String(drop[0]),dropStart:String(drop[1]),dropEnd:String(drop[2]),
   generation:mission?String(mission[6]):'0',missionStatus:mission?Number(mission[8]):0};
 }));
 paidAssert(paidJson(results[0])===paidJson(results[1]),'PAID_PROVIDERS_DISAGREE');
 return {...results[0],anchor:{number:String(block.number),hash:block.hash,timestamp:String(block.timestamp)}};
}
export function paidCall(review,r) {
 if(review.action==='AUTHORIZE')return {to:r.factory,value:BigInt(review.priceWei)+BigInt(review.executionFeeWei),
  data:encodeFunctionData({abi:PAID_ABI,functionName:'authorize',args:[93n,r.executor,r.targetCollection,r.targetCollectionCodeHash,
   BigInt(review.priceWei),BigInt(review.executionFeeWei),BigInt(review.expectedGeneration),BigInt(review.deadline)]})};
 if(review.action==='CANCEL_MISSION')return {to:r.vault,value:0n,data:encodeFunctionData({abi:PAID_ABI,functionName:'cancel',args:[BigInt(review.expectedGeneration)]})};
 paidAssert(review.action==='WITHDRAW_REFUND','PAID_INVALID_ACTION');
 return {to:r.vault,value:0n,data:encodeFunctionData({abi:PAID_ABI,functionName:'withdrawRefund',args:[r.owner]})};
}
export function missionMatches(m,review,r) {
 return m&&paidSame(m[0],r.owner)&&paidSame(m[1],r.executor)&&paidSame(m[2],r.targetCollection)
  &&m[3]===r.targetCollectionCodeHash&&String(m[4])===review.priceWei&&String(m[5])===review.executionFeeWei
  &&String(m[6])===String(BigInt(review.expectedGeneration)+1n)&&String(m[7])===review.deadline;
}
export function paidEvents(receipt,address,eventName) {
 return receipt.logs.filter(l=>paidSame(l.address,address)).flatMap(l=>{
  try{const e=decodeEventLog({abi:PAID_ABI,data:l.data,topics:l.topics,strict:true});return e.eventName===eventName?[e.args]:[];}catch{return [];}
 });
}
export async function verifyPaidTransaction(clients,expected,hash,{confirmations=12n}={}) {
 const all=await Promise.all(clients.map(async c=>{
  const [tx,receipt]=await Promise.all([c.getTransaction({hash}),c.getTransactionReceipt({hash})]);
  const block=await c.getBlock({blockNumber:receipt.blockNumber});
  paidAssert(paidSame(tx.hash,hash)&&paidSame(receipt.transactionHash,hash)&&paidSame(tx.from,expected.from)
   &&paidSame(tx.to,expected.to)&&tx.input===expected.data&&tx.value===BigInt(expected.value)
   &&tx.chainId===4663&&tx.nonce===Number(BigInt(expected.nonce))&&tx.gas===BigInt(expected.gas)
   &&tx.gasPrice===BigInt(expected.gasPrice)&&!tx.authorizationList?.length&&paidSame(tx.blockHash,block.hash)
   &&paidSame(receipt.blockHash,block.hash)&&receipt.gasUsed<=tx.gas&&receipt.effectiveGasPrice<=tx.gasPrice
   &&['success','reverted'].includes(receipt.status),'PAID_RECEIPT_MISMATCH');
  paidAssert(await c.getBlockNumber()>=receipt.blockNumber+confirmations,'PAID_CONFIRMATIONS_PENDING');
  return {receipt,block};
 }));
 paidAssert(paidJson(all[0])===paidJson(all[1]),'PAID_PROVIDERS_DISAGREE');
 return all[0];
}
export const paidReceiptPending=e=>['TransactionNotFoundError','TransactionReceiptNotFoundError','BlockNotFoundError'].includes(e.name)
 ||e.message==='PAID_CONFIRMATIONS_PENDING';
