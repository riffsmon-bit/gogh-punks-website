import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleForge } from '../netlify/functions/broker-v2-forge.mjs';
import deployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { createFloorHunterV1 } from '../broker/src/v4/skill-forge/floor-hunter-v1.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--fixture-only') throw Error('Requires --fixture-only; never uses a wallet or public chain');
const root = fileURLToPath(new URL('../site/', import.meta.url)), owner = `0x${'1'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`, zero = `0x${'0'.repeat(40)}`;
const client = { ccipRead: false, getChainId: async () => 4663, getBlock: async () => ({ number: 100n, hash }),
  getCode: async () => '0x6001600055', getStorageAt: async () => `0x${'0'.repeat(64)}`,
  readContract: async args => args.functionName === 'supportsInterface' ? true
    : `data:application/json;base64,${Buffer.from(JSON.stringify({ name: `Punk #${args.args[0]}`,
      attributes: [{ trait_type: 'Style', value: args.args[0] === 95n ? '<img src=x onerror=alert(1)>' : 'Pixel Art' }] })).toString('base64')}` };
let actionCalls = 0, failure = false;
const deps = { pool: null, manifest: { ...deployment, status: 'UNDEPLOYED', registry: null, registryCodeHash: null,
  progression: null, progressionCodeHash: null, trainingSource: null, trainingSourceCodeHash: null },
  environment: { GOGH_FORGE_TEST_OWNER: owner, OPENSEA_API_KEY: 'LOCAL_BROWSER_FIXTURE' },
  sessionReader: async () => ({ walletAddress: owner }), authorityReader: async () => ({ owner, punkWallet: owner }),
  continuityReader: async () => { if (failure) throw Error('FIXTURE_CHAIN_UNAVAILABLE'); }, originCheck: () => {}, clientFactory: () => client,
  floorFactory: options => createFloorHunterV1({ ...options, fetchImpl: async url => {
    if (url.includes('/collections/')) return Response.json({ name: 'Gogh', contracts: [{ chain: 'robinhood', address: deployment.collection }] });
    const stamp = Math.floor(Date.now() / 1000), amount = '900719925474099312345';
    return Response.json({ listings: [{ chain: 'robinhood', order_hash: hash, protocol_address: '0x0000000000000068f116a894984e2db1123eb395',
      status: 'ACTIVE', remaining_quantity: 1, asset: { contract: deployment.collection, identifier: '96' },
      price: { current: { value: amount, currency: 'ETH', decimals: 18 } }, protocol_data: { parameters: {
        offerer: owner, zone: zero, orderType: 0, startTime: String(stamp - 1), endTime: String(stamp + 600),
        offer: [{ itemType: 2, token: deployment.collection, identifierOrCriteria: '96', startAmount: '1', endAmount: '1' }],
        consideration: [{ itemType: 0, token: zero, identifierOrCriteria: '0', startAmount: amount, endAmount: amount, recipient: owner }], totalOriginalConsiderationItems: 1 } } }], next: null });
  } }) };
const page = await readFile(`${root}/broker/v2/index.html`, 'utf8');
const fragment = page.slice(page.indexOf('<section class="broker-panel" data-v2-panel="forge"'), page.indexOf('<section class="broker-panel" data-v2-panel="settings"'));
assert.ok(fragment.includes('data-forge-report'));
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/broker-v2.css"><link rel="stylesheet" href="/broker-v2-forge.css"><style>html{scroll-behavior:auto!important}body{padding:12px}main{max-width:1280px;margin:auto}.forge-research-summary{overflow-wrap:anywhere}</style><main>${fragment}</main><script type="module">
import {createForgeControl} from '/broker-v2-forge.js';
window.fixtureSelection={owner:'${owner}',tokenId:'93',chainId:4663,preview:false};
window.walletRequests=0;window.ethereum={request:()=>{walletRequests++;throw Error('NO_WALLET_ALLOWED')}};
const root=document.querySelector('[data-v2-panel=forge]');root.hidden=false;
window.forgeFixture=createForgeControl({root,getSelection:()=>fixtureSelection,ensureSession:async()=>{},request:async(path,options)=>{
const response=await fetch(path,options),data=await response.json();if(!response.ok)throw Error(data.message);return data;}});
</script>`;
const server = createServer(async (req, res) => { try {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (path === '/fixture/fail') { failure = true; res.end('ok'); return; }
  if (/^\/api\/v2\/punks\/\d+\/forge$/.test(path)) {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.method === 'POST') actionCalls++;
    const response = await handleForge(new Request('https://goghpunks.xyz' + path, { method: req.method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}) }), deps);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
  }
  const file = resolve(root, '.' + path); if (!file.startsWith(root) || !/\.(?:js|css|png|woff2)$/.test(file)) throw Error('NOT_FOUND');
  res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'font/woff2');
  res.end(await readFile(file));
} catch { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`, profile = await mkdtemp('/private/tmp/gogh-research-browser-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => { let text = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20000); chrome.once('error', reject); chrome.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); });
  const tab = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id, timer = setTimeout(() => reject(Error('CDP_TIMEOUT')), 30000); pending.set(next, { resolve: v => { clearTimeout(timer); resolve(v); }, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
  ws.onmessage = ({ data }) => { const msg = JSON.parse(data); if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); } };
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('UI_TIMEOUT ' + expression + JSON.stringify(errors) + await evaluate("document.querySelector('[data-forge-status]').textContent+' '+document.querySelector('[data-forge-report]').textContent")); };
  const click = title => evaluate(`Array.from(document.querySelectorAll('.forge-skill')).find(n=>n.querySelector('h3').textContent===${JSON.stringify(title)}).querySelector('button:not(:disabled)').click()`);
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.navigate', { url: origin });
  await until('typeof forgeFixture === "object"');
  assert.equal(await evaluate('walletRequests'), 0); assert.equal(actionCalls, 0);
  await evaluate('document.querySelector("[data-forge-connect]").click()'); await until('document.querySelector("[data-forge-status]").textContent.includes("OWNER VERIFIED")');
  await evaluate('document.querySelector(".forge-research-examples > summary").click()');
  assert.equal(await evaluate('document.querySelector(".forge-research-examples").open'), true);
  const evidence = { status: 'PASS', environment: 'LOCAL_FIXTURE_ONLY', screenshots: [], scenarios: [], publicTransactions: 0, walletRequests: 0 };
  for (const [title, text] of [['Floor Hunter', '900.719925474099312345'], ['Collection Researcher', 'Metadata available for 3 of 3'], ['Art Curator', '2 sampled Punks have a recognized']]) {
    await click(title); await until(`document.querySelector('[data-forge-report]').textContent.includes(${JSON.stringify(text)})`);
    assert.equal(await evaluate('document.querySelectorAll(".forge-research-summary img").length'), 0);
    for (const width of [1440, 768, 375, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      await evaluate('document.querySelector("[data-forge-report]").scrollIntoView({block:"start",behavior:"instant"})');
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${title} overflow ${width}`);
      const visible = await evaluate('({top:document.querySelector(".forge-research-summary").getBoundingClientRect().top,height:innerHeight,scroll:scrollY,report:document.querySelector("[data-forge-report]").getBoundingClientRect().top,body:document.body.scrollHeight,html:document.documentElement.scrollHeight})');
      assert.ok(visible.top < visible.height, `${title} result visible ${width}: ${JSON.stringify(visible)}`);
      const screenshot = `/private/tmp/gogh-research-${title.toLowerCase().replaceAll(' ', '-')}-${width}.png`;
      const shot = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(screenshot, Buffer.from(shot.data, 'base64')); evidence.screenshots.push(screenshot);
    }
    evidence.scenarios.push(title);
  }
  await evaluate('fetch("/fixture/fail")'); await click('Collection Researcher');
  await until('document.querySelector("[data-forge-status]").textContent.includes("could not be verified")');
  assert.equal(await evaluate('document.querySelector("[data-forge-report]").textContent'), '');
  assert.equal(await evaluate('document.querySelectorAll(".forge-skill button:not(:disabled)").length'), 0);
  await evaluate('fixtureSelection={...fixtureSelection,tokenId:"94"};forgeFixture.selectionChanged()');
  assert.equal(await evaluate('document.querySelector("[data-forge-report]").textContent'), '');
  assert.equal(await evaluate('walletRequests'), 0); assert.equal(actionCalls, 4); assert.deepEqual(errors, []);
  evidence.scenarios.push('failed chain read clears previous research', 'selection change clears result', 'untrusted metadata cannot create HTML', 'no wallet requests');
  evidence.checkedAt = new Date().toISOString(); await writeFile('docs/v2-hardening/planned-research-browser-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ ...evidence, screenshots: evidence.screenshots.length }));
} finally {
  ws?.close(); chrome.kill('SIGTERM'); if (chrome.exitCode === null) await new Promise(r => { const timer = setTimeout(r, 3000); chrome.once('exit', () => { clearTimeout(timer); r(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); await new Promise(r => { server.close(r); server.closeAllConnections(); });
}
