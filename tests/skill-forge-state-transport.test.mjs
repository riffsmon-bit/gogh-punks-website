import test from 'node:test';
import assert from 'node:assert/strict';
import { pacedStateTransport } from '../scripts/dev/skill-forge/finalized-state-clients.mjs';

const call = { method: 'eth_call', params: [{ to: `0x${'1'.repeat(40)}`, data: '0x1234' }, '0x123'] };
test('state reads serialize and retain the exact historical block through throttling retries', async () => {
  const requests = [], delays = [], entered = Promise.withResolvers(), release = Promise.withResolvers();
  const transport = pacedStateTransport('TEST', { wait: async ms => { delays.push(ms); },
    transportFactory: () => () => ({ request: async request => {
      requests.push(request);
      if (requests.length === 1) { entered.resolve(); await release.promise; throw Object.assign(Error('THROTTLED'), { cause: { code: 15 } }); }
      return '0x01';
    } }),
  })({});
  const first = transport.request(call); await entered.promise;
  const second = transport.request({ method: 'eth_getCode', params: [call.params[0].to, '0x123'] });
  assert.equal(requests.length, 1); release.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['0x01', '0x01']);
  assert.deepEqual(requests.slice(0, 2), [call, call]);
  assert.equal(requests[2].params[1], '0x123'); assert.ok(delays.includes(2000));
});
test('persistent throttling is bounded and unrelated failures do not retry', async () => {
  for (const code of [15, -32000]) {
    let count = 0;
    const transport = pacedStateTransport('TEST', { wait: async () => {},
      transportFactory: () => () => ({ request: async () => { count++; throw Object.assign(Error('UNAVAILABLE'), { code }); } }),
    })({});
    await assert.rejects(transport.request(call), /UNAVAILABLE/);
    assert.equal(count, code === 15 ? 3 : 1);
  }
});
test('the state transport rejects signing, submission and unrelated methods before a request', async () => {
  const transport = pacedStateTransport('TEST', { transportFactory: () => () => ({ request() { throw Error('MUST_NOT_RUN'); } }) })({});
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_getLogs'])
    await assert.rejects(transport.request({ method, params: [] }), /FORGE_STATE_READ_ONLY/);
});
