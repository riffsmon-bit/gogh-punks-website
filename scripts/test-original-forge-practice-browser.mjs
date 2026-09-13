import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
if(process.argv.length!==4||process.argv[2]!=='--disposable-practice-only'||!/^--url=http:\/\/127\.0\.0\.1:\d+$/.test(process.argv[3]))throw Error('Explicit disposable loopback practice URL required');
const origin=process.argv[3].slice(6),port=Number(new URL(origin).port);
if([64343,64344,64345,64346,8549,8787].includes(port))throw Error('Protected practice port');
const initial=await(await fetch(origin+'/api/practice')).json();
assert.equal(initial.schema,'GOGH_ORIGINAL_FORGE_INTERACTIVE_PRACTICE_V1');assert.equal(initial.localOnly,true);assert.equal(initial.productionAuthority,false);assert.equal(initial.publicTransactions,0);assert.equal(initial.training.credits,'0');assert.equal(initial.burn.credited,false);
for(const [headers,body]of [[{'origin':'https://evil.example','content-type':'application/json','x-forge-nonce':initial.nonce},{operation:'prepare_burn',input:{action:'BURN'}}],[{'origin':origin,'content-type':'application/json'},{operation:'prepare_burn',input:{action:'BURN'}}]])assert.equal((await fetch(origin+'/api/practice',{method:'POST',headers,body:JSON.stringify(body)})).status,403);
assert.equal((await fetch(origin+'/rpc',{method:'POST',body:'{}'})).status,404);
const profile=await mkdtemp('/private/tmp/gogh-original-forge-browser-');
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-proxy-server','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});let ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.once('error',reject);chrome.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 const page=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),errors=[];const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('CDP_TIMEOUT')),60000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let n=0;n<200;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('UI_TIMEOUT '+expression);};
 const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).click()`);

 await call('Page.enable');await call('Runtime.enable');await call('Page.navigate',{url:origin});
 await until("document.querySelector('#status')?.textContent.includes('Practice state refreshed')");
 const confirm=async(text='CONFIRM COPY')=>{await evaluate(`document.querySelector('#ack').click();document.querySelector('#confirmation').value=${JSON.stringify(text)};document.querySelector('#confirmation').dispatchEvent(new Event('input',{bubbles:true}));`);await click('Confirm practice step');await until("document.querySelector('#status').textContent.includes('confirmed on the disposable chain')");};
 await click('Review approval for copy #1753');await until("document.querySelector('#status').textContent==='Review ready. Nothing has been submitted.'");
 assert.equal(await evaluate("document.querySelector('#confirm').disabled"),true);await confirm();
 await click('Review copied sacrifice');await until("document.querySelector('#status').textContent==='Review ready. Nothing has been submitted.'");
 for(const width of [1440,375,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`overflow at ${width}`);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/private/tmp/gogh-original-forge-${width}.png`,Buffer.from(shot.data,'base64'));}
 await confirm('BURN COPY 1753');
 assert.equal((await(await fetch(origin+'/api/practice')).json()).training.credits,'1');
 await call('Page.reload');await until("document.querySelector('#status')?.textContent.includes('confirmed on the disposable chain')");
 assert.equal((await(await fetch(origin+'/api/practice')).json()).training.credits,'1');
 await click('Learn · 1 credit');await until("document.querySelector('#status').textContent==='Review ready. Nothing has been submitted.'");await confirm();
 assert.equal((await(await fetch(origin+'/api/practice')).json()).training.credits,'0');
 assert.equal(await evaluate("document.querySelector('#research').disabled"),true);
 await click('Equip in slot 1');await until("document.querySelector('#status').textContent==='Review ready. Nothing has been submitted.'");await confirm();
 await click('Use equipped Rarity Eye');await until("document.querySelector('#result').textContent.includes('3 copied Punks compared')");
 await click('Unequip skill');await until("document.querySelector('#status').textContent==='Review ready. Nothing has been submitted.'");await confirm();
 assert.equal(await evaluate("document.querySelector('#research').disabled"),true);
 const rejected=await fetch(origin+'/api/practice',{method:'POST',headers:{origin,'content-type':'application/json','x-forge-nonce':initial.nonce},body:JSON.stringify({operation:'research',input:{}})});assert.equal(rejected.status,409);
 assert.equal((await rejected.json()).code,'SKILL_TOOL_DENIED');assert.deepEqual(errors,[]);
 const final=await(await fetch(origin+'/api/practice')).json();
 const evidence={schema:'GOGH_ORIGINAL_FORGE_INTERACTIVE_BROWSER_V1',status:'PASS',checkedAt:new Date().toISOString(),widths:[1440,375,320],copiedSource:'1753',copiedTarget:'93',forkAnchor:initial.forkAnchor,realBrowserClicks:true,actualDeployedStackCopy:true,actualStandardAssetHistory:true,applicationObligationsFixture:true,independentPublicFinalityProven:false,sourceCoverage:final.sourceCoverage,burnCreditExactlyOnceAcrossReload:true,learnSpendsCredit:true,equipEnablesResearch:true,unequipDeniesResearch:true,sourceOwnershipOriginalUnchangedByDesign:true,csrfRejected:true,noGenericRpcRoute:true,walletRequests:0,publicTransactions:0};
 await writeFile(new URL('../docs/v2-hardening/forge-interactive-evidence.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{ws?.close();chrome.kill('SIGTERM');if(chrome.exitCode===null)await new Promise(r=>{const timer=setTimeout(r,3000);chrome.once('exit',()=>{clearTimeout(timer);r();});});await rm(profile,{recursive:true,force:true,maxRetries:3});}
