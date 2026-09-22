import test from 'node:test';
import assert from 'node:assert/strict';
import { createErc20WithdrawalPanel } from '../site/erc20-withdraw-panel.js';
import { erc20Fixture, OWNER, TOKEN, TX } from './fixtures/erc20-withdrawal.mjs';
class Element {
  constructor(tag) { this.localName = tag; this.childNodes = []; this.listeners = {}; this.attributes = {}; this.classList = { add() {} }; this.value = ''; }
  set textContent(v) { this.text = String(v); this.childNodes = []; }
  get textContent() { return (this.text ?? '') + this.childNodes.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  append(...nodes) { this.childNodes.push(...nodes); } replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
  setAttribute(k, v) { this.attributes[k] = v; } addEventListener(k, fn) { this.listeners[k] = fn; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const walk = node => typeof node === 'string' ? [] : [node, ...node.childNodes.flatMap(walk)];
async function settle(root) { for (let i = 0; i < 100; i++) { if (root.attributes['aria-busy'] === 'false') return; await new Promise(r => setTimeout(r, 5)); } assert.fail('panel did not settle'); }
function fixture(t) {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) }; t.after(() => { globalThis.document = old; });
  const f = erc20Fixture(), root = new Element('section'), values = new Map(); let selected = { tokenId: '93', owner: OWNER, chainId: 4663, preview: false }, requests = 0;
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const config = { root, getSelection: () => selected, getProvider: () => f.provider, ensureSession: async () => {}, storage, locks: f.locks, now: () => f.now,
    request: async (_url, options) => {
      requests++; const b = JSON.parse(options.body);
      if (b.operation === 'inspect') return { ok: true, asset: await f.coordinator.inspect({ ...f.selection, role: b.role, contract: b.contract }) };
      if (b.operation === 'prepare') return { ok: true, review: await f.prepare(b.amount) };
      if (b.operation === 'verify') return { ok: true, ...await f.coordinator.verify(b.review) };
      return { ok: true, ...await f.coordinator.recover(b) };
    } };
  let panel = createErc20WithdrawalPanel(config);
  return { f, root, values, storage, config, requests: () => requests, mount() { panel = createErc20WithdrawalPanel(config); },
    select(value) { selected = value; panel.selectionChanged(); },
    button: text => walk(root).find(n => n.localName === 'button' && n.textContent === text),
    inputs: () => walk(root).filter(n => n.localName === 'input'),
    role: () => walk(root).find(n => n.localName === 'select'),
    async click(text) { const b = this.button(text); assert.ok(b); assert.equal(b.disabled, false, text); b.click(); await settle(root); },
  };
}
async function prepare(ui) { ui.role().value = 'AGENT'; ui.inputs()[0].value = TOKEN; await ui.click('Check token'); ui.inputs()[1].value = '1.25'; await ui.click('Review withdrawal'); }
test('panel does not poll, fetch or ask wallet on mount; disconnected/wrong chain disabled', t => {
  const ui = fixture(t); assert.equal(ui.requests(), 0); assert.equal(ui.f.sends, 0);
  ui.select(null); assert.equal(ui.button('Check token').disabled, true);
  ui.select({ owner: OWNER, tokenId: '93', chainId: 1 }); assert.equal(ui.button('Check token').disabled, true); assert.equal(ui.requests(), 0);
});
test('standard token review shows exact balance, fixed owner and fee then verifies original delivery', async t => {
  const ui = fixture(t); await prepare(ui); assert.match(ui.root.textContent, /1\.25 USDC/); assert.match(ui.root.textContent, /To your wallet/); assert.match(ui.root.textContent, /Maximum network fee/);
  await ui.click('Confirm in wallet'); assert.equal(ui.f.sends, 1); assert.equal(ui.button('Confirm in wallet').hidden, true);
  const saved = JSON.parse([...ui.values.values()][0]); ui.f.confirm(saved.review); await ui.click('Check original transaction');
  assert.match(ui.root.textContent, /Withdrawal confirmed/); assert.equal(ui.f.sends, 1); assert.equal(ui.button('Check token').disabled, false);
});
test('unknown wallet result survives refresh and cannot be resent', async t => {
  const ui = fixture(t); await prepare(ui); ui.f.sendError = new Error('offline'); await ui.click('Confirm in wallet');
  assert.equal(ui.f.sends, 1); ui.mount(); assert.equal(ui.button('Confirm in wallet').hidden, true); assert.equal(ui.button('Check token').disabled, true);
  const saved = JSON.parse([...ui.values.values()][0]); ui.f.confirm(saved.review); ui.inputs()[2].value = TX; ui.inputs()[2].listeners.input();
  await ui.click('Check original transaction'); assert.match(ui.root.textContent, /Withdrawal confirmed/); assert.equal(ui.f.sends, 1);
});
test('definite wallet rejection permits fresh review, storage error prevents send', async t => {
  const ui = fixture(t); await prepare(ui); ui.f.sendError = Object.assign(new Error('No'), { code: 4001 }); await ui.click('Confirm in wallet');
  assert.equal(ui.values.size, 0); assert.match(ui.root.textContent, /rejected/); delete ui.f.sendError;
  await prepare(ui); ui.storage.setItem = () => { throw new Error('Storage full'); }; await ui.click('Confirm in wallet'); assert.equal(ui.f.sends, 1);
});
test('malformed saved record is blocked without executing', t => {
  const ui = fixture(t); ui.values.set(`gogh:erc20-withdraw:v1:4663:${OWNER}:93`, '{bad'); ui.mount();
  assert.equal(ui.button('Check token').disabled, true); assert.equal(ui.f.sends, 0); assert.match(ui.root.textContent, /cannot be read/);
});
test('selection change invalidates review and simulated preview cannot use owner funds', async t => {
  const ui = fixture(t); await prepare(ui); ui.select({ owner: OWNER, tokenId: '94', chainId: 4663 }); assert.equal(ui.button('Confirm in wallet').hidden, true);
  ui.select({ owner: OWNER, tokenId: '93', chainId: 4663, preview: true }); assert.equal(ui.button('Check token').disabled, true); assert.equal(ui.f.sends, 0);
});
test('cross-tab existing attempt wins before any new wallet send', async t => {
  const ui = fixture(t); await prepare(ui); const second = await ui.f.prepare();
  ui.values.set(`gogh:erc20-withdraw:v1:4663:${OWNER}:93`, JSON.stringify({ review: second, status: 'WALLET_REQUESTED', transactionHash: null }));
  await ui.click('Confirm in wallet'); assert.equal(ui.f.sends, 0); assert.match(ui.root.textContent, /earlier withdrawal/);
});
test('one owner-wide unknown request blocks another Punk tab and links original recovery', async t => {
  const ui = fixture(t); await prepare(ui); ui.f.sendError = new Error('lost'); await ui.click('Confirm in wallet');
  assert.equal(ui.f.sends, 1); ui.select({ owner: OWNER, tokenId: '94', chainId: 4663 });
  assert.equal(ui.button('Check token').disabled, true); assert.equal(ui.button('Check original transaction').disabled, true);
  assert.match(ui.root.textContent, /Punk #93 is saved/);
  const link = walk(ui.root).find(n => n.localName === 'a' && /Open the Punk/.test(n.textContent));
  assert.equal(link.hidden, false); assert.match(link.href, /tokenId=93/); assert.equal(ui.f.sends, 1);
});
test('blocked browser storage getter does not crash the page and disables withdrawal', t => {
  const ui = fixture(t), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  assert.doesNotThrow(() => createErc20WithdrawalPanel({ ...ui.config, storage: undefined }));
  assert.equal(ui.button('Check token').disabled, true); assert.match(ui.root.textContent, /Browser storage is unavailable/); assert.equal(ui.f.sends, 0);
});
