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

function fixture(t, { release = PANEL_RELEASE, initial = null, authenticate } = {}) {
  const document = { createElement: tag => new Element(tag, document), defaultView: { crypto: webcrypto, setTimeout, clearTimeout } };
  const container = new Element('div', document), values = new Map(), requests = [], events = [], settlements = [];
  let selected = { tokenId: '93', chainId: 4663, owner: PANEL_OWNER, preview: false }, owner = PANEL_OWNER;
  let server = initial, transaction = null, sends = 0, storageFailure = false, hold = null, losePrepare = false, walletError = null;
  let blockPrepare = false, readError = null;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (storageFailure) throw Error('storage denied'); values.set(key, value); } };
  const api = async (path, options) => {
    const input = options.body ? JSON.parse(options.body) : null; requests.push({ path, input });
    const requestedOwner = owner;
    if (hold) await hold;
    if (!input && readError) throw readError;
    if (!input) return server ? structuredClone(server) : { ...marketplacePanelFixture({ owner: requestedOwner }).envelope,
      entry: null, availability: 'EMPTY' };
    if (input.operation === 'prepare') {
      if (blockPrepare) return { ...marketplacePanelFixture({ owner: requestedOwner }).envelope,
        entry: null, availability: 'RELEASE_BLOCKED', blockers: ['LISTING_UNAVAILABLE'] };
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
  const options = { container, api, storage, authenticate, purchaseRelease: release, getSelected: () => selected, getOwner: () => owner,
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
    blockPrepare: value => { blockPrepare = value; }, readError: value => { readError = value; },
    remount(purchaseRelease = release) { panel.destroy(); panel = createMarketplacePurchasePanel({ ...options, purchaseRelease }); return panel; } };
}

test('unreleased idle selection stays hidden and makes no API or wallet requests', async t => {
  let signIns = 0;
  const f = fixture(t, { release: null, authenticate: () => { signIns++; } }); await f.panel.refresh();
  assert.equal(f.container.hidden, true); assert.equal(f.requests.length, 0); assert.equal(f.sends(), 0);
  assert.equal(signIns, 0);
});

const sessionError = code => Object.assign(Error('session unavailable'), { code });

test('expired saved recovery offers explicit sign-in and never authenticates during refresh', async t => {
  let signIns = 0, f;
  f = fixture(t, { initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { signIns++; f.readError(null); } });
  await f.panel.refresh(); const original = f.server().entry.intentId;
  f.remount(null); f.readError(sessionError('V2_SESSION_EXPIRED'));
  await f.panel.refresh(); await f.panel.refresh();
  assert.equal(signIns, 0); assert.ok(f.button('Sign in to recover'));
  const requestCount = f.requests.length, signIn = f.button('Sign in to recover'); signIn.click(); signIn.click();
  await waitFor(() => f.text().includes('Track your purchase') && !f.button('Sign in to recover'));
  assert.equal(signIns, 1); assert.equal(f.requests.length, requestCount + 1);
  assert.equal(f.requests.at(-1).input, null); assert.ok(f.requests.at(-1).path.endsWith(`?intentId=${original}`));
  assert.equal(f.sends(), 0); assert.equal(f.requests.filter(value => value.input?.operation === 'claim').length, 0);
});

test('known paused release can explicitly sign in to find its original server recovery on a new device', async t => {
  let signIns = 0, f;
  f = fixture(t, { release: { ...PANEL_RELEASE, status: 'PAUSED' },
    initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { signIns++; f.readError(null); } });
  f.readError(sessionError('V2_SESSION_REQUIRED')); await f.panel.refresh();
  assert.equal(signIns, 0); f.button('Sign in to recover').click();
  await waitFor(() => f.text().includes('Track your purchase'));
  assert.equal(signIns, 1); assert.equal(f.requests.at(-1).path, '/api/v2/punks/93/marketplace');
  assert.ok(f.requests.every(value => value.input === null)); assert.equal(f.sends(), 0);
});

test('explicit sign-in recovers a bound original hash without preparing, claiming or sending', async t => {
  let f;
  f = fixture(t, { initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { f.readError(null); } });
  await f.panel.refresh(); f.server().entry.reportedHash = PANEL_HASH;
  f.readError(sessionError('V2_SESSION_EXPIRED')); await f.panel.refresh();
  const before = f.requests.length; f.button('Sign in to recover').click();
  await waitFor(() => f.text().includes('Purchase complete'));
  assert.deepEqual(f.requests.slice(before).map(value => value.input?.operation ?? 'GET'), ['GET', 'recover']);
  assert.equal(f.requests.at(-1).input.transactionHash, PANEL_HASH); assert.equal(f.sends(), 0);
  assert.equal(f.nodes().filter(node => node.localName === 'button').length, 0);
});

for (const change of ['Punk', 'owner', 'Punk round trip']) test(`selection change during explicit sign-in blocks recovery: ${change}`, async t => {
  let releaseSignIn, signIns = 0;
  const waiting = new Promise(resolve => { releaseSignIn = resolve; });
  const f = fixture(t, { initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { signIns++; await waiting; } });
  await f.panel.refresh(); f.readError(sessionError('V2_SESSION_EXPIRED')); await f.panel.refresh();
  const requests = f.requests.length, saved = [...f.values.entries()]; f.button('Sign in to recover').click();
  await waitFor(() => signIns === 1);
  if (change === 'owner') { f.setOwner(PANEL_OTHER); f.setSelected({ owner: PANEL_OTHER }); }
  else f.setSelected({ tokenId: '94' });
  f.panel.clear();
  if (change === 'Punk round trip') { f.setSelected({ tokenId: '93' }); f.panel.clear(); }
  f.readError(null); releaseSignIn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, requests); assert.deepEqual([...f.values.entries()], saved);
  assert.equal(f.container.hidden, true); assert.equal(f.sends(), 0);
});

for (const declined of [true, false]) test(`failed explicit sign-in preserves recovery without automatic retry: ${declined ? 'declined' : 'unavailable'}`, async t => {
  let signIns = 0;
  const f = fixture(t, { initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { signIns++; throw declined ? Object.assign(Error('declined'), { code: 4001 }) : Error('<script>private error</script>'); } });
  await f.panel.refresh(); f.readError(sessionError('V2_SESSION_EXPIRED')); await f.panel.refresh();
  const saved = [...f.values.entries()], requests = f.requests.length;
  f.button('Sign in to recover').click();
  await waitFor(() => f.text().includes(declined ? 'Sign-in was declined' : 'Sign-in could not be completed'));
  assert.equal(signIns, 1); assert.equal(f.requests.length, requests); assert.deepEqual([...f.values.entries()], saved);
  assert.equal(f.button('Sign in to recover').disabled, false); assert.equal(f.sends(), 0);
  assert.doesNotMatch(f.text(), /private error|Wallet confirmation was declined/);
  await f.panel.refresh(); assert.equal(signIns, 1);
});

test('sign-in recovery cannot replay an unresolved draft preparation', async t => {
  let f;
  f = fixture(t, { authenticate: async () => { f.readError(null); } }); f.blockPrepare(true);
  await f.panel.prepare(f.input); f.readError(sessionError('V2_SESSION_REQUIRED')); await f.panel.refresh();
  const before = f.requests.length; f.button('Sign in to recover').click();
  await waitFor(() => f.requests.length > before && !f.button('Sign in to recover'));
  assert.equal(f.requests.length, before + 1); assert.equal(f.requests.at(-1).input, null);
  assert.equal(f.requests.filter(value => value.input?.operation === 'prepare').length, 1);
  assert.ok(f.button('Discard unsent request')); assert.equal(f.sends(), 0);
});

test('sign-in cannot switch to a different locally active purchase while authentication waits', async t => {
  let releaseSignIn, signIns = 0;
  const waiting = new Promise(resolve => { releaseSignIn = resolve; });
  const f = fixture(t, { initial: marketplacePanelFixture({ status: 'WALLET_REQUESTED' }).envelope,
    authenticate: async () => { signIns++; await waiting; } });
  await f.panel.refresh(); f.readError(sessionError('V2_SESSION_EXPIRED')); await f.panel.refresh();
  const requests = f.requests.length; f.button('Sign in to recover').click(); await waitFor(() => signIns === 1);
  const [key, raw] = [...f.values.entries()].find(([key]) => key.includes(':intent:'));
  const saved = JSON.parse(raw), newIntent = 'f'.repeat(64), prefix = key.split(':intent:')[0];
  f.values.set(`${prefix}:intent:${newIntent}`, JSON.stringify({ ...saved, intentId: newIntent }));
  f.values.set(`${prefix}:active`, JSON.stringify({ intentId: newIntent }));
  f.readError(null); releaseSignIn(); await waitFor(() => f.text().includes('Check or cancel the original purchase'));
  assert.equal(f.requests.length, requests); assert.equal(f.values.get(key), raw); assert.equal(f.sends(), 0);
});

test('sign-in action requires an authentication callback and an exact session-required API code', async t => {
  const noCallback = fixture(t); noCallback.readError(sessionError('V2_SESSION_REQUIRED')); await noCallback.panel.refresh();
  assert.equal(noCallback.button('Sign in to recover'), undefined);
  let signIns = 0;
  const unrelated = fixture(t, { authenticate: () => { signIns++; } });
  unrelated.readError(sessionError('POLICY_AUTHORITY_DENIED')); await unrelated.panel.refresh();
  assert.equal(unrelated.button('Sign in to recover'), undefined); assert.equal(signIns, 0);
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

test('known paused release exposes a failed server recovery read with a retry action', async t => {
  const f = fixture(t, { release: { ...PANEL_RELEASE, status: 'PAUSED' } }); f.readError(Error('offline'));
  await f.panel.refresh(); assert.equal(f.container.hidden, false); assert.match(f.text(), /could not be verified/);
  assert.ok(f.button('Refresh status')); assert.equal(f.button('Confirm in wallet'), undefined);
});

test('discard verifies absence of an unattempted draft, retains history and permits corrected input', async t => {
  const f = fixture(t); f.blockPrepare(true); await f.panel.prepare(f.input);
  const [key, raw] = [...f.values.entries()].find(([key]) => key.includes(':intent:')), original = JSON.parse(raw);
  f.button('Discard unsent request').click(); await waitFor(() => f.text().includes('Unsent request discarded'));
  assert.ok(f.requests.at(-1).path.endsWith(`?intentId=${original.intentId}`));
  assert.equal(f.requests.at(-1).input, null); assert.equal(JSON.parse(f.values.get(key)).status, 'DISCARDED');
  assert.equal(JSON.parse(f.values.get(key)).attempted, false); assert.equal(f.sends(), 0);
  f.blockPrepare(false); await f.panel.prepare({ ...f.input, budget: { ...f.input.budget, maxTotalPriceWei: '1200000000000000' } });
  assert.notEqual(f.server().entry.intentId, original.intentId);
  assert.equal(JSON.parse(f.values.get(key)).status, 'DISCARDED');
  assert.equal(f.requests.filter(value => value.input?.operation === 'prepare').length, 2);
});

for (const status of ['PREPARED', 'WALLET_REQUESTED']) test(`discard adopts a late ${status} server entry instead of abandoning it`, async t => {
  const f = fixture(t); f.blockPrepare(true); await f.panel.prepare(f.input);
  const [key, raw] = [...f.values.entries()].find(([key]) => key.includes(':intent:')), original = JSON.parse(raw);
  f.setServer(marketplacePanelFixture({ status, intentId: original.intentId }).envelope);
  f.button('Discard unsent request').click(); await waitFor(() => JSON.parse(f.values.get(key)).status === status);
  assert.doesNotMatch(f.text(), /Unsent request discarded/); assert.equal(f.sends(), 0);
  assert.equal(f.button('Discard unsent request'), undefined);
});

test('discard fails closed when the exact lookup fails or the local draft is already attempted', async t => {
  const f = fixture(t); f.blockPrepare(true); await f.panel.prepare(f.input);
  const [key, raw] = [...f.values.entries()].find(([key]) => key.includes(':intent:'));
  f.readError(Error('offline')); f.button('Discard unsent request').click();
  await waitFor(() => f.text().includes('could not be verified')); assert.equal(f.values.get(key), raw);
  f.readError(null); f.values.set(key, JSON.stringify({ ...JSON.parse(raw), attempted: true }));
  f.button('Discard unsent request').click(); await waitFor(() => f.text().includes('Check or cancel the original purchase'));
  assert.equal(JSON.parse(f.values.get(key)).status, 'DRAFT'); assert.equal(f.sends(), 0);
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
