import { getDatabase } from '@netlify/database';
import { currentPaidTrainingRelease, forgePaidTrainingRuntime } from './_shared/forge-paid-training-runtime.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';

const fields={prepare:['operation','action'],verify:['operation','review'],recover:['operation','review','transactionHash'],abandon:['operation','review']};
// Public UNDEPLOYED help has no RPC, database, wallet, or signing side effect.
export async function handlePaidTraining(request,{releaseReader=currentPaidTrainingRelease,
  runtimeFactory=forgePaidTrainingRuntime,sessionPool=()=>getDatabase().pool,
  sessionReader=requireV2Session,originCheck=requireSameOrigin}={}) {
  if(!['GET','POST'].includes(request.method))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try {
    const tokenId=v2TokenIdFrom(request,'/forge/paid-training'),release=releaseReader();
    if(release.status==='UNDEPLOYED')return request.method==='GET'?json({ok:true,release})
      :json({ok:false,code:'PAID_NOT_RELEASED',message:'Paid Training Credits are being prepared. No payment was requested.'},503);
    if(request.method==='POST')originCheck(request);
    const session=await sessionReader(request,sessionPool()),owner=session.walletAddress.toLowerCase();
    if(!release.allowedOwners.includes(owner))throw new PublicError(403,'PAID_OWNER_LOCKED','Paid training is not enabled for this owner yet.');
    if(new URL(request.url).search)throw new PublicError(400,'PAID_REQUEST_INVALID','Refresh the selected Punk.');
    const coordinator=await runtimeFactory();
    if(request.method==='GET')return json({ok:true,release,state:await coordinator.get({owner,tokenId})});
    const body=await readJson(request,8192),allowed=fields[body?.operation];
    if(!body || Array.isArray(body) || !allowed || Object.keys(body).length!==allowed.length || allowed.some(k=>!Object.hasOwn(body,k)))
      throw new PublicError(400,'PAID_REQUEST_INVALID','Choose an available training action.');
    if(body.review && (body.review.owner!==owner || body.review.tokenId!==tokenId))
      throw new PublicError(403,'PAID_REVIEW_IDENTITY','This review belongs to a different Punk or wallet.');
    const result=body.operation==='prepare'?await coordinator.prepare({owner,tokenId,action:body.action})
      :body.operation==='verify'?await coordinator.verify(body.review)
      :body.operation==='abandon'?await coordinator.abandon({owner,tokenId,review:body.review})
      :await coordinator.recover({owner,tokenId,review:body.review,transactionHash:body.transactionHash});
    return json({ok:true,...result});
  }catch(error) {
    if(error instanceof PublicError)return json({ok:false,code:error.code,message:error.message},error.status);
    if(error?.message==='PAID_BURN_APPROVAL_ACTIVE')return json({ok:false,code:error.message,
      message:'This Punk is approved for sacrifice. Revoke its burn approval in your wallet before buying a credit for it.'},409);
    return json({ok:false,code:'PAID_TRAINING_UNAVAILABLE',
      message:'Training could not be verified. If your wallet was already opened, recover that transaction before starting another.'},503);
  }
}
export default request=>handlePaidTraining(request);
export const config={path:'/api/v2/punks/:tokenId/forge/paid-training',method:['GET','POST'],
  rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:12,windowSize:60}};
