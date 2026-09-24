import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encodeDeployData, getContractAddress } from 'viem';
import { setupDigest } from './setup-review-journal.mjs';
import { createSetupReadClient, readSetupAnchor } from './setup-read-client.mjs';
import { setupErrorSummary } from './setup-error-summary.mjs';
import { openSwarmSetupReviewJournal, recoverSwarmSetupTransaction } from './swarm-setup-recovery.mjs';
import { loadSwarmDeployment, verifySwarmDependencies, verifySwarmDeployment, SWARM_SETUP_OWNER } from './swarm-wallet-deployment.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-owner-wallet') throw Error('Requires explicit owner-wallet deployment review mode');
const {factory, vault, release, configuration} = await loadSwarmDeployment();
const owner = SWARM_SETUP_OWNER;
let archive;
try { archive = execFileSync('security', ['find-generic-password', '-s', 'Gogh Punks Validation Cloud Robinhood archive RPC', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { throw Error('SETUP_ARCHIVE_CONFIGURATION_REQUIRED'); }
// PublicNode returned -32602 for this deployment's historical state. The official
// chain endpoint and independent archive both verify the receipt-block state.
const clients = [archive, 'https://rpc.mainnet.chain.robinhood.com'].map(createSetupReadClient);
const steps=[{action:'DEPLOY_SWARM_WALLET_FACTORY',label:'Deploy reviewed owner-controlled Swarm Wallet factory',to:null,
  data:encodeDeployData({abi:factory.abi,bytecode:factory.bytecode.object,args:configuration})}];
const binding = setupDigest({ owner, steps, release });
const journal = openSwarmSetupReviewJournal({ path: join(homedir(), '.gogh-punks', 'swarm-wallet-setup.sqlite'), binding });
const verifyDeployment = args => verifySwarmDeployment({ ...args, factory, release });
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const valid = (v,code) => { if (!v) throw Error(code); }, hex = v => '0x' + BigInt(v).toString(16);
const config={owner,chainId:4663,walletAuthority:'NONE',steps:steps.map(({action,label,to})=>({action,label,to})),burnEnabled:false,
  completionMessage:'Factory deployment confirmed by both providers. Public release still requires the verified address and code hash. No Swarm Wallet was funded and no Punk mission was activated.'};
async function context() {
  const block = await readSetupAnchor(clients);
  for (const client of clients) {
    valid(await client.getChainId() === 4663 && same((await client.getBlock({blockNumber:block.number})).hash,block.hash), 'SETUP_PROVIDERS_DISAGREE');
    await verifySwarmDependencies({ client, release, blockNumber:block.number });
  }
  return block;
}
async function prepare(revision) {
  const state=journal.snapshot(); valid(state.revision===revision,'SETUP_REVISION_CHANGED');
  const completed=state.records.filter(r=>r.status==='INCLUDED').map(r=>r.review.action);
  const step=steps.find(s=>!completed.includes(s.action)); valid(step,'SETUP_COMPLETE');
  valid(!state.records.length || ['PREPARED','DECLINED','INCLUDED','REVERTED','CANCELLED'].includes(state.records.at(-1).status),'RECOVER_EXISTING_WALLET_TRANSACTION');
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
let busy=false,origin; const csrf=randomBytes(32).toString('hex');
const server=createServer(async(req,res)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const json=(status,value)=>{res.writeHead(status,{...headers,'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.host!==new URL(origin).host||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'LOCAL_SETUP_ONLY'});
  try {
    if(req.method==='GET') {
      if(req.url==='/api/state')return json(200,{config,csrf,state:journal.snapshot()});
      const files={'/':['swarm-wallet-setup.html','text/html'],'/setup.js':['swarm-wallet-setup.js','text/javascript'],'/setup.css':['owner-deployment.css','text/css']};
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
      let state=journal.snapshot(),pending=false;valid(state.revision===body.revision,'SETUP_REVISION_CHANGED');
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
        ({state,pending}=await recoverSwarmSetupTransaction({journal,revision:body.revision,transactionHash:body.transactionHash,clients,verifyDeployment}));
      } else if(body.action==='recheck') {
        const hash=record?.recoveryTransactionHash??record?.transactionHash??record?.reportedTransactionHash;
        valid(record&&['WALLET_REQUESTED','SUBMITTED'].includes(record.status)&&hash,'RECOVER_TRANSACTION_HASH_FIRST');
        ({state,pending}=await recoverSwarmSetupTransaction({journal,revision:state.revision,transactionHash:hash,clients,verifyDeployment}));
      } else throw Error('INVALID_SETUP_ACTION');
      return json(200,{state,pending});
    } finally {busy=false;}
  } catch(error) {
    console.warn(JSON.stringify({event:'SETUP_READ_FAILED',causes:setupErrorSummary(error),
      code:/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_SETUP_READ_UNAVAILABLE'}));
    return json(409,{error:/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_SETUP_READ_UNAVAILABLE'});
  }
});
const port=64350;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
origin=`http://127.0.0.1:${port}`;console.log(JSON.stringify({url:origin,owner,steps:config.steps,serverHasSigner:false,burnEnabled:false}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();journal.close();process.exit(0);});
