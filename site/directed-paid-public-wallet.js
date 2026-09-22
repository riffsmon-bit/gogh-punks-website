import {PAID_RELEASE} from './directed-paid-release.js';
import {keccak256Hex} from './keccak256.js';
const valid=v=>{if(!v)throw Error('The mint review changed. Recheck before confirming.');};
const word=n=>BigInt(n).toString(16).padStart(64,'0'),same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const selector=text=>keccak256Hex('0x'+Array.from(new TextEncoder().encode(text),b=>b.toString(16).padStart(2,'0')).join('')).slice(0,10);
export function publicPaidCalldata(review,r=PAID_RELEASE){const p=r.publicOwnerMint;
 const mint=selector('mintPublic(address,address,address,uint256)')+review.collection.slice(2).padStart(64,'0')+p.feeRecipient.slice(2).padStart(64,'0')+word(0)+word(1);
 return selector('execute(address,uint256,bytes,uint8)')+p.seaDrop.slice(2).padStart(64,'0')+word(review.priceWei)+word(128)+word(0)+word((mint.length-2)/2)+mint.slice(2).padEnd(Math.ceil((mint.length-2)/64)*64,'0');
}
export function validatePublicPaidEnvelope(payload,selected,r=PAID_RELEASE){
 valid(payload?.ok===true&&payload.mode==='PUBLIC_OWNER_PAID_MINT'&&payload.chainId===4663&&selected?.chainId===4663&&!selected.preview&&same(payload.owner,selected.owner)&&payload.tokenId===String(selected.tokenId)&&/^[1-9][0-9]{0,3}$/.test(payload.tokenId)&&Number(payload.tokenId)<=5016);
 const rec=payload.record;if(!rec)return payload;const v=rec.review,t=v?.transaction,p=r.publicOwnerMint;
 valid(v?.schema==='GOGH_PUBLIC_OWNER_PAID_REVIEW_V1'&&v.owner===payload.owner&&v.tokenId===payload.tokenId&&/^0x[0-9a-f]{40}$/.test(v.collection)&&v.collection!==r.collection&&v.quantity===1&&/^0x[0-9a-f]{40}$/.test(v.recipient)&&/^0x[0-9a-f]{64}$/.test(v.recipientCodeHash)&&/^[0-9a-f]{64}$/.test(v.intentId)&&/^[0-9a-f]{64}$/.test(rec.reviewHash)&&Number.isSafeInteger(rec.revision)&&rec.revision>=0&&['PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED','DECLINED'].includes(rec.status)&&Number.isSafeInteger(v.expiresAt));
 valid(t&&Object.keys(t).length===9&&Object.keys(t).every(k=>['from','to','data','value','chainId','type','nonce','gas','gasPrice'].includes(k))&&t.from===v.owner&&t.to===v.recipient&&t.chainId==='0x1237'&&t.type==='0x0'&&t.data===publicPaidCalldata(v,r)&&['nonce','gas','gasPrice','value'].every(k=>/^0x[0-9a-f]+$/.test(t[k]))&&BigInt(t.value)===BigInt(v.priceWei)&&BigInt(v.priceWei)>0n&&BigInt(v.priceWei)<=BigInt(v.maximumPriceWei)&&BigInt(v.maximumPriceWei)<=BigInt(p.maximumPriceWei)&&BigInt(t.gas)>0n&&BigInt(t.gas)<=1000000n&&BigInt(t.gasPrice)>0n&&BigInt(t.gas)*BigInt(t.gasPrice)===BigInt(v.maximumNetworkFeeWei)&&BigInt(v.maximumNetworkFeeWei)<=BigInt(p.ownerFeeCeilingWei));
 return payload;
}
export async function submitPublicPaid({envelope,selected,provider,claim,persistAttempt,persistHash,isCurrent,release:r=PAID_RELEASE,now=Date.now}){
 const record=validatePublicPaidEnvelope(envelope,selected,r).record,v=record?.review,p=r.publicOwnerMint;
 valid(p.enabled===true&&p.status==='LIVE'&&p.execution==='CURRENT_OWNER_ATOMIC_WALLET'&&record?.status==='PREPARED'&&now()+5000<v.expiresAt);
 const rpc=(method,params=[])=>provider.request({method,params});
 const wallet=async()=>{valid(isCurrent());const [chain,accounts]=await Promise.all([rpc('eth_chainId'),rpc('eth_accounts')]);valid(chain==='0x1237'&&same(accounts?.[0],v.owner)&&isCurrent());};
 await wallet();
 const anchor=await rpc('eth_getBlockByNumber',['latest',false]);valid(/^0x[0-9a-f]+$/.test(anchor?.number)&&Math.abs(now()/1000-Number(BigInt(anchor.timestamp)))<45);
 const call=(to,data)=>rpc('eth_call',[{to,data},anchor.number]);
 const readAddress=async(to,sig,args='')=>'0x'+(await call(to,selector(sig)+args)).slice(-40);
 const [owner,recipient,codes,price,state,nonce,pending,balance]=await Promise.all([
  readAddress(r.collection,'ownerOf(uint256)',word(v.tokenId)),readAddress(r.agentRegistry,'account(uint256)',word(v.tokenId)),
  Promise.all([r.collection,r.agentRegistry,r.recipientImplementation,v.collection,p.seaDrop,v.recipient].map(address=>rpc('eth_getCode',[address,anchor.number]))),
  call(p.seaDrop,selector('getPublicDrop(address)')+v.collection.slice(2).padStart(64,'0')),
  call(v.recipient,selector('state()')),rpc('eth_getTransactionCount',[v.owner,'latest']),rpc('eth_getTransactionCount',[v.owner,'pending']),rpc('eth_getBalance',[v.owner,anchor.number])]);
 valid(same(owner,v.owner)&&same(recipient,v.recipient)&&codes.every((code,i)=>keccak256Hex(code)===[r.collectionCodeHash,r.agentRegistryCodeHash,r.recipientImplementationCodeHash,r.targetCollectionCodeHash,p.seaDropCodeHash,v.recipientCodeHash][i])&&BigInt('0x'+price.slice(2,66))===BigInt(v.priceWei)&&BigInt(state)===BigInt(v.accountState)&&BigInt(nonce)===BigInt(v.transaction.nonce)&&BigInt(pending)===BigInt(nonce)&&BigInt(balance)>=BigInt(v.priceWei)+BigInt(v.maximumNetworkFeeWei));
 const original=await rpc('eth_getBlockByNumber',['0x'+BigInt(v.anchor.number).toString(16),false]);valid(same(original?.hash,v.anchor.hash));
 await rpc('eth_call',[{from:v.owner,to:v.recipient,value:v.transaction.value,data:v.transaction.data,gas:v.transaction.gas,gasPrice:v.transaction.gasPrice},'latest']);await wallet();valid(now()+3000<v.expiresAt);
 await persistAttempt(v.intentId);
 const result=validatePublicPaidEnvelope(await claim(record),selected,r);
 valid(result.record?.status==='WALLET_REQUESTED'&&result.record.reviewHash===record.reviewHash&&JSON.stringify(result.record.review)===JSON.stringify(v)&&JSON.stringify(result.transaction)===JSON.stringify(v.transaction));
 await wallet();valid(now()+1000<v.expiresAt);const hash=await rpc('eth_sendTransaction',[result.transaction]);valid(/^0x[0-9a-f]{64}$/i.test(hash));await persistHash(v.intentId,hash.toLowerCase());return hash.toLowerCase();
}
