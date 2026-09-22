import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
const ROOT = process.env.GOGH_PURCHASE_PANEL_REVIEW_ROOT
  ? resolve(process.env.GOGH_PURCHASE_PANEL_REVIEW_ROOT) : fileURLToPath(new URL('../', import.meta.url));
const load = path => import(pathToFileURL(join(ROOT, path)).href);
const { createMarketplacePurchasePanel } = await load('site/marketplace-purchase-panel.js');
const { createForgeSkillAdminPanel } = await load('site/forge-skill-admin-panel.js');
const { marketplacePanelFixture, PANEL_OWNER, PANEL_OTHER } = await load('tests/fixtures/marketplace-panel.mjs');
const source = await readFile(join(ROOT, 'site/broker-v2.js'), 'utf8');
// Execute the actual controller mount and identity synchronizer, unchanged. This
// isolates their integration behavior; it does not pretend to run the whole app.
const declarations = source.match(/let marketplacePurchaseControl = null;\nlet marketplaceSelectionKey = '';\nlet marketplaceSelectionRevision = 0;/)?.[0];
const identity = source.slice(source.indexOf('function syncMarketplaceSelection() {'), source.indexOf('\nfunction renderRoster()', source.indexOf('function syncMarketplaceSelection() {')));
const start = source.indexOf('  let marketplaceStorage = null;');
const mount = source.slice(start, source.indexOf('  const recoveryRoot =', start));
assert.ok(declarations && identity && mount.includes('createMarketplacePurchasePanel'), 'actual controller seams must remain discoverable');

function fixture(t, { seedJournal = false } = {}) {
  class Element {
    constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.childNodes = []; this.listeners = {}; }
    set textContent(v) { this.text = String(v); this.childNodes = []; }
    get textContent() { return (this.text ?? '') + this.childNodes.map(n => n.textContent).join(' '); }
    append(...nodes) { this.childNodes.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
    setAttribute() {}
    addEventListener(event, callback) { this.listeners[event] = callback; }
    attachShadow() { return this.shadowRoot = new Element('shadow', this.ownerDocument); }
  }
  const doc = { createElement: tag => new Element(tag, doc), defaultView: { crypto: webcrypto, setTimeout, clearTimeout } };
  const container = new Element('section', doc), values = new Map(), requests = [], statusReads = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = { wallet: { account: PANEL_OWNER, chainId: 4663 }, selected: { tokenId: '93' }, galleryTokenId: 'cached' };
  const original = marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope;
  if (seedJournal) {
    const key = `gogh-marketplace-purchase-v1:4663:${PANEL_OWNER}:93`, id = original.entry.intentId;
    values.set(`${key}:active`, JSON.stringify({ intentId: id }));
    values.set(`${key}:intent:${id}`, JSON.stringify({ schema: 1, owner: PANEL_OWNER, punkId: '93', chainId: 4663,
      intentId: id, requestId: null, input: null, attempted: true, transactionHash: null, status: 'WALLET_REQUESTED' }));
  }
  let bindings, authGate = null, sessions = 0, reads = null, settleRead;
  if (seedJournal) reads = new Promise(resolve => { settleRead = resolve; });
  const context = { state, PREVIEW: false, window: { localStorage: storage, __GOGH_WALLET_PROVIDER__: { request() { throw Error('NO_WALLET_REQUEST'); } } },
    // No Settings root in this fixture; exercise the real no-root admin mount.
    one: selector => { if (selector === '[data-forge-skill-admin]') return null;
      assert.equal(selector, '[data-marketplace-purchase-panel]'); return container; },
    createForgeSkillAdminPanel,
    createMarketplacePurchasePanel: options => { bindings = options; return createMarketplacePurchasePanel(options); },
    ensureV2Session: async () => { sessions++; if (authGate) await authGate; },
    jsonRequest: async (path, options) => { requests.push({ path, options }); if (reads) return reads; return { fixtureResponse: true }; },
    loadAgentAccountStatus: async () => { statusReads.push({ owner: state.wallet?.account, punkId: state.selected?.tokenId }); } };
  runInNewContext(`${declarations}\nlet forgeSkillAdminControl = null;\n${identity}\n${mount}\nglobalThis.fixtureMount={control:marketplacePurchaseControl,sync:syncMarketplaceSelection};`, context);
  t.after(() => context.fixtureMount.control.destroy());
  const change = ({ owner, punkId, chainId }, synchronize = true) => {
    if (owner !== undefined) state.wallet.account = owner;
    if (chainId !== undefined) state.wallet.chainId = chainId;
    if (punkId !== undefined) state.selected = punkId === null ? null : { tokenId: punkId };
    if (synchronize) context.fixtureMount.sync();
  };
  return { container, values, requests, statusReads, state, bindings, original, change, mount: context.fixtureMount,
    sessions: () => sessions, auth: value => { authGate = value; }, finishRead: () => settleRead(structuredClone(original)) };
}

test('independent mount: absent release and journal stay hidden with no API, session or wallet work', async t => {
  const f = fixture(t); await f.mount.control.refresh();
  assert.equal(f.bindings.purchaseRelease, null); assert.equal(f.container.hidden, true);
  assert.equal(f.requests.length, 0); assert.equal(f.sessions(), 0);
  f.mount.sync(); f.change({ punkId: '94' }); await f.mount.control.refresh();
  assert.equal(f.requests.length, 0); assert.equal(f.container.hidden, true);
});

test('independent mount: delayed original-owner history cannot display after owner transfer', async t => {
  const f = fixture(t, { seedJournal: true }), originalStorage = [...f.values];
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.method, 'GET'); assert.equal(f.sessions(), 0);
  f.change({ owner: PANEL_OTHER }); f.finishRead(); await new Promise(setImmediate);
  assert.equal(f.container.hidden, true); assert.equal(f.requests.length, 1); assert.deepEqual([...f.values], originalStorage);
  assert.equal(f.sessions(), 0); assert.equal(f.statusReads.length, 0);
});

for (const change of ['punk', 'owner', 'chain', 'round_trip', 'without_render']) {
  test(`independent mount: ${change} change during sign-in prevents the old POST before dispatch`, async t => {
    const f = fixture(t); let release;
    f.auth(new Promise(resolve => { release = resolve; }));
    const pending = f.bindings.api('/api/v2/punks/93/marketplace', { method: 'POST', body: '{"operation":"claim"}' });
    assert.equal(f.sessions(), 1);
    if (change === 'owner') f.change({ owner: PANEL_OTHER });
    else if (change === 'chain') f.change({ chainId: 1 });
    else if (change === 'without_render') f.change({ punkId: '94' }, false);
    else { f.change({ punkId: '94' }); if (change === 'round_trip') f.change({ punkId: '93' }); }
    release(); await assert.rejects(pending, /PURCHASE_SELECTION_CHANGED/);
    assert.equal(f.requests.length, 0);
  });
}

test('independent mount: stable signed-in selection dispatches its original POST exactly once', async t => {
  const f = fixture(t), options = { method: 'POST', body: '{"operation":"recover"}' };
  await f.bindings.api('/api/v2/punks/93/marketplace', options);
  assert.equal(f.sessions(), 1); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/api/v2/punks/93/marketplace'); assert.equal(f.requests[0].options, options);
});

test('independent mount: settlement invalidates collection and refreshes status only for the current owner and Punk', t => {
  const f = fixture(t);
  for (const wrong of [{ owner: PANEL_OTHER, punkId: '93', chainId: 4663 },
    { owner: PANEL_OWNER, punkId: '94', chainId: 4663 }, { owner: PANEL_OWNER, punkId: '93', chainId: 1 }]) f.bindings.onSettled(wrong);
  assert.equal(f.state.galleryTokenId, 'cached'); assert.equal(f.statusReads.length, 0);
  f.bindings.onSettled({ owner: PANEL_OWNER, punkId: '93', chainId: 4663 });
  assert.equal(f.state.galleryTokenId, null); assert.deepEqual(f.statusReads, [{ owner: PANEL_OWNER, punkId: '93' }]);
});
