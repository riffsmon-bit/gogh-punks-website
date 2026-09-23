import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createSwarmReviewGate } from '../site/broker-swarm-review.js';
const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const owner = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`;
const options = { mode: 'SEARCH', daily: '5', total: '100', duration: 'KEEP_HUNTING' };
class Element {
  constructor(doc) { this.ownerDocument = doc; this.children = []; this.listeners = {}; this.textContent = ''; this.open = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
}
function fixture() {
  const doc = { createElement: () => new Element(doc) }, dialog = new Element(doc), nodes = new Map();
  dialog.querySelector = key => { if (!nodes.has(key)) nodes.set(key, new Element(doc)); return nodes.get(key); };
  let context = { owner, chainId: 4663 }, owned = true;
  const gate = createSwarmReviewGate({ dialog, getContext: () => context, isOwned: () => owned });
  return { gate, dialog, nodes, open: () => gate.review({ tokenId: '93', options }),
    click: key => dialog.querySelector(`[data-swarm-review-${key}]`).listeners.click(),
    context: next => { context = next; gate.refresh(); }, transfer: () => { owned = false; gate.refresh(); } };
}
test('local Swarm review renders exact limits and waits for explicit continuation', async () => {
  const f = fixture(); let advanced = false;
  const result = f.open().then(value => { advanced = value; return value; });
  await Promise.resolve(); assert.equal(advanced, false); assert.equal(f.dialog.open, true);
  const content = f.nodes.get('[data-swarm-review-grid]').children.flatMap(n => n.children.map(c => c.textContent));
  assert.ok(content.includes('#93')); assert.ok(content.includes('5 per Punk')); assert.ok(content.includes('100 per Punk'));
  f.click('continue'); assert.equal(await result, true); assert.equal(f.dialog.open, false);
});
test('cancel, Escape and close leave local reviews safely retryable', async () => {
  for (const exit of [f => f.click('cancel'), f => f.dialog.listeners.cancel(), f => f.dialog.close()]) {
    const f = fixture(), result = f.open(); exit(f); assert.equal(await result, false);
    const retry = f.open(); f.click('continue'); assert.equal(await retry, true);
  }
});
test('owner switch, chain switch, transfer and invalidation cannot continue a stale review', async () => {
  for (const change of [f => f.context({ owner: other, chainId: 4663 }), f => f.context({ owner, chainId: 1 }), f => f.transfer(), f => f.gate.invalidate()]) {
    const f = fixture(), result = f.open(); change(f); assert.equal(await result, false); assert.equal(f.dialog.open, false);
    f.click('continue');
  }
});
const opener = source.slice(source.indexOf('openReview: async ('), source.indexOf('\n    getFundingState:', source.indexOf('openReview: async ('))).replace(/^openReview: /, '').replace(/,$/, '');
test('real Swarm opener makes no sign-in/action call until local review continuation', async () => {
  const f = fixture(), calls = [], one = () => ({ dataset: {}, open: false });
  const ctx = vm.createContext({ PREVIEW: false, actionBusy: false, one, swarmReviewGate: f.gate,
    selectPunk: id => calls.push(['select', id]), activateTab: tab => calls.push(['tab', tab]),
    runAgentAction: async command => { calls.push(['explicit-sign-in-and-draft', command]); return { intentHash: 'draft' }; } });
  const open = vm.runInContext(`(${opener})`, ctx);
  let promise = open({ tokenId: '93', command: 'review limits', options });
  await Promise.resolve(); assert.deepEqual(calls, []); f.click('cancel'); assert.equal((await promise).cancelled, true); assert.deepEqual(calls, []);
  promise = open({ tokenId: '93', command: 'review limits', options });
  await Promise.resolve(); assert.deepEqual(calls, []); f.click('continue'); assert.equal((await promise).intentHash, 'draft');
  assert.deepEqual(calls, [['select', '93'], ['tab', 'talk'], ['explicit-sign-in-and-draft', 'review limits']]);
});
test('passive profile/activity hydration never starts sign-in when the session is absent', async () => {
  const session = source.slice(source.indexOf('async function requireExistingV2Session()'), source.indexOf('\nconst sessionRequests'));
  const hydration = source.slice(source.indexOf('async function hydrateSelected(tab)'), source.indexOf('\nfunction addMessage'));
  for (const tab of ['talk', 'strategy', 'fund', 'activity']) {
    let walletCalls = 0, reads = 0;
    const state = { selected: { tokenId: '93' }, wallet: { account: owner, chainId: 4663 } };
    const ctx = vm.createContext({ state, CHAIN_ID: 4663, REVIEW_HOST: false,
      jsonRequest: async path => { reads++; assert.equal(path, '/api/v2/session'); throw Object.assign(Error('Sign in required'), { code: 'V2_SESSION_REQUIRED' }); },
      ensureV2Session: async () => { walletCalls++; throw Error('Navigation must not sign'); }, set() {}, renderActivity() {} });
    vm.runInContext(session + '\n' + hydration, ctx); await ctx.hydrateSelected(tab);
    assert.equal(walletCalls, 0); assert.equal(reads, 1);
  }
});

test('same-wallet status updates retain the review; changed owner or chain invalidates it', () => {
  const start = source.indexOf('    state.wallet = { ...wallet, account };');
  const update = source.slice(start, source.indexOf('    renderMissionBadges();', start));
  for (const [account, chainId, expected] of [[owner, 4663, 0], [other, 4663, 1], [owner, 1, 1], [null, null, 1]]) {
    let invalidated = 0;
    vm.runInNewContext(update, { account, wallet: { chainId }, previousAccount: owner, previousChain: 4663,
      state: {}, persistentWatchControl: null, swarmReviewGate: { invalidate: () => invalidated++ } });
    assert.equal(invalidated, expected);
  }
});
