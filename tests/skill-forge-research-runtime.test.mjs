import test from 'node:test';
import assert from 'node:assert/strict';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { SKILL_CAPABILITIES, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';

const owner = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`, contract = `0x${'3'.repeat(40)}`;
const hash = `0x${'4'.repeat(64)}`;
const zero = `0x${'0'.repeat(64)}`;
const client = {
  getChainId: async () => 4663,
  getBlock: async () => ({ number: 1n, hash }), getCode: async () => '0x60016000', getStorageAt: async () => zero,
  readContract: async ({ functionName, args }) => functionName === 'supportsInterface' ? true
    : `data:application/json;base64,${Buffer.from(JSON.stringify({ attributes: [{ trait_type: 'Color', value: args[0] === 1n ? 'Blue' : 'Red' }] })).toString('base64')}`,
};
function state(packages) {
  return { tokenId: '93', chainId: 4663, owner, blockHash: hash, blockTime: Date.now(), slots: 3, mask: '13', equipped: packages.map((p, slot) => ({ key: skillKey(p.manifest.skillId, p.manifest.version), level: 1, slot, available: true,
    definition: { status: 4, disabled: false, deprecated: false, manifestHash: p.manifestHash, instructionHash: p.instructionHash, capabilities: String(SKILL_CAPABILITIES[p.manifest.capabilities[0]]) } })) };
}
test('actual research packages are implementation-hashed and remain unapproved TESTING', async () => {
  const catalog = await loadResearchSkillCatalog();
  assert.equal(catalog.length, 3);
  assert.ok(catalog.every(p => p.status === 'TESTING' && !p.approved && p.manifest.walletAuthority === 'NONE' && p.instructions.length > 100));
  const runtime = createResearchSkillRuntime({ readState: async () => state(catalog), packages: catalog, client });
  assert.deepEqual((await runtime.resolve({ tokenId: '93', owner })).effectiveMcpTools, []);
  await assert.rejects(runtime.call({ tokenId: '93', owner, name: 'inspect_contract', arguments: { contract } }), /SKILL_TOOL_DENIED/);
});
test('fixture approval exercises real read implementations through equipment/owner gates', async () => {
  // Approval exists only in this test. No registry or production catalog is promoted.
  const packages = (await loadResearchSkillCatalog()).map(p => ({ ...p, approved: true, status: 'READY' }));
  let current = state(packages), fetches = 0;
  const runtime = createResearchSkillRuntime({ readState: async () => ({ ...current, blockTime: Date.now() }), packages, client, apiKey: 'TEST_ONLY', fetchImpl: async url => {
    fetches++;
    return new Response(JSON.stringify(url.includes('/collections/') ? { name: 'Fixture', contracts: [{ chain: 'robinhood', address: contract }] }
      : { listings: [{ chain: 'robinhood', order_hash: hash, price: { current: { value: '1', decimals: 18, currency: 'ETH' } }, protocol_data: { forbidden: true } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const context = await runtime.resolve({ tokenId: '93', owner });
  assert.equal(context.instructionPackages.length, 3);
  assert.equal(context.walletAuthority, 'NONE');
  assert.ok(!context.effectiveMcpTools.includes('prepare_mint'));
  const call = (name, args) => runtime.call({ tokenId: '93', owner, name, arguments: args });
  assert.equal((await call('inspect_contract', { contract })).securityVerdict, 'NOT_A_SECURITY_CLEARANCE');
  assert.equal((await call('rank_trait_sample', { contract, tokenIds: ['1', '2'] })).sampleSize, 2);
  const listings = await call('get_market_listings', { slug: 'fixture', contract });
  assert.equal(listings.listings.length, 1); assert.equal(listings.executable, false); assert.equal(fetches, 2);
  await assert.rejects(call('inspect_contract', { contract, calldata: '0x1234' }), /INVALID_RESEARCH_ARGUMENTS/);
  current = { ...current, owner: other };
  await assert.rejects(call('inspect_contract', { contract }), /OWNER_CHANGED/);
  current = { ...state(packages), equipped: [] };
  await assert.rejects(call('inspect_contract', { contract }), /SKILL_TOOL_DENIED/);
  current = state(packages); current.equipped[0].available = false;
  await assert.rejects(call('inspect_contract', { contract }), /SKILL_TOOL_DENIED/);
});
