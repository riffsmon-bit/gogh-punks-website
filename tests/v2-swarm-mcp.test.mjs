import assert from 'node:assert/strict';
import test from 'node:test';
import { ART_BROKER_MCP_TOOLS, ART_BROKER_MCP_RESEARCH_TOOLS, FORBIDDEN_ART_BROKER_MCP_TOOLS,
  GoghArtBrokerMcpServer, handleArtBrokerMcpJsonRpc } from '../broker/src/v4/mcp/art-broker-mcp.mjs';
import { createV2McpResearch } from '../netlify/functions/_shared/v2-mcp-research.mjs';
import { handleV2Mcp, v2McpDependencies } from '../netlify/functions/broker-v2-mcp.mjs';
import { createSkillToolGate, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { loadResearchSkillCatalog } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import { ROBINHOOD } from '../broker/src/config.mjs';

const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, HASH = `0x${'a'.repeat(64)}`;
const catalog = await loadResearchSkillCatalog();
const names = tools => tools.map(tool => tool.name);
const rpc = (server, method, params) => handleArtBrokerMcpJsonRpc(server,
  { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }, 'local-session');

function fixture() {
  const calls = [], pack = catalog.find(value => value.slug === 'rarity-eye'), key = skillKey(4, 1);
  const release = { status: 'OWNER_CANARY', chainId: 4663, collection: ROBINHOOD.canonicalCollection,
    registry: OTHER, progression: OWNER, registryCodeHash: HASH, progressionCodeHash: HASH,
    allowedOwners: [OWNER], skills: [{ key, name: 'Rarity Eye', manifestHash: pack.manifestHash,
      instructionHash: pack.instructionHash }] };
  const state = { owner: OWNER, tokenId: '93', nonce: '1', stateHash: HASH, credits: '2', slots: 1,
    anchor: { number: '10', hash: HASH, timestamp: '100' }, equipped: [key],
    skills: [{ ...release.skills[0], level: 1, available: true }] };
  const progression = { tokenId: '93', owner: OWNER, chainId: 4663, collection: release.collection,
    blockHash: HASH, blockTime: Date.now(), slots: 1, mask: '8',
    equipped: [{ key, slot: 0, level: 1, available: true, definition: { status: 4, disabled: false,
      deprecated: false, manifestHash: pack.manifestHash, instructionHash: pack.instructionHash, capabilities: 8n } }] };
  const controls = { authenticated: true, duringTool: () => {}, continuity: () => {} };
  const options = { releaseReader: () => release, clientFactory: () => { calls.push('client'); return {}; },
    stateReader: async ({ owner, tokenId }) => {
      calls.push('state');
      if (owner !== state.owner || tokenId !== state.tokenId) throw Error('OWNER_CHANGED');
      return structuredClone(state);
    }, continuityReader: async () => { calls.push('continuity'); controls.continuity(); },
    packageLoader: async () => { calls.push('packages'); return catalog; }, environment: {},
    progressionFactory: () => async () => structuredClone(progression),
    researchFactory: options => {
      calls.push(['factory', options.packages]);
      return createSkillToolGate({ ...options, implementations: Object.fromEntries(
        names(ART_BROKER_MCP_RESEARCH_TOOLS).map(name => [name, async args => {
          calls.push(['tool', name, args]); controls.duringTool(); return { tool: name, verified: true };
        }])) });
    } };
  const research = createV2McpResearch(options);
  const server = new GoghArtBrokerMcpServer({ authenticate: async (_token, scope) => {
    calls.push(['auth', scope]); return controls.authenticated ? { owner: OWNER } : null;
  }, dependencies: { research, requireCurrentOwner: async (id, owner) => {
    calls.push(['owner', id]); if (id !== state.tokenId || owner !== state.owner) throw Error('OWNER_CHANGED');
  }, get_punk_balance: async () => ({ nativeBalanceWei: '12' }),
  get_punk_skills: async (tokenId, owner) => research.getSkills({ tokenId, owner }) } });
  return { calls, release, state, progression, controls, options, research, server };
}
const sample = { tokenId: '93', sampleTokenIds: ['93', '44', '119'] };
const rank = f => rpc(f.server, 'tools/call', { name: 'rank_trait_sample', arguments: sample });

test('unscoped discovery exposes only the baseline catalog and never accesses owner, packages or chain', async () => {
  const f = fixture();
  assert.equal(f.server.listTools(), ART_BROKER_MCP_TOOLS, 'legacy unscoped list stays synchronous');
  const result = await rpc(f.server, 'tools/list');
  assert.deepEqual(names(result.result.tools), names(ART_BROKER_MCP_TOOLS));
  assert.deepEqual(f.calls, []);
  for (const forbidden of [...FORBIDDEN_ART_BROKER_MCP_TOOLS, ...names(ART_BROKER_MCP_RESEARCH_TOOLS)]) {
    assert.ok(!names(result.result.tools).includes(forbidden));
  }
  assert.ok(names(result.result.tools).includes('get_punk_skills'));
  assert.doesNotMatch(JSON.stringify(result), /"scope"/);
});

test('selected list authenticates owner and exposes only real tools from equipped accepted packages', async () => {
  const f = fixture(), result = await rpc(f.server, 'tools/list', { tokenId: '93' });
  const exposed = names(result.result.tools);
  assert.deepEqual(exposed.filter(name => !names(ART_BROKER_MCP_TOOLS).includes(name)), ['get_metadata', 'rank_trait_sample']);
  assert.deepEqual(f.calls.slice(0, 2), [['auth', 'punk:read'], ['owner', '93']]);
  const accepted = f.calls.find(value => Array.isArray(value) && value[0] === 'factory')[1];
  assert.equal(accepted.length, 1); assert.equal(accepted[0].slug, 'rarity-eye');
  assert.equal(accepted[0].approved, true); assert.equal(accepted[0].status, 'READY');
  assert.ok(catalog.every(pack => !pack.approved && pack.status === 'TESTING'));
  assert.equal(f.calls.at(-1), 'continuity');
});

for (const condition of ['unauthenticated', 'otherToken', 'oldOwner', 'stale', 'continuity', 'stateChanged']) {
  test(`selected list withholds research for ${condition}`, async () => {
    const f = fixture(); let selected = '93';
    if (condition === 'unauthenticated') f.controls.authenticated = false;
    if (condition === 'otherToken') selected = '44';
    if (condition === 'oldOwner') f.state.owner = OTHER;
    if (condition === 'stale') f.progression.blockTime -= 60_000;
    if (condition === 'continuity') f.controls.continuity = () => { throw Error('PRIVATE_RPC_KEY'); };
    if (condition === 'stateChanged') f.options.researchFactory = () => {
      f.state.nonce = '2'; return { resolve: async () => ({ effectiveMcpTools: ['rank_trait_sample'] }) };
    };
    if (condition === 'stateChanged') {
      const research = createV2McpResearch(f.options);
      await assert.rejects(research.resolve({ tokenId: '93', owner: OWNER }), /CONTEXT_CHANGED/);
    } else {
      const response = await rpc(f.server, 'tools/list', { tokenId: selected });
      assert.ok(response.error); assert.doesNotMatch(JSON.stringify(response), /PRIVATE_RPC_KEY/);
      assert.equal(response.result, undefined);
    }
  });
}

for (const condition of ['unequipped', 'unlearned', 'disabled', 'maskRemoved', 'unacceptedVersion']) {
  test(`${condition} removes research exposure and denies invocation, while basic balance remains readable`, async () => {
    const f = fixture();
    assert.ok((await rpc(f.server, 'tools/list', { tokenId: '93' })).result);
    if (condition === 'unequipped') f.progression.equipped = [];
    if (condition === 'unlearned') f.progression.equipped[0].level = 0;
    if (condition === 'disabled') f.progression.equipped[0].definition.disabled = true;
    if (condition === 'maskRemoved') f.progression.mask = '0';
    if (condition === 'unacceptedVersion') f.release.skills[0].manifestHash = `0x${'b'.repeat(64)}`;
    const listed = await rpc(f.server, 'tools/list', { tokenId: '93' });
    assert.deepEqual(names(listed.result.tools), names(ART_BROKER_MCP_TOOLS));
    assert.ok((await rank(f)).error); assert.ok(!f.calls.some(value => value[0] === 'tool'));
    const balance = await rpc(f.server, 'tools/call', { name: 'get_punk_balance', arguments: { tokenId: '93' } });
    assert.deepEqual(balance.result.structuredContent, { nativeBalanceWei: '12' });
  });
}

test('a research call uses the fresh gate and fixed canonical collection/sample without wallet authority', async () => {
  const f = fixture(), result = await rank(f);
  assert.equal(result.result.structuredContent.mode, 'EQUIPPED_RESEARCH');
  assert.equal(result.result.structuredContent.walletAuthority, 'NONE');
  assert.equal(result.result.structuredContent.canBurn, false);
  assert.equal(result.result.structuredContent.requiresSeparateEconomicAuthorization, true);
  assert.deepEqual(f.calls.find(value => value[0] === 'tool'), ['tool', 'rank_trait_sample', {
    contract: ROBINHOOD.canonicalCollection, tokenIds: sample.sampleTokenIds, numericMode: 'categorical', tokenId: '93', owner: OWNER,
  }]);
});

test('metadata is a real Rarity Eye tool and uses the same bounded sample without external URLs', async () => {
  const f = fixture(), response = await rpc(f.server, 'tools/call', { name: 'get_metadata', arguments: sample });
  assert.ok(response.result);
  const args = f.calls.find(value => value[0] === 'tool')[2];
  assert.deepEqual(args.tokenIds, sample.sampleTokenIds); assert.equal(args.numericMode, undefined);
});

for (const condition of ['transfer', 'unequip', 'disable', 'roundTrip', 'nonce']) {
  test(`research result is withheld when ${condition} happens during the call`, async () => {
    const f = fixture();
    f.controls.duringTool = () => {
      if (condition === 'transfer') f.progression.owner = OTHER;
      if (condition === 'unequip') f.progression.equipped = [];
      if (condition === 'disable') f.progression.equipped[0].definition.disabled = true;
      if (condition === 'roundTrip') f.controls.continuity = () => { throw Error('ROUND_TRIP'); };
      if (condition === 'nonce') f.state.nonce = '2';
    };
    const response = await rank(f); assert.ok(response.error);
    assert.equal(response.result, undefined); assert.doesNotMatch(JSON.stringify(response), /"verified":true|ROUND_TRIP/);
  });
}

test('requests cannot inject capabilities, owner, target collection, raw calldata or an unbounded sample', async () => {
  for (const patch of [{ capabilities: ['RARITY_READ'] }, { owner: OWNER }, { contract: OTHER },
    { data: '0x1234' }, { sampleTokenIds: ['93', '44'] }, { sampleTokenIds: ['44', '119', '1'] },
    { sampleTokenIds: ['93', '44', '44'] }, { sampleTokenIds: ['93', '044', '119'] }]) {
    const f = fixture(), response = await rpc(f.server, 'tools/call', {
      name: 'rank_trait_sample', arguments: { ...sample, ...patch },
    });
    assert.ok(response.error); assert.ok(!f.calls.some(value => value[0] === 'tool'));
  }
  const f = fixture();
  assert.ok((await rpc(f.server, 'tools/list', { tokenId: '93', effectiveMcpTools: ['get_market_listings'] })).error);
  assert.equal(f.calls.length, 0);
  assert.ok((await rpc(f.server, 'tools/call', { name: 'send_arbitrary_transaction', arguments: {} })).error);
});

test('release unavailable does not claim zero skills or prevent basic owner reads', async () => {
  const f = fixture(); f.release.status = 'PAUSED';
  assert.deepEqual(names((await rpc(f.server, 'tools/list', { tokenId: '93' })).result.tools), names(ART_BROKER_MCP_TOOLS));
  const skills = await rpc(f.server, 'tools/call', { name: 'get_punk_skills', arguments: { tokenId: '93' } });
  assert.equal(skills.result.structuredContent.status, 'UNAVAILABLE');
  assert.equal(skills.result.structuredContent.trainingCredits, null);
  assert.equal(skills.result.structuredContent.learnedSkills, null);
  assert.equal(skills.result.structuredContent.equippedSkills, null);
  assert.ok((await rank(f)).error); assert.ok(!f.calls.includes('client'));
});

test('get_punk_skills distinguishes learned state from loadout and credits without requiring equipment', async () => {
  const f = fixture(); f.state.equipped = [`0x${'0'.repeat(64)}`]; f.progression.equipped = [];
  const response = await rpc(f.server, 'tools/call', { name: 'get_punk_skills', arguments: { tokenId: '93' } });
  const skills = response.result.structuredContent;
  assert.equal(skills.status, 'VERIFIED'); assert.equal(skills.learnedSkills.length, 1);
  assert.deepEqual(skills.equippedSkills, []); assert.equal(skills.trainingCredits, '2');
  assert.equal(skills.skillCoverage, 'CURRENT_SERVER_RELEASE');
  assert.ok(!f.calls.includes('packages'));
});

test('provider and chain errors never leak dependency codes, secret URLs or upstream bodies', async () => {
  const f = fixture();
  f.controls.duringTool = () => { const error = Error('https://rpc.example/PRIVATE_KEY upstream SECRET_BODY');
    error.code = 'SECRET_CODE'; throw error; };
  const response = await rank(f);
  assert.equal(response.error.data.code, 'TOOL_CALL_FAILED');
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_KEY|SECRET_BODY|SECRET_CODE|rpc\.example/);
});

test('MCP acquisition history is additive and never asserted to be verified current holdings', async () => {
  const rows = [{ nft_token_id: '7', nft_collection_address: OTHER, acquisition_mode: 'PAID' }];
  const pool = { query: async query => { assert.match(query, /broker_acquisitions/); return { rows }; } };
  const deps = v2McpDependencies(pool, { walletAddress: OWNER }, { research: {}, authorityReader: async () => ({}) });
  const result = await deps.get_punk_collection('93');
  assert.deepEqual(result.acquisitions, rows); assert.equal(result.holdings, result.acquisitions);
  assert.equal(result.collectionView, 'ACQUISITION_HISTORY'); assert.equal(result.currentHoldingsVerified, false);
  assert.equal(result.holdingsSemantics, 'DEPRECATED_ACQUISITION_HISTORY_ALIAS');
  assert.equal(result.currentHoldingsApi, '/api/v2/punks/93/collection');
  assert.match(ART_BROKER_MCP_TOOLS.find(tool => tool.name === 'get_punk_collection').description, /history/);
});

const request = body => new Request('https://goghpunks.xyz/api/v2/mcp', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('HTTP initialization/baseline list need no database, while selected list requires the current session', async () => {
  const never = () => { throw Error('MUST_NOT_ACCESS_DATABASE'); };
  for (const method of ['initialize', 'tools/list']) {
    const response = await handleV2Mcp(request({ jsonrpc: '2.0', id: 1, method }), { poolFactory: never });
    assert.equal(response.status, 200);
  }
  const response = await handleV2Mcp(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { tokenId: '93' } }), {
    poolFactory: () => ({}), sessionReader: async () => { throw new PublicError(401, 'V2_SESSION_REQUIRED', 'Sign in.'); },
    dependencyFactory: never,
  });
  assert.equal(response.status, 401);
});

test('HTTP selected discovery and invocation bind the authenticated session instead of request owner', async () => {
  const f = fixture(); const calls = [];
  const response = await handleV2Mcp(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { tokenId: '93' } }), {
    poolFactory: () => ({}), sessionReader: async () => ({ walletAddress: OWNER }), dependencyFactory: (_pool, principal) => {
      assert.equal(principal.walletAddress, OWNER); return { research: f.research,
        requireCurrentOwner: async (id, owner) => calls.push([id, owner]) };
    },
  });
  assert.equal(response.status, 200); assert.deepEqual(calls, [['93', OWNER]]);
  assert.ok(names((await response.json()).result.tools).includes('rank_trait_sample'));
});
