import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { getContractAddress } from 'viem';
import { openSetupReviewJournal, setupDigest } from '../scripts/dev/skill-forge/setup-review-journal.mjs';
import { openSwarmSetupReviewJournal, recoverSwarmSetupTransaction, inspectSwarmSetupTransaction }
  from '../scripts/dev/skill-forge/swarm-setup-recovery.mjs';

const owner='0x'+'1'.repeat(40), hash='0x'+'a'.repeat(64), replacement='0x'+'b'.repeat(64), blockHash='0x'+'c'.repeat(64);
const anchorHash='0x'+'d'.repeat(64);
const review=()=>({action:'DEPLOY_SWARM_WALLET_FACTORY',label:'Deploy reviewed factory',expiresAt:Date.now()+60000,
  anchor:{number:'90',hash:anchorHash},
  maximumNetworkFeeWei:'1000000',predictedAddress:getContractAddress({from:owner,nonce:1n}),
  transaction:{from:owner,data:'0x60006000f3',value:'0x0',chainId:'0x1237',type:'0x2',nonce:'0x1',
    gas:'0x186a0',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x0'}});

function fixture(t,{submitted=false,prepared=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'gogh-swarm-recovery-')),options={path:join(dir,'review.sqlite'),binding:'test-release'};
  let base=openSetupReviewJournal(options),state=base.prepare(0,review());
  if(!prepared)state=base.claim(state.revision,state.records[0].reviewHash);
  if(submitted){state=base.report(state.revision,hash);state=base.recover(state.revision,hash);}
  base.close();let journal=openSwarmSetupReviewJournal(options);
  t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
  return {get journal(){return journal;},reopen(){journal.close();journal=openSwarmSetupReviewJournal(options);return journal;}};
}

function provider({transactionHash=hash,kind='DEPLOYMENT',tx:changes={},receipt:receiptChanges={},head=112n,code='0x'}={}) {
  const expected=review();
  const tx={hash:transactionHash,from:owner,to:kind==='CANCELLATION'?owner:null,input:kind==='CANCELLATION'?'0x':expected.transaction.data,
    chainId:4663,nonce:1,value:0n,type:'eip1559',gas:100000n,maxFeePerGas:10n,maxPriorityFeePerGas:0n,
    blockNumber:100n,blockHash,transactionIndex:0,...changes};
  const receipt={transactionHash,from:owner,to:kind==='CANCELLATION'?owner:null,
    status:'success',blockNumber:100n,blockHash,transactionIndex:0,gasUsed:21000n,effectiveGasPrice:5n,
    contractAddress:kind==='CANCELLATION'?null:expected.predictedAddress,logs:[],...receiptChanges};
  const calls=[];
  return {tx,receipt,calls,
    async getChainId(){calls.push('chain');return 4663;},
    async getTransaction(){calls.push('transaction');return tx;},
    async getTransactionReceipt(){calls.push('receipt');return receipt;},
    async getBlock({blockNumber}){calls.push('block');return {number:blockNumber,hash:blockNumber===90n?anchorHash:blockHash,transactions:[transactionHash]};},
    async getBlockNumber(){calls.push('head');return head;},
    async getCode({blockNumber}){calls.push('code:'+blockNumber);return code;},
  };
}
async function recover(f,clients,transactionHash=hash,verifyDeployment=async()=>{}) {
  return recoverSwarmSetupTransaction({journal:f.journal,revision:f.journal.snapshot().revision,transactionHash,clients,verifyDeployment});
}

test('existing PREPARED shared journal opens without mutation and preserves exact review identity',t=>{
  const f=fixture(t,{prepared:true}),state=f.journal.snapshot();
  assert.equal(state.revision,1);assert.equal(state.records[0].status,'PREPARED');
  assert.equal(state.records[0].reviewHash,setupDigest(state.records[0].review));
  f.journal.claim(state.revision,state.records[0].reviewHash);
  assert.equal(f.reopen().snapshot().records[0].status,'WALLET_REQUESTED');
});

test('original canonical deployment needs both runtime verifications and reports receipt fee',async t=>{
  const f=fixture(t),clients=[provider(),provider()];let verified=0;
  const result=await recover(f,clients,hash,async args=>{
    assert.equal(args.address,review().predictedAddress);assert.equal(args.blockNumber,100n);verified++;
  });
  const record=result.state.records[0];
  assert.equal(verified,2);assert.equal(record.status,'INCLUDED');assert.equal(record.inclusion.actualNetworkFeeWei,'105000');
  assert.equal(record.inclusion.feeExceeded,false);assert.equal(record.review.transaction.maxFeePerGas,'0xa');
});

test('owner gas/fee edits reconcile only after canonical inclusion without rewriting initial ceiling',async t=>{
  const f=fixture(t),changes={gas:150000n,maxFeePerGas:100n,maxPriorityFeePerGas:3n};
  const clients=[provider({tx:changes,receipt:{gasUsed:50000n,effectiveGasPrice:50n}}),provider({tx:changes,receipt:{gasUsed:50000n,effectiveGasPrice:50n}})];
  const original=f.journal.snapshot().records[0].reviewHash,result=await recover(f,clients);
  const record=result.state.records[0];
  assert.equal(record.status,'INCLUDED');assert.equal(record.reviewHash,original);
  assert.equal(record.inclusion.actualNetworkFeeWei,'2500000');assert.equal(record.inclusion.feeExceeded,true);
  assert.equal(record.review.maximumNetworkFeeWei,'1000000');assert.equal(record.review.transaction.gas,'0x186a0');
});

test('pending replacement preserves original submitted hash and claim across restart',async t=>{
  const f=fixture(t,{submitted:true}),unseen={...provider(),getTransaction:async()=>{
    const saved=f.journal.snapshot().records[0];assert.equal(saved.recoveryTransactionHash,replacement);
    assert.equal(saved.transactionHash,hash);throw Object.assign(Error('pending'),{name:'TransactionNotFoundError'});
  }};
  const first=await recover(f,[unseen,unseen],replacement);
  assert.equal(first.pending,true);assert.equal(first.state.records[0].status,'SUBMITTED');
  const journal=f.reopen(),state=journal.snapshot();assert.equal(state.records[0].transactionHash,hash);
  assert.throws(()=>journal.prepare(state.revision,review()),/SETUP_REVIEW_STATE_CHANGED/);
  assert.throws(()=>journal.decline(state.revision,state.records[0].reviewHash),/SETUP_REVIEW_STATE_CHANGED/);
});

test('confirmed speed-up atomically replaces hash while retaining original review/history',async t=>{
  const f=fixture(t,{submitted:true}),options={transactionHash:replacement,tx:{maxFeePerGas:12n}};
  const result=await recover(f,[provider(options),provider(options)],replacement),record=result.state.records[0];
  assert.equal(record.status,'INCLUDED');assert.equal(record.transactionHash,replacement);
  assert.equal(record.originalTransactionHash,hash);assert.equal(record.reportedTransactionHash,hash);
  assert.equal(f.reopen().snapshot().records[0].originalTransactionHash,hash);
});

test('proven EOA cancellation creates explicit CANCELLED state and permits only a fresh review',async t=>{
  const f=fixture(t,{submitted:true}),options={transactionHash:replacement,kind:'CANCELLATION'},clients=[provider(options),provider(options)];
  const result=await recover(f,clients,replacement,()=>assert.fail('Cancellation cannot deploy a factory'));
  const record=result.state.records[0];assert.equal(record.status,'CANCELLED');assert.equal(record.inclusion.kind,'CANCELLATION');
  assert.equal(record.originalTransactionHash,hash);assert.ok(clients.every(c=>c.calls.includes('code:99')&&c.calls.includes('code:100')));
  const reopened=f.reopen(),next=reopened.prepare(reopened.snapshot().revision,{...review(),transaction:{...review().transaction,nonce:'0x2'}});
  assert.equal(next.records.length,2);assert.equal(next.records[0].status,'CANCELLED');assert.equal(next.records[1].status,'PREPARED');
  assert.equal(next.records[1].transactionHash,null);
});

test('unconfirmed cancellation cannot unlock preparation',async t=>{
  const f=fixture(t,{submitted:true}),options={kind:'CANCELLATION',transactionHash:replacement,head:111n};
  const result=await recover(f,[provider(options),provider(options)],replacement);
  assert.equal(result.pending,true);assert.equal(result.state.records[0].transactionHash,hash);
  assert.throws(()=>f.journal.prepare(result.state.revision,review()),/SETUP_REVIEW_STATE_CHANGED/);
});

for(const [name,tx] of Object.entries({
  sender:{from:'0x'+'2'.repeat(40)},nonce:{nonce:2},chain:{chainId:1},value:{value:1n},
  bytecode:{input:'0x6001'},destination:{to:'0x'+'2'.repeat(40)},
  authorization:{authorizationList:[{}]},delegatedType:{type:'eip7702'},
}))test(`replacement with changed ${name} never replaces original journal`,async t=>{
  const f=fixture(t,{submitted:true}),options={transactionHash:replacement,tx};
  await assert.rejects(recover(f,[provider(options),provider(options)],replacement),/SETUP_RECOVERY_MISMATCH/);
  const record=f.journal.snapshot().records[0];assert.equal(record.status,'SUBMITTED');assert.equal(record.transactionHash,hash);
});

for(const [name,options] of Object.entries({
  contractOwner:{code:'0x6000'},events:{receipt:{logs:[{}]}},revert:{receipt:{status:'reverted'}},
  value:{tx:{value:1n}},calldata:{tx:{input:'0x1234'}},authorization:{tx:{authorizationList:[{}]}},
}))test(`cancellation with ${name} cannot release the claim`,async t=>{
  const f=fixture(t),input={kind:'CANCELLATION',transactionHash:replacement,...options};
  await assert.rejects(recover(f,[provider(input),provider(input)],replacement),/SETUP_RECOVERY_MISMATCH/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
});

test('both providers must agree on actual fee and fee transaction fields',async t=>{
  const f=fixture(t);
  await assert.rejects(recover(f,[provider(),provider({receipt:{effectiveGasPrice:6n}})]),/SETUP_PROVIDERS_DISAGREE/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
});

test('receipt not found on either provider and runtime mismatch never complete deployment',async t=>{
  const f=fixture(t),missing={...provider(),getTransactionReceipt:async()=>{throw Object.assign(Error('missing'),{name:'TransactionReceiptNotFoundError'});}};
  const result=await recover(f,[provider(),missing]);assert.equal(result.pending,true);
  await assert.rejects(recover(f,[provider(),provider()],hash,async()=>{throw Error('RUNTIME_MISMATCH');}),/RUNTIME_MISMATCH/);
  assert.equal(f.journal.snapshot().records[0].transactionHash,null);
});

test('noncanonical block inclusion and reorg cannot release original claim',async t=>{
  const f=fixture(t),base=provider(),wrongBlock={...base,getBlock:async args=>args.blockNumber===90n?base.getBlock(args):({number:100n,hash:blockHash,transactions:[replacement]})};
  await assert.rejects(recover(f,[wrongBlock,provider()]),/SETUP_RECOVERY_MISMATCH/);
  let calls=0;const reorg={...base,getBlock:async args=>args.blockNumber===90n?base.getBlock(args):({number:100n,hash:++calls===1?blockHash:replacement,transactions:[hash]})};
  await assert.rejects(recover(f,[reorg,provider()]),/SETUP_ANCHOR_REORG/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
});

test('reverted exact deployment is terminal without runtime verification and preserves fee evidence',async t=>{
  const f=fixture(t),options={receipt:{status:'reverted',contractAddress:null}};
  const result=await recover(f,[provider(options),provider(options)],hash,()=>assert.fail('Revert has no deployed runtime'));
  assert.equal(result.state.records[0].status,'REVERTED');assert.equal(result.state.records[0].inclusion.actualNetworkFeeWei,'105000');
});

test('same-nonce legacy replacement is recognized without relaxing deployment identity',async t=>{
  const f=fixture(t),options={transactionHash:replacement,tx:{type:'legacy',gasPrice:20n},receipt:{effectiveGasPrice:20n}};
  const result=await recover(f,[provider(options),provider(options)],replacement);
  assert.equal(result.state.records[0].status,'INCLUDED');assert.equal(result.state.records[0].inclusion.recoveredTransaction.gasPrice,'20');
});

test('pre-review inclusion and changed review anchor cannot finalize a transaction',async t=>{
  const f=fixture(t),before={tx:{blockNumber:89n},receipt:{blockNumber:89n}};
  await assert.rejects(recover(f,[provider(before),provider(before)]),/SETUP_RECOVERY_MISMATCH/);
  const base=provider(),anchorChanged={...base,getBlock:async args=>({...await base.getBlock(args),hash:blockHash})};
  await assert.rejects(recover(f,[anchorChanged,provider()]),/SETUP_ANCHOR_REORG/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
});

test('legacy receipt price must exactly equal its signed transaction gas price',async t=>{
  const f=fixture(t),options={tx:{type:'legacy',gasPrice:20n},receipt:{effectiveGasPrice:19n}};
  await assert.rejects(recover(f,[provider(options),provider(options)]),/SETUP_RECOVERY_MISMATCH/);
  assert.equal(f.journal.snapshot().records[0].status,'WALLET_REQUESTED');
});

test('journal revision change during verification cannot overwrite newer state',async t=>{
  const f=fixture(t);let changed=false;
  await assert.rejects(recover(f,[provider(),provider()],hash,async()=>{
    if(!changed){changed=true;f.journal.reportCandidate(f.journal.snapshot().revision,replacement);}
  }),/SETUP_REVIEW_STATE_CHANGED/);
  const state=f.journal.snapshot();assert.equal(state.records[0].transactionHash,null);assert.equal(state.records[0].recoveryTransactionHash,replacement);
});

test('verification requires two providers and derives predicted address from original owner/nonce',async()=>{
  await assert.rejects(inspectSwarmSetupTransaction({transactionHash:hash,review:review(),clients:[provider()],verifyDeployment:async()=>{}}),/SETUP_RECOVERY_MISMATCH/);
  await assert.rejects(inspectSwarmSetupTransaction({transactionHash:hash,review:{...review(),predictedAddress:owner},clients:[provider(),provider()],verifyDeployment:async()=>{}}),/SETUP_RECOVERY_MISMATCH/);
});

test('Swarm runner uses dedicated recovery/UI while retaining original send/preflight ceiling',()=>{
  const source=readFileSync(new URL('../scripts/dev/skill-forge/run-swarm-wallet-setup.mjs',import.meta.url),'utf8');
  assert.match(source,/openSwarmSetupReviewJournal/);assert.match(source,/swarm-wallet-setup\.js/);
  assert.match(source,/gas\*maxFeePerGas<=10n\*\*15n/);assert.match(source,/await preflight\(record\.review\);state=journal\.claim/);
  assert.doesNotMatch(source,/recoverSetupTransaction|eth_sendTransaction|sendRawTransaction/);
});

async function browserFixture({cancel=false,reported=true}={}) {
  let walletCalls=0;
  const requests=[],elements=new Map(),get=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,replaceChildren(){}});
    return elements.get(id);
  };
  let state={revision:2,records:[{review:review(),reviewHash:'review-hash',status:'WALLET_REQUESTED',transactionHash:null,
    ...(reported?{reportedTransactionHash:hash}:{}),inclusion:null}]};
  const config={owner,steps:[{action:review().action,label:review().label}],completionMessage:'Factory confirmed; no funds moved.'};
  const source=readFileSync(new URL('../scripts/dev/skill-forge/swarm-wallet-setup.js',import.meta.url),'utf8');
  const fetch=async(url,options)=>{
    if(!options)return {ok:true,json:async()=>({state,config,csrf:'test-csrf'})};
    const request=JSON.parse(options.body);requests.push(request.action);
    assert.equal(request.action,'recover');
    const record=state.records[0];
    state={revision:3,records:[{...record,status:cancel?'CANCELLED':'INCLUDED',transactionHash:request.transactionHash,
      inclusion:{kind:cancel?'CANCELLATION':'DEPLOYMENT',actualNetworkFeeWei:'2500000',feeExceeded:true}}]};
    return {ok:true,json:async()=>({state,pending:false})};
  };
  await runInNewContext('(async()=>{'+source+'})()',{
    document:{getElementById:get,createElement:()=>({})},fetch,
    window:{ethereum:{request:async()=>{walletCalls++;throw Error('Unexpected wallet request');}}},
    localStorage:{getItem:()=>null,setItem:()=>{}},setInterval:()=>0,
  });
  return {get,requests,get walletCalls(){return walletCalls;}};
}

test('browser cancellation recovery unlocks fresh review without opening or resending wallet',async()=>{
  const browser=await browserFixture({cancel:true});browser.get('hash').value=replacement;
  await browser.get('recover').onclick();
  assert.deepEqual(browser.requests,['recover']);assert.equal(browser.walletCalls,0);
  assert.equal(browser.get('prepare').disabled,false);assert.equal(browser.get('send').disabled,true);
  assert.match(browser.get('status').textContent,/Cancellation confirmed/);
  assert.match(browser.get('fee').textContent,/Actual fee:.*exceeded the reviewed fee limit/);
});

test('browser initial hash recovery can finish without rechecking a now-terminal record',async()=>{
  const browser=await browserFixture({reported:false});browser.get('hash').value=hash;
  await browser.get('recheck').onclick();
  assert.deepEqual(browser.requests,['recover']);assert.equal(browser.walletCalls,0);
  assert.equal(browser.get('prepare').disabled,true);assert.equal(browser.get('send').disabled,true);
  assert.match(browser.get('status').textContent,/Factory confirmed/);
});
