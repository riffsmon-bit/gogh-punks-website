import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import { loadForgeDeploymentBuild } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { openOwnerDeploymentSession } from './dev/skill-forge/owner-deployment-session.mjs';
import { startOwnerDeploymentServer } from './dev/skill-forge/owner-deployment-server.mjs';

if(process.argv.length!==3||process.argv[2]!=='--local-only')throw Error('Requires --local-only');
const dir=await mkdtemp(join(tmpdir(),'gogh-owner-browser-'));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const anvil=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(port),'--chain-id','31337'],{stdio:'ignore'});
let startupError;anvil.on('error',e=>{startupError=e;});
let session,server,chrome,ws;
try{
  const transport=http(`http://127.0.0.1:${port}`,{timeout:3000,retryCount:0}),client=createPublicClient({transport,cacheTime:0});
  let ready=false;for(let i=0;i<80;i++){if(startupError||anvil.exitCode!==null)throw Error('ANVIL_START_FAILED');try{ready=await client.getChainId()===31337;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready&&/anvil/i.test(await client.request({method:'web3_clientVersion'})));
  const [owner,buyer]=await client.request({method:'eth_accounts'}),wallet=createWalletClient({transport,account:owner});
  const nft=JSON.parse(await readFile(new URL('../contracts/out/LocalReviewedBurn.sol/LocalBurnPunks.json',import.meta.url),'utf8'));
  const receipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:nft.abi,bytecode:nft.bytecode.object,args:[],chain:null})});assert.equal(receipt.status,'success');
  const pins={collection:receipt.contractAddress,collectionCodeHash:keccak256(await client.getCode({address:receipt.contractAddress})),allocationRoot:keccak256('0x1234'),snapshotHash:keccak256('0x5678')};
  let unavailableHash=null;
  const recoveryClient={...client,getTransaction:args=>{
    if(args.hash===unavailableHash)throw Error('Simulated upstream lookup outage');return client.getTransaction(args);
  }};
  const build=await loadForgeDeploymentBuild(),settings={path:join(dir,'journal.sqlite'),clients:[recoveryClient],endpoints:['OWNED_ANVIL'],build,administrator:owner,localFixture:true,pins};
  session=openOwnerDeploymentSession(settings);
  const serverSettings={session,build,administrator:owner,client,localFixture:true,pins,port:0};server=await startOwnerDeploymentServer(serverSettings);
  const browserProfile=join(dir,'chrome');
  chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-proxy-server','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${browserProfile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),15000);chrome.once('error',reject);chrome.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  const page=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map(),errors=[],sent=[];let dropNextHash=true,selected=buyer;
  const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error(`CDP_TIMEOUT ${method}`));},30000);pending.set(next,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  ws.onmessage=async({data})=>{
    const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    const task=pending.get(m.id);if(task){pending.delete(m.id);m.error?task.reject(Error(JSON.stringify(m.error))):task.resolve(m.result);}
    if(m.method==='Runtime.bindingCalled'&&m.params.name==='ownerTestRpc'){
      const {id:requestId,request}=JSON.parse(m.params.payload);let result,error;
      try{
        if(['eth_accounts','eth_requestAccounts'].includes(request.method))result=[selected];
        else{assert.ok(['eth_chainId','eth_getTransactionCount','eth_getCode','eth_estimateGas','eth_call','eth_sendTransaction'].includes(request.method));result=await client.request(request);}
        if(request.method==='eth_sendTransaction'){sent.push(result);if(dropNextHash){dropNextHash=false;throw Error('TEST_WALLET_HASH_RESPONSE_LOST');}unavailableHash=result;}
      }catch(e){error=e.message;}
      await evaluate(`window.finishOwnerTestRpc(${JSON.stringify({id:requestId,result,error})})`);
    }
  };
  const until=async expr=>{for(let i=0;i<600;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,100));}throw Error(`DOM_TIMEOUT ${expr}: ${await evaluate("document.getElementById('status')?.textContent")}`);};
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await call('Runtime.enable');await call('Network.enable');await call('Page.enable');await call('Runtime.addBinding',{name:'ownerTestRpc'});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`{let id=0;const pending=new Map();window.finishOwnerTestRpc=({id,result,error})=>{const p=pending.get(id);pending.delete(id);error?p.reject(Error(error)):p.resolve(result);};window.ethereum={on(){},request(request){return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});window.ownerTestRpc(JSON.stringify({id:next,request}));});}};}`});
  assert.equal((await fetch(server.url,{signal:AbortSignal.timeout(5000)})).status,200);
  await call('Page.navigate',{url:server.url});await until("document.getElementById('status')?.textContent.includes('Connect your owner wallet')");assert.equal(sent.length,0);
  await click('connect');await until("document.getElementById('wallet-status').textContent.includes('Select the administrator')");assert.equal(await evaluate("document.getElementById('prepare').disabled"),true);
  selected=owner;await click('connect');await until("!document.getElementById('prepare').disabled");
  await click('prepare');await until("!document.getElementById('deploy').disabled");
  const apiState=await(await fetch(`${server.url}/api/state`)).json();
  const forbidden=await fetch(`${server.url}/api/action`,{method:'POST',headers:{origin:'https://example.com','content-type':'application/json','x-forge-nonce':apiState.csrf},body:JSON.stringify({operation:'prepare',revision:apiState.state.revision})});assert.equal(forbidden.status,403);
  const output=new URL('../docs/review/2026-09-12/owner-wallet/',import.meta.url);await mkdir(output,{recursive:true});
  for(const width of [1440,390,375]){await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`review-${width}.png`,output),Buffer.from(shot.data,'base64'));}
  await click('deploy');await until("document.getElementById('status').textContent.includes('TEST_WALLET_HASH_RESPONSE_LOST')");
  assert.equal(sent.length,1);assert.equal(session.snapshot().steps[0].status,'WALLET_REQUESTED');
  assert.equal(await evaluate("document.getElementById('deploy').disabled"),true);
  const oldPort=Number(new URL(server.url).port);await server.close();session.close();session=openOwnerDeploymentSession(settings);
  server=await startOwnerDeploymentServer({...serverSettings,session,port:oldPort});await call('Page.reload');await until("document.getElementById('deploy-status').textContent.includes('Wallet requested')");
  assert.equal(sent.length,1);assert.equal(await evaluate("document.getElementById('deploy').disabled"),true);
  await click('recheck');await until("document.getElementById('status').textContent.includes('no saved transaction hash')");
  assert.equal(sent.length,1);
  await evaluate(`document.getElementById('recover-hash').value=${JSON.stringify(sent[0])}`);await click('recover');await until("document.getElementById('deploy-status').textContent.includes('Receipt verified')");
  await click('connect');await until("!document.getElementById('prepare-acceptance').disabled");
  // A separate disposable transaction changes the owner nonce before acceptance.
  await client.waitForTransactionReceipt({hash:await wallet.sendTransaction({to:owner,value:0n,chain:null})});
  await click('prepare-acceptance');await until("!document.getElementById('accept').disabled");
  const continued=session.snapshot();assert.ok(BigInt(continued.steps[1].review.transaction.nonce)>BigInt(continued.packet.plan.transactions[1].nonce));
  // Lose the hash report before HTTP delivery, then fail its RPC verification.
  // The browser cache recovers the first loss; the journal survives the second.
  await evaluate("{const original=window.fetch;let drop=true;window.fetch=(url,init)=>{if(drop&&String(url)==='/api/action'&&JSON.parse(init.body).operation==='recover'){drop=false;return Promise.reject(Error('TEST_HASH_REPORT_OFFLINE'));}return original(url,init);};}");
  await click('accept');await until("document.getElementById('status').textContent.includes('TEST_HASH_REPORT_OFFLINE')");assert.equal(sent.length,2);
  assert.equal(session.snapshot().steps[1].reportedTransactionHash,null);
  await click('recheck');await until("document.getElementById('status').textContent.includes('An RPC read failed')");
  assert.equal(session.snapshot().steps[1].reportedTransactionHash,sent[1]);assert.equal(session.snapshot().steps[1].transactionHash,null);
  assert.equal(session.snapshot().verification.status,'UNAVAILABLE');assert.equal(session.snapshot().evidence,null);
  assert.equal(await evaluate("document.getElementById('accept').disabled"),true);
  await evaluate("document.getElementById('accept-status').scrollIntoView({block:'start'})");
  const recoveryShot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(new URL('recovery-pending-375.png',output),Buffer.from(recoveryShot.data,'base64'));
  await server.close();session.close();session=openOwnerDeploymentSession(settings);
  server=await startOwnerDeploymentServer({...serverSettings,session,port:oldPort});await call('Page.reload');
  await until("document.getElementById('accept-status').textContent.includes('Reported transaction hash saved')");
  assert.equal(sent.length,2);unavailableHash=null;
  await click('recheck');await until("document.getElementById('finality').textContent.includes('Disposable deployment verified')");
  assert.equal(session.snapshot().evidence.status,'VERIFIED_PAUSED_FORGE');assert.equal(session.snapshot().evidence.localFixture,true);assert.equal(session.snapshot().candidates,null);
  unavailableHash=sent[1];await click('recheck');await until("document.getElementById('status').textContent.includes('An RPC read failed')");
  assert.equal(session.snapshot().evidence,null);assert.equal(session.snapshot().candidates,null);
  unavailableHash=null;await click('recheck');await until("document.getElementById('finality').textContent.includes('Disposable deployment verified')");
  await call('Page.reload');await until("document.getElementById('accept-status').textContent.includes('Receipt verified')");assert.equal(sent.length,2);assert.deepEqual(errors,[]);
  const evidence={status:'PASS',environment:'NEW_DISPOSABLE_ANVIL_AND_BROWSER',wrongOwnerBlocked:true,explicitWalletButtons:true,committedClaimBeforeWallet:true,
    lostWalletHashRecovered:true,serverRestartRecovered:true,reloadDoesNotResend:true,nonceChangedBeforeAcceptance:true,
    lostHashReportRecoveredOnRecheck:true,rpcFailureHashPersisted:true,pendingHashRecoveredAfterRestart:true,
    missingHashNotReportedAsFinality:true,failedRefreshClearsVerifiedEvidence:true,
    bothTransactionsVerified:true,registryStillPaused:true,publicManifestsNotCreated:true,widths:[1440,390,375],walletRequests:sent.length,publicTransactions:0,browserErrors:errors};
  await writeFile(new URL('browser-checks.json',output),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{ws?.close();chrome?.kill('SIGTERM');if(server)await server.close();session?.close();anvil.kill('SIGTERM');
  if(chrome&&chrome.exitCode===null)await new Promise(r=>{const timer=setTimeout(r,3000);chrome.once('exit',()=>{clearTimeout(timer);r();});});await rm(dir,{recursive:true,force:true,maxRetries:3});}
