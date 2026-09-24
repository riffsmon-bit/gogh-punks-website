// Local-only real-browser UX journey. All wallet/client operations use explicit fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length,2,'This harness accepts no remote URL or wallet configuration.');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp('/private/tmp/gogh-swarm-wallet-browser-'),profile=await mkdtemp('/private/tmp/gogh-swarm-wallet-profile-');
const result={status:'RUNNING',mode:'LOCAL_BROWSER_WITH_WALLET_FIXTURE',output,viewports:[],errors:[],screenshots:[]};
const fixture=`import {mountSwarmWallet} from '/swarm-wallet-panel.js';
const owner='0x'+'1'.repeat(40),vault='0x'+'2'.repeat(40),provider={request(){throw Error('No real wallet allowed');}};
let record=null,created=false,balance=0n,sends=0,punks=[{tokenId:'93'},{tokenId:'94'}],readError=null,hold=null,finish=null;
const pause=async kind=>{if(hold===kind)await new Promise(resolve=>{finish=resolve;});};
const client={getSwarmWalletRecord:()=>record,
 readSwarmWallet:async()=>{await pause('read');if(readError)throw Object.assign(Error('PRIVATE_RPC_MESSAGE'),{code:readError});return{created,vault,balanceWei:String(balance),dependenciesVerified:true};},
 prepareSwarmWallet:async(_provider,{action})=>{await pause('prepare');return{owner,vault,action,expiresAt:Date.now()+90000,maximumNetworkFeeWei:'5000000000000',
  allocations:action.allocations?.map(a=>({...a,account:'0x'+a.tokenId.padStart(40,'0')}))};},
 submitSwarmWallet:async(_provider,review,{isCurrent})=>{if(!isCurrent())throw Error('Stale wallet');sends++;return record={status:'SUBMITTED',transactionHash:'0x'+String(sends).padStart(64,'0'),review};},
 recoverSwarmWallet:async()=>{const a=record.review.action;if(a.kind==='CREATE')created=true;
  if(a.kind==='DEPOSIT')balance+=BigInt(a.amountWei);if(a.kind==='WITHDRAW')balance-=BigInt(a.amountWei);
  if(a.kind==='BATCH')balance-=a.allocations.reduce((n,a)=>n+BigInt(a.amountWei),0n);
  return record={...record,status:'CONFIRMED'};}};
const controller=mountSwarmWallet({root:document.querySelector('main'),getContext:()=>({owner,chainId:4663}),
 getPunks:()=>punks,getProvider:()=>provider,release:{status:'LIVE'},client,storage:{},locks:{}});
window.fixture={get sends(){return sends;},get balance(){return String(balance);},refresh:()=>controller.refresh(),failRead:code=>{readError=code;},hold:kind=>{hold=kind;},get waiting(){return !!finish;},release:()=>{const resolve=finish;hold=null;finish=null;resolve?.();},roster:ids=>{punks=ids.map(tokenId=>({tokenId}));controller.refresh();}};`;
const server=createServer(async(req,res)=>{
  try {
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/broker-v2.css"></head><body><main></main><script type="module" src="/fixture.js"></script></body></html>');return;}
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    // Serve only local site JavaScript modules and the actual product CSS.
    if(!/^\/[a-z0-9/_.-]+\.(js|css)$/.test(req.url)||req.url.includes('..')){res.writeHead(404);res.end();return;}
    const file=resolve(root,'site','.'+req.url);assert.ok(file.startsWith(resolve(root,'site')+'/'));
    res.setHeader('content-type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--disk-cache-size=1','--media-cache-size=1',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
const exited=new Promise(r=>chrome.once('exit',r));let ws;
try {
  const endpoint=await new Promise((r,j)=>{let text='';const timer=setTimeout(()=>j(Error('CHROME_START_TIMEOUT')),20000);
    chrome.once('error',e=>{clearTimeout(timer);j(e);});chrome.stderr.on('data',v=>{text+=v;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);r(m[1]);}});});
  const target=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map();
  const call=(method,params={})=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);j(Error(method+' timeout'));},15000);
    pending.set(n,{r:v=>{clearTimeout(t);r(v);},j:e=>{clearTimeout(t);j(e);}});ws.send(JSON.stringify({id:n,method,params}));});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result);}
    if(m.method==='Runtime.exceptionThrown')result.errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')result.errors.push(m.params.args.map(a=>a.value??a.description).join(' '));
    if(m.method==='Fetch.requestPaused'){const p=m.params;if(p.request.url.startsWith(origin+'/'))void call('Fetch.continueRequest',{requestId:p.requestId});
      else {result.errors.push('External request blocked: '+new URL(p.request.url).origin);void call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});}}};
  for(const method of ['Runtime.enable','Page.enable'])await call(method);
  await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  const evaluate=async expression=>{const v=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.exception?.description??v.exceptionDetails.text);return v.result.value;};
  const until=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const find=n=>`document.querySelector('[data-swarm-wallet-${n}]')`;
  const click=async n=>{assert.equal(await evaluate(find(n)+'.disabled'),false,n+' enabled');await evaluate(find(n)+'.click()');};
  const fill=async(n,value)=>evaluate(`${find(n)}.value=${JSON.stringify(value)};${find(n)}.dispatchEvent(new Event('input',{bubbles:true}));`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name),Buffer.from(s.data,'base64'));result.screenshots.push(name);};
  const approve=async()=>{const before=await evaluate('fixture.sends');assert.equal(await evaluate(find('confirm')+'.disabled'),true);
    await evaluate(find('consent')+'.click()');await click('confirm');await until('fixture.sends==='+String(before+1));
    assert.equal(await evaluate(find('batch')+'.disabled'),true);await click('recover');await until(find('status')+'.textContent.includes("Transaction confirmed")');};
  for(const [width,height] of [[1440,1000],[375,812],[320,740]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url:origin});await until('Boolean(window.fixture)');
    assert.equal(await evaluate('fixture.sends'),0);
    await evaluate("fixture.failRead('SWARM_WALLET_STALE_CHAIN')");await click('check');
    await until(find('status')+'.textContent.includes("STALE_CHAIN")');
    assert.doesNotMatch(await evaluate(find('status')+'.textContent'),/PRIVATE_RPC_MESSAGE/);
    await evaluate("fixture.failRead(null);fixture.hold('read')");await click('check');await until('fixture.waiting');
    await evaluate("fixture.roster(['93','94','95']);fixture.release()");await until('!'+find('create')+'.hidden');
    await evaluate("fixture.hold('prepare')");await click('create');await until('fixture.waiting');
    await evaluate("fixture.roster(['93','94']);fixture.release()");await until('!'+find('review')+'.hidden');
    assert.equal(await evaluate('fixture.sends'),0);
    assert.match(await evaluate(find('confirm-status')+'.textContent'),/confirmation box/);
    await shot(`creation-review-${width}.png`);await approve();
    await fill('deposit-amount','0.003');await click('deposit');await until('!'+find('review')+'.hidden');await approve();
    await evaluate(`${find('punks')}.querySelectorAll('input').forEach(n=>n.click())`);await fill('batch-amount','0.002');
    await click('batch');await until('!'+find('review')+'.hidden');assert.match(await evaluate(find('details')+'.textContent'),/Punk #930.001 ETH/);
    assert.match(await evaluate(find('details')+'.textContent'),/Punk #940.001 ETH/);
    await evaluate('fixture.refresh()');assert.equal(await evaluate(find('batch-amount')+'.value'),'0.002');
    await shot(`batch-review-${width}.png`);await approve();assert.equal(await evaluate('fixture.balance'),'1000000000000000');
    await fill('withdraw-amount','0.001');await click('withdraw');await until('!'+find('review')+'.hidden');await shot(`withdraw-review-${width}.png`);await approve();
    assert.equal(await evaluate('fixture.balance'),'0');assert.equal(await evaluate('fixture.sends'),4);
    const overflow=await evaluate('document.documentElement.scrollWidth>innerWidth');assert.equal(overflow,false,'no horizontal overflow');
    await shot(`completed-${width}.png`);result.viewports.push({width,height,create:true,deposit:true,batch:true,withdraw:true,rosterDuringCreation:true,chainErrorFeedback:true,confirmations:4,overflow});
  }
  assert.deepEqual(result.errors,[]);result.status='PASS';
} catch(error){result.status='FAIL';result.failure=error.stack;process.exitCode=1;}
finally {await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));ws?.close();chrome.kill('SIGTERM');await exited;await rm(profile,{recursive:true,force:true});await new Promise(r=>server.close(r));console.log(JSON.stringify(result,null,2));}
