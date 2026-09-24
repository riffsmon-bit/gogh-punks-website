import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { recoveryEth } from '../site/punk-agent-recovery-panel.js';
import { punkActivationStatus } from '../site/broker-activation-status.js';

const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const owner = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`;
const account = id => `0x${BigInt(id).toString(16).padStart(40, '0')}`;
const status = (tokenId, balance = '500000000000000') => ({ ok: true, owner, tokenId,
  receivedAt: Date.now(), readiness: { setupAvailable: true, blockers: [] },
  runtime: { owner, account: account(tokenId), accountCreated: true,
    sessionActive: false, nativeBalance: balance, entryPointDeposit: '0' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const punks = ['93', '94'].map(tokenId => ({ tokenId, account: account(Number(tokenId) + 1000),
    balanceEth: '0.0005', balanceLoaded: true, wethBalanceEth: '0', reserveEth: '0' }));
  const state = { selected: punks[0], punks, wallet: { account: owner, chainId: 4663 },
    agentAccounts: new Map([['93', status('93')], ['94', status('94')]]),
    agentAccountLoading: new Map(), balanceReads: new Map(), localStrategy: null,
    reviewInspections: new Map(), balanceRequestId: 0 };
  const nodes = new Map(), reads = [], rendered = [], notifications = [];
  const one = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', checked: false, hidden: false,
      dataset: {}, scrollIntoView() {}, getAttribute: () => null });
    return nodes.get(selector);
  };
  const context = vm.createContext({ state, CHAIN_ID: 4663, PREVIEW: false, Promise, recoveryEth,
    one, set: (selector, text) => { one(selector).textContent = text; },
    blockerLabel: value => value, selectedReviewKey: () => null,
    missionNotifications: { observe: notice => notifications.push(notice) },
    ensureV2Session: async () => { throw Error('Passive selection must not sign in'); },
    jsonRequest: path => { const request = deferred(); reads.push({ path, ...request }); return request.promise; },
    renderAgentAccount: () => { vm.runInContext('renderAgentGasFunding()', context); },
    renderReviewAgent() {}, renderMissionMonitor() {}, renderWelcomeMessage() {},
    renderSelected: () => { context.renderAgentAccount(); rendered.push(one('[data-agent-gas-native]').textContent);
      if (!state.agentAccounts.has(state.selected.tokenId)) void context.loadAgentAccountStatus(); },
    swarmReviewGate: null, invalidateConversationRequests() {}, resetGallery() {},
    renderCollectionWithdrawal() {}, scheduleSelectedReviewMissionCheck() {},
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext([
    section('function selectedAgentAccount(', '\nfunction blockerLabel('),
    section('async function loadAgentAccountStatus(', '\nfunction renderAgentAccount('),
    section('function renderAgentGasFunding(', '\nfunction selectedReviewRun('),
    section('function selectPunk(', '\nfunction resetGallery('),
  ].join('\n'), context);
  return { context, state, one, reads, rendered, notifications,
    render: () => vm.runInContext('renderAgentGasFunding()', context),
    selected: () => vm.runInContext('selectedAgentAccount()', context) };
}

test('returning to a previously funded Punk clears cached gas until its own fresh read completes', async () => {
  const f = fixture(); f.render(); assert.equal(f.one('[data-agent-gas-native]').textContent, '0.0005 ETH');
  f.context.selectPunk('94'); await Promise.resolve();
  assert.equal(f.one('[data-agent-gas-native]').textContent, 'CHECKING…');
  assert.equal(f.one('[data-agent-gas-destination]').textContent, 'NOT VERIFIED');
  assert.equal(f.one('[data-agent-gas-form] button[type="submit"]').disabled, true);
  assert.equal(f.one('[data-agent-gas-punk-balance]').textContent, 'CHECKING…');
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].path, '/api/v2/punks/94/agent-account');
  const pending = f.state.agentAccountLoading.get('94').promise;
  f.reads[0].resolve(status('94', '0')); await pending;
  assert.equal(f.one('[data-agent-gas-native]').textContent, '0 ETH');
  assert.equal(f.one('[data-agent-gas-destination]').textContent, account('94'));
  assert.equal(punkActivationStatus({ owner, chainId: 4663, tokenId: '94', account: f.selected() }).status, 'GAS_REQUIRED');
});

test('late status for a prior selection cannot replace the selected Punk gas display', async () => {
  const f = fixture(); f.state.agentAccounts.clear();
  const first = f.context.loadAgentAccountStatus(); await Promise.resolve();
  f.context.selectPunk('94'); await Promise.resolve();
  const second = f.state.agentAccountLoading.get('94').promise;
  f.reads[1].resolve(status('94', '0')); await second;
  f.reads[0].resolve(status('93')); await first;
  assert.equal(f.one('[data-agent-gas-native]').textContent, '0 ETH');
  assert.equal(f.one('[data-agent-gas-destination]').textContent, account('94'));
  assert.equal(f.selected().tokenId, '94');
});

for (const [label, mutate] of [
  ['another Punk', value => { value.tokenId = '94'; }],
  ['another owner', value => { value.owner = other; }],
  ['another runtime owner', value => { value.runtime.owner = other; }],
  ['another chain', value => { value.chainId = 1; }],
  ['missing response identity', value => { delete value.owner; }],
]) test(`status for ${label} is rejected before gas or notifications are recorded`, async () => {
  const f = fixture(); const request = f.context.loadAgentAccountStatus(); await Promise.resolve();
  const response = status('93'); mutate(response); f.reads[0].resolve(response);
  assert.equal(await request, null);
  assert.equal(f.state.agentAccounts.get('93').code, 'AGENT_STATUS_MISMATCH');
  assert.equal(f.one('[data-agent-gas-native]').textContent, 'NOT VERIFIED');
  assert.equal(f.one('[data-agent-gas-form] button[type="submit"]').disabled, true);
  assert.equal(f.notifications.length, 0);
});

test('stale or wrongly bound cached gas cannot look funded, even before the next request', () => {
  for (const mutate of [value => { value.receivedAt -= 90_001; }, value => { value.tokenId = '94'; },
    value => { value.runtime.owner = other; }, value => { value.owner = other; }]) {
    const f = fixture(); mutate(f.state.agentAccounts.get('93')); f.render();
    assert.equal(f.selected(), null);
    assert.equal(f.one('[data-agent-gas-native]').textContent, 'NOT VERIFIED');
    assert.equal(f.one('[data-agent-gas-deposit]').textContent, 'NOT VERIFIED');
    assert.equal(f.one('[data-agent-gas-form] button[type="submit"]').disabled, true);
  }
});

test('wallet pending restore and network switches cannot reuse a prior owner gas display', () => {
  for (const wallet of [{ account: null, chainId: 4663 }, { account: other, chainId: 4663 },
    { account: owner, chainId: null }, { account: owner, chainId: 1 }]) {
    const f = fixture(); f.state.wallet = wallet; f.render();
    assert.equal(f.selected(), null);
    assert.equal(f.one('[data-agent-gas-native]').textContent, 'NOT VERIFIED');
    assert.equal(f.one('[data-agent-gas-destination]').textContent, 'NOT VERIFIED');
  }
});

test('the real mobile wallet pending event immediately removes displayed gas and disables funding', async () => {
  const f = fixture(); f.render();
  assert.equal(f.one('[data-agent-gas-native]').textContent, '0.0005 ETH');
  let walletEvent;
  Object.assign(f.context, {
    window: { addEventListener: (_name, handler) => { walletEvent = handler; } },
    persistentWatchControl: null, swarmWalletControl: null, agentCreationControl: null,
    forgeSkillAdminControl: null, brokerPreferences: null, gasFundingRecovery: null,
    renderMissionBadges() {}, renderActivationGuide() {},
    ownerRefresh: { invalidate() {} }, clearTransferredPunkReview() {},
  });
  vm.runInContext(section('window.addEventListener("gogh:wallet-state"', '\n  if (PREVIEW) { previewData()'), f.context);
  await walletEvent({ detail: { account: null, status: 'pending', restoring: true } });
  assert.equal(f.one('[data-agent-gas-native]').textContent, 'NOT VERIFIED');
  assert.equal(f.one('[data-agent-gas-form] button[type="submit"]').disabled, true);
  assert.equal(f.reads.length, 0);
});
