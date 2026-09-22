import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { checkReleaseChain } from '../broker/src/v4/operations/release-readiness.mjs';
import { handleReleaseCheck } from '../netlify/functions/broker-v2-release-check.mjs';

const HASH = `0x${'a'.repeat(64)}`, HISTORICAL_HASH = `0x${'b'.repeat(64)}`;
const OWNER = `0x${'1'.repeat(40)}`, COLLECTION = `0x${'2'.repeat(40)}`, REGISTRY = `0x${'3'.repeat(40)}`;
const CODE = '0x60006000', PROGRESSION = `0x${'4'.repeat(40)}`, CLOCK = 1_789_000_000_000;
const previousSiteUrl = process.env.SITE_URL;
process.env.SITE_URL = 'https://goghpunks.xyz';
after(() => { if (previousSiteUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSiteUrl; });
const log = { removed: false, address: COLLECTION, blockHash: HISTORICAL_HASH, transactionHash: HASH,
  data: '0x', topics: [HASH, HASH, HASH] };
const history = { anchor: { number: '50', hash: HISTORICAL_HASH }, sourceTokenId: '1753',
  positiveControl: { from: '50', to: '50', logs: [log] } };
const release = { chainId: 4663, collection: COLLECTION, registry: REGISTRY, progression: PROGRESSION,
  registryCodeHash: keccak256(CODE), progressionCodeHash: keccak256(CODE) };
function fixture() {
  const calls = [];
  const clients = [0, 1].map(index => ({
    getChainId: async () => 4663,
    getBlock: async query => ({ number: query.blockNumber ?? 100n + BigInt(index),
      timestamp: BigInt(CLOCK / 1000), hash: query.blockNumber === 50n ? HISTORICAL_HASH : HASH }),
    readContract: async input => { calls.push(input); return OWNER; },
    request: async input => { calls.push(input); return [structuredClone(log)]; },
    getCode: async () => CODE,
  }));
  return { clients, calls, run: () => checkReleaseChain({ clients, history, release, now: () => CLOCK }) };
}
test('fixed production probe proves both histories, matching anchor and exact deployment without returning credentials', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.verified, true); assert.deepEqual(result.anchor, { number: '88', hash: HASH });
  assert.equal(result.providers.length, 2);
  assert.ok(result.providers.every(p => p.historicalStateVerified && p.positiveTransferControlVerified && p.deployedRuntimeVerified));
  assert.ok(f.calls.filter(c => c.functionName === 'ownerOf').every(c => c.blockNumber === 50n && c.args[0] === 1753n));
  assert.doesNotMatch(JSON.stringify(result), /historicalOwner|https:|postgres|PRIVATE/);
});
for (const failure of ['chain', 'oldHead', 'historical', 'owner', 'anchor', 'noLogs', 'removedLog', 'wrongLog', 'runtime', 'reorg']) {
  test(`release probe withholds success for ${failure}`, async () => {
    const f = fixture(), c = f.clients[1], getBlock = c.getBlock;
    if (failure === 'chain') c.getChainId = async () => 1;
    if (failure === 'owner') c.readContract = async () => `0x${'5'.repeat(40)}`;
    if (failure === 'runtime') c.getCode = async () => '0x';
    if (failure === 'noLogs') c.request = async () => [];
    if (failure === 'removedLog') c.request = async () => [{ ...log, removed: true }];
    if (failure === 'wrongLog') c.request = async () => [{ ...log, topics: [HASH] }];
    let reads = 0;
    c.getBlock = async input => {
      const value = await getBlock(input);
      if (failure === 'oldHead' && input.blockTag) value.timestamp -= 31n;
      if (failure === 'historical' && input.blockNumber === 50n) value.hash = HASH;
      if (failure === 'anchor' && input.blockNumber === 88n) value.hash = HISTORICAL_HASH;
      if (failure === 'reorg' && input.blockNumber === 88n && ++reads > 1) value.hash = HISTORICAL_HASH;
      return value;
    };
    await assert.rejects(f.run(), /RELEASE_CHAIN_CHECK_FAILED/);
  });
}
const TOKEN = 'fixture-release-token-'.repeat(3);
const request = (body, { token = TOKEN, origin = 'https://goghpunks.xyz', method = 'POST' } = {}) => new Request('https://goghpunks.xyz/api/v2/admin/release/check', {
  method, headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
function endpoint() {
  const calls = [], dependencies = { environment: { GOGH_V2_RELEASE_CHECK_TOKEN: TOKEN },
    clientsFactory: () => { calls.push('clients'); return []; }, releaseReader: () => release,
    chainCheck: async () => { calls.push('chain'); return { verified: true }; },
    trainingRuntime: async role => { calls.push(role); return { coordinator: { claim() { throw Error('NO_WRITES'); } } }; },
  };
  return { calls, dependencies, run: (body, options) => handleReleaseCheck(request(body, options), dependencies) };
}
test('operator connection route requires dedicated credential and origin before opening any client or DB', async () => {
  for (const options of [{ token: '' }, { token: 'other' }, { origin: 'https://evil.example' }, { method: 'GET' }]) {
    const f = endpoint(), r = await f.run({ action: 'chain' }, options);
    assert.ok([401, 403, 405].includes(r.status)); assert.deepEqual(f.calls, []);
  }
  const f = endpoint(); f.dependencies.environment = {};
  assert.notEqual((await f.run({ action: 'chain' })).status, 200); assert.deepEqual(f.calls, []);
});
test('operator input cannot choose RPCs, tokens, SQL or broaden the fixed actions', async () => {
  for (const body of [{ action: 'chain', rpcUrl: 'https://private.example' }, { action: 'training', sql: 'delete' },
    { action: 'chain', tokenId: '94' }, { action: 'send' }, {}, null, []]) {
    const f = endpoint(); assert.equal((await f.run(body)).status, 400); assert.deepEqual(f.calls, []);
  }
});
test('chain and restricted-role results are no-store and never invoke a mutation', async () => {
  for (const action of ['chain', 'training']) {
    const f = endpoint(), r = await f.run({ action });
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const result = await r.json(); assert.equal(result.transactionSubmitted, false); assert.equal(result.walletAuthority, 'NONE');
    assert.deepEqual(f.calls, action === 'chain' ? ['clients', 'chain'] : ['request', 'worker']);
  }
});
test('provider/DB failures expose neither exception secrets nor a false positive result', async () => {
  for (const action of ['chain', 'training']) {
    const f = endpoint();
    f.dependencies[action === 'chain' ? 'chainCheck' : 'trainingRuntime'] = async () => { throw Error('postgres://PRIVATE:SECRET@private'); };
    const r = await f.run({ action }); assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /PRIVATE|SECRET|postgres/);
  }
  const f = endpoint(); f.dependencies.chainCheck = async () => ({ verified: false });
  assert.equal((await f.run({ action: 'chain' })).status, 503);
});
