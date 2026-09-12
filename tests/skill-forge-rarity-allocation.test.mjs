import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allocationLeaf, buildAllocationTree, buildFrozenAllocation, verifyAllocationProof, FROZEN_RARITY_HASH } from '../broker/src/v4/skill-forge/rarity-allocation.mjs';
const identity = { chainId: 31337, collection: `0x${'1'.repeat(40)}`, snapshotHash: `0x${'2'.repeat(64)}` };
test('sorted pair tree verifies every proof including odd branches and reordered inputs', () => {
  const records = Array.from({ length: 37 }, (_, i) => ({ tokenId: String(i + 1), startingSlots: i % 3 + 1 }));
  const tree = buildAllocationTree({ ...identity, records });
  assert.equal(tree.root, buildAllocationTree({ ...identity, records: [...records].reverse() }).root);
  for (const r of records) assert.equal(verifyAllocationProof(allocationLeaf({ ...identity, ...r }), tree.proof(r.tokenId), tree.root), true);
  const r = records[0];
  assert.equal(verifyAllocationProof(allocationLeaf({ ...identity, ...r, chainId: 4663 }), tree.proof(r.tokenId), tree.root), false);
  assert.equal(verifyAllocationProof(allocationLeaf({ ...identity, ...r, startingSlots: 3 }), tree.proof(r.tokenId), tree.root), false);
  assert.throws(() => tree.proof('999'), /UNKNOWN_ALLOCATION/);
});
test('invalid and duplicate allocations fail closed; row fields cannot replace domain', () => {
  for (const startingSlots of [0, 4, '3', null]) assert.throws(() => allocationLeaf({ ...identity, tokenId: '1', startingSlots }));
  assert.throws(() => buildAllocationTree({ ...identity, records: [{ tokenId: '1', startingSlots: 1 }, { tokenId: '1', startingSlots: 2 }] }), /DUPLICATE_ALLOCATION/);
  const clean = { tokenId: '1', startingSlots: 1 };
  assert.equal(buildAllocationTree({ ...identity, records: [clean] }).root, buildAllocationTree({ ...identity, records: [{ ...clean, chainId: 1 }] }).root);
});
test('complete frozen snapshot produces valid proofs and cannot be modified under a copied hash', async () => {
  const envelope = JSON.parse(await readFile(new URL(`../artifacts/skill-forge/rarity/gogh-opensea-rarity-${FROZEN_RARITY_HASH}.json`, import.meta.url), 'utf8'));
  const tree = buildFrozenAllocation(envelope);
  assert.equal(tree.count, 4295);
  for (const row of envelope.payload.records) assert.equal(verifyAllocationProof(allocationLeaf({ chainId: 4663, collection: envelope.payload.baseline.collection, snapshotHash: `0x${FROZEN_RARITY_HASH}`, tokenId: row.tokenId, startingSlots: row.startingSlots }), tree.proof(row.tokenId), tree.root), true);
  envelope.payload.records[0].tokenId = '9999';
  assert.throws(() => buildFrozenAllocation(envelope), /SNAPSHOT_HASH_MISMATCH/);
});
