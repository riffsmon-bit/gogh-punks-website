import { getDatabase } from '@netlify/database';
import { pathToFileURL } from 'node:url';
import { currentTrainingRelease, forgeTrainingRuntime } from './_shared/forge-training-runtime.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
import { createProgressionReader, skillKey } from '../../broker/src/v4/skill-forge/capability-resolver.mjs';
import { createResearchSkillRuntime, loadResearchSkillCatalog } from '../../broker/src/v4/skill-forge/research-runtime.mjs';
import { assertTrainingOwnerContinuity } from '../../broker/src/v4/skill-forge/training-state.mjs';

// Separate from the diagnostic lab: this path requires a released, learned AND
// equipped capability, fresh before/after the tool call. It can never spend/sign.
export async function handleForgeSkill(request,{releaseReader=currentTrainingRelease,
  runtimeFactory=()=>forgeTrainingRuntime('request'),sessionPool=()=>getDatabase().pool,
  sessionReader=requireV2Session,originCheck=requireSameOrigin,
  packageLoader=()=>loadResearchSkillCatalog({root:pathToFileURL(`${process.cwd()}/`)}),
  researchFactory=createResearchSkillRuntime,progressionFactory=createProgressionReader,
  continuity=assertTrainingOwnerContinuity,environment=process.env}={}) {
  if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try{
    const tokenId=v2TokenIdFrom(request,'/forge/skill'),release=releaseReader();
    if(release.status!=='OWNER_CANARY')return json({ok:false,code:'FORGE_TRAINING_NOT_RELEASED',message:'Equipped research is not released yet.'},503);
    originCheck(request);
    const session=await sessionReader(request,sessionPool()),owner=session.walletAddress.toLowerCase();
    if(!release.allowedOwners.includes(owner))throw new PublicError(403,'FORGE_SKILL_LOCKED','Research is not enabled for this owner.');
    const body=await readJson(request,1024);
    if(!body || Array.isArray(body) || Object.keys(body).some(key=>!['action','skillKey','sampleTokenIds'].includes(key))
      || !['inspect_contract','rank_trait_sample','get_market_listings'].includes(body.action)
      || !/^0x[0-9a-f]{64}$/.test(body.skillKey??'')
      || (body.action!=='rank_trait_sample' && body.sampleTokenIds!==undefined))throw new PublicError(400,'FORGE_SKILL_ARGUMENTS','Choose an available equipped research action.');
    const runtime=await runtimeFactory(),client=runtime.clients[1],coordinator=runtime.coordinator;
    const before=await coordinator.get({owner,tokenId});
    const selected=before.state.skills.find(skill=>skill.key===body.skillKey);
    if(!selected?.available || selected.level!==1 || !before.state.equipped.includes(body.skillKey))throw new PublicError(403,'FORGE_SKILL_NOT_EQUIPPED','Learn and equip the accepted skill before using it.');
    const packages=(await packageLoader()).filter(pack=>release.skills.some(skill=>skill.key===skillKey(pack.manifest.skillId,pack.manifest.version)
      && skill.manifestHash===pack.manifestHash && skill.instructionHash===pack.instructionHash))
      .map(pack=>({...pack,status:'READY',approved:true}));
    const selectedPackage=packages.find(pack=>skillKey(pack.manifest.skillId,pack.manifest.version)===body.skillKey);
    if(!selectedPackage?.manifest.requiredMcpTools.includes(body.action))throw new PublicError(403,'FORGE_SKILL_PACKAGE_UNACCEPTED','This skill version is not accepted for that tool.');
    // Approval here is only the immutable server release's exact package pins.
    // The canonical resolver separately verifies on-chain READY, effective mask,
    // prerequisites, emergency controls and hashes on every call.
    const research=researchFactory({client,packages,apiKey:environment.OPENSEA_API_KEY,
      readState:progressionFactory({client,chainId:release.chainId,collection:release.collection,registry:release.registry,
        progression:release.progression,registryCodeHash:release.registryCodeHash,progressionCodeHash:release.progressionCodeHash})});
    let args={contract:release.collection};
    if(body.action==='rank_trait_sample'){
      const ids=body.sampleTokenIds;
      if(!Array.isArray(ids)||ids.length!==3||!ids.includes(tokenId)||new Set(ids).size!==3
        ||ids.some(id=>typeof id!=='string'||!/^[1-9][0-9]{0,3}$/.test(id)))throw new PublicError(400,'FORGE_SAMPLE_INVALID','Choose three distinct Punk IDs including this Punk.');
      args={...args,tokenIds:ids,numericMode:'categorical'};
    }else if(body.action==='get_market_listings')args={...args,slug:'gogh-punks-255843210',limit:5};
    const result=await research.call({tokenId,owner,name:body.action,arguments:args});
    const after=await coordinator.get({owner,tokenId});
    if(after.state.nonce!==before.state.nonce||after.state.stateHash!==before.state.stateHash)throw Error('FORGE_SKILL_CHANGED');
    await continuity({client,release,owner,tokenId,anchor:before.state.anchor});
    return json({ok:true,mode:'EQUIPPED_RESEARCH',owner,tokenId,chainId:4663,skillKey:body.skillKey,
      action:body.action,result,observedAt:new Date().toISOString(),walletAuthority:'NONE',canBurn:false});
  }catch(error){
    if(error instanceof PublicError)return json({ok:false,code:error.code,message:error.message},error.status);
    return json({ok:false,code:'FORGE_SKILL_UNAVAILABLE',message:'The equipped skill or research result could not be verified. Recheck the loadout.'},503);
  }
}
export default request=>handleForgeSkill(request);
export const config={path:'/api/v2/punks/:tokenId/forge/skill',method:['POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowLimit:12,windowSize:60}};
