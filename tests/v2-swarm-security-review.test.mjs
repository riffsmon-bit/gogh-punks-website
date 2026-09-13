import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeFunctionData, keccak256, parseAbi } from 'viem';
import { AGENT_RECOVERY_PINS as P, agentRecoveryProxyRuntime,
  buildAgentRecoveryTransaction, createAgentRecoveryController } from '../site/punk-agent-recovery.js';

// Reuse only the owner's published offline bytecode fixtures, never its test
// helpers or assertions. No network, wallet, credentials or broadcasts occur.
const source = readFileSync(new URL('./punk-agent-recovery.test.mjs', import.meta.url), 'utf8');
const compressed = JSON.parse(source.match(/^const COMPRESSED_RUNTIME = (\{[^\n]+\});$/m)[1]);
const runtime = Object.fromEntries(Object.entries(compressed).map(([name, bytes]) =>
  [name, `0x${inflateSync(Buffer.from(bytes, 'base64')).toString('hex')}`]));
assert.equal(keccak256(runtime.registry), P.registryHash);
assert.equal(keccak256(runtime.implementation), P.implementationHash);
const owner = `0x${'1'.repeat(40)}`, account = `0x${'3'.repeat(40)}`, asset = `0x${'4'.repeat(40)}`;
const salt = `0x${'0'.repeat(64)}`, blockHash = `0x${'a'.repeat(64)}`, txHash = `0x${'b'.repeat(64)}`;
const now = 1789308000000, key = `gogh:agent-recovery:4663:${owner}:93`;
const word = n => BigInt(n).toString(16).padStart(64, '0');
const addressWord = a => `0x${a.slice(2).padStart(64, '0')}`;
const intent = (amount = '100', action = 'NATIVE') => ({ schema: 'GOGH_AGENT_RECOVERY_INTENT_V1',
  tokenId: '93', action, amountWei: amount,
  assetContract: action === 'ERC721' ? asset : null, assetTokenId: action === 'ERC721' ? '7' : null });
function review(i) {
  return { schema: 'GOGH_AGENT_RECOVERY_REVIEW_V1', intent: i, owner, account, accountSalt: salt,
    accountRuntimeCodeHash: keccak256(agentRecoveryProxyRuntime('93', salt)),
    assetRuntimeCodeHash: i.assetContract ? keccak256('0x60006000') : null,
    anchor: { number: '1000', hash: blockHash, timestamp: String(now / 1000) }, expiresAt: now + 90_000,
    balances: { nativeWei: '10000', entryPointWei: '10000', assetUnits: i.assetContract ? '1' : '0', ownerNativeWei: '1000000000000000000' },
    session: { active: false, reserveWei: '0' }, maximumNetworkFeeWei: '120000000',
    transaction: { ...buildAgentRecoveryTransaction(i, owner, account), nonce: '0x7', gas: '0xea60', gasPrice: '0x7d0' } };
}
function fixture() {
  const values = new Map(), f = { sends: [], calls: [], rendered: [] };
  f.storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  let tail = Promise.resolve();
  const locks = { request: (_key, _options, callback) => {
    const pending = tail.then(callback); tail = pending.catch(() => {}); return pending;
  } };
  const provider = { request: async ({ method, params = [] }) => {
    f.calls.push({ method, params });
    if (method === 'eth_sendTransaction') { f.sends.push(params[0]); return txHash; }
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [owner];
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_gasPrice') return '0x3e8';
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method === 'eth_estimateGas') return '0xc350';
    if (method === 'eth_getCode') return params[0] === P.registry ? runtime.registry
      : params[0] === P.implementation ? runtime.implementation
        : params[0] === account ? agentRecoveryProxyRuntime('93', salt) : '0x60006000';
    if (method === 'eth_call') {
      const { to, data } = params[0];
      if (to === P.collection || data === '0x8da5cb5b') return addressWord(owner);
      if (to === P.registry) return data === '0x6c74921e' ? salt : addressWord(account);
      if (data === '0xb89d7299') return `0x${word(0)}`;
      if (data === '0x6753ffde') return `0x${word(0).repeat(15)}`;
      if (data === '0xfd5e81c7') return `0x${word(10000)}`;
      if (to === asset) return data.startsWith('0x6352211e') ? addressWord(account) : `0x${word(1)}`;
      return `0x${word(32)}${word(0)}`;
    }
    if (method === 'eth_getTransactionByHash') return f.transaction ?? null;
    if (method === 'eth_getTransactionReceipt') return f.receipt ?? null;
    if (method === 'eth_blockNumber') return '0x400';
    if (method === 'eth_getBlockByNumber') return { number: '0x3e8', hash: blockHash };
    throw new Error(`Unexpected mocked method ${method}`);
  } };
  f.controller = (onChange = () => {}) => createAgentRecoveryController({ provider, owner, tokenId: '93',
    storage: f.storage, locks, isCurrent: () => true, now: () => now, onChange,
    fetchFunction: async (_url, options) => ({ ok: true,
      json: async () => ({ ok: true, review: review(JSON.parse(options.body).intent) }) }) });
  f.save = state => f.storage.setItem(key, JSON.stringify(state));
  return f;
}

test('security: confirmation in one tab must reject a review replaced by another tab', async () => {
  const f = fixture(), displayed = [];
  const a = f.controller(state => displayed.push(state)), b = f.controller();
  await a.prepare(intent('100'));
  await b.cancelReview();
  await b.prepare(intent('900'));
  assert.equal(displayed.at(-1).review.intent.amountWei, '100');
  let failure;
  try { await a.submit({ expectedReview: displayed.at(-1).review }); } catch (error) { failure = error; }
  const decoded = f.sends.map(tx => decodeFunctionData({
    abi: parseAbi(['function execute(address,uint256,bytes,uint8) returns (bytes)']), data: tx.data }));
  assert.equal(f.sends.length, 0, `Tab A displayed 100 but submitted ${decoded[0]?.args[1]} wei`);
  assert.ok(failure, 'A stale displayed review must be rejected before the wallet request');
});

test('security characterization: event-confirmed NFT recovery does not prove updated custody', async () => {
  const f = fixture(), r = review(intent('1', 'ERC721'));
  f.save({ schema: 'GOGH_AGENT_RECOVERY_JOURNAL_V1', status: 'WALLET_REQUESTED', review: r, transactionHash: null, receipt: null });
  f.transaction = { ...r.transaction, hash: txHash, input: r.transaction.data };
  f.receipt = { status: '0x1', transactionHash: txHash, blockNumber: '0x3e8', blockHash, logs: [{
    address: asset, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      addressWord(account), addressWord(owner), `0x${word(7)}`], data: '0x' }] };
  assert.equal((await f.controller().recover(txHash)).status, 'CONFIRMED');
  assert.equal(f.calls.some(call => call.method === 'eth_call'), false,
    'Confirmation checks canonical transaction/event evidence but does not recheck ownerOf');
  assert.equal(f.sends.length, 0);
});

test('security characterization: an edited terminal journal can claim success without receipt evidence', () => {
  const f = fixture();
  f.save({ schema: 'GOGH_AGENT_RECOVERY_JOURNAL_V1', status: 'CONFIRMED', review: review(intent()), transactionHash: null, receipt: null });
  assert.equal(f.controller().getState().status, 'CONFIRMED');
  assert.equal(f.calls.length, 0);
});
