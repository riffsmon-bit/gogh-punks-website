import {getDatabase} from '@netlify/database';
import {json,readJson,PublicError} from './_shared/http.mjs';
import {requireV2OwnerOrigin} from './_shared/v2-review.mjs';
import {requireV2Session} from './_shared/v2-session.mjs';
import {v2TokenIdFrom} from './_shared/v2-route.mjs';
import {currentPaidRelease} from './_shared/directed-paid-runtime.mjs';
import {directedPublicPaidRuntime} from './_shared/directed-paid-public-runtime.mjs';
import {publicPaidAvailable,publicPaidIdentity} from '../../broker/src/v4/directed-paid-public.mjs';
const fields={prepare:['operation','maximumPriceWei','collection'],inspect:['operation','collection'],claim:['operation','intentId','revision','reviewHash'],recover:['operation','intentId','revision','transactionHash'],cancel:['operation','intentId','revision'],decline:['operation','intentId','revision','rejectionCode']};
const messages={PAID_HISTORY_UNAVAILABLE:'Receipt verification is temporarily unavailable. No mint was requested; recheck later.',PAID_OWNER_REVIEW_PENDING:'Another Punk has an unresolved mint review in this wallet. Open that Punk and finish or cancel its original request first.',PAID_RUNTIME_CHANGED:'This contract does not match the supported SeaDrop Studio mint code. No payment was requested.',PUBLIC_PAID_INVALID_COLLECTION:'Enter a full Robinhood Chain NFT contract address.',PUBLIC_PAID_NOT_OWNER:'This wallet no longer owns the selected Punk. Switch to its current owner.',PUBLIC_PAID_ACTIVATION_REQUIRED:'Activate this Punk’s Agent wallet first, then review the mint.',PUBLIC_PAID_DISABLED:'New paid mints are temporarily unavailable. Saved transaction recovery remains available.',PAID_RECOVER_EXISTING_REVIEW:'Recheck the existing wallet request or cancel its unsent review before starting another mint.',PAID_PRICE_CHANGED:'This supported mint is unavailable or its price changed. Recheck before continuing.',PAID_REVIEW_EXPIRED:'This review expired. Cancel the unsent review and request a fresh price.',PAID_OWNER_NONCE_CHANGED:'Your wallet has another transaction. Recheck it before continuing.',PAID_OWNER_UNFUNDED:'Your connected wallet needs the mint price plus network gas.',PUBLIC_PAID_STATE_CHANGED:'The Punk or mint changed. Recheck and create a fresh review.',PAID_JOURNAL_CHANGED:'The saved review changed. Recheck the original request.',PAID_CONFIRMATIONS_PENDING:'Your transaction is still confirming. Recheck its original hash; nothing was resent.'};
export async function handlePublicDirectedPaidMint(request,{releaseReader=currentPaidRelease,runtimeFactory=directedPublicPaidRuntime,sessionPool=()=>getDatabase().pool,sessionReader=requireV2Session,originCheck=requireV2OwnerOrigin,environment=process.env}={}){
 if(!['GET','POST'].includes(request.method))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 try{const release=releaseReader(),tokenId=v2TokenIdFrom(request,'/public-paid-mint');if(new URL(request.url).search)throw Error('PUBLIC_PAID_INVALID_REQUEST');
  if(request.method==='POST')originCheck(request);
  const session=await sessionReader(request,sessionPool()),identity=publicPaidIdentity(session.walletAddress.toLowerCase(),tokenId);
  const {coordinator}=await runtimeFactory(identity,environment);let result;
  if(request.method==='GET')result=await coordinator.get();else{const body=await readJson(request,2048),allowed=fields[body?.operation];if(!allowed||Object.keys(body).length!==allowed.length||allowed.some(k=>!Object.hasOwn(body,k)))throw Error('PUBLIC_PAID_INVALID_REQUEST');
   if(['prepare','claim'].includes(body.operation)&&!publicPaidAvailable(release))throw Object.assign(Error('PUBLIC_PAID_DISABLED'),{code:'PUBLIC_PAID_DISABLED'});
   result=await coordinator[body.operation](body);
  }
  return json({ok:true,mode:'PUBLIC_OWNER_PAID_MINT',chainId:4663,...identity,available:publicPaidAvailable(release),...result});
 }catch(e){if(e instanceof PublicError)return json({ok:false,code:e.code,message:e.message},e.status);const code=Object.hasOwn(messages,e.code??e.message)?(e.code??e.message):'PUBLIC_PAID_UNAVAILABLE';return json({ok:false,code,message:messages[code]??'The mint could not be verified. Recheck; any saved wallet request remains reserved.'},409);}
}
export default request=>handlePublicDirectedPaidMint(request);
export const config={path:'/api/v2/punks/:tokenId/public-paid-mint',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:20,windowSize:60}};
