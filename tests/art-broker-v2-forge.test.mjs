import test from 'node:test';
import assert from 'node:assert/strict';
import { handleForge } from '../netlify/functions/broker-v2-forge.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
const owner = `0x${'1'.repeat(40)}`, wallet = `0x${'2'.repeat(40)}`;
const req = body => new Request('https://goghpunks.xyz/api/v2/punks/93/forge', body === undefined ? {} : {
  method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const deps = () => ({ pool: { query() { throw Error('No database mutation allowed'); } },
  sessionReader: async () => ({ walletAddress: owner }), authorityReader: async (id, opts) => {
    assert.equal(id, '93'); assert.equal(opts.expectedOwner, owner); return { tokenId: id, owner, punkWallet: wallet }; },
  continuityReader: async before => { assert.equal(before.owner, owner); },
  environment: { GOGH_FORGE_TEST_OWNER: owner }, originCheck: () => {}, clientFactory: () => ({}),
  inspector: async () => ({ codeBytes: 12, walletAuthority: 'NONE' }) });
test('authenticated Forge read returns locked deployment and unknown progress, with no session or credit writes', async () => {
  const response = await handleForge(req(), deps()), d = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(d.profile.status, 'NOT_DEPLOYED'); assert.equal(d.trainingCredits, null); assert.equal(d.unlockedSlots, null);
  assert.equal(d.canBurn, false); assert.equal(d.canEquip, false); assert.equal(d.canLearn, false);
  assert.equal(d.productionReadyCount, 0); assert.equal(d.catalog.filter(s => s.test).length, 3);
});
test('research is a separate owner-canary diagnostic and rechecks transfer continuity before returning', async () => {
  const d = deps(); let checks = 0;
  d.continuityReader = async () => { checks++; };
  const r = await handleForge(req({ action: 'inspect_contract' }), d);
  assert.equal(r.status, 200); assert.equal(checks, 1); assert.equal((await r.json()).result.codeBytes, 12);
});
for (const failure of ['session', 'owner', 'canary', 'transfer', 'roundTrip', 'reorg']) {
  test(`Forge denies ${failure} without returning old-owner research`, async () => {
    const d = deps();
    if (failure === 'session') d.sessionReader = async () => { throw new PublicError(401, 'V2_SESSION_REQUIRED', 'Sign in'); };
    if (failure === 'owner') d.authorityReader = async () => { throw new PublicError(403, 'NOT_CURRENT_OWNER', 'Wrong owner'); };
    if (failure === 'canary') d.environment = {};
    if (['transfer', 'roundTrip', 'reorg'].includes(failure)) d.continuityReader = async () => { throw new PublicError(409, 'CHAT_AUTHORITY_CHANGED', 'Ownership changed'); };
    const r = await handleForge(req({ action: 'inspect_contract' }), d);
    assert.ok([401, 403, 409].includes(r.status)); assert.equal((await r.json()).result, undefined);
  });
}
test('no arbitrary action, external URL, burn, learning, equipment or transaction input is accepted', async () => {
  for (const body of [{ action: 'burn' }, { action: 'learn' }, { action: 'equip' }, { action: 'eth_sendTransaction' },
    { action: null }, { action: 'inspect_contract', url: 'https://evil.example' },
    { action: 'inspect_contract', sampleTokenIds: [] }, { action: 'inspect_contract', privateKey: 'bad' }]) {
    assert.equal((await handleForge(req(body), deps())).status, 400);
  }
});
test('missing credentials, invalid deployments and provider failures never become successful sample data', async () => {
  assert.equal((await handleForge(req({ action: 'get_market_listings' }), deps())).status, 503);
  const d = deps(); d.inspector = async () => { throw Error('secret provider failure'); };
  const r = await handleForge(req({ action: 'inspect_contract' }), d); assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /secret provider failure/);
  assert.equal((await handleForge(req(), { ...deps(), manifest: {} })).status, 503);
});
test('rarity samples are bounded, distinct and include the selected original token', async () => {
  for (const sampleTokenIds of [['1', '2', '3'], ['93', '93', '94'], ['93', '94'], ['93', '94', 'invalid']]) {
    assert.equal((await handleForge(req({ action: 'rank_trait_sample', sampleTokenIds }), deps())).status, 400);
  }
  const d = deps(); d.metadataReader = async () => ({ blockNumber: '123', blockHash: 'block', metadataHash: 'hash',
    tokens: ['93', '94', '95'].map((tokenId, i) => ({ tokenId, attributes: [{ trait_type: 'Color', value: i === 0 ? 'red' : 'blue' }] })) });
  const r = await handleForge(req({ action: 'rank_trait_sample', sampleTokenIds: ['93', '94', '95'] }), d);
  assert.equal(r.status, 200); const result = (await r.json()).result;
  assert.equal(result.coverage, 'SAMPLE_ONLY'); assert.equal(result.ranked[0].tokenId, '93');
});
test('cross-origin calls cannot reach research providers', async () => {
  process.env.SITE_URL = 'https://goghpunks.xyz';
  const d = deps(); delete d.originCheck;
  const r = await handleForge(new Request('https://goghpunks.xyz/api/v2/punks/93/forge', {
    method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ action: 'inspect_contract' }),
  }), d);
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'ORIGIN_REJECTED');
});
