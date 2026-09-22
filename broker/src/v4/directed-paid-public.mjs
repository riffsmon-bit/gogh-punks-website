import {randomBytes} from 'node:crypto';
import {encodeFunctionData,parseAbi,keccak256,decodeEventLog} from 'viem';
import {paidAssert as check,paidSame as same,paidJson as json,paidHex as hex,verifyPaidTransaction,paidReceiptPending} from './directed-paid-mint.mjs';
import {paidReceiptState} from './directed-paid-archive.mjs';
export const PUBLIC_PAID_ABI=parseAbi([
 'function ownerOf(uint256) view returns(address)','function account(uint256) view returns(address)','function accountSalt() view returns(bytes32)',
 'function owner() view returns(address)','function token() view returns(uint256,address,uint256)','function state() view returns(uint256)',
 'function execute(address,uint256,bytes,uint8) payable returns(bytes)',
 'function mintPublic(address,address,address,uint256) payable',
 'function getPublicDrop(address) view returns(uint80,uint48,uint48,uint16,uint16,bool)',
 'function getMintStats(address) view returns(uint256,uint256,uint256)',
 'function getFeeRecipientIsAllowed(address,address) view returns(bool)',
 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
const natural=v=>typeof v==='bigint'&&v>=0n;
const canonical=(block,number,hash)=>block&&natural(block.number)&&block.number===number&&/^0x[0-9a-f]{64}$/.test(block.hash)&&(!hash||same(block.hash,hash));
const ZERO='0x'+'0'.repeat(40),word=n=>BigInt(n).toString(16).padStart(64,'0');
export const publicPaidIdentity=(owner,tokenId)=>{check(/^0x[0-9a-f]{40}$/.test(owner)&&/^[1-9][0-9]{0,3}$/.test(tokenId)&&Number(tokenId)<=5016,'PUBLIC_PAID_INVALID_IDENTITY');return {owner,tokenId};};
export function publicPaidAvailable(release){const p=release?.publicOwnerMint;return p?.schema==='GOGH_PUBLIC_OWNER_PAID_MINT_V1'&&p.enabled===true&&p.status==='LIVE'&&p.execution==='CURRENT_OWNER_ATOMIC_WALLET'&&p.quantity===1;}
export function publicPaidAccountCode(release,tokenId,salt){return `0x363d3d373d3d3d363d73${release.recipientImplementation.slice(2)}5af43d82803e903d91602b57fd5bf3${salt.slice(2)}${word(4663)}${release.collection.slice(2).padStart(64,'0')}${word(tokenId)}`;}
export function publicPaidCollection(collection,r){check(typeof collection==='string'&&/^0x[0-9a-f]{40}$/.test(collection)&&collection!==r.collection&&BigInt(collection)!==0n,'PUBLIC_PAID_INVALID_COLLECTION');return {...r,targetCollection:collection};}
export function publicPaidCall(review,r){const p=r.publicOwnerMint;return {to:review.recipient,value:BigInt(review.priceWei),data:encodeFunctionData({abi:PUBLIC_PAID_ABI,functionName:'execute',args:[p.seaDrop,BigInt(review.priceWei),encodeFunctionData({abi:PUBLIC_PAID_ABI,functionName:'mintPublic',args:[review.collection,p.feeRecipient,ZERO,1n]}),0]})};}
export async function readPublicPaidState(clients,r,identity,now=Date.now){
 publicPaidIdentity(identity.owner,identity.tokenId);check(clients.length===2&&clients[0]!==clients[1],'PAID_PROVIDERS_REQUIRED');
 const p=r.publicOwnerMint,heads=await Promise.all(clients.map(c=>c.getBlock()));check(heads.every(b=>canonical(b,b?.number)&&natural(b.timestamp)&&b.timestamp>0n),'PAID_CHAIN_CHANGED');const anchor=heads.reduce((a,b)=>a.number<b.number?a:b);
 check(Math.abs(now()/1000-Number(anchor.timestamp))<45,'PAID_CHAIN_STALE');
 const values=await Promise.all(clients.map(async c=>{
  check(await c.getChainId()===4663&&canonical(await c.getBlock({blockNumber:anchor.number}),anchor.number,anchor.hash),'PAID_CHAIN_CHANGED');
  const read=(address,functionName,args=[])=>c.readContract({address,abi:PUBLIC_PAID_ABI,functionName,args,blockNumber:anchor.number,ccipRead:false});
  for(const [address,hash] of [[r.collection,r.collectionCodeHash],[r.agentRegistry,r.agentRegistryCodeHash],[r.recipientImplementation,r.recipientImplementationCodeHash],[r.targetCollection,r.targetCollectionCodeHash],[p.seaDrop,p.seaDropCodeHash]])
   check(keccak256(await c.getCode({address,blockNumber:anchor.number})??'0x')===hash,'PAID_RUNTIME_CHANGED');
  const [owner,recipient,salt,drop]=await Promise.all([read(r.collection,'ownerOf',[BigInt(identity.tokenId)]),read(r.agentRegistry,'account',[BigInt(identity.tokenId)]),read(r.agentRegistry,'accountSalt'),read(p.seaDrop,'getPublicDrop',[r.targetCollection])]);
  check(same(owner,identity.owner),'PUBLIC_PAID_NOT_OWNER');
  const code=await c.getCode({address:recipient,blockNumber:anchor.number});
  if(!code||code==='0x')return {owner:identity.owner,tokenId:identity.tokenId,recipient:recipient.toLowerCase(),activated:false};
  check(code.toLowerCase()===publicPaidAccountCode(r,identity.tokenId,salt.toLowerCase()),'PUBLIC_PAID_ACCOUNT_CHANGED');
  const [accountOwner,binding,accountState,stats,feeAllowed]=await Promise.all([read(recipient,'owner'),read(recipient,'token'),read(recipient,'state'),read(r.targetCollection,'getMintStats',[recipient]),drop[5]?read(p.seaDrop,'getFeeRecipientIsAllowed',[r.targetCollection,p.feeRecipient]):true]);
  check(same(accountOwner,identity.owner)&&binding[0]===4663n&&same(binding[1],r.collection)&&binding[2]===BigInt(identity.tokenId),'PUBLIC_PAID_ACCOUNT_CHANGED');
  const unavailableReason=drop[0]===0n?'NOT_PAID':drop[0]>BigInt(p.maximumPriceWei)?'PRICE_LIMIT':anchor.timestamp<drop[1]?'NOT_STARTED':anchor.timestamp>drop[2]?'ENDED':stats[0]>=BigInt(drop[3])?'WALLET_LIMIT':stats[1]>=stats[2]?'SOLD_OUT':!feeAllowed?'FEE_RECIPIENT_UNAVAILABLE':null;const available=unavailableReason===null;
  check(canonical(await c.getBlock({blockNumber:anchor.number}),anchor.number,anchor.hash),'PAID_CHAIN_CHANGED');
  return {owner:identity.owner,tokenId:identity.tokenId,recipient:recipient.toLowerCase(),activated:true,recipientCodeHash:keccak256(code),accountState:String(accountState),priceWei:String(drop[0]),available,unavailableReason,startsAt:String(drop[1]),endsAt:String(drop[2]),mintedByWallet:String(stats[0]),walletLimit:String(drop[3]),minted:String(stats[1]),supply:String(stats[2]),nextTokenId:String(stats[1]+1n)};
 }));check(json(values[0])===json(values[1]),'PAID_PROVIDERS_DISAGREE');
 return {...values[0],collection:r.targetCollection,anchor:{number:String(anchor.number),hash:anchor.hash,timestamp:String(anchor.timestamp)}};
}
export function createPublicPaidCoordinator({clients,historyClients=()=>clients,release:r,identity,store,now=Date.now}){
 publicPaidIdentity(identity.owner,identity.tokenId);const state=(collection=r.targetCollection)=>readPublicPaidState(clients,publicPaidCollection(collection,r),identity,now),terminal=['CONFIRMED','REVERTED','CANCELLED','DECLINED'];
 function validate(review){const p=r.publicOwnerMint,tx=review?.transaction;
  check(review?.schema==='GOGH_PUBLIC_OWNER_PAID_REVIEW_V1'&&review.owner===identity.owner&&review.tokenId===identity.tokenId&&/^0x[0-9a-f]{40}$/.test(review.collection)&&review.collection!==r.collection&&review.quantity===1&&/^0x[0-9a-f]{40}$/.test(review.recipient)&&/^0x[0-9a-f]{64}$/.test(review.recipientCodeHash),'PUBLIC_PAID_REVIEW_CHANGED');
  check(BigInt(review.priceWei)>0n&&BigInt(review.priceWei)<=BigInt(review.maximumPriceWei)&&BigInt(review.maximumPriceWei)<=BigInt(p.maximumPriceWei),'PUBLIC_PAID_REVIEW_CHANGED');
  const call=publicPaidCall(review,r);check(tx&&Object.keys(tx).length===9&&Object.keys(tx).every(k=>['from','to','data','value','chainId','type','nonce','gas','gasPrice'].includes(k))&&tx.from===identity.owner&&tx.to===call.to&&tx.data===call.data&&BigInt(tx.value)===call.value&&tx.chainId==='0x1237'&&tx.type==='0x0'&&BigInt(tx.gas)>0n&&BigInt(tx.gas)<=1000000n&&BigInt(tx.gasPrice)>0n&&BigInt(tx.gas)*BigInt(tx.gasPrice)===BigInt(review.maximumNetworkFeeWei)&&BigInt(review.maximumNetworkFeeWei)<=BigInt(p.ownerFeeCeilingWei),'PUBLIC_PAID_REVIEW_CHANGED');return call;
 }
 async function preflight(review){const call=validate(review);check(now()+3000<review.expiresAt,'PAID_REVIEW_EXPIRED');const s=await state(review.collection);
  check(s.activated&&s.available&&s.recipient===review.recipient&&s.recipientCodeHash===review.recipientCodeHash&&s.accountState===review.accountState&&s.priceWei===review.priceWei,'PUBLIC_PAID_STATE_CHANGED');
  await Promise.all(clients.map(async c=>{check(canonical(await c.getBlock({blockNumber:BigInt(review.anchor.number)}),BigInt(review.anchor.number),review.anchor.hash),'PAID_CHAIN_CHANGED');
   const [latest,pending,balance]=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:identity.owner,blockTag})).concat(c.getBalance({address:identity.owner})));
   check(latest===Number(BigInt(review.transaction.nonce))&&pending===latest,'PAID_OWNER_NONCE_CHANGED');check(balance>=call.value+BigInt(review.maximumNetworkFeeWei),'PAID_OWNER_UNFUNDED');
   await c.call({account:identity.owner,...call,gas:BigInt(review.transaction.gas),gasPrice:BigInt(review.transaction.gasPrice)});
  }));const finalState=await state(review.collection);check(finalState.activated&&finalState.available&&finalState.owner===s.owner&&finalState.recipient===s.recipient&&finalState.recipientCodeHash===s.recipientCodeHash&&finalState.priceWei===s.priceWei&&finalState.accountState===s.accountState,'PUBLIC_PAID_STATE_CHANGED');check(now()+1000<review.expiresAt,'PAID_REVIEW_EXPIRED');
 }
 async function prepare({maximumPriceWei,collection=r.targetCollection}){
  publicPaidCollection(collection,r);
  check(publicPaidAvailable(r),'PUBLIC_PAID_DISABLED');check(typeof maximumPriceWei==='string'&&/^[1-9][0-9]{0,15}$/.test(maximumPriceWei)&&BigInt(maximumPriceWei)<=BigInt(r.publicOwnerMint.maximumPriceWei),'PAID_INVALID_PRICE_LIMIT');
  const pendingPunk=await store.pendingPunk?.();check(!pendingPunk||pendingPunk===identity.tokenId,'PAID_OWNER_REVIEW_PENDING');const old=await store.current();check(!old||terminal.includes(old.status),'PAID_RECOVER_EXISTING_REVIEW');const s=await state(collection);check(s.activated,'PUBLIC_PAID_ACTIVATION_REQUIRED');check(s.available&&BigInt(s.priceWei)<=BigInt(maximumPriceWei),'PAID_PRICE_CHANGED');
  await paidReceiptState(historyClients(),{blockNumber:BigInt(s.anchor.number),blockHash:s.anchor.hash},async c=>{check(canonical(await c.getBlock({blockNumber:BigInt(s.anchor.number)}),BigInt(s.anchor.number),s.anchor.hash),'PAID_CHAIN_CHANGED');check(keccak256(await c.getCode({address:collection,blockNumber:BigInt(s.anchor.number)})??'0x')===r.targetCollectionCodeHash,'PAID_RUNTIME_CHANGED');const stats=await c.readContract({address:collection,abi:PUBLIC_PAID_ABI,functionName:'getMintStats',args:[s.recipient],blockNumber:BigInt(s.anchor.number),ccipRead:false});check(String(stats[1])===s.minted,'PAID_PROVIDERS_DISAGREE');});
  const review={schema:'GOGH_PUBLIC_OWNER_PAID_REVIEW_V1',intentId:randomBytes(32).toString('hex'),...identity,collection,recipient:s.recipient,recipientCodeHash:s.recipientCodeHash,quantity:1,priceWei:s.priceWei,maximumPriceWei,accountState:s.accountState,anchor:s.anchor,expiresAt:now()+60000};const call=publicPaidCall(review,r);
  const quotes=await Promise.all(clients.map(async c=>({gas:await c.estimateGas({account:identity.owner,...call}),price:await c.getGasPrice(),nonce:await c.getTransactionCount({address:identity.owner,blockTag:'pending'})})));
  check(quotes.every(q=>natural(q.gas)&&q.gas>0n&&natural(q.price)&&q.price>0n&&Number.isSafeInteger(q.nonce)&&q.nonce>=0),'PUBLIC_PAID_INVALID_QUOTE');check(quotes[0].nonce===quotes[1].nonce,'PAID_OWNER_NONCE_CHANGED');const gas=quotes.reduce((a,b)=>a>b.gas?a:b.gas,0n)*12n/10n,gasPrice=quotes.reduce((a,b)=>a>b.price?a:b.price,0n)*2n;
  review.maximumNetworkFeeWei=String(gas*gasPrice);review.transaction={from:identity.owner,to:call.to,data:call.data,value:hex(call.value),chainId:'0x1237',type:'0x0',nonce:hex(quotes[0].nonce),gas:hex(gas),gasPrice:hex(gasPrice)};
  await preflight(review);return {record:await store.save(review)};
 }
 const existing=async({intentId,revision},status)=>{const record=await store.get(intentId);check(record?.revision===revision&&record.status===status,'PAID_JOURNAL_CHANGED');return record;};
 async function claim(input){const record=await existing(input,'PREPARED');check(publicPaidAvailable(r)&&record.reviewHash===input.reviewHash,'PUBLIC_PAID_DISABLED');await preflight(record.review);const next=await store.update(input.intentId,input.revision,'WALLET_REQUESTED',null);return {record:next,transaction:next.review.transaction};}
 async function recover(input){let record=await existing(input,'WALLET_REQUESTED');check(/^0x[0-9a-f]{64}$/.test(input.transactionHash),'PAID_JOURNAL_CHANGED');validate(record.review);
  check(!record.reportedHash||record.reportedHash===input.transactionHash,'PAID_JOURNAL_CHANGED');
  let observed;try{observed=await verifyPaidTransaction(clients,record.review.transaction,input.transactionHash);}catch(e){if(paidReceiptPending(e))return {record,pending:true};throw e;}
  const {receipt,block}=observed;check(natural(receipt.blockNumber)&&canonical(block,receipt.blockNumber,receipt.blockHash)&&natural(receipt.gasUsed)&&receipt.gasUsed>0n&&natural(receipt.effectiveGasPrice)&&receipt.effectiveGasPrice>0n,'PAID_RECEIPT_MISMATCH');if(!record.reportedHash)record=await store.update(input.intentId,record.revision,'WALLET_REQUESTED',input.transactionHash);for(const c of clients){const finalized=await c.getBlock({blockTag:'finalized'});check(canonical(finalized,finalized?.number)&&finalized.number>=receipt.blockNumber,'PAID_CONFIRMATIONS_PENDING');}
  const status=receipt.status==='success'?'CONFIRMED':'REVERTED';let nftTokenId=null;
  if(status==='CONFIRMED'){
   const targetLogs=receipt.logs.filter(l=>same(l.address,record.review.collection));check(targetLogs.every(l=>l.removed!==true&&l.blockNumber===receipt.blockNumber&&same(l.blockHash,receipt.blockHash)&&same(l.transactionHash,input.transactionHash)&&Number.isSafeInteger(l.logIndex)&&l.logIndex>=0)&&new Set(targetLogs.map(l=>l.logIndex)).size===targetLogs.length,'PAID_DELIVERY_UNVERIFIED');
   const transfers=targetLogs.flatMap(l=>{try{const e=decodeEventLog({abi:PUBLIC_PAID_ABI,data:l.data,topics:l.topics,strict:true});return e.eventName==='Transfer'?[e.args]:[];}catch{return [];}});
   check(transfers.length===1&&same(transfers[0].from,ZERO)&&same(transfers[0].to,record.review.recipient),'PAID_DELIVERY_UNVERIFIED');nftTokenId=String(transfers[0].tokenId);
   await paidReceiptState(historyClients(),receipt,async c=>{check(canonical(await c.getBlock({blockNumber:receipt.blockNumber}),receipt.blockNumber,receipt.blockHash),'PAID_RECEIPT_MISMATCH');for(const [address,expected] of [[record.review.collection,r.targetCollectionCodeHash],[record.review.recipient,record.review.recipientCodeHash]])check(keccak256(await c.getCode({address,blockNumber:receipt.blockNumber})??'0x')===expected,'PAID_RUNTIME_CHANGED');const owner=await c.readContract({address:record.review.collection,abi:PUBLIC_PAID_ABI,functionName:'ownerOf',args:[BigInt(nftTokenId)],blockNumber:receipt.blockNumber,ccipRead:false});check(same(owner,record.review.recipient),'PAID_DELIVERY_UNVERIFIED');});
  }
  const evidence={status,transactionHash:input.transactionHash,blockNumber:String(block.number),blockHash:block.hash,collection:record.review.collection,nftTokenId,recipient:record.review.recipient,verifiedProviders:2,finalized:true};
  return {record:await store.update(input.intentId,record.revision,status,input.transactionHash,evidence)};
 }
 async function cancel(input){await existing(input,'PREPARED');return {record:await store.update(input.intentId,input.revision,'CANCELLED',null)};}
 async function decline(input){const record=await existing(input,'WALLET_REQUESTED');check(input.rejectionCode===4001&&!record.reportedHash,'PAID_JOURNAL_CHANGED');
  for(const c of clients)for(const blockTag of ['latest','pending'])check(await c.getTransactionCount({address:identity.owner,blockTag})===Number(BigInt(record.review.transaction.nonce)),'PAID_OWNER_NONCE_CHANGED');
  return {record:await store.update(input.intentId,input.revision,'DECLINED',null)};
 }
 const inspect=async({collection})=>{publicPaidCollection(collection,r);return {record:await store.current(),state:await state(collection),history:await store.history(),pendingPunk:await store.pendingPunk?.()??null};};
 return {prepare,claim,recover,cancel,decline,inspect,get:async()=>{const record=await store.current();return {record,state:await state(record?.review.collection??r.targetCollection),history:await store.history(),pendingPunk:await store.pendingPunk?.()??null};}};
}
