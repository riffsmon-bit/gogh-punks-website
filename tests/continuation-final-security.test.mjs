import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createMarketplacePurchasePanel } from '../site/marketplace-purchase-panel.js';
import { createForgeSkillAdminPanel } from '../site/forge-skill-admin-panel.js';
import { marketplacePanelFixture, PANEL_OWNER, PANEL_OTHER } from './fixtures/marketplace-panel.mjs';

const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const declarations = source.match(/let marketplacePurchaseControl = null;\nlet marketplaceSelectionKey = '';\nlet marketplaceSelectionRevision = 0;/)?.[0];
const identityStart = source.indexOf('function syncMarketplaceSelection() {');
const identity = source.slice(identityStart, source.indexOf('\nfunction renderRoster()', identityStart));
const mountStart = source.indexOf('  let marketplaceStorage = null;');
const mount = source.slice(mountStart, source.indexOf('  const recoveryRoot =', mountStart));
assert.ok(declarations && identityStart >= 0 && mountStart >= 0, 'actual controller integration must be exercised');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Actual mounted recovery action did not settle');
};

function fixture(t) {
  class Element {
    constructor(tag, document) { this.localName = tag; this.ownerDocument = document; this.childNodes = []; this.listeners = {}; }
    set textContent(value) { this.text = String(value); this.childNodes = []; }
    get textContent() { return (this.text ?? '') + this.childNodes.map(node => node.textContent).join(' '); }
    append(...nodes) { this.childNodes.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    attachShadow() { return this.shadowRoot = new Element('shadow', this.ownerDocument); }
    click() { if (!this.disabled) this.listeners.click?.(); }
  }
  const document = { createElement: tag => new Element(tag, document), defaultView: { crypto: webcrypto, setTimeout, clearTimeout } };
  const container = new Element('section', document), values = new Map(), requests = [];
  const original = marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope;
  const prefix = `gogh-marketplace-purchase-v1:4663:${PANEL_OWNER}:93`, intentId = original.entry.intentId;
  values.set(`${prefix}:active`, JSON.stringify({ intentId }));
  values.set(`${prefix}:intent:${intentId}`, JSON.stringify({ schema: 1, owner: PANEL_OWNER, punkId: '93', chainId: 4663,
    intentId, requestId: null, input: null, attempted: true, transactionHash: null, status: 'WALLET_REQUESTED' }));
  const state = { wallet: { account: PANEL_OWNER, chainId: 4663 }, selected: { tokenId: '93' }, galleryTokenId: null };
  let signedIn = false, authentications = 0, authGate = null, walletRequests = 0, bindings;
  const context = { state, PREVIEW: false,
    window: { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
      __GOGH_WALLET_PROVIDER__: { request() { walletRequests++; throw Error('UNEXPECTED_WALLET_REQUEST'); } } },
    one: selector => { if (selector === '[data-forge-skill-admin]') return null;
      assert.equal(selector, '[data-marketplace-purchase-panel]'); return container; },
    createForgeSkillAdminPanel,
    createMarketplacePurchasePanel: options => { bindings = options; return createMarketplacePurchasePanel(options); },
    ensureV2Session: async () => { authentications++; if (authGate) await authGate; signedIn = true; },
    jsonRequest: async (path, options) => {
      requests.push({ path, options });
      assert.equal(options.method, 'GET', 'explicit login must not prepare, claim, decline, or cancel this hash-free original');
      if (!signedIn) throw Object.assign(Error('Expired fixture session'), { code: 'V2_SESSION_EXPIRED' });
      assert.equal(path, `/api/v2/punks/93/marketplace?intentId=${intentId}`);
      return structuredClone(original);
    },
    loadAgentAccountStatus: async () => { throw Error('UNEXPECTED_SETTLEMENT'); } };
  runInNewContext(`${declarations}\nlet forgeSkillAdminControl = null;\n${identity}\n${mount}\nglobalThis.mounted={control:marketplacePurchaseControl,sync:syncMarketplaceSelection};`, context);
  t.after(() => context.mounted.control.destroy());
  const walk = node => [node, ...node.childNodes.flatMap(walk)];
  return { state, values, requests, bindings, container, original, mounted: context.mounted,
    text: () => container.shadowRoot.textContent,
    button: label => walk(container.shadowRoot).find(node => node.localName === 'button' && node.textContent === label),
    authentications: () => authentications, walletRequests: () => walletRequests,
    holdAuthentication: promise => { authGate = promise; } };
}

test('final independent mount: expired original history signs in only on explicit recovery and reads the same intent', async t => {
  const f = fixture(t); await settle();
  assert.equal(f.bindings.purchaseRelease, null);
  assert.equal(typeof f.bindings.authenticate, 'function');
  assert.equal(f.authentications(), 0); assert.equal(f.requests.length, 1);
  assert.match(f.text(), /original owner wallet and sign in/);
  await f.mounted.control.refresh(); assert.equal(f.authentications(), 0);
  const before = f.requests.length, saved = [...f.values];
  const button = f.button('Sign in to recover'); assert.ok(button && !button.disabled); button.click(); button.click();
  await waitFor(() => f.text().includes('Track your purchase') && !f.button('Sign in to recover'));
  assert.equal(f.authentications(), 1); assert.equal(f.requests.length, before + 1);
  assert.deepEqual([...f.values], saved); assert.equal(f.walletRequests(), 0);
});

for (const change of ['owner', 'punk', 'chain', 'round trip']) {
  test(`final independent mount: ${change} change during recovery sign-in cannot resume the original operation`, async t => {
    const f = fixture(t); await settle();
    assert.ok(f.button('Sign in to recover'));
    let release;
    f.holdAuthentication(new Promise(resolve => { release = resolve; }));
    const saved = [...f.values]; f.button('Sign in to recover').click();
    await waitFor(() => f.authentications() === 1);
    if (change === 'owner') f.state.wallet.account = PANEL_OTHER;
    else if (change === 'chain') f.state.wallet.chainId = 1;
    else f.state.selected = { tokenId: '94' };
    f.mounted.sync();
    if (change === 'round trip') { f.state.selected = { tokenId: '93' }; f.mounted.sync(); }
    await settle(); const readsBeforeAuthenticationCompletes = f.requests.length;
    release(); await settle();
    assert.equal(f.requests.length, readsBeforeAuthenticationCompletes);
    assert.deepEqual([...f.values], saved); assert.equal(f.walletRequests(), 0);
    assert.equal(f.authentications(), 1);
  });
}
