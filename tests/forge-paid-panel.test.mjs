import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaidTrainingPanel } from '../site/forge-paid-panel.js';
import { PAID_TRAINING_RELEASE } from '../site/forge-paid-release.js';
import { paidUiFixture, PAID_UI_HASH } from './fixtures/paid-training-ui.mjs';
class Element {
  constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.childNodes = []; this.listeners = {}; this.style = {}; this.attributes = {}; }
  set textContent(v) { this.text = String(v); this.childNodes = []; }
  get textContent() { return (this.text ?? '') + this.childNodes.map(n => n.textContent).join(''); }
  append(...nodes) { this.childNodes.push(...nodes); } replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
  setAttribute(k, v) { this.attributes[k] = v; } addEventListener(k, fn) { this.listeners[k] = fn; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('UI did not settle'); };
function setup(t, release = null) {
  const f = paidUiFixture(), values = new Map(), document = { createElement: tag => new Element(tag, document), querySelector: () => ({ value: '94' }) }, root = new Element('section', document);
  let selected = f.selected, panel, failStorage = false;
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (failStorage) throw Error('Storage unavailable'); values.set(k, v); }, removeItem: k => values.delete(k) };
  const config = { root, release: release ?? f.release, getSelection: () => selected, ensureSession: async () => { f.signIns++; },
    request: (...args) => f.request(...args), getProvider: () => f.provider, storage };
  const mount = () => { panel?.destroy(); panel = createPaidTrainingPanel(config); };
  const controls = () => walk(root).filter(n => n.localName === 'button');
  f.beforeSend = () => assert.equal(JSON.parse([...values.values()][0]).attempted, true);
  mount(); t.after(() => panel.destroy());
  return { f, root, values, config, mount, storage, panel: () => panel, text: () => root.textContent,
    button: label => controls().find(n => n.textContent === label), controls,
    select(value) { selected = value; panel.selectionChanged(); }, failStorage: () => { failStorage = true; },
    async click(label) { const b = controls().find(n => n.textContent === label); assert.ok(b, label); assert.equal(b.disabled, false, label); b.click(); await until(() => root.attributes['aria-busy'] === 'false'); },
  };
}
const prepare = async f => { await f.click('RECHECK PAID TRAINING'); await f.click('REVIEW BUY 1 CREDIT · 0.0005 ETH'); };
test('UNDEPLOYED renders optional price and help only, never session/API/RPC or wallet controls', t => {
  const f = setup(t, PAID_TRAINING_RELEASE); assert.match(f.text(), /0\.0005 ETH/); assert.match(f.text(), /being prepared/);
  assert.equal(f.controls().length, 0); assert.equal(f.f.signIns, 0); assert.equal(f.f.requests.length, 0); assert.equal(f.f.methods.length, 0);
});
test('disconnected and wrong-chain selections never read or prompt', t => {
  const f = setup(t); f.select(null); assert.equal(f.controls().length, 0); f.select({ ...f.f.selected, chainId: 1 });
  assert.equal(f.controls().length, 0); assert.equal(f.f.requests.length, 0); assert.equal(f.f.methods.length, 0);
});
test('balances remain separate and activation is an explicit reviewed operation', async t => {
  const f = setup(t); await f.click('RECHECK PAID TRAINING'); assert.match(f.text(), /Purchased credits: 2\. Burn-earned credits: 7/);
  assert.equal(f.button('REVIEW LEARN · 1 PURCHASED CREDIT'), undefined);
  await f.click('REVIEW PAID TRAINING SETUP'); assert.match(f.text(), /permanent choice/); assert.match(f.text(), /Payment: 0 ETH/);
  assert.equal(f.f.sends, 0); assert.equal(f.f.methods.length, 0);
});
test('sacrifice approval disables purchase with actionable revoke-first guidance', async t => {
  const f = setup(t); f.f.state.burnApprovalActive = true; await f.click('RECHECK PAID TRAINING');
  assert.equal(f.button('REVIEW BUY 1 CREDIT · 0.0005 ETH').disabled, true);
  assert.match(f.text(), /This Punk is approved for sacrifice\. Revoke its burn approval before buying credits for it\./);
  f.button('REVIEW BUY 1 CREDIT · 0.0005 ETH').click();
  assert.equal(f.f.requests.includes('prepare'), false); assert.equal(f.f.methods.length, 0); assert.equal(f.f.sends, 0);
});
test('buy review discloses exact payment/no refund; confirmed success closes explicitly', async t => {
  const f = setup(t); await prepare(f); assert.match(f.text(), /no refund function/); assert.match(f.text(), /exactly one purchased credit/);
  await f.click('CONFIRM PAID TRAINING IN WALLET'); assert.equal(f.f.sends, 1); assert.equal(f.button('CONFIRM PAID TRAINING IN WALLET'), undefined);
  f.f.receiptStatus = 'CONFIRMED_SUCCESS'; await f.click('RECOVER PAID TRAINING TRANSACTION');
  assert.ok(f.button('CLOSE CONFIRMED REVIEW')); assert.equal(f.values.size, 1); await f.click('CLOSE CONFIRMED REVIEW');
  assert.equal(f.values.size, 0); assert.equal(f.button('REVIEW BUY 1 CREDIT · 0.0005 ETH'), undefined); assert.equal(f.f.sends, 1);
});
test('lost/rejected response persists across reload, cannot replay and requires exact receipt recovery', async t => {
  for (const mode of ['lost', 'reject']) {
    const f = setup(t); await prepare(f); f.f.mode = mode; await f.click('CONFIRM PAID TRAINING IN WALLET'); assert.equal(f.f.sends, 1);
    const prior = f.f.methods.length; f.mount(); assert.equal(f.f.methods.length, prior); assert.equal(f.button('CONFIRM PAID TRAINING IN WALLET'), undefined);
    const input = walk(f.root).find(n => n.localName === 'input'); input.value = PAID_UI_HASH;
    f.f.receiptStatus = 'INCLUDED_SUCCESS'; await f.click('RECOVER PAID TRAINING TRANSACTION'); assert.equal(f.f.methods.length, prior);
    assert.equal(f.button('CLOSE CONFIRMED REVIEW'), undefined); assert.equal(f.button('REVIEW BUY 1 CREDIT · 0.0005 ETH'), undefined);
    f.f.receiptStatus = 'CONFIRMED_REVERT'; await f.click('RECOVER PAID TRAINING TRANSACTION'); assert.ok(f.button('CLOSE CONFIRMED REVIEW')); assert.equal(f.f.sends, 1);
  }
});
test('rejected no-hash attempt can close only after explicit finalized expired-unused proof', async t => {
  const f = setup(t); await prepare(f); f.f.mode = 'reject'; await f.click('CONFIRM PAID TRAINING IN WALLET');
  await f.click('CHECK EXPIRED REQUEST'); assert.match(f.text(), /proof.*unavailable/); assert.equal(f.button('CLOSE CONFIRMED REVIEW'), undefined);
  f.f.expiredUnused = true; await f.click('CHECK EXPIRED REQUEST'); assert.match(f.text(), /nonces remain unused/);
  await f.click('CLOSE CONFIRMED REVIEW'); assert.equal(f.values.size, 0); assert.equal(f.f.sends, 1);
});
test('failed attempt storage prevents wallet send and selection change hides stale review', async t => {
  const f = setup(t); await prepare(f); f.failStorage(); await f.click('CONFIRM PAID TRAINING IN WALLET'); assert.equal(f.f.sends, 0);
  f.select({ ...f.f.selected, tokenId: '94' }); assert.equal(f.button('CONFIRM PAID TRAINING IN WALLET'), undefined);
  assert.equal(f.values.size, 1); assert.equal(f.f.sends, 0);
});
test('selection switch while verify is outstanding cannot prompt', async t => {
  const f = setup(t); await prepare(f); let release; const held = new Promise(r => { release = r; }); f.f.verifyHook = () => held;
  f.button('CONFIRM PAID TRAINING IN WALLET').click(); await until(() => f.f.requests.includes('verify'));
  f.select({ ...f.f.selected, chainId: 1 }); release(); await new Promise(r => setTimeout(r, 10));
  assert.equal(f.f.sends, 0); assert.equal(f.f.methods.length, 0); assert.equal(f.controls().length, 0);
});
test('PAUSED release restores exact attempted review recovery without payment/RPC', async t => {
  const f = setup(t); await prepare(f); f.f.mode = 'lost'; await f.click('CONFIRM PAID TRAINING IN WALLET');
  f.config.release = { ...f.f.release, status: 'PAUSED', productionPaymentsAuthorized: false }; f.mount(); const before = f.f.methods.length;
  walk(f.root).find(n => n.localName === 'input').value = PAID_UI_HASH; f.f.receiptStatus = 'CONFIRMED_SUCCESS';
  await f.click('RECOVER PAID TRAINING TRANSACTION'); assert.ok(f.button('CLOSE CONFIRMED REVIEW')); assert.equal(f.f.methods.length, before);
  assert.equal(f.button('CONFIRM PAID TRAINING IN WALLET'), undefined); assert.equal(f.f.sends, 1);
});
test('activated canonical skill supports research and hides duplicate learning', async t => {
  const f = setup(t); f.f.state.activated = true; f.f.state.skills[0].level = 1; f.f.state.equipped[0] = f.f.release.skills[0].key;
  await f.click('RECHECK PAID TRAINING'); assert.match(f.text(), /Active loadout/);
  assert.equal(f.button('REVIEW LEARN · 1 PURCHASED CREDIT'), undefined); assert.ok(f.button('RUN EQUIPPED RESEARCH'));
  assert.ok(f.button('REVIEW UNEQUIP SLOT 1')); assert.equal(f.button('REVIEW EQUIP').disabled, true);
  await f.click('RUN EQUIPPED RESEARCH'); assert.match(f.text(), /3 Punks compared/); assert.equal(f.f.methods.length, 0); assert.equal(f.f.sends, 0);
});
test('changed recovery/proof echoes never clear the saved attempted request', async t => {
  for (const operation of ['recover', 'abandon']) {
    const f = setup(t); await prepare(f); f.f.mode = 'lost'; await f.click('CONFIRM PAID TRAINING IN WALLET');
    const before = [...f.values.values()], original = f.f.request;
    f.f.request = async (...args) => { const response = await original(...args); if (response.review) response.review.tokenId = '94'; return response; };
    if (operation === 'recover') { walk(f.root).find(n => n.localName === 'input').value = PAID_UI_HASH; f.f.receiptStatus = 'CONFIRMED_SUCCESS';
      await f.click('RECOVER PAID TRAINING TRANSACTION'); }
    else { f.f.expiredUnused = true; await f.click('CHECK EXPIRED REQUEST'); }
    assert.deepEqual([...f.values.values()], before); assert.equal(f.button('CLOSE CONFIRMED REVIEW'), undefined); assert.equal(f.f.sends, 1);
  }
});
