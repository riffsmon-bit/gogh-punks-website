import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, getContractAddress, keccak256, parseAbi, toFunctionSelector } from 'viem';
import { readAgentWalletCreation as read, prepareAgentWalletCreation as prepare, submitAgentWalletCreation as submit,
  getAgentWalletCreationRecord as record, recoverAgentWalletCreation as recover } from '../site/punk-agent-creation.js';
import { AGENT_RECOVERY_PINS as PINS, agentRecoveryProxyRuntime } from '../site/punk-agent-recovery.js';
import { CODE } from './fixtures/punk-agent-runtime.mjs';

const OWNER = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), SALT = '0x' + '0'.repeat(64);
const CANONICAL = '0x000000006551c19487814612e58fe06813775758';
const HASH = '0x' + 'a'.repeat(64), REPLACEMENT = '0x' + 'b'.repeat(64);
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0'), hex = value => '0x' + BigInt(value).toString(16);
const abi = parseAbi(['function createAccount(uint256 tokenId) returns (address accountAddress)']);
const account = id => getContractAddress({ from: CANONICAL, opcode: 'CREATE2', salt: SALT,
  bytecodeHash: keccak256('0x3d60ad80600a3d3981f3' + agentRecoveryProxyRuntime(String(id), SALT).slice(2)) }).toLowerCase();
function fixture() {
  const values = new Map(), calls = [], state = { connected: OWNER, owner: OWNER, chain: '0x1237', created: false, nonce: 8n,
    head: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)), balance: 10n ** 18n, price: 1_000_000n, gas: 100_000n, sends: 0 };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let tail = Promise.resolve();
  const locks = { request: (_key, _mode, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } };
  const options = { storage, locks, isCurrent: () => true }, context = { owner: OWNER, tokenId: '93' };
  const config = { 'accountSalt()': SALT, 'canonicalRegistry()': word(CANONICAL), 'ROBINHOOD_CHAIN_ID()': word(4663),
    'GOGH_PUNKS()': word(PINS.collection), 'implementation()': word(PINS.implementation) };
  const provider = { request: async ({ method, params = [] }) => {
    calls.push({ method, params: structuredClone(params) }); await state.before?.(method, params);
    if (state.override) { const result = state.override(method, params); if (result !== undefined) return result; }
    if (method === 'eth_chainId') return state.chain;
    if (method === 'eth_accounts') return [state.connected];
    if (method === 'eth_getTransactionCount') return hex(params[1] === 'pending' ? state.pendingNonce ?? state.nonce : state.nonce);
    if (method === 'eth_getBalance') return hex(state.balance);
    if (method === 'eth_gasPrice') return hex(state.price);
    if (method === 'eth_estimateGas') return hex(state.gas);
    if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'latest' ? state.head : BigInt(params[0]);
      return { number: hex(number), timestamp: hex(state.timestamp), hash: state.reorg === number ? REPLACEMENT : word(number), transactions: number === 101n && state.tx ? [state.blockTransaction ?? state.tx.hash] : [] };
    }
    if (method === 'eth_getCode') {
      const [to] = params;
      if (to === PINS.registry) return state.registryCode ?? CODE.registry;
      if (to === PINS.implementation) return state.implementationCode ?? CODE.implementation;
      if (to === OWNER) return state.ownerCode ?? '0x';
      const id = [93, 94].find(id => to === account(id)); assert.ok(id, `unknown code address ${to}`);
      return state.created ? state.accountCode ?? agentRecoveryProxyRuntime(String(id), SALT) : '0x';
    }
    if (method === 'eth_call') {
      const tx = params[0], sig = tx.data.slice(0, 10);
      if (tx.from) {
        assert.equal(tx.to, PINS.registry); assert.equal(sig, toFunctionSelector('createAccount(uint256)')); assert.equal(tx.value, '0x0');
        if (state.simulationRevert) throw Error('execution reverted');
        return word(account(BigInt('0x' + tx.data.slice(10))));
      }
      if (tx.to === PINS.registry) {
        for (const [signature, value] of Object.entries(config)) if (sig === toFunctionSelector(signature)) return value;
        if (sig === toFunctionSelector('account(uint256)')) return word(state.wrongAccount ?? account(BigInt('0x' + tx.data.slice(10))));
        if (sig === toFunctionSelector('isAccountCreated(uint256)')) return word(state.created ? 1 : 0);
      }
      if (tx.to === PINS.collection && sig === toFunctionSelector('ownerOf(uint256)')) return word(state.owner);
      if ([account(93), account(94)].includes(tx.to) && sig === toFunctionSelector('owner()')) return word(state.accountOwner ?? state.owner);
    }
    if (method === 'eth_sendTransaction') {
      assert.equal(record(OWNER, { storage }).status, 'WALLET_REQUESTED'); state.sends++;
      if (state.sendError?.code === 4001) throw state.sendError;
      state.tx = { ...params[0], input: params[0].data, hash: HASH };
      if (state.sendError) throw state.sendError;
      return state.sendHash ?? HASH;
    }
    if (method === 'eth_getTransactionByHash') return state.tx ?? null;
    if (method === 'eth_getTransactionReceipt') return state.receipt ?? null;
    throw Error(`unexpected RPC ${method}`);
  } };
  function mine({ status = '0x1', confirmations = 12, cancelled = false } = {}) {
    state.head = 101n + BigInt(confirmations) - 1n;
    Object.assign(state.tx, { blockNumber: '0x65', blockHash: word(101), transactionIndex: '0x0' });
    state.receipt = { transactionHash: state.tx.hash, from: OWNER, to: state.tx.to, status,
      blockNumber: '0x65', blockHash: word(101), transactionIndex: '0x0', gasUsed: hex(cancelled ? 21000 : 100000),
      effectiveGasPrice: state.tx.gasPrice, logs: [] };
    state.created = status === '0x1' && !cancelled; state.nonce++;
  }
  return { provider, state, storage, values, locks, options, context, calls, config, mine };
}
const rejected = (promise, code) => assert.rejects(promise, error => error.code === 'AGENT_CREATION_' + code);
async function submitted() { const f = fixture(); f.review = await prepare(f.provider, f.context); await submit(f.provider, f.review, f.options); return f; }

test('creation review matches deployed ABI, independently derives canonical address, never signs or funds', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context);
  assert.equal(review.account, '0xcadcfd37e715bc031cf0cec7fa2335091c878c83');
  assert.equal(review.transaction.data, encodeFunctionData({ abi, functionName: 'createAccount', args: [93n] }));
  assert.equal(review.transaction.value, '0x0'); assert.equal(review.transaction.to, PINS.registry);
  assert.equal(review.maximumNetworkFeeWei, '156000000000'); assert.ok(Object.isFrozen(review.transaction));
  assert.equal(f.state.sends, 0); assert.ok(!f.calls.some(c => /send|sign|requestAccounts/i.test(c.method)));
  const result = await submit(f.provider, review, f.options);
  assert.equal(result.status, 'SUBMITTED'); assert.equal(f.state.sends, 1);
  assert.deepEqual(f.calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params), [[review.transaction]]);
  assert.deepEqual([...f.values.keys()], ['gogh:agent-wallet-creation:4663:' + OWNER]);
});

test('existing pinned account is a read-only result regardless of mission state', async () => {
  const f = fixture(); f.state.created = true;
  const result = await prepare(f.provider, f.context);
  assert.equal(result.created, true); assert.equal(result.account, account(93)); assert.equal(f.state.sends, 0);
  assert.ok(!f.calls.some(c => c.method === 'eth_estimateGas'));
  const selectors = f.calls.filter(c => c.method === 'eth_call').map(c => c.params[0].data.slice(0, 10));
  assert.ok(!selectors.includes(toFunctionSelector('sessionKey()')));
});

for (const [name, mutate, code] of [
  ['wrong chain', f => f.state.chain = '0x1', 'OWNER_CHANGED'],
  ['changed connected wallet', f => f.state.connected = OTHER, 'OWNER_CHANGED'],
  ['transferred Punk', f => f.state.owner = OTHER, 'PUNK_OWNER_CHANGED'],
  ['registry code', f => f.state.registryCode = '0x6000', 'CODE_CHANGED'],
  ['implementation code', f => f.state.implementationCode = '0x6000', 'CODE_CHANGED'],
  ['noncanonical destination', f => f.state.wrongAccount = OTHER, 'CONFIG_CHANGED'],
  ['registry config', f => f.config['GOGH_PUNKS()'] = word(OTHER), 'CONFIG_CHANGED'],
  ['proxy runtime', f => { f.state.created = true; f.state.accountCode = '0x6000'; }, 'CODE_CHANGED'],
  ['proxy owner', f => { f.state.created = true; f.state.accountOwner = OTHER; }, 'CODE_CHANGED'],
  ['pending owner nonce', f => f.state.pendingNonce = 9n, 'NONCE_CHANGED'],
  ['stale chain', f => f.state.timestamp -= 60n, 'STALE_CHAIN'],
  ['insufficient fee balance', f => f.state.balance = 0n, 'INSUFFICIENT_FUNDS'],
  ['excess fee', f => f.state.price = 10n ** 12n, 'FEE_LIMIT'],
  ['simulation revert', f => f.state.simulationRevert = true, 'READ_UNAVAILABLE'],
]) test('prepare rejects ' + name + ' without wallet prompt', async () => {
  const f = fixture(); mutate(f); await rejected(prepare(f.provider, f.context), code); assert.equal(f.state.sends, 0);
});

for (const [name, mutate, code] of [
  ['owner transfer', f => f.state.owner = OTHER, 'PUNK_OWNER_CHANGED'],
  ['wallet chain switch', f => f.state.chain = '0x1', 'OWNER_CHANGED'],
  ['nonce consumed', f => f.state.nonce++, 'REVIEW_CHANGED'],
  ['registry changed', f => f.state.registryCode = '0x6000', 'CODE_CHANGED'],
  ['account already created', f => f.state.created = true, 'ALREADY_CREATED'],
  ['fee increase beyond reviewed margin', f => f.state.price = 1_200_001n, 'FEE_CHANGED'],
  ['anchor reorg', f => f.state.reorg = 100n, 'CHAIN_CHANGED'],
]) test('submit rechecks ' + name, async () => {
  const f = fixture(), review = await prepare(f.provider, f.context); mutate(f);
  await rejected(submit(f.provider, review, f.options), code); assert.equal(f.state.sends, 0); assert.equal(record(OWNER, f.options), null);
});

test('tampered calldata/value/destination and stale review fail before provider or storage changes', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context);
  for (const change of [{ data: '0x' }, { value: '0x1' }, { to: OTHER }, { authorizationList: [] }]) {
    const bad = structuredClone(review); Object.assign(bad.transaction, change);
    await rejected(submit(f.provider, bad, f.options), 'REVIEW_INVALID');
  }
  const expired = structuredClone(review); expired.anchor.timestamp = String(BigInt(expired.anchor.timestamp) - 100n); expired.expiresAt -= 100000;
  await rejected(submit(f.provider, expired, f.options), 'EXPIRED'); assert.equal(f.state.sends, 0);
});

test('context changes during final checks cannot open a wallet prompt', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context); let current = true;
  f.state.before = method => { if (method === 'eth_estimateGas') current = false; };
  await rejected(submit(f.provider, review, { ...f.options, isCurrent: () => current }), 'CONTEXT_CHANGED'); assert.equal(f.state.sends, 0);
});

test('explicit wallet rejection alone permits a retry of the same reviewed transaction', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context); f.state.sendError = { code: 4001 };
  assert.equal((await submit(f.provider, review, f.options)).status, 'REJECTED'); delete f.state.sendError;
  assert.equal((await submit(f.provider, review, f.options)).status, 'SUBMITTED'); assert.equal(f.state.sends, 2);
});

test('unknown wallet result survives reload, blocks another Punk, and recovers without resending', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context); f.state.sendError = Error('lost wallet response');
  await rejected(submit(f.provider, review, f.options), 'RESULT_UNKNOWN');
  assert.equal(record(OWNER, { storage: f.storage }).status, 'WALLET_REQUESTED');
  const another = await prepare(f.provider, { owner: OWNER, tokenId: '94' });
  await rejected(submit(f.provider, another, f.options), 'PENDING');
  f.mine(); const result = await recover(f.provider, OWNER, { ...f.options, hash: HASH });
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.review.tokenId, '93'); assert.equal(f.state.sends, 1);
});

test('cross-tab duplicate submit is serialized and opens only one wallet request', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context);
  const results = await Promise.allSettled([submit(f.provider, review, f.options), submit(f.provider, review, f.options)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'AGENT_CREATION_PENDING'); assert.equal(f.state.sends, 1);
});

test('storage and lock failures stop before the wallet prompt', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context);
  await rejected(submit(f.provider, review, { ...f.options, locks: null }), 'LOCKS');
  await rejected(submit(f.provider, review, { ...f.options, storage: { getItem: () => null, setItem: () => { throw Error('full'); } } }), 'STORAGE');
  f.values.set('gogh:agent-wallet-creation:4663:' + OWNER, '{}');
  await rejected(submit(f.provider, review, f.options), 'JOURNAL'); assert.equal(f.state.sends, 0);
});

test('canonical creation requires 12 confirmations and actual runtime; idempotent no-event success is valid', async () => {
  const f = await submitted(); f.mine({ confirmations: 11 });
  assert.equal((await recover(f.provider, OWNER, f.options)).status, 'SUBMITTED'); f.state.head++;
  const result = await recover(f.provider, OWNER, f.options);
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.receipt.actualNetworkFeeWei, '120000000000');
  assert.equal(result.receipt.feeExceeded, false); assert.equal(f.state.sends, 1);
  await rejected(recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT }), 'HASH_CHANGED');
});

for (const [name, mutate, code] of [
  ['sender', f => f.state.tx.from = OTHER, 'TRANSACTION_MISMATCH'],
  ['nonce', f => f.state.tx.nonce = '0x9', 'TRANSACTION_MISMATCH'],
  ['chain', f => f.state.tx.chainId = '0x1', 'TRANSACTION_MISMATCH'],
  ['value', f => f.state.tx.value = '0x1', 'TRANSACTION_MISMATCH'],
  ['different call', f => f.state.tx.input = '0x', 'TRANSACTION_MISMATCH'],
  ['authorization', f => f.state.tx.authorizationList = [{}], 'TRANSACTION_MISMATCH'],
  ['type 4', f => f.state.tx.type = '0x4', 'TRANSACTION_MISMATCH'],
  ['receipt sender', f => f.state.receipt.from = OTHER, 'RECEIPT_MISMATCH'],
  ['receipt index', f => f.state.receipt.transactionIndex = '0x1', 'RECEIPT_MISMATCH'],
  ['legacy receipt fee', f => f.state.receipt.effectiveGasPrice = '0x1', 'RECEIPT_MISMATCH'],
  ['receipt block', f => f.state.receipt.blockHash = REPLACEMENT, 'RECEIPT_MISMATCH'],
  ['canonical block', f => f.state.reorg = 101n, 'CHAIN_CHANGED'],
  ['saved anchor reorg', f => f.state.reorg = 100n, 'CHAIN_CHANGED'],
  ['block transaction inclusion', f => f.state.blockTransaction = REPLACEMENT, 'RECEIPT_MISMATCH'],
  ['pre-review receipt', f => { f.state.tx.blockNumber = f.state.receipt.blockNumber = '0x63'; }, 'RECEIPT_MISMATCH'],
  ['missing runtime', f => f.state.created = false, 'CREATION_UNVERIFIED'],
  ['mutated runtime', f => f.state.accountCode = '0x6000', 'CODE_CHANGED'],
]) test('recovery rejects ' + name + ' and retains original pending journal', async () => {
  const f = await submitted(); f.mine(); mutate(f);
  await rejected(recover(f.provider, OWNER, f.options), code);
  assert.equal(record(OWNER, f.options).status, 'SUBMITTED'); assert.equal(record(OWNER, f.options).transactionHash, HASH); assert.equal(f.state.sends, 1);
});

test('ownership transfer after mined creation can be reconciled, but cannot grant fresh owner authority', async () => {
  const f = await submitted(); f.mine(); f.state.owner = OTHER;
  assert.equal((await recover(f.provider, OWNER, f.options)).status, 'CONFIRMED');
  await rejected(read(f.provider, f.context), 'PUNK_OWNER_CHANGED'); assert.equal(f.state.sends, 1);
});

test('same-action wallet speedup above review fee is only reconciled after finality, with explicit actual fee evidence', async () => {
  const f = await submitted(); Object.assign(f.state.tx, { hash: REPLACEMENT, gasPrice: hex(f.state.price * 3n), gas: hex(6_000_000) });
  f.mine({ confirmations: 11 });
  assert.equal((await recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT })).transactionHash, HASH); f.state.head++;
  const result = await recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT });
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.receipt.feeExceeded, true); assert.equal(result.receipt.actualNetworkFeeWei, '300000000000');
  assert.equal(f.state.sends, 1);
});

test('strict successful self-cancellation retires pending request only at 12 confirmations, then fresh review works', async () => {
  const f = await submitted(); Object.assign(f.state.tx, { hash: REPLACEMENT, to: OWNER, input: '0x', data: '0x', gasPrice: hex(f.state.price * 10n) });
  f.mine({ cancelled: true, confirmations: 11 });
  assert.equal((await recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT })).transactionHash, HASH); f.state.head++;
  const result = await recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT });
  assert.equal(result.status, 'CANCELLED'); assert.equal(result.receipt.feeExceeded, true);
  const review = await prepare(f.provider, f.context); assert.equal(review.transaction.nonce, '0x9');
  assert.equal((await submit(f.provider, review, f.options)).status, 'SUBMITTED'); assert.equal(f.state.sends, 2);
});

for (const [name, mutate] of [
  ['logs', f => f.state.receipt.logs = [{}]], ['code', f => f.state.ownerCode = '0x6000'], ['failed receipt', f => f.state.receipt.status = '0x0'],
]) test('self-cancellation rejects ' + name, async () => {
  const f = await submitted(); Object.assign(f.state.tx, { hash: REPLACEMENT, to: OWNER, input: '0x' }); f.mine({ cancelled: true }); mutate(f);
  await rejected(recover(f.provider, OWNER, { ...f.options, hash: REPLACEMENT }), 'CANCELLATION_UNVERIFIED');
  assert.equal(record(OWNER, f.options).transactionHash, HASH);
});

test('reverted exact creation is terminal without claiming an account exists', async () => {
  const f = await submitted(); f.mine({ status: '0x0' });
  assert.equal((await recover(f.provider, OWNER, f.options)).status, 'REVERTED'); assert.equal(f.state.created, false);
});

function splitReadFixture() {
  const f = fixture(), original = f.provider.request, walletCalls = [], readCalls = [];
  f.provider.request = request => {
    walletCalls.push(request.method);
    assert.ok(['eth_accounts', 'eth_chainId', 'eth_getTransactionCount', 'eth_sendTransaction'].includes(request.method), request.method);
    return original(request);
  };
  const readProvider = { request: request => {
    readCalls.push(request.method);
    assert.ok(!['eth_accounts', 'eth_getTransactionCount', 'eth_sendTransaction'].includes(request.method), request.method);
    return original(request);
  } };
  return { ...f, walletCalls, readCalls, readProvider, context: { ...f.context, readProvider }, options: { ...f.options, readProvider } };
}

test('public reader handles checks and recovery while wallet retains identity, pending nonce and the single send', async () => {
  const f = splitReadFixture(), review = await prepare(f.provider, f.context);
  assert.ok(f.readCalls.includes('eth_call')); assert.ok(f.readCalls.includes('eth_estimateGas'));
  assert.ok(f.walletCalls.includes('eth_getTransactionCount')); assert.equal(f.state.sends, 0);
  await submit(f.provider, review, f.options); f.mine();
  assert.equal((await recover(f.provider, OWNER, f.options)).status, 'CONFIRMED');
  assert.ok(f.readCalls.includes('eth_getTransactionReceipt'));
  assert.equal(f.walletCalls.filter(method => method === 'eth_sendTransaction').length, 1);
  assert.ok(!f.readCalls.some(method => /sign|send|requestAccounts/i.test(method)));
});

test('public and wallet chain mismatch fails closed before a creation review', async () => {
  const f = splitReadFixture(), original = f.readProvider.request;
  f.readProvider.request = request => request.method === 'eth_chainId' ? '0x1' : original(request);
  await rejected(prepare(f.provider, f.context), 'READ_CHAIN_CHANGED');
  assert.equal(f.state.sends, 0); assert.equal(record(OWNER, f.options), null);
});

test('wallet identity and pending nonce remain authoritative with an independent public reader', async () => {
  for (const fault of ['wallet', 'pending', 'owner']) {
    const f = splitReadFixture(), review = await prepare(f.provider, f.context);
    if (fault === 'wallet') f.state.connected = OTHER;
    if (fault === 'pending') f.state.pendingNonce = 9n;
    if (fault === 'owner') f.state.owner = OTHER;
    await rejected(submit(f.provider, review, f.options), fault === 'wallet' ? 'OWNER_CHANGED' : fault === 'pending' ? 'NONCE_CHANGED' : 'PUNK_OWNER_CHANGED');
    assert.equal(f.state.sends, 0); assert.equal(record(OWNER, f.options), null);
  }
});

test('public read failure preserves a pending creation and never retries its wallet transaction', async () => {
  const f = splitReadFixture(), review = await prepare(f.provider, f.context);
  await submit(f.provider, review, f.options); f.mine();
  const original = f.readProvider.request;
  f.readProvider.request = request => {
    if (request.method === 'eth_getTransactionReceipt') throw Error('read unavailable');
    return original(request);
  };
  await rejected(recover(f.provider, OWNER, f.options), 'READ_UNAVAILABLE');
  assert.equal(record(OWNER, f.options).status, 'SUBMITTED'); assert.equal(f.state.sends, 1);
});

test('fee movement within the displayed 20 percent margin keeps the exact reviewed transaction', async () => {
  const f = fixture(), review = await prepare(f.provider, f.context);
  f.state.price = 1_200_000n;
  await submit(f.provider, review, f.options);
  assert.deepEqual(f.calls.find(call => call.method === 'eth_sendTransaction').params, [review.transaction]);
  assert.equal(review.maximumNetworkFeeWei, '156000000000');
});

test('public base-fee error asks for a new creation review without sending', async () => {
  const f = splitReadFixture(), review = await prepare(f.provider, f.context), original = f.readProvider.request;
  f.readProvider.request = request => {
    if (request.method === 'eth_estimateGas') throw Object.assign(Error('Network fee changed.'), { code: 'SWARM_WALLET_FEE_CHANGED' });
    return original(request);
  };
  await rejected(submit(f.provider, review, f.options), 'FEE_CHANGED');
  assert.equal(f.state.sends, 0); assert.equal(record(OWNER, f.options), null);
});
