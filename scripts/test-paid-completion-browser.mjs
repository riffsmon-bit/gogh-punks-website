import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3 || process.argv[2] !== '--mock-read-only') {
  throw Error('Requires --mock-read-only; this fixture cannot submit transactions.');
}
const site = fileURLToPath(new URL('../site/', import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/broker-v2.css"><style>
body{padding:16px}.fixture-shell{max-width:750px;margin:auto}.fixture-note{color:var(--muted);font-size:12px}
</style></head><body><div class="fixture-shell"><p class="fixture-note">LOCAL READ-ONLY BROWSER FIXTURE</p>
<main class="directed-paid-panel"></main></div><script type="module">
import {createDirectedPaidPanel} from '/directed-paid-panel.js';
import {paidOwnerCalldata,validatePaidEnvelope} from '/directed-paid-wallet.js';
import {PAID_RELEASE as r} from '/directed-paid-release.js';
const hash='0x'+'c'.repeat(64),intentId='a'.repeat(64),extraIntentId='d'.repeat(64),root=document.querySelector('main');
let selected={owner:r.owner,tokenId:'93',chainId:4663,preview:false},panel,waiting=[],allowDismiss=false;
const fixtureCancels=[];
let scenario=JSON.parse(sessionStorage.getItem('scenario')||'{"kind":"completed","hold":true}');
const counts=JSON.parse(sessionStorage.getItem('counts')||'{"gets":0,"posts":0,"sessions":0,"wallet":0}');
const bump=name=>{counts[name]++;sessionStorage.setItem('counts',JSON.stringify(counts));};
function envelope(kind){
 const extra=kind.endsWith('-extra'),expired=['expired-extra','cancelled-extra'].includes(kind);
 const expiresAt=expired?1789321008330:Date.now()+90000;
 const now=expired?Math.floor(expiresAt/1000)-90:Math.floor(Date.now()/1000);
 const review={schema:'GOGH_DIRECTED_PAID_REVIEW_V1',intentId:extra?extraIntentId:intentId,action:'AUTHORIZE',
 owner:r.owner,tokenId:'93',targetCollection:r.targetCollection,recipient:r.recipient,vault:r.vault,expectedGeneration:'0',
 quantity:1,priceWei:'100000000000000',maximumPriceWei:'100000000000000',executionFeeWei:'20000000000000',
 deadline:String(now+540),anchor:{timestamp:String(now)},expiresAt,maximumNetworkFeeWei:'20000000'};
 review.transaction={from:r.owner,to:r.factory,data:paidOwnerCalldata(review),chainId:'0x1237',type:'0x0',
 value:'0x'+(BigInt(review.priceWei)+BigInt(review.executionFeeWei)).toString(16),nonce:'0x0',gas:'0x1e8480',gasPrice:'0xa'};
 const completed={intent_id:intentId,status:'COMPLETED',transaction_hash:hash,receipt:{tokenId:'1599'}};
 const result={ok:true,mode:'SELECTED_DIRECTED_PAID_MINT',owner:r.owner,tokenId:'93',chainId:4663,
 record:{review,reviewHash:'b'.repeat(64),status:kind==='pending'?'WALLET_REQUESTED':kind==='prepared'?'PREPARED':'CONFIRMED',
 revision:2,reportedHash:kind==='prepared'?null:hash,receipt:null},
 state:{missionStatus:kind==='pending'?1:2,refundWei:'0'},execution:kind==='pending'||kind==='prepared'?null:completed};
 if(kind==='no-record')result.record=null;
 if(kind==='invalid-owner')result.owner='0x'+'1'.repeat(40);
 if(extra){
  result.record.status=kind==='pending-extra'?'WALLET_REQUESTED':kind==='cancelled-extra'?'CANCELLED':'PREPARED';
  result.record.reportedHash=kind==='pending-extra'?'0x'+'f'.repeat(64):null;
  result.record.revision=kind==='cancelled-extra'?3:2;
 }
 return result;
}
const request=async(path,options={})=>{
 if(path!=='/api/v2/punks/93/directed-paid-mint')throw Error('UNEXPECTED_API_PATH');
 if(options.body||(options.method??'GET')!=='GET'){
  bump('posts');const body=JSON.parse(options.body||'null');
  // A single armed DOM click may cancel only the exact synthetic expired review.
  // This is an in-memory fixture response, never a network or database write.
  if(!allowDismiss||scenario.kind!=='expired-extra'||options.method!=='POST'
   ||options.headers?.['content-type']!=='application/json'||!body||Object.keys(body).length!==3
   ||body.operation!=='cancel'||body.intentId!==extraIntentId||body.revision!==2)throw Error('WRITE_REQUEST_FORBIDDEN');
  allowDismiss=false;fixtureCancels.push(body);scenario={kind:'cancelled-extra',hold:false};
  sessionStorage.setItem('scenario',JSON.stringify(scenario));return envelope('cancelled-extra');
 }
 bump('gets');const current=structuredClone(scenario);
 if(current.hold)await new Promise(resolve=>waiting.push(resolve));
 if(current.kind==='session-missing')throw Object.assign(Error('Session expired'),{code:'V2_SESSION_EXPIRED'});
 if(current.kind==='history-failed')throw Object.assign(Error('History not verified'),{code:'PAID_HISTORY_UNAVAILABLE'});
 return envelope(current.kind);
};
function mount(){panel?.destroy();panel=createDirectedPaidPanel({root,getSelection:()=>selected,request,
 ensureSession:async()=>{bump('sessions');},getProvider:()=>{bump('wallet');throw Error('WALLET_FORBIDDEN');}});}
const config=(kind,hold=false)=>{scenario={kind,hold};sessionStorage.setItem('scenario',JSON.stringify(scenario));};
window.__paidFixture={counts:()=>({...counts}),waiting:()=>waiting.length,
 allowDismissOnce(){allowDismiss=true;},fixtureCancels:()=>structuredClone(fixtureCancels),
 release(){const pending=waiting;waiting=[];pending.forEach(resolve=>resolve());},
 configure:config,remount(kind,hold=false){config(kind,hold);mount();},
 select(patch){selected={...selected,...patch};panel.selectionChanged();},sameSelection(){panel.selectionChanged();},
 originalOwner:r.owner,intentId,extraIntentId,hash,validate:()=>validatePaidEnvelope(envelope('completed'),selected),
 destroy:()=>panel.destroy()};
mount();
</script></body></html>`;

const served = new Set();
const staticFiles = new Set(['/directed-paid-panel.js', '/directed-paid-wallet.js',
  '/directed-paid-status.js', '/directed-paid-release.js', '/broker-v2.css']);
const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  try {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    if (!staticFiles.has(request.url)) { response.writeHead(404); response.end(); return; }
    served.add(request.url);
    response.setHeader('content-type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
    response.end(await readFile(site + request.url.slice(1)));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp('/private/tmp/gogh-paid-completion-profile-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-sync', '--no-proxy-server', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20_000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const target = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), errors = [], publicAttempts = [], scenarios = [], screenshots = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP_TIMEOUT ${method}`)); }, 15_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      if (request.url.startsWith(`${origin}/`)) void call('Fetch.continueRequest', { requestId }).catch(error => errors.push(error.message));
      else {
        publicAttempts.push(request.url);
        void call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(error => errors.push(error.message));
      }
    }
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); }
  };
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`UI_TIMEOUT ${expression}: ${JSON.stringify(errors)}`);
  };
  const body = () => evaluate('document.querySelector("main").textContent');
  const ready = () => until('window.__paidFixture && document.querySelector("main").getAttribute("aria-busy")==="false"');
  const counts = () => evaluate('window.__paidFixture.counts()');
  const buttons = () => evaluate('Array.from(document.querySelectorAll("main button")).map(button=>({text:button.textContent,disabled:button.disabled}))');
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent===${JSON.stringify(label)}&&!button.disabled).click()`);
  const noWrites = async () => { const value = await counts(); assert.equal(value.posts, 0); assert.equal(value.wallet, 0); };
  const noNewReview = async () => assert.ok(!(await buttons()).some(button => /REVIEW (?:ANOTHER|ONE PEPPIES)/.test(button.text)));
  const completed = async () => {
    await ready();
    assert.match(await body(), /PAID MINT COMPLETE · PUNK #93/);
    assert.match(await body(), /Delivered Peppies World #1599 to #93’s Agent wallet\./);
    assert.ok((await buttons()).some(button => button.text === 'REVIEW ANOTHER MINT' && !button.disabled));
    assert.ok(!(await buttons()).some(button => button.text === 'REVIEW ONE PEPPIES WORLD MINT'));
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Page.navigate', { url: origin });
  await until('window.__paidFixture?.waiting()===1');
  assert.match(await body(), /Checking your saved mint result/); await noNewReview();
  assert.deepEqual(await counts(), { gets: 1, posts: 0, sessions: 0, wallet: 0 });
  await evaluate('window.__paidFixture.release()'); await completed();
  assert.match(await body(), /Mint complete\. Delivery was verified by both chain providers\./);
  assert.equal(await evaluate('document.querySelector("main a.filter-button").getAttribute("href")'), '/broker/v2/?tab=collection&tokenId=93');
  assert.equal(await evaluate('document.querySelector("main a[target=_blank]").rel'), 'noopener noreferrer');
  scenarios.push('initial-status-read-only-and-completed-delivery');

  for (const width of [1440, 375, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Horizontal overflow at ${width}`);
    assert.ok(await evaluate('Array.from(document.querySelectorAll("main button,main a")).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>0;})'), `Control bounds at ${width}`);
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = `/private/tmp/gogh-paid-completion-${width}.png`;
    await writeFile(path, Buffer.from(shot.data, 'base64')); screenshots.push(path);
  }
  await evaluate('window.__paidFixture.sameSelection()');
  assert.equal((await counts()).gets, 1);
  await evaluate('window.__paidFixture.configure("completed")');
  await call('Page.reload');
  await until('window.__paidFixture?.counts().gets===2'); await completed();
  assert.deepEqual(await counts(), { gets: 2, posts: 0, sessions: 0, wallet: 0 });
  scenarios.push('reload-restores-completion-with-one-get-and-no-wallet');
  await click('RECHECK PAID MINT'); await completed();
  await click('RECHECK PAID MINT'); await completed();
  assert.deepEqual(await counts(), { gets: 4, posts: 0, sessions: 2, wallet: 0 });
  scenarios.push('explicit-completed-recheck-does-not-resend');

  await evaluate('window.__paidFixture.remount("no-record")'); await completed();
  assert.match(await body(), /Mint complete\. Delivery was verified by both chain providers\./);
  scenarios.push('completion-survives-no-current-review-record');
  await evaluate('window.__paidFixture.remount("session-missing")'); await ready();
  assert.match(await body(), /Sign in to check your saved mint result/); await noNewReview();
  assert.equal((await counts()).sessions, 2);
  await evaluate('window.__paidFixture.configure("completed")');
  await click('RECHECK PAID MINT'); await completed();
  assert.equal((await counts()).sessions, 3);
  scenarios.push('missing-session-requires-explicit-recheck');
  await evaluate('window.__paidFixture.remount("history-failed")'); await ready();
  assert.match(await body(), /New paid budgets are blocked until archive reads recover/); await noNewReview();
  await evaluate('window.__paidFixture.configure("completed")');
  await click('RECHECK PAID MINT'); await completed();
  scenarios.push('failed-history-read-is-explicit-and-recheck-recovers');

  await evaluate('window.__paidFixture.remount("completed",true)');
  await until('window.__paidFixture.waiting()===1');
  await evaluate('window.__paidFixture.select({tokenId:"94"});window.__paidFixture.release()');
  await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  assert.equal(await evaluate('document.querySelector("main").hidden'), true);
  assert.equal(await body(), '');
  await evaluate('window.__paidFixture.configure("completed");window.__paidFixture.select({tokenId:"93"})'); await completed();
  scenarios.push('stale-response-after-punk-selection-is-discarded');
  await evaluate('window.__paidFixture.remount("completed",true)');
  await until('window.__paidFixture.waiting()===1');
  await evaluate('window.__paidFixture.select({owner:"0x"+"1".repeat(40)});window.__paidFixture.release()');
  await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  assert.equal(await evaluate('document.querySelector("main").hidden'), true);
  assert.equal(await body(), '');
  await evaluate('window.__paidFixture.configure("completed");window.__paidFixture.select({owner:window.__paidFixture.originalOwner})'); await completed();
  scenarios.push('stale-response-after-owner-selection-is-discarded');

  await evaluate('localStorage.setItem("gogh-directed-paid-v1:"+window.__paidFixture.intentId,JSON.stringify({attempted:true,hash:window.__paidFixture.hash}));window.__paidFixture.remount("pending")'); await ready();
  assert.match(await body(), /RECOVER ORIGINAL TRANSACTION/); await noNewReview();
  assert.ok(!/PAID MINT COMPLETE/.test(await body()));
  assert.equal(await evaluate('document.querySelector("main input").value'), `0x${'c'.repeat(64)}`);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("gogh-directed-paid-v1:"+window.__paidFixture.intentId)).attempted'), true);
  scenarios.push('pending-wallet-request-retains-original-hash-without-auto-recovery');
  await evaluate('window.__paidFixture.remount("invalid-owner")'); await ready();
  assert.match(await body(), /paid-mint review could not be verified/); await noNewReview();
  scenarios.push('actual-wallet-validator-rejects-owner-mismatch');
  await noWrites(); assert.equal((await counts()).sessions, 4, 'Only the four explicit rechecks authenticate');

  const expiredExtra = async () => {
    await ready();
    assert.match(await body(), /PAID MINT COMPLETE · PUNK #93/);
    assert.match(await body(), /Mint complete\. Delivery was verified by both chain providers\./);
    assert.match(await body(), /Delivered Peppies World #1599/);
    assert.match(await body(), /A separate review for another mint expired/);
    assert.match(await body(), /Your completed mint is unaffected/);
    assert.ok(!(await body()).includes('Previous mint:'));
    assert.ok((await buttons()).some(button => button.text === 'DISMISS EXPIRED REVIEW' && !button.disabled));
    assert.ok(!(await buttons()).some(button => /CONFIRM|CANCEL UNSENT/.test(button.text)));
    await noNewReview();
  };
  await evaluate('window.__paidFixture.remount("expired-extra")'); await expiredExtra();
  const beforeExpiredReload = await counts();
  await call('Page.reload');
  await until(`window.__paidFixture?.counts().gets===${beforeExpiredReload.gets + 1}`); await expiredExtra();
  assert.equal((await counts()).sessions, 4); await noWrites();
  scenarios.push('actual-expired-separate-review-keeps-completion-after-reload');
  await click('RECHECK PAID MINT'); await expiredExtra();
  assert.equal((await counts()).sessions, 5); await noWrites();
  scenarios.push('expired-separate-review-recheck-does-not-cancel-or-prepare');
  for (const width of [1440, 375, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Expired-review overflow at ${width}`);
    assert.ok(await evaluate('Array.from(document.querySelectorAll("main button,main a")).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>0;})'), `Expired-review control bounds at ${width}`);
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = `/private/tmp/gogh-paid-completion-expired-extra-${width}.png`;
    await writeFile(path, Buffer.from(shot.data, 'base64')); screenshots.push(path);
  }

  for (const kind of ['fresh-extra', 'pending-extra']) {
    await evaluate(`window.__paidFixture.remount(${JSON.stringify(kind)})`); await ready();
    const beforeReload = await counts();
    await call('Page.reload');
    await until(`window.__paidFixture?.counts().gets===${beforeReload.gets + 1}`); await ready();
    assert.ok(!(await body()).includes('PAID MINT COMPLETE'));
    assert.match(await body(), /Previous mint: Delivered Peppies World #1599/);
    assert.ok(!(await buttons()).some(button => button.text === 'DISMISS EXPIRED REVIEW'));
    await noNewReview(); await noWrites(); assert.equal((await counts()).sessions, 5);
    if (kind === 'fresh-extra') {
      assert.match(await body(), /Quote ready\. Review the amounts/);
      assert.ok((await buttons()).some(button => button.text === 'CONFIRM MINT BUDGET IN WALLET' && !button.disabled));
      assert.ok((await buttons()).some(button => button.text === 'CANCEL UNSENT REVIEW' && !button.disabled));
    } else {
      assert.match(await body(), /Wallet confirmation requested/);
      assert.ok((await buttons()).some(button => button.text === 'RECOVER ORIGINAL TRANSACTION' && !button.disabled));
      assert.ok(!(await buttons()).some(button => /CONFIRM|CANCEL UNSENT/.test(button.text)));
      assert.equal(await evaluate('document.querySelector("main input").value'), `0x${'f'.repeat(64)}`);
    }
    scenarios.push(`${kind}-remains-distinct-from-previous-delivery-after-reload`);
  }

  // The sole write-shaped call is a precisely armed in-memory cancel fixture.
  // It must occur only after this explicit DOM click, never on load or recheck.
  await evaluate('window.__paidFixture.remount("expired-extra")'); await expiredExtra(); await noWrites();
  const beforeDismiss = await counts();
  await evaluate('window.__paidFixture.allowDismissOnce()'); await click('DISMISS EXPIRED REVIEW'); await completed();
  const afterDismiss = await counts();
  assert.equal(afterDismiss.posts, 1); assert.equal(afterDismiss.wallet, 0);
  assert.equal(afterDismiss.gets, beforeDismiss.gets + 1);
  assert.equal(afterDismiss.sessions, 6);
  assert.deepEqual(await evaluate('window.__paidFixture.fixtureCancels()'), [{ operation: 'cancel', intentId: 'd'.repeat(64), revision: 2 }]);
  assert.match(await body(), /Delivered Peppies World #1599/);
  scenarios.push('explicit-dismiss-cancels-only-expired-synthetic-review-and-never-prepares');
  assert.deepEqual(errors, []); assert.deepEqual(publicAttempts, []);
  assert.ok(['/directed-paid-panel.js', '/directed-paid-wallet.js', '/directed-paid-status.js', '/directed-paid-release.js']
    .every(path => served.has(path)), 'Actual production modules were served without replacement');
  const proof = { schema: 'GOGH_PAID_COMPLETION_READONLY_BROWSER_V1', checkedAt: new Date().toISOString(),
    status: 'PASS', actualProductionModules: true, fixtureOwnerFromActualRelease: true,
    widths: [1440, 375, 320], scenarios, screenshots, requests: await counts(),
    automaticPostCalls: 0, automaticAuthenticationCalls: 0, inMemoryExplicitCancelFixtures: 1,
    publicNetworkAttempts: publicAttempts.length, publicTransactions: 0, browserErrors: errors.length };
  await writeFile('/private/tmp/gogh-paid-completion-browser.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
  await evaluate('window.__paidFixture.destroy()');
} finally {
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  await new Promise(resolve => server.close(resolve));
}
