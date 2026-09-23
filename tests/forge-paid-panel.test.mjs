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
function lockManager() {
  const held = new Map(), requests = [];
  return { requests, async request(name, options, run) {
    assert.equal(options.mode, 'exclusive'); requests.push(name);
    const prior = held.get(name) ?? Promise.resolve(); let release;
    const next = new Promise(resolve => { release = resolve; }); held.set(name, next);
    await prior;
    try { return await run({ name }); }
    finally { release(); if (held.get(name) === next) held.delete(name); }
  } };
}
function setup(t, release = null, shared = null) {
  const f = shared?.f ?? paidUiFixture(), values = shared?.values ?? new Map(), document = { createElement: tag => new Element(tag, document), querySelector: () => ({ value: '94' }) }, root = new Element('section', document);
  let selected = f.selected, panel, failStorage = false;
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (failStorage) throw Error('Storage unavailable'); values.set(k, v); }, removeItem: k => values.delete(k) };
  const config = { root, release: release ?? f.release, getSelection: () => selected, ensureSession: async () => { f.signIns++; },
    request: (...args) => f.request(...args), getProvider: () => f.provider, readProvider: { request: args => f.provider.request(args) },
    storage, locks: shared?.config.locks ?? lockManager() };
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
  const f = setup(t, { ...PAID_TRAINING_RELEASE, status: 'UNDEPLOYED', extension: null, extensionCodeHash: null, allowedOwners: [], productionPaymentsAuthorized: false, canonicalReadersReviewed: false }); assert.match(f.text(), /0\.0005 ETH/); assert.match(f.text(), /being prepared/);
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
test('refresh unsent review replaces only the saved draft and still requires a separate wallet confirmation',async t=>{
 const f=setup(t);await prepare(f);const before=JSON.parse([...f.values.values()][0]);
 await f.click('REFRESH UNSENT REVIEW');const after=JSON.parse([...f.values.values()][0]);
 assert.notDeepEqual(after.review.anchor,before.review.anchor);assert.deepEqual(after.review.action,before.review.action);
 assert.equal(after.attempted,false);assert.equal(f.f.sends,0);assert.equal(f.f.methods.length,0);
 assert.match(f.text(),/Check the payment and new maximum fee/);
 await f.click('CONFIRM PAID TRAINING IN WALLET');assert.equal(f.f.sends,1);
 assert.equal(f.button('REFRESH UNSENT REVIEW'),undefined);
});
test('another tab marking an attempt while renewal is pending prevents replacing that request',async t=>{
 const f=setup(t);await prepare(f);const request=f.f.request;
 f.f.request=async(path,options)=>{const result=await request(path,options);if(options?.body&&JSON.parse(options.body).operation==='prepare'){
   const [key,value]=[...f.values.entries()][0];f.values.set(key,JSON.stringify({...JSON.parse(value),attempted:true}));
 }return result;};
 await f.click('REFRESH UNSENT REVIEW');assert.match(f.text(),/saved request changed/);
 assert.equal(JSON.parse([...f.values.values()][0]).attempted,true);assert.equal(f.f.sends,0);
});
test('a second tab cannot refresh over a wallet attempt while confirmation holds the shared lock', async t => {
  const first = setup(t); await prepare(first); const second = setup(t, null, first); await second.click('RECHECK PAID TRAINING');
  let release; first.f.verifyHook = () => new Promise(resolve => { release = resolve; });
  first.button('CONFIRM PAID TRAINING IN WALLET').click(); await until(() => typeof release === 'function');
  const preparations = first.f.requests.filter(value => value === 'prepare').length;
  second.button('REFRESH UNSENT REVIEW').click(); await until(() => first.config.locks.requests.length === 3);
  assert.equal(first.f.requests.filter(value => value === 'prepare').length, preparations);
  assert.equal(first.f.sends, 0); release();
  await until(() => first.root.attributes['aria-busy'] === 'false' && second.root.attributes['aria-busy'] === 'false');
  const saved = JSON.parse([...first.values.values()][0]);
  assert.equal(saved.attempted, true); assert.equal(saved.transactionHash, PAID_UI_HASH); assert.equal(first.f.sends, 1);
  assert.match(second.text(), /saved request changed in another tab/);
  assert.equal(first.f.requests.filter(value => value === 'prepare').length, preparations);
});
test('confirmation queued behind renewal cannot send a replacement review the user has not reviewed', async t => {
  const first = setup(t); await prepare(first); const second = setup(t, null, first); await second.click('RECHECK PAID TRAINING');
  const original = first.f.request; let release;
  first.f.request = async (...args) => {
    const result = await original(...args);
    if (JSON.parse(args[1]?.body ?? '{}').operation === 'prepare') await new Promise(resolve => { release = resolve; });
    return result;
  };
  first.button('REFRESH UNSENT REVIEW').click(); await until(() => typeof release === 'function');
  second.button('CONFIRM PAID TRAINING IN WALLET').click(); await until(() => first.config.locks.requests.length === 3);
  assert.equal(first.f.requests.includes('verify'), false); assert.equal(first.f.sends, 0); release();
  await until(() => first.root.attributes['aria-busy'] === 'false' && second.root.attributes['aria-busy'] === 'false');
  assert.match(second.text(), /saved request changed in another tab/); assert.equal(first.f.methods.length, 0);
  assert.equal(JSON.parse([...first.values.values()][0]).attempted, false);
  await first.click('CONFIRM PAID TRAINING IN WALLET'); assert.equal(first.f.sends, 1);
});
test('two tabs confirming one review preserve an unknown wallet result and prompt only once', async t => {
  const first = setup(t); await prepare(first); const second = setup(t, null, first); await second.click('RECHECK PAID TRAINING');
  let release; first.f.mode = 'lost';
  first.f.beforeRpc = async method => { if (method === 'eth_sendTransaction') await new Promise(resolve => { release = resolve; }); };
  first.button('CONFIRM PAID TRAINING IN WALLET').click(); await until(() => typeof release === 'function');
  assert.equal(JSON.parse([...first.values.values()][0]).attempted, true);
  second.button('CONFIRM PAID TRAINING IN WALLET').click(); await until(() => first.config.locks.requests.length === 3);
  release(); await until(() => first.root.attributes['aria-busy'] === 'false' && second.root.attributes['aria-busy'] === 'false');
  assert.equal(first.f.methods.filter(method => method === 'eth_sendTransaction').length, 1); assert.equal(first.f.sends, 1);
  const saved = JSON.parse([...first.values.values()][0]); assert.equal(saved.attempted, true); assert.equal(saved.transactionHash, null);
  assert.match(second.text(), /saved request changed in another tab/);
  assert.equal(second.button('CONFIRM PAID TRAINING IN WALLET'), undefined);
});
test('stale tabs cannot replace an existing review or discard a newer unsent review', async t => {
  const first = setup(t), second = setup(t, null, first);
  await first.click('RECHECK PAID TRAINING'); await second.click('RECHECK PAID TRAINING');
  await first.click('REVIEW BUY 1 CREDIT · 0.0005 ETH'); const initial = [...first.values.values()];
  await second.click('REVIEW BUY 1 CREDIT · 0.0005 ETH');
  assert.match(second.text(), /saved request changed in another tab/); assert.deepEqual([...first.values.values()], initial);
  await first.click('REFRESH UNSENT REVIEW'); const renewed = [...first.values.values()];
  await second.click('DISCARD UNSENT REVIEW');
  assert.match(second.text(), /saved request changed in another tab/); assert.deepEqual([...first.values.values()], renewed);
  assert.equal(first.f.requests.filter(value => value === 'prepare').length, 2); assert.equal(first.f.sends, 0);
});
test('current durable review identity is checked again before marking a wallet attempt', async t => {
  const f = setup(t); await prepare(f); const old = [...f.values.values()][0];
  f.f.verifyHook = () => {
    const [key] = f.values.keys(), saved = JSON.parse(old);
    f.values.set(key, JSON.stringify({ ...saved, attempted: true }));
  };
  await f.click('CONFIRM PAID TRAINING IN WALLET');
  assert.match(f.text(), /saved request changed in another tab/);
  assert.equal(JSON.parse([...f.values.values()][0]).attempted, true); assert.equal(f.f.sends, 0);
});
test('missing browser locks blocks paid mutations but not balance checks or equipped research', async t => {
  const f = setup(t); f.config.locks = null; f.f.state.activated = true;
  f.f.state.skills[0].level = 1; f.f.state.equipped[0] = f.f.release.skills[0].key; f.mount();
  await f.click('RECHECK PAID TRAINING'); await f.click('RUN EQUIPPED RESEARCH'); assert.match(f.text(), /3 Punks compared/);
  await f.click('REVIEW BUY 1 CREDIT · 0.0005 ETH'); assert.match(f.text(), /needs browser tab protection/);
  assert.equal(f.f.requests.includes('prepare'), false); assert.equal(f.values.size, 0); assert.equal(f.f.sends, 0);
});
test('throwing localStorage getter leaves the panel visible and blocks new wallet requests', t => {
  const f = setup(t), original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('Blocked storage'); } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  delete f.config.storage; assert.doesNotThrow(() => f.mount());
  assert.match(f.text(), /Browser storage.*unavailable/); assert.equal(f.controls().length, 0);
  assert.equal(f.f.requests.length, 0); assert.equal(f.f.methods.length, 0); assert.equal(f.f.sends, 0);
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
  assert.match(f.text(), /Allow site storage.*PAID_STORAGE_UNAVAILABLE/);
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
