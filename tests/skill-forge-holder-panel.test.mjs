import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolderBurnPanel } from '../site/forge-holder-panel.js';
import { encodePunkBurnApproval } from '../site/forge-burn-calldata.js';

class Element {
  constructor(tag, document) { this.localName = tag; this.ownerDocument = document; this.childNodes = []; this.listeners = {}; this.attributes = {};
    this.classList = { add() {} }; this.value = ''; this.checked = false; }
  set textContent(v) { this.text = String(v); this.childNodes = []; }
  get textContent() { return (this.text ?? '') + this.childNodes.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  get options() { return this.childNodes.filter(c => c.localName === 'option'); }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const walk = node => [node, ...node.childNodes.filter(c => typeof c !== 'string').flatMap(walk)];
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Panel did not settle'); };
const address = n => `0x${n.toString(16).padStart(40, '0')}`;
function fixture() {
  const document = { createElement: tag => new Element(tag, document) }, root = new Element('div', document), values = new Map();
  let current = { owner: address(1), tokenId: '119', chainId: 4663, preview: false }, rows = ['119', '812'], server = null;
  let blocked = true, pause = null, releasePause, sends = 0;
  const requests = [], notifications = [];
  const release = { status: 'LIVE', productionBurnAuthorized: true, collection: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6', trainingSource: address(4), feeCeilingWei: '100000000' };
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const envelope = () => ({ ok: true, mode: 'HOLDER_BURN', chainId: 4663, collection: release.collection, owner: address(1), sourceTokenId: '812', targetTokenId: '119', record: server });
  const request = async (url, options) => {
    requests.push({ url, options }); if (pause) await pause;
    if (options.method === 'GET') return envelope();
    const body = options.body;
    if (body.operation === 'check') return { ...envelope(), source: { canBurn: !blocked, blockers: blocked ? ['HOLDER_HISTORY_INCOMPLETE'] : [],
      history: { complete: !blocked, progressPercent: blocked ? 25 : 100 }, wallets: [{ role: 'V1', nativeWei: '0', wethWei: '0' }], obligations: { checks: [] } } };
    if (body.operation === 'prepare') {
      server = { status: 'PREPARED', revision: 0, reviewHash: 'b'.repeat(64), reportedHash: null, review: {
        intentId: 'a'.repeat(64), action: body.action, state: { owner: address(1), sourceTokenId: '812', targetTokenId: '119' },
        expiresAt: Date.now() + 60000, maximumNetworkFeeWei: '1000000', transaction: { from: address(1), to: release.collection,
          chainId: '0x1237', value: '0x0', nonce: '0x0', gas: '0x186a0', gasPrice: '0xa', data: encodePunkBurnApproval(release.trainingSource, '812') } } };
      return envelope();
    }
    if (body.operation === 'claim') { server = { ...server, revision: 1, status: 'WALLET_REQUESTED' }; return { ...envelope(), transaction: server.review.transaction }; }
    if (body.operation === 'recover') { server = { ...server, status: 'CONFIRMED', revision: 2, receipt: { creditGain: server.review.action === 'BURN' ? 1 : 0 } }; return envelope(); }
    return envelope();
  };
  const provider = { request: async ({ method }) => method === 'eth_chainId' ? '0x1237' : method === 'eth_accounts' ? [current.owner] : (sends++, `0x${'c'.repeat(64)}`) };
  const panel = createHolderBurnPanel({ root, getSelection: () => current, getOwnedPunks: () => rows, ensureSession: async () => true,
    request, getProvider: () => provider, onConfirmed: r => notifications.push(r), release, storage });
  return { panel, root, values, requests, notifications, sends: () => sends,
    choose() { const select = walk(root).find(e => e.localName === 'select'); select.value = '812'; select.listeners.change(); },
    button(text) { return walk(root).find(e => e.localName === 'button' && e.textContent === text); },
    unblock() { blocked = false; },
    hold() { pause = new Promise(resolve => { releasePause = resolve; }); }, resume() { releasePause?.(); pause = null; },
    change(owner = address(2), id = '120') { current = { ...current, owner, tokenId: id }; },
    burned() { rows = ['119']; server = { status: 'WALLET_REQUESTED', revision: 1, reportedHash: null,
      review: { intentId: 'a'.repeat(64), action: 'BURN' }, reviewHash: 'b'.repeat(64) };
      storage.setItem(`gogh:holder-burn:last:4663:${address(1)}:119`, '812');
      storage.setItem(`gogh:holder-burn:4663:${address(1)}:812:119`, JSON.stringify({ intentId: 'a'.repeat(64), requested: true, transactionHash: `0x${'c'.repeat(64)}` })); },
  };
}
test('holder selector excludes recipient and never shows a burn action for an incomplete inventory', async () => {
  const f = fixture(); await f.panel.refresh();
  assert.deepEqual(walk(f.root).find(e => e.localName === 'select').options.map(o => o.value), ['', '812']);
  f.choose(); f.button('Check this Punk’s wallets').click(); await until(() => f.root.textContent.includes('25%'));
  assert.equal(f.button('Review approval'), undefined); assert.ok(f.button('Continue wallet check'));
  assert.equal(f.sends(), 0); assert.equal(f.root.textContent.includes('calldata'), false);
});
test('approval requires separate owner review and yields exactly one wallet request', async () => {
  const f = fixture(); f.unblock(); await f.panel.refresh(); f.choose(); f.button('Check this Punk’s wallets').click();
  await until(() => f.button('Review approval') && !f.button('Review approval').disabled); f.button('Review approval').click();
  await until(() => f.button('Confirm approval · open wallet'));
  assert.equal(f.button('Confirm approval · open wallet').disabled, true);
  const consent = walk(f.root).find(e => e.localName === 'input' && e.type === 'checkbox'); consent.checked = true; consent.listeners.change();
  f.button('Confirm approval · open wallet').click(); await until(() => f.sends() === 1 && f.button('Recheck original result'));
  assert.equal(f.button('Confirm approval · open wallet'), undefined); assert.equal(f.sends(), 1);
});
test('owner and Punk changes suppress late check results', async () => {
  const f = fixture(); await f.panel.refresh(); f.choose(); f.hold(); f.button('Check this Punk’s wallets').click();
  await until(() => f.requests.length === 1); f.change(); await f.panel.refresh(); f.resume();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.root.textContent.includes('25%'), false);
  assert.equal(f.root.textContent.includes('Train Punk #120'), true); assert.equal(f.sends(), 0);
});
test('burned source removed from roster can recover original receipt after refresh without another send', async () => {
  const f = fixture(); f.burned(); await f.panel.refresh();
  assert.ok(walk(f.root).find(e => e.localName === 'select').options.some(o => o.textContent === 'Punk #812 · saved review'));
  f.button('Recheck original result').click(); await until(() => f.notifications.length === 1);
  assert.equal(f.sends(), 0); assert.equal(f.root.textContent.includes('earned 1 Training Credit'), true);
  assert.equal(f.button('Review approval'), undefined); assert.equal(f.button('Check this Punk’s wallets'), undefined);
});
