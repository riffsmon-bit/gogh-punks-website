import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeFunctionData, parseAbi } from 'viem';
import { PAID_TRAINING_RELEASE } from '../site/forge-paid-release.js';
import { createPaidTrainingWallet, paidReleaseAvailable, paidTrainingCalldata, validatePaidReview, PAID_ZERO_KEY } from '../site/forge-paid-wallet.js';
import { paidUiFixture, PAID_UI_HASH } from './fixtures/paid-training-ui.mjs';
const action = (operation = 'buy', skillKey = PAID_ZERO_KEY, slot = 0) => ({ operation, skillKey, slot });
const envelope = f => ({ review: f.review(action()), maximumNetworkFeeWei: '100000000000000' });
function wallet(f, extra = {}) { return createPaidTrainingWallet({ release: f.release, getProvider: () => f.provider,
  readCurrent: () => f.request('/api/v2/punks/93/forge/paid-training'), verify: async review => { await f.verifyHook(); return { ok: true, review }; },
  wasAttempted: () => f.marker, markAttempted: async () => { f.marker = true; }, isCurrent: () => true, ...extra }); }
test('paid browser release matches immutable server artifact and cannot enable payment', async () => {
  assert.deepEqual(PAID_TRAINING_RELEASE, JSON.parse(await readFile(new URL('../deployments/robinhood-paid-training.json', import.meta.url))));
  const f = paidUiFixture(); assert.equal(paidReleaseAvailable(PAID_TRAINING_RELEASE, f.selected), false);
  for (const key of ['canonicalReadersReviewed', 'productionPaymentsAuthorized']) {
    const release = { ...f.release, [key]: false }; assert.equal(paidReleaseAvailable(release, f.selected), false);
  }
});
test('all six paid operation encodings independently match canonical Solidity ABI', () => {
  const f = paidUiFixture(), abi = parseAbi(['function applyReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint256 nonce,bytes32 stateHash,uint64 deadline)) payable']);
  for (const [index, operation] of ['buy', 'activate', 'learn', 'unlock', 'equip', 'unequip'].entries()) {
    const a = action(operation, ['learn', 'equip'].includes(operation) ? f.release.skills[0].key : PAID_ZERO_KEY, ['equip', 'unequip'].includes(operation) ? 1 : 0), r = f.review(a);
    assert.equal(paidTrainingCalldata(r.tokenId, a, r.guard), encodeFunctionData({ abi, functionName: 'applyReview', args: [{ tokenId: 93n, operation: index,
      skillKey: a.skillKey, slot: a.slot, nonce: BigInt(r.guard.nonce), stateHash: r.guard.stateHash, deadline: BigInt(r.guard.deadline) }] }));
    assert.equal(validatePaidReview(r, f.selected, f.release).value, operation === 'buy' ? '0x1c6bf52634000' : '0x0');
  }
});
test('wallet refuses unreviewed fields, domain/value/calldata changes and expired reviews', () => {
  const f = paidUiFixture(), mutations = [r => r.transaction.value = '0x0', r => r.transaction.value = '0x1c6bf52634001',
    r => r.transaction.to = f.release.treasury, r => r.owner = f.release.extension, r => r.tokenId = '94', r => r.chainId = 1,
    r => r.transaction.chainId = '0x1', r => r.transaction.nonce = '0x08', r => r.transaction.data += '00', r => r.transaction.authorizationList = [],
    r => r.transaction.maxFeePerGas = '0xffffffffffff', r => r.guard.deadline = String(Math.floor(Date.now() / 1000) - 1),
    r => r.priceWei = '1', r => r.treasury = f.release.extension, r => r.extensionCodeHash = PAID_ZERO_KEY,
    r => r.action.operation = 'paid_mint', r => r.action.skillKey = f.release.skills[0].key, r => r.action.slot = 1];
  for (const mutate of mutations) { const r = f.review(action()); mutate(r); assert.throws(() => validatePaidReview(r, f.selected, f.release)); }
  const other = f.review(action('activate')); other.transaction.value = '0x1'; assert.throws(() => validatePaidReview(other, f.selected, f.release));
});
test('exact paid wallet request is persisted once and cannot replay', async () => {
  const f = paidUiFixture(), e = envelope(f); f.beforeSend = tx => { assert.equal(f.marker, true); assert.deepEqual(tx, e.review.transaction); };
  const w = wallet(f); assert.equal((await w.submit(e, f.selected, action())).transactionHash, PAID_UI_HASH);
  await assert.rejects(w.submit(e, f.selected, action())); assert.equal(f.sends, 1);
  const logs = f.methods.filter(x => x === 'eth_getLogs'); assert.equal(logs.length, 1);
});
test('active or malformed sacrifice approval blocks a prepared purchase before wallet access', async () => {
  for (const approval of [true, undefined, 'false', 0]) {
    const f = paidUiFixture(), e = envelope(f); f.state.burnApprovalActive = approval;
    await assert.rejects(wallet(f).submit(e, f.selected, action()));
    assert.equal(f.methods.length, 0); assert.equal(f.sends, 0); assert.equal(f.marker, false);
  }
});
test('pending nonce, wrong account/chain, code, transfer and canonical anchor changes stop before attempt', async () => {
  for (const [method, value] of [['eth_getTransactionCount', '0x9'], ['eth_accounts', [ '0x3333333333333333333333333333333333333333' ]],
    ['eth_chainId', '0x1'], ['eth_getCode', '0x6000'], ['eth_getLogs', [{}]],
    ['eth_getBlockByNumber', { number: '0x64', timestamp: '0x0', hash: PAID_UI_HASH }]]) {
    const f = paidUiFixture(), original = f.provider.request; f.provider.request = args => args.method === method ? Promise.resolve(value) : original(args);
    await assert.rejects(wallet(f).submit(envelope(f), f.selected, action()), method); assert.equal(f.sends, 0); assert.equal(f.marker, false);
  }
});
test('stale verify/selection, changed echo and failed attempt persistence never prompt', async () => {
  for (const mode of ['stale', 'echo', 'storage']) {
    const f = paidUiFixture(); let current = true;
    const w = wallet(f, { isCurrent: () => current,
      verify: async review => { if (mode === 'stale') current = false; return { ok: true, review: mode === 'echo' ? { ...review, tokenId: '94' } : review }; },
      markAttempted: async () => { throw Error('Storage unavailable'); } });
    await assert.rejects(w.submit(envelope(f), f.selected, action())); assert.equal(f.sends, 0);
  }
});
test('user rejection and lost wallet response remain attempted across adapter replacement', async () => {
  for (const mode of ['reject', 'lost']) {
    const f = paidUiFixture(); f.mode = mode; const e = envelope(f);
    await assert.rejects(wallet(f).submit(e, f.selected, action())); assert.equal(f.marker, true); assert.equal(f.sends, 1);
    await assert.rejects(wallet(f).submit(e, f.selected, action())); assert.equal(f.sends, 1);
  }
});
test('undeployed or paused release cannot reach wallet RPC; paused exact review remains recoverable', async () => {
  const f = paidUiFixture(), e = envelope(f), paused = { ...f.release, status: 'PAUSED', productionPaymentsAuthorized: false };
  assert.deepEqual(validatePaidReview(e.review, f.selected, paused, { recovery: true }), e.review.transaction);
  for (const release of [PAID_TRAINING_RELEASE, paused, { ...f.release, canonicalReadersReviewed: false }]) {
    await assert.rejects(wallet(f, { release }).submit(e, f.selected, action())); assert.equal(f.methods.length, 0);
  }
});
test('reorg of closing head above unchanged anchor blocks wallet attempt', async () => {
  const f = paidUiFixture(), original = f.provider.request;
  f.provider.request = async args => {
    const value = await original(args);
    if (args.method !== 'eth_getBlockByNumber') return value;
    if (args.params[0] === 'latest') return { ...value, number: '0x65', hash: `0x${'d'.repeat(64)}` };
    if (args.params[0] === '0x65') return { ...value, number: '0x65', hash: `0x${'e'.repeat(64)}` };
    return value;
  };
  await assert.rejects(wallet(f).submit(envelope(f), f.selected, action())); assert.equal(f.marker, false); assert.equal(f.sends, 0);
});
