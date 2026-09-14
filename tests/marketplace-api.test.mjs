import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketplace } from '../netlify/functions/broker-v2-marketplace.mjs';
import { marketplaceFixture, address } from './fixtures/marketplace-durable.mjs';

const f = marketplaceFixture();
const url = 'https://goghpunks.xyz/api/v2/punks/93/marketplace';
const request = (body, suffix = '') => new Request(url + suffix, { method: 'POST',
  headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) });
function config() {
  const calls = []; const coordinator = Object.fromEntries(['get', 'prepare', 'claim', 'cancel', 'decline', 'recover'].map(operation => [operation, async input => {
    calls.push({ operation, input }); return { owner: input.owner, punkId: input.punkId, transaction: null };
  }]));
  return { calls, runtimeFactory: async () => ({ coordinator }), sessionPool: () => ({}),
    sessionReader: async () => ({ walletAddress: f.owner.toUpperCase().replace('0X', '0x') }), originCheck: () => {} };
}
test('HTTP session alone derives owner; strict route derives selected Punk', async () => {
  const c = config(), response = await handleMarketplace(request({ operation: 'prepare', input: f.input }), c);
  assert.equal(response.status, 200); assert.equal(c.calls[0].input.owner, f.owner); assert.equal(c.calls[0].input.punkId, '93');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('default authenticated production response is blocked with no transaction', async () => {
  const c = config(); delete c.runtimeFactory;
  const response = await handleMarketplace(new Request(url), c), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.availability, 'RELEASE_BLOCKED');
  assert.equal(body.transaction, null); assert.equal(body.owner, f.owner); assert.equal(body.walletClaimed, false);
});
test('all HTTP authority/endpoint/review injections fail before runtime', async () => {
  for (const field of ['owner', 'punkId', 'walletRole', 'rpcUrl', 'review', 'calldata', 'policyEvidence', 'purchaseGuardDeployment']) {
    const c = config();
    assert.equal((await handleMarketplace(request({ operation: 'prepare', input: f.input, [field]: address('9') }), c)).status, 400);
    assert.equal((await handleMarketplace(request({ operation: 'prepare', input: { ...f.input, [field]: address('9') } }), c)).status, 400);
    assert.equal(c.calls.length, 0);
  }
});
test('missing CAS, arbitrary operations, unexpected queries and oversize bodies are rejected', async () => {
  const c = config();
  for (const body of [{ operation: 'claim', intentId: 'a'.repeat(64) }, { operation: 'sendTransaction' }, { operation: 'recover', review: {} }]) {
    assert.equal((await handleMarketplace(request(body), c)).status, 400);
  }
  assert.equal((await handleMarketplace(request({ operation: 'prepare', input: f.input }, '?rpcUrl=evil'), c)).status, 400);
  assert.equal((await handleMarketplace(new Request(`${url}?intentId=a&intentId=b`), c)).status, 400);
  assert.equal((await handleMarketplace(request({ operation: 'prepare', input: { ...f.input, extra: 'x'.repeat(5000) } }), c)).status, 413);
  assert.equal(c.calls.length, 0);
});
test('authentication and origin failures never invoke the runtime', async () => {
  let runtimeCalls = 0;
  const c = { ...config(), runtimeFactory: async () => { runtimeCalls++; throw Error('UNREACHABLE'); } };
  await handleMarketplace(request({ operation: 'prepare', input: f.input }), { ...c, originCheck: () => { throw Error('ORIGIN'); } });
  await handleMarketplace(new Request(url), { ...c, sessionReader: async () => { throw Error('SESSION'); } });
  assert.equal(runtimeCalls, 0);
});
