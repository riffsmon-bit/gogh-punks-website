import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (process.argv.length !== 3 || process.argv[2] !== '--fixture-only') throw Error('Requires --fixture-only; no public API or wallet');
const site = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const page = await readFile(resolve(site, 'broker/v2/index.html'), 'utf8');
const holder = page.match(/<section data-persistent-watch[^>]*><\/section>/)?.[0];
assert.ok(holder, 'Use the actual holder mount');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/broker-v2.css"><link rel="stylesheet" href="/broker-persistent-watch.css">
<style>body{padding:16px}main{max-width:1000px;margin:auto}html{scroll-behavior:auto!important}</style>
<main><p>LOCAL WATCH FIXTURE · NO PUBLIC TRANSACTIONS</p>${holder}</main><script type="module">
import {createPersistentWatchMount} from '/broker-persistent-watch-mount.js';
const owner='0x'+'1'.repeat(40);
window.fixture={selection:{owner,tokenId:'93',chainId:4663,context:'PRODUCTION',preview:false},
  signed:false,expiresAt:new Date(Date.now()+3600000).toISOString(),signIns:0,walletRequests:0,posts:[],draft:null,watch:JSON.parse(sessionStorage.getItem('watch')||'null')};
window.ethereum={request(){fixture.walletRequests++;throw Error('NO_WALLET_ALLOWED')}};
const request=async(path,options={})=>{
  if(path==='/api/v2/session'){
    if(!fixture.signed)throw Object.assign(Error('Sign in'),{code:'V2_SESSION_REQUIRED'});
    return {authenticated:true,walletAddress:fixture.selection.owner,expiresAt:fixture.expiresAt};
  }
  if(!/^\\/api\\/v2\\/punks\\/[0-9]+\\/persistent-watch$/.test(path))throw Error('UNEXPECTED_PATH');
  const tokenId=path.split('/')[4],body=options.body?JSON.parse(options.body):null;
  if(body){fixture.posts.push(body);if(body.action==='prepare'){
    fixture.draft={draftId:'fixture-draft',config:body.config};return {ok:true,tokenId,draft:fixture.draft};}
    if(body.action==='confirm')fixture.watch={tokenId,owner,version:(fixture.watch?.version??0)+1,state:'ACTIVE',config:fixture.draft.config};
    if(body.action==='pause')fixture.watch={...fixture.watch,state:'PAUSED',version:fixture.watch.version+1};
    sessionStorage.setItem('watch',JSON.stringify(fixture.watch));
  }
  const watch=fixture.watch?.tokenId===tokenId?fixture.watch:null;
  return {ok:true,tokenId,watch,status:watch?{watching:watch.state==='ACTIVE',state:watch.state}:null,
    history:[],summary:{reviewed:0,matched:0,passed:0}};
};
window.watchMount=createPersistentWatchMount({root:document.querySelector('[data-persistent-watch]'),getSelection:()=>fixture.selection,
 request,ensureSession:async()=>{fixture.signIns++;fixture.signed=true}});
await watchMount.selectionChanged();
</script></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    const file = resolve(site, '.' + path);
    if (!file.startsWith(site + '/') || !/\.(js|css|woff2)$/.test(file)) throw Error('NOT_FOUND');
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'font/woff2');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`, profile = await mkdtemp('/private/tmp/gogh-watch-browser-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu',
  '--disable-background-networking', '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20000);
    chrome.once('error', reject); chrome.stderr.on('data', chunk => {
      output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    });
  });
  const tab = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [];
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const next = ++id, timer = setTimeout(() => reject(Error('CDP_TIMEOUT')), 20000);
    pending.set(next, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  ws.onmessage = ({ data }) => { const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result); }
  };
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return;
    await new Promise(r => setTimeout(r, 100)); } throw Error('UI_TIMEOUT ' + expression + JSON.stringify(errors)); };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(n=>n.textContent===${JSON.stringify(text)}&&!n.disabled).click()`);
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.navigate', { url: origin });
  await until('typeof watchMount === "object" && !document.querySelector(".persistent-watch-access button").disabled');
  assert.equal(await evaluate('fixture.signIns'), 0); assert.equal(await evaluate('fixture.posts.length'), 0);
  await click('Sign in to manage watching'); await until('!!document.querySelector(".persistent-watch-form")');
  assert.equal(await evaluate('fixture.signIns'), 1);
  await evaluate('document.querySelector("input[name=likes]").value="pixel, <img src=x onerror=alert(1)>"');
  await click('Review watching settings'); await until('!!document.querySelector(".persistent-watch-review")');
  assert.deepEqual(await evaluate('fixture.posts.map(p=>p.action)'), ['prepare']);
  assert.equal(await evaluate('document.querySelectorAll(".persistent-watch-review img").length'), 0);
  const evidence = { status: 'PASS', environment: 'LOCAL_FIXTURE_ONLY', screenshots: [], scenarios: [], walletRequests: 0, publicTransactions: 0 };
  for (const width of [1440, 768, 375, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const layout = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:Array.from(document.querySelectorAll(".persistent-watch button")).map(n=>n.getBoundingClientRect().height)})');
    assert.ok(layout.scroll <= layout.width + 1, `No overflow at ${width}`); assert.ok(layout.buttons.every(height => height >= 44));
    const screenshot = `/private/tmp/gogh-watch-review-${width}.png`, shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(screenshot, Buffer.from(shot.data, 'base64')); evidence.screenshots.push(screenshot);
  }
  await click('Confirm · activate watching'); await until('document.body.textContent.includes("OUT LOOKING")');
  assert.deepEqual(await evaluate('fixture.posts.map(p=>p.action)'), ['prepare', 'confirm']);
  await call('Page.reload'); await until('typeof watchMount === "object" && !document.querySelector(".persistent-watch-access button").disabled');
  assert.equal(await evaluate('fixture.signIns'), 0); await click('Sign in to manage watching');
  await until('document.body.textContent.includes("OUT LOOKING")');
  await click('Pause watching'); await until('document.body.textContent.includes("WATCHING PAUSED")');
  assert.equal(await evaluate('fixture.watch.state'), 'PAUSED');
  await evaluate('document.querySelector("details").open=true'); await click('Review watching settings');
  await until('!!document.querySelector(".persistent-watch-review")');
  await evaluate('fixture.expiresAt=new Date(Date.now()+7200000).toISOString()');
  await click('Confirm · activate watching'); await until('document.body.textContent.includes("sign-in changed")');
  assert.deepEqual(await evaluate('fixture.posts.map(p=>p.action)'), ['pause', 'prepare']);
  await evaluate('fixture.selection={...fixture.selection,chainId:1};watchMount.selectionChanged()');
  assert.equal(await evaluate('document.querySelector(".persistent-watch-access button").hidden'), true);
  assert.equal(await evaluate('fixture.walletRequests'), 0); assert.deepEqual(errors, []);
  evidence.scenarios = ['explicit sign-in only', 'prepare before explicit confirmation', 'untrusted taste rendered as text',
    'four responsive widths and 44px buttons', 'saved watch restored after reload', 'explicit pause', 'changed session discards draft', 'wrong-chain invalidation'];
  evidence.checkedAt = new Date().toISOString();
  await writeFile('docs/v2-release-campaign/persistent-watch-browser-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ ...evidence, screenshots: evidence.screenshots.length }));
} finally {
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(r => { const timer = setTimeout(r, 3000); chrome.once('exit', () => { clearTimeout(timer); r(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); await new Promise(r => { server.close(r); server.closeAllConnections(); });
}
