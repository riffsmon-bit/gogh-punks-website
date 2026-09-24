import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAgentWalletCreation } from '../site/punk-agent-creation-panel.js';

const OWNER = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), ACCOUNT = '0x' + '3'.repeat(40), REGISTRY = '0x' + '4'.repeat(40), HASH = '0x' + 'a'.repeat(64);
class Node {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.value = ''; this.checked = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  click() { if (!this.disabled) return this.listeners.click?.(); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ created = false, initialRecord = null, onCreated, onStateChange } = {}) {
  const doc = { createElement: tag => new Node(tag, doc) }, root = new Node('section', doc);
  const state = { context: { owner: OWNER, chainId: 4663, tokenId: '93', preview: false }, provider: {}, created, record: initialRecord,
    calls: [], callbacks: [], changes: [], read: null, prepare: null, submit: null, recover: null };
  const snapshot = () => ({ schema: 'GOGH_AGENT_CREATION_STATE_V1', owner: state.context.owner, tokenId: state.context.tokenId, account: ACCOUNT, created: state.created });
  const review = () => ({ schema: 'GOGH_AGENT_CREATION_REVIEW_V1', owner: OWNER, tokenId: '93', account: ACCOUNT, registry: REGISTRY,
    maximumNetworkFeeWei: '130000000000', expiresAt: Date.now() + 90000 });
  const saved = status => ({ owner: OWNER, status, review: review(), transactionHash: ['WALLET_REQUESTED', 'REJECTED'].includes(status) ? null : HASH, receipt: null });
  const client = {
    getAgentWalletCreationRecord: owner => { assert.equal(owner, state.context.owner.toLowerCase()); if (state.journalError) throw Error('Saved creation history is unreadable.'); return state.record; },
    readAgentWalletCreation: async (provider, context) => { state.calls.push('read'); assert.equal(provider, state.provider); assert.equal(context.tokenId, state.context.tokenId);
      assert.equal(context.readProvider, readProvider); return state.read ? state.read() : snapshot(); },
    prepareAgentWalletCreation: async (_provider, context) => { state.calls.push('prepare'); assert.equal(context.readProvider, readProvider); return state.prepare ? state.prepare() : review(); },
    submitAgentWalletCreation: async (_provider, shown, options) => { state.calls.push('submit'); assert.equal(shown.account, ACCOUNT); assert.ok(options.isCurrent());
      assert.equal(options.readProvider, readProvider); if (state.submit) return state.submit(options); return state.record = saved('SUBMITTED'); },
    recoverAgentWalletCreation: async (_provider, owner, options) => { state.calls.push('recover'); assert.equal(owner, OWNER); assert.equal(options.hash, state.hash ?? HASH); assert.ok(options.isCurrent());
      assert.equal(options.readProvider, readProvider); if (state.recover) return state.recover(options); state.created = true; return state.record = saved('CONFIRMED'); },
  };
  const storage = {}, locks = {}, readProvider = {};
  const mounted = mountAgentWalletCreation({ root, getContext: () => state.context, getProvider: () => state.provider, storage, locks, client, readProvider,
    onCreated: async value => { state.callbacks.push(value); await onCreated?.(value); },
    onStateChange: value => { state.changes.push(value); return onStateChange?.(value); } });
  const node = name => walk(root).find(n => Object.hasOwn(n.attrs, 'data-agent-wallet-creation-' + name));
  const checkAndPrepare = async () => { await node('check').click(); await node('prepare').click(); };
  const consent = () => { node('consent').checked = true; node('consent').listeners.change(); };
  return { state, root, mounted, node, checkAndPrepare, consent, saved, snapshot, review, readProvider };
}

test('mount and refresh are passive; check, review, consent and wallet confirmation remain separate', async () => {
  const f = fixture(); assert.deepEqual(f.state.calls, []); f.mounted.refresh(); assert.deepEqual(f.state.calls, []);
  assert.equal(f.node('prepare').disabled, true); assert.equal(f.node('confirm').disabled, true);
  await f.node('check').click(); assert.deepEqual(f.state.calls, ['read']); assert.equal(f.node('prepare').disabled, false);
  await f.node('prepare').click(); assert.deepEqual(f.state.calls, ['read', 'prepare']); assert.equal(f.node('confirm').disabled, true);
  const text = walk(f.node('details')).map(n => n.textContent).join(' ');
  for (const value of ['#93', OWNER, ACCOUNT, REGISTRY, '0 ETH', '0.00000013 ETH']) assert.ok(text.includes(value), value);
  f.consent(); assert.deepEqual(f.state.calls, ['read', 'prepare']); assert.equal(f.node('confirm').disabled, false);
  await f.node('confirm').click(); assert.deepEqual(f.state.calls, ['read', 'prepare', 'submit']); assert.equal(f.state.callbacks.length, 0);
  assert.equal(f.node('recovery').hidden, false); assert.equal(f.node('confirm').disabled, true); assert.equal(f.node('hash').value, HASH);
  assert.match(f.node('status').textContent, /No mission permission/);
});

test('existing account needs only an explicit read and returns to funding without a wallet request', async () => {
  const f = fixture({ created: true }); await f.node('check').click();
  assert.deepEqual(f.state.calls, ['read']); assert.equal(f.state.callbacks.length, 1);
  assert.equal(f.node('prepare').disabled, true); assert.match(f.node('info').textContent, /existing mission permissions remain unchanged/);
});

test('account created during preparation continues without a wallet prompt', async () => {
  const f = fixture(); await f.node('check').click(); f.state.created = true; f.state.prepare = () => f.snapshot();
  await f.node('prepare').click(); assert.equal(f.state.callbacks.length, 1); assert.deepEqual(f.state.calls, ['read', 'prepare']);
});

test('discard clears consent and cannot send the old review', async () => {
  const f = fixture(); await f.checkAndPrepare(); f.consent(); f.node('discard').click(); await f.node('confirm').click();
  assert.equal(f.node('review').hidden, true); assert.equal(f.node('consent').checked, false); assert.deepEqual(f.state.calls, ['read', 'prepare']);
});

for (const [name, change] of [
  ['owner', f => f.state.context.owner = OTHER], ['chain', f => f.state.context.chainId = 1],
  ['Punk', f => f.state.context.tokenId = '94'], ['provider', f => f.state.provider = {}], ['preview', f => f.state.context.preview = true],
]) test(name + ' changes clear an unsent review and consent', async () => {
  const f = fixture(); await f.checkAndPrepare(); f.consent(); change(f); f.mounted.refresh();
  assert.equal(f.node('review').hidden, true); assert.equal(f.node('consent').checked, false); await f.node('confirm').click();
  assert.ok(!f.state.calls.includes('submit'));
});

test('context or provider change without a refresh cannot confirm the previous review', async () => {
  for (const change of [f => f.state.context.tokenId = '94', f => f.state.provider = {}]) {
    const f = fixture(); await f.checkAndPrepare(); f.consent(); change(f); await f.node('confirm').click();
    assert.ok(!f.state.calls.includes('submit')); assert.equal(f.node('review').hidden, true);
  }
});

test('late read after selection change cannot display an account or call onCreated', async () => {
  const f = fixture({ created: true }), wait = deferred(); f.state.read = () => wait.promise;
  const checking = f.node('check').click(); f.state.context.tokenId = '94'; f.mounted.refresh(); wait.resolve(f.snapshot()); await checking;
  assert.equal(f.state.callbacks.length, 0); assert.equal(f.node('prepare').disabled, true); assert.ok(!f.node('info').textContent.includes(ACCOUNT));
});

test('late preparation after provider change cannot restore the discarded review', async () => {
  const f = fixture(), wait = deferred(); await f.node('check').click(); f.state.prepare = () => wait.promise;
  const preparing = f.node('prepare').click(); f.state.provider = {}; f.mounted.refresh(); wait.resolve(f.review()); await preparing;
  assert.equal(f.node('review').hidden, true); assert.equal(f.node('confirm').disabled, true);
});

test('duplicate confirmation while wallet prompt is pending sends only once', async () => {
  const f = fixture(), wait = deferred(); await f.checkAndPrepare(); f.consent(); f.state.submit = () => wait.promise;
  const confirming = f.node('confirm').click(); await f.node('confirm').click();
  assert.equal(f.state.calls.filter(c => c === 'submit').length, 1); f.state.record = f.saved('SUBMITTED'); wait.resolve(f.state.record); await confirming;
  assert.equal(f.state.callbacks.length, 0);
});

test('explicit 4001 rejection clears confirmation and allows a new separate review', async () => {
  const f = fixture(); await f.checkAndPrepare(); f.consent(); f.state.submit = () => f.state.record = f.saved('REJECTED');
  await f.node('confirm').click(); assert.equal(f.node('recovery').hidden, true); assert.equal(f.node('consent').checked, false);
  assert.match(f.node('status').textContent, /cancelled/); assert.equal(f.state.callbacks.length, 0); assert.equal(f.node('prepare').disabled, false);
});

test('unknown wallet response exposes durable recovery and never retries automatically', async () => {
  const f = fixture(); await f.checkAndPrepare(); f.consent();
  f.state.submit = () => { f.state.record = f.saved('WALLET_REQUESTED'); throw Error('The wallet result is unknown. Recover its transaction.'); };
  await f.node('confirm').click(); assert.equal(f.node('recovery').hidden, false); assert.equal(f.node('prepare').disabled, true);
  f.mounted.refresh(); assert.equal(f.state.calls.filter(c => c === 'submit').length, 1); assert.equal(f.state.callbacks.length, 0);
});

test('reload restores pending hash and supports read-only finality recovery followed by fresh ownership check', async () => {
  const first = fixture(), f = fixture({ initialRecord: first.saved('SUBMITTED') });
  assert.deepEqual(f.state.calls, []); assert.equal(f.node('hash').value, HASH); assert.equal(f.node('prepare').disabled, true);
  await f.node('recover').click(); assert.deepEqual(f.state.calls, ['recover', 'read']); assert.equal(f.state.callbacks.length, 1);
  assert.equal(f.node('recovery').hidden, true); assert.match(f.node('status').textContent, /Choose funding next/);
});

test('confirmed creation with ownership lost during recovery cannot trigger funding callback', async () => {
  const first = fixture(), f = fixture({ initialRecord: first.saved('SUBMITTED') });
  f.state.read = () => { throw Error('This wallet no longer owns the selected Punk.'); };
  await f.node('recover').click(); assert.equal(f.state.callbacks.length, 0); assert.match(f.node('status').textContent, /no longer owns/);
});

test('saved request for another Punk can be recovered without activating the current selection', async () => {
  const first = fixture(), old = first.saved('SUBMITTED'); old.review.tokenId = '94';
  const f = fixture({ initialRecord: old }); f.state.recover = () => f.state.record = { ...old, status: 'CONFIRMED' };
  await f.node('recover').click(); assert.deepEqual(f.state.calls, ['recover']); assert.equal(f.state.callbacks.length, 0);
  assert.match(f.node('status').textContent, /Punk #94 confirmed/);
});

test('pending replacement hash remains visible while original saved hash is retained', async () => {
  const first = fixture(), original = first.saved('SUBMITTED'), f = fixture({ initialRecord: original });
  f.state.hash = '0x' + 'b'.repeat(64); f.node('hash').value = f.state.hash; f.node('hash').listeners.input(); f.state.recover = () => original;
  await f.node('recover').click(); assert.equal(f.node('hash').value, f.state.hash); assert.equal(f.state.record.transactionHash, HASH);
  assert.match(f.node('status').textContent, /still pending/); assert.equal(f.state.callbacks.length, 0);
});

test('canonical cancellation unlocks a new review without sending or declaring an account created', async () => {
  const first = fixture(), f = fixture({ initialRecord: first.saved('SUBMITTED') });
  f.state.recover = () => f.state.record = f.saved('CANCELLED'); await f.node('recover').click();
  assert.deepEqual(f.state.calls, ['recover']); assert.equal(f.node('recovery').hidden, true); assert.equal(f.state.callbacks.length, 0);
  assert.match(f.node('status').textContent, /fresh review/); assert.equal(f.node('prepare').disabled, true);
  await f.node('check').click(); assert.equal(f.node('prepare').disabled, false);
});

test('fee-edited recovery displays actual fee warning', async () => {
  const first = fixture(), f = fixture({ initialRecord: first.saved('SUBMITTED') });
  f.state.recover = () => { f.state.created = true; return f.state.record = { ...f.saved('CONFIRMED'), receipt: { feeExceeded: true, actualNetworkFeeWei: '300000000000' } }; };
  await f.node('recover').click(); assert.match(f.node('status').textContent, /above the review.*0\.0000003 ETH/);
});

test('wrong chain, preview, missing owner and malformed journal cannot start creation', async () => {
  for (const change of [f => f.state.context.chainId = 1, f => f.state.context.preview = true, f => f.state.context.owner = null]) {
    const f = fixture(); change(f); f.mounted.refresh(); await f.node('check').click(); await f.node('prepare').click(); await f.node('confirm').click();
    assert.deepEqual(f.state.calls, []);
  }
  const f = fixture(); f.state.journalError = true; f.state.provider = {}; f.mounted.refresh(); await f.node('check').click();
  assert.deepEqual(f.state.calls, []); assert.match(f.node('status').textContent, /history is unreadable/);
});

test('guide check is read-only, reports busy and completion, and returns an isolated state', async () => {
  const f = fixture({ created: true }), wait = deferred(); f.state.read = () => wait.promise;
  assert.deepEqual(f.mounted.getState(), { owner: OWNER, tokenId: '93', busy: false, snapshot: null, record: null });
  assert.deepEqual(f.state.calls, []);
  const checking = f.mounted.check();
  assert.equal(f.mounted.getState().busy, true); assert.equal(f.state.changes.at(-1).busy, true);
  wait.resolve(f.snapshot()); const value = await checking;
  assert.equal(value.busy, false); assert.equal(value.snapshot.created, true);
  assert.deepEqual(f.state.calls, ['read']); assert.equal(f.state.callbacks.length, 1);
  value.snapshot.created = false; f.state.changes.at(-1).snapshot.account = OTHER;
  assert.equal(f.mounted.getState().snapshot.created, true);
  assert.equal(f.mounted.getState().snapshot.account, ACCOUNT);
});

test('guide may check a different Punk context without borrowing the previous Punk snapshot', async () => {
  const f = fixture({ created: true }); await f.mounted.check();
  f.state.context.tokenId = '94';
  assert.equal(f.mounted.getState().tokenId, '94'); assert.equal(f.mounted.getState().snapshot, null);
  assert.deepEqual(f.state.calls, ['read']);
  const state = await f.mounted.check();
  assert.equal(state.tokenId, '94'); assert.equal(state.snapshot.tokenId, '94');
  assert.deepEqual(f.state.calls, ['read', 'read']);
  assert.ok(f.state.changes.some(value => value.tokenId === '94' && value.snapshot === null));
});

test('guide observers cannot change saved records or interrupt creation confirmation', async () => {
  const f = fixture({ onStateChange: () => { throw Error('guide render failed'); } });
  await f.checkAndPrepare(); f.consent(); await f.node('confirm').click();
  const state = f.mounted.getState(); assert.equal(state.record.status, 'SUBMITTED');
  state.record.review.tokenId = '94'; state.record.status = 'CONFIRMED';
  assert.equal(f.mounted.getState().record.status, 'SUBMITTED');
  assert.equal(f.mounted.getState().record.review.tokenId, '93');
  assert.equal(f.state.calls.filter(call => call === 'submit').length, 1);
});

test('failed explicit recheck clears previously verified readiness', async () => {
  const f = fixture({ created: true }); await f.mounted.check();
  f.state.read = () => { throw Error('A chain check is unavailable.'); };
  const state = await f.mounted.check(); assert.equal(state.snapshot, null);
  assert.equal(state.busy, false); assert.equal(f.node('prepare').disabled, true);
  assert.match(f.node('status').textContent, /unavailable/); assert.equal(f.state.callbacks.length, 1);
});

test('late guide check after context switch returns no stale account readiness', async () => {
  const f = fixture({ created: true }), wait = deferred(); f.state.read = () => wait.promise;
  const oldSnapshot = f.snapshot(), checking = f.mounted.check();
  f.state.context.tokenId = '94'; wait.resolve(oldSnapshot);
  const state = await checking;
  assert.equal(state.tokenId, '94'); assert.equal(state.snapshot, null); assert.equal(state.busy, false);
  assert.equal(f.state.callbacks.length, 0); assert.equal(f.node('prepare').disabled, true);
});

test('duplicate guide check during an outstanding read does not queue more work', async () => {
  const f = fixture(), wait = deferred(); f.state.read = () => wait.promise;
  const checking = f.mounted.check(), concurrent = await f.mounted.check();
  assert.equal(concurrent.busy, true); assert.deepEqual(f.state.calls, ['read']);
  wait.resolve(f.snapshot()); await checking; assert.deepEqual(f.state.calls, ['read']);
});
