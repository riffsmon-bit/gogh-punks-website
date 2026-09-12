import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { loadForgeDeploymentBuild, buildForgeDeploymentPlan, buildForgeAcceptanceReview, validateForgeAcceptanceReview } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { createDeploymentWallet, validateDeploymentWalletReview } from '../site/forge-deployment-wallet.js';

const build=await loadForgeDeploymentBuild(), owner=`0x${'1'.repeat(40)}`, hash=n=>`0x${n.repeat(64)}`;
const fixture=nonce=>{
  const timestamp=Math.floor(Date.now()/1000),code='0x60006000';
  const plan=buildForgeDeploymentPlan({build,administrator:owner,nonce:String(nonce??3),localFixture:true,chainId:31337,
    pins:{collection:`0x${'2'.repeat(40)}`,collectionCodeHash:keccak256(code),allocationRoot:hash('3'),snapshotHash:hash('4')},
    anchor:{number:'100',hash:hash('a'),timestamp}});
  const state={revision:4,packet:{plan},steps:[{status:'READY'},{status:'READY',review:null}]};
  const config={administrator:owner,chainId:31337,localFixture:true,pins:plan.pins,buildHash:build.buildHash,creationCodeHash:build.pins.deployment.creationCodeHash};
  return {state,config,index:0,code};
};

for(const nonce of [0,1,127,128,255,256,1946])test(`browser independently derives CREATE addresses for nonce ${nonce}`,async()=>{
  const f=fixture(nonce),tx=await validateDeploymentWalletReview(f);
  assert.equal(tx.nonce,`0x${nonce.toString(16)}`);assert.equal(tx.chainId,'0x7a69');assert.equal(tx.value,'0x0');assert.equal(tx.to,undefined);
});
test('browser rejects altered constructor, network, owner, addresses and build pins',async()=>{
  for(const change of [f=>{f.state.packet.plan.transactions[0].data+='00';},f=>{f.config.chainId=4663;},
    f=>{f.config.administrator=`0x${'3'.repeat(40)}`;},f=>{f.state.packet.plan.addresses.registry=owner;},
    f=>{f.config.creationCodeHash=hash('b');},f=>{f.config.pins={...f.config.pins,allocationRoot:hash('c')};}]){
    const f=fixture();change(f);await assert.rejects(validateDeploymentWalletReview(f),/DEPLOYMENT_WALLET_REVIEW_CHANGED/);
  }
});
test('acceptance gets a separate bound review with a later nonce and fresh expiry',async()=>{
  const f=fixture();f.state.steps[0].status='INCLUDED';
  f.state.steps[1].review=buildForgeAcceptanceReview({plan:f.state.packet.plan,nonce:'12',
    anchor:{number:'110',hash:hash('b'),timestamp:Math.floor(Date.now()/1000)}});
  validateForgeAcceptanceReview(f.state.steps[1].review,f.state.packet.plan);
  const tx=await validateDeploymentWalletReview({...f,index:1});assert.equal(tx.to,f.state.packet.plan.addresses.registry);assert.equal(tx.data,'0x79ba5097');assert.equal(tx.nonce,'0xc');
  f.state.steps[1].review.transaction.to=owner;
  assert.throws(()=>validateForgeAcceptanceReview(f.state.steps[1].review,f.state.packet.plan),/FORGE_ACCEPTANCE_REVIEW_CHANGED/);
  await assert.rejects(validateDeploymentWalletReview({...f,index:1}),/DEPLOYMENT_WALLET_REVIEW_CHANGED/);
});
function walletFixture(){
  const f=fixture(),events=[],attempted=new Set();let sends=0,fault=null;
  const provider={request:async({method})=>{
    if(method==='eth_chainId')return '0x7a69';if(method==='eth_accounts')return [owner];
    if(method==='eth_getTransactionCount')return fault==='nonce'?'0x4':'0x3';if(method==='eth_getCode')return f.code;
    if(method==='eth_estimateGas')return '0x7a120';if(method==='eth_call')return '0x';
    if(method==='eth_sendTransaction'){sends++;events.push('send');if(fault==='lost-hash')throw Error('WALLET_RESPONSE_LOST');return hash('d');}
    throw Error(`Unexpected method ${method}`);
  }};
  const wallet=createDeploymentWallet({provider,isCurrent:()=>true,isAttempted:key=>attempted.has(key),
    markAttempted:async key=>{events.push('marker');attempted.add(key);},claim:async()=>{
      events.push('commit');if(fault==='lost-claim')throw Error('CLAIM_RESPONSE_LOST');
      const state=structuredClone(f.state);state.revision++;state.steps[0].status='WALLET_REQUESTED';
      state.transaction=await validateDeploymentWalletReview(f);if(fault==='tampered-claim')state.transaction.value='0x1';return state;
    }});
  return {...f,wallet,events,get sends(){return sends;},setFault:value=>{fault=value;}};
}
test('browser marker and durable server claim both precede a single wallet request',async()=>{
  const f=walletFixture();const result=await f.wallet.submit(f);assert.equal(result.transactionHash,hash('d'));assert.deepEqual(f.events,['marker','commit','send']);
  await assert.rejects(f.wallet.submit(f));assert.equal(f.sends,1);
});
for(const fault of ['lost-claim','lost-hash','tampered-claim'])test(`${fault} is recoverable without automatically requesting another transaction`,async()=>{
  const f=walletFixture();f.setFault(fault);await assert.rejects(f.wallet.submit(f));await assert.rejects(f.wallet.submit(f));
  assert.equal(f.sends,fault==='lost-hash'?1:0);
});
test('a changed wallet nonce blocks before the attempt marker or committed claim',async()=>{
  const f=walletFixture();f.setFault('nonce');await assert.rejects(f.wallet.submit(f));assert.deepEqual(f.events,[]);assert.equal(f.sends,0);
});
