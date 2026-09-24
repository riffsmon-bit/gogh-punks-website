import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const start = source.indexOf('  swarmControl = mountSwarmSetup({');
const wiring = source.slice(start, source.indexOf('\n  const openSwarm =', start));
const owner = '0x' + '1'.repeat(40), other = '0x' + '2'.repeat(40), hash = '0x' + 'a'.repeat(64);
function fixture() {
  const state = { wallet: { account: owner, chainId: 4663 }, punks: [{ tokenId: '93' }, { tokenId: '94' }] }, calls = [];
  let config, accepted = true, sessionHook = async () => {};
  const ctx = { state, PREVIEW: false, CHAIN_ID: 4663, actionBusy: false, swarmControl: null,
    one: () => ({ dataset: {}, open: false }), window: { __GOGH_WALLET_PROVIDER__: {} },
    mountSwarmSetup: value => { config = value; return {}; },
    swarmReviewGate: { review: async input => { calls.push(['local-review', input]); return accepted; } },
    selectPunk: id => calls.push(['select', id]), activateTab: tab => calls.push(['tab', tab]),
    runAgentAction: async command => { calls.push(['rules', command, state.swarmGuidedReview]); return { intentHash: hash }; },
    loadAgentAccountStatus: async options => { calls.push(['status', options]); return { ok: true }; },
    ensureV2Session: async () => { calls.push(['sign-in']); await sessionHook(); },
    jsonRequest: async (path, options) => { calls.push(['api', path, JSON.parse(options.body)]); return { ok: true }; } };
  vm.runInNewContext(wiring, ctx);
  return { state, calls, config, ctx, rejectReview() { accepted = false; }, sessionHook(fn) { sessionHook = fn; } };
}
test('guided integration mounts passively and supplies one shared wallet context without legacy per-Punk deposits', () => {
  const f = fixture(); assert.deepEqual(f.calls, []); assert.equal(f.config.getContext().owner, owner);
  assert.equal(f.config.getPunks().length, 2); assert.equal(f.config.openFunding, undefined);
});
test('mission local review precedes selection and sign-in; cancellation requests no mission', async () => {
  const f = fixture(); f.rejectReview(); assert.equal((await f.config.openReview({ tokenId: '93', command: 'free', options: {} })).cancelled, true);
  assert.deepEqual(f.calls.map(x => x[0]), ['local-review']);
});
test('accepted mission opens saved shared rules with guided funding feedback and resets temporary context', async () => {
  const f = fixture(); await f.config.openReview({ tokenId: '94', command: 'free', options: {} });
  assert.deepEqual(f.calls.map(x => x[0]), ['local-review', 'select', 'tab', 'rules']);
  assert.deepEqual(f.calls.at(-1), ['rules', 'free', true]); assert.equal(f.state.swarmGuidedReview, false);
});
test('mission recovery sends only exact saved confirmation metadata to the protected receipt endpoint', async () => {
  const f = fixture(), record = { tokenId: '93', sessionId: '11111111-2222-4333-8444-555555555555', setupArtifactHash: hash, authorizationTransactionHash: hash };
  await f.config.recoverMission(record);
  assert.deepEqual(f.calls.map(x => x[0]), ['sign-in', 'api']);
  assert.deepEqual(f.calls[1], ['api', '/api/v2/agent-account/receipt', { owner, ...record }]);
});
test('wrong chain, unowned Punk and wallet switch during sign-in block mission receipt reconciliation', async () => {
  for (const mutation of [f => { f.state.wallet.chainId = 1; }, f => { f.state.punks = []; }, f => f.sessionHook(async () => { f.state.wallet.account = other; })]) {
    const f = fixture(); mutation(f); await assert.rejects(f.config.recoverMission({ tokenId: '93', sessionId: 's', setupArtifactHash: hash, authorizationTransactionHash: hash }));
    assert.equal(f.calls.some(x => x[0] === 'api'), false);
  }
});
