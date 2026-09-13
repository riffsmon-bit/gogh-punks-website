import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256, parseAbi } from 'viem';
import { readV2PunkAuthority } from '../netlify/functions/_shared/v2-ownership.mjs';
import { buildNftWithdrawalGate } from '../netlify/functions/broker-nft-withdrawal-status.mjs';
import { brokerMigrationState, V1_SHUTDOWN_AT_MS, assertHostedExecutionEnabled,
  assertHostedFundingEnabled, assertV1RegistrationEnabled } from '../netlify/functions/_shared/broker-migration-state.mjs';
import { finalizeV1Retirement } from '../netlify/functions/_shared/v1-retirement-finalizer.mjs';
import { preflightPunkWalletFunds, submitPunkWalletFunds } from '../site/punk-wallet-funds.js';
import { preflightNftWithdrawal, submitNftWithdrawal } from '../site/nft-withdrawal.js';

// Deterministic injected providers only: no network, keys, contract deployment or broadcast.
const address = digit => `0x${digit.repeat(40)}`;
const ALICE = address('1'), BOB = address('2'), ACCOUNT = address('3'), NFT = address('4');
const COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const CODE = '0x6001600055';
const wordAddress = value => `0x${value.slice(2).padStart(64, '0')}`;
const EXECUTE = parseAbi(['function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)']);
const TRANSFER = parseAbi(['function safeTransferFrom(address from,address to,uint256 tokenId)']);
const EMPTY_RESULT = `0x${'20'.padStart(64, '0')}${'0'.repeat(64)}`;
function world() {
  const state = { owner: ALICE, connected: ALICE, calls: [], authorityReads: [] };
  state.client = {
    getBlockNumber: async () => 123n,
    readContract: async query => {
      state.authorityReads.push(query);
      const values = { ownerOf: state.owner, account: ACCOUNT, isAccountCreated: true };
      if (!Object.hasOwn(values, query.functionName)) throw Error('unexpected authority read');
      return values[query.functionName];
    },
    getCode: async () => CODE, getBalance: async () => 10n ** 16n,
  };
  state.authority = expectedOwner => readV2PunkAuthority('93', { expectedOwner, client: state.client });
  state.gate = async () => {
    const authority = await state.authority(state.connected);
    return buildNftWithdrawalGate('93', { readRecovery: async () => ({
      tokenId: authority.tokenId, account: authority.punkWallet, owner: authority.owner,
      created: authority.activated, accountRuntimeCodeHash: keccak256(CODE),
    }) });
  };
  state.provider = { request: async ({ method, params }) => {
    state.calls.push({ method, params });
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [state.connected];
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getBalance') return '0x2386f26fc10000';
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
    if (method === 'eth_call') {
      const tx = params[0];
      if (tx.to === COLLECTION) return wordAddress(state.owner);
      if (tx.to === ACCOUNT && tx.data === '0x8da5cb5b') return wordAddress(state.owner);
      if (tx.to === NFT && tx.data.startsWith('0x6352211e')) return wordAddress(ACCOUNT);
      if (tx.to === ACCOUNT && tx.data.startsWith('0x51945447')) return EMPTY_RESULT;
    }
    throw Error(`Unexpected offline wallet method ${method}`);
  } };
  state.sent = () => state.calls.filter(call => call.method === 'eth_sendTransaction');
  return state;
}

test('V2 authority and withdrawal review preserve wallet identity while changing the current owner', async () => {
  const w = world(), before = await w.authority(ALICE), oldGate = await w.gate();
  w.owner = BOB;
  await assert.rejects(w.authority(ALICE), { code: 'NOT_CURRENT_OWNER' });
  await assert.rejects(preflightPunkWalletFunds(w.provider, oldGate, '93', 'withdraw', '0.001'),
    { code: 'OWNER_MISMATCH' });
  w.connected = BOB;
  const after = await w.authority(BOB), freshGate = await w.gate();
  assert.equal(after.punkWallet, before.punkWallet);
  assert.equal(after.tokenId, before.tokenId);
  assert.equal(freshGate.bindings.destination, BOB);
  assert.ok(w.authorityReads.every(query => query.blockNumber === 123n));
  const reviewed = await preflightPunkWalletFunds(w.provider, freshGate, '93', 'withdraw', '0.001');
  const decoded = decodeFunctionData({ abi: EXECUTE, data: reviewed.transaction.data });
  assert.deepEqual(decoded.args, [BOB, 10n ** 15n, '0x', 0]);
  assert.equal(w.sent().length, 0);
});

for (const type of ['native', 'ERC721']) test(`${type} review cannot survive a transfer during wallet confirmation preparation`, async () => {
  const w = world(), gate = await w.gate();
  const initial = type === 'native'
    ? await preflightPunkWalletFunds(w.provider, gate, '93', 'withdraw', '0.001')
    : await preflightNftWithdrawal(w.provider, gate, '93', { collection: NFT, standard: 'ERC721', tokenId: '7', amount: '1' });
  w.owner = BOB;
  const submit = type === 'native' ? submitPunkWalletFunds : submitNftWithdrawal;
  await assert.rejects(submit(w.provider, initial, { loadGate: w.gate, isCurrent: () => true }),
    { code: 'NOT_CURRENT_OWNER' });
  w.connected = BOB;
  await assert.rejects(submit(w.provider, initial, { loadGate: w.gate, isCurrent: () => true }),
    { code: 'STATE_CHANGED' });
  assert.equal(w.sent().length, 0);
});

test('new owner gets a fresh NFT recovery review from the inherited wallet to their own address', async () => {
  const w = world(); w.owner = BOB; w.connected = BOB;
  const prepared = await preflightNftWithdrawal(w.provider, await w.gate(), '93', {
    collection: NFT, standard: 'ERC721', tokenId: '7', amount: '1',
  });
  const outer = decodeFunctionData({ abi: EXECUTE, data: prepared.transaction.data });
  assert.equal(outer.args[0], NFT);
  assert.deepEqual(decodeFunctionData({ abi: TRANSFER, data: outer.args[2] }).args, [ACCOUNT, BOB, 7n]);
  await submitNftWithdrawal(w.provider, prepared, { loadGate: w.gate, isCurrent: () => true });
  assert.equal(w.sent().length, 1);
  assert.deepEqual(w.sent()[0].params, [prepared.transaction]);
});

for (const pending of [0, 1]) test(`V1 retirement with ${pending} unresolved receipt preserves independent current-owner withdrawal`, async () => {
  const now = V1_SHUTDOWN_AT_MS + 1;
  const state = brokerMigrationState({}, { now });
  assert.equal(state.withdrawalsEnabled, true);
  assert.equal(state.hostedExecutionEnabled, false);
  for (const guard of [assertHostedExecutionEnabled, assertHostedFundingEnabled, assertV1RegistrationEnabled])
    assert.throws(() => guard({}, { now }));
  const noted = [];
  const result = await finalizeV1Retirement({ environment: {}, now,
    finalizeDatabase: async () => ({ state: 'V1_SHUTDOWN_EXECUTING', paidJobsReleased: 1 }),
    finalizeOperational: async () => ({ attemptsRequiringReconciliation: pending }),
    noteResult: async value => noted.push(value),
  });
  assert.equal(result.state, pending ? 'REQUIRES_RECEIPT_RECONCILIATION' : 'V1_RETIRED');
  assert.deepEqual(noted, [result.state]);
  const w = world(); w.owner = BOB; w.connected = BOB;
  const review = await preflightPunkWalletFunds(w.provider, await w.gate(), '93', 'withdraw', '0.001');
  await submitPunkWalletFunds(w.provider, review, { loadGate: w.gate, isCurrent: () => true });
  assert.equal(w.sent().length, 1);
  assert.equal(w.sent()[0].params[0].from, BOB);
});
