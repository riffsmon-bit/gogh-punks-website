import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
const ROOT = process.env.GOGH_PURCHASE_PANEL_REVIEW_ROOT
  ? resolve(process.env.GOGH_PURCHASE_PANEL_REVIEW_ROOT) : fileURLToPath(new URL('../', import.meta.url));
const load = path => import(pathToFileURL(join(ROOT, path)).href);
const { createMarketplacePurchasePanel } = await load('site/marketplace-purchase-panel.js');
const { marketplacePanelFixture, PANEL_OWNER, PANEL_OTHER, PANEL_HASH, PANEL_RELEASE } = await load('tests/fixtures/marketplace-panel.mjs');
const wait = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Independent panel fixture did not settle'); };

function harness(t, { release = PANEL_RELEASE, rejectPrepare = false, failGet = false } = {}) {
  class Element {
    constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.childNodes = []; this.listeners = {}; }
    set textContent(value) { this.text = String(value); this.childNodes = []; }
    get textContent() { return (this.text ?? '') + this.childNodes.map(n => n.textContent).join(' '); }
    append(...nodes) { this.childNodes.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
    setAttribute() {}
    addEventListener(event, callback) { this.listeners[event] = callback; }
    attachShadow() { return this.shadowRoot = new Element('shadow', this.ownerDocument); }
    click() { if (!this.disabled) this.listeners.click?.(); }
  }
  const document = { createElement: tag => new Element(tag, document), defaultView: { crypto: webcrypto, setTimeout, clearTimeout } };
  const container = new Element('div', document), values = new Map(), calls = [], settled = [];
  let owner = PANEL_OWNER, selected = { tokenId: '93', chainId: 4663, preview: false, owner }, server = null, tx = null;
  let walletWait = false, finishSend, sends = 0, panel;
  const controls = () => { const walk = node => [node, ...node.childNodes.flatMap(walk)]; return walk(container.shadowRoot); };
  const saved = () => [...values.values()].map(JSON.parse).filter(v => v.schema === 1);
  const empty = () => ({ ...marketplacePanelFixture({ owner, punkId: selected.tokenId }).envelope,
    entry: null, availability: rejectPrepare ? 'RELEASE_BLOCKED' : 'EMPTY', blockers: rejectPrepare ? ['MARKETPLACE_POLICY_DENIED'] : [] });
  const api = async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : null; calls.push({ path, body });
    if (!body) { if (failGet) throw Error('RPC_PROVIDER_BODY_SECRET'); return structuredClone(server ?? empty()); }
    if (body.operation === 'prepare') {
      if (rejectPrepare) return empty();
      const intentId = createHash('sha256').update(JSON.stringify({ chainId: 4663, owner, punkId: selected.tokenId, requestId: body.input.requestId })).digest('hex');
      ({ envelope: server, transaction: tx } = marketplacePanelFixture({ owner, punkId: selected.tokenId, intentId }));
    } else {
      assert.equal(body.intentId, server.entry.intentId); assert.equal(body.revision, server.entry.revision);
      assert.equal(body.reviewHash, server.entry.reviewHash);
      if (body.operation === 'claim') {
        assert.equal(server.entry.status, 'PREPARED'); server.entry.status = 'WALLET_REQUESTED'; server.entry.revision++;
        server.availability = 'RECOVERY_REQUIRED'; return { ...structuredClone(server), walletClaimed: true, transaction: tx };
      }
      if (body.operation === 'recover') {
        assert.equal(body.transactionHash, PANEL_HASH); server.entry.status = 'COMPLETED'; server.entry.reportedHash = PANEL_HASH;
        server.entry.revision++; server.availability = 'COMPLETED'; server.entry.receipt = { status: 'COMPLETED', transactionHash: PANEL_HASH, confirmations: '12' };
      }
      if (body.operation === 'cancel') { assert.equal(server.entry.status, 'PREPARED'); server.entry.status = 'CANCELLED'; server.entry.revision++; server.availability = 'CANCELLED'; }
    }
    return structuredClone(server);
  };
  const options = { container, api, purchaseRelease: release, storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
    getSelected: () => selected, getOwner: () => owner, onSettled: value => settled.push(value),
    getProvider: () => ({ request: async ({ method }) => {
      if (method === 'eth_chainId') return '0x1237'; if (method === 'eth_accounts') return [owner];
      assert.equal(method, 'eth_sendTransaction'); sends++;
      if (walletWait) return new Promise(resolve => { finishSend = () => resolve(PANEL_HASH); });
      return PANEL_HASH;
    } }) };
  panel = createMarketplacePurchasePanel(options); t.after(() => panel.destroy());
  return { container, calls, values, saved, settled, input: marketplacePanelFixture().input,
    get panel() { return panel; }, text: () => container.shadowRoot.textContent,
    button: label => controls().find(n => n.localName === 'button' && n.textContent === label),
    rejectPrepare: value => { rejectPrepare = value; }, failGet: value => { failGet = value; },
    setServer: status => { ({ envelope: server, transaction: tx } = marketplacePanelFixture({ intentId: saved()[0].intentId, status })); },
    remount: () => { panel.destroy(); panel = createMarketplacePurchasePanel(options); },
    holdSend: () => { walletWait = true; }, finishSend: () => finishSend(), sends: () => sends,
    changeOwner: () => { owner = PANEL_OTHER; selected = { ...selected, owner }; panel.clear(); } };
}

test('independent: a rejected unattempted draft can be explicitly discarded and corrected without losing history', async t => {
  const f = harness(t, { rejectPrepare: true }); await f.panel.prepare(f.input);
  const original = structuredClone(f.saved()[0]); assert.equal(original.status, 'DRAFT');
  const discard = f.button('Discard unsent request'); assert.ok(discard && !discard.disabled);
  discard.click(); await wait(() => f.saved()[0].status === 'DISCARDED');
  assert.equal(f.calls.filter(c => !c.body).length, 1);
  assert.ok(f.calls.at(-1).path.endsWith(`?intentId=${original.intentId}`));
  assert.equal(f.saved()[0].attempted, false); assert.equal(f.saved()[0].transactionHash, null);
  assert.equal(f.settled.length, 0, 'local discard must not pretend a chain/receipt settlement');
  assert.match(f.text(), /discarded/i);
  f.rejectPrepare(false); await f.panel.prepare({ ...f.input, budget: { ...f.input.budget, maxTotalPriceWei: '1200000000000000' } });
  assert.equal(f.saved().length, 2); assert.notEqual(f.saved()[1].intentId, original.intentId);
  assert.equal(f.saved()[0].status, 'DISCARDED'); assert.equal(f.saved()[1].status, 'PREPARED'); assert.equal(f.sends(), 0);
});

for (const status of ['PREPARED', 'WALLET_REQUESTED']) test(`independent: draft discard discovers ${status} on the server and preserves it`, async t => {
  const f = harness(t, { rejectPrepare: true }); await f.panel.prepare(f.input); f.setServer(status);
  f.button('Discard unsent request').click(); await wait(() => f.saved()[0].status === status);
  assert.equal(f.saved().length, 1); assert.equal(f.saved()[0].attempted, status === 'WALLET_REQUESTED');
  assert.equal(f.calls.filter(c => c.body && c.body.operation !== 'prepare').length, 0);
  if (status === 'WALLET_REQUESTED') assert.equal(f.button('Discard unsent request'), undefined);
  assert.equal(f.sends(), 0);
});

test('independent: failed lookup cannot discard an unresolved draft or expose provider errors', async t => {
  const f = harness(t, { rejectPrepare: true }); await f.panel.prepare(f.input); const original = structuredClone(f.saved()[0]);
  f.failGet(true); f.button('Discard unsent request').click(); await wait(() => f.text().includes('could not be verified'));
  assert.deepEqual(f.saved()[0], original); assert.doesNotMatch(f.text(), /RPC_PROVIDER_BODY_SECRET/); assert.equal(f.sends(), 0);
});

test('independent: known paused release shows a failed new-device history read and a retry', async t => {
  const f = harness(t, { release: { ...PANEL_RELEASE, status: 'PAUSED' }, failGet: true }); await f.panel.refresh();
  assert.equal(f.calls.length, 1); assert.equal(f.container.hidden, false);
  assert.match(f.text(), /could not be verified/); assert.ok(f.button('Refresh status'));
  assert.equal(f.button('Confirm in wallet'), undefined); assert.equal(f.sends(), 0);
  assert.doesNotMatch(f.text(), /RPC_PROVIDER_BODY_SECRET/);
});

test('independent: absent release on a new device remains hidden without any request', async t => {
  const f = harness(t, { release: null, failGet: true }); await f.panel.refresh();
  assert.equal(f.calls.length, 0); assert.equal(f.container.hidden, true); assert.equal(f.sends(), 0);
});

test('independent: wallet result after selection changes is saved only to the original owner journal', async t => {
  const f = harness(t); await f.panel.prepare(f.input); const originalId = f.saved()[0].intentId;
  f.holdSend(); f.button('Confirm in wallet').click(); await wait(() => f.sends() === 1);
  f.changeOwner(); f.finishSend(); await wait(() => f.saved()[0].transactionHash === PANEL_HASH);
  assert.equal(f.container.hidden, true); assert.equal(f.saved().length, 1);
  assert.equal(f.saved()[0].owner, PANEL_OWNER); assert.equal(f.saved()[0].intentId, originalId);
  assert.equal(f.saved()[0].attempted, true); assert.equal(f.settled.length, 0);
  assert.equal(f.calls.filter(c => c.body?.operation === 'recover').length, 0);
  assert.equal(f.sends(), 1);
});
