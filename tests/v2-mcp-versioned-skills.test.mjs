import test from 'node:test';
import assert from 'node:assert/strict';
import { mintResearchFixture, OWNER, HASH, GOGH, WALLET } from './helpers/mint-research-context-fixture.mjs';
import { createV2McpResearch, mcpResearchPackageSelection } from '../netlify/functions/_shared/v2-mcp-research.mjs';
import { createMintResearchContextReader } from '../netlify/functions/_shared/v2-mint-research-context.mjs';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey, SKILL_CAPABILITIES } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { ART_BROKER_MCP_TOOLS } from '../broker/src/v4/mcp/art-broker-mcp.mjs';
import { handleV2Mcp, v2McpDependencies } from '../netlify/functions/broker-v2-mcp.mjs';

const selection=[{slug:'market-scout',version:2},{slug:'mint-hunter',version:1},{slug:'link-sniper',version:1}];
const packages=await loadResearchSkillCatalog({selection});
function fixture(){
  const f=mintResearchFixture();f.fetchCalls=[];
  f.release={status:'OWNER_CANARY',chainId:4663,collection:GOGH,allowedOwners:[OWNER],skills:packages.map(p=>({
    key:skillKey(p.manifest.skillId,p.manifest.version),manifestHash:p.manifestHash,instructionHash:p.instructionHash}))};
  f.state={nonce:'1',stateHash:HASH,anchor:{number:'100',hash:HASH,timestamp:String(+f.time/1000)}};
  f.progression={tokenId:'93',owner:OWNER,chainId:4663,blockHash:HASH,blockTime:+f.time,slots:3,mask:'146',equipped:packages.map((p,slot)=>({
    key:skillKey(p.manifest.skillId,p.manifest.version),slot,level:1,available:true,definition:{status:4,disabled:false,deprecated:false,
      manifestHash:p.manifestHash,instructionHash:p.instructionHash,capabilities:p.manifest.capabilities.reduce((m,c)=>m|SKILL_CAPABILITIES[c],0n).toString()}}))};
  f.progression.mask=packages.reduce((m,p)=>m|p.manifest.capabilities.reduce((mask,c)=>mask|SKILL_CAPABILITIES[c],0n),0n).toString();
  f.options={pool:f.pool,clientFactory:()=>f.client,releaseReader:()=>f.release,
    stateReader:async()=>({...f.state}),continuityReader:async()=>{if(f.logs.length)throw Error('OWNER_CHANGED');},
    progressionFactory:()=>async()=>({...f.progression,blockTime:Date.now()}),
    mintContextFactory:()=>createMintResearchContextReader(f.contextOptions),environment:{OPENSEA_API_KEY:'LOCAL_FIXTURE_ONLY'},
    researchFactory:options=>createResearchSkillRuntime({...options,now:()=>f.time,fetchImpl:async url=>{
      f.fetchCalls.push(url);return Response.json(url.includes('/collections/')?{name:'Gogh',contracts:[{chain:'robinhood',address:GOGH}]}:{listings:[],next:null});}})};
  f.request=async(name,args={tokenId:'93',opportunityId:f.opportunity.opportunityId})=>{
    const research=createV2McpResearch(f.options);
    return handleV2Mcp(new Request('https://goghpunks.xyz/api/v2/mcp',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:name==='list'?'tools/list':'tools/call',
        params:name==='list'?{tokenId:'93'}:{name,arguments:args}})}),{
      poolFactory:()=>f.pool,sessionReader:async()=>({walletAddress:OWNER}),
      dependencyFactory:(pool,principal)=>v2McpDependencies(pool,principal,{research,
        authorityReader:async id=>{if(f.owner!==OWNER||id!=='93')throw Error('OWNER_CHANGED');return {owner:OWNER,punkWallet:WALLET};}})});
  };return f;
}
const result=async response=>(await response.json()).result?.structuredContent;
test('exact release keys select Market Scout v2 with no silent v1 substitution',()=>{
  const f=fixture();assert.deepEqual(mcpResearchPackageSelection(f.release),[
    {slug:'market-scout',version:2},{slug:'link-sniper',version:1},{slug:'mint-hunter',version:1}]);
  f.release.skills=[{key:skillKey(8,99)}];assert.deepEqual(mcpResearchPackageSelection(f.release),[]);
});
test('selected HTTP list exposes distinct equipped aliases while keeping diagnostic names and schemas',async()=>{
  const f=fixture(), response=await f.request('list');assert.equal(response.status,200);
  const tools=(await response.json()).result.tools,names=tools.map(t=>t.name);
  for(const name of ['skill_inspect_mint_link','skill_inspect_mint','skill_simulate_mint','skill_prepare_mint','get_market_listings'])assert.ok(names.includes(name));
  assert.equal(names.length,new Set(names).size);
  assert.deepEqual(tools.find(t=>t.name==='inspect_mint_link').inputSchema.required,['url']);
  assert.match(ART_BROKER_MCP_TOOLS.find(t=>t.name==='simulate_mint').description,/stored.*does not run a fresh/);
  assert.equal(f.sql.length,0,'listing equipped tools does not start a strategy/accounting scan');
});
test('Market Scout v2 HTTP call executes the versioned native OpenSea reader',async()=>{
  const f=fixture(),response=await f.request('get_market_listings',{tokenId:'93'});assert.equal(response.status,200);
  const output=await result(response);assert.equal(output.result.schema,'GOGH_MARKET_LISTING_OBSERVATIONS_V2');
  assert.equal(output.result.contract,GOGH);assert.equal(output.result.executable,false);assert.equal(f.fetchCalls.length,2);
});
test('Link Sniper alias uses the real fixed resolver and does not treat a website as wallet authority',async()=>{
  const f=fixture(),response=await f.request('skill_inspect_mint_link',{tokenId:'93',url:'https://example.com'});assert.equal(response.status,200);
  const output=await result(response);assert.equal(output.result.schema,'GOGH_LINK_SNIPER_OBSERVATION_V1');
  assert.equal(output.result.reason,'NO_TRUSTED_RESOLVER');assert.equal(output.result.transactionSubmitted,false);assert.equal(f.fetchCalls.length,0);
});
for(const [name,status]of[['skill_inspect_mint','INSPECTED'],['skill_simulate_mint','SIMULATED'],['skill_prepare_mint','OWNER_REVIEW_REQUIRED']])
  test(`${name} runs the real Mint Hunter with server SQL context and the canonical Agent`,async()=>{
    const f=fixture(),response=await f.request(name);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const output=await result(response),review=output.result;assert.equal(review.schema,'GOGH_MINT_HUNTER_REVIEW_V1');
    assert.equal(review.status,status);assert.equal(review.punkWallet,WALLET);assert.equal(review.transaction,null);assert.equal(review.executable,false);
    assert.equal(output.walletAuthority,'NONE');assert.equal(review.transactionSubmitted,false);
    const calls=f.calls.filter(([kind])=>kind==='call');assert.equal(calls.length,name==='skill_inspect_mint'?0:1);
    if(calls.length){assert.equal(calls[0][1].to,WALLET);assert.equal(calls[0][1].account,OWNER);assert.equal(review.simulation.effectTraceAvailable,false);}
  });
for(const [condition,mutate]of[
  ['unequipped',f=>f.progression.equipped=f.progression.equipped.filter(p=>p.key!==skillKey(1,1))],
  ['unlearned',f=>f.progression.equipped.find(p=>p.key===skillKey(1,1)).level=0],
  ['unreviewed hash',f=>f.release.skills.find(p=>p.key===skillKey(1,1)).manifestHash=`0x${'b'.repeat(64)}`],
  ['old owner',f=>f.owner=`0x${'2'.repeat(40)}`],
  ['unknown usage',f=>f.usageRow.incomplete=true],
])test(`mint aliases reject ${condition} before simulation`,async()=>{
  const f=fixture();mutate(f);assert.equal((await f.request('skill_prepare_mint')).status,400);
  assert.equal(f.calls.filter(([kind])=>kind==='call').length,0);
});
test('completed and reserved actual usage blocks a mint through the deterministic policy',async()=>{
  const f=fixture();f.usageRow={daily_mints:'3',total_mints:'3',opportunity_mints:'2',incomplete:false};
  const response=await f.request('skill_prepare_mint');assert.equal(response.status,200);
  assert.equal((await result(response)).result.status,'POLICY_BLOCKED');assert.equal(f.calls.filter(([kind])=>kind==='call').length,0);
});
test('request owner, usage, capabilities, raw calldata and opportunity body cannot override server context',async()=>{
  for(const extra of[{owner:OWNER},{usage:{dailyMints:0}},{capabilities:['FREE_MINT']},{data:'0x1234'},{opportunity:{priceWei:'0'}}]){
    const f=fixture();assert.equal((await f.request('skill_prepare_mint',{tokenId:'93',opportunityId:f.opportunity.opportunityId,...extra})).status,400);
    assert.equal(f.sql.length,0);
  }
});
test('missing pool does not advertise Mint Hunter tools, and private database errors are sanitized',async()=>{
  const f=fixture();delete f.options.pool;
  const listed=await f.request('list');assert.ok(!(await listed.json()).result.tools.some(t=>t.name==='skill_prepare_mint'));
  const g=fixture();g.contextOptions.selectedPaidUsageReader=async()=>{throw Error('postgresql://private:secret@host');};
  const denied=await g.request('skill_prepare_mint');assert.equal(denied.status,400);assert.doesNotMatch(await denied.text(),/private|secret@/);
});
test('configured archive primary replaces the hardcoded public RPC default',async()=>{
  const f=fixture();delete f.options.clientFactory;let url;
  f.options.environment={ROBINHOOD_ARCHIVE_RPC_URL:'https://test.robinhood.rpc.example/archive',ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL:'https://other.robinhood.rpc.example/archive'};
  f.options.stateReader=async({client})=>{url=client.transport.url;return {...f.state};};
  await createV2McpResearch(f.options).resolve({owner:OWNER,tokenId:'93'});
  assert.equal(url,f.options.environment.ROBINHOOD_ARCHIVE_RPC_URL);
});
