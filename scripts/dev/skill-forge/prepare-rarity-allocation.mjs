// Produces a review artifact only. No RPC, signer, credentials or deployment.
import { readFile, writeFile } from 'node:fs/promises';
import { buildFrozenAllocation, FROZEN_RARITY_HASH } from '../../../broker/src/v4/skill-forge/rarity-allocation.mjs';
const directory = new URL('../../../artifacts/skill-forge/rarity/', import.meta.url);
const envelope = JSON.parse(await readFile(new URL(`gogh-opensea-rarity-${FROZEN_RARITY_HASH}.json`, directory), 'utf8'));
const tree = buildFrozenAllocation(envelope);
const review = { schema: 'GOGH_RARITY_ALLOCATION_REVIEW_V1', chainId: 4663, collection: envelope.payload.baseline.collection, snapshotHash: `0x${FROZEN_RARITY_HASH}`, allocationRoot: tree.root, tokenCount: tree.count, baseSlots: 1, maximumSlots: 7, productionAuthorized: false,
  example: { tokenId: '93', startingSlots: 1, proof: tree.proof('93') },
  encoding: 'double keccak256 ABI leaf: bytes32 domain, uint256 chainId, address collection, bytes32 snapshotHash, uint256 tokenId, uint8 startingSlots; domain keccak256(GOGH_RARITY_SLOTS_V1); sorted pair hashing; odd node promoted' };
const file = `gogh-rarity-allocation-${tree.root.slice(2)}.json`;
const body = `${JSON.stringify(review, null, 2)}\n`;
try { await writeFile(new URL(file, directory), body, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST' || await readFile(new URL(file, directory), 'utf8') !== body) throw error; }
console.log(JSON.stringify({ file, root: tree.root, tokenCount: tree.count, productionAuthorized: false }));
