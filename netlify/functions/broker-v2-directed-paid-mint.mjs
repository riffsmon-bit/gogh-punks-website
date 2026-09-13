import {getDatabase} from '@netlify/database';
import {json,readJson,PublicError,requireSameOrigin} from './_shared/http.mjs';
import {requireV2Session} from './_shared/v2-session.mjs';
import {v2TokenIdFrom} from './_shared/v2-route.mjs';
import {currentPaidRelease,directedPaidRuntime} from './_shared/directed-paid-runtime.mjs';
const fields={prepare:['operation','action','maximumPriceWei'],claim:['operation','intentId','revision','reviewHash'],
 recover:['operation','intentId','revision','transactionHash'],cancel:['operation','intentId','revision'],decline:['operation','intentId','revision','rejectionCode']};
const messages={PAID_RECOVER_EXISTING_REVIEW:'Recheck or cancel the existing review before preparing another.',
 PAID_HISTORY_UNAVAILABLE:'Paid minting is unavailable because both history providers could not be verified. No new budget was requested. Cancellation, refunds and recovery remain available.',
 PAID_EXECUTION_FEE_BOUND:'Current network gas exceeds this test’s worker-fee ceiling. Try a fresh quote later.',
 PAID_NETWORK_FEE_TOO_HIGH:'Current wallet gas exceeds this test’s network-fee ceiling. Try a fresh quote later.',
 PAID_REVIEW_EXPIRED:'This quote expired. Cancel the unsent review and prepare a fresh quote.',
 PAID_PRICE_CHANGED:'The live price exceeds or differs from this review. Prepare a fresh quote.',
 PAID_PRICE_LIMIT_TOO_HIGH:'This selected test supports a mint price up to 0.001 ETH.',
 PAID_OWNER_NONCE_CHANGED:'Your wallet has another transaction. Recheck it before preparing a fresh review.',
 PAID_MISSION_CHANGED:'The mint mission changed. Recheck its current state.',PAID_OWNER_UNFUNDED:'Your wallet needs the reviewed amount plus network gas.',
 PAID_REFUND_CHANGED:'The refund balance changed. Recheck and prepare a fresh refund review.',
 PAID_JOURNAL_CHANGED:'The saved review changed. Recheck its current state.'};
export async function handleDirectedPaidMint(request,{releaseReader=currentPaidRelease,runtimeFactory=directedPaidRuntime,
 sessionPool=()=>getDatabase().pool,sessionReader=requireV2Session,originCheck=requireSameOrigin,environment=process.env}={}){
 if(!['GET','POST'].includes(request.method))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 try{
  const release=releaseReader(),tokenId=v2TokenIdFrom(request,'/directed-paid-mint');
  if(tokenId!=='93')throw new PublicError(403,'PAID_SELECTED_PUNK_REQUIRED','Select Punk #93 for this paid-mint test.');
  if(request.method==='POST')originCheck(request);
  const session=await sessionReader(request,sessionPool());
  if(session.walletAddress.toLowerCase()!==release.owner)throw new PublicError(403,'PAID_SELECTED_OWNER_REQUIRED','This paid-mint test belongs to the selected owner.');
  const {coordinator}=await runtimeFactory('request',environment);let result;
  if(request.method==='GET'){if(new URL(request.url).search)throw Error('PAID_INVALID_REQUEST');result=await coordinator.get();}
  else{const body=await readJson(request,2048),allowed=fields[body?.operation];
   if(!allowed||Object.keys(body).length!==allowed.length||allowed.some(k=>!Object.hasOwn(body,k)))throw Error('PAID_INVALID_REQUEST');
   if(body.operation==='prepare'&&body.action==='AUTHORIZE'&&environment.PUNK_AGENT_DIRECTED_PAID_MINT_ENABLED!=='true')
    throw new PublicError(503,'PAID_WORKER_PAUSED','The paid-mint worker is paused. Refund and recovery remain available.');
   result=await coordinator[body.operation](body);
  }
  return json({ok:true,mode:'SELECTED_DIRECTED_PAID_MINT',owner:release.owner,tokenId:'93',chainId:4663,...result});
 }catch(error){if(error instanceof PublicError)return json({ok:false,code:error.code,message:error.message},error.status);
  const code=Object.hasOwn(messages,error.message)?error.message:'PAID_MINT_UNAVAILABLE';
  return json({ok:false,code,message:messages[code]??'The chain or saved mint could not be verified. Recheck; a saved wallet request remains reserved.'},409);}
}
export default request=>handleDirectedPaidMint(request);
export const config={path:'/api/v2/punks/:tokenId/directed-paid-mint',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:30,windowSize:60}};
