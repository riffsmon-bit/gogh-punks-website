import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { missionFundingReadiness } from '../site/broker-activation-status.js';
const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function activatePunkAgentMission('), source.indexOf('\nfunction showConfirmation('));
const owner = `0x${'1'.repeat(40)}`, to = `0x${'2'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`;
function setup() {
  const selected = { tokenId: '93' }, state = { selected, wallet: { account: owner, chainId: 4663 }, agentAccounts: new Map() };
  const calls = [], f = { state, calls, session: async () => {}, receipt: async () => {}, chain: '0x1237', accounts: [owner],
    status: { ok: true, owner, tokenId: '93', receivedAt: Date.now(), readiness: { setupAvailable: true },
      runtime: { account: to, owner, accountCreated: true, sessionActive: false, nativeBalance: '1000' } },
    transactions: [{ from: owner, to, data: '0x1234', value: '0', purpose: 'AUTHORIZE_MISSION_SESSION' }] };
  const ctx = { state, CHAIN_ID: 4663, missionFundingReadiness, ensureV2Session: () => f.session(), loadAgentAccountStatus: async () => f.status,
    window: { __GOGH_WALLET_PROVIDER__: { request: async a => { calls.push(a.method); if (a.method === 'eth_chainId') return f.chain; if (a.method === 'eth_accounts') return f.accounts; return hash; } } },
    jsonRequest: async path => { calls.push(path); return path.endsWith('/setup') ? { sessionId: 's', setup: { artifactHash: hash, setupTransactions: f.transactions } } : { ok: true }; },
    waitForPunkWalletTransactionReceipt: () => f.receipt(), hydrateSelected: async () => {} };
  f.run = () => vm.runInNewContext(`(${fn})`, ctx)({ intent: { expectedOwner: owner, punkTokenId: '93', minimumReserveWei: '100' } }, () => {});
  return f;
}
test('funded mission start submits one permission and reconciles it, never creates an account', async () => {
  const f = setup(); assert.deepEqual(await f.run(), { ok: true });
  assert.equal(f.calls.filter(x => x === 'eth_sendTransaction').length, 1);
  assert.equal(f.calls.filter(x => x.endsWith('/receipt')).length, 1);
});
test('mission activation accepts WalletConnect numeric chain ID and retains one exact permission', async () => {
  const f = setup(); f.chain = 4663;
  assert.deepEqual(await f.run(), { ok: true });
  assert.equal(f.calls.filter(x => x === 'eth_sendTransaction').length, 1);
  assert.equal(f.calls.filter(x => x.endsWith('/receipt')).length, 1);
});
test('mission activation rejects wrong numeric networks and malformed network values', async () => {
  for (const chain of [1, 0, -1, 4663.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4663', '0x', '0x' + '0'.repeat(65)]) {
    const f = setup(); f.chain = chain;
    await assert.rejects(f.run(), /Reconnect the reviewed owner wallet/);
    assert.equal(f.calls.filter(x => x === 'eth_sendTransaction').length, 0);
  }
});
test('new, empty, reserve-reached and already-active accounts cannot request mission setup or a transaction', async () => {
  for (const patch of [{ accountCreated: false }, { nativeBalance: '0' }, { nativeBalance: '100' }, { sessionActive: true }]) {
    const f = setup(); Object.assign(f.status.runtime, patch); await assert.rejects(f.run()); assert.deepEqual(f.calls, []);
  }
});
test('legacy combined account creation and permission artifact is rejected before any wallet request', async () => {
  const f = setup(); f.transactions.unshift({ ...f.transactions[0], purpose: 'ACTIVATE_PUNK_AGENT_ACCOUNT' });
  await assert.rejects(f.run(), /only one permission/); assert.equal(f.calls.includes('eth_sendTransaction'), false);
  f.transactions = [{ ...f.transactions[1], to: owner }];
  await assert.rejects(f.run(), /only one permission/); assert.equal(f.calls.includes('eth_sendTransaction'), false);
});
test('switching selection while session sign-in is pending prevents every setup wallet request', async () => {
  const f = setup(); f.session = async () => { f.state.selected = { tokenId: '94' }; };
  await assert.rejects(f.run(), /Punk or wallet changed/); assert.equal(f.calls.length, 0);
});
test('wallet account or chain changes stop before any mission signature', async () => {
  for (const patch of [{ chain: '0x1' }, { accounts: [to] }]) {
    const f = Object.assign(setup(), patch); await assert.rejects(f.run(), /Reconnect/); assert.equal(f.calls.includes('eth_sendTransaction'), false);
  }
});
test('selection change after permission submission never reconciles against the second Punk', async () => {
  const f = setup(); f.receipt = async () => { f.state.selected = { tokenId: '94' }; };
  await assert.rejects(f.run(), /Punk or wallet changed/);
  assert.equal(f.calls.filter(x => x === 'eth_sendTransaction').length, 1); assert.equal(f.calls.some(x => x.endsWith('/receipt')), false);
});

test('new and unfunded mission drafts open Fund and preserve the exact rules instead of requesting permission', async () => {
  const start = source.indexOf('  const runAgentAction = async (command) => {');
  const action = source.slice(start, source.indexOf('\n  swarmWalletControl = mountSwarmWallet', start));
  for (const [created, balance, expected] of [[false, '0', 'SETUP'], [true, '0', 'FUND'], [true, '100', 'FUND'], [true, '101', 'MISSION']]) {
    const punk = { tokenId: '93' }, draft = { intent: { expectedOwner: owner, punkTokenId: '93', operatingMode: 'AUTONOMOUS', minimumReserveWei: '100', preferences: { prefer: ['PIXEL'] } } };
    const account = { ok: true, owner, tokenId: '93', receivedAt: Date.now(), runtime: { accountCreated: created, sessionActive: false, owner, account: to, nativeBalance: balance } };
    const state = { selected: punk, wallet: { account: owner, chainId: 4663 }, chatRequestId: 0 }, calls = [];
    const context = { state, PREVIEW: false, actionBusy: false, missionFundingReadiness,
      punkChatAction: () => null, addMessage() {}, setChatBusy() {}, ensureV2Session: async () => {},
      loadAgentAccountStatus: async () => account, selectedAgentAccount: () => account,
      brokerPreferences: { preference: () => 'AUTO' }, jsonRequest: async path => { calls.push(path); return { draft }; },
      activateTab: tab => calls.push(tab), renderAgentGasFunding: () => calls.push('fund-render'),
      set() {}, one: () => ({ scrollIntoView() {} }), addReviewActivity() {},
      showConfirmation: value => calls.push(value),
    };
    await vm.runInNewContext(action + '\nrunAgentAction("review free mint mission");', context);
    if (expected === 'MISSION') assert.equal(calls.at(-1), draft);
    else { assert.equal(state.localStrategy, draft); assert.ok(calls.includes('fund')); assert.ok(!calls.includes(draft)); }
    assert.deepEqual(calls.filter(x => typeof x === 'string' && x.startsWith('/api/')), ['/api/v2/punks/93/chat']);
  }
});
