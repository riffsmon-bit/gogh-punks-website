import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeFunctionData, parseAbi } from 'viem';
import { createSkillAdminCoordinator } from '../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import { handleForgeSkillAdmin } from '../netlify/functions/broker-v2-forge-skill-admin.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import { skillAdminFixture, ADMIN, TX } from '../tests/fixtures/skill-admin.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--mock-wallet-only') throw Error('Requires --mock-wallet-only');
const site = new URL('../site/', import.meta.url);
const output = await mkdtemp(join(tmpdir(), 'gogh-skill-admin-browser-evidence-'));
const profile = await mkdtemp(join(tmpdir(), 'gogh-skill-admin-browser-profile-'));
const OTHER = `0x${'2'.repeat(40)}`;
let fixture = skillAdminFixture(), coordinator = createSkillAdminCoordinator(fixture), origin;
let backendSends = 0, backendRequests = [];
let dormant = false;
const pausedMask = String(((1n << 256n) - 1n) ^ 8n);
const statusAbi = parseAbi(['function setStatus(bytes32,uint8,bytes32)']);
function nextDormantStep(status) {
  fixture.skill.capabilityPaused = true;
  fixture.skill.available = false;
  fixture.skill.registeredStatus = status;
  fixture.skill.existingReviewEvidenceHash = fixture.skill.evidenceHash;
  fixture.state.disabledCapabilities = pausedMask;
  fixture.state.globallyDisabled = false;
  fixture.preparation.disabledCapabilities = pausedMask;
  fixture.preparation.capabilityPaused = true;
  fixture.preparation.expiresAt = Date.now() + 60000;
  fixture.skill.action = status === null ? 'REGISTER' : status === 0 ? 'MARK_TESTING' : status === 3 ? 'MARK_READY' : 'READY_CAPABILITY_PAUSED';
  if (status === 0 || status === 3) {
    fixture.preparation.action = fixture.skill.action;
    fixture.preparation.transaction.data = encodeFunctionData({ abi: statusAbi, functionName: 'setStatus',
      args: [fixture.skill.key, status === 0 ? 3 : 4, fixture.skill.evidenceHash] });
  }
  fixture.skill.nextCalldata = status === 4 ? null : fixture.preparation.transaction.data;
}

function browserFixture({ administrator, other, hash }, createPanel) {
  const defaults = () => ({ owner: administrator, chainId: 4663, mode: 'normal', sessionOwner: null,
    sends: 0, signIns: 0, methods: [], operations: [] });
  let state = JSON.parse(sessionStorage.getItem('admin-browser-fixture') || 'null') ?? defaults();
  let panel, waiters = [];
  const save = () => sessionStorage.setItem('admin-browser-fixture', JSON.stringify(state));
  const control = async (action, input = {}) => {
    const response = await fetch('/fixture/control', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...input }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.message);
    return result;
  };
  const provider = { request: async ({ method, params }) => {
    state.methods.push(method); save();
    if (method === 'eth_accounts') return state.owner ? [state.owner] : [];
    if (method === 'eth_chainId') return `0x${state.chainId.toString(16)}`;
    if (method === 'personal_sign') {
      state.signIns++; save();
      if (state.mode === 'hold-sign-in') await new Promise(resolve => waiters.push(resolve));
      return 'LOCAL_FIXTURE_SIGNATURE_ONLY';
    }
    if (method !== 'eth_sendTransaction') throw Error('UNEXPECTED_WALLET_METHOD');
    state.sends++; save();
    if (state.mode === 'wallet-reject') throw Object.assign(Error('Local fixture user rejected confirmation'), { code: 4001 });
    const sent = await control('send', { transaction: params[0], outcome: state.mode });
    if (state.mode === 'lost-wallet-response') throw Error('Local fixture wallet response lost. Recover the transaction hash from wallet activity.');
    return sent.transactionHash;
  } };
  const ensureSession = async () => {
    if (!state.owner || state.chainId !== 4663) throw Error('Connect the current administrator on Robinhood Chain.');
    if (state.sessionOwner === state.owner) return;
    const owner = state.owner;
    await provider.request({ method: 'personal_sign', params: ['LOCAL MOCK SIGN-IN — NOT A REAL AUTHORIZATION', owner] });
    if (state.owner !== owner || state.chainId !== 4663) throw Error('Wallet selection changed during mock sign-in.');
    state.sessionOwner = owner; save();
  };
  const request = async (url, options = {}) => {
    const actor = state.sessionOwner, operation = options.body ? JSON.parse(options.body).operation : 'get';
    state.operations.push(operation); save();
    if (state.mode === 'hold-read' && operation === 'get') await new Promise(resolve => waiters.push(resolve));
    if (state.mode === 'long-error') throw Error('<img src=x onerror=alert(1)> ' + 'UNBROKEN_ERROR_'.repeat(45));
    const response = await fetch(url, { ...options, headers: { ...options.headers, 'x-fixture-session': actor ?? '' } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(Error(result.message), { code: result.code });
    if (state.mode === 'lost-claim-response' && operation === 'claim') throw Error('Local fixture claim acknowledgement lost.');
    return result;
  };
  function mount() {
    panel?.destroy();
    panel = createPanel({ root: document.querySelector('[data-forge-skill-admin]'),
      getSelection: () => ({ owner: state.owner, chainId: state.chainId, preview: false }),
      ensureSession, request, getProvider: () => provider, storage: localStorage });
  }
  window.__admin = {
    hash, administrator, other,
    state: () => structuredClone(state),
    backend: () => control('state'),
    text: () => document.querySelector('[data-forge-skill-admin]').textContent,
    controls: () => [...document.querySelectorAll('[data-forge-skill-admin] button')].map(b => ({ text: b.textContent, disabled: b.disabled })),
    async reset(owner = administrator) {
      await control('reset'); localStorage.clear(); state = { ...defaults(), owner }; save();
      document.querySelector('details').open = true; mount();
    },
    dormant: () => control('dormant'),
    mode(value) { state.mode = value; if (value === 'hold-sign-in') state.sessionOwner = null; save(); },
    select(owner, chainId = 4663) { state.owner = owner; state.chainId = chainId; save(); panel.update(); },
    waiting: () => waiters.length,
    releaseWaiters() { const pending = waiters; waiters = []; pending.forEach(resolve => resolve()); },
    refresh: () => panel.refresh(),
    confirmReceipt: () => control('confirm'),
    saved: () => [...Array(localStorage.length)].map((_, i) => JSON.parse(localStorage.getItem(localStorage.key(i)))),
  };
  mount(); window.__adminReady = true;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/broker-v2.css"><link rel="stylesheet" href="/broker-v2-forge.css">
<style>body{padding:24px 16px}.fixture-shell{max-width:760px;margin:0 auto}.fixture-note{font-size:12px;color:var(--muted)}h1{font-size:24px}</style></head>
<body><main class="fixture-shell"><p class="fixture-note">LOCAL MOCK WALLET · NO PUBLIC TRANSACTIONS</p><h1>Gogh Punks / Settings</h1>
<details class="forge-admin-settings"><summary>Project administration</summary><p>For the current Skill Forge administrator. To train your own Punk, open Skills.</p><div data-forge-skill-admin></div></details></main>
<script type="module">import {createForgeSkillAdminPanel} from '/forge-skill-admin-panel.js';
(${browserFixture.toString()})(${JSON.stringify({ administrator: ADMIN, other: OTHER, hash: TX })},createForgeSkillAdminPanel);</script></body></html>`;
const allowed = new Set(['/forge-skill-admin-panel.js', '/broker-v2.css', '/broker-v2-forge.css']);
const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  const send = (value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  try {
    if (request.method === 'GET' && request.url === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    if (request.method === 'GET' && allowed.has(request.url)) {
      response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(new URL(request.url.slice(1), site))); return;
    }
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 16384) throw Error('LOCAL_BODY_TOO_LARGE'); }
    if (request.url === '/fixture/control' && request.method === 'POST') {
      const input = JSON.parse(body);
      if (input.action === 'reset') {
        fixture = skillAdminFixture(); coordinator = createSkillAdminCoordinator(fixture); backendSends = 0; backendRequests = []; dormant = false;
      } else if (input.action === 'dormant') {
        assert.equal(fixture.row, null); dormant = true; nextDormantStep(null);
      } else if (input.action === 'send') {
        assert.equal(fixture.row?.status, 'WALLET_REQUESTED');
        const cancellation = input.transaction.data === '0x';
        const expected = cancellation ? fixture.cancellations.findLast(row => row.status === 'WALLET_REQUESTED')?.preparation.transaction
          : fixture.row.preparation.transaction;
        assert.deepEqual(input.transaction, expected, 'Mock wallet must receive exact claimed transaction');
        backendSends++;
        Object.assign(fixture.observed, { to: input.transaction.to, input: input.transaction.data,
          nonce: Number(BigInt(input.transaction.nonce)),
          gas: BigInt(input.transaction.gas), gasPrice: BigInt(input.transaction.gasPrice) });
        fixture.receipt.to = input.transaction.to;
        fixture.receipt.status = input.outcome === 'reverted' ? 'reverted' : 'success';
        fixture.skill.registeredStatus = cancellation ? null : 0;
        if (dormant && !cancellation) {
          fixture.observed.hash = `0x${String(backendSends).padStart(64, '0')}`;
          fixture.receipt.transactionHash = fixture.observed.hash;
          nextDormantStep({ REGISTER: 0, MARK_TESTING: 3, MARK_READY: 4 }[fixture.row.action]);
          fixture.preparation.transaction.nonce = `0x${(BigInt(input.transaction.nonce) + 1n).toString(16)}`;
        }
        for (const client of fixture.clients) client.getBlockNumber = async () => input.outcome === 'pending' ? 109n : 111n;
      } else if (input.action === 'confirm') {
        for (const client of fixture.clients) client.getBlockNumber = async () => 111n;
      } else if (input.action !== 'state') throw Error('LOCAL_CONTROL_INVALID');
      send({ row: fixture.row, cancellations: fixture.cancellations, backendSends, backendRequests,
        transactionHash: fixture.observed.hash, disabledCapabilities: fixture.state.disabledCapabilities }); return;
    }
    if (request.url?.startsWith('/api/v2/admin/forge/skills') && ['GET', 'POST'].includes(request.method)) {
      backendRequests.push(body ? JSON.parse(body).operation : 'get');
      const result = await handleForgeSkillAdmin(new Request(`${origin}${request.url}`, {
        method: request.method, headers: request.headers, ...(request.method === 'POST' ? { body } : {}),
      }), { runtimeFactory: async () => ({ coordinator }), sessionPool: () => ({}),
        sessionReader: async incoming => {
          const walletAddress = incoming.headers.get('x-fixture-session');
          if (![ADMIN, OTHER].includes(walletAddress)) throw new PublicError(401, 'LOCAL_SESSION_REQUIRED', 'Mock wallet sign-in required.');
          return { walletAddress };
        }, originCheck: incoming => {
          if (incoming.headers.get('origin') !== origin) throw new PublicError(403, 'LOCAL_ORIGIN_REQUIRED', 'Local origin required.');
        } });
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
    }
    response.writeHead(404); response.end();
  } catch (error) { send({ message: error.message }, 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-proxy-server',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let ws, result = { status: 'RUNNING', output, scenarios: [], screenshots: [] };
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('CHROME_START_TIMEOUT')), 20_000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const target = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), exceptions = [], publicRequests = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const number = ++id, timer = setTimeout(() => { pending.delete(number); reject(Error(`CDP_TIMEOUT_${method}`)); }, 20_000);
    pending.set(number, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: number, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith(`${origin}/`)
      && !message.params.request.url.startsWith('data:')) publicRequests.push(message.params.request.url);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      void call(request.url.startsWith(`${origin}/`) ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        request.url.startsWith(`${origin}/`) ? { requestId } : { requestId, errorReason: 'BlockedByClient' });
    }
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); message.error ? waiting.reject(Error(message.error.message)) : waiting.resolve(message.result); }
  };
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  };
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 80)); }
    throw Error(`UI_TIMEOUT: ${expression}`);
  };
  const click = label => evaluate(`(()=>{const button=[...document.querySelectorAll('[data-forge-skill-admin] button')].find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled);if(!button)throw Error('BUTTON_UNAVAILABLE');button.click();})()`);
  const idle = () => until(`__admin.controls().some(b=>b.text==='RECHECK SKILL RELEASES'&&!b.disabled)`);
  const check = async () => { await click('RECHECK SKILL RELEASES'); await idle(); };
  const review = async () => {
    await check(); await click('REVIEW NEXT REGISTRY STEP');
    await until(`__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET'&&!b.disabled)`);
  };
  const reset = async () => { await evaluate('__admin.reset()'); };
  const reload = async () => {
    await evaluate('window.__adminReady=false'); await call('Page.reload');
    await until('window.__adminReady===true'); await evaluate("document.querySelector('details').open=true");
  };
  const screenshot = async (name, width) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 812 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const metrics = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      smallControls:[...document.querySelectorAll('button,input,summary')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44).map(e=>e.textContent),
      overflowingControls:[...document.querySelectorAll('button,input,summary')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left<0)).map(e=>e.textContent)})`);
    const file = join(output, `${name}-${width}.png`);
    await writeFile(file, Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
    result.screenshots.push({ file, ...metrics });
    assert.equal(metrics.scrollWidth <= metrics.width, true, `Page overflow in ${name} at ${width}`);
    assert.deepEqual(metrics.smallControls, [], `Small tap targets in ${name}`);
    assert.deepEqual(metrics.overflowingControls, [], `Control overflow in ${name}`);
  };
  const scenario = (name, detail = {}) => { result.scenarios.push({ name, ...detail }); };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
  const version = await call('Browser.getVersion');
  await call('Page.navigate', { url: origin }); await until('window.__adminReady===true');
  assert.equal(await evaluate("document.querySelector('details').open"), false);
  assert.equal(await evaluate('__admin.state().operations.length+__admin.state().signIns+__admin.state().sends'), 0);
  await screenshot('collapsed-settings', 1440);
  scenario('collapsed administration mounts without sign-in, API reads or wallet requests');

  await evaluate('__admin.reset(null)');
  assert.equal(await evaluate("__admin.controls().find(b=>b.text==='RECHECK SKILL RELEASES').disabled"), true);
  await screenshot('disconnected', 375);
  await evaluate('__admin.reset(__admin.other)'); await check();
  assert.match(await evaluate('__admin.text()'), /Only the current Forge administrator/);
  assert.equal(await evaluate("__admin.text().includes('Social Scout')"), false);
  assert.equal(await evaluate('__admin.state().sends'), 0); await screenshot('not-administrator', 375);
  scenario('disconnected controls disabled and non-administrator cannot inspect saved skills');

  await reset(); await review();
  assert.equal(await evaluate('__admin.state().signIns'), 1);
  assert.equal(await evaluate('__admin.state().sends'), 0);
  for (const width of [1440, 375, 320]) await screenshot('registration-review', width);
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('Registry step confirmed')");
  assert.equal(await evaluate('__admin.state().sends'), 1);
  assert.equal(fixture.row.status, 'CONFIRMED');
  assert.equal(backendSends, 1);
  for (const width of [1440, 375]) await screenshot('registration-confirmed', width);
  await reload(); assert.equal(await evaluate('__admin.state().sends'), 1);
  await check(); assert.equal(await evaluate('__admin.state().sends'), 1);
  scenario('explicit mock sign-in, exact claimed registration and confirmed receipt; reload does not resend');

  await reset(); await evaluate('__admin.dormant()');
  for (const action of ['REGISTER', 'MARK_TESTING', 'MARK_READY']) {
    await review(); assert.equal(fixture.row.action, action);
    assert.match(await evaluate('__admin.text()'), /capability is currently paused/);
    assert.equal(fixture.row.preparation.disabledCapabilities, pausedMask);
    await screenshot(`capability-paused-${action.toLowerCase()}`, 375);
    await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('Registry step confirmed')");
    assert.equal(fixture.row.status, 'CONFIRMED'); assert.equal(fixture.state.disabledCapabilities, pausedMask);
  }
  assert.match(await evaluate('__admin.text()'), /Registry READY; read capability still paused/);
  assert.match(await evaluate('__admin.text()'), /Holder use is unavailable/);
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='REVIEW NEXT REGISTRY STEP')"), false);
  assert.equal(backendSends, 3); assert.equal(await evaluate('__admin.state().sends'), 3);
  for (const width of [1440, 375, 320]) await screenshot('ready-capability-paused', width);
  await reload(); await check();
  assert.equal(await evaluate('__admin.state().sends'), 3);
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='REVIEW NEXT REGISTRY STEP')"), false);
  scenario('three reviewed read-only registry steps preserve capability pause; READY has no activation or holder-availability claim');

  await reset(); await review(); await evaluate("__admin.mode('wallet-reject')");
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('Wallet confirmation was rejected')");
  assert.equal(fixture.row.status, 'WALLET_REQUESTED'); assert.equal(backendSends, 0);
  await screenshot('wallet-rejected', 375);
  await reload(); await check();
  assert.equal(await evaluate('__admin.state().sends'), 1);
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET')"), false);
  await evaluate("__admin.mode('normal')"); await click('REVIEW NONCE CANCELLATION');
  await until("__admin.controls().some(b=>b.text==='CONFIRM CANCELLATION IN WALLET'&&!b.disabled)");
  for (const width of [1440, 375, 320]) await screenshot('nonce-cancellation-review', width);
  await click('CONFIRM CANCELLATION IN WALLET'); await until("__admin.text().includes('reserved nonce was consumed')");
  assert.equal(fixture.row.status, 'REPLACED'); assert.equal(fixture.row.receipt.selfAccountCode, '0x');
  assert.equal(await evaluate('__admin.state().sends'), 2); assert.equal(backendSends, 1);
  await screenshot('nonce-replaced', 375);
  scenario('rejected original stays reserved; explicit zero-value same-nonce cancellation settles replacement');

  await reset(); await review(); await evaluate("__admin.mode('lost-wallet-response')");
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('wallet response lost')");
  assert.equal(await evaluate('__admin.saved()[0].transactionHash'), null);
  assert.equal(fixture.row.status, 'WALLET_REQUESTED'); assert.equal(backendSends, 1);
  await reload(); await check(); assert.equal(await evaluate('__admin.state().sends'), 1);
  await screenshot('lost-wallet-response-recovery', 375);
  await evaluate("document.querySelector('[data-forge-skill-admin] input').value=__admin.hash");
  await click('RECOVER TRANSACTION'); await until("__admin.text().includes('Registry step confirmed')");
  assert.equal(fixture.row.status, 'CONFIRMED'); assert.equal(await evaluate('__admin.state().sends'), 1);
  scenario('lost wallet hash survives reload as uncertainty and manual receipt recovery never resends');

  await reset(); await review(); await evaluate("__admin.mode('lost-claim-response')");
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('claim acknowledgement lost')");
  assert.equal(fixture.row.status, 'WALLET_REQUESTED'); assert.equal(await evaluate('__admin.state().sends'), 0);
  await reload(); await check(); assert.equal(await evaluate('__admin.state().sends'), 0);
  assert.equal(backendRequests.filter(value => value === 'claim').length, 1);
  scenario('lost claim acknowledgement reserves the review and never opens the wallet after reload');

  await reset(); await review(); await evaluate("__admin.mode('pending')");
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('12 confirmations')");
  assert.equal(fixture.row.status, 'SUBMITTED');
  await screenshot('pending-confirmations', 375); await reload(); await check();
  assert.equal(fixture.row.status, 'SUBMITTED'); assert.equal(await evaluate('__admin.state().sends'), 1);
  await evaluate('__admin.confirmReceipt()'); await check();
  assert.equal(fixture.row.status, 'CONFIRMED'); assert.equal(await evaluate('__admin.state().sends'), 1);
  scenario('pending receipt remains submitted across reload until twelve matching mock confirmations');

  await reset(); await review(); await evaluate("__admin.mode('reverted')");
  await click('CONFIRM REGISTRY STEP IN WALLET'); await until("__admin.text().includes('transaction reverted')");
  assert.equal(fixture.row.status, 'REVERTED'); await screenshot('registration-reverted', 375);
  scenario('reverted original is reconciled without reporting successful registration');

  await reset(); await review(); await evaluate('__admin.select(__admin.other)');
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET')"), false);
  assert.equal(await evaluate("__admin.text().includes('Social Scout')"), false);
  await check(); assert.match(await evaluate('__admin.text()'), /Only the current Forge administrator/);
  assert.equal(await evaluate("__admin.text().includes('Social Scout')"), false);
  assert.equal(fixture.row.administrator, ADMIN);
  await evaluate('__admin.select(__admin.administrator)'); await check();
  await evaluate('__admin.select(__admin.administrator,1)');
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET')"), false);
  assert.equal(await evaluate("__admin.controls().find(b=>b.text==='RECHECK SKILL RELEASES').disabled"), true);
  await evaluate('__admin.select(__admin.administrator)'); await check();
  await evaluate("__admin.mode('hold-sign-in')"); await click('CONFIRM REGISTRY STEP IN WALLET');
  await until('__admin.waiting()===1');
  await evaluate('__admin.select(__admin.administrator,1);__admin.select(__admin.administrator);__admin.releaseWaiters()');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate('__admin.state().sends'), 0); assert.equal(fixture.row.status, 'PREPARED');
  scenario('account and chain changes clear stale reviews; a chain round trip during sign-in cannot claim');

  await reset(); await review(); await evaluate("__admin.mode('hold-read');window.__held=__admin.refresh();true");
  await until('__admin.waiting()===1');
  await evaluate('__admin.select(__admin.other);__admin.select(__admin.administrator);__admin.releaseWaiters();__held');
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET')"), false);
  assert.equal(await evaluate('__admin.state().sends'), 0);
  scenario('account round trip discards stale administrator API response');

  await reset(); await review(); await evaluate("__admin.mode('long-error')"); await check();
  assert.match(await evaluate('__admin.text()'), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await evaluate("document.querySelector('[data-forge-skill-admin] img')===null"), true);
  assert.equal(await evaluate("__admin.controls().some(b=>b.text==='CONFIRM REGISTRY STEP IN WALLET')"), false);
  for (const width of [1440, 375, 320]) await screenshot('long-error', width);
  scenario('long untrusted error stays literal text, removes stale actions and fits desktop/small iPhone');

  assert.deepEqual(exceptions, []); assert.deepEqual(publicRequests, []);
  result = { ...result, status: 'PASS', checkedAt: new Date().toISOString(), browser: version.product,
    widths: [1440, 375, 320], publicRequests: 0, publicTransactions: 0, browserExceptions: 0,
    actualPanelAndStyles: true, actualApiHandlerAndCoordinator: true,
    limitations: ['Isolated local Chrome with mock personal_sign, wallet and chain transport; no extension or public chain.',
      'In-memory fixture store and registry preparation; native SQL durability and live deployment are separate gates.',
      'Settings administration section is mounted with production markup/styles; the complete broker shell is not exercised.'] };
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result = { ...result, status: 'FAIL', error: error.message };
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.error(JSON.stringify(result, null, 2)); throw error;
} finally {
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
