import assert from 'node:assert/strict';
import test from 'node:test';
import { handleForgeSkill } from '../netlify/functions/broker-v2-forge-skill.mjs';
import { loadResearchSkillCatalog } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';

const OWNER=`0x${'1'.repeat(40)}`,COLLECTION=`0x${'2'.repeat(40)}`,HASH=`0x${'a'.repeat(64)}`;
const catalog=await loadResearchSkillCatalog();
const request=(body,method='POST')=>new Request('https://goghpunks.xyz/api/v2/punks/93/forge/skill',{
  method,...(method==='POST'?{headers:{'content-type':'application/json',origin:'https://goghpunks.xyz'},body:JSON.stringify(body)}:{})});
function fixture(id=3){
  const calls=[],key=skillKey(id,1),client={fixture:true};
  const state={skills:[{key,available:true,level:1}],equipped:[key],nonce:'1',stateHash:HASH,anchor:{number:'10',hash:HASH,timestamp:'100'}};
  const release={status:'OWNER_CANARY',chainId:4663,collection:COLLECTION,allowedOwners:[OWNER],skills:catalog.map(pack=>({
    key:skillKey(pack.manifest.skillId,pack.manifest.version),manifestHash:pack.manifestHash,instructionHash:pack.instructionHash}))};
  const deps={releaseReader:()=>release,sessionPool:()=>null,sessionReader:async()=>({walletAddress:OWNER}),
    originCheck:()=>calls.push('origin'),environment:{},packageLoader:async()=>catalog,
    runtimeFactory:async()=>({clients:[null,client],coordinator:{get:async identity=>{calls.push(['get',identity]);return {state:structuredClone(state)};}}}),
    progressionFactory:options=>{assert.equal(options.client,client);return 'CANONICAL_READER';},
    researchFactory:options=>{calls.push(['factory',options]);return {call:async input=>{calls.push(['tool',input]);return {evidenceHash:HASH};}};},
    continuity:async input=>{calls.push(['continuity',input]);}};
  const body={action:id===3?'inspect_contract':id===4?'rank_trait_sample':'get_market_listings',skillKey:key,
    ...(id===4?{sampleTokenIds:['93','44','119']}:{})};
  return {deps,calls,state,release,body,key,run:()=>handleForgeSkill(request(body),deps)};
}
test('unreleased equipped research cannot open a database or RPC client',async()=>{
  const never=()=>{throw Error('MUST_NOT_RUN');};
  const result=await handleForgeSkill(request({}),{runtimeFactory:never,sessionPool:never});
  assert.equal(result.status,503);assert.equal((await result.json()).code,'FORGE_TRAINING_NOT_RELEASED');
  assert.equal((await handleForgeSkill(request(null,'GET'),{runtimeFactory:never})).status,405);
});
test('equipped research binds session/path identity, accepted package pins and fixed collection',async()=>{
  const f=fixture(),response=await f.run();assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.mode,'EQUIPPED_RESEARCH');assert.equal(result.owner,OWNER);
  assert.equal(result.tokenId,'93');assert.equal(result.walletAuthority,'NONE');assert.equal(result.canBurn,false);
  assert.equal(f.calls[0],'origin');assert.equal(f.calls.filter(call=>call[0]==='get').length,2);
  assert.deepEqual(f.calls.find(call=>call[0]==='tool')[1],{tokenId:'93',owner:OWNER,name:'inspect_contract',arguments:{contract:COLLECTION}});
  const options=f.calls.find(call=>call[0]==='factory')[1];assert.equal(options.readState,'CANONICAL_READER');
  assert.ok(options.packages.every(pack=>pack.status==='READY'&&pack.approved));
  assert.ok(catalog.every(pack=>pack.status==='TESTING'&&!pack.approved),'source packages are not promoted');
  assert.deepEqual(f.calls.at(-1)[1].anchor,f.state.anchor);
});
test('learned but unequipped, unlearned and unaccepted skills cannot invoke research',async()=>{
  for(const mutate of [f=>{f.state.equipped=[];},f=>{f.state.skills[0].level=0;},f=>{f.state.skills[0].available=false;}]){
    const f=fixture();mutate(f);const response=await f.run();assert.equal(response.status,403);
    assert.equal((await response.json()).code,'FORGE_SKILL_NOT_EQUIPPED');assert.ok(!f.calls.some(call=>call[0]==='factory'));
  }
});
test('release pins and selected package tool capability must both match',async()=>{
  for(const mutate of [f=>{f.release.skills=[];},f=>{f.release.skills[0].manifestHash=HASH;},
    f=>{f.release.skills[0].instructionHash=HASH;},f=>{f.body.action='get_market_listings';}]){
    const f=fixture();mutate(f);const response=await f.run();assert.equal(response.status,403);
    assert.equal((await response.json()).code,'FORGE_SKILL_PACKAGE_UNACCEPTED');assert.ok(!f.calls.some(call=>call[0]==='factory'));
  }
});
test('research rejects caller-supplied identity, target, signer or unsupported tool',async()=>{
  for(const patch of [{owner:OWNER},{tokenId:'44'},{contract:COLLECTION},{walletAuthority:'SEND'},
    {action:'mint'},{action:'get_metadata'},{sampleTokenIds:['93','44','119']},{skillKey:'0x1234'}]){
    const f=fixture();Object.assign(f.body,patch);assert.equal((await f.run()).status,400);
    assert.ok(!f.calls.some(call=>call[0]==='get'));
  }
});
test('session, allowlist and same-origin checks precede all state reads',async()=>{
  for(const mutate of [f=>{f.deps.sessionReader=async()=>{throw new PublicError(401,'V2_SESSION_REQUIRED','Sign in.');};},
    f=>{f.release.allowedOwners=[];},f=>{f.deps.originCheck=()=>{throw new PublicError(403,'ORIGIN_REJECTED','Origin rejected.');};}]){
    const f=fixture();mutate(f);assert.ok([401,403].includes((await f.run()).status));assert.ok(!f.calls.some(Array.isArray));
  }
});
test('Rarity Eye restricts a three-Punk sample and never accepts arbitrary metadata or URLs',async()=>{
  const f=fixture(4);assert.equal((await f.run()).status,200);
  assert.deepEqual(f.calls.find(call=>call[0]==='tool')[1].arguments,{contract:COLLECTION,tokenIds:['93','44','119'],numericMode:'categorical'});
  for(const ids of [undefined,[],['93','44'],['93','44','44'],['1','2','3'],['93','044','119'],['93','0','119'],['93',44,'119'],['93','10000','119']]){
    const bad=fixture(4);bad.body.sampleTokenIds=ids;assert.equal((await bad.run()).status,400);assert.ok(!bad.calls.some(call=>call[0]==='tool'));
  }
});
test('market research fixes collection scope and listing count',async()=>{
  const f=fixture(8);assert.equal((await f.run()).status,200);
  assert.deepEqual(f.calls.find(call=>call[0]==='tool')[1].arguments,{contract:COLLECTION,slug:'gogh-punks-255843210',limit:5});
});
test('a changed loadout, owner continuity failure or tool error withholds the entire result',async()=>{
  for(const failure of ['nonce','stateHash','continuity','tool']){
    const f=fixture();f.deps.researchFactory=()=>({call:async()=>{
      if(failure==='tool')throw Error('SECRET_MARKET_KEY');
      if(failure==='nonce')f.state.nonce='2';if(failure==='stateHash')f.state.stateHash=`0x${'b'.repeat(64)}`;
      return {privateUnverifiedResult:'DO_NOT_RETURN'};
    }});
    if(failure==='continuity')f.deps.continuity=async()=>{throw Error('TRANSFER_ROUND_TRIP');};
    const response=await f.run();assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(),/DO_NOT_RETURN|SECRET_MARKET_KEY|TRANSFER_ROUND_TRIP/);
  }
});
