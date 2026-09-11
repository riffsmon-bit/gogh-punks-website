import { getDatabase } from '@netlify/database';
import { currentTrainingRelease, forgeTrainingRuntime } from './_shared/forge-training-runtime.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';

const FIELDS = { prepare: ['operation','action','requestKey'], claim: ['operation','intentId','revision','reviewHash'],
  cancel: ['operation','intentId','revision'], unknown: ['operation','intentId','revision'],
  recover: ['operation','intentId','revision','transactionHash'] };
const invalid = () => { throw new PublicError(400,'FORGE_TRAINING_REQUEST_INVALID','Choose an available training action and refresh its review.'); };
export async function handleForgeTraining(request, { releaseReader = currentTrainingRelease,
  runtimeFactory = () => forgeTrainingRuntime('request'), sessionPool = () => getDatabase().pool,
  sessionReader = requireV2Session, originCheck = requireSameOrigin } = {}) {
  if (!['GET','POST'].includes(request.method)) return json({ ok:false,code:'METHOD_NOT_ALLOWED' },405);
  try {
    const tokenId = v2TokenIdFrom(request,'/forge/training');
    const release = releaseReader();
    if (release.status !== 'OWNER_CANARY') return json({ ok:false,code:'FORGE_TRAINING_NOT_RELEASED',
      message:'Live training contracts are not released yet.',canBurn:false },503);
    if (request.method === 'POST') originCheck(request);
    const session = await sessionReader(request,sessionPool());
    const owner = session.walletAddress.toLowerCase();
    if (!release.allowedOwners.includes(owner)) throw new PublicError(403,'FORGE_TRAINING_OWNER_LOCKED','Training is not enabled for this owner yet.');
    const { coordinator } = await runtimeFactory();
    const identity = { owner,tokenId };
    let result;
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== 'intentId') || params.getAll('intentId').length > 1) invalid();
      if (params.has('intentId')) identity.intentId = params.get('intentId');
      result = await coordinator.get(identity);
    } else {
      const body = await readJson(request,2048), fields = FIELDS[body?.operation];
      if (!body || Array.isArray(body) || !fields || Object.keys(body).length !== fields.length
        || fields.some(key => !Object.hasOwn(body,key))) invalid();
      if (body.operation === 'prepare') result = await coordinator.prepare({ ...identity,action:body.action,requestKey:body.requestKey });
      else {
        identity.intentId = body.intentId;
        result = body.operation === 'claim' ? await coordinator.claim(identity,body.revision,body.reviewHash)
          : { record: await coordinator.mutate(identity,body.operation,body.revision,body.transactionHash) };
      }
    }
    return json({ ok:true,mode:'OWNER_CANARY',owner,tokenId,chainId:4663,canBurn:false,...result });
  } catch (error) {
    if (error instanceof PublicError) return json({ ok:false,code:error.code,message:error.message },error.status);
    // A failure after a committed claim is ambiguous. The browser must recover the
    // persisted intent and must never interpret this response as permission to resend.
    return json({ ok:false,code:'FORGE_TRAINING_UNAVAILABLE',
      message:'Training could not be verified. Recover any pending review before requesting another transaction.' },503);
  }
}
export default request => handleForgeTraining(request);
export const config = { path:'/api/v2/punks/:tokenId/forge/training',method:['GET','POST'],rateLimit: {
  action:'rate_limit',aggregateBy:['ip'],windowLimit:20,windowSize:60,
} };
