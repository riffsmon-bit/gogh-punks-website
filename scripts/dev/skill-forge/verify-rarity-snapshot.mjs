import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SLOT_POLICY } from '../../../broker/src/v4/skill-forge/slot-policy.mjs';
import { verifyComplete } from './capture-rarity-snapshot.mjs';

export function verifySnapshotEnvelope(envelope) {
  const { sha256, payload } = envelope;
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (sha256 !== digest) throw new Error('SNAPSHOT_HASH_MISMATCH');
  if (payload.schemaVersion !== 1 || payload.status !== 'VERIFIED_DATA_NOT_ONCHAIN_AUTHORITY'
    || JSON.stringify(payload.slotPolicy) !== JSON.stringify(SLOT_POLICY)
    || payload.baseline?.collection !== SLOT_POLICY.collection || payload.baseline?.chainId !== 4663
    || payload.baseline?.strategyId !== 'openrarity' || !payload.baseline.strategyVersion || !payload.baseline.calculatedAt) throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
  for (const block of [payload.pinnedBlock, payload.endBlock]) {
    if (!block || !/^[1-9]\d*$/.test(block.number) || !/^0x[a-f0-9]{64}$/.test(block.hash)) throw new Error('INVALID_SNAPSHOT_BLOCK');
  }
  if (BigInt(payload.endBlock.number) < BigInt(payload.pinnedBlock.number)) throw new Error('INVALID_SNAPSHOT_BLOCK');
  const seen = new Set();
  for (const row of payload.records) {
    if (!/^[1-9]\d*$/.test(row.tokenId) || seen.has(row.tokenId) || !/^[a-f0-9]{64}$/.test(row.metadataHash) || !Number.isFinite(Date.parse(row.retrievedAt))) throw new Error('INVALID_SNAPSHOT_RECORD');
    seen.add(row.tokenId);
  }
  verifyComplete(payload.records, [...seen], payload.baseline, payload.baseline);
  const allocations = { 1: 0, 2: 0, 3: 0 };
  for (const row of payload.records) allocations[row.startingSlots]++;
  return { verified: true, sha256, count: seen.size, allocations, punk93: payload.records.find(row => row.tokenId === '93') ?? null, onchainAuthority: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('SNAPSHOT_FILE_REQUIRED');
    console.log(JSON.stringify(verifySnapshotEnvelope(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2));
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SNAPSHOT_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
