import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 3 || process.argv[2] !== '--fixture-only') throw Error('Requires --fixture-only; no public wallet, RPC or API');
const repo = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp('/private/tmp/gogh-paid-browser-evidence-'), profile = await mkdtemp('/private/tmp/gogh-paid-browser-profile-');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/site/broker-v2.css"><link rel="stylesheet" href="/site/broker-v2-forge.css">
<style>body{padding:20px 14px}main{max-width:760px;margin:auto}h1{font-size:26px}.fixture-note{font-size:12px;color:#a8b6c4}</style></head>
<body><main><p class="fixture-note">LOCAL PAID TRAINING FIXTURE · NO PUBLIC TRANSACTIONS</p><h1>Optional Training Credits</h1>
<section class="forge-locked" data-forge-paid-training></section><input data-forge-sample-two value="94" hidden><input data-forge-sample-three value="95" hidden></main><script type="module">
import {createPaidTrainingPanel} from '/site/forge-paid-panel.js';
import {PAID_TRAINING_RELEASE} from '/site/forge-paid-release.js';
import {paidUiFixture,PAID_UI_HASH} from '/tests/fixtures/paid-training-ui.mjs';
let f, panel, selected, held, mode=sessionStorage.getItem('paid-mode')||'undeployed';
const root=document.querySelector('[data-forge-paid-training]');
const counters=()=>JSON.parse(sessionStorage.getItem('paid-counters')||'{"sends":0,"signIns":0}');
function mount(next=mode){mode=next;sessionStorage.setItem('paid-mode',mode);panel?.destroy();f=paidUiFixture();selected=f.selected;
 f.beforeSend=tx=>{const saved=Object.keys(localStorage).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>v.attempted);
  if(!saved||JSON.stringify(saved.review.transaction)!==JSON.stringify(tx))throw Error('EXACT_ATTEMPT_NOT_SAVED');
  const c=counters();c.sends++;sessionStorage.setItem('paid-counters',JSON.stringify(c));
  if(['lost','reject'].includes(f.mode))return;
  const a=saved.review.action,s=f.state;if(a.operation==='buy')s.purchasedCredits=String(BigInt(s.purchasedCredits)+1n);
  if(a.operation==='activate')s.activated=true;if(a.operation==='learn'){s.skills[0].level=1;s.purchasedCredits=String(BigInt(s.purchasedCredits)-1n);}
  if(a.operation==='unlock'){s.unlockedSlots++;s.equipped.push('0x'+'0'.repeat(64));s.purchasedCredits=String(BigInt(s.purchasedCredits)-1n);}
  if(a.operation==='equip')s.equipped[a.slot]=a.skillKey;if(a.operation==='unequip')s.equipped[a.slot]='0x'+'0'.repeat(64);
  s.reviewNonce=String(BigInt(s.reviewNonce)+1n);s.reviewStateHash='0x'+BigInt(s.reviewNonce).toString(16).padStart(64,'0');};
 panel=createPaidTrainingPanel({root,getSelection:()=>selected,release:mode==='undeployed'?PAID_TRAINING_RELEASE:f.release,
  request:(...args)=>f.request(...args),getProvider:()=>f.provider,storage:localStorage,
  ensureSession:async()=>{const c=counters();c.signIns++;sessionStorage.setItem('paid-counters',JSON.stringify(c));}});}
window.paid={hash:PAID_UI_HASH,fixture:()=>f,counters,text:()=>root.textContent,
 async reset(next='live'){localStorage.clear();sessionStorage.removeItem('paid-counters');mount(next);},
 mode:value=>{f.mode=value;},receipt:value=>{f.receiptStatus=value;},remount:()=>mount(),
 select(value){selected=value;panel.selectionChanged();},setState:patch=>Object.assign(f.state,patch),
 holdVerify(){f.verifyHook=()=>new Promise(resolve=>{held=resolve;});},release:()=>held?.(),
 controls:()=>[...root.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled})),
 stats:()=>({methods:[...f.methods],requests:[...f.requests],...counters()}),refresh:()=>panel.refresh()};
mount();window.paidReady=true;</script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; frame-src 'none'");
  try {
    if (req.method !== 'GET') throw Error('NO_MUTATION_ENDPOINT');
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    if (!path.startsWith('/site/') && path !== '/tests/fixtures/paid-training-ui.mjs') throw Error('NOT_FOUND');
    const file = resolve(repo, '.' + path); if (!file.startsWith(repo) || !/\.(js|mjs|css|woff2)$/.test(file)) throw Error('NOT_FOUND');
    res.setHeader('content-type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking',
  '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const chromeExited = new Promise(r => chrome.once('exit', r)); let ws;
const result = { status: 'RUNNING', output, startedAt: new Date().toISOString(), screenshots: [], scenarios: [], exceptions: [], externalRequests: [] };
try {
  const endpoint = await new Promise((r, j) => { let buffer = ''; const timer = setTimeout(() => j(Error('CHROME_TIMEOUT')), 20000);
    chrome.once('error', j); chrome.stderr.on('data', chunk => { buffer += chunk; const m = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); r(m[1]); } }); });
  const tab = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((r, j) => { const number = ++id, timer = setTimeout(() => { pending.delete(number); j(Error(`CDP_TIMEOUT:${method}`)); }, 20000);
    pending.set(number, { resolve: value => { clearTimeout(timer); r(value); }, reject: error => { clearTimeout(timer); j(error); } }); ws.send(JSON.stringify({ id: number, method, params })); });
  ws.onmessage = ({ data }) => { const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') result.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Fetch.requestPaused') { const p = m.params, allowed = p.request.url.startsWith(origin + '/') && p.request.method === 'GET';
      if (!allowed) result.externalRequests.push(p.request.url); void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: p.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }); }
    const waiter = pending.get(m.id); if (waiter) { pending.delete(m.id); m.error ? waiter.reject(Error(m.error.message)) : waiter.resolve(m.result); } };
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); } throw Error(`UI_TIMEOUT:${expression}`); };
  const click = async label => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled);if(!b)throw Error('BUTTON_MISSING:'+${JSON.stringify(label)});b.click();})()`);
    await until(`document.querySelector('[data-forge-paid-training]').getAttribute('aria-busy')==='false'`); };
  const capture = async name => { for (const width of [1440, 375]) { await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `${name}:page overflow ${width}`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button,input,select')).filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().right<=innerWidth+1&&n.getBoundingClientRect().height>=44)`), true, `${name}:control bounds ${width}`);
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }), file = `${name}-${width}.png`;
    await writeFile(join(output, file), Buffer.from(shot.data, 'base64')); result.screenshots.push(file); } };
  const prepared = async () => { await click('RECHECK PAID TRAINING'); await click('REVIEW BUY 1 CREDIT · 0.0005 ETH'); };
  const settle = async () => { await evaluate(`paid.receipt('CONFIRMED_SUCCESS')`); await click('RECOVER PAID TRAINING TRANSACTION'); await click('CLOSE CONFIRMED REVIEW'); await click('RECHECK PAID TRAINING'); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  result.browser = (await call('Browser.getVersion')).product; await call('Page.navigate', { url: origin }); await until('window.paidReady===true');
  assert.deepEqual(await evaluate('paid.stats()'), { methods: [], requests: [], sends: 0, signIns: 0 });
  assert.equal(await evaluate('paid.controls().length'), 0); await capture('undeployed'); result.scenarios.push('UNDEPLOYED price/help only; zero session/API/RPC');
  await evaluate(`paid.reset();paid.select(null)`); assert.equal(await evaluate('paid.controls().length'), 0); await capture('disconnected');
  await evaluate('paid.reset();paid.setState({burnApprovalActive:true})'); await click('RECHECK PAID TRAINING');
  assert.equal(await evaluate(`paid.controls().find(b=>b.text==='REVIEW BUY 1 CREDIT · 0.0005 ETH').disabled`), true);
  assert.equal(await evaluate(`paid.text().includes('Revoke its burn approval before buying credits for it.')`), true);
  assert.equal(await evaluate('paid.stats().methods.length'), 0); assert.equal(await evaluate('paid.counters().sends'), 0);
  await capture('burn-approval-blocked'); result.scenarios.push('active sacrifice approval blocks purchase before wallet access');
  await evaluate('paid.reset()'); await prepared(); assert.equal(await evaluate(`paid.text().includes('no refund function')`), true); await capture('buy-review');
  await click('CONFIRM PAID TRAINING IN WALLET'); assert.equal(await evaluate('paid.counters().sends'), 1); await capture('submitted'); await settle(); result.scenarios.push('exact purchase and successful receipt');
  await click('REVIEW PAID TRAINING SETUP'); await capture('activation-review'); await click('CONFIRM PAID TRAINING IN WALLET'); await settle();
  await click('REVIEW LEARN · 1 PURCHASED CREDIT'); await click('CONFIRM PAID TRAINING IN WALLET'); await settle();
  await click('REVIEW UNLOCK SLOT · 1 PURCHASED CREDIT'); await click('CONFIRM PAID TRAINING IN WALLET'); await settle();
  await click('REVIEW EQUIP'); await click('CONFIRM PAID TRAINING IN WALLET'); await settle(); await capture('canonical-equipped');
  assert.equal(await evaluate(`paid.controls().some(b=>b.text==='RUN EQUIPPED RESEARCH')`), true);
  await click('RUN EQUIPPED RESEARCH'); assert.equal(await evaluate(`paid.text().includes('3 Punks compared')`), true); await capture('equipped-research');
  await click('REVIEW UNEQUIP SLOT 1'); await click('CONFIRM PAID TRAINING IN WALLET'); await settle();
  assert.equal(await evaluate('paid.counters().sends'), 6); result.scenarios.push('explicit activation, learn, slot unlock, equip, unequip');
  await evaluate('paid.reset()'); await prepared(); await evaluate(`paid.mode('lost')`); await click('CONFIRM PAID TRAINING IN WALLET');
  await call('Page.reload'); await until('window.paidReady===true'); assert.equal(await evaluate('paid.counters().sends'), 1);
  assert.equal(await evaluate(`paid.controls().some(b=>b.text==='CONFIRM PAID TRAINING IN WALLET')`), false); await capture('lost-wallet-reload');
  await evaluate(`document.querySelector('[data-forge-paid-training] input').value=paid.hash;paid.receipt('INCLUDED_SUCCESS')`); await click('RECOVER PAID TRAINING TRANSACTION');
  assert.equal(await evaluate(`paid.controls().some(b=>b.text==='CLOSE CONFIRMED REVIEW')`), false);
  await evaluate(`paid.receipt('CONFIRMED_REVERT')`); await click('RECOVER PAID TRAINING TRANSACTION'); await capture('confirmed-revert'); result.scenarios.push('lost wallet response survives reload; included and reverted receipt recovery');
  await evaluate('paid.reset()'); await prepared(); await evaluate(`paid.mode('reject')`); await click('CONFIRM PAID TRAINING IN WALLET'); await click('CHECK EXPIRED REQUEST');
  assert.equal(await evaluate(`paid.controls().some(b=>b.text==='CLOSE CONFIRMED REVIEW')`), false);
  await evaluate('paid.fixture().expiredUnused=true'); await click('CHECK EXPIRED REQUEST'); await capture('expired-unused-proof'); await click('CLOSE CONFIRMED REVIEW'); result.scenarios.push('user rejection held until explicit finalized unused proof');
  await evaluate('paid.reset()'); await prepared(); await evaluate('paid.holdVerify()');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='CONFIRM PAID TRAINING IN WALLET').click()`);
  await until(`paid.fixture().requests.includes('verify')`); await evaluate(`paid.select({...paid.fixture().selected,chainId:1});paid.release()`);
  await new Promise(r => setTimeout(r, 100)); assert.equal(await evaluate('paid.counters().sends'), 0); result.scenarios.push('chain switch during verify never prompts');
  await evaluate('paid.reset();paid.mode("long-error")'); await click('RECHECK PAID TRAINING'); await capture('long-safe-error');
  assert.equal(await evaluate(`document.querySelectorAll('[data-forge-paid-training] img').length`), 0); result.scenarios.push('long error safe text and responsive layout');
  assert.equal(result.exceptions.length, 0); assert.equal(result.externalRequests.length, 0); result.status = 'PASS'; result.finishedAt = new Date().toISOString();
} catch (error) { result.status = 'FAILED'; result.error = error.stack; }
finally { await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); ws?.close(); chrome.kill('SIGTERM');
  await Promise.race([chromeExited, new Promise(r => setTimeout(r, 5000))]); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  await new Promise(r => server.close(r)); console.log(JSON.stringify(result, null, 2)); }
if (result.status !== 'PASS') process.exitCode = 1;
