import test from 'node:test';
import assert from 'node:assert/strict';
import { roadmap, previewLibrary } from '../scripts/dev/skill-forge/library-roadmap.mjs';

test('roadmap adds choices without registry identities or executable authority', () => {
  assert.equal(roadmap.length, 8);
  assert.equal(new Set(roadmap.map(skill => skill.id)).size, roadmap.length);
  for (const skill of roadmap) {
    assert.equal(skill.learnable, false); assert.equal(skill.comingSoon, true);
    assert.equal(skill.key, null); assert.equal(skill.manifestHash, null);
    assert.equal(skill.instructionHash, null); assert.equal(skill.version, null);
    assert.deepEqual(skill.tools, []);
    assert.ok(['UNDER_REVIEW', 'BLOCKED'].includes(skill.status));
    assert.ok(skill.source && skill.missing && skill.boundary);
    if (skill.sourceUrl) assert.match(skill.sourceUrl, /github\.com\/.+\/tree\/[0-9a-f]{40}\//);
  }
  const fixture = { id: 2, key: 'fixture-key', manifestHash: 'original', tools: ['inspect_mint_link'] };
  const library = previewLibrary([fixture]);
  assert.equal(library[0].key, fixture.key); assert.equal(library[0].manifestHash, fixture.manifestHash);
  assert.deepEqual(library[0].tools, fixture.tools); assert.equal(library[0].learnable, false);
});
