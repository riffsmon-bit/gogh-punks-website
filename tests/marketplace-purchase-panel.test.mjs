import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createMarketplacePurchasePanel } from '../site/marketplace-purchase-panel.js';
import { marketplacePanelFixture, PANEL_OWNER, PANEL_OTHER, PANEL_HASH, PANEL_RELEASE } from './fixtures/marketplace-panel.mjs';

class Element {
  constructor(tag, document) { this.localName = tag; this.ownerDocument = document; this.childNodes = []; this.attributes = {}; this.listeners = {}; this.hidden = false; }
  set textContent(value) { this.text = String(value); this.childNodes = []; }
  get textContent() { return (this.text ?? '') + this.childNodes.map(child => child.textContent).join(''); }
  append(...children) { this.childNodes.push(...children); }
  replaceChildren(...children) { this.text = ''; this.childNodes = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
  attachShadow() { this.shadowRoot = new Element('shadow', this.ownerDocument); return this.shadowRoot; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const waitFor = async predicate => { for (let i = 0; i < 80; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Panel operation did not settle'); };

function fixture(t, { release = PANEL_RELEASE, initial = null } = {}) {
  const document = { createElement: tag => new Element(tag, document), defaultView: { crypto: webcrypto, setTimeout, clearTimeout } };
  const container = new Element('div', document), values = new Map(), requests = [], events = [], settlements = [];
  let selected = { tokenId: '93', chainId: 4663, owner: PANEL_OWNER, preview: false }, owner = PANEL_OWNER;
  let server = initial, transaction = null, sends = 0, storageFailure = false, hold = null, losePrepare = false, walletError = null;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (storageFailure) throw Error('storage denied'); values.set(key, value); } };
  const api = async (path, options) => {
    const input = options.body ? JSON.parse(options.body) : null; requests.push({ path, input });
    const requestedOwner = owner;
    if (hold) await hold;
    if (!input) return server ? structuredClone(server) : { ...marketplacePanelFixture({ owner: requestedOwner }).envelope,
      entry: null, availability: 'EMPTY' };
    if (input.operation === 'prepare') {
      const scope = { chainId: 4663, owner: requestedOwner, punkId: selected.tokenId, requestId: input.input.requestId };
      const intentId = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
      assert.ok([...values.values()].some(raw => JSON.parse(raw).requestId === input.input.requestId), 'UUID was not persisted before prepare');
      ({ envelope: server, transaction } = marketplacePanelFixture({ owner: requestedOwner, punkId: selected.tokenId, intentId }));
      events.push('prepare');
      if (losePrepare) { losePrepare = false; throw Error('lost prepare response'); }
    } else {
      assert.equal(input.intentId, server.entry.intentId); assert.equal(input.revision, server.entry.revision); assert.equal(input.reviewHash, server.entry.reviewHash);
      if (input.operation === 'claim') {
        assert.equal(server.entry.status, 'PREPARED');
        assert.ok([...values.values()].some(raw => JSON.parse(raw).intentId === input.intentId && JSON.parse(raw).attempted), 'Attempt must be persisted before claim');
        server.entry.status = 'WALLET_REQUESTED'; server.entry.revision++; server.availability = 'RECOVERY_REQUIRED';
        events.push('claim'); return { ...structuredClone(server), walletClaimed: true, transaction };
      }
      if (input.operation === 'recover') { assert.equal(server.entry.status, 'WALLET_REQUESTED');
        assert.equal(input.transactionHash, PANEL_HASH); server.entry.reportedHash = PANEL_HASH;
        server.entry.status = 'COMPLETED'; server.entry.revision++; server.availability = 'COMPLETED';
        server.entry.receipt = { status: 'COMPLETED', transactionHash: PANEL_HASH, confirmations: '12' }; events.push('recover'); }
      if (input.operation === 'decline') { assert.equal(server.entry.status, 'WALLET_REQUESTED'); server.entry.reason = 'WALLET_DECLINED_UNVERIFIED'; server.entry.revision++; }
      if (input.operation === 'cancel') { assert.equal(server.entry.status, 'PREPARED'); server.entry.status = 'CANCELLED'; server.availability = 'CANCELLED'; server.entry.revision++; }
    }
    return structuredClone(server);
  };
  const options = { container, api, storage, purchaseRelease: release, getSelected: () => selected, getOwner: () => owner,
    getProvider: () => ({ request: async ({ method }) => {
      if (method === 'eth_chainId') return '0x1237'; if (method === 'eth_accounts') return [owner];
      assert.equal(method, 'eth_sendTransaction'); sends++; events.push('send');
      if (walletError) throw walletError; return PANEL_HASH;
    } }), onSettled: value => settlements.push(value) };
  let panel = createMarketplacePurchasePanel(options); t.after(() => panel.destroy());
  return { container, values, requests, events, settlements, input: marketplacePanelFixture().input,
    get panel() { return panel; }, sends: () => sends, server: () => server,
    nodes: () => walk(container.shadowRoot), text: () => container.shadowRoot.textContent,
    button: label => walk(container.shadowRoot).find(node => node.localName === 'button' && node.textContent === label),
    setServer: value => { server = value; }, setOwner: value => { owner = value; }, setSelected: value => { selected = { ...selected, ...value }; },
    losePrepare: () => { losePrepare = true; }, failStorage: () => { storageFailure = true; },
    walletError: value => { walletError = value; }, hold: value => { hold = value; },
    remount(purchaseRelease = release) { panel.destroy(); panel = createMarketplacePurchasePanel({ ...options, purchaseRelease }); return panel; } };
}

test('unreleased idle selection stays hidden and makes no API or wallet requests', async t => {
  const f = fixture(t, { release: null }); await f.panel.refresh();
  assert.equal(f.container.hidden, true); assert.equal(f.requests.length, 0); assert.equal(f.sends(), 0);
});

test('known paused release reads a server purchase on a new device without granting send authority', async t => {
  const initial = marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope;
  const f = fixture(t, { release: { ...PANEL_RELEASE, status: 'PAUSED' }, initial });
  await f.panel.refresh();
  assert.equal(f.requests[0].path, '/api/v2/punks/93/marketplace');
  assert.equal(f.container.hidden, false); assert.ok(f.button('Check original transaction'));
  assert.equal(f.button('Confirm in wallet'), undefined); assert.equal(f.sends(), 0);
  assert.ok([...f.values.values()].some(raw => JSON.parse(raw).intentId === initial.entry.intentId));
});

test('paused release with no server history stays hidden after one scoped read', async t => {
  const f = fixture(t, { release: { ...PANEL_RELEASE, status: 'PAUSED' } });
  await f.panel.refresh(); assert.equal(f.requests.length, 1); assert.equal(f.container.hidden, true);
});

test('prepare persists its UUID and exact server-compatible intent ID before requesting a review', async t => {
  const f = fixture(t); await f.panel.prepare(f.input);
  const sent = f.requests[0].input.input, record = [...f.values.values()].map(JSON.parse).find(value => value.requestId);
  assert.match(sent.requestId, /^[0-9a-f-]{36}$/); assert.equal(record.requestId, sent.requestId);
  assert.equal(record.intentId, f.server().entry.intentId); assert.deepEqual(record.input, f.input);
  assert.equal(f.button('Confirm in wallet').disabled, false); assert.equal(f.sends(), 0);
  assert.match(f.text(), /0\.001000000000000001 ETH/); assert.match(f.text(), /0\.0011 ETH/);
});

test('lost prepare response and remount recover exact original ID without creating a second UUID', async t => {
  const f = fixture(t); f.losePrepare(); await f.panel.prepare(f.input);
  const original = f.server().entry.intentId; f.remount(); await f.panel.refresh();
  assert.equal(f.requests.filter(item => item.input?.operation === 'prepare').length, 1);
  assert.ok(f.requests.at(-1).path.endsWith(`?intentId=${original}`));
  assert.equal(f.button('Confirm in wallet').disabled, false); assert.equal(f.sends(), 0);
});

test('pause after lost prepare still recovers the original journal and disables purchase', async t => {
  const f = fixture(t); f.losePrepare(); await f.panel.prepare(f.input);
  f.server().availability = 'RELEASE_BLOCKED'; f.server().blockers = ['PAUSED'];
  f.remount(null); await f.panel.refresh();
  assert.equal(f.button('Confirm in wallet').disabled, true); assert.ok(f.button('Cancel review'));
  assert.match(f.text(), /Purchases are paused/); assert.equal(f.sends(), 0);
});

test('successful actual helper call renders one receipt card without stale wallet or cancel actions', async t => {
  const f = fixture(t); await f.panel.prepare(f.input); f.button('Confirm in wallet').click();
  await waitFor(() => f.text().includes('Purchase complete'));
  assert.deepEqual(f.events, ['prepare', 'claim', 'send', 'recover']); assert.equal(f.sends(), 1);
  assert.equal(f.nodes().filter(node => node.localName === 'button').length, 0);
  assert.match(f.text(), /Receipt verified/); assert.match(f.text(), new RegExp(PANEL_HASH)); assert.equal(f.settlements.length, 1);
  await f.panel.refresh(); assert.equal(f.settlements.length, 1); assert.equal(f.sends(), 1);
});

test('wallet rejection keeps the original intent reserved across remount with no resend control', async t => {
  const f = fixture(t); await f.panel.prepare(f.input); f.walletError(Object.assign(Error('declined'), { code: 4001 }));
  f.button('Confirm in wallet').click(); await waitFor(() => f.text().includes('Wallet confirmation was declined'));
  assert.equal(f.sends(), 1); assert.equal(f.server().entry.status, 'WALLET_REQUESTED');
  f.remount(); await f.panel.refresh(); assert.equal(f.button('Confirm in wallet'), undefined);
  assert.ok(f.button('Check original transaction')); assert.equal(f.sends(), 1);
});

test('storage write failure stops preparation before API work', async t => {
  const f = fixture(t); f.failStorage(); await f.panel.prepare(f.input);
  assert.equal(f.requests.length, 0); assert.equal(f.sends(), 0); assert.match(f.text(), /Browser storage/);
});

test('storage failure before claim does not send and never clears the saved original reference', async t => {
  const f = fixture(t); await f.panel.prepare(f.input); const saved = [...f.values.entries()]; f.failStorage();
  f.button('Confirm in wallet').click(); await waitFor(() => f.text().includes('Browser storage'));
  assert.equal(f.sends(), 0); assert.equal(f.requests.filter(value => value.input?.operation === 'claim').length, 0);
  assert.deepEqual([...f.values.entries()], saved);
});

test('new selection during an API await never displays another owner’s result or loses their journal', async t => {
  const f = fixture(t); await f.panel.prepare(f.input); const saved = [...f.values.entries()];
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const pending = f.panel.refresh(); f.setOwner(PANEL_OTHER); f.setSelected({ owner: PANEL_OTHER }); f.panel.clear(); release();
  await pending; assert.equal(f.container.hidden, true); assert.deepEqual([...f.values.entries()], saved); assert.equal(f.sends(), 0);
});

test('concurrent prepare and repeated confirm clicks produce one UUID, one claim and one wallet call', async t => {
  const f = fixture(t); await Promise.all([f.panel.prepare(f.input), f.panel.prepare(f.input)]);
  assert.equal(f.requests.filter(value => value.input?.operation === 'prepare').length, 1);
  const confirm = f.button('Confirm in wallet'); confirm.click(); confirm.click();
  await waitFor(() => f.text().includes('Purchase complete'));
  assert.equal(f.requests.filter(value => value.input?.operation === 'claim').length, 1); assert.equal(f.sends(), 1);
});

test('malformed API receipt cannot create a completed purchase or expose a wallet action', async t => {
  const f = fixture(t); await f.panel.prepare(f.input);
  const bad = structuredClone(f.server()); bad.entry.status = 'COMPLETED'; bad.availability = 'COMPLETED'; bad.entry.reportedHash = PANEL_HASH;
  bad.entry.receipt = { status: 'COMPLETED', transactionHash: `0x${'b'.repeat(64)}`, confirmations: '12' }; f.setServer(bad);
  await f.panel.refresh(); assert.doesNotMatch(f.text(), /Purchase complete/); assert.equal(f.button('Confirm in wallet').disabled, true);
});

test('invalid caller budgets, calldata, endpoints and collection input never reach prepare', async t => {
  const f = fixture(t);
  for (const input of [{ ...f.input, calldata: '0x1234' }, { ...f.input, rpcUrl: 'https://attacker.invalid' },
    { ...f.input, budget: { ...f.input.budget, maxTotalPriceWei: 10 } },
    { ...f.input, selection: { ...f.input.selection, collection: '<script>alert(1)</script>' } }]) await f.panel.prepare(input);
  assert.equal(f.requests.length, 0); assert.equal(f.sends(), 0);
  assert.equal(f.nodes().filter(node => node.localName === 'script').length, 0); assert.doesNotMatch(f.text(), /alert\(1\)/);
});

for (const status of ['COMPLETED', 'REVERTED', 'CANCELLED']) test(`${status} restored card has no review/cancel/send buttons`, async t => {
  const f = fixture(t, { initial: marketplacePanelFixture({ status }).envelope }); await f.panel.refresh();
  assert.equal(f.nodes().filter(node => node.localName === 'button').length, 0); assert.equal(f.sends(), 0);
  if (status !== 'CANCELLED') assert.match(f.text(), new RegExp(PANEL_HASH));
});
