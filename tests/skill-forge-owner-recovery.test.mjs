import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransactionReceiptNotFoundError } from 'viem';
import { loadForgeDeploymentBuild, buildForgeDeploymentPlan, verifyForgeDeployment } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { openOwnerDeploymentSession } from '../scripts/dev/skill-forge/owner-deployment-session.mjs';
import { deploymentReceiptStatus } from '../site/forge-deployment-status.js';

const build=await loadForgeDeploymentBuild(), owner=`0x${'1'.repeat(40)}`;
const hash=n=>`0x${n.repeat(64)}`, originalHash=hash('d');
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'forge-recovery-test-')),path=join(dir,'journal.sqlite');
  const plan=buildForgeDeploymentPlan({build,administrator:owner,nonce:'3',anchor:{number:'100',hash:hash('a'),timestamp:Math.floor(Date.now()/1000)}});
  const tx={hash:originalHash,from:owner,to:null,input:plan.transactions[0].data,value:0n,chainId:4663,nonce:3,
    type:'eip1559',gas:BigInt(plan.gasLimits[0]),maxFeePerGas:BigInt(plan.maxFeePerGas),maxPriorityFeePerGas:0n,
    blockNumber:101n,blockHash:hash('b'),transactionIndex:0};
  const receipt={transactionHash:originalHash,from:owner,contractAddress:plan.addresses.deployment,blockNumber:101n,
    blockHash:hash('b'),transactionIndex:0,gasUsed:100000n,effectiveGasPrice:1n,status:'success'};
  const clients=[0,1].map(()=>({
    getChainId:async()=>4663,getTransaction:async({hash:h})=>({...tx,hash:h}),getTransactionReceipt:async()=>receipt,
    getBlock:async({blockNumber=100n})=>({number:blockNumber,hash:blockNumber===100n?hash('a'):hash('b'),timestamp:BigInt(plan.anchor.timestamp)+blockNumber-100n}),
  }));
  const settings={path,clients,endpoints:['TEST_PROVIDER_A','TEST_PROVIDER_B'],build,administrator:owner};
  let session=openOwnerDeploymentSession(settings);session.close();
  const db=new DatabaseSync(path);
  db.prepare('UPDATE owner_deployment SET data=? WHERE id=1').run(JSON.stringify({packet:{plan},
    steps:[{status:'WALLET_REQUESTED',transactionHash:null,review:null,inclusion:null},{status:'READY',transactionHash:null,review:null,inclusion:null}],
    evidence:null,candidates:null}));db.close();
  session=openOwnerDeploymentSession(settings);
  t.after(()=>{session.close();rmSync(dir,{recursive:true,force:true});});
  return {clients,tx,receipt,get session(){return session;},restart(){session.close();session=openOwnerDeploymentSession(settings);},
    recover:(transactionHash=originalHash)=>session.run('recover',{revision:session.snapshot().revision,index:0,transactionHash}),
    recheck:()=>session.run('recheck',{revision:session.snapshot().revision})};
}

test('reported hash is committed before an unavailable RPC and survives restart for recheck',async t=>{
  const f=fixture(t), entered=Promise.withResolvers(), release=Promise.withResolvers();
  const healthy=f.clients[1].getTransaction;
  f.clients[1].getTransaction=async()=>{entered.resolve();await release.promise;throw Error('Upstream connection unavailable');};
  const recovery=f.recover();await entered.promise;
  assert.equal(f.session.snapshot().steps[0].reportedTransactionHash,originalHash);
  assert.equal(f.session.snapshot().steps[0].transactionHash,null);
  release.resolve();const failed=await recovery;
  assert.equal(failed.steps[0].status,'WALLET_REQUESTED');assert.equal(failed.verification.status,'UNAVAILABLE');
  assert.equal(failed.evidence,null);assert.equal(failed.candidates,null);
  f.restart();assert.equal(f.session.snapshot().steps[0].reportedTransactionHash,originalHash);
  f.clients[1].getTransaction=healthy;
  const recovered=await f.recheck();
  assert.equal(recovered.steps[0].transactionHash,originalHash);assert.equal(recovered.steps[0].status,'INCLUDED');
  assert.equal(recovered.verification,null);
});

test('a wrong reported hash stays unverified and can be corrected without another wallet claim',async t=>{
  const f=fixture(t),healthy=f.clients[1].getTransaction;
  f.clients[1].getTransaction=async args=>({...await healthy(args),value:args.hash===hash('e')?1n:0n});
  const failed=await f.recover(hash('e'));
  assert.equal(failed.steps[0].reportedTransactionHash,hash('e'));assert.equal(failed.steps[0].transactionHash,null);
  assert.equal(failed.steps[0].status,'WALLET_REQUESTED');assert.equal(failed.verification.code,'FORGE_DEPLOYMENT_TRANSACTION_MISMATCH');
  assert.equal(failed.evidence,null);assert.equal(failed.candidates,null);
  const corrected=await f.recover();assert.equal(corrected.steps[0].status,'INCLUDED');
  await assert.rejects(f.recover(hash('f')),/FORGE_TRANSACTION_HASH_CHANGED/);
  await assert.rejects(f.session.run('claim',{revision:corrected.revision,index:0,reviewHash:corrected.packet.plan.planHash}),/FORGE_WALLET_ALREADY_REQUESTED/);
});

test('receipt RPC failure is unavailable while an actual missing receipt is pending',async t=>{
  const f=fixture(t);
  f.clients[1].getTransactionReceipt=async()=>{throw Error('Upstream request timed out');};
  const unavailable=await f.recover();assert.equal(unavailable.verification.status,'UNAVAILABLE');
  assert.equal(unavailable.steps[0].status,'WALLET_REQUESTED');
  f.clients[1].getTransactionReceipt=async()=>{throw new TransactionReceiptNotFoundError({hash:originalHash});};
  const pending=await f.recheck();assert.equal(pending.steps[0].status,'SUBMITTED');
  assert.equal(pending.steps[0].transactionHash,originalHash);assert.equal(pending.verification,null);
});

test('provider disagreement cannot become a verified receipt or a successful recheck',async t=>{
  const f=fixture(t);f.clients[1].getBlock=async({blockNumber})=>({number:blockNumber,hash:hash('f'),timestamp:1n});
  const result=await f.recover();assert.equal(result.steps[0].transactionHash,null);
  assert.equal(result.verification.status,'FAILED');assert.equal(result.evidence,null);
  assert.equal(deploymentReceiptStatus(result).error,true);
});

test('a missing hash is explained as missing recovery information, not pending finality',async t=>{
  const f=fixture(t), result=await f.recheck(),status=deploymentReceiptStatus(result);
  assert.equal(result.steps[0].status,'WALLET_REQUESTED');assert.equal(status.error,true);
  assert.match(status.text,/no saved transaction hash/);assert.doesNotMatch(status.text,/finality is pending/);
});

test('archival-read errors retain recovery data and display the unavailable verification',async t=>{
  const f=fixture(t);f.clients[1].getTransactionReceipt=async()=>{throw Error('Archive requests require a personal token');};
  const result=await f.recover();assert.equal(result.verification.code,'FORGE_ARCHIVE_STATE_UNAVAILABLE');
  assert.equal(result.steps[0].reportedTransactionHash,originalHash);assert.equal(result.evidence,null);
  assert.match(deploymentReceiptStatus(result).text,/historical reads/);
});

test('status distinguishes included receipts awaiting finality from verified deployment',()=>{
  const state={steps:[{status:'INCLUDED'},{status:'INCLUDED'}],evidence:null,
    verification:{status:'PENDING',code:'FORGE_DEPLOYMENT_FINALITY_PENDING'}};
  assert.match(deploymentReceiptStatus(state).text,/Waiting for the chain/);
  state.verification={status:'UNAVAILABLE',code:'FORGE_RPC_UNAVAILABLE'};
  assert.equal(deploymentReceiptStatus(state).error,true);assert.match(deploymentReceiptStatus(state).text,/RPC read failed/);
  state.verification={status:'VERIFIED'};state.evidence={status:'VERIFIED_PAUSED_FORGE'};
  assert.match(deploymentReceiptStatus(state).text,/Live deployment verified/);
  assert.match(deploymentReceiptStatus(state,{localFixture:true}).text,/Disposable deployment verified/);
});

test('a valid included transaction beyond finality gets a pending result without hiding a transaction mismatch',async t=>{
  const f=fixture(t),args={clients:f.clients,plan:f.session.snapshot().packet.plan,build,transactionHashes:[originalHash,hash('e')]};
  await assert.rejects(verifyForgeDeployment(args),/FORGE_DEPLOYMENT_FINALITY_PENDING/);
  f.tx.value=1n;
  await assert.rejects(verifyForgeDeployment(args),/FORGE_DEPLOYMENT_TRANSACTION_MISMATCH/);
});
