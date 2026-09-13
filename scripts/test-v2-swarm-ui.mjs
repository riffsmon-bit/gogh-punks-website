import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

// Real Control Center HTML/CSS/modules, served only on loopback. The wallet
// bootstrap is omitted; optional fixture controls replace authority dependencies.
// This is browser/UI evidence, never an ownership, RPC or transaction proof.
if (process.argv.length !== 3 || process.argv[2] !== '--mock-wallet-only') throw Error('Requires --mock-wallet-only');
const root = process.env.GOGH_UI_SITE_ROOT ? resolve(process.env.GOGH_UI_SITE_ROOT) : fileURLToPath(new URL('../site/', import.meta.url));
const assetsRoot = process.env.GOGH_UI_ASSET_ROOT ? resolve(process.env.GOGH_UI_ASSET_ROOT) : root;
const output = process.env.GOGH_UI_OUTPUT_DIR || '/private/tmp/gogh-v2-swarm-ux';
await mkdir(output, { recursive: true });
const fixture = String.raw`
const uxCalls = { session: 0, prepare: 0, submit: 0, refresh: 0, recover: 0, wallet: 0, forge: 0 };
let uxClock = Date.now(), uxState = { status: 'EMPTY', review: null }, uxChange;
let uxRelease = null, uxDelay = false, uxFailure = null, uxForgeFailure = null;
const uxSelected = { tokenId: '93', owner: '0x1111111111111111111111111111111111111111', chainId: 4663, preview: false };
const uxProvider = { request: async () => { uxCalls.wallet++; throw Error('Mock provider denies every wallet/RPC request'); } };
const uxReview = intent => ({ schema: 'GOGH_AGENT_RECOVERY_REVIEW_V1', intent, owner: uxSelected.owner,
  account: '0x2222222222222222222222222222222222222222', expiresAt: uxClock + 90000,
  maximumNetworkFeeWei: '1000000000000000', transaction: { from: uxSelected.owner, to: '0x2222222222222222222222222222222222222222' } });
const uxUpdate = state => { uxState = state; uxChange?.(uxState); return uxState; };
const uxWait = async () => { if (uxDelay) await new Promise(resolve => uxRelease = resolve);
  if (uxFailure) { const code = uxFailure; uxFailure = null; throw Object.assign(Error(code), { code }); } };
window.__ux = {
  calls: uxCalls, tab: activateTab, getState: () => uxState,
  delay: value => uxDelay = value, release: () => { uxDelay = false; uxRelease?.(); },
  fail: code => uxFailure = code, forgeFail: value => uxForgeFailure = value,
  expire: () => uxClock += 90001,
  update: uxUpdate,
  emptyGallery: () => { state.gallery = []; renderSelected(); },
  install: () => {
    // Keep PREVIEW true in the host: hydration, scouting and provider paths stay off.
    // A selected-Punk fixture replaces only display data and panel dependencies.
    state.punks = [{ ...state.punks[0], tokenId: '93', wethBalanceEth: '0.0000' }];
    state.selected = state.punks[0]; renderSelected();
    agentRecoveryControl.destroy();
    const recoveryRoot = document.querySelector('#agent-recovery'); recoveryRoot.replaceChildren();
    agentRecoveryControl = createAgentRecoveryPanel({ root: recoveryRoot, getSelection: () => uxSelected,
      ensureSession: async () => { uxCalls.session++; }, getProvider: () => uxProvider, now: () => uxClock,
      createController: ({ onChange }) => { uxChange = onChange; return {
        getState: () => uxState,
        prepare: async intent => { uxCalls.prepare++; await uxWait(); return uxUpdate({ status: 'PREPARED', review: uxReview(intent) }); },
        cancelReview: async () => uxUpdate({ ...uxState, status: 'CANCELLED' }),
        submit: async ({ expectedReview }) => { uxCalls.submit++; if (![expectedReview, expectedReview.intent, expectedReview.transaction].every(Object.isFrozen)) throw Error('Expected frozen displayed review');
          uxUpdate({ ...uxState, status: 'WALLET_REQUESTED' }); await uxWait();
          throw Object.assign(Error('Ambiguous mock wallet result'), { code: 'AGENT_RECOVERY_WALLET_RESULT_UNKNOWN' }); },
        refresh: async () => { uxCalls.refresh++; await uxWait(); return uxState; },
        recover: async () => { uxCalls.recover++; await uxWait(); throw Object.assign(Error('Mismatched mock hash'), { code: 'AGENT_RECOVERY_RECEIPT_MISMATCH' }); },
      }; } });
    window.__ux.recovery = agentRecoveryControl;
    forgeControl.destroy();
    forgeControl = createForgeControl({ root: document.querySelector('[data-v2-panel="forge"]'), getSelection: () => uxSelected,
      ensureSession: async () => { uxCalls.session++; }, request: async (path, options) => {
        uxCalls.forge++; await uxWait(); if (uxForgeFailure) throw Error(uxForgeFailure);
        if (!path.endsWith('/forge')) throw Error('Mock training unavailable');
        const action = options?.body ? JSON.parse(options.body).action : null;
        return { ok: true, tokenId: '93', owner: uxSelected.owner, chainId: 4663, mode: 'READ_ONLY_RESEARCH_LAB',
          walletAuthority: 'NONE', canBurn: false, canLearn: false, canEquip: false, labAvailable: true, marketAvailable: true,
          observedAt: new Date().toISOString(), result: action === 'rank_trait_sample' ? { sampleSize: 3, source: 'LOOPBACK UI FIXTURE' } : { codeBytes: 200, blockNumber: '123' },
          profile: { status: 'VERIFIED_READ_ONLY', verified: true, ownership: 'ORIGINAL_NFT', slotCap: 7, walletAuthority: 'NONE',
            canBurn: false, canLearn: false, canEquip: false, effectiveMcpTools: [], tokenId: '93', owner: uxSelected.owner,
            collection: COLLECTION, registry: uxSelected.owner, progression: uxSelected.owner, blockHash: '0x' + 'a'.repeat(64),
            blockNumber: '123', blockTime: Date.now(), trainingCredits: '0', unlockedSlots: 1, claimedStartingSlots: 0,
            learnedSkills: [], equippedSkills: [] } };
      } });
  }
};
`;

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'LOOPBACK_ONLY_UI_FIXTURE' })); return; }
    const relative = pathname === '/broker/v2/' ? 'broker/v2/index.html' : pathname.slice(1);
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep)) throw Error('Invalid asset path');
    let data;
    try { data = await readFile(path); }
    catch (error) { if (!relative.startsWith('assets/') || assetsRoot === root) throw error; data = await readFile(resolve(assetsRoot, relative)); }
    if (relative === 'broker/v2/index.html') data = data.toString().replace(/\s*<script src="\/wallet\.js[^>]*><\/script>/, '');
    if (relative === 'broker-v2.js') data = data.toString() + '\n' + fixture;
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'content-security-policy': "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'" }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp('/private/tmp/gogh-ux-browser-');
const chrome = spawn(process.env.GOGH_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
const observations = [], screenshots = [], errors = [], externalRequests = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20000); chrome.once('error', reject);
    chrome.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const page = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`CDP_TIMEOUT ${method}`)); }, 20000);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params; const allowed = request.url.startsWith(origin + '/') || request.url.startsWith('data:');
      if (!allowed) externalRequests.push(request.url);
      void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(error => errors.push(error.message));
    }
    const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
  };
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(`UI_TIMEOUT ${expression} ${JSON.stringify(errors)}`); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async (key, code = key) => { const virtual = { Tab: 9, Enter: 13, Space: 32, ArrowRight: 39 }[code];
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual,
      ...(code === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }); };
  const viewport = async width => { await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); await evaluate('window.scrollTo({top:0,behavior:"instant"})'); };
  const shot = async (name, selector = null) => {
    if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`);
    // Headless tabs can suspend animation frames. A short host-side yield lets
    // layout paint without waiting indefinitely for a background tab's RAF.
    await new Promise(resolve => setTimeout(resolve, 50));
    const data = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = `${output}/${name}.png`; await writeFile(path, Buffer.from(data.data, 'base64')); screenshots.push(path);
  };
  const inspect = async (name, width) => {
    const result = await evaluate(`(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      overflowing:[...document.querySelectorAll('body *')].filter(e=>visible(e)&&e.getBoundingClientRect().right>${width}+1&&!e.closest('.broker-tabs,.punk-roster')).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,70),right:e.getBoundingClientRect().right})),
      unlabeled:[...document.querySelectorAll('input,select,textarea')].filter(e=>visible(e)&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML),
      shortActions:[...document.querySelectorAll('button')].filter(e=>visible(e)&&!e.disabled&&e.getBoundingClientRect().height<43).map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height}))};})()`);
    observations.push({ name, requestedWidth: width, ...result }); assert.deepEqual(result.unlabeled, [], `${name}: unlabeled controls`);
    assert.equal(result.width, width, `${name}: layout viewport expanded at device width ${width}`);
    assert.ok(result.scrollWidth <= width, `${name}: document overflow at ${width}`);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await viewport(1440); await call('Page.navigate', { url: origin + '/broker/v2/' }); await until('Boolean(window.__ux)');
  assert.equal(await evaluate('document.querySelector("[data-selected-stage]").hidden'), true);
  await shot('disconnected-1440');
  await call('Page.navigate', { url: origin + '/broker/v2/?preview=1' }); await until('Boolean(window.__ux)');
  await until('[...document.images].filter(i=>!i.loading||i.loading!=="lazy").every(i=>i.complete)');
  // Record native roster keyboard behavior before the controlled fixtures mount.
  await evaluate('document.querySelector(".roster-slot").focus()'); await key('ArrowRight');
  observations.push({ name: 'roster-arrow-right', value: await evaluate('({focus:document.activeElement.dataset.tokenId,selected:document.querySelector(".roster-slot[aria-selected=true]").dataset.tokenId})') });
  assert.deepEqual(observations.at(-1).value, { focus: '546', selected: '546' });
  await evaluate('document.querySelectorAll(".roster-slot")[2].focus()'); await key('Enter');
  observations.push({ name: 'roster-selection-focus', value: await evaluate('({tag:document.activeElement.tagName,selected:document.querySelector(".roster-slot[aria-selected=true]").dataset.tokenId})') });
  assert.deepEqual(observations.at(-1).value, { tag: 'BUTTON', selected: '810' });
  assert.equal(await evaluate('document.activeElement.dataset.tokenId'), '810');
  for (const width of [1440, 768, 375, 320]) {
    await viewport(width); await evaluate('window.__ux.tab("talk")'); if ([1440, 375].includes(width)) await shot(`control-center-${width}`);
    await inspect('talk-preview', width); await shot(`talk-${width}`, '[data-v2-panel="talk"]');
    await evaluate('window.__ux.tab("fund")'); await inspect('fund-preview', width);
    if (width === 320) await shot('fund-320', '[data-v2-panel="fund"]');
    await evaluate('window.__ux.tab("forge")'); await inspect('forge-preview', width); await shot(`forge-${width}`, '[data-v2-panel="forge"]');
    if (width < 600) {
      const selectedBounds = await evaluate('(()=>{const r=document.querySelector("[data-v2-tab=forge]").getBoundingClientRect();return {left:r.left,right:r.right}})()');
      observations.push({ name: 'mobile-selected-tab-visible', requestedWidth: width, ...selectedBounds });
      assert.ok(selectedBounds.left >= 0 && selectedBounds.right <= width, `Selected Forge tab hidden at ${width}`);
    }
  }
  const ax = await call('Accessibility.getFullAXTree');
  observations.push({ name: 'navigation-accessibility', value: ax.nodes.filter(node => ['button', 'tab'].includes(node.role?.value) && /0[1-7]/.test(node.name?.value)).map(node => ({ name: node.name.value, role: node.role.value, properties: node.properties })) });
  const accessibleTabs = observations.at(-1).value;
  assert.equal(accessibleTabs.length, 7); assert.ok(accessibleTabs.every(tab => tab.role === 'tab'));
  assert.equal(accessibleTabs.filter(tab => tab.properties.some(property => property.name === 'selected' && property.value.value === true)).length, 1);
  assert.ok(accessibleTabs.find(tab => tab.name.includes('FORGE')).properties.some(property => property.name === 'selected' && property.value.value === true));
  await evaluate('document.querySelector("[data-v2-tab=talk]").focus()'); await key('ArrowRight');
  assert.equal(await evaluate('document.activeElement.dataset.v2Tab'), 'strategy');
  assert.equal(await evaluate('document.querySelector("[data-v2-tab=forge]").getAttribute("aria-selected")'), 'true');
  await key('Enter');
  assert.equal(await evaluate('document.querySelector("[data-v2-tab=strategy]").getAttribute("aria-selected")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-v2-panel=strategy]").hidden'), false);
  await evaluate('window.__ux.install();window.__ux.tab("fund")');
  assert.equal(await evaluate('window.__ux.calls.session'), 0); assert.equal(await evaluate('window.__ux.calls.prepare'), 0);
  await evaluate('window.__ux.delay(true);document.querySelector("[data-agent-recovery-field=amount]").value="0.000123456789012345"');
  await click('[data-agent-recovery-action=prepare]'); await until('document.querySelector("#agent-recovery").getAttribute("aria-busy")==="true"');
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=amount]").disabled'), true);
  await shot('recovery-loading-320', '#agent-recovery'); await evaluate('window.__ux.release()');
  await until('document.querySelector("[data-agent-recovery-action=submit]").hidden===false');
  assert.equal(await evaluate('window.__ux.calls.submit'), 0);
  for (const width of [1440, 768, 375, 320]) { await viewport(width); await inspect('recovery-prepared', width); await shot(`recovery-${width}`, '#agent-recovery'); }
  await evaluate('document.querySelector("#agent-recovery input[type=checkbox]").focus()'); await key(' ', 'Space');
  assert.equal(await evaluate('document.querySelector("#agent-recovery input[type=checkbox]").checked'), true);
  await key('Tab');
  observations.push({ name: 'recovery-keyboard-confirm', value: await evaluate('({action:document.activeElement.dataset.agentRecoveryAction,outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth})') });
  assert.equal(await evaluate('document.activeElement.dataset.agentRecoveryAction'), 'submit');
  await shot('recovery-keyboard-320', '.agent-recovery-actions');
  await key('Enter'); await until('document.querySelector("#agent-recovery").textContent.includes("wallet result is unknown")');
  assert.equal(await evaluate('window.__ux.calls.submit'), 1);
  await evaluate('document.querySelector("[data-agent-recovery-field=hash]").value="0x"+"c".repeat(64);window.__ux.fail("AGENT_RECOVERY_RECEIPT_MISMATCH")');
  await click('[data-agent-recovery-action=refresh]'); await until('document.querySelector("#agent-recovery").textContent.includes("does not match")');
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=hash]").value'), '0x' + 'c'.repeat(64));
  await click('[data-agent-recovery-action=recover]');
  await until('window.__ux.calls.recover===1&&document.querySelector("#agent-recovery").getAttribute("aria-busy")==="false"');
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=hash]").value'), '0x' + 'c'.repeat(64));
  assert.equal(await evaluate('window.__ux.calls.submit'), 1);
  await shot('recovery-error-hash-320', '#agent-recovery');
  await evaluate('window.__ux.update({...window.__ux.getState(),status:"PREPARED"})');
  await click('[data-agent-recovery-action=refresh]');
  await until('document.querySelector("#agent-recovery").getAttribute("aria-busy")==="false"');
  await evaluate('window.__ux.expire()');
  await until('document.querySelector("#agent-recovery").textContent.includes("Review expired")');
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-action=submit]").disabled'), true);
  await click('[data-agent-recovery-action=cancel]');
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=amount]").value'), '0.000123456789012345');
  await evaluate('window.__ux.recovery.openAsset({standard:"ERC1155",collection:"0x3333333333333333333333333333333333333333",tokenId:"12345678901234567890"})');
  assert.equal(await evaluate('document.activeElement.id'), 'agent-recovery-title');
  await click('[data-agent-recovery-action=prepare]'); await until('window.__ux.getState().status==="PREPARED"');
  await inspect('recovery-nft-prepared', 320); await shot('recovery-nft-320', '#agent-recovery');
  await evaluate('window.__ux.tab("collection");window.__ux.emptyGallery()'); await shot('collection-empty-320', '[data-v2-panel="collection"]');
  await evaluate('window.__ux.tab("forge");window.__ux.delay(true)'); await click('[data-forge-connect]');
  await until('document.querySelector("[data-forge-connect]").textContent==="CHECKING…"');
  assert.equal(await evaluate('document.querySelector("[data-forge-connect]").disabled'), true);
  await evaluate('window.__ux.release()'); await until('document.querySelector("[data-forge-status]").textContent.includes("OWNER VERIFIED")');
  await inspect('forge-verified-empty', 320); await shot('forge-verified-320', '[data-forge-panel], [data-v2-panel="forge"]');
  await viewport(1440); await shot('forge-library-1440', '.forge-library');
  await evaluate('window.__ux.forgeFail("Research service unavailable. Recheck when connected.")'); await click('[data-forge-connect]');
  await until('document.querySelector("[data-forge-status]").textContent.includes("Research service unavailable")');
  assert.equal(await evaluate('document.querySelector("[data-forge-profile-summary]").textContent.includes("unknown")'), true);
  await shot('forge-error-1440', '[data-v2-panel="forge"]');
  assert.equal(await evaluate('window.__ux.calls.wallet'), 0); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const report = { status: 'PASS', sourceRoot: root, scope: 'Actual page layout plus injected mock panel dependencies; no controller, wallet or chain proof', widths: [1440, 768, 375, 320], publicTransactions: 0,
    calls: await evaluate('window.__ux.calls'), observations, screenshots, errors, externalRequests };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await writeFile(`${output}/observations.json`, JSON.stringify({ observations, errors, externalRequests, screenshots }, null, 2) + '\n');
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); await new Promise(resolve => server.close(resolve));
}
