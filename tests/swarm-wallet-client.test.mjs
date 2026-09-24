import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, keccak256, parseAbi, toFunctionSelector } from 'viem';
import { readSwarmWallet, prepareSwarmWallet, submitSwarmWallet, getSwarmWalletRecord, recoverSwarmWallet } from '../site/swarm-wallet-client.js';
import { AGENT_RECOVERY_PINS as PINS, agentRecoveryProxyRuntime } from '../site/punk-agent-recovery.js';
import { CODE } from './fixtures/punk-agent-runtime.mjs';

const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, FACTORY = `0x${'3'.repeat(40)}`, VAULT = `0x${'4'.repeat(40)}`;
const CANONICAL = `0x${'5'.repeat(40)}`, SALT = `0x${'0'.repeat(64)}`, TX_HASH = `0x${'a'.repeat(64)}`, REPLACEMENT_HASH = `0x${'b'.repeat(64)}`;
const FACTORY_CODE = '0x6001600055', ETH = 10n ** 18n;
const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`, hex = value => `0x${BigInt(value).toString(16)}`;
const RUNTIME = { object: `0x60${'0'.repeat(64)}5b60${'0'.repeat(64)}f3`, immutableReferences: { 1: [{ start: 1, length: 32 }, { start: 35, length: 32 }] } };
const VAULT_CODE = `0x60${word(OWNER).slice(2)}5b60${word(OWNER).slice(2)}f3`;
const ABI = parseAbi([
  'function createVault() returns (address)', 'function deposit() payable',
  'function fundBatch((uint256 tokenId,uint256 amountWei)[] allocations,uint256 expectedNonce,uint256 deadline)',
  'function withdrawToOwner(uint256 amountWei,uint256 expectedNonce,uint256 deadline)',
  'event VaultCreated(address indexed owner,address indexed vault)', 'event Deposit(address indexed sender,uint256 amountWei)',
  'event PunkFunded(uint256 indexed nonce,uint256 indexed tokenId,address indexed account,uint256 amountWei)',
  'event BatchFunded(uint256 indexed nonce,uint256 count,uint256 totalWei)', 'event Withdrawn(uint256 indexed nonce,address indexed owner,uint256 amountWei)',
]);
const batch = () => ({ kind: 'BATCH', allocations: [{ tokenId: '93', amountWei: '1000000000000000' }, { tokenId: '94', amountWei: '2000000000000000' }] });
const deposit = () => ({ kind: 'DEPOSIT', amountWei: '3000000000000000' });
const withdraw = () => ({ kind: 'WITHDRAW', amountWei: '3000000000000000' });
function fixture({ created = true } = {}) {
  const release = { status: 'LIVE', chainId: 4663, factory: FACTORY, factoryCodeHash: keccak256(FACTORY_CODE),
    collection: PINS.collection, registry: PINS.registry, implementation: PINS.implementation,
    registryCodeHash: PINS.registryHash, implementationCodeHash: PINS.implementationHash, vaultRuntime: structuredClone(RUNTIME) };
  const values = new Map(), calls = [], state = { created, nonce: 3n, ownerNonce: 8n, owner: OWNER, chain: '0x1237', balance: ETH,
    ownerBalance: ETH, gas: 100_000n, gasPrice: 1_000_000n, code: VAULT_CODE, head: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)), sends: 0, registryDown: false, before: () => {} };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let tail = Promise.resolve();
  const locks = { request: (_name, _mode, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } };
  const agent = tokenId => `0x${(BigInt(tokenId) + 1000n).toString(16).padStart(40, '0')}`;
  const config = { chainId: word(4663), collection: word(PINS.collection), registry: word(PINS.registry), implementation: word(PINS.implementation),
    registryCodeHash: PINS.registryHash, implementationCodeHash: PINS.implementationHash, accountSalt: SALT, canonicalRegistry: word(CANONICAL) };
  const provider = { request: async ({ method, params = [] }) => {
    calls.push({ method, params: structuredClone(params) }); await state.before(method, params);
    if (state.override) { const result = state.override(method, params); if (result !== undefined) return result; }
    if (method === 'eth_chainId') return state.chain;
    if (method === 'eth_accounts') return [state.owner];
    if (method === 'eth_getTransactionCount') return hex(params[1] === 'pending' ? state.pendingNonce ?? state.ownerNonce : state.ownerNonce);
    if (method === 'eth_getBlockByNumber') { const number = params[0] === 'latest' ? state.head : BigInt(params[0]);
      return { number: hex(number), hash: state.reorg === number ? TX_HASH : word(number), timestamp: hex(state.timestamp) }; }
    if (method === 'eth_getCode') {
      const [to] = params;
      if (to === OWNER) return state.ownerCode ?? '0x';
      if (to === FACTORY) return FACTORY_CODE;
      if (to === VAULT) return state.created ? state.code : '0x';
      if (to === PINS.registry) { if (state.registryDown) throw Error('private-rpc-url'); return CODE.registry; }
      if (to === PINS.implementation) return CODE.implementation;
      const id = ['93', '94'].find(tokenId => agent(tokenId) === to); assert.ok(id, `Unknown code address ${to}`);
      return agentRecoveryProxyRuntime(id, SALT);
    }
    if (method === 'eth_getBalance') return hex(params[0] === OWNER ? state.ownerBalance : state.balance);
    if (method === 'eth_gasPrice') return hex(state.gasPrice);
    if (method === 'eth_estimateGas') return hex(state.gas);
    if (method === 'eth_call') {
      const tx = params[0], sig = tx.data.slice(0, 10);
      if (tx.from) { if (state.revert) throw Error('simulation reverted'); return tx.to === FACTORY ? word(VAULT) : '0x'; }
      if ([FACTORY, VAULT].includes(tx.to)) {
        for (const [name, value] of Object.entries(config)) if (sig === toFunctionSelector(`${name}()`)) return value;
        if (sig === toFunctionSelector('owner()')) return word(state.vaultOwner ?? OWNER);
        if (sig === toFunctionSelector('nonce()')) return word(state.nonce);
        if (sig === toFunctionSelector('getVault(address)')) return word(VAULT);
        if (sig === toFunctionSelector('isVaultCreated(address)')) return word(state.created ? 1 : 0);
      }
      if (tx.to === PINS.registry) {
        if (state.registryDown) throw Error('private-rpc-url');
        for (const [name, value] of Object.entries({ accountSalt: SALT, canonicalRegistry: word(CANONICAL), ROBINHOOD_CHAIN_ID: word(4663), GOGH_PUNKS: word(PINS.collection), implementation: word(PINS.implementation) })) if (sig === toFunctionSelector(`${name}()`)) return value;
        if (sig === toFunctionSelector('account(uint256)')) return word(agent(BigInt(`0x${tx.data.slice(10)}`).toString()));
      }
      if (tx.to === PINS.collection) return word(state.punkOwner ?? OWNER);
      if (['93', '94'].some(id => agent(id) === tx.to) && sig === toFunctionSelector('owner()')) return word(state.punkOwner ?? OWNER);
    }
    if (method === 'eth_sendTransaction') {
      assert.equal(getSwarmWalletRecord(OWNER, { storage }).status, 'WALLET_REQUESTED');
      state.sends++; if (state.sendError?.code === 4001) throw state.sendError;
      state.tx = { ...params[0], input: params[0].data, hash: TX_HASH };
      if (state.sendError) throw state.sendError;
      return state.sendHash ?? TX_HASH;
    }
    if (method === 'eth_getTransactionByHash') return state.tx ?? null;
    if (method === 'eth_getTransactionReceipt') { if (state.receiptError) throw Error('offline'); return state.receipt ?? null; }
    throw Error(`Unexpected fixture RPC ${method}:${JSON.stringify(params)}`);
  } };
  const event = (name, args, data, address = VAULT) => ({ address, topics: encodeEventTopics({ abi: ABI, eventName: name, args }), data,
    removed: false, transactionHash: state.tx.hash, blockHash: word(101), blockNumber: '0x65' });
  function mine(review, { status = '0x1', confirmations = 12, cancelled = false } = {}) {
    const action = review.action, nonce = BigInt(review.vaultNonce ?? '0'); let logs = [];
    if (status === '0x1' && !cancelled) {
      if (action.kind === 'CREATE') { state.created = true; logs = [event('VaultCreated', { owner: OWNER, vault: VAULT }, '0x', FACTORY)]; }
      if (action.kind === 'DEPOSIT') logs = [event('Deposit', { sender: OWNER }, word(action.amountWei))];
      if (action.kind === 'WITHDRAW') logs = [event('Withdrawn', { nonce, owner: OWNER }, word(action.amountWei))];
      if (action.kind === 'BATCH') logs = [...review.allocations.map(row => event('PunkFunded', { nonce, tokenId: BigInt(row.tokenId), account: row.account }, word(row.amountWei))),
        event('BatchFunded', { nonce }, encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [BigInt(review.allocations.length), review.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n)]))];
      if (['BATCH', 'WITHDRAW'].includes(action.kind)) state.nonce++;
    }
    state.ownerNonce++; state.head = 101n + BigInt(confirmations - 1);
    state.tx.blockNumber = '0x65'; state.tx.blockHash = word(101); state.tx.transactionIndex = '0x0';
    state.receipt = { from: OWNER, to: state.tx.to, transactionHash: state.tx.hash, blockNumber: '0x65', blockHash: word(101), transactionIndex: '0x0', status,
      gasUsed: hex(cancelled ? 21_000n : state.gas), effectiveGasPrice: state.tx.gasPrice ?? state.tx.maxFeePerGas, logs };
  }
  const options = { release, storage, locks, isCurrent: () => true };
  return { release, state, calls, values, provider, storage, locks, options, mine,
    prepare: action => prepareSwarmWallet(provider, { owner: OWNER, release, action }),
    submit: review => submitSwarmWallet(provider, review, options), recover: hash => recoverSwarmWallet(provider, OWNER, { ...options, hash }) };
}

test('unreleased, wrong-chain and changed pinned releases fail before wallet access', async () => {
  for (const change of [r => { r.status = 'UNDEPLOYED'; }, r => { r.chainId = 1; }, r => { r.collection = OTHER; }, r => { r.registryCodeHash = TX_HASH; }, r => { r.factory = PINS.registry; }]) {
    const f = fixture(); change(f.release); await assert.rejects(f.prepare(deposit())); assert.equal(f.calls.length, 0);
  }
});
test('passive state verifies deterministic vault, runtime, immutable getters and nonces without signatures', async () => {
  const f = fixture(), state = await readSwarmWallet(f.provider, { owner: OWNER.toUpperCase().replace('0X', '0x'), release: f.release });
  assert.equal(state.vault, VAULT); assert.equal(state.vaultNonce, '3'); assert.equal(state.balanceWei, ETH.toString()); assert.equal(state.dependenciesVerified, true);
  assert.ok(Object.isFrozen(state)); assert.ok(f.calls.every(call => !/send|sign|requestAccounts/.test(call.method)));
});
test('all four transaction encodings independently match the Solidity ABI; reviews are deeply immutable', async () => {
  for (const action of [{ kind: 'CREATE' }, deposit(), batch(), withdraw()]) {
    const f = fixture({ created: action.kind !== 'CREATE' }), r = await f.prepare(action);
    const name = { CREATE: 'createVault', DEPOSIT: 'deposit', BATCH: 'fundBatch', WITHDRAW: 'withdrawToOwner' }[action.kind];
    const args = action.kind === 'BATCH' ? [action.allocations.map(row => ({ tokenId: BigInt(row.tokenId), amountWei: BigInt(row.amountWei) })), 3n, BigInt(r.expiresAt / 1000)]
      : action.kind === 'WITHDRAW' ? [BigInt(action.amountWei), 3n, BigInt(r.expiresAt / 1000)] : [];
    assert.equal(r.transaction.data, encodeFunctionData({ abi: ABI, functionName: name, args }));
    assert.equal(r.transaction.to, action.kind === 'CREATE' ? FACTORY : VAULT);
    assert.equal(r.transaction.value, action.kind === 'DEPOSIT' ? hex(action.amountWei) : '0x0');
    assert.ok(BigInt(r.maximumNetworkFeeWei) <= 10n ** 15n); assert.ok(Object.isFrozen(r.transaction)); assert.ok(Object.isFrozen(r.action));
    assert.equal(f.state.sends, 0);
  }
});
test('ambiguous, oversized, unordered or duplicate batch inputs never reach RPC', async () => {
  for (const action of [{ kind: 'OTHER' }, { kind: 'CREATE', to: OTHER }, { kind: 'DEPOSIT', amountWei: '01' }, { kind: 'DEPOSIT', amountWei: (11n * ETH).toString() },
    { kind: 'WITHDRAW', amountWei: '0' }, { kind: 'BATCH', allocations: [] }, { kind: 'BATCH', allocations: [{ tokenId: '0', amountWei: '1' }] },
    { kind: 'BATCH', allocations: [{ tokenId: '93', amountWei: (ETH + 1n).toString() }] }, { kind: 'BATCH', allocations: [...batch().allocations].reverse() },
    { kind: 'BATCH', allocations: [batch().allocations[0], batch().allocations[0]] }]) {
    const f = fixture(); await assert.rejects(f.prepare(action)); assert.equal(f.calls.length, 0);
  }
});
test('wrong owner/network/nonce, stale blocks, runtime and simulation fail closed', async () => {
  for (const fault of ['owner', 'chain', 'pendingNonce', 'vaultOwner', 'runtime', 'immutable', 'stale', 'gas', 'fee', 'funds', 'ownerFunds', 'punkOwner', 'simulation', 'reorg']) {
    const f = fixture();
    if (fault === 'owner') f.state.owner = OTHER;
    if (fault === 'chain') f.state.chain = '0x1';
    if (fault === 'pendingNonce') f.state.pendingNonce = 9n;
    if (fault === 'vaultOwner') f.state.vaultOwner = OTHER;
    if (fault === 'runtime') f.state.code = f.state.code.slice(0, -2) + 'fe';
    if (fault === 'immutable') f.state.code = `0x60${word(OTHER).slice(2)}${f.state.code.slice(68)}`;
    if (fault === 'stale') f.state.timestamp -= 60n;
    if (fault === 'gas') f.state.gas = 5_000_000n;
    if (fault === 'fee') f.state.gasPrice = 10n ** 18n;
    if (fault === 'funds') f.state.balance = 0n;
    if (fault === 'ownerFunds') f.state.ownerBalance = 1n;
    if (fault === 'punkOwner') f.state.punkOwner = OTHER;
    if (fault === 'simulation') f.state.revert = true;
    if (fault === 'reorg') { let heads = 0; f.state.before = method => { if (method === 'eth_getBlockByNumber' && ++heads > 1) f.state.reorg = 100n; }; }
    await assert.rejects(f.prepare(batch()), fault); assert.equal(f.state.sends, 0, fault);
  }
});
test('owner withdrawal stays available with zero Punks and unavailable funding registry', async () => {
  const f = fixture(); f.state.registryDown = true; f.state.punkOwner = OTHER;
  assert.equal((await readSwarmWallet(f.provider, { owner: OWNER, release: f.release })).dependenciesVerified, false);
  await assert.rejects(f.prepare(deposit()), e => e.code === 'SWARM_WALLET_DEPENDENCIES_UNAVAILABLE');
  await assert.rejects(f.prepare(batch()));
  const r = await f.prepare(withdraw()); await f.submit(r); f.mine(r);
  assert.equal((await f.recover()).status, 'CONFIRMED'); assert.equal(f.state.sends, 1);
});
test('fresh rechecks reject changes to review, vault nonce, owner nonce, owner and fee before wallet request', async () => {
  for (const fault of ['value', 'destination', 'extra', 'amount', 'nonce', 'ownerNonce', 'owner', 'fee', 'runtime', 'selection']) {
    const f = fixture(), r = structuredClone(await f.prepare(batch()));
    if (fault === 'value') r.transaction.value = '0x1';
    if (fault === 'destination') r.transaction.to = OTHER;
    if (fault === 'extra') r.transaction.authorizationList = [];
    if (fault === 'amount') r.action.allocations[0].amountWei = '1';
    if (fault === 'nonce') f.state.nonce++;
    if (fault === 'ownerNonce') f.state.ownerNonce++;
    if (fault === 'owner') f.state.punkOwner = OTHER;
    if (fault === 'fee') f.state.gasPrice *= 2n;
    if (fault === 'runtime') f.state.code = '0x6000';
    if (fault === 'selection') f.options.isCurrent = () => false;
    await assert.rejects(f.submit(r), fault); assert.equal(f.state.sends, 0, fault);
  }
});
test('expired reviews and a vault nonce changing during final simulation never open the wallet', async () => {
  const expired = fixture(), old = structuredClone(await expired.prepare(deposit()));
  old.anchor.timestamp = String(Math.floor(Date.now() / 1000) - 90); old.expiresAt = (Number(old.anchor.timestamp) + 90) * 1000;
  const reads = expired.calls.length;
  await assert.rejects(expired.submit(old), error => error.code === 'SWARM_WALLET_REVIEW_EXPIRED');
  assert.equal(expired.calls.length, reads); assert.equal(expired.state.sends, 0);
  const f = fixture(), review = await f.prepare(batch());
  f.state.before = (method, params) => { if (method === 'eth_call' && params[0].from) f.state.nonce++; };
  await assert.rejects(f.submit(review), error => error.code === 'SWARM_WALLET_NONCE_CHANGED');
  assert.equal(f.state.sends, 0);
});
test('malformed compiled immutable masks and configuration getters cannot create a release bypass', async () => {
  for (const fault of ['overlap', 'outside', 'length', 'getter', 'factory-code']) {
    const f = fixture();
    if (fault === 'overlap') f.release.vaultRuntime.immutableReferences[2] = [{ start: 1, length: 32 }];
    if (fault === 'outside') f.release.vaultRuntime.immutableReferences[1][0].start = 500;
    if (fault === 'length') f.release.vaultRuntime.immutableReferences[1][0].length = 31;
    if (fault === 'getter') f.state.override = (method, params) => method === 'eth_call' && params[0].to === VAULT && params[0].data === toFunctionSelector('implementation()') ? word(OTHER) : undefined;
    if (fault === 'factory-code') f.state.override = (method, params) => method === 'eth_getCode' && params[0] === FACTORY ? '0x6000' : undefined;
    await assert.rejects(f.prepare(withdraw()), fault); assert.equal(f.state.sends, 0);
  }
});
test('wallet read timeout is bounded and never marks or sends a request', async () => {
  const f = fixture(); f.provider.request = () => new Promise(() => {});
  await assert.rejects(f.prepare(deposit()), error => error.code === 'SWARM_WALLET_READ_TIMEOUT');
  assert.equal(f.state.sends, 0); assert.equal(f.values.size, 0);
});
test('missing locks and failed durable writes stop before the wallet opens', async () => {
  for (const fault of ['locks', 'write', 'readback']) {
    const f = fixture(), r = await f.prepare(deposit());
    if (fault === 'locks') f.options.locks = null;
    if (fault === 'write') f.storage.setItem = () => { throw Error('No space'); };
    if (fault === 'readback') f.storage.setItem = () => {};
    await assert.rejects(f.submit(r)); assert.equal(f.state.sends, 0);
  }
});
test('concurrent tabs submit once and unknown wallet results require original-hash recovery', async () => {
  const f = fixture(), r = await f.prepare(batch()); f.state.sendError = Error('wallet response lost');
  const results = await Promise.allSettled([f.submit(r), f.submit(r)]);
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(f.state.sends, 1);
  assert.equal(getSwarmWalletRecord(OWNER, { storage: f.storage }).status, 'WALLET_REQUESTED');
  await assert.rejects(f.submit(r)); assert.equal(f.state.sends, 1);
  f.mine(r); assert.equal((await f.recover(TX_HASH)).status, 'CONFIRMED'); assert.equal(f.state.sends, 1);
  await assert.rejects(f.submit(r));
});
test('only explicit wallet code 4001 permits a rejected attempt to be resubmitted', async () => {
  const f = fixture(), r = await f.prepare(deposit()); f.state.sendError = Object.assign(Error('cancelled'), { code: 4001 });
  assert.equal((await f.submit(r)).status, 'REJECTED'); f.state.sendError = null;
  assert.equal((await f.submit(r)).status, 'SUBMITTED'); assert.equal(f.state.sends, 2);
});
test('all actions require original transaction and exact delivery events after twelve canonical blocks', async () => {
  for (const action of [{ kind: 'CREATE' }, deposit(), batch(), withdraw()]) {
    const f = fixture({ created: action.kind !== 'CREATE' }), r = await f.prepare(action);
    assert.equal((await f.submit(r)).status, 'SUBMITTED'); f.mine(r, { confirmations: 11 });
    assert.equal((await f.recover()).status, 'SUBMITTED'); f.state.head++;
    const confirmed = await f.recover(); assert.equal(confirmed.status, 'CONFIRMED'); assert.ok(confirmed.receipt.events.length > 0);
    assert.deepEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }), confirmed); assert.equal(f.state.sends, 1);
  }
});
test('wrong hashes, transaction mutations, receipts, missing/incorrect delivery and reorgs cannot confirm', async () => {
  for (const fault of ['hash', 'tx', 'receipt', 'gas', 'missing', 'amount', 'owner', 'extra', 'removed', 'reorg', 'staleHead']) {
    const f = fixture(), r = await f.prepare(batch()); await f.submit(r); f.mine(r);
    if (fault === 'tx') f.state.tx.value = '0x1';
    if (fault === 'receipt') f.state.receipt.to = OTHER;
    if (fault === 'gas') f.state.receipt.gasUsed = '0xffffff';
    if (fault === 'missing') f.state.receipt.logs.pop();
    if (fault === 'amount') f.state.receipt.logs[0].data = word(1);
    if (fault === 'owner') f.state.owner = OTHER;
    if (fault === 'extra') f.state.receipt.logs.push(f.state.receipt.logs[0]);
    if (fault === 'removed') f.state.receipt.logs[0].removed = true;
    if (fault === 'reorg') f.state.reorg = 101n;
    if (fault === 'staleHead') f.state.timestamp -= 90n;
    await assert.rejects(f.recover(fault === 'hash' ? word(123) : undefined), fault);
    assert.notEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }).status, 'CONFIRMED'); assert.equal(f.state.sends, 1);
  }
});
test('recovery binds a verified hash before transient receipt failure and accepts a proven revert without success events', async () => {
  const f = fixture(), r = await f.prepare(withdraw()); f.state.sendError = Error('lost'); await assert.rejects(f.submit(r));
  f.mine(r, { status: '0x0' }); f.state.receiptError = true;
  await assert.rejects(f.recover(TX_HASH)); assert.equal(getSwarmWalletRecord(OWNER, { storage: f.storage }).transactionHash, TX_HASH);
  f.state.receiptError = false; assert.equal((await f.recover()).status, 'REVERTED'); assert.equal(f.state.sends, 1);
});
test('wallet gas and legacy or EIP-1559 fee edits record exact charges against the reviewed total fee ceiling', async () => {
  for (const edit of ['lower-price', 'lower-limit', 'higher-price', 'higher-limit', 'eip1559']) {
    const f = fixture(), r = await f.prepare(deposit()); await f.submit(r);
    if (edit === 'lower-price') f.state.tx.gasPrice = hex(f.state.gasPrice - 1n);
    if (edit === 'lower-limit') f.state.tx.gas = hex(110_000n);
    if (edit === 'higher-price') { f.state.tx.gas = hex(100_000n); f.state.tx.gasPrice = hex(1_200_000n); }
    if (edit === 'higher-limit') { f.state.tx.gas = hex(150_000n); f.state.tx.gasPrice = hex(800_000n); }
    if (edit === 'eip1559') Object.assign(f.state.tx, { type: '0x2', maxFeePerGas: hex(1_000_000n), maxPriorityFeePerGas: hex(10_000n), gasPrice: hex(900_000n) });
    f.mine(r); const result = await f.recover(); assert.equal(result.status, 'CONFIRMED', edit); assert.equal(result.receipt.feeExceeded, false, edit);
    assert.equal(result.receipt.actualNetworkFeeWei, (BigInt(f.state.receipt.gasUsed) * BigInt(f.state.receipt.effectiveGasPrice)).toString(), edit);
    assert.equal(f.state.sends, 1, edit);
  }
});
test('same-nonce action replacement preserves the original until canonical delivery is final', async () => {
  const f = fixture(), r = await f.prepare(batch()); await f.submit(r);
  f.state.tx.hash = REPLACEMENT_HASH; f.state.tx.gas = hex(100_000n); f.state.tx.gasPrice = hex(1_200_000n);
  assert.equal((await f.recover(REPLACEMENT_HASH)).transactionHash, TX_HASH);
  f.mine(r, { confirmations: 11 });
  assert.equal((await f.recover(REPLACEMENT_HASH)).transactionHash, TX_HASH);
  await assert.rejects(f.submit(await f.prepare(withdraw())), e => e.code === 'SWARM_WALLET_REQUEST_PENDING');
  f.state.head++;
  const result = await f.recover(REPLACEMENT_HASH);
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.transactionHash, REPLACEMENT_HASH);
  assert.deepEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }), result); assert.equal(f.state.sends, 1);
});
test('replacement receipt failure and mismatched delivery never erase the original recovery hash', async () => {
  for (const fault of ['offline', 'wrong-delivery', 'index', 'reorg']) {
    const f = fixture(), r = await f.prepare(batch()); await f.submit(r); f.state.tx.hash = REPLACEMENT_HASH; f.mine(r);
    if (fault === 'offline') f.state.receiptError = true;
    if (fault === 'wrong-delivery') f.state.receipt.logs[0].data = word(1);
    if (fault === 'index') f.state.receipt.transactionIndex = '0x1';
    if (fault === 'reorg') f.state.reorg = 101n;
    await assert.rejects(f.recover(REPLACEMENT_HASH), fault);
    const saved = getSwarmWalletRecord(OWNER, { storage: f.storage });
    assert.equal(saved.transactionHash, TX_HASH, fault); assert.equal(saved.status, 'SUBMITTED', fault);
  }
});
test('unrelated, authorized-code and invalid-fee action replacements never unlock a pending request', async () => {
  for (const fault of ['nonce', 'from', 'chain', 'destination', 'value', 'data', 'authorization', 'type4', 'unknown-type', 'price', 'gas', 'fee-cap', 'tip', 'receipt-price']) {
    const f = fixture(), r = await f.prepare(batch()); await f.submit(r); f.state.tx.hash = REPLACEMENT_HASH;
    if (fault === 'nonce') f.state.tx.nonce = '0x9';
    if (fault === 'from') f.state.tx.from = OTHER;
    if (fault === 'chain') f.state.tx.chainId = '0x1';
    if (fault === 'destination') f.state.tx.to = OTHER;
    if (fault === 'value') f.state.tx.value = '0x1';
    if (fault === 'data') f.state.tx.input = '0x';
    if (fault === 'authorization') f.state.tx.authorizationList = [{ address: OTHER }];
    if (fault === 'type4') f.state.tx.type = '0x4';
    if (fault === 'unknown-type') f.state.tx.type = '0x7f';
    if (fault === 'price') f.state.tx.gasPrice = '0x0';
    if (fault === 'gas') f.state.tx.gas = '0x0';
    if (fault === 'fee-cap') Object.assign(f.state.tx, { type: '0x2', maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' });
    if (fault === 'tip') Object.assign(f.state.tx, { type: '0x2', maxFeePerGas: hex(f.state.gasPrice), maxPriorityFeePerGas: hex(f.state.gasPrice + 1n) });
    f.mine(r); if (fault === 'receipt-price') f.state.receipt.effectiveGasPrice = hex(f.state.gasPrice + 1n);
    await assert.rejects(f.recover(REPLACEMENT_HASH), fault);
    const saved = getSwarmWalletRecord(OWNER, { storage: f.storage });
    assert.equal(saved.transactionHash, TX_HASH, fault); assert.equal(saved.status, 'SUBMITTED', fault); assert.equal(f.state.sends, 1, fault);
  }
});
function cancel(f) {
  Object.assign(f.state.tx, { hash: REPLACEMENT_HASH, to: OWNER, value: '0x0', input: '0x', data: '0x', gas: hex(21_000n) });
}
test('finalized same-owner same-nonce zero-value empty-data cancellation retires only the original request', async () => {
  for (const unknown of [false, true]) {
    const f = fixture(), r = await f.prepare(batch());
    if (unknown) { f.state.sendError = Error('lost'); await assert.rejects(f.submit(r)); } else await f.submit(r);
    cancel(f); f.mine(r, { cancelled: true, confirmations: 11 });
    const pending = await f.recover(REPLACEMENT_HASH);
    assert.equal(pending.status, unknown ? 'WALLET_REQUESTED' : 'SUBMITTED'); assert.equal(pending.transactionHash, unknown ? null : TX_HASH);
    f.state.head++;
    const result = await f.recover(REPLACEMENT_HASH);
    assert.equal(result.status, 'CANCELLED'); assert.equal(result.receipt.status, '0x1'); assert.equal(result.receipt.events.length, 0);
    assert.equal(result.receipt.cancellation.nonce, r.transaction.nonce);
    assert.equal(f.state.nonce, 3n); assert.equal(f.state.sends, 1); assert.deepEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }), result);
    f.state.sendError = null;
    const next = await f.prepare(withdraw()); assert.equal(next.vaultNonce, r.vaultNonce); assert.notEqual(next.transaction.nonce, r.transaction.nonce);
    assert.equal((await f.submit(next)).status, 'SUBMITTED'); assert.equal(f.state.sends, 2);
  }
});
test('cancellation proof rejects altered intent, unauthorized code, logs, failure and noncanonical receipts', async () => {
  for (const fault of ['value', 'data', 'to', 'from', 'nonce', 'chain', 'authorization', 'type4', 'fee', 'code', 'logs', 'revert', 'reorg', 'receipt-to']) {
    const f = fixture(), r = await f.prepare(deposit()); await f.submit(r); cancel(f);
    if (fault === 'value') f.state.tx.value = '0x1';
    if (fault === 'data') f.state.tx.input = '0x00';
    if (fault === 'to') f.state.tx.to = OTHER;
    if (fault === 'from') f.state.tx.from = OTHER;
    if (fault === 'nonce') f.state.tx.nonce = '0x9';
    if (fault === 'chain') f.state.tx.chainId = '0x1';
    if (fault === 'authorization') f.state.tx.authorizationList = [{ address: OTHER }];
    if (fault === 'type4') f.state.tx.type = '0x4';
    if (fault === 'fee') f.state.tx.gasPrice = '0x0';
    if (fault === 'code') f.state.ownerCode = '0xef0100' + OTHER.slice(2);
    if (fault === 'reorg') f.state.reorg = 101n;
    f.mine(r, { cancelled: true, status: fault === 'revert' ? '0x0' : '0x1' });
    if (fault === 'logs') f.state.receipt.logs = [{ address: VAULT }];
    if (fault === 'receipt-to') f.state.receipt.to = OTHER;
    await assert.rejects(f.recover(REPLACEMENT_HASH), fault);
    const saved = getSwarmWalletRecord(OWNER, { storage: f.storage });
    assert.equal(saved.status, 'SUBMITTED', fault); assert.equal(saved.transactionHash, TX_HASH, fault); assert.equal(f.state.sends, 1, fault);
  }
});
test('ordinary speed-ups above the reviewed fee never strand withdrawal after canonical action or cancellation proof', async () => {
  for (const kind of ['original', 'replacement', 'eip1559', 'gas-limit', 'cancel', 'unknown', 'reverted']) {
    const f = fixture(), r = await f.prepare(deposit());
    if (kind === 'unknown') { f.state.sendError = Error('lost'); await assert.rejects(f.submit(r)); } else await f.submit(r);
    if (kind !== 'original') f.state.tx.hash = REPLACEMENT_HASH;
    f.state.tx.gasPrice = hex(f.state.gasPrice * 10n);
    if (kind === 'eip1559') Object.assign(f.state.tx, { type: '0x2', maxFeePerGas: hex(f.state.gasPrice * 20n), maxPriorityFeePerGas: hex(f.state.gasPrice) });
    if (kind === 'gas-limit') { f.state.tx.gas = hex(6_000_000n); f.state.tx.gasPrice = hex(f.state.gasPrice); }
    if (kind === 'cancel') cancel(f);
    const candidate = f.state.tx.hash, savedHash = kind === 'unknown' ? null : TX_HASH;
    assert.equal((await f.recover(candidate)).transactionHash, savedHash, kind);
    f.mine(r, { cancelled: kind === 'cancel', confirmations: 11, status: kind === 'reverted' ? '0x0' : '0x1' });
    assert.equal((await f.recover(candidate)).transactionHash, savedHash, kind);
    await assert.rejects(f.submit(await f.prepare(withdraw())), e => e.code === 'SWARM_WALLET_REQUEST_PENDING', kind);
    f.state.head++;
    const result = await f.recover(candidate);
    assert.equal(result.status, kind === 'cancel' ? 'CANCELLED' : kind === 'reverted' ? 'REVERTED' : 'CONFIRMED', kind);
    assert.equal(result.receipt.feeExceeded, kind !== 'gas-limit', kind);
    assert.equal(result.receipt.actualNetworkFeeWei, (BigInt(f.state.receipt.gasUsed) * BigInt(f.state.receipt.effectiveGasPrice)).toString(), kind);
    assert.deepEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }), result); assert.equal(f.state.sends, 1, kind);
    f.state.sendError = null;
    assert.equal((await f.submit(await f.prepare(withdraw()))).status, 'SUBMITTED', kind); assert.equal(f.state.sends, 2, kind);
  }
});
test('recovered fee evidence and fee-exceeded flags reject storage mutations', async () => {
  const f = fixture(), r = await f.prepare(deposit()); await f.submit(r); f.state.tx.gasPrice = hex(f.state.gasPrice * 2n); f.mine(r);
  const result = await f.recover(); assert.equal(result.receipt.feeExceeded, true);
  const [key, saved] = [...f.values][0];
  for (const field of ['actualNetworkFeeWei', 'gasUsed', 'effectiveGasPrice', 'feeExceeded']) {
    const changed = JSON.parse(saved); changed.receipt[field] = field === 'feeExceeded' ? false : '1';
    f.values.set(key, JSON.stringify(changed)); assert.throws(() => getSwarmWalletRecord(OWNER, { storage: f.storage }), field);
  }
});
test('finalized journals cannot be downgraded or replaced and cancellation proofs reject storage mutation', async () => {
  for (const status of ['CONFIRMED', 'REVERTED', 'CANCELLED']) {
    const f = fixture(), r = await f.prepare(deposit()); await f.submit(r);
    if (status === 'CANCELLED') cancel(f);
    f.mine(r, { status: status === 'REVERTED' ? '0x0' : '0x1', cancelled: status === 'CANCELLED' });
    const result = await f.recover(status === 'CANCELLED' ? REPLACEMENT_HASH : undefined);
    assert.equal(result.status, status); f.state.receipt = null;
    assert.deepEqual(await f.recover(), result);
    await assert.rejects(f.recover(status === 'CANCELLED' ? TX_HASH : REPLACEMENT_HASH), e => e.code === 'SWARM_WALLET_HASH_CHANGED');
    assert.deepEqual(getSwarmWalletRecord(OWNER, { storage: f.storage }), result);
    if (status === 'CANCELLED') {
      const [key, value] = [...f.values][0], changed = JSON.parse(value); changed.receipt.cancellation.nonce = '0x9';
      f.values.set(key, JSON.stringify(changed)); assert.throws(() => getSwarmWalletRecord(OWNER, { storage: f.storage }));
    }
  }
});
test('tampered or unreadable local journals fail closed, including spoofed confirmation proofs', async () => {
  const f = fixture(), r = await f.prepare(batch()); await f.submit(r); f.mine(r); await f.recover();
  const [key, saved] = [...f.values][0]; const parsed = JSON.parse(saved); parsed.receipt.events[0].data = word(1);
  f.values.set(key, JSON.stringify(parsed)); assert.throws(() => getSwarmWalletRecord(OWNER, { storage: f.storage }));
  f.values.set(key, '{'); await assert.rejects(f.submit(r)); assert.equal(f.state.sends, 1);
});

function splitProviderFixture() {
  const f = fixture({ created: false }), walletCalls = [], readCalls = [];
  const walletProvider = { request: args => {
    walletCalls.push(args.method);
    assert.ok(['eth_accounts', 'eth_chainId', 'eth_getTransactionCount', 'eth_sendTransaction'].includes(args.method), 'No chain-state reads through the wallet');
    return f.provider.request(args);
  } };
  const readProvider = { request: args => {
    readCalls.push(args.method);
    assert.ok(!['eth_accounts', 'eth_getTransactionCount', 'eth_sendTransaction'].includes(args.method), 'No wallet authority on read transport');
    return f.provider.request(args);
  } };
  return { ...f, walletProvider, readProvider, walletCalls, readCalls };
}

test('creation check, review, explicit submit and recovery work with a wallet that restricts chain reads', async () => {
  const f = splitProviderFixture();
  const options = { ...f.options, readProvider: f.readProvider };
  const state = await readSwarmWallet(f.walletProvider, { owner: OWNER, ...options });
  assert.equal(state.created, false);
  const review = await prepareSwarmWallet(f.walletProvider, { owner: OWNER, action: { kind: 'CREATE' }, ...options });
  assert.equal(f.state.sends, 0);
  await submitSwarmWallet(f.walletProvider, review, options);
  assert.equal(f.state.sends, 1);
  f.mine(review);
  const recovered = await recoverSwarmWallet(f.walletProvider, OWNER, options);
  assert.equal(recovered.status, 'CONFIRMED'); assert.equal(f.state.sends, 1);
  assert.ok(f.readCalls.includes('eth_getCode')); assert.ok(f.readCalls.includes('eth_estimateGas'));
});

test('public reader does not override wrong wallet chain, changed owner, pending nonce or mismatched chain', async () => {
  for (const fault of ['chain', 'owner', 'pending', 'reader-chain']) {
    const f = splitProviderFixture();
    if (fault === 'chain') f.state.chain = '0x1';
    if (fault === 'owner') f.state.owner = OTHER;
    if (fault === 'pending') f.state.pendingNonce = 9n;
    if (fault === 'reader-chain') f.readProvider.request = args => args.method === 'eth_chainId' ? '0x1' : f.provider.request(args);
    await assert.rejects(prepareSwarmWallet(f.walletProvider, { owner: OWNER, release: f.release, action: { kind: 'CREATE' }, readProvider: f.readProvider }));
    assert.equal(f.state.sends, 0); assert.equal(f.values.size, 0);
  }
});

test('public read outage fails without falling back to a stale wallet response or creating a journal', async () => {
  const f = splitProviderFixture();
  f.readProvider.request = async () => { throw Error('private-rpc-key'); };
  await assert.rejects(prepareSwarmWallet(f.walletProvider, { owner: OWNER, release: f.release, action: { kind: 'CREATE' }, readProvider: f.readProvider }), { code: 'SWARM_WALLET_READ_UNAVAILABLE' });
  assert.equal(f.state.sends, 0); assert.equal(f.values.size, 0);
  assert.ok(f.walletCalls.every(method => ['eth_chainId', 'eth_accounts', 'eth_getTransactionCount'].includes(method)));
});

test('reviewed fee allowance tolerates a small base-fee move but confirmation never increases its cap', async () => {
  const f = fixture({ created: false }), r = await f.prepare({ kind: 'CREATE' });
  assert.equal(BigInt(r.transaction.gasPrice), 1_200_000n);
  assert.equal(BigInt(r.maximumNetworkFeeWei), BigInt(r.transaction.gas) * 1_200_000n);
  f.state.gasPrice = 1_100_000n;
  await f.submit(r); assert.equal(f.state.sends, 1);
  assert.equal(f.state.tx.gasPrice, r.transaction.gasPrice);
  const beyond = fixture({ created: false }), limited = await beyond.prepare({ kind: 'CREATE' });
  beyond.state.gasPrice = 1_200_001n;
  await assert.rejects(beyond.submit(limited), { code: 'SWARM_WALLET_FEE_CHANGED' });
  assert.equal(beyond.state.sends, 0); assert.equal(beyond.values.size, 0);
});
