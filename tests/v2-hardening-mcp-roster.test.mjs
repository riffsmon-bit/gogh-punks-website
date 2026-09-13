import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { readV2McpRoster } from '../netlify/functions/_shared/v2-mcp-roster.mjs';
import registryCode from './fixtures/market-mcp/registry-code.json' with { type: 'json' };
import { ROBINHOOD } from '../broker/src/config.mjs';

const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, HASH = `0x${'a'.repeat(64)}`;
const AGGREGATE = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const account = id => `0x${BigInt(10_000 + Number(id)).toString(16).padStart(40, '0')}`;
const word = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const addr = a => `0x${a.slice(2).padStart(64, '0')}`;
const delay = n => new Promise(resolve => setTimeout(resolve, n));
function fixture({ owned = ['93', '235', '5016'], hints = ['93', '44'], latency = 0 } = {}) {
  const calls = [], controls = { brokenAccount: false, badCode: false, reorg: false,
    wrongChain: false, switchChain: false, mismatch: false, badRpc: false };
  let inflight = 0, peak = 0, blocks = 0, chains = 0;
  const client = { request: async args => {
    calls.push(args); inflight++; peak = Math.max(peak, inflight);
    try {
      if (latency) await delay(latency);
      if (controls.badRpc) throw Error('SECRET_PROVIDER_URL_AND_KEY');
      if (args.method === 'eth_chainId') return controls.wrongChain || (controls.switchChain && chains++) ? '0x1' : '0x1237';
      if (args.method === 'eth_blockNumber') return '0x64';
      if (args.method === 'eth_getBlockByNumber') return { number: '0x64', hash: controls.reorg && blocks++ ? `0x${'b'.repeat(64)}` : HASH };
      if (args.method === 'eth_getCode') return controls.badCode ? '0x6000' : registryCode.code;
      assert.equal(args.method, 'eth_call');
      assert.equal(args.params[1], '0x64', 'every contract read uses one pinned block');
      const { to, data } = args.params[0];
      if (to === ROBINHOOD.canonicalCollection) {
        if (data.startsWith('0x70a08231')) return word(owned.length + (controls.mismatch ? 1 : 0));
        if (data === '0xd5abeb01') return word(5016);
        assert.fail('unexpected collection call');
      }
      const decoded = decodeFunctionData({ abi: AGGREGATE, data }).args[0];
      assert.ok(decoded.length <= 200);
      return encodeFunctionResult({ abi: AGGREGATE, functionName: 'aggregate3', result: decoded.map(call => {
        const id = BigInt(`0x${call.callData.slice(10)}`).toString();
        if (call.callData.startsWith('0x6352211e')) {
          assert.equal(call.target.toLowerCase(), ROBINHOOD.canonicalCollection);
          return { success: true, returnData: addr(owned.includes(id) ? OWNER : OTHER) };
        }
        assert.equal(call.target.toLowerCase(), registryCode.address.toLowerCase());
        assert.equal(call.allowFailure, false);
        return { success: !controls.brokenAccount, returnData: addr(account(id)) };
      }) });
    } finally { inflight--; }
  } };
  const pool = { query: async (sql, values) => {
    assert.match(sql, /LIMIT 5017/); assert.deepEqual(values, [4663, ROBINHOOD.canonicalCollection, OWNER]);
    return { rows: hints.map(token_id => ({ token_id, account_address: OTHER })) };
  } };
  return { client, pool, calls, controls, peak: () => peak };
}

test('MCP live roster discovers nonindexed and high IDs, drops stale hints and batches wallet resolution', async () => {
  const f = fixture({ latency: 1 }), result = await readV2McpRoster(OWNER, f);
  assert.deepEqual(result.punks, ['93', '235', '5016'].map(id => ({ tokenId: id, punkWallet: account(id), ownershipBlock: '100' })));
  assert.equal(result.indexIsAuthority, false);
  assert.deepEqual(result.coverage, { status: 'COMPLETE_AT_BLOCK', blockNumber: '100', blockHash: HASH,
    verifiedCount: 3, scope: 'ORIGINAL_GOGH_COLLECTION' });
  assert.equal(f.peak(), 4);
  assert.equal(f.calls.filter(c => c.method === 'eth_getCode').length, 1, 'one global registry check, no per-Punk profiles');
  assert.ok(f.calls.length < 40, 'a complete 5017 ID scan does not become thousands of profile calls');
  assert.ok(f.calls.every(c => !/send|sign|Balance|Logs/.test(c.method)));
});

test('all current indexed hints avoid full scan, while ownership remains live evidence', async () => {
  const f = fixture({ owned: ['93', '235'], hints: ['93', '235', '235', '0093', '9999'] });
  const result = await readV2McpRoster(OWNER, f);
  assert.equal(result.punks.length, 2);
  assert.ok(!f.calls.some(c => c.params?.[0]?.data === '0xd5abeb01'));
  assert.equal(f.calls.filter(c => c.method === 'eth_call').length, 3);
});

test('more than 256 current holdings are retained and registry queries remain four-way bounded', async () => {
  const owned = Array.from({ length: 450 }, (_, i) => String(i + 1));
  const f = fixture({ owned, hints: owned, latency: 1 });
  const result = await readV2McpRoster(OWNER, f);
  assert.equal(result.punks.length, 450); assert.ok(f.peak() <= 4);
  assert.ok(f.calls.length < 20);
});

test('zero balance returns a reconciled empty roster without registry/profile lookups', async () => {
  const f = fixture({ owned: [] }), result = await readV2McpRoster(OWNER, f);
  assert.deepEqual(result.punks, []); assert.equal(result.coverage.verifiedCount, 0);
  assert.ok(!f.calls.some(c => c.method === 'eth_getCode'));
});

for (const failure of ['brokenAccount', 'badCode', 'reorg', 'wrongChain', 'switchChain', 'mismatch', 'badRpc']) {
  test(`MCP ${failure} fails closed without falsely complete or empty results`, async () => {
    const f = fixture(); f.controls[failure] = true;
    await assert.rejects(readV2McpRoster(OWNER, f), error => error.code === 'PUNK_ROSTER_UNAVAILABLE'
      && !error.message.includes('SECRET'));
  });
}

test('unavailable or slow index falls back to live discovery under a bounded hints deadline', async () => {
  for (const query of [async () => { throw Error('DB_DOWN'); }, () => new Promise(() => {})]) {
    const f = fixture(); f.pool = { query };
    const result = await readV2McpRoster(OWNER, { ...f, hintsTimeoutMs: 5 });
    assert.equal(result.coverage.verifiedCount, 3);
  }
});

test('stalled provider obeys one response deadline and schedules no later reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_789_320_000_000 });
  let calls = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const client = { request: () => { calls++; started(); return new Promise(() => {}); } };
  const rejected = assert.rejects(readV2McpRoster(OWNER, { client, timeoutMs: 25, callTimeoutMs: 10 }), /fully verified/);
  await ready; t.mock.timers.tick(10); await rejected;
  t.mock.timers.tick(30); assert.equal(calls, 1);
});

test('roster rejects unsafe owners and configurable bounds cannot exceed the fixed request budget', async () => {
  for (const owner of ['', 'bad', `0x${'0'.repeat(40)}`]) await assert.rejects(readV2McpRoster(owner), /fully verified/);
  await assert.rejects(readV2McpRoster(OWNER, { timeoutMs: 12_001 }), /fully verified/);
});
