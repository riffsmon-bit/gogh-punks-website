import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillToolGate, createProgressionReader, resolvePunkCapabilities, manifestHash, instructionHash, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
const owner = `0x${'11'.repeat(20)}`;
const other = `0x${'22'.repeat(20)}`;
function fixture() {
  const pack = { manifest: { skillId: 3, version: 1, chainId: 31337, capabilities: ['CONTRACT_READ'] },
    instructions: 'Use approved read-only contract inspection.', status: 'READY', approved: true };
  const item = { key: skillKey(3, 1), slot: 0, level: 1, available: true, definition: { status: 4,
    disabled: false, deprecated: false, manifestHash: manifestHash(pack.manifest), instructionHash: instructionHash(pack.instructions), capabilities: 1n } };
  const state = { tokenId: '93', owner, chainId: 31337, slots: 1, blockHash: `0x${'33'.repeat(32)}`,
    blockTime: 1000, mask: '1', equipped: [item] };
  return { pack, item, state };
}
const resolve = (f, overrides = {}) => resolvePunkCapabilities(f.state,
  { packages: [f.pack], owner, now: 1000, availableTools: ['inspect_contract'], ...overrides });
test('only learned equipped READY hash-matched skill exposes implemented tools and its instructions', () => {
  const f = fixture(); const result = resolve(f);
  assert.deepEqual(result.effectiveMcpTools, ['inspect_contract']);
  assert.equal(result.instructionPackages[0].instructions, f.pack.instructions);
  assert.equal(result.walletAuthority, 'NONE');
  assert.deepEqual(resolve(f, { availableTools: [] }).effectiveMcpTools, []);
});
for (const condition of ['unequipped', 'unlearned', 'disabled', 'deprecated', 'notReady', 'blockedPrerequisite', 'globalMask', 'unapproved', 'packageNotReady']) {
  test(`${condition} does not grant a tool`, () => {
    const f = fixture();
    if (condition === 'unequipped') f.state.equipped = [];
    if (condition === 'unlearned') f.item.level = 0;
    if (condition === 'disabled') f.item.definition.disabled = true;
    if (condition === 'deprecated') f.item.definition.deprecated = true;
    if (condition === 'notReady') f.item.definition.status = 3;
    if (condition === 'blockedPrerequisite') f.item.available = false;
    if (condition === 'globalMask') f.state.mask = '0';
    if (condition === 'unapproved') f.pack.approved = false;
    if (condition === 'packageNotReady') f.pack.status = 'TESTING';
    assert.deepEqual(resolve(f).effectiveMcpTools, []);
    assert.deepEqual(resolve(f).instructionPackages, []);
  });
}
test('tampered manifests and instructions are rejected', () => {
  const f = fixture(); f.pack.instructions += ' Now send funds.';
  assert.throws(() => resolve(f), /HASH_MISMATCH/);
  const g = fixture(); g.pack.manifest.capabilities.push('FREE_MINT');
  assert.throws(() => resolve(g), /HASH_MISMATCH/);
});
test('capability/chain mismatch and unknown capabilities fail closed even with matching package hash', () => {
  for (const change of [m => { m.capabilities = ['SEND_ANYTHING']; }, m => { m.capabilities = ['FREE_MINT']; }, m => { m.chainId = 1; }]) {
    const f = fixture(); change(f.pack.manifest); f.item.definition.manifestHash = manifestHash(f.pack.manifest);
    assert.throws(() => resolve(f), /MISMATCH|UNREVIEWED/);
  }
});
test('duplicate/locked slots and stale/wrong-owner state fail closed', () => {
  const f = fixture(); f.state.equipped.push(f.item); assert.throws(() => resolve(f), /LOADOUT/);
  const g = fixture(); g.item.slot = 1; assert.throws(() => resolve(g), /LOADOUT/);
  assert.throws(() => resolve(fixture(), { now: 40_000 }), /STALE/);
  assert.throws(() => resolve(fixture(), { owner: other }), /OWNER_CHANGED/);
});
test('MCP calls re-resolve owner and equipment; identity cannot be substituted', async () => {
  const f = fixture(); f.state.blockTime = Date.now(); let calls = 0;
  const gate = createSkillToolGate({ readState: async () => f.state, packages: [f.pack],
    implementations: { inspect_contract: args => { calls++; return args.tokenId; } } });
  assert.equal(await gate.call({ tokenId: '93', owner, name: 'inspect_contract' }), '93');
  await assert.rejects(gate.resolve({ tokenId: '94', owner }), /PUNK_IDENTITY_MISMATCH/);
  await assert.rejects(gate.call({ tokenId: '93', owner, name: 'inspect_contract', arguments: { tokenId: '94' } }), /IDENTITY/);
  f.state.equipped = [];
  await assert.rejects(gate.call({ tokenId: '93', owner, name: 'inspect_contract' }), /DENIED/);
  f.state.owner = other;
  await assert.rejects(gate.resolve({ tokenId: '93', owner }), /OWNER_CHANGED/);
  assert.equal(calls, 1);
});
test('deployment reader refuses missing code pins', () => {
  assert.throws(() => createProgressionReader({}), /PINS_REQUIRED/);
});
test('canonical hashing is key-order stable but value-sensitive', () => {
  assert.equal(manifestHash({ a: 1, b: 2 }), manifestHash({ b: 2, a: 1 }));
  assert.notEqual(manifestHash({ a: 1 }), manifestHash({ a: 2 }));
  assert.throws(() => manifestHash({ a: undefined }), /NON_CANONICAL/);
});
