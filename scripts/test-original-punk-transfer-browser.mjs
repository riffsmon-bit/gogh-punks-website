// Full V2 page, isolated headless Chrome, local fixture RPC only. No wallet profile or keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { decodeFunctionData, encodeAbiParameters, parseAbi } from 'viem';
if(process.argv.length!==3 || process.argv[2]!=='--local-only') throw Error('Requires --local-only');
const ALICE=`0x${'1'.repeat(40)}`, BOB=`0x${'2'.repeat(40)}`;
const COLLECTION='0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const root=resolve(fileURLToPath(new URL('../site/',import.meta.url)));
const ownership=new Map([['93',ALICE],['119',BOB]]);
const aggregate=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[])']);
const word=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
let walletWrites=0;
const server=createServer(async(req,res)=>{
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture-rpc' && req.method==='POST') {
      let body=''; for await(const chunk of req) body+=chunk;
      const {method,params}=JSON.parse(body);
      if(method==='eth_blockNumber') return json('0xabc');
      if(method==='eth_chainId') return json('0x1237');
      if(method==='eth_getBalance') return json('0x0');
      if(method==='eth_call') {
        const call=params[0], data=call.data;
        if(call.to.toLowerCase()===COLLECTION && data.startsWith('0x70a08231')) {
          const owner=`0x${data.slice(-40)}`.toLowerCase();
          return json(word([...ownership.values()].filter(v=>v===owner).length));
        }
        if(data.startsWith('0x82ad56cb')) {
          const {args:[calls]}=decodeFunctionData({abi:aggregate,data});
          const values=calls.map(call=>{
            const id=String(BigInt(`0x${call.callData.slice(-64)}`));
            const owner=ownership.get(id)??BOB;
            return {success:true,returnData:`0x${owner.slice(2).padStart(64,'0')}`};
          });
          return json(encodeAbiParameters([{type:'tuple[]',components:[{name:'success',type:'bool'},{name:'returnData',type:'bytes'}]}],[values]));
        }
        return json(word(0));
      }
      walletWrites++; res.statusCode=400; return json({error:'NO_WALLET_WRITES_ALLOWED'});
    }
    if(url.pathname==='/api/broker/owner-punks') return json({ok:true,owner:url.searchParams.get('owner'),
      chainId:4663,collection:COLLECTION,candidateTokenIds:['93','119'],
      candidatePunks:[{tokenId:'93'},{tokenId:'119'}]});
    if(url.pathname.startsWith('/api/')) { res.statusCode=503; return json({ok:false,code:'LOCAL_READ_FIXTURE_ONLY'}); }
    // Do not load wallet SDKs or connect to external providers in this test.
    if(url.pathname==='/wallet.js') {res.setHeader('Content-Type','text/javascript');return res.end('export {};');}
    const path=resolve(root,`.${url.pathname.endsWith('/')?`${url.pathname}index.html`:url.pathname}`);
    if(!path.startsWith(`${root}/`)) {res.statusCode=403;return res.end();}
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'}[extname(path)];
    if(type) res.setHeader('Content-Type',type);
    res.end(await readFile(path));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
let chrome,ws;
try {
  const profile=await mkdtemp(join(tmpdir(),'gogh-original-sale-chrome-'));
  chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run',
    '--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let output=''; const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),15000);
    chrome.once('error',error=>{clearTimeout(timeout);reject(error);});
    chrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  const host=new URL(endpoint).host;
  const page=await(await fetch(`http://${host}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);
    const task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error(`DOM_TIMEOUT ${expression}`);};
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.testClock=0; const realNow=Date.now.bind(Date); Date.now=()=>realNow()+testClock;
    window.__GOGH_WALLET_PROVIDER__={request:async args=>{
      const r=await fetch('/fixture-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
      if(!r.ok)throw Error('LOCAL_RPC_ONLY');return r.json();}};
  `});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${url}/broker/v2/`});
  await until("document.querySelector('[data-punk-roster]') && document.readyState === 'complete'");
  await evaluate(`window.dispatchEvent(new CustomEvent('gogh:wallet-state',{detail:{account:'${ALICE}',chainId:4663,status:'owner'}}))`);
  await until("document.querySelector('[data-punk-token]').textContent === '93' && !document.querySelector('[data-selected-stage]').hidden");
  assert.equal(await evaluate("document.querySelectorAll('[data-epoch-control]').length"),0);
  await evaluate("document.querySelector('[data-confirmation-dialog]').showModal();document.querySelector('[data-conversation]').textContent='STALE SOLD PUNK REVIEW';");
  ownership.set('93',BOB); ownership.set('119',ALICE);
  // Same connected wallet; no reconnect, claim or NFT registration.
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("document.querySelector('[data-punk-token]').textContent === '119'");
  assert.equal(await evaluate("document.querySelector('[data-confirmation-dialog]').open"),false);
  assert.equal(await evaluate("document.querySelector('[data-conversation]').textContent.includes('STALE SOLD PUNK')"),false);
  assert.match(await evaluate("document.querySelector('[data-ownership-sync]').textContent"),/automatically/);
  // Buyer connects and receives the original Punk without a receipt or setup action.
  await evaluate(`window.dispatchEvent(new CustomEvent('gogh:wallet-state',{detail:{account:'${BOB}',chainId:4663,status:'owner'}}))`);
  await until("document.querySelector('[data-punk-token]').textContent === '93'");
  await evaluate("window.lastPunk='93';window.addEventListener('gogh:punk-selected',event=>{window.lastPunk=event.detail.tokenId;});");
  ownership.set('93',ALICE);
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("document.querySelector('[data-selected-stage]').hidden && window.lastPunk === null");
  ownership.set('93',BOB);
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("!document.querySelector('[data-selected-stage]').hidden && window.lastPunk === '93'");
  const output=await mkdtemp(join(tmpdir(),'gogh-original-sale-review-'));
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${name} overflow`);
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(output,`${name}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.equal(walletWrites,0); assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',sameWalletPurchaseAndSale:true,staleReviewClosed:true,
    buyerSeesOriginalPunk:true,wrappedReceiptUI:false,desktopAndMobile:true,walletWrites,browserExceptions:errors.length,screenshots:output},null,2));
} finally {
  ws?.close();chrome?.kill('SIGTERM');await new Promise(r=>server.close(r));
}
