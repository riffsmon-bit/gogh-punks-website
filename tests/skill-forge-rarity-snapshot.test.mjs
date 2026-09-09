import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, normalizeNft, verifyComplete, boundedJson, batchRequest, normalizeBatch } from '../scripts/dev/skill-forge/capture-rarity-snapshot.mjs';
import { SLOT_POLICY } from '../broker/src/v4/skill-forge/slot-policy.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifySnapshotEnvelope } from '../scripts/dev/skill-forge/verify-rarity-snapshot.mjs';

const source = () => ({ collection: SLOT_POLICY.collectionSlug, contracts: [{ address: SLOT_POLICY.collection, chain: 'robinhood' }], total_supply: 2, rarity: { strategy_id: 'openrarity', strategy_version: '1.0', calculated_at: '2026-09-09T03:22:12', total_supply: 2, max_rank: 2 } });
const nft = (id, rank) => ({ identifier: String(id), contract: SLOT_POLICY.collection, collection: SLOT_POLICY.collectionSlug, token_standard: 'erc721', rarity: { strategy_id: 'openrarity', strategy_version: '1.0', rank }, traits: [{ trait_type: 'Color', value: 'Blue' }] });
const rows = () => [normalizeNft(nft(1, 1), fingerprint(source()), '1'), normalizeNft(nft(2, 2), fingerprint(source()), '2')];

test('snapshot fingerprints bind collection, chain, strategy, time and population', () => {
  assert.equal(fingerprint(source()).population, 2);
  for (const modify of [s => { s.collection = 'other'; }, s => { s.contracts[0].chain = 'ethereum'; }, s => { s.rarity.total_supply = 3; }, s => { s.rarity.calculated_at = null; }, s => { s.rarity.strategy_id = 'made-up'; }]) {
    const s = source(); modify(s); assert.throws(() => fingerprint(s));
  }
});
test('single NFT proof rejects wrong tokens, collections, standards and missing ranks', () => {
  const base = fingerprint(source());
  for (const modify of [n => { n.identifier = '3'; }, n => { n.collection = 'other'; }, n => { n.token_standard = 'erc1155'; }, n => { n.rarity = null; }, n => { n.rarity.rank = 0; }, n => { n.rarity.rank = 3; }, n => { n.rarity.strategy_version = '2'; }]) {
    const n = nft(1, 1); modify(n); assert.throws(() => normalizeNft(n, base, '1'));
  }
});
test('batch requests bind exact Robinhood collection IDs with no generic execution body', () => {
  assert.deepEqual(batchRequest(['93']), { identifiers: [{ chain: 'robinhood', contract_address: SLOT_POLICY.collection, token_id: '93' }] });
  for (const ids of [[], ['0'], ['1', '1'], ['5017'], [93], ['01'], Array.from({ length: 31 }, (_, i) => String(i + 1))]) assert.throws(() => batchRequest(ids), /INVALID_BATCH_IDS/);
});
test('batch reads tolerate reordering but reject silent omissions, duplicates and replacements', () => {
  const base = fingerprint(source());
  assert.deepEqual(normalizeBatch({ nfts: [nft(2, 2), nft(1, 1)] }, base, ['1', '2']).map(r => r.tokenId), ['1', '2']);
  for (const nfts of [[nft(1, 1)], [nft(1, 1), nft(1, 1)], [nft(1, 1), nft(3, 2)]]) assert.throws(() => normalizeBatch({ nfts }, base, ['1', '2']), /INCOMPLETE_BATCH/);
});
test('public normalized records contain no owner, credential or full API response', () => {
  const n = nft(1, 1); n.owners = [{ address: 'private-owner-context' }]; n.apiKey = 'never-export';
  const row = normalizeNft(n, fingerprint(source()), '1');
  assert.deepEqual(Object.keys(row), ['tokenId', 'rank', 'startingSlots', 'metadataHash', 'retrievedAt']);
  assert.match(row.metadataHash, /^[a-f0-9]{64}$/);
});
test('complete matching ranks pass, tied ranks are allowed', () => {
  const base = fingerprint(source());
  verifyComplete(rows(), ['1', '2'], base, base);
  verifyComplete([normalizeNft(nft(1, 1), base, '1'), normalizeNft(nft(2, 1), base, '2')], ['1', '2'], base, base);
});
test('missing, duplicate and substituted token sets never freeze', () => {
  const base = fingerprint(source());
  for (const [records, ids] of [[rows().slice(0, 1), ['1', '2']], [[rows()[0], rows()[0]], ['1', '2']], [rows(), ['1', '3']], [rows(), ['1', '1']]]) {
    assert.throws(() => verifyComplete(records, ids, base, base), /INCOMPLETE_TOKEN_SET/);
  }
});
test('a changing calculation cannot masquerade as a frozen snapshot', () => {
  const base = fingerprint(source());
  assert.throws(() => verifyComplete(rows(), ['1', '2'], base, { ...base, calculatedAt: 'later' }), /RARITY_CALCULATION_CHANGED/);
});
test('slot overrides cannot enter the snapshot', () => {
  const records = rows(); records[0].startingSlots = 7;
  const base = fingerprint(source());
  assert.throws(() => verifyComplete(records, ['1', '2'], base, base), /ALLOCATION_MISMATCH/);
});
test('API responses are type checked and size bounded', async () => {
  assert.deepEqual(await boundedJson(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })), { ok: true });
  await assert.rejects(boundedJson(new Response('<html>oops</html>')), /INVALID_API_CONTENT_TYPE/);
  await assert.rejects(boundedJson(new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } })), /API_RESPONSE_TOO_LARGE/);
});
test('offline verification detects tampering and binds the approved policy', () => {
  const payload = { schemaVersion: 1, status: 'VERIFIED_DATA_NOT_ONCHAIN_AUTHORITY', slotPolicy: SLOT_POLICY, baseline: fingerprint(source()), pinnedBlock: { number: '1', hash: `0x${'1'.repeat(64)}` }, endBlock: { number: '2', hash: `0x${'2'.repeat(64)}` }, records: rows() };
  const seal = p => ({ payload: p, sha256: createHash('sha256').update(JSON.stringify(p)).digest('hex') });
  assert.equal(verifySnapshotEnvelope(seal(payload)).count, 2);
  assert.equal(verifySnapshotEnvelope(seal(payload)).onchainAuthority, false);
  const tampered = seal(structuredClone(payload)); tampered.payload.records[0].rank = 2;
  assert.throws(() => verifySnapshotEnvelope(tampered), /SNAPSHOT_HASH_MISMATCH/);
  assert.throws(() => verifySnapshotEnvelope(seal({ ...payload, slotPolicy: { ...SLOT_POLICY, maxEquippedSkills: 10 } })), /SNAPSHOT_IDENTITY_MISMATCH/);
  assert.throws(() => verifySnapshotEnvelope(seal({ ...payload, baseline: { ...payload.baseline, chainId: 1 } })), /SNAPSHOT_IDENTITY_MISMATCH/);
  assert.throws(() => verifySnapshotEnvelope(seal({ ...payload, endBlock: { number: '0', hash: `0x${'2'.repeat(64)}` } })), /INVALID_SNAPSHOT_BLOCK/);
});
test('frozen Gogh snapshot retains its reviewed hash and complete slot allocation', async () => {
  const expected = '8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de';
  const envelope = JSON.parse(await readFile(new URL(`../artifacts/skill-forge/rarity/gogh-opensea-rarity-${expected}.json`, import.meta.url), 'utf8'));
  assert.equal(envelope.sha256, expected);
  const result = verifySnapshotEnvelope(envelope);
  assert.equal(result.count, 4295);
  assert.deepEqual(result.allocations, { 1: 3222, 2: 859, 3: 214 });
  assert.equal(result.punk93.rank, 1295);
  assert.equal(result.punk93.startingSlots, 1);
  assert.equal(result.onchainAuthority, false);
});
