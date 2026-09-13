import test from 'node:test';
import assert from 'node:assert/strict';
import { forgeLibraryState } from '../site/forge-library-state.js';
const owner = `0x${'1'.repeat(40)}`, skill = { id: 'rarity-eye', name: 'Rarity Eye', status: 'TESTING' };
const selected = { owner, chainId: 4663, preview: false };
const release = { status: 'OWNER_CANARY', allowedOwners: [owner], skills: [{ name: 'Rarity Eye' }] };
test('released training is visibly distinct from an unaccepted laboratory package', () => {
  assert.equal(forgeLibraryState(skill, null, release, selected), 'TRAINING RELEASED');
  for (const selection of [{ ...selected, preview: true }, { ...selected, owner: `0x${'2'.repeat(40)}` }, { ...selected, chainId: 31337 }])
    assert.equal(forgeLibraryState(skill, null, release, selection), 'TESTING');
});
test('verified learned and equipped states take precedence without assuming availability', () => {
  const profile = { verified: true, learnedSkills: [{ slug: skill.id, key: 'key', packageVerified: true, available: true }], equippedSkills: [] };
  assert.equal(forgeLibraryState(skill, profile, release, selected), 'LEARNED');
  profile.equippedSkills = [{ key: 'key' }];
  assert.equal(forgeLibraryState(skill, profile, release, selected), 'EQUIPPED');
  profile.learnedSkills[0].available = false;
  assert.equal(forgeLibraryState(skill, profile, release, selected), 'EQUIPPED · PAUSED');
  profile.learnedSkills[0].packageVerified = false;
  assert.equal(forgeLibraryState(skill, profile, release, selected), 'TRAINING RELEASED');
});
