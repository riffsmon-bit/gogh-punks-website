import { encodePunkBurnApproval,encodeReviewedBurnCall } from './forge-burn-calldata.js';
import { TRAINING_RELEASE } from './forge-training-release.js';
export const SELECTED_BURN_OWNER='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const valid=(v)=>{if(!v)throw Error('The selected burn review could not be verified.');};
// setEmergencyControls(false, MAX_UINT256 ^ 8), with no arbitrary call input.
export const ENABLE_FORGE_CALL='0x5eec6c27'+'0'.repeat(64)+((2n**256n-1n)^8n).toString(16).padStart(64,'0');
export function validateSelectedBurnEnvelope(payload,selected,release=TRAINING_RELEASE) {
  valid(payload?.ok===true&&payload.mode==='SELECTED_OWNER_BURN'&&payload.owner===SELECTED_BURN_OWNER
    &&payload.chainId===4663&&payload.sourceTokenId==='1753'&&payload.targetTokenId==='93'
    &&same(selected?.owner,SELECTED_BURN_OWNER)&&String(selected.tokenId)==='93'&&selected.chainId===4663&&!selected.preview
    &&release.status==='OWNER_CANARY'&&release.allowedOwners.includes(SELECTED_BURN_OWNER));
  if(payload.record){const {review,reviewHash,status,revision,reportedHash}=payload.record,tx=review?.transaction;
    valid(review&&/^[0-9a-f]{64}$/.test(review.intentId)&&/^[0-9a-f]{64}$/.test(reviewHash)
      &&Number.isSafeInteger(revision)&&revision>=0&&['PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED','DECLINED'].includes(status)
      &&(reportedHash===null||/^0x[0-9a-f]{64}$/.test(reportedHash))
      &&same(review.state?.owner,SELECTED_BURN_OWNER)&&review.state.sourceTokenId==='1753'&&review.state.targetTokenId==='93'
      &&['ENABLE_FORGE','APPROVE','BURN'].includes(review.action)&&Number.isSafeInteger(review.expiresAt));
    valid(tx&&same(tx.from,SELECTED_BURN_OWNER)&&tx.chainId==='0x1237'&&tx.value==='0x0'
      &&Object.keys(tx).every(k=>['from','to','chainId','value','type','nonce','gas','gasPrice','data'].includes(k))
      &&['nonce','gas','gasPrice'].every(k=>/^0x[0-9a-f]+$/.test(tx[k]))&&(!tx.type||tx.type==='0x0')
      &&BigInt(tx.gas)>0n&&BigInt(tx.gas)<=500000n&&BigInt(tx.gasPrice)>0n
      &&BigInt(tx.gas)*BigInt(tx.gasPrice)===BigInt(review.maximumNetworkFeeWei)
      &&BigInt(review.maximumNetworkFeeWei)<=BigInt(release.feeCeilingWei));
    if(review.action==='ENABLE_FORGE')valid(same(tx.to,release.registry)&&tx.data===ENABLE_FORGE_CALL);
    else if(review.action==='APPROVE')valid(same(tx.to,release.collection)&&tx.data===encodePunkBurnApproval(release.trainingSource,'1753'));
    else valid(same(tx.to,release.trainingSource)&&review.burn.sourceTokenId==='1753'&&review.burn.targetTokenId==='93'
      &&Number(review.burn.deadline)*1000===review.expiresAt&&tx.data===encodeReviewedBurnCall(review.burn));
  }
  return payload;
}
export async function submitSelectedBurn({envelope,selected,provider,claim,persistAttempt,persistHash,isCurrent,release=TRAINING_RELEASE}) {
  const record=validateSelectedBurnEnvelope(envelope,selected,release).record;
  valid(record?.status==='PREPARED'&&Date.now()+5000<record.review.expiresAt);
  async function walletMatches(){valid(isCurrent());const [chain,accounts]=await Promise.all([
    provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);
    valid(chain==='0x1237'&&same(accounts?.[0],SELECTED_BURN_OWNER)&&isCurrent());}
  await walletMatches();await persistAttempt(record.review.intentId);
  const claimed=validateSelectedBurnEnvelope(await claim(record),selected,release);
  valid(claimed.record?.status==='WALLET_REQUESTED'&&claimed.record.reviewHash===record.reviewHash
    &&JSON.stringify(claimed.record.review)===JSON.stringify(record.review)
    &&JSON.stringify(claimed.transaction)===JSON.stringify(record.review.transaction));
  await walletMatches();valid(Date.now()+1000<record.review.expiresAt);
  const hash=await provider.request({method:'eth_sendTransaction',params:[claimed.transaction]});
  valid(/^0x[0-9a-f]{64}$/i.test(hash));await persistHash(record.review.intentId,hash.toLowerCase());return hash.toLowerCase();
}
