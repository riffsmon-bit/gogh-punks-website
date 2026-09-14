import test from 'node:test';
import assert from 'node:assert/strict';
import { handleForge } from '../netlify/functions/broker-v2-forge.mjs';
import deployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { createV2McpResearch } from '../netlify/functions/_shared/v2-mcp-research.mjs';
import { GoghArtBrokerMcpServer } from '../broker/src/v4/mcp/art-broker-mcp.mjs';
import { loadResearchSkillCatalog, createResearchSkillRuntime, PLANNED_RESEARCH_SELECTION } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey, SKILL_CAPABILITIES } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
const OWNER = `0x${'1'.repeat(40)}`, HASH = `0x${'a'.repeat(64)}`, ZERO = `0x${'0'.repeat(64)}`, GOGH = deployment.collection;
const packs = await loadResearchSkillCatalog({ selection: PLANNED_RESEARCH_SELECTION });
const manifest = { ...deployment, status: 'UNDEPLOYED', registry: null, registryCodeHash: null,
  progression: null, progressionCodeHash: null, trainingSource: null, trainingSourceCodeHash: null };
const pairs = [['research_collection', 'skill_research_collection', 'GOGH_COLLECTION_RESEARCH_V1'],
  ['research_project', 'skill_research_project', 'GOGH_PUBLIC_PROJECT_RESEARCH_V1'],
  ['classify_collection', 'skill_classify_collection', 'GOGH_DECLARED_ART_STYLE_MATCHES_V1'],
  ['rank_observed_listings', 'skill_rank_observed_listings', 'GOGH_OBSERVED_LISTING_RANKS_V1']];
function fixture() {
  const calls = [], client = { ccipRead: false, getChainId: async () => 4663,
    getBlock: async () => ({ number: 100n, hash: HASH }), getCode: async () => '0x6001600055', getStorageAt: async () => ZERO,
    readContract: async input => {
      calls.push(input); if (input.functionName === 'supportsInterface') return true;
      assert.equal(input.functionName, 'tokenURI');
      return `data:application/json;base64,${Buffer.from(JSON.stringify({ name: `Gogh #${input.args[0]}`,
        attributes: [{ trait_type: 'Style', value: 'Pixel Art' }] })).toString('base64')}`;
    } };
  const marketFetch = async url => Response.json(url.includes('/collections/')
    ? { collection: 'gogh-punks-255843210', name: 'Gogh Punks', description: 'Project-declared text', project_url: 'https://goghpunks.xyz', contracts: [{ chain: 'robinhood', address: GOGH }] } : { listings: [], next: null });
  return { calls, client, marketFetch };
}
function lab(f) {
  const deps = { manifest, pool: null, environment: { GOGH_FORGE_TEST_OWNER: OWNER, OPENSEA_API_KEY: 'LOCAL_FIXTURE_ONLY' },
    sessionReader: async () => ({ walletAddress: OWNER }), authorityReader: async () => ({ owner: OWNER, punkWallet: OWNER }),
    continuityReader: async () => {}, originCheck: () => {}, clientFactory: () => f.client,
    socialFactory: options => ({ researchProject: async args => {
      const { createSocialScoutV1 } = await import('../broker/src/v4/skill-forge/social-scout-v1.mjs');
      return createSocialScoutV1({ ...options, fetchImpl: f.marketFetch }).researchProject(args);
    } }),
    floorFactory: options => ({ rankObservedListings: async args => {
      const { createFloorHunterV1 } = await import('../broker/src/v4/skill-forge/floor-hunter-v1.mjs');
      return createFloorHunterV1({ ...options, fetchImpl: f.marketFetch }).rankObservedListings(args);
    } }) };
  const request = async body => handleForge(new Request('https://goghpunks.xyz/api/v2/punks/93/forge', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps);
  return { deps, request };
}
for (const [action, , schema] of pairs) test(`owner lab invokes the real ${action} adapter without granting a learned skill`, async () => {
  const f = fixture(), api = lab(f), response = await api.request({ action, ...(['research_collection','classify_collection'].includes(action) ? { sampleTokenIds: ['93', '94', '95'] } : {}) });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(); assert.equal(result.result.schema, schema); assert.equal(result.result.executable, false);
  assert.equal(result.mode, 'READ_ONLY_RESEARCH_LAB'); assert.equal(result.canLearn, false); assert.equal(result.canEquip, false);
  assert.equal(result.canBurn, false); assert.equal(result.result.contract.toLowerCase(), GOGH); assert.equal(result.walletAuthority, 'NONE');
});
test('new lab rejects injected targets, broad samples, unreviewed packages and lost ownership continuity', async () => {
  for (const extra of [{ contract: OWNER }, { rpcUrl: 'https://untrusted.example' }, { sampleTokenIds: ['93', '93', '94'] }, { sampleTokenIds: ['1', '2', '3'] }]) {
    const f = fixture(), api = lab(f);
    assert.equal((await api.request({ action: 'research_collection', sampleTokenIds: ['93', '94', '95'], ...extra })).status, 400);
    assert.equal(f.calls.length, 0);
  }
  for (const failure of ['package', 'continuity', 'owner']) {
    const f = fixture(), api = lab(f);
    if (failure === 'package') api.deps.plannedPackageLoader = async () => { throw Error('PRIVATE_PROVIDER_BODY'); };
    if (failure === 'continuity') api.deps.continuityReader = async () => { throw Error('PRIVATE_PROVIDER_BODY'); };
    if (failure === 'owner') api.deps.environment.GOGH_FORGE_TEST_OWNER = OWNER.replaceAll('1', '2');
    const result = await api.request({ action: 'research_collection', sampleTokenIds: ['93', '94', '95'] });
    assert.ok([403, 503].includes(result.status)); assert.doesNotMatch(await result.text(), /PRIVATE_PROVIDER_BODY|declaredTraits/);
  }
});

function mcpFixture() {
  const f = fixture();
  const release = { status: 'OWNER_CANARY', chainId: 4663, collection: GOGH, allowedOwners: [OWNER],
    skills: packs.map(p => ({ key: skillKey(p.manifest.skillId, 1), manifestHash: p.manifestHash, instructionHash: p.instructionHash })) };
  const mask = p => p.manifest.capabilities.reduce((n, name) => n | SKILL_CAPABILITIES[name], 0n);
  const state = { tokenId: '93', owner: OWNER, chainId: 4663, slots: packs.length, blockHash: HASH, blockTime: Date.now(),
    mask: packs.reduce((n, p) => n | mask(p), 0n).toString(), equipped: packs.map((p, slot) => ({
      slot, key: skillKey(p.manifest.skillId, 1), level: 1, available: true, definition: {
        status: 4, disabled: false, deprecated: false, capabilities: String(mask(p)), manifestHash: p.manifestHash, instructionHash: p.instructionHash } })) };
  const research = createV2McpResearch({ releaseReader: () => release, clientFactory: () => f.client,
    stateReader: async () => ({ nonce: '0', stateHash: HASH, anchor: { number: '100', hash: HASH } }), continuityReader: async () => {},
    progressionFactory: () => async () => ({ ...state, blockTime: Date.now() }), environment: { OPENSEA_API_KEY: 'LOCAL_FIXTURE_ONLY' },
    researchFactory: options => createResearchSkillRuntime({ ...options, fetchImpl: f.marketFetch }) });
  const server = new GoghArtBrokerMcpServer({ authenticate: async () => ({ owner: OWNER }),
    dependencies: { research, requireCurrentOwner: async id => assert.equal(id, '93') } });
  return { f, state, release, server };
}
for (const [action, name, schema] of pairs) test(`MCP ${name} uses exact released/equipped package and native adapter`, async () => {
  const { server, state } = mcpFixture(), args = { tokenId: '93', ...(['research_collection','classify_collection'].includes(action) ? { sampleTokenIds: ['93', '94', '95'] } : {}) };
  const tools = await server.listTools({ tokenId: '93' });
  assert.equal(tools.filter(t => t.name === name).length, 1);
  const output = await server.call({ name, arguments: args }); assert.equal(output.result.schema, schema); assert.equal(output.result.executable, false);
  for (const extra of [{ contract: OWNER }, { capabilities: ['MARKET_READ'] }, { owner: OWNER }, { calldata: '0x' }]) {
    await assert.rejects(server.call({ name, arguments: { ...args, ...extra } }), /invalid/i);
  }
  state.equipped = [];
  assert.ok(!(await server.listTools({ tokenId: '93' })).some(t => t.name === name));
  await assert.rejects(server.call({ name, arguments: args }), /SKILL_TOOL_DENIED/);
});
test('new MCP aliases cannot borrow Rarity Eye or Market Scout tool identities', async () => {
  const { server, release } = mcpFixture(); release.skills = [];
  for (const [, name] of pairs) assert.ok(!(await server.listTools({ tokenId: '93' })).some(t => t.name === name));
});
