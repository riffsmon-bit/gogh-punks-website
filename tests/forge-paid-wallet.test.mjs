import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeFunctionData, parseAbi } from 'viem';
import { PAID_TRAINING_RELEASE } from '../site/forge-paid-release.js';
import { createPaidTrainingWallet, createPaidTrainingReadProvider, paidReleaseAvailable, paidTrainingCalldata, validatePaidReview, PAID_ZERO_KEY } from '../site/forge-paid-wallet.js';
import { paidUiFixture, PAID_UI_HASH } from './fixtures/paid-training-ui.mjs';
const action = (operation = 'buy', skillKey = PAID_ZERO_KEY, slot = 0) => ({ operation, skillKey, slot });
const envelope = f => ({ review: f.review(action()), maximumNetworkFeeWei: '100000000000000' });
function wallet(f, extra = {}) { return createPaidTrainingWallet({ release: f.release, getProvider: () => f.provider,
  readProvider: { request: args => f.provider.request(args) },
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
    r => r.transaction.chainId = '0x1', r => r.transaction.nonce = '0x08', r => r.transaction.nonce = '0xA',
    r => r.transaction.maxFeePerGas = '0x3B9ACA00', r => r.transaction.chainId = '0x01237', r => r.transaction.chainId = 4663,
    r => r.transaction.data += '00', r => r.transaction.authorizationList = [],
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
test('wallet archive restrictions do not block independently verified paid training confirmation', async () => {
  const f = paidUiFixture(), source = f.provider.request, calls = [];
  f.provider.request = args => {
    calls.push(args.method);
    if (['eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs'].includes(args.method))
      throw Object.assign(Error('Unsupported secret wallet endpoint'), { code: -32602 });
    return source(args);
  };
  const result = await wallet(f, { readProvider: { request: source } }).submit(envelope(f), f.selected, action());
  assert.equal(result.transactionHash, PAID_UI_HASH); assert.equal(f.sends, 1); assert.equal(f.marker, true);
  assert.deepEqual([...new Set(calls)].sort(), ['eth_accounts', 'eth_chainId', 'eth_estimateGas', 'eth_getBalance', 'eth_getTransactionCount', 'eth_sendTransaction'].sort());
});
test('WalletConnect numeric chain ID preserves every field of the exact reviewed wallet request', async () => {
  const f = paidUiFixture(), source = f.provider.request, e = envelope(f), expected = structuredClone(e.review.transaction);
  let chainChecks = 0;
  f.provider.request = args => {
    if (args.method === 'eth_chainId') { chainChecks++; return Promise.resolve(4663); }
    return source(args);
  };
  f.beforeSend = tx => { assert.equal(f.marker, true); assert.deepEqual(tx, expected);
    assert.ok(Object.values(tx).every(value => typeof value === 'string')); };
  assert.equal((await wallet(f, { readProvider: { request: source } }).submit(e, f.selected, action())).transactionHash, PAID_UI_HASH);
  assert.equal(f.sends, 1); assert.equal(chainChecks, 2); assert.deepEqual(e.review.transaction, expected);
});
test('equivalent bounded wallet quantities preserve the exact canonical reviewed transaction', async () => {
  const f = paidUiFixture(), source = f.provider.request, e = envelope(f);
  e.review.transaction.nonce = '0xab';
  f.provider.request = async args => {
    const value = await source(args);
    if (args.method === 'eth_getTransactionCount') return '0x' + 'AB'.padStart(64, '0');
    if (['eth_chainId', 'eth_estimateGas', 'eth_getBalance'].includes(args.method))
      return '0x' + BigInt(value).toString(16).toUpperCase().padStart(64, '0');
    return value;
  };
  f.beforeSend = tx => { assert.equal(f.marker, true); assert.deepEqual(tx, e.review.transaction); };
  const result = await wallet(f, { readProvider: { request: source } }).submit(e, f.selected, action());
  assert.equal(result.transactionHash, PAID_UI_HASH); assert.equal(f.sends, 1);
  assert.equal(e.review.transaction.nonce, '0xab');
});
test('equivalent public block quantities compare numerically and produce canonical read parameters', async () => {
  const f = paidUiFixture(), source = f.provider.request;
  const encoded = value => '0x' + BigInt(value).toString(16).toUpperCase().padStart(64, '0');
  const readProvider = { request: async args => {
    if (args.method === 'eth_call') assert.match(args.params[1], /^0x(?:0|[1-9a-f][0-9a-f]*)$/);
    if (args.method === 'eth_getLogs') assert.match(args.params[0].toBlock, /^0x(?:0|[1-9a-f][0-9a-f]*)$/);
    const result = await source(args);
    if (args.method === 'eth_chainId') return encoded(result);
    if (args.method === 'eth_getBlockByNumber' && args.params[0] === 'latest') return { ...result,
      number: encoded(result.number), timestamp: encoded(result.timestamp), baseFeePerGas: encoded(result.baseFeePerGas) };
    return result;
  } };
  assert.equal((await wallet(f, { readProvider }).submit(envelope(f), f.selected, action())).transactionHash, PAID_UI_HASH);
  assert.equal(f.sends, 1);
});
test('malformed or over-32-byte wallet quantities fail before persisting an attempt', async () => {
  for (const method of ['eth_chainId', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_getBalance']) {
    const invalidValues = [null, '8', '0x', '0x-1', '0x1.0', '0xG', '0x' + '0'.repeat(65),
      ...(method === 'eth_chainId' ? [0, -1, 4663.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1] : [8])];
    for (const invalid of invalidValues) {
      const f = paidUiFixture(), source = f.provider.request;
      f.provider.request = args => args.method === method ? Promise.resolve(invalid) : source(args);
      await assert.rejects(wallet(f, { readProvider: { request: source } }).submit(envelope(f), f.selected, action()),
        error => error.code === 'PAID_RPC_QUANTITY_INVALID' && /No wallet request was made/.test(error.message), `${method}:${invalid}`);
      assert.equal(f.marker, false); assert.equal(f.sends, 0);
    }
  }
});
test('wallet account, chain, pending transaction and stale nonce have distinct actionable errors', async () => {
  for (const [method, override, code, guidance] of [
    ['eth_accounts', () => [], 'PAID_WALLET_ACCOUNT_CHANGED', /Select the wallet that owns this Punk/],
    ['eth_chainId', () => '0x01', 'PAID_WALLET_WRONG_CHAIN', /Switch your wallet to Robinhood Chain/],
    ['eth_chainId', () => 1, 'PAID_WALLET_WRONG_CHAIN', /Switch your wallet to Robinhood Chain/],
    ['eth_getTransactionCount', args => args.params[1] === 'pending' ? '0x0009' : '0x0008', 'PAID_WALLET_PENDING_TRANSACTION', /Check wallet activity/],
    ['eth_getTransactionCount', () => '0x0009', 'PAID_WALLET_NONCE_CHANGED', /transaction count changed/],
  ]) {
    const f = paidUiFixture(), source = f.provider.request;
    f.provider.request = args => args.method === method ? Promise.resolve(override(args)) : source(args);
    await assert.rejects(wallet(f, { readProvider: { request: source } }).submit(envelope(f), f.selected, action()),
      error => error.code === code && guidance.test(error.message) && /No wallet request was made/.test(error.message));
    assert.equal(f.marker, false); assert.equal(f.sends, 0);
  }
});
test('malformed public quantities and a late reader chain change cannot reach the wallet', async () => {
  for (const fault of ['chain', 'number', 'timestamp', 'baseFeePerGas', 'closingChain']) {
    const f = paidUiFixture(), source = f.provider.request; let chains = 0;
    const readProvider = { request: async args => {
      const result = await source(args);
      if (args.method === 'eth_chainId') {
        if (fault === 'chain') return '4663';
        if (fault === 'closingChain' && ++chains === 2) return '0x0001';
      }
      if (args.method === 'eth_getBlockByNumber' && ['number', 'timestamp', 'baseFeePerGas'].includes(fault))
        return { ...result, [fault]: '0x' + 'F'.repeat(65) };
      return result;
    } };
    await assert.rejects(wallet(f, { readProvider }).submit(envelope(f), f.selected, action()),
      error => error.code === (fault === 'closingChain' ? 'PAID_CHAIN_MISMATCH' : 'PAID_RPC_QUANTITY_INVALID'));
    assert.equal(f.marker, false); assert.equal(f.sends, 0);
  }
});
test('a pending transaction appearing at the final wallet recheck still prevents paid training submission', async () => {
  const f = paidUiFixture(), source = f.provider.request; let pendingReads = 0;
  f.provider.request = args => {
    if (args.method === 'eth_getTransactionCount' && args.params[1] === 'pending' && ++pendingReads === 2) return '0x0009';
    return source(args);
  };
  await assert.rejects(wallet(f, { readProvider: { request: source } }).submit(envelope(f), f.selected, action()),
    error => error.code === 'PAID_WALLET_PENDING_TRANSACTION');
  assert.equal(pendingReads, 2); assert.equal(f.marker, false); assert.equal(f.sends, 0);
});
test('a WalletConnect numeric chain change at the final check blocks the wallet request', async () => {
  const f = paidUiFixture(), source = f.provider.request; let chainChecks = 0;
  f.provider.request = args => args.method === 'eth_chainId' ? Promise.resolve(++chainChecks === 1 ? 4663 : 1) : source(args);
  await assert.rejects(wallet(f, { readProvider: { request: source } }).submit(envelope(f), f.selected, action()),
    error => error.code === 'PAID_WALLET_WRONG_CHAIN');
  assert.equal(chainChecks, 2); assert.equal(f.marker, false); assert.equal(f.sends, 0);
});
test('quantity normalization does not bypass balance, gas or base-fee limits', async () => {
  for (const fault of ['balance', 'gas', 'baseFee']) {
    const f = paidUiFixture(), source = f.provider.request;
    f.provider.request = async args => {
      const result = await source(args);
      if (fault === 'balance' && args.method === 'eth_getBalance') return '0x0000';
      if (fault === 'gas' && args.method === 'eth_estimateGas') return '0x000186A1';
      if (fault === 'baseFee' && args.method === 'eth_getBlockByNumber') return { ...result, baseFeePerGas: '0x003B9ACA01' };
      return result;
    };
    await assert.rejects(wallet(f).submit(envelope(f), f.selected, action()));
    assert.equal(f.marker, false, fault); assert.equal(f.sends, 0, fault);
  }
});
test('wrong independent chain, anchor, runtime or transfer evidence still blocks a capable wallet', async () => {
  for (const fault of ['chain', 'anchor', 'runtime', 'transfer']) {
    const f = paidUiFixture(), source = f.provider.request;
    const readProvider = { request: async args => {
      const result = await source(args);
      if (fault === 'chain' && args.method === 'eth_chainId') return '0x1';
      if (fault === 'anchor' && args.method === 'eth_getBlockByNumber' && args.params[0] !== 'latest') return { ...result, hash: PAID_UI_HASH };
      if (fault === 'runtime' && args.method === 'eth_getCode') return '0x6000';
      if (fault === 'transfer' && args.method === 'eth_getLogs') return [{}];
      return result;
    } };
    await assert.rejects(wallet(f, { readProvider }).submit(envelope(f), f.selected, action()));
    assert.equal(f.sends, 0, fault); assert.equal(f.marker, false, fault);
  }
});
test('fixed chain reader sends only read methods without cookies and rejects malformed RPC replies', async () => {
  const calls = [];
  const reader = createPaidTrainingReadProvider({ fetcher: async (url, options) => {
    calls.push({ url, options }); const body = JSON.parse(options.body);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x1237' }));
  } });
  assert.equal(await reader.request({ method: 'eth_chainId' }), '0x1237');
  assert.equal(calls[0].url, 'https://rpc.mainnet.chain.robinhood.com'); assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.cache, 'no-store');
  for (const method of ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'wallet_switchEthereumChain'])
    await assert.rejects(reader.request({ method, params: [] }), e => e.code === 'PAID_CHAIN_READ_UNAVAILABLE');
  assert.equal(calls.length, 1);
  for (const response of [{ jsonrpc: '2.0', id: 55, result: '0x1237' }, { jsonrpc: '2.0', id: 1, error: { message: 'private-provider-secret' } }, { jsonrpc: '2.0', id: 1 }]) {
    const bad = createPaidTrainingReadProvider({ fetcher: async () => new Response(JSON.stringify(response)) });
    await assert.rejects(bad.request({ method: 'eth_chainId' }), e => e.code === 'PAID_CHAIN_READ_UNAVAILABLE' && !e.message.includes('private-provider-secret'));
  }
});
test('chain and wallet read timeouts are bounded, sanitized and do not mark or send an attempt', async () => {
  const reader = createPaidTrainingReadProvider({ timeoutMs: 5, fetcher: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Error('private endpoint timeout')), { once: true });
  }) });
  await assert.rejects(reader.request({ method: 'eth_chainId' }), e => e.code === 'PAID_CHAIN_READ_TIMEOUT');
  const f = paidUiFixture(), source = f.provider.request;
  f.provider.request = args => args.method === 'eth_getTransactionCount' ? new Promise(() => {}) : source(args);
  await assert.rejects(wallet(f, { walletReadTimeoutMs: 5 }).submit(envelope(f), f.selected, action()),
    e => e.code === 'PAID_WALLET_READ_TIMEOUT' && /No wallet request was made/.test(e.message));
  assert.equal(f.marker, false); assert.equal(f.sends, 0);
});
test('unsupported wallet fee check has a safe error code and actionable network guidance', async () => {
  const f = paidUiFixture(), source = f.provider.request;
  f.provider.request = args => args.method === 'eth_estimateGas'
    ? Promise.reject(Object.assign(Error('private-provider-url'), { code: -32602 })) : source(args);
  await assert.rejects(wallet(f).submit(envelope(f), f.selected, action()), e => e.code === 'PAID_WALLET_RPC_UNSUPPORTED'
    && /RPC setting/.test(e.message) && !e.message.includes('private-provider-url'));
  assert.equal(f.sends, 0); assert.equal(f.marker, false);
});
test('near-expiry review explains why no wallet prompt opens and makes no RPC or send',async()=>{
 const f=paidUiFixture(),e=envelope(f);
 await assert.rejects(wallet(f,{now:()=>Number(e.review.guard.deadline)*1000-4000}).submit(e,f.selected,action()),/too little time.*No wallet request.*Refresh/);
 assert.equal(f.methods.length,0);assert.equal(f.sends,0);assert.equal(f.marker,false);
});
test('wallet network rejection identifies the failed stage without disclosing provider errors',async()=>{
 const f=paidUiFixture(),rpc=f.provider.request;
 f.provider.request=args=>args.method==='eth_chainId'?Promise.reject(Error('secret-provider-url')):rpc(args);
 await assert.rejects(wallet(f).submit(envelope(f),f.selected,action()),e=>/wallet account, network and pending transactions failed.*No wallet request/.test(e.message)&&!e.message.includes('secret-provider-url'));
 assert.equal(f.sends,0);assert.equal(f.marker,false);
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
