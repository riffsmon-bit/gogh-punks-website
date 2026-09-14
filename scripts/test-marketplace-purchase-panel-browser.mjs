import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

if (process.argv.length !== 3 || process.argv[2] !== '--mock-wallet-only') throw Error('Requires --mock-wallet-only');
const root = new URL('../', import.meta.url), site = new URL('site/', root);
const fixture = await build({ entryPoints: [fileURLToPath(new URL('tests/fixtures/marketplace-panel.mjs', root))],
  bundle: true, platform: 'browser', format: 'esm', write: false, minify: true });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/broker-v2.css"><style>body{padding:24px 16px}.shell{max-width:720px;margin:0 auto}.fixture-note{font-size:10px;letter-spacing:.12em;color:#99a4b1;margin:0 0 18px}h1{font-size:20px;margin:0 0 18px}</style>
</head><body><main class="shell"><p class="fixture-note">LOCAL FIXTURE · NO PUBLIC TRANSACTIONS</p><h1>Gogh Punks / owner purchase</h1><div id="purchase" hidden></div></main>
<script type="module">
import {createMarketplacePurchasePanel} from '/marketplace-purchase-panel.js';
import {marketplacePanelFixture,PANEL_OWNER,PANEL_OTHER,PANEL_HASH,PANEL_RELEASE} from '/fixture.js';
const state=JSON.parse(sessionStorage.getItem('panel-fixture')||'null')??{server:null,transaction:null,mode:'normal',release:true,sends:0,posts:[],gets:[],settled:0};
let selected={owner:PANEL_OWNER,tokenId:'93',chainId:4663,preview:false},owner=PANEL_OWNER,panel,waiting=[];
const save=()=>sessionStorage.setItem('panel-fixture',JSON.stringify(state));
const empty=actor=>({...marketplacePanelFixture({owner:actor}).envelope,entry:null,availability:state.release?'EMPTY':'RELEASE_BLOCKED',blockers:state.release?[]:['NOT_RELEASED']});
const api=async(path,options)=>{
 const actor=owner,body=options.body?JSON.parse(options.body):null;
 if(state.mode==='hold'){await new Promise(resolve=>waiting.push(resolve));}
 if(state.mode==='error')throw Error('<img src=x onerror=alert(1)>');
 if(!body){state.gets.push(path);save();return state.server?.owner===actor?structuredClone(state.server):empty(actor);}
 state.posts.push(body);save();
 if(body.operation==='prepare'){
  if(state.mode==='blocked-prepare')return {...empty(actor),availability:'RELEASE_BLOCKED',blockers:['LISTING_UNAVAILABLE']};
  if(!Array.from({length:localStorage.length},(_,i)=>JSON.parse(localStorage.getItem(localStorage.key(i)))).some(r=>r.requestId===body.input.requestId))throw Error('UUID_NOT_SAVED');
  const identity=JSON.stringify({chainId:4663,owner:actor,punkId:selected.tokenId,requestId:body.input.requestId});
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const intentId=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
  const f=marketplacePanelFixture({owner:actor,punkId:selected.tokenId,intentId});state.server=f.envelope;state.transaction=f.transaction;save();
  if(state.mode==='lose-prepare'){state.mode='normal';save();throw Error('LOST_PREPARE_RESPONSE');}
 }else{
  if(body.intentId!==state.server.entry.intentId||body.revision!==state.server.entry.revision||body.reviewHash!==state.server.entry.reviewHash)throw Error('CAS_MISMATCH');
  if(body.operation==='claim'){
   if(state.server.entry.status!=='PREPARED')throw Error('CLAIM_ALREADY_RESERVED');
   state.server.entry.status='WALLET_REQUESTED';state.server.entry.revision++;state.server.availability='RECOVERY_REQUIRED';save();
   if(state.mode==='lose-claim'){state.mode='normal';save();throw Error('LOST_CLAIM_RESPONSE');}
   return {...structuredClone(state.server),walletClaimed:true,transaction:state.transaction};
  }
  if(body.operation==='recover'){
   if(state.mode==='lose-recovery'){state.mode='normal';save();throw Error('LOST_RECOVERY_RESPONSE');}
   if(body.transactionHash!==PANEL_HASH)throw Error('ORIGINAL_HASH_REQUIRED');
   if(state.mode==='unobserved-hash')return {...structuredClone(state.server),blockers:['MARKETPLACE_ORIGINAL_TRANSACTION_NOT_OBSERVED']};
   state.server.entry.reportedHash=PANEL_HASH;state.server.entry.status='COMPLETED';state.server.entry.revision++;state.server.availability='COMPLETED';
   state.server.entry.receipt={status:'COMPLETED',transactionHash:PANEL_HASH,confirmations:'12'};
  }
  if(body.operation==='decline'){state.server.entry.reason='WALLET_DECLINED_UNVERIFIED';state.server.entry.revision++;}
  if(body.operation==='cancel'){if(state.server.entry.status!=='PREPARED')throw Error('CLAIM_RESERVED');state.server.entry.status='CANCELLED';state.server.entry.revision++;state.server.availability='CANCELLED';}
 }
 save();return structuredClone(state.server);
};
const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>{if(state.mode==='storage-failure')throw Error('STORAGE_UNAVAILABLE');localStorage.setItem(key,value);}};
function mount(){panel?.destroy();panel=createMarketplacePurchasePanel({container:document.querySelector('#purchase'),api,
 getSelected:()=>selected,getOwner:()=>owner,storage,purchaseRelease:state.release==='paused'?{...PANEL_RELEASE,status:'PAUSED'}:state.release?PANEL_RELEASE:null,
 getProvider:()=>({request:async({method})=>{
  if(method==='eth_chainId')return '0x1237';if(method==='eth_accounts')return [owner];if(method!=='eth_sendTransaction')throw Error('UNEXPECTED_WALLET_METHOD');
  state.sends++;save();if(state.mode==='wallet-reject')throw Object.assign(Error('Owner rejected'),{code:4001});return PANEL_HASH;
 }}),onSettled:()=>{state.settled++;save();}});}
window.__panel={
 state:()=>structuredClone(state),text:()=>document.querySelector('#purchase').shadowRoot.textContent,
 controls:()=>Array.from(document.querySelector('#purchase').shadowRoot.querySelectorAll('button')).map(b=>({text:b.textContent,disabled:b.disabled})),
 async prepare(){return panel.prepare(marketplacePanelFixture().input);},async refresh(){return panel.refresh();},
 async concurrentPrepare(){const input=marketplacePanelFixture().input;return Promise.all([panel.prepare(input),panel.prepare(input)]);},
 mode:value=>{state.mode=value;save();},waiting:()=>waiting.length,releaseWaiters:()=>{const list=waiting;waiting=[];list.forEach(resolve=>resolve());},
 async reset(status=null,release=true){panel?.destroy();localStorage.clear();state.server=status?marketplacePanelFixture({status}).envelope:null;
 state.transaction=null;state.mode='normal';state.release=release;state.sends=0;state.posts=[];state.gets=[];state.settled=0;
 owner=PANEL_OWNER;selected={owner,tokenId:'93',chainId:4663,preview:false};save();mount();return panel.refresh();},
 transfer(){owner=PANEL_OTHER;selected={...selected,owner};panel.clear();},
 saved:()=>Array.from({length:localStorage.length},(_,i)=>JSON.parse(localStorage.getItem(localStorage.key(i)))).filter(x=>x.schema===1),
 hash:PANEL_HASH,async pause(){state.release=false;save();mount();return panel.refresh();}
};
mount();await panel.refresh();window.__panelReady=true;
</script></body></html>`;
const allowed = new Set(['/marketplace-purchase-panel.js', '/marketplace-wallet.js', '/marketplace-wallet-codec.js', '/broker-v2.css']);
const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  try {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(fixture.outputFiles[0].text); return; }
    if (!allowed.has(request.url)) { response.writeHead(404); response.end(); return; }
    response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await readFile(new URL(request.url.slice(1), site)));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, profile = await mkdtemp('/private/tmp/gogh-marketplace-panel-browser-');
const directory = new URL('docs/v2-hardening/marketplace-panel-evidence/', root); await mkdir(directory, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-proxy-server',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('CHROME_START_TIMEOUT')), 20_000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const target = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), exceptions = [], publicRequests = [], screenshots = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const number = ++id, timer = setTimeout(() => { pending.delete(number); reject(Error(`CDP_TIMEOUT_${method}`)); }, 20_000);
    pending.set(number, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: number, method, params }));
  });
  ws.onmessage = ({ data }) => { const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith(origin)
      && !message.params.request.url.startsWith('data:')) publicRequests.push(message.params.request.url);
    const waiting = pending.get(message.id); if (waiting) { pending.delete(message.id);
      message.error ? waiting.reject(Error(message.error.message)) : waiting.resolve(message.result); } };
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 80)); } throw Error(`UI_TIMEOUT: ${expression}`); };
  const click = label => evaluate(`Array.from(document.querySelector('#purchase').shadowRoot.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).click()`);
  const screenshot = async (name, width) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `Page overflow at ${width}`);
    assert.equal(await evaluate(`(()=>{const host=document.querySelector('#purchase');return Array.from(host.shadowRoot.querySelectorAll('button,input,.card')).every(el=>el.getBoundingClientRect().right<=innerWidth+1)})()`), true);
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = `${name}-${width}.png`; await writeFile(new URL(file, directory), Buffer.from(result.data, 'base64')); screenshots.push(file);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Page.navigate', { url: origin });
  await until('window.__panelReady===true');
  await evaluate('__panel.reset(null,false)');
  assert.equal(await evaluate("document.querySelector('#purchase').hidden"), true);
  assert.equal(await evaluate('__panel.state().gets.length'), 0);
  await evaluate("__panel.reset('WALLET_REQUESTED','paused')");
  assert.equal(await evaluate('__panel.state().gets.length'), 1);
  assert.equal(await evaluate("document.querySelector('#purchase').hidden"), false);
  assert.equal(await evaluate("__panel.controls().some(b=>b.text==='Confirm in wallet')"), false);
  assert.equal(await evaluate('__panel.state().sends'), 0);
  await evaluate('__panel.reset(null,"paused")');
  await evaluate("__panel.mode('error')"); await evaluate('__panel.refresh()');
  assert.equal(await evaluate("document.querySelector('#purchase').hidden"), false);
  assert.equal(await evaluate("__panel.controls().some(b=>b.text==='Refresh status')"), true);
  await evaluate('__panel.reset()'); await evaluate("__panel.mode('blocked-prepare')"); await evaluate('__panel.prepare()');
  const discardedId = await evaluate('__panel.saved()[0].intentId'); await click('Discard unsent request');
  await until("__panel.text().includes('Unsent request discarded')");
  assert.equal(await evaluate('__panel.saved()[0].status'), 'DISCARDED');
  assert.ok((await evaluate('__panel.state().gets.at(-1)')).endsWith(`?intentId=${discardedId}`));
  await evaluate("__panel.mode('normal')"); await evaluate('__panel.prepare()');
  assert.equal(await evaluate('__panel.saved().length'), 2);
  await evaluate('__panel.reset()'); await evaluate('__panel.prepare()');
  await until("__panel.controls().some(b=>b.text==='Confirm in wallet'&&!b.disabled)");
  for (const width of [1440, 375, 320]) await screenshot('review', width);
  await evaluate("__panel.mode('lose-recovery')"); await click('Confirm in wallet');
  await until("__panel.text().includes('could not be verified')"); assert.equal(await evaluate('__panel.state().sends'), 1);
  assert.equal(await evaluate("__panel.controls().some(b=>b.text==='Confirm in wallet')"), false);
  await screenshot('recovery', 375);
  await call('Page.reload'); await until('window.__panelReady===true');
  await until("__panel.text().includes('Purchase complete')"); assert.equal(await evaluate('__panel.state().sends'), 1);
  assert.equal(await evaluate('__panel.controls().length'), 0);
  for (const width of [1440, 375, 320]) await screenshot('completed', width);
  await evaluate("__panel.reset('REVERTED')"); assert.equal(await evaluate('__panel.controls().length'), 0); await screenshot('reverted', 320);
  await evaluate("__panel.reset('WALLET_REQUESTED')"); await evaluate("__panel.mode('unobserved-hash')");
  await evaluate("(()=>{const input=document.querySelector('#purchase').shadowRoot.querySelector('input');input.value=__panel.hash;input.dispatchEvent(new Event('input'));})()");
  await click('Check original transaction'); await until("__panel.controls().some(b=>b.text==='Refresh status'&&!b.disabled)");
  assert.equal(await evaluate('__panel.saved()[0].transactionHash'), null, 'Unobserved manual hash was incorrectly bound');
  await evaluate("__panel.mode('normal')"); await click('Check original transaction'); await until("__panel.text().includes('Purchase complete')");
  await evaluate('__panel.reset()'); await evaluate("__panel.mode('lose-prepare')"); await evaluate('__panel.prepare()');
  const original = await evaluate('__panel.saved()[0].intentId');
  await call('Page.reload'); await until('window.__panelReady===true');
  assert.equal(await evaluate('__panel.saved()[0].intentId'), original);
  assert.equal(await evaluate("__panel.state().posts.filter(p=>p.operation==='prepare').length"), 1);
  await evaluate("__panel.mode('error')"); await evaluate('__panel.refresh()'); await screenshot('error', 375);
  assert.equal(await evaluate("__panel.text().includes('<img')"), false);
  assert.equal(await evaluate("__panel.controls().find(b=>b.text==='Confirm in wallet').disabled"), true);
  await evaluate("__panel.mode('hold');window.__pendingRefresh=__panel.refresh();true"); await until('__panel.waiting()===1');
  await evaluate('__panel.transfer();__panel.releaseWaiters();__pendingRefresh');
  assert.equal(await evaluate("document.querySelector('#purchase').hidden"), true);
  assert.equal(await evaluate('__panel.saved()[0].intentId'), original);
  await evaluate('__panel.reset()'); await evaluate('__panel.concurrentPrepare()');
  await evaluate("(()=>{const b=Array.from(document.querySelector('#purchase').shadowRoot.querySelectorAll('button')).find(b=>b.textContent==='Confirm in wallet');b.click();b.click();})()");
  await until("__panel.text().includes('Purchase complete')");
  assert.equal(await evaluate('__panel.state().sends'), 1);
  assert.equal(await evaluate("__panel.state().posts.filter(p=>p.operation==='claim').length"), 1);
  await evaluate('__panel.reset()'); await evaluate("__panel.mode('lose-claim')"); await evaluate('__panel.prepare()'); await click('Confirm in wallet');
  await until("__panel.text().includes('could not be verified')"); assert.equal(await evaluate('__panel.state().sends'), 0);
  await call('Page.reload'); await until('window.__panelReady===true');
  assert.equal(await evaluate("__panel.controls().some(b=>b.text==='Confirm in wallet')"), false);
  await evaluate('__panel.reset()'); await evaluate("__panel.mode('wallet-reject')"); await evaluate('__panel.prepare()'); await click('Confirm in wallet');
  await until("__panel.text().includes('Wallet confirmation was declined')");
  await call('Page.reload'); await until('window.__panelReady===true');
  assert.equal(await evaluate("__panel.controls().some(b=>b.text==='Confirm in wallet')"), false);
  assert.equal(await evaluate('__panel.state().sends'), 1);
  await evaluate('__panel.reset()'); await evaluate("__panel.mode('storage-failure')"); await evaluate('__panel.prepare()');
  assert.equal(await evaluate('__panel.state().posts.length'), 0); assert.equal(await evaluate('__panel.state().sends'), 0);
  assert.deepEqual(exceptions, []); assert.deepEqual(publicRequests, []);
  const result = { status: 'PASS', checkedAt: new Date().toISOString(), widths: [1440, 375, 320], screenshots,
    actualBoundaryHelper: true, durableUuidBeforePrepare: true, sameIntentAfterLostPrepare: true,
    lostClaimNeverResends: true, lostReceiptReadReloadRecovery: true, oneSendForConcurrentClicks: true,
    manualUnobservedHashNotBound: true, rejectedWalletRemainsReserved: true, terminalCardsHaveNoReviewActions: true,
    ownershipChangeDropsStaleViewPreservesJournal: true, storageFailurePreventsPreparation: true,
    noHtmlInjection: true, unreleasedIdleHasNoRequests: true, pausedReleaseReadsServerHistoryWithoutLocalJournal: true,
    pausedReadFailureHasRecoveryAction: true, blockedUnattemptedDraftCanBeDiscardedAfterExactRead: true,
    publicRequests: 0, publicTransactions: 0,
    limitations: ['All API, release and wallet responses are controlled in-memory browser fixtures.',
      'The real browser panel and reviewed wallet helper/codec run; SQL CAS, live wallet behavior and public release remain separate gates.'] };
  await writeFile(new URL('result.json', directory), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} finally {
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
