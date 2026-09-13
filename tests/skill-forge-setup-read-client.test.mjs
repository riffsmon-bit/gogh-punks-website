import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSetupRead } from '../scripts/dev/skill-forge/setup-read-client.mjs';

const query = { method: 'eth_getCode', params: ['0x' + '1'.repeat(40), '0x100'] };
test('setup reads recover transient rate limits and state propagation on the same request', async () => {
  for (const error of [Object.assign(Error('limited'), { status: 429 }),
    Object.assign(Error('metadata is not found, 100'), { code: -32000 }),
    Object.assign(Error('timeout'), { name: 'TimeoutError' })]) {
    const calls = [], delays = [];
    const result = await requestSetupRead(async args => {
      calls.push(args); if (calls.length < 3) throw error; return '0x1234';
    }, query, { sleep: async ms => delays.push(ms) });
    assert.equal(result, '0x1234');
    assert.deepEqual(calls, [query, query, query]);
    assert.deepEqual(delays, [300, 600]);
  }
});

test('setup read retries stop after three failures and do not retry a revert or invalid parameters', async () => {
  for (const [error, expectedCalls] of [[Object.assign(Error('limited'), { status: 429 }), 3],
    [Object.assign(Error('execution reverted'), { code: -32000 }), 1],
    [Object.assign(Error('invalid parameters'), { code: -32602 }), 1]]) {
    let calls = 0;
    await assert.rejects(requestSetupRead(async () => { calls++; throw error; }, query,
      { sleep: async () => {} }), value => value === error);
    assert.equal(calls, expectedCalls);
  }
});

test('setup transport refuses every transaction and signing method before calling the provider', async () => {
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'wallet_sendCalls']) {
    await assert.rejects(requestSetupRead(() => { throw Error('PROVIDER_MUST_NOT_BE_CALLED'); },
      { method, params: [] }), /SETUP_RPC_READ_ONLY/);
  }
});
