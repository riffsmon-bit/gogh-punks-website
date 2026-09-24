import test from 'node:test';
import assert from 'node:assert/strict';
import { CallExecutionError, HttpRequestError, RpcRequestError, ExecutionRevertedError } from 'viem';
import { requestSetupRead, readSetupAnchor } from '../scripts/dev/skill-forge/setup-read-client.mjs';

const query = { method: 'eth_getCode', params: ['0x' + '1'.repeat(40), '0x100'] };
const wrappedTransport = code => new CallExecutionError(new HttpRequestError({ url: 'https://example.invalid',
  cause: new TypeError('fetch failed', { cause: Object.assign(Error('transport failed'), { code }) }) }), {});

test('actual viem wrappers preserve bounded retries for explicit Node and Undici transport failures', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH']) {
    const error = wrappedTransport(code), calls = [], delays = [];
    const args = Object.freeze({ method: 'eth_call', params: Object.freeze([Object.freeze({ data: '0x60006000f3' }), 'latest']) });
    const result = await requestSetupRead(async received => {
      assert.equal(received, args); calls.push(received); if (calls.length < 3) throw error; return '0x6000';
    }, args, { sleep: async ms => delays.push(ms) });
    assert.equal(result, '0x6000', code); assert.equal(calls.length, 3, code); assert.deepEqual(delays, [300, 600], code);
  }
});

test('socket and timeout names retry only the original read and stop after three failures', async () => {
  for (const name of ['SocketError', 'SocketClosedError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError']) {
    const error = new HttpRequestError({ url: 'https://example.invalid', cause: Object.assign(Error('transport failed'), { name }) });
    let calls = 0; const delays = [];
    await assert.rejects(requestSetupRead(async received => { assert.equal(received, query); calls++; throw error; }, query,
      { sleep: async ms => delays.push(ms) }), value => value === error);
    assert.equal(calls, 3, name); assert.deepEqual(delays, [300, 600], name);
  }
});

test('HTTP authentication, request errors, unknown wrappers and contract reverts never retry', async () => {
  const errors = [
    ...[400, 401, 403, 404, 413].map(status => new HttpRequestError({ url: 'https://example.invalid', status, cause: wrappedTransport('ECONNRESET') })),
    ...[-32600, -32601, -32602, 3].map(code => new CallExecutionError(new RpcRequestError({ url: 'https://example.invalid',
      error: { code, message: 'request rejected', cause: wrappedTransport('ETIMEDOUT') } }), {})),
    new CallExecutionError(new ExecutionRevertedError({ cause: wrappedTransport('ECONNRESET') }), {}),
    new HttpRequestError({ url: 'https://example.invalid' }),
    wrappedTransport('UND_ERR_INVALID_ARG'), wrappedTransport('UND_ERR_REQ_CONTENT_LENGTH_MISMATCH'),
    Object.assign(Error('execution reverted'), { code: -32000 }),
    Error('SETUP_NONCE_CHANGED'), Error('SWARM_DEPENDENCY_CHANGED'), Error('SETUP_ANCHOR_REORG'),
  ];
  for (const error of errors) {
    let calls = 0;
    await assert.rejects(requestSetupRead(async () => { calls++; throw error; }, query,
      { sleep: async () => assert.fail('No delay for a permanent or unknown failure') }), value => value === error);
    assert.equal(calls, 1, error.name);
  }
});
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
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'eth_signTypedData_v4', 'personal_sign', 'wallet_sendCalls', 'eth_requestAccounts']) {
    let calls = 0;
    await assert.rejects(requestSetupRead(() => { calls++; throw wrappedTransport('ECONNRESET'); },
      { method, params: [] }, { sleep: async () => assert.fail('No signing retries') }), /SETUP_RPC_READ_ONLY/);
    assert.equal(calls, 0);
  }
});

test('setup selects the fresh head both providers have reached and rejects stale or missing heads', async () => {
  const lower = { number: 100n, timestamp: 1000n, hash: '0x' + '1'.repeat(64) };
  const higher = { number: 105n, timestamp: 1001n, hash: '0x' + '2'.repeat(64) };
  const clients = heads => heads.map(block => ({ getBlock: async () => block }));
  assert.equal(await readSetupAnchor(clients([higher, lower]), () => 1002000), lower);
  assert.equal(await readSetupAnchor(clients([lower, higher]), () => 1002000), lower);
  await assert.rejects(readSetupAnchor(clients([higher, lower]), () => 1030000), /LIVE_SETUP_STATE_STALE/);
  await assert.rejects(readSetupAnchor(clients([higher, null]), () => 1002000), /LIVE_SETUP_STATE_UNAVAILABLE/);
});
