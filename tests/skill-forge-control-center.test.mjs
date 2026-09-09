import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';
import { validateTrainingSnapshot } from '../site/forge-training.js';
const HASH = `0x${'2'.repeat(64)}`;
const ZERO = `0x${'0'.repeat(64)}`;
const fixtureClient = {
  getChainId: async () => 4663, getBlock: async () => ({ number: 123n, hash: HASH }), getCode: async () => '0x60016000',
  getStorageAt: async () => ZERO,
  readContract: async ({ functionName, args }) => functionName === 'supportsInterface' ? true : `data:application/json;base64,${Buffer.from(JSON.stringify({ attributes: [{ trait_type: 'Color', value: args[0] === 93n ? 'Gold' : 'Blue' }] })).toString('base64')}`,
};
test('shared V2 training gate: learned is not equipped; tool calls follow confirmed loadout', { timeout: 60000 }, async t => {
  let reads = 0;
  const preview = await startPreview({ researchClient: { ...fixtureClient, getCode: async () => { reads++; return '0x60016000'; } } }); t.after(() => preview.close());
  const read = async (tokenId = 1) => (await fetch(`${preview.url}/api/forge?tokenId=${tokenId}`)).json();
  let state = validateTrainingSnapshot(await read(), 1);
  const post = (path, body, headers = {}) => fetch(preview.url + path, { method: 'POST', headers: { origin: preview.url,
    'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce, ...headers }, body: JSON.stringify(body) });
  const tool = (name, tokenId = 1) => post('/api/local-tool', { tokenId, name });
  assert.deepEqual(state.capabilityContext.effectiveMcpTools, ['inspect_contract']);
  assert.equal(state.capabilityContext.instructionPackages.length, 1);
  assert.equal((await tool('inspect_contract', 44)).status, 409); assert.equal(reads, 0);
  assert.equal((await tool('rank_trait_sample')).status, 409); // learned, but not equipped
  assert.equal((await tool('prepare_mint')).status, 409);
  assert.equal((await post('/api/local-tool', { tokenId: 1, name: 'inspect_contract', contract: '0x1234' })).status, 409);
  assert.equal((await post('/api/local-tool', { tokenId: 1, name: 'inspect_contract' }, { origin: 'https://evil.example' })).status, 403);
  const report = await (await tool('inspect_contract')).json();
  assert.equal(report.result.codeBytes, 4); assert.equal(report.walletAuthority, 'NONE'); assert.equal(reads, 1);
  const rarity = state.skills.find(s => s.id === 4);
  const write = async (operation, extra) => {
    state = await read();
    const response = await post('/api/local-training', { tokenId: 1, expectedBlock: state.blockNumber, operation, ...extra });
    assert.equal(response.status, 200); state = validateTrainingSnapshot((await response.json()).snapshot, 1);
  };
  await write('equip', { key: rarity.key, slot: 1 });
  assert.ok(state.capabilityContext.effectiveMcpTools.includes('rank_trait_sample'));
  assert.equal((await (await tool('rank_trait_sample')).json()).result.sampleSize, 3);
  await write('unequip', { slot: 1 });
  assert.equal((await tool('rank_trait_sample')).status, 409);
  for (const altered of [{ chainId: 4663 }, { canBurn: true }, { localOnly: false }, { tokenId: 93 }, { productionReadyCount: 1 }]) {
    assert.throws(() => validateTrainingSnapshot({ ...state, ...altered }, 1), /Unverified/);
  }
  for (const path of ['/control-center', '/broker-v2-forge.js', '/forge-training.js', '/forge-training.css']) assert.equal((await fetch(preview.url + path)).status, 200);
});
