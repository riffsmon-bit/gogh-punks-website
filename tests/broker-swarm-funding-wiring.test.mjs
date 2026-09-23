import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing integrated handler: ${start}`);
  return source.slice(from, to);
}
const guard = extract('function currentSwarmFunding() {', '\nfunction renderAgentGasFunding(');
const opener = extract('    openFunding: async allocation => {', '\n    openStatus:').trim().replace(/^openFunding: /, '').replace(/,$/, '');
const fundingHandler = extract('  gasForm.addEventListener("submit", async event => {', '\n  const fundForm =');
const owner = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`, destination = `0x${'3'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`;
const collection = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const allocation = { tokenId: '93', amountWei: '500000000000000', amountEth: '0.0005', batchId: '11111111-2222-4333-8444-555555555555' };
function fixture() {
  const punks = [{ tokenId: '93' }, { tokenId: '94' }], state = { selected: punks[1], punks, wallet: { account: owner, chainId: 4663 }, gasFundingBusy: false, gasFundingPlan: null, swarmFundingContext: null };
  const nodes = new Map(), calls = [], prepared = { ...allocation, owner, source: 'OWNER', amount: allocation.amountEth, destination,
    transaction: { chainId: '0x1237', from: owner, to: destination, data: '0x', nonce: '0x1', value: '0x1c6bf52634000' } };
  const one = selector => { if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', checked: false, hidden: false, open: false, scrollIntoView() {} }); return nodes.get(selector); };
  const f = { state, one, calls, prepared, saved: { ...allocation, owner, chainId: 4663 }, sends: 0, binds: [], tab: '', sessionHook: async () => {}, prepareHook: async () => {}, beforeWallet: async () => {}, walletResponse: async () => ({ hash }), receiptStatus: 'SUBMITTED', accountHook: async () => {} };
  const ctx = {
    PREVIEW: false, actionBusy: false, CHAIN_ID: 4663, COLLECTION: collection, state, one,
    gasButton: { textContent: '', disabled: false }, gasForm: { addEventListener(name, fn) { assert.equal(name, 'submit'); f.submit = fn; } },
    window: { __GOGH_WALLET_PROVIDER__: { request() { throw Error('Wiring must delegate all wallet operations'); } } },
    selectPunk(tokenId) { state.selected = punks.find(p => p.tokenId === tokenId); state.gasFundingPlan = null; state.swarmFundingContext = null; },
    activateTab(tab) { f.tab = tab; }, renderAgentGasFunding() {}, renderSelected() {}, addMessage() {},
    swarmControl: {
      fundingContext(tokenId) { return f.saved?.tokenId === tokenId ? f.saved : null; },
      fundingPrepared(value) {
        calls.push('bind'); f.binds.push(structuredClone(value));
        assert.equal(value.batchId, f.saved?.batchId); assert.equal(value.tokenId, allocation.tokenId);
        assert.equal(value.prepared.source, 'OWNER'); assert.equal(value.prepared.amountWei, allocation.amountWei);
      }, refresh() {},
    },
    gasFundingRecovery: { refresh() {} },
    ensureV2Session: async () => { calls.push('session'); await f.sessionHook(); },
    loadAgentAccountStatus: async options => { f.accountOptions = options; calls.push('account-status'); await f.accountHook(); }, loadPunkBalances: async () => {},
    jsonRequest: async path => { calls.push(path); return { ok: true }; },
    fetchPunkWalletFundsGate() { throw Error('Swarm deposits must not use Punk funds'); },
    prepareAgentGasFunding: async (_provider, context, tokenId, source, amount) => {
      calls.push('prepare'); assert.equal(source, 'OWNER'); assert.equal(amount, allocation.amountEth); assert.equal(tokenId, allocation.tokenId);
      assert.equal(context.ownerBinding.owner, owner); assert.equal(context.ownerBinding.collection, collection);
      await f.prepareHook(); return structuredClone(prepared);
    },
    submitAgentGasFunding: async (_provider, plan, options) => {
      calls.push('submit'); assert.equal(calls.at(-2), 'bind', 'exact allocation must be checked before submission');
      await options.loadContext(); await f.beforeWallet();
      if (!options.isCurrent()) throw Error('Selection changed before wallet request');
      assert.equal(plan.amountWei, allocation.amountWei); calls.push('wallet'); f.sends++;
      const response = await f.walletResponse(); calls.push('original-journal-saved'); return response;
    },
    waitForPunkWalletTransactionReceipt: async () => { calls.push('receipt'); },
    recheckAgentGasFunding: async (_provider, checkedOwner, tokenId, options) => {
      calls.push('recheck'); assert.equal(checkedOwner, owner); assert.equal(tokenId, '93');
      if (!options.isCurrent()) throw Error('Original owner no longer selected'); return { status: f.receiptStatus };
    },
  };
  vm.createContext(ctx); vm.runInContext(guard, ctx); f.guard = () => ctx.currentSwarmFunding();
  f.open = value => vm.runInContext(`(${opener})`, ctx)(value);
  vm.runInContext(fundingHandler, ctx);
  f.review = async () => { await f.open(allocation); one('[data-agent-gas-confirm]').checked = true; await f.submit({ preventDefault() {} }); };
  f.confirm = () => f.submit({ preventDefault() {} });
  return f;
}

test('integrated Swarm opener selects the exact Punk, prefills OWNER amount and only loads readiness', async () => {
  const f = fixture(); await f.open(allocation);
  assert.equal(f.state.selected.tokenId, '93'); assert.equal(f.tab, 'fund');
  assert.equal(f.one('#agent-gas-source').value, 'OWNER'); assert.equal(f.one('#agent-gas-amount').value, '0.0005');
  assert.equal(f.one('[data-agent-gas-confirm]').checked, false);
  assert.equal(f.accountOptions.authenticate, false); assert.equal(f.calls.includes('session'), false);
  assert.equal(f.sends, 0); assert.equal(f.calls.includes('prepare'), false); assert.equal(f.calls.includes('bind'), false);
});

test('real gas form first simulates and binds, then requires a separate submit with another binding check', async () => {
  const f = fixture(); await f.review();
  assert.equal(f.sends, 0); assert.equal(f.binds.length, 1); assert.equal(f.state.gasFundingPlan.amountWei, allocation.amountWei);
  await f.confirm(); assert.equal(f.sends, 1); assert.equal(f.binds.length, 2);
  assert.equal(f.calls.filter(c => c === 'wallet').length, 1); assert.equal(f.state.gasFundingPlan, null);
  assert.match(f.one('[data-agent-gas-result]').textContent, /awaiting confirmation/);
});

test('changed plan, owner, Punk, chain, source or amount stops before simulation and wallet request', async () => {
  for (const mutate of [
    f => { f.saved = null; }, f => { f.saved.batchId = 'other-batch'; },
    f => { f.saved.amountWei = '1'; }, f => { f.state.wallet.account = other; },
    f => { f.state.wallet.chainId = 1; }, f => { f.state.selected = { tokenId: '94' }; },
    f => { f.one('#agent-gas-source').value = 'PUNK'; }, f => { f.one('#agent-gas-amount').value = '0.5'; },
  ]) {
    const f = fixture(); await f.open(allocation); f.one('[data-agent-gas-confirm]').checked = true; mutate(f);
    await f.confirm(); assert.equal(f.sends, 0); assert.equal(f.calls.includes('prepare'), false);
  }
});

test('plan change during simulation discards the prepared transfer without binding or sending', async () => {
  const f = fixture(); f.prepareHook = async () => { f.saved = null; };
  await f.review(); assert.equal(f.state.gasFundingPlan, null); assert.equal(f.binds.length, 0); assert.equal(f.sends, 0);
});

test('plan changes while the send path is awaiting fresh checks prevent the wallet call', async () => {
  const f = fixture(); await f.review(); f.beforeWallet = async () => { f.saved = null; };
  await f.confirm(); assert.equal(f.sends, 0); assert.equal(f.state.gasFundingPlan, null);
  assert.match(f.one('[data-agent-gas-result]').textContent, /plan changed/);
});

test('late wallet response does not update another Punk as funded or start another transfer', async () => {
  const f = fixture(); await f.review();
  f.walletResponse = async () => { f.state.selected = { tokenId: '94' }; f.state.swarmFundingContext = null; f.one('[data-agent-gas-result]').textContent = 'Punk 94 unchanged'; return { hash }; };
  await f.confirm(); assert.equal(f.sends, 1);
  assert.equal(f.one('[data-agent-gas-result]').textContent, 'Punk 94 unchanged');
  assert.equal(f.state.gasFundingPlan, null);
});

test('busy wallet review blocks opening another allocation without changing selection', async () => {
  const f = fixture(); f.state.gasFundingBusy = true;
  await assert.rejects(f.open(allocation), /Finish the current wallet review/);
  assert.equal(f.state.selected.tokenId, '94'); assert.equal(f.sends, 0);
});
