import {PAID_RELEASE} from './directed-paid-release.js';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const valid=v=>{if(!v)throw Error('The paid-mint review could not be verified.');};
const uint=(v,bits=256)=>{valid(/^(?:0|[1-9][0-9]*)$/.test(String(v)));const n=BigInt(v);valid(n>=0n&&n<2n**BigInt(bits));return n.toString(16).padStart(64,'0');};
const address=a=>{valid(/^0x[0-9a-f]{40}$/.test(a));return a.slice(2).padStart(64,'0');};
export function paidOwnerCalldata(review,r=PAID_RELEASE){
 if(review.action==='AUTHORIZE')return '0xbf2c0efe'+uint(93)+address(r.executor)+address(r.targetCollection)
  +r.targetCollectionCodeHash.slice(2)+uint(review.priceWei)+uint(review.executionFeeWei)+uint(review.expectedGeneration,64)+uint(review.deadline,48);
 if(review.action==='CANCEL_MISSION')return '0x4c125e79'+uint(review.expectedGeneration,64);
 valid(review.action==='WITHDRAW_REFUND');return '0xa16c86f7'+address(r.owner);
}
export function validatePaidEnvelope(payload,selected,r=PAID_RELEASE){
 valid(r.status==='OWNER_CANARY'&&r.productionPaidMintAuthorized===true&&r.allowedOwners.length===1&&r.allowedOwners[0]===r.owner
  &&payload?.ok===true&&payload.mode==='SELECTED_DIRECTED_PAID_MINT'&&payload.owner===r.owner&&payload.tokenId==='93'&&payload.chainId===4663
  &&same(selected?.owner,r.owner)&&String(selected.tokenId)==='93'&&selected.chainId===4663&&!selected.preview);
 if(payload.record){const {review,reviewHash,revision,status,reportedHash}=payload.record,tx=review?.transaction;
  valid(review?.schema==='GOGH_DIRECTED_PAID_REVIEW_V1'&&review.owner===r.owner&&review.tokenId==='93'&&review.targetCollection===r.targetCollection
   &&review.recipient===r.recipient&&review.vault===r.vault&&Number.isSafeInteger(review.expiresAt)&&/^[0-9a-f]{64}$/.test(review.intentId)
   &&/^[0-9a-f]{64}$/.test(reviewHash)&&Number.isSafeInteger(revision)&&revision>=0
   &&['PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED','DECLINED'].includes(status)
   &&(reportedHash===null||/^0x[0-9a-f]{64}$/.test(reportedHash)));
  valid(tx&&Object.keys(tx).length===9&&Object.keys(tx).every(k=>['from','to','data','value','chainId','type','nonce','gas','gasPrice'].includes(k))
   &&tx.from===r.owner&&tx.chainId==='0x1237'&&tx.type==='0x0'&&tx.data===paidOwnerCalldata(review,r)
   &&['gas','gasPrice','nonce','value'].every(k=>/^0x[0-9a-f]+$/.test(tx[k]))
   &&BigInt(tx.gas)>0n&&BigInt(tx.gas)<=3000000n&&BigInt(tx.gasPrice)>0n
   &&BigInt(tx.gas)*BigInt(tx.gasPrice)===BigInt(review.maximumNetworkFeeWei)&&BigInt(review.maximumNetworkFeeWei)<=BigInt(r.ownerFeeCeilingWei));
  if(review.action==='AUTHORIZE')valid(tx.to===r.factory&&review.quantity===1&&BigInt(review.executionFeeWei)>0n&&BigInt(review.executionFeeWei)<=BigInt(r.maximumExecutionFeeWei)
   &&BigInt(review.priceWei)>0n&&BigInt(review.priceWei)<=BigInt(review.maximumPriceWei)&&BigInt(review.maximumPriceWei)<=BigInt(r.maximumPriceWei)
   &&BigInt(tx.value)===BigInt(review.priceWei)+BigInt(review.executionFeeWei)
   &&BigInt(review.deadline)>BigInt(review.anchor.timestamp)&&BigInt(review.deadline)<=BigInt(review.anchor.timestamp)+600n);
  else valid(tx.to===r.vault&&tx.value==='0x0');
 }
 return payload;
}
export async function submitDirectedPaid({envelope,selected,provider,claim,persistAttempt,persistHash,isCurrent,release=PAID_RELEASE}){
 const record=validatePaidEnvelope(envelope,selected,release).record;
 valid(record?.status==='PREPARED'&&Date.now()+5000<record.review.expiresAt);
 const walletMatches=async()=>{valid(isCurrent());const [chain,accounts]=await Promise.all([
  provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);valid(chain==='0x1237'&&same(accounts?.[0],release.owner)&&isCurrent());};
 await walletMatches();await persistAttempt(record.review.intentId);
 const response=validatePaidEnvelope(await claim(record),selected,release);
 valid(response.record?.status==='WALLET_REQUESTED'&&response.record.reviewHash===record.reviewHash
  &&JSON.stringify(response.record.review)===JSON.stringify(record.review)&&JSON.stringify(response.transaction)===JSON.stringify(record.review.transaction));
 await walletMatches();valid(Date.now()+1000<record.review.expiresAt);
 const hash=await provider.request({method:'eth_sendTransaction',params:[response.transaction]});
 valid(/^0x[0-9a-f]{64}$/i.test(hash));await persistHash(record.review.intentId,hash.toLowerCase());return hash.toLowerCase();
}
