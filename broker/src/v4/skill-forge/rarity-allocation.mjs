import { concat, encodeAbiParameters, getAddress, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { SLOT_POLICY, startingSlotsForRank } from './slot-policy.mjs';
import { createHash } from 'node:crypto';

export const FROZEN_RARITY_HASH = '8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de';
const DOMAIN = keccak256(stringToHex('GOGH_RARITY_SLOTS_V1'));
const HASH = /^0x[0-9a-f]{64}$/;
export function allocationLeaf({ chainId, collection, snapshotHash, tokenId, startingSlots }) {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !HASH.test(snapshotHash)
    || !/^[1-9]\d{0,77}$/.test(String(tokenId)) || BigInt(tokenId) >= 2n ** 256n
    || !Number.isInteger(startingSlots) || startingSlots < 1 || startingSlots > 3) throw new Error('INVALID_ALLOCATION');
  return keccak256(keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,bytes32,uint256,uint8'),
    [DOMAIN, BigInt(chainId), getAddress(collection), snapshotHash, BigInt(tokenId), startingSlots])));
}
const pairHash = (a, b) => keccak256(concat(a < b ? [a, b] : [b, a]));
export function buildAllocationTree({ chainId, collection, snapshotHash, records }) {
  if (!Array.isArray(records) || !records.length || records.length > 10000) throw new Error('INVALID_ALLOCATION_SET');
  const ordered = [...records].sort((a, b) => BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1);
  if (new Set(ordered.map(r => String(r.tokenId))).size !== ordered.length) throw new Error('DUPLICATE_ALLOCATION');
  const levels = [ordered.map(r => allocationLeaf({ chainId, collection, snapshotHash, tokenId: r.tokenId, startingSlots: r.startingSlots }))];
  while (levels.at(-1).length > 1) {
    const previous = levels.at(-1), next = [];
    for (let i = 0; i < previous.length; i += 2) next.push(i + 1 < previous.length ? pairHash(previous[i], previous[i + 1]) : previous[i]);
    levels.push(next);
  }
  return Object.freeze({ root: levels.at(-1)[0], count: ordered.length,
    proof(tokenId) {
      let index = ordered.findIndex(r => String(r.tokenId) === String(tokenId));
      if (index < 0) throw new Error('UNKNOWN_ALLOCATION');
      const proof = [];
      for (let depth = 0; depth < levels.length - 1; depth++) {
        const sibling = index ^ 1;
        if (sibling < levels[depth].length) proof.push(levels[depth][sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    },
  });
}
export function verifyAllocationProof(leaf, proof, root) {
  if (!HASH.test(leaf) || !HASH.test(root) || !Array.isArray(proof) || proof.length > 32 || proof.some(p => !HASH.test(p))) return false;
  return proof.reduce(pairHash, leaf) === root;
}
export function buildFrozenAllocation(envelope) {
  if (envelope?.sha256 !== FROZEN_RARITY_HASH || envelope.payload?.baseline?.population !== 4295
    || envelope.payload.baseline.collection !== SLOT_POLICY.collection || envelope.payload.baseline.chainId !== 4663
    || envelope.payload.records?.length !== 4295) throw new Error('UNAPPROVED_SNAPSHOT');
  if (createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex') !== FROZEN_RARITY_HASH) throw new Error('SNAPSHOT_HASH_MISMATCH');
  const records = envelope.payload.records.map(r => {
    if (r.startingSlots !== startingSlotsForRank(r.rank, 4295)) throw new Error('INVALID_ALLOCATION');
    return { tokenId: r.tokenId, startingSlots: r.startingSlots };
  });
  return buildAllocationTree({ chainId: 4663, collection: SLOT_POLICY.collection, snapshotHash: `0x${FROZEN_RARITY_HASH}`, records });
}
