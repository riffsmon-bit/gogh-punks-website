import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Actual non-preview Control Center, with only owner-read and HTTP dependencies
// mocked. No wallet bootstrap, public provider, signer or production API is used.
if (process.argv.length !== 3 || process.argv[2] !== '--mock-wallet-only') throw Error('Requires --mock-wallet-only');
const siteRoot = process.env.GOGH_UI_SITE_ROOT ? resolve(process.env.GOGH_UI_SITE_ROOT) : fileURLToPath(new URL('../site/', import.meta.url));
const output = process.env.GOGH_UI_OUTPUT_DIR || '/private/tmp/gogh-collection-display-ux';
await mkdir(output, { recursive: true });
const sourceFiles = new Map(await Promise.all(['broker/v2/index.html', 'broker-v2.js', 'broker-v2.css', 'assets/nft-placeholder.svg']
  .map(async path => [path, await readFile(resolve(siteRoot, path))])));
const sourceSha256 = Object.fromEntries([...sourceFiles].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]));
// Optional local captures of canonical metadata artwork; no network download is
// performed by this harness. Without captures, existing repo images prove only
// distinct-image rendering, not the on-chain metadata identity of #235 or #241.
const artManifest = process.env.GOGH_COLLECTION_ARTWORK_FIXTURES
  ? JSON.parse(await readFile(process.env.GOGH_COLLECTION_ARTWORK_FIXTURES, 'utf8')) : null;
const imagePaths = artManifest?.images ?? {
  '235': { path: resolve(siteRoot, 'assets/collection/7.png'), source: 'repository display fixture' },
  '241': { path: resolve(siteRoot, 'assets/collection/13.png'), source: 'repository display fixture' },
  '1599': { path: resolve(siteRoot, 'assets/collection/38.png'), source: 'repository display fixture' },
};
const imageFixtures = new Map();
for (const tokenId of ['235', '241', '1599']) {
  const item = imagePaths[tokenId];
  assert.ok(item && typeof item.path === 'string', `Missing artwork fixture ${tokenId}`);
  assert.ok(['.png', '.webp', '.jpg', '.jpeg', '.svg'].includes(extname(item.path)), 'Unsupported artwork fixture');
  const bytes = await readFile(item.path);
  imageFixtures.set(`/__collection-art/${tokenId}`, { bytes, type: extname(item.path) === '.svg' ? 'image/svg+xml' : extname(item.path) === '.webp' ? 'image/webp' : /\.jpe?g$/.test(item.path) ? 'image/jpeg' : 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'), source: item.source });
}
assert.notEqual(imageFixtures.get('/__collection-art/235').sha256, imageFixtures.get('/__collection-art/241').sha256, 'Owned artwork fixtures must differ');
const rosterArtwork = Object.fromEntries(['235', '241'].map(id => {
  const item = imageFixtures.get('/__collection-art/' + id);
  return [id, `data:${item.type};base64,${item.bytes.toString('base64')}`];
}));

const bridge = String.raw`
const uxOwnerA = '0x1111111111111111111111111111111111111111';
const uxOwnerB = '0x2222222222222222222222222222222222222222';
const uxTarget = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const uxOriginalFetch = window.fetch.bind(window), uxPlans = [], uxPending = new Map(), uxRequests = [];
const uxRosterArt = __ROSTER_ARTWORK_JSON__, uxArtworkPending = [];
let uxOwner = uxOwnerA, uxRequestSequence = 0, uxWalletCalls = 0, uxHoldArtwork = true;
let uxRequireSession = false, uxSignatures = 0, uxSessionPreparations = 0, uxProfileFailure = false, uxProfileFailures = 0;
const uxAccount = tokenId => '0x' + String(tokenId).padStart(40, '0');
const uxHolding = (tokenId = '1599', name = 'pre-reveal') => ({
  chainId: 4663, tokenId, collection: uxTarget, standard: 'ERC721', amount: '1',
  artwork: tokenId === '1599' ? { name, imageUrl: '/__collection-art/1599' } : { name, imageUrl: null },
  ownershipStatus: 'LIVE_VERIFIED', custodyType: 'PUNK_AGENT_ACCOUNT', provenance: 'V2', acquisitionType: 'PAID_MINT',
  mintCostWei: tokenId === '1599' ? '100000000000000' : null, acquiredAt: '2026-09-13T16:00:00Z',
  withdrawControlUrl: '/broker/v2/?tab=fund&tokenId=93#agent-recovery',
});
const uxInventory = (tokenId, owner, kind = 'holding') => ({ ok: true, owner, tokenId, chainId: 4663,
  holdings: kind === 'empty' ? [] : [uxHolding(), uxHolding('1600', 'Artwork unavailable #1600')],
  ownershipChecksUnavailable: 0, paidMintHistoryAvailable: true,
  inventoryNote: 'Current custody verified by the controlled UI fixture. No live chain request was made.',
});
const uxResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
window.__GOGH_WALLET_PROVIDER__ = { request: async ({ method, params }) => {
  if (method === 'personal_sign' && uxRequireSession && params?.[0] === 'Loopback sign-in fixture' && params?.[1] === uxOwner) {
    uxSignatures++; return '0x' + 'b'.repeat(130); // In-memory mock only; never a wallet or key.
  }
  uxWalletCalls++; throw Error('UI fixture denies every transaction/provider method');
} };
window.fetch = async (resource, options) => {
  const url = new URL(typeof resource === 'string' ? resource : resource.url, location.origin);
  if (url.origin !== location.origin) throw Error('External fetch denied by collection UI fixture');
  if (url.pathname === '/api/broker/owner-punks') {
    const owner = url.searchParams.get('owner');
    return uxResponse({ ok: true, owner, chainId: 4663, collection: COLLECTION,
      candidateTokenIds: ['93', '235', '241', '4999'], candidatePunks: ['93', '235', '241', '4999'].map(tokenId => ({ tokenId,
        artwork: null,
        agentSummary: { account: uxAccount(tokenId) } })) });
  }
  if (url.pathname === '/api/broker/punk-artwork') {
    const ids = url.searchParams.get('tokenIds').split(',');
    const payload = { ok: true, chainId: 4663, collection: COLLECTION,
      artworks: ids.map(tokenId => ({ tokenId, artwork: uxRosterArt[tokenId] ? { imageUrl: uxRosterArt[tokenId], name: 'Gogh Punk #' + tokenId } : null })) };
    if (uxHoldArtwork) return new Promise(resolve => uxArtworkPending.push(() => resolve(uxResponse(payload))));
    return uxResponse(payload);
  }
  if (url.pathname === '/api/v2/session') {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'prepare') { uxSessionPreparations++; return uxResponse({ ok: true, challenge: { challengeId: 'loopback', message: 'Loopback sign-in fixture' } }); }
      if (body.action === 'complete' && body.signature === '0x' + 'b'.repeat(130)) { uxRequireSession = false; return uxResponse({ ok: true }); }
      throw Error('Unexpected session fixture action');
    }
    if (uxRequireSession) return uxResponse({ ok: false, code: 'V2_SESSION_REQUIRED' }, 401);
    return uxResponse({ ok: true, walletAddress: uxOwner });
  }
  const collectionMatch = /^\/api\/v2\/punks\/(\d+)\/collection$/.exec(url.pathname);
  if (collectionMatch) {
    const tokenId = collectionMatch[1], owner = uxOwner, plan = uxPlans.shift() ?? { kind: tokenId === '93' ? 'holding' : 'empty' };
    const record = { id: ++uxRequestSequence, tokenId, owner, plan: plan.kind, settled: false }; uxRequests.push(record);
    if (plan.kind === 'delay') return new Promise(resolve => uxPending.set(record.id, { record, resolve }));
    record.settled = true;
    if (plan.kind === 'error') return uxResponse({ ok: false, message: plan.message ?? 'Collection inventory temporarily unavailable.' }, 503);
    return uxResponse(uxInventory(tokenId, owner, plan.kind));
  }
  const profileMatch = /^\/api\/v2\/punks\/(\d+)$/.exec(url.pathname);
  if (profileMatch) {
    if (uxProfileFailure) { uxProfileFailure = false; uxProfileFailures++; return uxResponse({ ok: false, message: 'Profile statistics unavailable.' }, 503); }
    return uxResponse({ ok: true, profile: { tokenId: profileMatch[1], owner: uxOwner,
      punkWallet: uxAccount(profileMatch[1]), nativeBalanceWei: '30000000000000000', collectionCount: 9, strategy: null } });
  }
  if (/^\/api\/v2\/punks\/\d+\/agent-account$/.test(url.pathname)) return uxResponse({ ok: true });
  if (/^\/api\/v2\/punks\/\d+\/activity$/.test(url.pathname)) return uxResponse({ ok: true, entries: [] });
  if (url.pathname.startsWith('/api/')) throw Error('Unexpected API request: ' + url.pathname);
  return uxOriginalFetch(resource, options);
};
window.__collectionUx = {
  ownerA: uxOwnerA, ownerB: uxOwnerB, requests: uxRequests,
  get walletCalls() { return uxWalletCalls; },
  get signatures() { return uxSignatures; }, get sessionPreparations() { return uxSessionPreparations; }, get profileFailures() { return uxProfileFailures; },
  requireSession: () => uxRequireSession = true,
  failNextProfile: () => { uxProfileFailure = true; state.hydratedTokenId = null; },
  queue: (kind, message) => uxPlans.push({ kind, message }),
  pending: () => [...uxPending.keys()],
  releaseArtwork: () => { uxHoldArtwork = false; uxArtworkPending.splice(0).forEach(resolve => resolve()); },
  settle: (id, kind = 'holding', label = null) => {
    const held = uxPending.get(id); if (!held) throw Error('Unknown delayed request'); uxPending.delete(id); held.record.settled = true;
    if (kind === 'error') held.resolve(uxResponse({ ok: false, message: label ?? 'STALE COLLECTION ERROR' }, 503));
    else { const payload = uxInventory(held.record.tokenId, held.record.owner, kind);
      if (label && payload.holdings.length) payload.holdings[0].artwork.name = label; held.resolve(uxResponse(payload)); }
  },
  connect: owner => { uxOwner = owner; window.dispatchEvent(new CustomEvent('gogh:wallet-state', { detail: { account: owner, chainId: 4663, status: 'owner' } })); },
  selected: () => ({ tokenId: state.selected?.tokenId, owner: state.wallet?.account, verifiedRosterOwner: state.ownershipAccount }),
};
`.replace('__ROSTER_ARTWORK_JSON__', JSON.stringify(rosterArtwork));

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const artwork = imageFixtures.get(path);
    if (artwork) { res.writeHead(200, { 'content-type': artwork.type }); res.end(artwork.bytes); return; }
    if (path === '/broker-v2-ownership.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('export async function verifyOwnedPunkIds(_provider,_collection,_owner,ids){return {tokenIds:[...ids]};}'); return;
    }
    if (path.startsWith('/api/')) throw Error('API request escaped the browser fixture');
    const relative = path === '/broker/v2/' ? 'broker/v2/index.html' : path.slice(1);
    const filename = resolve(siteRoot, relative);
    if (!filename.startsWith(resolve(siteRoot) + sep)) throw Error('Invalid site path');
    let bytes = sourceFiles.get(relative) ?? await readFile(filename);
    if (relative === 'broker/v2/index.html') bytes = bytes.toString().replace(/\s*<script src="\/wallet\.js[^>]*><\/script>/, '');
    if (relative === 'broker-v2.js') bytes = bytes.toString() + '\n' + bridge;
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(filename)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'content-security-policy': "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'" });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp('/private/tmp/gogh-collection-browser-');
const chrome = spawn(process.env.GOGH_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
const errors = [], externalRequests = [], screenshots = [], observations = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20000); chrome.once('error', reject);
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const page = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP_TIMEOUT ' + method)); }, 20000);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params, allowed = request.url.startsWith(origin + '/') || request.url.startsWith('data:');
      if (!allowed) externalRequests.push(request.url);
      void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(error => errors.push(error.message));
    }
    const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
  };
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(`UI_TIMEOUT ${expression} ${JSON.stringify(errors)}`); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enter = async () => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 80));
  const shot = async (name, selector) => { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`);
    await pause(); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = `${output}/${name}.png`; await writeFile(path, Buffer.from(result.data, 'base64')); screenshots.push(path); };
  const inspect = async (name, width) => {
    const result = await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,
      cards:document.querySelectorAll('.gallery-item').length,
      count:document.querySelector('[data-gallery-count]').textContent,
      unnamed:[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML)})`);
    observations.push({ name, width, ...result }); assert.equal(result.innerWidth, width, `${name} mobile layout scaling`);
    assert.ok(result.scrollWidth <= width, `${name} page overflow`); assert.deepEqual(result.unnamed, []);
  };
  const collectionText = () => evaluate('document.querySelector("[data-v2-panel=collection]").textContent');
  const pendingId = async () => { await until('window.__collectionUx.pending().length>0'); return evaluate('window.__collectionUx.pending().at(-1)'); };
  const settle = (id, kind, label = null) => evaluate(`window.__collectionUx.settle(${id},${JSON.stringify(kind)},${JSON.stringify(label)})`);
  const refresh = '[data-collection-refresh]';
  await call('Page.enable'); await call('Runtime.enable'); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin + '/broker/v2/?tokenId=93' }); await until('Boolean(window.__collectionUx)');
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA)');
  await until('document.querySelectorAll(".roster-slot").length===4');
  // The indexed roster deliberately has no artwork for #235/#241. Keep metadata
  // pending while a recovery draft is edited, then exercise the real image patch.
  await click('[data-v2-tab=fund]');
  await evaluate('window.__collectionRecoveryInput=document.querySelector("[data-agent-recovery-field=amount]");window.__collectionRecoveryInput.value="0.000012345678901234"');
  await evaluate('window.__collectionUx.releaseArtwork()');
  await until('document.querySelector(".roster-slot[data-token-id=\\"235\\"] img").src.startsWith("data:image/")');
  await until('[...document.querySelectorAll(".roster-slot img")].every(i=>i.complete&&i.naturalWidth>0)');
  const art = await evaluate('Object.fromEntries([...document.querySelectorAll(".roster-slot")].map(e=>[e.dataset.tokenId,e.querySelector("img").getAttribute("src")]))');
  assert.equal(art['235'], rosterArtwork['235']); assert.equal(art['241'], rosterArtwork['241']);
  assert.notEqual(art['235'], art['241']); assert.match(art['4999'], /\/assets\/nft-placeholder\.svg$/);
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=amount]")===window.__collectionRecoveryInput&&window.__collectionRecoveryInput.value==="0.000012345678901234"'), true);
  observations.push({ name: 'roster-artwork', artwork: Object.fromEntries(Object.entries(art).map(([id, src]) => [id, { prefix: src.slice(0, 55), length: src.length }])) }); await shot('roster-1440', '.roster-stage');
  // Preserve a real mounted recovery input through collection refreshes. No review
  // or recovery action is clicked, and the actual controller never sends anything.
  await evaluate('window.__collectionUx.requireSession();window.__collectionUx.queue("delay")'); await click('[data-v2-tab=collection]');
  const first = await pendingId();
  assert.equal(await evaluate('window.__collectionUx.signatures'), 1, 'Parallel profile/collection reads must share one mock sign-in');
  assert.equal(await evaluate('window.__collectionUx.sessionPreparations'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".gallery-item").length'), 0, 'Loading must not masquerade as an NFT');
  assert.match(await collectionText(), /loading|checking|reading/i); assert.ok(await evaluate(`Boolean(document.querySelector('${refresh}'))`));
  assert.equal(await evaluate('document.querySelector("[data-gallery-grid]").getAttribute("aria-busy")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-gallery-status]").getAttribute("role")==="status"||document.querySelector("[data-gallery-status]").getAttribute("aria-live")==="polite"'), true);
  assert.equal(await evaluate(`document.querySelector('${refresh}').disabled`), true);
  await shot('collection-loading-1440', '[data-v2-panel=collection]');
  await settle(first, 'error', 'Collection inventory temporarily unavailable.');
  await until('!document.querySelector("[data-collection-refresh]").disabled');
  assert.equal(await evaluate('document.querySelectorAll(".gallery-item").length'), 0, 'An error must not masquerade as an NFT');
  assert.match(await collectionText(), /unavailable|couldn.t be loaded/i);
  await shot('collection-error-1440', '[data-v2-panel=collection]');
  await evaluate('window.__collectionUx.queue("empty");document.querySelector("[data-collection-refresh]").focus()'); await enter();
  await until('document.querySelector("[data-gallery-count]").textContent==="0"&&!document.querySelector("[data-collection-refresh]").disabled');
  assert.equal(await evaluate('document.querySelectorAll(".gallery-item").length'), 0);
  await shot('collection-empty-1440', '[data-v2-panel=collection]');
  await evaluate('window.__collectionUx.failNextProfile();window.__collectionUx.queue("holding")');
  await click('[data-v2-tab=collection]'); await click(refresh);
  await until('[...document.querySelectorAll(".gallery-item h3")].some(e=>e.textContent==="pre-reveal")');
  const holding = await evaluate('(()=>{const card=[...document.querySelectorAll(".gallery-item")].find(e=>e.querySelector("h3").textContent==="pre-reveal");return {text:card.textContent,src:card.querySelector("img").getAttribute("src"),recovery:card.querySelector("button")?.textContent}})()');
  assert.match(holding.text, /OWNERSHIP VERIFIED/); assert.match(holding.text, /Agent wallet/);
  assert.match(holding.text, /#1599/, 'Generic metadata names must still show the exact NFT token ID');
  assert.match(holding.src, /\/__collection-art\/1599$/); assert.equal(holding.recovery, 'WITHDRAW NFT');
  assert.equal(await evaluate('window.__collectionUx.profileFailures'), 1, 'Collection must succeed independently of a failed profile read');
  assert.match(await evaluate('[...document.querySelectorAll(".gallery-item")].find(e=>e.textContent.includes("#1600")).querySelector("img").getAttribute("src")'), /\/assets\/nft-placeholder\.svg$/);
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=amount]")===window.__collectionRecoveryInput&&window.__collectionRecoveryInput.value==="0.000012345678901234"'), true);
  observations.push({ name: 'verified-holding', ...holding });
  for (const width of [1440, 375, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await inspect('verified-gallery', width); await shot(`collection-${width}`, '.gallery-grid');
    if (width < 600) await shot(`roster-${width}`, '.roster-stage');
  }
  // Pending responses deliberately ignore AbortSignal: even an uncancellable
  // transport may return late and must not overwrite the new selection.
  await evaluate('window.__collectionUx.queue("delay")'); await click(refresh); const tokenLate = await pendingId();
  await click('.roster-slot[data-token-id="235"]'); await click('[data-v2-tab=collection]');
  await until('window.__collectionUx.selected().tokenId==="235"&&!document.querySelector("[data-collection-refresh]").disabled');
  assert.doesNotMatch(await collectionText(), /#1599/);
  await click('.roster-slot[data-token-id="93"]'); await click('[data-v2-tab=collection]');
  await until('document.querySelectorAll(".gallery-item").length===2&&!document.querySelector("[data-collection-refresh]").disabled');
  await settle(tokenLate, 'holding', 'STALE TOKEN HOLDING'); await pause();
  assert.doesNotMatch(await collectionText(), /STALE TOKEN HOLDING/);
  assert.match(await collectionText(), /#1599/);
  await evaluate('window.__collectionUx.queue("delay")'); await click(refresh); const tokenError = await pendingId();
  await click('.roster-slot[data-token-id="241"]'); await click('[data-v2-tab=collection]');
  await until('window.__collectionUx.selected().tokenId==="241"&&!document.querySelector("[data-collection-refresh]").disabled');
  await settle(tokenError, 'error', 'STALE TOKEN ERROR'); await pause(); assert.doesNotMatch(await collectionText(), /STALE TOKEN ERROR/);
  assert.equal(await evaluate('document.querySelector("[data-gallery-count]").textContent'), '0', 'A sanitized old error must not replace the newer empty result');
  assert.doesNotMatch(await evaluate('document.querySelector("[data-gallery-status]").textContent'), /couldn.t be loaded/);
  await click('.roster-slot[data-token-id="93"]'); await click('[data-v2-tab=collection]');
  await until('document.querySelectorAll(".gallery-item").length===2&&!document.querySelector("[data-collection-refresh]").disabled');
  await evaluate('window.__collectionUx.queue("delay")'); await click(refresh); const ownerLate = await pendingId();
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerB)');
  await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerB&&window.__collectionUx.selected().tokenId==="93"&&document.querySelectorAll(".gallery-item").length===2&&!document.querySelector("[data-collection-refresh]").disabled');
  await settle(ownerLate, 'holding', 'STALE OWNER HOLDING'); await pause(); assert.doesNotMatch(await collectionText(), /STALE OWNER HOLDING/);
  await evaluate('window.__collectionUx.queue("delay")'); await click(refresh); const ownerError = await pendingId();
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA)');
  await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerA&&window.__collectionUx.selected().tokenId==="93"&&document.querySelectorAll(".gallery-item").length===2&&!document.querySelector("[data-collection-refresh]").disabled');
  await settle(ownerError, 'error', 'STALE OWNER ERROR'); await pause(); assert.doesNotMatch(await collectionText(), /STALE OWNER ERROR/);
  assert.equal(await evaluate('document.querySelectorAll(".gallery-item").length'), 2, 'A sanitized old owner error must not clear current holdings');
  assert.equal(await evaluate('document.querySelector("[data-gallery-count]").textContent'), '2');
  assert.match(await collectionText(), /#1599/);
  assert.equal(await evaluate('document.querySelector("[data-agent-recovery-field=amount]").value'), '0.000012345678901234');
  assert.equal(await evaluate('window.__collectionUx.walletCalls'), 0); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await inspect('after-stale-responses', 320); await shot('collection-final-320', '.gallery-grid');
  const report = { status: 'PASS', siteRoot, sourceSha256, widths: [1440, 375, 320], scope: 'Actual non-preview host with mocked authority and HTTP; no production or chain integration proof',
    artworkSource: artManifest?.description ?? 'Distinct repository display fixtures; canonical token artwork identity is not asserted',
    artwork: Object.fromEntries([...imageFixtures].map(([path, item]) => [path, { sha256: item.sha256, source: item.source }])),
    scenarios: ['distinct235and241art', 'neutralUnknownArt', 'loadingText', 'errorText', 'keyboardRefresh', 'emptyText', 'verified1599', 'profileFailureCollectionSuccess', 'deduplicatedMockSignIn', 'recoveryDraftRetained', 'staleTokenRoundTripSuccess', 'staleTokenError', 'staleOwnerSuccess', 'staleOwnerError'],
    requests: await evaluate('window.__collectionUx.requests'), mockPersonalSignCalls: await evaluate('window.__collectionUx.signatures'), otherMockProviderCalls: 0, realWalletCalls: 0, publicTransactions: 0, externalRequests, errors, observations, screenshots };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  await writeFile(`${output}/observations.json`, JSON.stringify({ errors, externalRequests, observations, screenshots }, null, 2) + '\n');
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); await new Promise(resolve => server.close(resolve));
}
