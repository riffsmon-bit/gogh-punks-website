import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContract, parseInlineMetadata, retrieveInlineMetadata, rankTraitSample } from '../broker/src/v4/skill-forge/research-tools.mjs';
const contract = `0x${'11'.repeat(20)}`;
const attributes = [{ trait_type: 'Background', value: 'Blue' }];
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ attributes })).toString('base64');
const client = () => ({ getChainId: async () => 4663, getBlock: async () => ({ number: 123n, hash: `0x${'22'.repeat(32)}` }),
  getCode: async () => '0x60006000', getStorageAt: async () => `0x${'00'.repeat(32)}`,
  readContract: async (r) => r.functionName === 'tokenURI' ? uri : r.args[0] === '0x80ac58cd' });
test('contract evidence is pinned to a block and never a security clearance', async () => {
  const result = await inspectContract({ client: client(), contract });
  assert.equal(result.erc721.value, true); assert.equal(result.erc1155.value, false);
  assert.equal(result.securityVerdict, 'NOT_A_SECURITY_CLEARANCE'); assert.equal(result.walletAuthority, 'NONE');
  assert.equal(result.evidenceHash.length, 64);
});
test('failed proxy probe is UNKNOWN, never no-proxy', async () => {
  const rpc = client(); rpc.getStorageAt = async () => { throw new Error('offline'); };
  const result = await inspectContract({ client: rpc, contract });
  assert.equal(result.eip1967Implementation.status, 'UNKNOWN');
});
test('wrong chain and missing contract code reject', async () => {
  const rpc = client(); rpc.getChainId = async () => 1;
  await assert.rejects(inspectContract({ client: rpc, contract }), /WRONG_CHAIN/);
  rpc.getChainId = async () => 4663; rpc.getCode = async () => '0x';
  await assert.rejects(inspectContract({ client: rpc, contract }), /NO_CONTRACT_CODE/);
});
test('metadata reader only accepts bounded inline JSON, never arbitrary remote fetches', async () => {
  assert.deepEqual(parseInlineMetadata(uri).attributes, attributes);
  assert.throws(() => parseInlineMetadata('https://127.0.0.1/admin'), /REVIEWED_FETCHER/);
  assert.throws(() => parseInlineMetadata('x'.repeat(2_000_001)), /SIZE_LIMIT/);
  const result = await retrieveInlineMetadata({ client: client(), contract, tokenIds: ['93', '94'] });
  assert.equal(result.tokens.length, 2); assert.equal(result.coverage, 'SAMPLE_ONLY');
  await assert.rejects(retrieveInlineMetadata({ client: client(), contract, tokenIds: ['93', '93'] }), /INVALID_TOKEN_IDS/);
});
test('rarer categorical trait ranks first; ties use competition rank', () => {
  const tokens = ['Blue', 'Blue', 'Gold'].map((value, i) => ({ tokenId: String(i + 1), attributes: [{ trait_type: 'Hat', value }] }));
  const result = rankTraitSample(tokens);
  assert.deepEqual(result.ranked.map(r => [r.tokenId, r.rank]), [['3', 1], ['1', 2], ['2', 2]]);
  assert.equal(result.coverage, 'SAMPLE_ONLY');
});
test('missing categorical trait is explicit; malformed/numeric/duplicate traits reject', () => {
  const result = rankTraitSample([{ tokenId: '1', attributes }, { tokenId: '2', attributes: [] }]);
  assert.ok(result.frequencies.some(f => f.trait[1] === null));
  for (const bad of [[...attributes, ...attributes], [{ trait_type: 'Date', value: 123 }]]) {
    assert.throws(() => rankTraitSample([{ tokenId: '1', attributes }, { tokenId: '2', attributes: bad }]), /TRAIT/);
  }
});
test('numeric traits require explicit categorical interpretation and never coalesce with strings', () => {
  const tokens = [68, '68', 68].map((value, i) => ({ tokenId: String(i), attributes: [{ trait_type: 'Edition', value }] }));
  const result = rankTraitSample(tokens, { numericMode: 'categorical' });
  assert.equal(result.numericMode, 'categorical');
  assert.equal(result.ranked[0].tokenId, '1');
  assert.throws(() => rankTraitSample(tokens, { numericMode: 'guess' }), /INVALID_NUMERIC_MODE/);
});
