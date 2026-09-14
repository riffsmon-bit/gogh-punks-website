import { getDatabase } from '@netlify/database';
import { forgeSkillAdminRuntime } from './_shared/forge-skill-admin-runtime.mjs';
import { json,readJson,PublicError,requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
const FIELDS = {prepare:['operation','key','requestKey'],claim:['operation','id','revision','reviewHash'],
  cancel:['operation','id','revision'],recover:['operation','id','transactionHash']};
export async function handleForgeSkillAdmin(request,{runtimeFactory=forgeSkillAdminRuntime,sessionPool=()=>getDatabase().pool,
  sessionReader=requireV2Session,originCheck=requireSameOrigin}={}) {
  if (!['GET','POST'].includes(request.method)) return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try {
    if (request.method==='POST') originCheck(request);
    const session = await sessionReader(request,sessionPool()),administrator=session.walletAddress.toLowerCase();
    const {coordinator} = await runtimeFactory(); let result;
    if (request.method==='GET') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key=>key!=='id') || params.getAll('id').length>1) throw new PublicError(400,'SKILL_ADMIN_REQUEST_INVALID','Refresh the skill release review.');
      result = await coordinator.get({administrator,...(params.has('id')?{id:params.get('id')}:{})});
    } else {
      const body = await readJson(request,2048),fields=FIELDS[body?.operation];
      if (!fields || Object.keys(body).length!==fields.length || fields.some(key=>!Object.hasOwn(body,key))) throw new PublicError(400,'SKILL_ADMIN_REQUEST_INVALID','Refresh the skill release review.');
      const {operation,...input}=body;
      result = await coordinator[operation]({administrator,...input,...(operation==='recover' && input.transactionHash===null?{transactionHash:undefined}:{})});
    }
    return json({ok:true,...result});
  } catch(error) {
    if(error instanceof PublicError) return json({ok:false,code:error.code,message:error.message},error.status);
    const code = /^SKILL_(?:ADMIN|RELEASE)_[A-Z_]+$/.test(error?.message??'')?error.message:'SKILL_ADMIN_UNAVAILABLE';
    return json({ok:false,code,message:code==='SKILL_ADMIN_NOT_ADMINISTRATOR'
      ?'Only the current Forge administrator can review skill releases.'
      :'The skill release could not be verified. Recheck the saved review; no transaction was sent by this service.'},code==='SKILL_ADMIN_NOT_ADMINISTRATOR'?403:503);
  }
}
export default request=>handleForgeSkillAdmin(request);
export const config={path:'/api/v2/admin/forge/skills',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:20,windowSize:60}};
