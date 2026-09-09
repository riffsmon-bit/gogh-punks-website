import test from 'node:test';
import assert from 'node:assert/strict';
import { handleForge } from '../netlify/functions/broker-v2-forge.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import { punkChatAction } from '../site/punk-chat-actions.js';
const owner = `0x${'1'.repeat(40)}`, wallet = `0x${'2'.repeat(40)}`;
const req = body => new Request('https://goghpunks.xyz/api/v2/punks/93/forge', body === undefined ? {} : {
  method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const deps = () => ({ pool: { query() { throw new Error('No database mutation allowed'); } },
  sessionReader: async () => ({ walletAddress: owner }), authorityReader: async (id, opts) => {
    assert.equal(id, '93'); assert.equal(opts.expectedOwner, owner); return { owner, punkWallet: wallet }; },
  environment: { GOGH_FORGE_TEST_OWNER: owner }, originCheck: () => {}, clientFactory: () => ({}),
  inspector: async () => ({ codeBytes: 12, walletAuthority: 'NONE' }) });
test('Forge exposes unknown progression as unknown and never grants live training', async () => {
  const r = await handleForge(req(), deps()); const d = await r.json(); assert.equal(r.status, 200);
  assert.equal(d.trainingCredits, null); assert.equal(d.unlockedSlots, null); assert.equal(d.learnedSkills, null);
  assert.equal(d.canBurn, false); assert.equal(d.canEquip, false); assert.equal(d.canLearn, false);
  assert.equal(d.productionReadyCount, 0); assert.equal(d.catalog.length, 13);
  assert.equal(d.catalog.filter(s => s.test).length, 3);
});
test('current owner can run a read-only test; authority is rechecked afterward', async () => {
  const d = deps(); let checks = 0; const read = d.authorityReader;
  d.authorityReader = (...args) => { checks++; return read(...args); };
  const r = await handleForge(req({ action: 'inspect_contract' }), d);
  assert.equal(r.status, 200); assert.equal(checks, 2); assert.equal((await r.json()).result.codeBytes, 12);
});
test('Forge rejects unsigned, former-owner, unapproved-owner and transferred-during-test requests', async () => {
  for (const failure of ['session', 'owner', 'canary', 'transfer']) {
    const d = deps(); let count = 0;
    if (failure === 'session') d.sessionReader = async () => { throw new PublicError(401, 'V2_SESSION_REQUIRED', 'Sign in'); };
    if (failure === 'owner') d.authorityReader = async () => { throw new PublicError(403, 'NOT_CURRENT_OWNER', 'Wrong owner'); };
    if (failure === 'canary') d.environment = {};
    if (failure === 'transfer') d.authorityReader = async () => { if (++count > 1) throw new PublicError(403, 'NOT_CURRENT_OWNER', 'Transferred'); return { owner, punkWallet: wallet }; };
    const r = await handleForge(req({ action: 'inspect_contract' }), d);
    assert.ok([401, 403].includes(r.status)); assert.equal((await r.json()).result, undefined);
  }
});
test('no arbitrary action, external URL, burn, learning, equipment or transaction input is accepted', async () => {
  for (const body of [{ action: 'burn' }, { action: 'learn' }, { action: 'equip' }, { action: 'eth_sendTransaction' },
    { action: 'inspect_contract', url: 'https://evil.example' }, { action: 'inspect_contract', privateKey: 'bad' }]) {
    assert.equal((await handleForge(req(body), deps())).status, 400);
  }
});
test('missing credentials and failed reads never produce successful sample results', async () => {
  assert.equal((await handleForge(req({ action: 'get_market_listings' }), deps())).status, 503);
  const d = deps(); d.inspector = async () => { throw new Error('secret provider failure'); };
  const r = await handleForge(req({ action: 'inspect_contract' }), d); assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /secret provider failure/);
});
test('rarity sample is bounded and must include selected Punk', async () => {
  for (const sampleTokenIds of [['1', '2', '3'], ['93', '93', '94'], ['93', '94'], ['93', '94', 'invalid']]) {
    assert.equal((await handleForge(req({ action: 'rank_trait_sample', sampleTokenIds }), deps())).status, 400);
  }
  const d = deps(); d.metadataReader = async () => ({ blockNumber: '123', blockHash: 'block', metadataHash: 'hash',
    tokens: ['93', '94', '95'].map((tokenId, i) => ({ tokenId, attributes: [{ trait_type: 'Color', value: i === 0 ? 'red' : 'blue' }] })) });
  const r = await handleForge(req({ action: 'rank_trait_sample', sampleTokenIds: ['93', '94', '95'] }), d);
  const result = (await r.json()).result; assert.equal(r.status, 200); assert.equal(result.sampleSize, 3);
  assert.equal(result.coverage, 'SAMPLE_ONLY'); assert.equal(result.ranked[0].tokenId, '93');
});
test('Forge chat command navigates only; questions and negation do not recall an agent', () => {
  assert.deepEqual(punkChatAction('Open the Forge'), { kind: 'FORGE' });
  assert.deepEqual(punkChatAction('show my loadout'), { kind: 'FORGE' });
  assert.equal(punkChatAction("don't pause"), null); assert.equal(punkChatAction('what happens if I pause?'), null);
  assert.deepEqual(punkChatAction('Pause'), { kind: 'RECALL' });
});
test('cross-origin calls cannot reach a research provider', async () => {
  process.env.SITE_URL = 'https://goghpunks.xyz';
  const d = deps(); delete d.originCheck;
  const r = await handleForge(new Request('https://goghpunks.xyz/api/v2/punks/93/forge', {
    method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ action: 'inspect_contract' }),
  }), d);
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'ORIGIN_REJECTED');
});
