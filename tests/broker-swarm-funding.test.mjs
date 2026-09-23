import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSwarmFunding, restoreSwarmFunding, allocationFundingStatus, ownerAllocationTransaction } from '../site/broker-swarm-funding.js';
import { buildSwarmPlan, mountSwarm } from '../site/broker-swarm.js';

const owner = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`, destination = `0x${'3'.repeat(40)}`;
const batchId = '11111111-2222-4333-8444-555555555555', txHash = `0x${'a'.repeat(64)}`, blockHash = `0x${'b'.repeat(64)}`;
const input = { owner, chainId: 4663, tokenIds: ['95', '93', '94'], totalEth: '0.00000000000000001', batchId };
const options = { mode: 'SEARCH', daily: '5', total: '5', fundingBudgetEth: '0.001' };
const tx = (amountWei = '500000000000000', nonce = '0x1') => ({ chainId: '0x1237', from: owner, to: destination, data: '0x', value: `0x${BigInt(amountWei).toString(16)}`, nonce });
const prepared = (context, transaction = tx(context.amountWei)) => ({ source: 'OWNER', owner, tokenId: context.tokenId,
  amount: context.amountEth, amountWei: context.amountWei, destination, transaction });
const journal = (tokenId, transaction, status = 'CONFIRMED') => ({ schema: 'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1', owner, tokenId, transaction, status,
  transactionHash: ['WALLET_REQUESTED', 'REJECTED'].includes(status) ? null : txHash,
  receipt: ['CONFIRMED', 'REVERTED'].includes(status) ? { transactionHash: txHash, blockHash, blockNumber: '0x10', status: status === 'CONFIRMED' ? '0x1' : '0x0' } : null });

test('ETH allocation uses exact wei and deterministic lowest-ID remainder with no lost funds', () => {
  const funding = buildSwarmFunding(input);
  assert.deepEqual(funding.allocations.map(a => [a.tokenId, a.amountWei]), [['93', '4'], ['94', '3'], ['95', '3']]);
  assert.equal(funding.totalEth, '0.00000000000000001');
  assert.equal(funding.allocations.reduce((sum, a) => sum + BigInt(a.amountWei), 0n), 10n);
  assert.equal(funding.allocations[0].amountEth, '0.000000000000000004');
  assert.deepEqual(buildSwarmFunding({ ...input, tokenIds: ['94', '95', '93'] }), funding);
  const maximum = buildSwarmFunding({ ...input, tokenIds: Array.from({ length: 10 }, (_, i) => String(i + 1)), totalEth: '10.000' });
  assert.equal(maximum.totalEth, '10'); assert.ok(maximum.allocations.every(a => a.amountEth === '1'));
});

test('invalid, oversized, underflow and ambiguous budgets fail before any funding flow', () => {
  for (const totalEth of ['', '0', '-1', '.1', '01', '1e-3', ' 0.1', '0.1 ', '0.0000000000000000001', '10.000000000000000001', '0.000000000000000001', '3.000000000000000001']) {
    assert.throws(() => buildSwarmFunding({ ...input, totalEth }), totalEth);
  }
  for (const patch of [{ owner: other + '0' }, { owner: `0x${'0'.repeat(40)}` }, { chainId: 1 }, { tokenIds: [] }, { tokenIds: ['93', '93'] }, { tokenIds: ['0'] }, { tokenIds: ['5017'] }, { batchId: 'unbounded' }]) assert.throws(() => buildSwarmFunding({ ...input, ...patch }));
  assert.throws(() => buildSwarmPlan({ owner, chainId: 4663, tokenIds: ['93'], ownedTokenIds: ['94'], options }));
});

test('reloaded funding validates immutable total, members, per-Punk amounts and OWNER transaction shape', () => {
  const funding = buildSwarmFunding(input), context = { ...input };
  const first = funding.allocations[0]; first.opened = true; first.transaction = tx(first.amountWei);
  assert.deepEqual(restoreSwarmFunding(funding, context), funding);
  for (const change of [f => { f.totalWei = '11'; }, f => { f.allocations[0].amountWei = '5'; }, f => { f.allocations.reverse(); }, f => { f.allocations[0].transaction.data = '0x1234'; }, f => { f.allocations[0].transaction.from = other; }, f => { f.owner = other; }]) {
    const altered = structuredClone(funding); change(altered); assert.throws(() => restoreSwarmFunding(altered, context));
  }
  assert.equal(ownerAllocationTransaction({ ...tx('4'), value: '0x0', data: '0x1234' }, owner, '4'), false);
});

test('only matching bound OWNER journal with exact receipt counts as a confirmed allocation', () => {
  const funding = buildSwarmFunding(input), allocation = funding.allocations[0];
  const record = journal('93', tx(allocation.amountWei));
  assert.equal(allocationFundingStatus(funding, allocation, record), 'NOT_REVIEWED');
  allocation.opened = true;
  assert.equal(allocationFundingStatus(funding, allocation, record), 'REVIEW');
  allocation.transaction = tx(allocation.amountWei);
  assert.equal(allocationFundingStatus(funding, allocation, record), 'CONFIRMED');
  for (const change of [r => { r.owner = other; }, r => { r.tokenId = '94'; }, r => { r.transaction.to = other; }, r => { r.transaction.value = '0x5'; }, r => { r.transaction.nonce = '0x2'; }, r => { r.transaction.data = '0x1234'; }, r => { r.transaction.chainId = '0x1'; }, r => { r.receipt.status = '0x0'; }, r => { r.transactionHash = null; }]) {
    const altered = structuredClone(record); change(altered); assert.equal(allocationFundingStatus(funding, allocation, altered), 'CHECK_STATUS');
  }
  allocation.baseline = { status: 'CONFIRMED', transaction: structuredClone(record.transaction) };
  assert.equal(allocationFundingStatus(funding, allocation, record), 'CHECK_STATUS', 'old same-amount transfer is not this batch');
});

class Node {
  constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.classList = { add() {} }; this.value = ''; }
  set textContent(v) { this.text = v; this.children = []; } get textContent() { return (this.text ?? '') + this.children.map(n => n.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); if (this.localName === 'select' && !this.value) this.value = nodes[0].value; }
  replaceChildren() { this.children = []; this.text = ''; } setAttribute() {} addEventListener(k, f) { this.listeners[k] = f; }
  click() { if (!this.disabled) return this.listeners.click?.(); }
}
const walk = n => [n, ...n.children.flatMap(walk)];
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function fixture() {
  const doc = { createElement: tag => new Node(tag, doc) }, root = new Node('section', doc), values = new Map(), records = new Map(), calls = [];
  let context = { owner, chainId: 4663 }, punks = [{ tokenId: '93' }, { tokenId: '94' }], failSave = false;
  const config = { root, getContext: () => context, getPunks: () => punks,
    storage: { getItem: key => values.get(key) ?? null, setItem(key, value) { if (failSave) throw Error('No space'); values.set(key, value); }, removeItem: key => values.delete(key) },
    openReview() { throw Error('Funding must not start a mission'); }, openStatus() {},
    openFunding: async x => { calls.push(x); return { status: 'CONFIRMED' }; }, getFundingState: tokenId => records.get(tokenId) ?? null };
  let panel = mountSwarm(config);
  const find = name => walk(root).find(n => n.name === name);
  const button = label => walk(root).find(n => n.localName === 'button' && n.textContent === label);
  function create() {
    for (const n of walk(root).filter(n => n.type === 'checkbox')) { n.checked = true; n.listeners.change(); }
    find('fundingBudgetEth').value = '0.001';
    walk(root).find(n => n.localName === 'form').listeners.submit({ preventDefault() {} });
  }
  return { root, values, records, calls, config, find, button, create, get panel() { return panel; },
    remount() { panel = mountSwarm(config); }, failSave() { failSave = true; },
    switchOwner() { context = { owner: other, chainId: 4663 }; panel.refresh(); },
    removePunk() { punks = [{ tokenId: '94' }]; panel.refresh(); } };
}

test('funding planner is passive, shows exact budget and opens only one separate owner review', async () => {
  const f = fixture(); f.create(); assert.equal(f.calls.length, 0);
  assert.match(f.root.textContent, /exactly 0.001 ETH/); assert.match(f.root.textContent, /additional network fees/);
  assert.equal(f.panel.fundingContext('93'), null);
  f.button('REVIEW FUNDING #93').click(); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].amountWei, '500000000000000'); assert.equal(f.calls[0].amountEth, '0.0005');
  assert.equal(f.panel.fundingContext('94'), null); assert.match(f.root.textContent, /new deposit needs your wallet confirmation/);
  assert.ok(!f.root.textContent.includes('Deposit confirmed')); assert.match(f.root.textContent, /Review required/);
});

test('exact prepared funding binding survives reload and cannot duplicate after confirmation or journal overwrite', async () => {
  const f = fixture(); f.create(); f.button('REVIEW FUNDING #93').click(); await settle();
  const context = f.panel.fundingContext('93'), review = prepared(context);
  f.panel.fundingPrepared({ ...context, prepared: review });
  f.remount(); assert.equal(f.calls.length, 1); assert.deepEqual(f.panel.fundingContext('93'), context);
  assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: prepared(context, tx(context.amountWei, '0x2')) }), /original/);
  f.records.set('93', journal('93', review.transaction, 'SUBMITTED')); f.panel.refresh();
  assert.match(f.root.textContent, /Deposit submitted/);
  assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: review }), /original/);
  f.records.set('93', journal('93', review.transaction)); f.panel.refresh();
  assert.match(f.root.textContent, /Deposit confirmed in saved receipt/); assert.equal(f.panel.fundingContext('93'), null);
  assert.equal(f.button('REVIEW FUNDING #93'), undefined);
  assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: review }));
  f.records.set('93', journal('93', tx(context.amountWei, '0x8'))); f.panel.refresh();
  assert.match(f.root.textContent, /Funding is not verified/);
  assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: prepared(context, tx(context.amountWei, '0x8')) }), /original/);
  assert.equal(f.calls.length, 1);
});

test('an old confirmed journal cannot be credited to a newly opened equal-size allocation', async () => {
  const f = fixture(), old = journal('93', tx()); f.records.set('93', old); f.create();
  f.button('REVIEW FUNDING #93').click(); await settle(); const context = f.panel.fundingContext('93');
  assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: prepared(context, old.transaction) }), /original/);
  assert.ok(!f.root.textContent.includes('Deposit confirmed'));
  f.panel.fundingPrepared({ ...context, prepared: prepared(context, tx(context.amountWei, '0x2')) });
  assert.match(f.root.textContent, /Review required/); assert.ok(!f.root.textContent.includes('Deposit confirmed'));
});

test('source, owner, destination, amount and batch mismatches never bind a funding review', async () => {
  const f = fixture(); f.create(); f.button('REVIEW FUNDING #93').click(); await settle(); const context = f.panel.fundingContext('93');
  for (const change of [p => { p.source = 'PUNK'; }, p => { p.owner = other; }, p => { p.tokenId = '94'; }, p => { p.destination = other; }, p => { p.amount = '0.01'; }, p => { p.amountWei = '1'; }]) {
    const review = prepared(context); change(review); assert.throws(() => f.panel.fundingPrepared({ ...context, prepared: review }));
  }
  assert.throws(() => f.panel.fundingPrepared({ ...context, batchId, prepared: prepared(context) }));
});

test('ownership changes, unavailable journal and failed plan storage stop funding callbacks', async () => {
  for (const cause of ['transfer', 'owner', 'save', 'journal']) {
    const f = fixture(); f.create();
    if (cause === 'transfer') f.removePunk();
    if (cause === 'owner') f.switchOwner();
    if (cause === 'save') f.failSave();
    if (cause === 'journal') f.config.getFundingState = () => { throw Error('History unavailable'); };
    if (cause === 'journal') f.remount();
    f.button('REVIEW FUNDING #93')?.click(); await settle();
    assert.equal(f.calls.length, 0, cause); assert.equal(f.panel.fundingContext('93'), null);
  }
});

test('changing wallet during open funding discards the stale callback and opens no next Punk', async () => {
  const f = fixture(); let done; f.config.openFunding = () => new Promise(resolve => { done = resolve; }); f.remount(); f.create();
  f.button('REVIEW FUNDING #93').click(); await settle(); f.switchOwner(); done({ status: 'CONFIRMED' }); await settle();
  assert.equal(f.panel.fundingContext('93'), null); assert.ok(!f.root.textContent.includes('Deposit confirmed'));
});

test('tampered saved allocations are rejected on reload without callbacks', () => {
  const f = fixture(); f.create(); const [key, text] = [...f.values][0], saved = JSON.parse(text);
  saved.funding.allocations[0].amountWei = '999999999999999'; f.values.set(key, JSON.stringify(saved)); f.remount();
  assert.match(f.root.textContent, /Saved batch is unavailable/); assert.equal(f.calls.length, 0); assert.equal(f.panel.fundingContext('93'), null);
});
