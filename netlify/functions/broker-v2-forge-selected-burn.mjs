import { getDatabase } from '@netlify/database';
import { json,readJson,PublicError,requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
import { currentTrainingRelease } from './_shared/forge-training-runtime.mjs';
import { selectedBurnRuntime } from './_shared/selected-burn-runtime.mjs';
import { SELECTED_BURN_OWNER } from '../../broker/src/v4/skill-forge/selected-burn-source.mjs';

const FIELDS={prepare:['operation','action'],claim:['operation','intentId','revision','reviewHash','confirmation','obligationsReviewed'],
  recover:['operation','intentId','revision','transactionHash'],cancel:['operation','intentId','revision'],decline:['operation','intentId','revision','rejectionCode']};
const messages={TRAINING_PAUSED:'Enable Forge first.',RECOVER_EXISTING_BURN_REVIEW:'Recover or cancel the existing review before preparing another.',
  BURN_REVIEW_EXPIRED:'This review expired. Cancel the unsent review and prepare it again.',
  BURN_OWNER_REVIEW_REQUIRED:'Review the source wallets and any obligations before continuing.',
  BURN_CONFIRMATION_REQUIRED:'Type BURN 1753 to confirm the selected burn.',
  BURN_SOURCE_OBLIGATIONS_PENDING:'The source Punk has application records that need review before burning.',
  BURN_SOURCE_ASSETS_OR_ACTIVITY:'The source wallets have assets or activity that need review before burning.',
  BURN_SOURCE_TOKEN_RECEIPT_FOUND:'The source wallets received tokens. Review and move those assets before burning.',
  BURN_SOURCE_CHECK_STALE:'The source check took too long. Run a fresh review.',BURN_JOURNAL_CHANGED:'The saved review changed. Recheck its current state.'};
export async function handleSelectedBurn(request,{releaseReader=currentTrainingRelease,runtimeFactory=selectedBurnRuntime,
  sessionPool=()=>getDatabase().pool,sessionReader=requireV2Session,originCheck=requireSameOrigin}={}) {
  if(!['GET','POST'].includes(request.method))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try {
    const tokenId=v2TokenIdFrom(request,'/forge/selected-burn');const release=releaseReader();
    if(tokenId!=='93'||release.status!=='OWNER_CANARY'||!release.allowedOwners.includes(SELECTED_BURN_OWNER))
      return json({ok:false,code:'SELECTED_BURN_NOT_RELEASED',message:'The selected burn test is not enabled.'},503);
    if(request.method==='POST')originCheck(request);
    const pool=sessionPool(),session=await sessionReader(request,pool);
    if(session.walletAddress.toLowerCase()!==SELECTED_BURN_OWNER)throw new PublicError(403,'SELECTED_BURN_OWNER_LOCKED','This burn test belongs to the selected owner.');
    const coordinator=await runtimeFactory(pool);let result;
    if(request.method==='GET'){
      if(new URL(request.url).search)throw Error('INVALID_BURN_REQUEST');result=await coordinator.get();
    }else{
      const body=await readJson(request,2048),fields=FIELDS[body?.operation];
      if(!fields||Object.keys(body).length!==fields.length||fields.some(k=>!Object.hasOwn(body,k)))throw Error('INVALID_BURN_REQUEST');
      result=body.operation==='prepare'?await coordinator.prepare(body.action):await coordinator[body.operation](body);
    }
    return json({ok:true,mode:'SELECTED_OWNER_BURN',owner:SELECTED_BURN_OWNER,chainId:4663,sourceTokenId:'1753',targetTokenId:'93',...result});
  }catch(error){if(error instanceof PublicError)return json({ok:false,code:error.code,message:error.message},error.status);
    const code=Object.hasOwn(messages,error.message)?error.message:'SELECTED_BURN_UNAVAILABLE';
    return json({ok:false,code,message:messages[code]??'The chain or saved review could not be verified. Recheck; any wallet request stays reserved and will not be resent.'},409);}
}
export default request=>handleSelectedBurn(request);
export const config={path:'/api/v2/punks/:tokenId/forge/selected-burn',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:20,windowSize:60}};
