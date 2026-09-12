import test from 'node:test';
import assert from 'node:assert/strict';
import { handleForge } from '../netlify/functions/broker-v2-forge.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import { punkChatAction } from '../site/punk-chat-actions.js';
import { keccak256 } from 'viem';
import deployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };

test('Forge chat navigation preserves recall negation and question handling', () => {
  assert.deepEqual(punkChatAction('Open the Forge'), { kind: 'FORGE' });
  assert.deepEqual(punkChatAction('show my loadout'), { kind: 'FORGE' });
  assert.equal(punkChatAction("don't pause"), null);
  assert.equal(punkChatAction('what happens if I pause?'), null);
  assert.deepEqual(punkChatAction('Pause'), { kind: 'RECALL' });
});
const owner = `0x${'1'.repeat(40)}`, wallet = `0x${'2'.repeat(40)}`;
const req = body => new Request('https://goghpunks.xyz/api/v2/punks/93/forge', body === undefined ? {} : {
  method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const deps = () => ({ pool: { query() { throw Error('No database mutation allowed'); } },
  manifest: { ...deployment, status: 'UNDEPLOYED', registry: null, registryCodeHash: null,
    progression: null, progressionCodeHash: null, trainingSource: null, trainingSourceCodeHash: null },
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
test('authenticated deployed profile returns verified credits and slots, and failed state reads return no profile', async () => {
  const d = deps(), code = Object.fromEntries(['collection', 'registry', 'progression', 'trainingSource']
    .map((role, index) => [deployment[role], `0x0${index + 1}`]));
  d.manifest = { ...deployment, ...Object.fromEntries(Object.entries(code).map(([address, bytes]) => {
    const role = ['collection', 'registry', 'progression', 'trainingSource'].find(role => deployment[role] === address);
    return [`${role}CodeHash`, keccak256(bytes)];
  })) };
  d.packageLoader = async () => [];
  const values = { collection: deployment.collection, registry: deployment.registry, ownerOf: owner,
    unlockedSlots: 1, effectiveCapabilities: 0n, equipped: `0x${'0'.repeat(64)}`,
    trainingSource: deployment.trainingSource, baseSlots: 1, slotCap: 7, trainingCredits: 0n,
    learnedCount: 0n, claimedStartingSlots: 0, allocationRoot: deployment.allocationRoot,
    snapshotHash: deployment.snapshotHash, allocationChainId: 4663n };
  const client = { getChainId: async () => 4663,
    getBlock: async () => ({ number: 100n, hash: `0x${'a'.repeat(64)}`, timestamp: BigInt(Math.floor(Date.now()/1000)) }),
    getCode: async ({address,blockNumber}) => { assert.equal(blockNumber,100n);return code[address.toLowerCase()]; },
    readContract: async ({functionName,blockNumber}) => { assert.equal(blockNumber,100n);assert.ok(Object.hasOwn(values,functionName));return values[functionName]; } };
  d.clientFactory = () => client;
  const response = await handleForge(req(), d), body = await response.json();
  assert.equal(response.status,200);assert.equal(body.profile.status,'VERIFIED_READ_ONLY');
  assert.equal(body.trainingCredits,'0');assert.equal(body.unlockedSlots,1);
  assert.deepEqual(body.learnedSkills,[]);assert.deepEqual(body.equippedSkills,[]);assert.equal(body.canBurn,false);
  client.getCode = async () => { throw Error('PROVIDER_UNAVAILABLE'); };
  const failed = await handleForge(req(), d);assert.equal(failed.status,503);assert.equal((await failed.json()).profile,undefined);
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
