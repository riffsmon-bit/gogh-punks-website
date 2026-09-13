import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
if(process.argv.length!==3||process.argv[2]!=='--mock-wallet-only')throw Error('Requires --mock-wallet-only');
const root=fileURLToPath(new URL('../site/',import.meta.url));
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/broker-v2-forge.css"><style>body{margin:16px;background:#0c1118;color:white;font:16px sans-serif}.forge-locked{max-width:750px;margin:auto;padding:20px}button{min-height:44px;margin:5px;padding:10px}p{line-height:1.5}</style><main class="forge-locked" data-forge-selected-burn></main><script type="module">
import {createSelectedBurnPanel} from '/forge-selected-burn-panel.js';import {encodeReviewedBurnCall} from '/forge-burn-calldata.js';import {TRAINING_RELEASE as release} from '/forge-training-release.js';
const owner='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6',selected={owner,tokenId:'93',chainId:4663,preview:false},hash='0x'+'c'.repeat(64);
const load=()=>JSON.parse(localStorage.getItem('mock.server')||'null')??{record:null,state:{paused:false,approved:release.trainingSource,credited:false,credits:'0'}};
const save=s=>localStorage.setItem('mock.server',JSON.stringify(s));
const payload=s=>({ok:true,mode:'SELECTED_OWNER_BURN',owner,chainId:4663,sourceTokenId:'1753',targetTokenId:'93',...s});
const request=async(_path,options)=>{const s=load();if(!options?.body)return payload(s);const b=JSON.parse(options.body);
 if(b.operation==='prepare'){const expiresAt=Math.floor(Date.now()/1000)*1000+60000,burn={sourceTokenId:'1753',targetTokenId:'93',nonce:'0',stateHash:'0x'+'d'.repeat(64),deadline:String(expiresAt/1000)};
 s.record={review:{intentId:'a'.repeat(64),action:'BURN',state:{owner,sourceTokenId:'1753',targetTokenId:'93'},burn,expiresAt,maximumNetworkFeeWei:'1000000',transaction:{from:owner,to:release.trainingSource,data:encodeReviewedBurnCall(burn),chainId:'0x1237',value:'0x0',nonce:'0x0',gas:'0x186a0',gasPrice:'0xa'}},reviewHash:'b'.repeat(64),status:'PREPARED',revision:0,reportedHash:null,receipt:null};save(s);return payload(s);}
 if(b.operation==='claim'){if(b.confirmation!=='BURN 1753'||!b.obligationsReviewed||s.record.status!=='PREPARED')throw Error('BAD_CLAIM');s.record.status='WALLET_REQUESTED';s.record.revision++;save(s);return payload({...s,transaction:s.record.review.transaction});}
 if(b.operation==='decline'){if(b.rejectionCode!==4001||s.record.reportedHash)throw Error('BAD_DECLINE');if(!localStorage.getItem('mock.declineFailed')){localStorage.setItem('mock.declineFailed','true');throw Error('Simulated decline read interruption.');}s.record.status='DECLINED';s.record.revision++;save(s);return payload(s);}
 if(b.operation==='recover'){if(JSON.parse(localStorage.getItem('gogh-selected-burn-v1:'+s.record.review.intentId)).hash!==hash)throw Error('HASH_NOT_PERSISTED');
 if(!localStorage.getItem('mock.failed')){localStorage.setItem('mock.failed','true');throw Error('Simulated provider interruption. Recheck the original transaction.');}
 s.record.status='CONFIRMED';s.record.reportedHash=hash;s.record.revision++;s.state.credited=true;s.state.credits='1';save(s);return payload(s);}
 throw Error('UNEXPECTED_API');};
window.__testPanel=createSelectedBurnPanel({root:document.querySelector('main'),getSelection:()=>selected,ensureSession:async()=>{},request,
 getProvider:()=>({request:async({method})=>{if(method==='eth_chainId')return '0x1237';if(method==='eth_accounts')return [owner];if(method==='eth_sendTransaction'){if(localStorage.getItem('mock.reject'))throw Object.assign(Error('Wallet rejected'),{code:4001});localStorage.setItem('mock.sends',String(Number(localStorage.getItem('mock.sends')||'0')+1));return hash;}throw Error('UNEXPECTED_WALLET_METHOD');}})});
</script>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
if(!/^\/[a-z0-9-]+\.(js|css)$/.test(req.url)){res.writeHead(404);res.end();return;}
res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(root+req.url.slice(1)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp('/private/tmp/gogh-burn-browser-');
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-proxy-server','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});let ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.once('error',reject);chrome.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 const page=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),errors=[];const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('CDP_TIMEOUT')),30000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('UI_TIMEOUT '+expression);};
 const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).click()`);
 await call('Page.enable');await call('Runtime.enable');await call('Page.navigate',{url:origin});
 await until("document.querySelector('button')?.textContent==='RECHECK SELECTED TEST'");await click('RECHECK SELECTED TEST');
 await until("document.body.textContent.includes('REVIEW BURN #1753')");await click('REVIEW BURN #1753 → CREDIT #93');
 await until("document.body.textContent.includes('CONFIRM THE PERMANENT BURN')");
 await evaluate("document.querySelector('input[type=checkbox]').click();Array.from(document.querySelectorAll('input')).find(i=>i.type!=='checkbox').value='BURN 1753'");
 for(const width of [1440,375,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`overflow at ${width}`);
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/gogh-selected-burn-${width}.png`,Buffer.from(shot.data,'base64'));}
 await click('CONFIRM IN WALLET');await until("document.body.textContent.includes('Simulated provider interruption')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),'1');
 await call('Page.reload');await until("document.querySelector('button')?.textContent==='RECHECK SELECTED TEST'");await click('RECHECK SELECTED TEST');
 await until("document.body.textContent.includes('Burn confirmed')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),'1');assert.deepEqual(errors,[]);
 await evaluate("localStorage.clear();localStorage.setItem('mock.reject','true')");await call('Page.reload');
 await until("document.querySelector('button')?.textContent==='RECHECK SELECTED TEST'");await click('RECHECK SELECTED TEST');await until("document.body.textContent.includes('REVIEW BURN #1753')");await click('REVIEW BURN #1753 → CREDIT #93');await until("document.body.textContent.includes('CONFIRM THE PERMANENT BURN')");
 await evaluate("document.querySelector('input[type=checkbox]').click();Array.from(document.querySelectorAll('input')).find(i=>i.type!=='checkbox').value='BURN 1753'");await click('CONFIRM IN WALLET');
 await until("document.body.textContent.includes('Simulated decline read interruption')");await call('Page.reload');await until("document.querySelector('button')?.textContent==='RECHECK SELECTED TEST'");await click('RECHECK SELECTED TEST');
 await until("document.body.textContent.includes('Wallet confirmation declined')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),null);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',explicitRejectionSurvivesFailedReadAndReload:true,widths:[1440,375,320],lostReadThenReloadRecovery:true,mockWalletSends:1,publicTransactions:0}));
}finally{ws?.close();chrome.kill('SIGTERM');if(chrome.exitCode===null)await new Promise(r=>{const timer=setTimeout(r,3000);chrome.once('exit',()=>{clearTimeout(timer);r();});});await rm(profile,{recursive:true,force:true,maxRetries:3});await new Promise(r=>server.close(r));}
