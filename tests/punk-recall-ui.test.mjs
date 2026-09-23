import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPunkRecall } from '../site/punk-agent-recall.js';
const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../site/broker/v2/index.html', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const handler = extract('async function recallSelectedReviewAgent()', '\nasync function sendReviewAgentOut(');
const render = extract('function renderCurrentMissionStatus()', '\nfunction missionClock(');
const owner = `0x${'1'.repeat(40)}`, account = `0x${'2'.repeat(40)}`, hash = `0x${'3'.repeat(64)}`;
function fixture({ reject = false, receipt } = {}) {
  const nodes = new Map(), calls = [], state = { selected: { tokenId: '93' }, wallet: { account: owner, chainId: 4663 }, agentAccounts: new Map(), agentAccountLoading: new Map() };
  const one = selector => { if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, disabled: false, dataset: {} }); return nodes.get(selector); };
  const status = { ok: true, tokenId: '93', owner, readiness: { databaseReady: true },
    runtime: { accountCreated: true, account, sessionActive: true, nativeBalance: '0' }, mission: { status: 'ACTIVE', sessionId: 's93' } };
  const provider = { request: async ({ method, params }) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [owner];
    assert.equal(method, 'eth_sendTransaction');
    assert.deepEqual(JSON.parse(JSON.stringify(params)), [{ from: owner, to: account, value: '0x0', data: '0xc64b51e8' }]);
    if (reject) throw Error('User rejected the request');
    return hash;
  } };
  const context = vm.createContext({ state, one, CHAIN_ID: 4663, PREVIEW: false, REVIEW_HOST: false,
    punkRecall: createPunkRecall(), window: { __GOGH_WALLET_PROVIDER__: provider },
    set: (selector, text) => { one(selector).textContent = text; },
    loadAgentAccountStatus: async () => { calls.push('read'); return status; },
    jsonRequest: async (_path, options) => {
      const body = JSON.parse(options.body); calls.push(body.action);
      if (body.action === 'prepare') return { ok: true, tokenId: '93', sessionId: 's93', transaction: { from: owner, to: account, value: '0x0', data: '0xc64b51e8' } };
      assert.equal(body.action, 'confirm');
      return { ok: true, tokenId: '93', sessionId: 's93', transactionHash: hash, strategyPaused: true, status: 'REVOKED' };
    },
    waitForPunkWalletTransactionReceipt: receipt ?? (async () => {}),
    addMessage() {}, renderSelected() {}, renderReviewAgent() {}, renderCurrentMissionStatus() {}, hydrateSelected: async () => {},
  });
  vm.runInContext(handler, context);
  return { state, one, calls, context, status, run: () => vm.runInContext('recallSelectedReviewAgent()', context) };
}

test('recall is exposed beside current status outside the old hidden review console', () => {
  const section = html.slice(html.indexOf('<section class="current-mission"'), html.indexOf('<section class="activation-guide"'));
  assert.match(section, /data-current-mission-recall disabled>RECALL PUNK/);
  assert.doesNotMatch(section, /data-current-mission-recall[^>]*hidden/);
  assert.match(section, /data-current-recall-result role="status"/);
  assert.ok(source.includes('one("[data-current-mission-recall]").addEventListener("click", recallSelectedReviewAgent)'));
});

test('reserve reached never disables recall; wrong chain, disconnected owner and busy recall do', () => {
  const f = fixture();
  Object.assign(f.context, { missionStatus: () => ({ label: 'LOOKING FOR MINTS', canStart: false }),
    activationForPunk: () => ({ status: 'RESERVE_REACHED', label: 'RESERVE REACHED', detail: 'Protected reserve', tone: 'warning' }),
    selectedAgentAccount: () => f.status, selectedReviewAgent: () => null });
  vm.runInContext(render, f.context);
  const draw = () => vm.runInContext('renderCurrentMissionStatus()', f.context);
  draw(); assert.equal(f.one('[data-current-mission-recall]').disabled, false);
  assert.equal(f.one('[data-current-mission-status]').textContent, 'RESERVE REACHED');
  f.state.wallet.chainId = 1; draw(); assert.equal(f.one('[data-current-mission-recall]').disabled, true);
  f.state.wallet.chainId = 4663; f.state.wallet.account = null; draw(); assert.equal(f.one('[data-current-mission-recall]').disabled, true);
  f.state.wallet.account = owner; f.context.punkRecall = { busy: true }; draw(); assert.equal(f.one('[data-current-mission-recall]').disabled, true);
  assert.equal(f.calls.length, 0);
});

test('visible recall uses the original exact zero-value revocation and shows confirmation only after receipt reconciliation', async () => {
  let resolve;
  const f = fixture({ receipt: () => new Promise(done => { resolve = done; }) });
  const pending = f.run();
  for (let i = 0; i < 20 && !resolve; i++) await new Promise(done => setImmediate(done));
  assert.match(f.one('[data-current-recall-result]').textContent, /Waiting for confirmation; do not submit again/);
  assert.equal(f.calls.includes('confirm'), false);
  assert.equal(f.one('[data-current-mission-recall]').disabled, true);
  await f.run(); assert.equal(f.calls.filter(call => call === 'eth_sendTransaction').length, 1);
  resolve(); await pending;
  assert.match(f.one('[data-current-recall-result]').textContent, /Punk #93 recalled.*permission is revoked.*Funds remain/);
  assert.equal(f.state.selected.mode, 'PAUSED'); assert.equal(f.calls.filter(call => call === 'confirm').length, 1);
});

test('wallet rejection stays visible beside status and never reports recalled', async () => {
  const f = fixture({ reject: true }); await f.run();
  assert.match(f.one('[data-current-recall-result]').textContent, /User rejected.*Recall is not confirmed/);
  assert.equal(f.calls.includes('confirm'), false); assert.notEqual(f.state.selected.mode, 'PAUSED');
});

test('receipt failure shows the original transaction hash and cannot report recall success', async () => {
  const f = fixture({ receipt: async () => { throw Error('Receipt unavailable'); } }); await f.run();
  assert.match(f.one('[data-current-recall-result]').textContent, /Recall is not confirmed.*Check this receipt before retrying/);
  assert.ok(f.one('[data-current-recall-result]').textContent.includes(hash));
  assert.equal(f.calls.includes('confirm'), false); assert.notEqual(f.state.selected.mode, 'PAUSED');
});

test('late recall receipt cannot mark a different Punk recalled', async () => {
  let resolve; const f = fixture({ receipt: () => new Promise(done => { resolve = done; }) });
  const pending = f.run();
  for (let i = 0; i < 20 && !resolve; i++) await new Promise(done => setImmediate(done));
  f.state.selected = { tokenId: '94' }; f.one('[data-current-recall-result]').textContent = '';
  resolve(); await pending;
  assert.equal(f.one('[data-current-recall-result]').textContent, ''); assert.notEqual(f.state.selected.mode, 'PAUSED');
  assert.equal(f.calls.includes('confirm'), false);
});
