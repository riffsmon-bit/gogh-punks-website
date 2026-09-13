import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encodeFunctionData, encodeDeployData, getContractAddress, keccak256, parseAbi } from 'viem';
import { loadRegistryCanaryInputs } from '../../../broker/src/v4/skill-forge/registry-canary.mjs';
import { openSetupReviewJournal, setupDigest } from './setup-review-journal.mjs';
import { createSetupReadClient } from './setup-read-client.mjs';
import release from '../../../deployments/robinhood-forge-training.json' with { type:'json' };

if (process.argv.length!==3 || process.argv[2]!=='--live-owner-wallet') throw Error('Requires --live-owner-wallet');
const ROOT=new URL('../../../',import.meta.url),owner='0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6';
const inputs=await loadRegistryCanaryInputs(),rarity=inputs.pins.definitions.find(d=>d.slug==='rarity-eye');
const evidence=JSON.parse(await readFile(new URL('docs/review/2026-09-12/atomic-forge/rarity-eye-selected-pair-fork.json',ROOT)));
if(evidence.status!=='PASS' || evidence.copiedSourceTokenId!=='1753' || evidence.copiedRecipientTokenId!=='93'
  || evidence.selectedSkill.manifestHash!==rarity.manifestHash || evidence.selectedSkill.instructionHash!==rarity.instructionHash
  || !evidence.spendingToolsDenied || !evidence.unequippedToolDenied) throw Error('RARITY_REHEARSAL_REQUIRED');
const paid=JSON.parse(await readFile(new URL('contracts/out/GoghPunkDirectedPaidMint.sol/GoghPunkDirectedPaidMintFactory.json',ROOT)));
if(paid.metadata.compiler.version!=='0.8.34+commit.80d5c536' || !paid.metadata.settings.viaIR
  || paid.metadata.settings.optimizer.runs!==500 || paid.metadata.settings.evmVersion!=='cancun') throw Error('PAID_BUILD_UNVERIFIED');
for(const [path,source] of Object.entries(paid.metadata.sources)) {
  if(path.includes('..') || !/^(contracts\/src\/|node_modules\/@openzeppelin\/contracts\/)/.test(path)
    || keccak256(await readFile(new URL(path,ROOT)))!==source.keccak256) throw Error('PAID_BUILD_STALE');
}
const agentRegistry='0x3253adc3bBd5B0010C1Bf9cE8def26b7e0DB5844';
const agentRelease=JSON.parse(await readFile(new URL('deployments/robinhood-punk-agent-account.json',ROOT)));
const clients=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(createSetupReadClient);
const zero='0x'+'0'.repeat(64),reviewEvidenceHash='0x'+setupDigest(evidence);
const steps=[
  {action:'REGISTER_RARITY_EYE',label:'Register Rarity Eye v1',to:release.registry,data:encodeFunctionData({abi:inputs.artifact.abi,functionName:'register',args:[4,1,rarity.manifestHash,rarity.instructionHash,zero,8n,0]})},
  {action:'TEST_RARITY_EYE',label:'Record Rarity Eye testing status',to:release.registry,data:encodeFunctionData({abi:inputs.artifact.abi,functionName:'setStatus',args:[rarity.key,3,zero]})},
  {action:'READY_RARITY_EYE',label:'Approve the reviewed Rarity Eye definition',to:release.registry,data:encodeFunctionData({abi:inputs.artifact.abi,functionName:'setStatus',args:[rarity.key,4,reviewEvidenceHash]})},
];
const registryHash=agentRelease.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash;
if(!/^0x[0-9a-f]{64}$/i.test(registryHash??'')) throw Error('AGENT_REGISTRY_PIN_REQUIRED');
steps.push({action:'DEPLOY_DIRECTED_PAID_MINT',label:'Deploy the directed paid-mint factory and adapter',to:null,
  data:encodeDeployData({abi:paid.abi,bytecode:paid.bytecode.object,args:[agentRegistry,registryHash,
    '0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c',
    '0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519',
    '0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041']})});
const binding=setupDigest({owner,steps,rarity,reviewEvidenceHash});
const journal=openSetupReviewJournal({path:join(homedir(),'.gogh-punks','selected-launch-setup.sqlite'),binding,
  migrateBinding: prior => prior.records.every(record => {
    const step=steps.slice(0,3).find(s=>s.action===record.review.action),tx=record.review.transaction;
    return step && tx.from===owner && tx.to===step.to && tx.data===step.data && tx.value==='0x0' && tx.chainId==='0x1237';
  })});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const valid=(v,code)=>{if(!v)throw Error(code)},hex=v=>'0x'+BigInt(v).toString(16);
const registryAbi=parseAbi(['function owner() view returns(address)','function globallyDisabled() view returns(bool)']);
const config={owner,chainId:4663,sourceTokenId:'1753',targetTokenId:'93',skill:'Rarity Eye',rarity,reviewEvidenceHash,
  walletAuthority:'NONE',steps:steps.map(({action,label,to})=>({action,label,to})),burnEnabled:false};
async function context() {
  const c=clients[0],block=await c.getBlock();
  valid(Math.abs(Date.now()/1000-Number(block.timestamp))<30,'LIVE_SETUP_STATE_STALE');
  for(const client of clients) {
    valid(await client.getChainId()===4663 && same((await client.getBlock({blockNumber:block.number})).hash,block.hash),'SETUP_PROVIDERS_DISAGREE');
    valid(keccak256(await client.getCode({address:release.registry,blockNumber:block.number})??'0x')===release.registryCodeHash,'REGISTRY_CODE_CHANGED');
    valid(same(await client.readContract({address:release.registry,abi:registryAbi,functionName:'owner',blockNumber:block.number}),owner),'REGISTRY_OWNER_CHANGED');
  }
  return block;
}
async function prepare(revision) {
  const state=journal.snapshot(); valid(state.revision===revision,'SETUP_REVISION_CHANGED');
  const completed=state.records.filter(r=>r.status==='INCLUDED').map(r=>r.review.action);
  const step=steps.find(s=>!completed.includes(s.action)); valid(step,'SETUP_COMPLETE');
  valid(!state.records.length || ['PREPARED','DECLINED','INCLUDED','REVERTED'].includes(state.records.at(-1).status),'RECOVER_EXISTING_WALLET_TRANSACTION');
  const block=await context(),c=clients[0];
  const [nonce,pending,gasPrice]=await Promise.all([c.getTransactionCount({address:owner}),c.getTransactionCount({address:owner,blockTag:'pending'}),c.getGasPrice()]);
  valid(nonce===pending,'OWNER_TRANSACTION_PENDING');
  if(state.records.at(-1)?.status==='DECLINED')valid(nonce===Number(BigInt(state.records.at(-1).review.transaction.nonce)),'SETUP_NONCE_CHANGED');
  const call={account:owner,...(step.to?{to:step.to}:{}),data:step.data,value:0n};
  const estimate=await c.estimateGas(call),gas=(estimate*120n+99n)/100n,maxFeePerGas=gasPrice*2n;
  valid(gas*maxFeePerGas<=10n**15n && gas>0n,'SETUP_FEE_LIMIT');
  valid(await c.getBalance({address:owner})>=gas*maxFeePerGas,'SETUP_GAS_UNFUNDED');
  const review={action:step.action,label:step.label,anchor:{number:String(block.number),hash:block.hash},expiresAt:Date.now()+600000,
    maximumNetworkFeeWei:String(gas*maxFeePerGas),predictedAddress:step.to?null:getContractAddress({from:owner,nonce:BigInt(nonce)}),
    transaction:{from:owner,...(step.to?{to:step.to}:{}),data:step.data,value:'0x0',chainId:'0x1237',type:'0x2',nonce:hex(nonce),gas:hex(gas),maxFeePerGas:hex(maxFeePerGas),maxPriorityFeePerGas:'0x0'}};
  await preflight(review); return journal.prepare(revision,review);
}
async function preflight(review) {
  valid(Date.now()<review.expiresAt,'SETUP_REVIEW_EXPIRED');
  await context(); const tx=review.transaction;
  for(const c of clients) {
    const [latest,pending]=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:owner,blockTag})));
    valid(latest===pending&&latest===Number(BigInt(tx.nonce)),'SETUP_NONCE_CHANGED');
    valid(await c.getBalance({address:owner})>=BigInt(review.maximumNetworkFeeWei),'SETUP_GAS_UNFUNDED');
    valid(same((await c.getBlock({blockNumber:BigInt(review.anchor.number)})).hash,review.anchor.hash),'SETUP_ANCHOR_REORG');
    await c.call({account:owner,...(tx.to?{to:tx.to}:{}),data:tx.data,value:0n,gas:BigInt(tx.gas),maxFeePerGas:BigInt(tx.maxFeePerGas),maxPriorityFeePerGas:0n});
  }
}
async function inspect(hash,review) {
  const observed=[];
  for(const c of clients) {
    const tx=await c.getTransaction({hash}),r=await c.getTransactionReceipt({hash}),b=await c.getBlock({blockNumber:r.blockNumber});
    const expected=review.transaction;
    valid(same(tx.hash,hash)&&same(r.transactionHash,hash)&&same(tx.from,owner)&&tx.chainId===4663&&tx.nonce===Number(BigInt(expected.nonce))
      && tx.input===expected.data&&tx.value===0n&&tx.gas===BigInt(expected.gas)&&tx.maxFeePerGas===BigInt(expected.maxFeePerGas)
      && tx.maxPriorityFeePerGas===0n&&tx.type==='eip1559'&&!tx.authorizationList?.length
      && (expected.to?same(tx.to,expected.to):tx.to===null)
      && same(b.hash,r.blockHash)&&same(tx.blockHash,b.hash)&&tx.blockNumber===r.blockNumber&&tx.transactionIndex===r.transactionIndex
      && r.gasUsed>0n&&r.gasUsed<=tx.gas&&r.effectiveGasPrice<=tx.maxFeePerGas
      && (expected.to||r.status==='reverted'||same(r.contractAddress,review.predictedAddress)),'SETUP_RECEIPT_MISMATCH');
    valid((await c.getBlockNumber())>=r.blockNumber+12n,'SETUP_CONFIRMATIONS_PENDING');
    observed.push({transactionHash:hash.toLowerCase(),status:r.status,blockNumber:String(b.number),blockHash:b.hash,contractAddress:r.contractAddress});
  }
  valid(JSON.stringify(observed[0])===JSON.stringify(observed[1]),'SETUP_PROVIDERS_DISAGREE'); return observed[0];
}
let busy=false,origin; const csrf=randomBytes(32).toString('hex');
const server=createServer(async(req,res)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const json=(status,value)=>{res.writeHead(status,{...headers,'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.host!==new URL(origin).host||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'LOCAL_SETUP_ONLY'});
  try {
    if(req.method==='GET') {
      if(req.url==='/api/state')return json(200,{config,csrf,state:journal.snapshot()});
      const files={'/':['selected-launch-setup.html','text/html'],'/setup.js':['selected-launch-setup.js','text/javascript'],'/setup.css':['owner-deployment.css','text/css']};
      const entry=files[req.url]; if(!entry)return json(404,{error:'NOT_FOUND'});
      res.writeHead(200,{...headers,'content-type':entry[1]});res.end(await readFile(new URL(entry[0],import.meta.url)));return;
    }
    if(req.method!=='POST'||req.url!=='/api/action'||req.headers.origin!==origin||req.headers['x-setup-nonce']!==csrf
      ||req.headers['content-type']!=='application/json')return json(403,{error:'LOCAL_SETUP_ORIGIN_REQUIRED'});
    if(busy)return json(409,{error:'SETUP_BUSY'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return json(413,{error:'BODY_TOO_LARGE'});}
    const body=JSON.parse(raw);valid(body&&Number.isInteger(body.revision),'INVALID_SETUP_ACTION');
    busy=true;
    try {
      let state=journal.snapshot();valid(state.revision===body.revision,'SETUP_REVISION_CHANGED');
      const record=state.records.at(-1);
      if(body.action==='prepare')state=await prepare(body.revision);
      else if(body.action==='claim') {
        valid(record?.status==='PREPARED'&&record.reviewHash===body.reviewHash,'SETUP_REVIEW_STATE_CHANGED');
        await preflight(record.review);state=journal.claim(body.revision,body.reviewHash);
      } else if(body.action==='decline') {
        valid(record?.status==='WALLET_REQUESTED'&&record.reviewHash===body.reviewHash,'SETUP_REVIEW_STATE_CHANGED');
        // Only an explicit wallet rejection uses this path. An ambiguous timeout
        // remains claimed. Both nodes must still see the originally reviewed nonce.
        for(const c of clients) {
          const nonces=await Promise.all(['latest','pending'].map(blockTag=>c.getTransactionCount({address:owner,blockTag})));
          valid(nonces.every(n=>n===Number(BigInt(record.review.transaction.nonce))),'RECOVER_EXISTING_WALLET_TRANSACTION');
        }
        state=journal.decline(body.revision,body.reviewHash);
      } else if(body.action==='recover') {
        valid(record&&['WALLET_REQUESTED','SUBMITTED'].includes(record.status),'RECOVERY_NOT_AVAILABLE');
        valid(/^0x[0-9a-f]{64}$/i.test(body.transactionHash??''),'INVALID_TRANSACTION_HASH');
        // Bind the hash before saving, even if confirmations still need to accumulate.
        const tx=await clients[0].getTransaction({hash:body.transactionHash}),expected=record.review.transaction;
        valid(same(tx.from,owner)&&tx.chainId===4663&&tx.nonce===Number(BigInt(expected.nonce))&&tx.input===expected.data
          &&tx.value===0n&&(expected.to?same(tx.to,expected.to):tx.to===null),'SETUP_RECOVERY_MISMATCH');
        state=journal.recover(body.revision,body.transactionHash);
      } else if(body.action==='recheck') {
        valid(record?.status==='SUBMITTED','RECOVER_TRANSACTION_HASH_FIRST');
        state=journal.include(body.revision,await inspect(record.transactionHash,record.review));
      } else throw Error('INVALID_SETUP_ACTION');
      return json(200,{state});
    } finally {busy=false;}
  } catch(error) {return json(409,{error:/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_SETUP_READ_UNAVAILABLE'});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(64346,'127.0.0.1',resolve);});
origin='http://127.0.0.1:64346';console.log(JSON.stringify({url:origin,owner,steps:config.steps,serverHasSigner:false,burnEnabled:false}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();journal.close();process.exit(0);});
