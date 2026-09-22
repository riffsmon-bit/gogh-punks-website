import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{handleForgeSkillAdmin}from'../netlify/functions/broker-v2-forge-skill-admin.mjs';
import{PublicError}from'../netlify/functions/_shared/http.mjs';
import{createSkillAdminCoordinator}from'../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import{skillAdminFixture,ADMIN,KEY}from'./fixtures/skill-admin.mjs';
const url='https://goghpunks.xyz/api/v2/admin/forge/skills';
function setup(){const f=skillAdminFixture(),coordinator=createSkillAdminCoordinator(f);let owner=ADMIN;
  const options={runtimeFactory:async()=>({coordinator}),sessionPool:()=>null,sessionReader:async()=>({walletAddress:owner}),originCheck:r=>{if(r.headers.get('origin')!=='https://goghpunks.xyz')throw new PublicError(403,'ORIGIN_REJECTED','Origin rejected.');}};
  return{f,options,setOwner:value=>{owner=value;},call:(body,headers={origin:'https://goghpunks.xyz'})=>handleForgeSkillAdmin(new Request(url,body?{method:'POST',headers,body:JSON.stringify(body)}:{}),options)};}
test('admin route requires session before runtime and has no unauthenticated record leak',async()=>{const f=setup();f.options.sessionReader=async()=>{throw new PublicError(401,'V2_SESSION_REQUIRED','Sign in.');};let runtime=0;f.options.runtimeFactory=async()=>{runtime++;throw Error();};
  const result=await f.call();assert.equal(result.status,401);assert.equal(runtime,0);assert.equal((await result.json()).record,undefined);});
test('current administrator can inspect/prepare; other wallet gets403 without records',async()=>{const f=setup();const view=await f.call();assert.equal(view.status,200);
  const prepared=await f.call({operation:'prepare',key:KEY,requestKey:randomUUID()});assert.equal((await prepared.json()).record.status,'PREPARED');
  f.setOwner(`0x${'2'.repeat(40)}`);const denied=await f.call();assert.equal(denied.status,403);assert.equal((await denied.json()).record,undefined);});
test('same-origin and exact body rules precede mutation',async()=>{const f=setup();const body={operation:'prepare',key:KEY,requestKey:randomUUID()};
  assert.equal((await f.call(body,{origin:'https://attacker.invalid'})).status,403);assert.equal((await f.call({...body,transaction:'0x'})).status,400);assert.equal(f.f.row,null);});
test('provider error bodies and credentials never reach route response',async()=>{const f=setup();f.options.runtimeFactory=async()=>{throw Error('https://rpc.invalid/SECRET value');};const result=await f.call();assert.equal(result.status,503);assert.equal((await result.text()).includes('SECRET'),false);});
test('duplicate query ids and unsupported methods are rejected',async()=>{const f=setup();const result=await handleForgeSkillAdmin(new Request(url+'?id=1&id=2'),f.options);assert.equal(result.status,400);
  assert.equal((await handleForgeSkillAdmin(new Request(url,{method:'DELETE'}),f.options)).status,405);});
test('cancellation endpoints remain session-bound and return only an explicitly claimed zero-value self transaction',async()=>{
  const f=setup();const{record}=await(await f.call({operation:'prepare',key:KEY,requestKey:randomUUID()})).json();
  await f.call({operation:'claim',id:record.id,revision:record.revision,reviewHash:record.reviewHash});
  const{cancellation}=await(await f.call({operation:'prepare_cancel',id:record.id,requestKey:randomUUID()})).json();
  assert.equal(cancellation.status,'PREPARED');assert.equal(f.f.row.status,'WALLET_REQUESTED');
  const response=await f.call({operation:'claim_cancel',id:record.id,cancellationId:cancellation.id,revision:cancellation.revision,reviewHash:cancellation.reviewHash});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.transaction.to,ADMIN);assert.equal(body.transaction.data,'0x');assert.equal(body.transaction.value,'0x0');
  assert.equal(body.cancellation.status,'WALLET_REQUESTED');assert.equal(body.record.status,'WALLET_REQUESTED');
  f.setOwner(`0x${'2'.repeat(40)}`);assert.equal((await f.call({operation:'prepare_cancel',id:record.id,requestKey:randomUUID()})).status,403);
});

test('default admin origin guard permits production and exact trusted preview origins',async t=>{
  const previous=process.env.SITE_URL;process.env.SITE_URL='https://goghpunks.xyz';
  t.after(()=>{if(previous===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=previous;});
  for(const origin of ['https://goghpunks.xyz','https://app.goghpunks.xyz',
    'https://deploy-preview-71--gogh-punks.netlify.app','https://deploy-preview-71.preview.goghpunks.xyz']){
    const f=setup();delete f.options.originCheck;
    const response=await handleForgeSkillAdmin(new Request(`${origin}/api/v2/admin/forge/skills`,{
      method:'POST',headers:{origin},body:JSON.stringify({operation:'prepare',key:KEY,requestKey:randomUUID()})}),f.options);
    assert.equal(response.status,200,origin);assert.equal((await response.json()).record.status,'PREPARED');
    assert.equal(f.f.row.administrator,ADMIN);
  }
});

test('default admin origin guard rejects cross-preview, arbitrary, missing and non-HTTPS origins before session or runtime',async t=>{
  const previous=process.env.SITE_URL;process.env.SITE_URL='https://goghpunks.xyz';
  t.after(()=>{if(previous===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=previous;});
  const preview='https://deploy-preview-71--gogh-punks.netlify.app';
  for(const [host,origin] of [[preview,'https://deploy-preview-72--gogh-punks.netlify.app'],
    [preview,'https://goghpunks.xyz'],[preview,'https://attacker.invalid'],[preview,null],
    ['https://candidate--gogh-punks.netlify.app','https://candidate--gogh-punks.netlify.app'],
    ['https://deploy-preview-71--attacker.netlify.app','https://deploy-preview-71--attacker.netlify.app'],
    ['http://deploy-preview-71--gogh-punks.netlify.app','http://deploy-preview-71--gogh-punks.netlify.app'],
    ['https://deploy-preview-71--gogh-punks.netlify.app:8443','https://deploy-preview-71--gogh-punks.netlify.app:8443'],
    ['https://goghpunks.xyz',preview],['https://goghpunks.xyz','https://attacker.invalid']]){
    const f=setup();delete f.options.originCheck;let sessions=0,runtimes=0;
    f.options.sessionReader=async()=>{sessions++;return{walletAddress:ADMIN};};
    f.options.runtimeFactory=async()=>{runtimes++;throw Error('UNEXPECTED_RUNTIME');};
    const response=await handleForgeSkillAdmin(new Request(`${host}/api/v2/admin/forge/skills`,{
      method:'POST',headers:origin?{origin}:{},body:JSON.stringify({operation:'prepare',key:KEY,requestKey:randomUUID()})}),f.options);
    assert.ok([403,404].includes(response.status),`${host} ${origin}`);
    assert.ok(['ORIGIN_REJECTED','V2_REVIEW_ONLY'].includes((await response.json()).code));
    assert.equal(sessions,0);assert.equal(runtimes,0);assert.equal(f.f.row,null);
  }
});

test('trusted preview origin never substitutes for signed-in current administrator authority',async()=>{
  const origin='https://deploy-preview-71--gogh-punks.netlify.app';
  const request=()=>new Request(`${origin}/api/v2/admin/forge/skills`,{method:'POST',headers:{origin},
    body:JSON.stringify({operation:'prepare',key:KEY,requestKey:randomUUID()})});
  const signedOut=setup();delete signedOut.options.originCheck;let runtimes=0;
  signedOut.options.sessionReader=async()=>{throw new PublicError(401,'V2_SESSION_REQUIRED','Sign in.');};
  signedOut.options.runtimeFactory=async()=>{runtimes++;throw Error('UNEXPECTED_RUNTIME');};
  assert.equal((await handleForgeSkillAdmin(request(),signedOut.options)).status,401);
  assert.equal(runtimes,0);assert.equal(signedOut.f.row,null);
  const wrongOwner=setup();delete wrongOwner.options.originCheck;wrongOwner.setOwner(`0x${'2'.repeat(40)}`);
  const denied=await handleForgeSkillAdmin(request(),wrongOwner.options);
  assert.equal(denied.status,403);assert.equal((await denied.json()).code,'SKILL_ADMIN_NOT_ADMINISTRATOR');
  assert.equal(wrongOwner.f.row,null);
});
