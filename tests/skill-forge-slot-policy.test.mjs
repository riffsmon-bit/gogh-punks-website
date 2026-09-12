import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_POLICY, startingSlotsForRank } from '../broker/src/v4/skill-forge/slot-policy.mjs';

test('approved policy has seven maximum slots and no rare-burn multiplier', () => {
  assert.equal(SLOT_POLICY.maxEquippedSkills, 7);
  assert.equal(SLOT_POLICY.creditsPerSacrifice, 1);
  assert.equal(SLOT_POLICY.creditsPerSlot, 1);
  assert.equal(SLOT_POLICY.rarityBurnMultiplier, false);
});
test('rarity bands use integer cutoffs and equal ranks retain equal allocation', () => {
  for (const [rank, slots] of [[1, 3], [214, 3], [215, 2], [1073, 2], [1074, 1], [4295, 1]]) {
    assert.equal(startingSlotsForRank(rank, 4295), slots);
  }
  assert.equal(startingSlotsForRank(5, 100), 3);
  assert.equal(startingSlotsForRank(25, 100), 2);
  assert.equal(startingSlotsForRank(26, 100), 1);
});
test('missing and malformed ranks never receive a rarity bonus by default', () => {
  for (const [rank, population] of [[null, 4295], [0, 4295], [-1, 4295], ['1', 4295], [4296, 4295], [1, 0], [1.1, 4295], [1, NaN]]) {
    assert.throws(() => startingSlotsForRank(rank, population), /INVALID_RARITY_RANK/);
  }
});
