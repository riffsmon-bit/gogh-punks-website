import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
if(process.argv.length!==3||process.argv[2]!=='--mock-wallet-only')throw Error('Requires --mock-wallet-only');
const root=fileURLToPath(new URL('../site/',import.meta.url));
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/broker-v2.css"><style>body{margin:16px;background:#0c1118;color:white;font:16px sans-serif}.directed-paid-panel{max-width:750px;margin:auto}button{min-height:44px;padding:10px}</style><main class="directed-paid-panel"></main><script type="module">
import {createDirectedPaidPanel} from '/directed-paid-panel.js';import {paidOwnerCalldata} from '/directed-paid-wallet.js';import {PAID_RELEASE as r} from '/directed-paid-release.js';
const selected={owner:r.owner,tokenId:'93',chainId:4663,preview:false},hash='0x'+'c'.repeat(64);
const load=()=>JSON.parse(localStorage.getItem('mock.server')||'null')??{record:null,state:{missionStatus:0,refundWei:'0'}};
const save=s=>localStorage.setItem('mock.server',JSON.stringify(s));
const payload=s=>({ok:true,mode:'SELECTED_DIRECTED_PAID_MINT',owner:r.owner,tokenId:'93',chainId:4663,...s});
const request=async(_path,options)=>{const s=load();if(!options?.body)return payload(s);const b=JSON.parse(options.body);
 if(b.operation==='prepare'){const review={schema:'GOGH_DIRECTED_PAID_REVIEW_V1',intentId:'a'.repeat(64),action:'AUTHORIZE',owner:r.owner,tokenId:'93',
 targetCollection:r.targetCollection,recipient:r.recipient,vault:r.vault,expectedGeneration:'0',quantity:1,priceWei:'100000000000000',maximumPriceWei:'100000000000000',executionFeeWei:'20000000000000',deadline:String(Math.floor(Date.now()/1000)+540),anchor:{timestamp:String(Math.floor(Date.now()/1000))},expiresAt:Date.now()+90000,maximumNetworkFeeWei:'20000000'};
 review.transaction={from:r.owner,to:r.factory,data:paidOwnerCalldata(review),chainId:'0x1237',type:'0x0',value:'0x'+(BigInt(review.priceWei)+BigInt(review.executionFeeWei)).toString(16),nonce:'0x0',gas:'0x1e8480',gasPrice:'0xa'};
 s.record={review,reviewHash:'b'.repeat(64),status:'PREPARED',revision:0,reportedHash:null,receipt:null};save(s);return payload(s);}
 if(b.operation==='claim'){if(s.record.status!=='PREPARED')throw Error('BAD_CLAIM');s.record.status='WALLET_REQUESTED';s.record.revision++;save(s);return payload({...s,transaction:s.record.review.transaction});}
 if(b.operation==='decline'){if(b.rejectionCode!==4001||s.record.reportedHash)throw Error('BAD_DECLINE');if(!localStorage.getItem('mock.declineFailed')){localStorage.setItem('mock.declineFailed','true');throw Error('Simulated decline read interruption.');}s.record.status='DECLINED';s.record.revision++;save(s);return payload(s);}
 if(b.operation==='recover'){if(JSON.parse(localStorage.getItem('gogh-directed-paid-v1:'+s.record.review.intentId)).hash!==hash)throw Error('HASH_NOT_PERSISTED');
 if(!localStorage.getItem('mock.failed')){localStorage.setItem('mock.failed','true');throw Error('Simulated provider interruption. Recheck the original transaction.');}
 s.record.status='CONFIRMED';s.record.reportedHash=hash;s.record.revision++;s.state.missionStatus=2;
 s.execution={intent_id:s.record.review.intentId,status:'COMPLETED',transaction_hash:hash,receipt:{tokenId:'1481'}};save(s);return payload(s);}
 throw Error('UNEXPECTED_API');};
window.__testPanel=createDirectedPaidPanel({root:document.querySelector('main'),getSelection:()=>selected,ensureSession:async()=>{},request,
 getProvider:()=>({request:async({method})=>{if(method==='eth_chainId')return '0x1237';if(method==='eth_accounts')return [r.owner];if(method==='eth_sendTransaction'){if(localStorage.getItem('mock.reject'))throw Object.assign(Error('Wallet rejected'),{code:4001});localStorage.setItem('mock.sends',String(Number(localStorage.getItem('mock.sends')||'0')+1));return hash;}throw Error('UNEXPECTED_WALLET_METHOD');}})});
</script>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
if(!/^\/[a-z0-9-]+\.(js|css)$/.test(req.url)){res.writeHead(404);res.end();return;}
res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(root+req.url.slice(1)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp('/private/tmp/gogh-paid-browser-');
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-proxy-server','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});let ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.once('error',reject);chrome.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 const page=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),errors=[];const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('CDP_TIMEOUT')),30000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('UI_TIMEOUT '+expression+' '+JSON.stringify(errors));};
 const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).click()`);
 await call('Page.enable');await call('Runtime.enable');await call('Page.navigate',{url:origin});
 await until("document.querySelector('button')?.textContent==='RECHECK PAID MINT'");
 await evaluate("window.__testPanel.openDraft({collection:'0xb73f1d1aee57410d537d87b656e98b9d3df5b213',quantity:1,maximumPriceWei:'100000000000000'})");
 await until("document.body.textContent.includes('REVIEW ONE MINT')");
 assert.ok(await evaluate("document.body.textContent.includes('Total escrow: 0.00012 ETH')"));
 for(const width of [1440,375,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`overflow at ${width}`);
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/gogh-directed-paid-${width}.png`,Buffer.from(shot.data,'base64'));}
 await click('CONFIRM MINT BUDGET IN WALLET');await until("document.body.textContent.includes('Simulated provider interruption')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),'1');
 await call('Page.reload');await until("document.querySelector('button')?.textContent==='RECHECK PAID MINT'");await click('RECHECK PAID MINT');
 await until("document.body.textContent.includes('Mint complete.')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),'1');assert.deepEqual(errors,[]);
 await evaluate("localStorage.clear();localStorage.setItem('mock.reject','true')");await call('Page.reload');
 await until("document.querySelector('button')?.textContent==='RECHECK PAID MINT'");await click('REVIEW ONE PEPPIES WORLD MINT');await until("document.body.textContent.includes('REVIEW ONE MINT')");
 await click('CONFIRM MINT BUDGET IN WALLET');await until("document.body.textContent.includes('Simulated decline read interruption')");
 await call('Page.reload');await until("document.querySelector('button')?.textContent==='RECHECK PAID MINT'");await click('RECHECK PAID MINT');
 await until("document.body.textContent.includes('Wallet confirmation declined')");assert.equal(await evaluate("localStorage.getItem('mock.sends')"),null);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',widths:[1440,375,320],chatDraftOpensQuote:true,explicitRejectionSurvivesFailedReadAndReload:true,lostReadThenReloadRecovery:true,mockWalletSends:1,publicTransactions:0}));
}finally{ws?.close();chrome.kill('SIGTERM');if(chrome.exitCode===null)await new Promise(r=>{const timer=setTimeout(r,3000);chrome.once('exit',()=>{clearTimeout(timer);r();});});await rm(profile,{recursive:true,force:true,maxRetries:3});await new Promise(r=>server.close(r));}
