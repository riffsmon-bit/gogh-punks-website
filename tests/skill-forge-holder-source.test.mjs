import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi, keccak256 } from 'viem';
import { holderBurnSelection, observedHolderAssets, readHolderStandardInventory, readHolderSource,
  HOLDER_ASSET_EVENTS, HOLDER_BURN_COLLECTION } from '../broker/src/v4/skill-forge/holder-source.mjs';
import { createHolderHistoryScanner } from '../broker/src/v4/skill-forge/holder-history.mjs';
import { createHolderObligationReader, validateHolderObligations, HOLDER_OBLIGATION_CHECKS } from '../broker/src/v4/skill-forge/holder-obligations.mjs';
import { HOLDER_DATABASE_OBLIGATION_DESCRIPTORS } from '../broker/src/v4/skill-forge/holder-obligation-descriptors.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`, hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const owner = address(1), wallets = [10, 11, 12, 13].map(n => ({ address: address(n) }));
const selection = holderBurnSelection(owner, '812', '119');
const source = { selection, wallets, anchor: { number: '5', hash: hash(5), timestamp: '1800000000' } };
const transfer = (standard = 'ERC20', overrides = {}) => ({ address: address(20), blockNumber: '0x1', removed: false,
  topics: [HOLDER_ASSET_EVENTS[0].topic, hash(0), hash(10), ...(standard === 'ERC721' ? [hash(45)] : [])],
  data: standard === 'ERC20' ? hash(5) : '0x', ...overrides });

test('holder selection supports arbitrary owned pair and rejects same, malformed or out-of-collection IDs', () => {
  assert.equal(selection.sourceTokenId, '812'); assert.equal(selection.targetTokenId, '119');
  for (const ids of [['93', '93'], ['01753', '93'], ['5017', '93'], ['-1', '93']]) assert.throws(() => holderBurnSelection(owner, ...ids));
  assert.throws(() => holderBurnSelection(address(0), '812', '119'));
});
test('standard receipts identify assets without interpreting past receipt as current possession', () => {
  assert.deepEqual(observedHolderAssets([transfer(), transfer('ERC721')], wallets), [
    { wallet: address(10), contract: address(20), standard: 'ERC20', tokenId: null },
    { wallet: address(10), contract: address(20), standard: 'ERC721', tokenId: '45' },
  ]);
  assert.equal(observedHolderAssets([transfer(), transfer()], wallets).length, 1);
});
test('ERC1155 batch receipt discovers each ID with bounded decoding', () => {
  const abi = parseAbi(['event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)']);
  const log = { address: address(20), topics: encodeEventTopics({ abi, eventName: 'TransferBatch', args: { operator: owner, from: address(0), to: address(10) } }),
    data: encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [[7n, 8n], [1n, 2n]]) };
  assert.deepEqual(observedHolderAssets([log], wallets).map(a => [a.standard, a.tokenId]), [['ERC1155', '7'], ['ERC1155', '8']]);
});
test('unknown, malformed, removed and wrong-recipient events cannot become empty inventory', () => {
  for (const log of [transfer('ERC20', { removed: true }), transfer('ERC20', { data: '0x' }),
    transfer('ERC20', { topics: [hash(42), hash(0), hash(10)] }), transfer('ERC20', { topics: [HOLDER_ASSET_EVENTS[0].topic, hash(0), hash(99)] })])
    assert.throws(() => observedHolderAssets([log], wallets));
});
test('withdrawn standard tokens and NFTs permit a currently empty supported inventory', async () => {
  const assets = observedHolderAssets([transfer(), transfer('ERC721')], wallets);
  const client = () => ({ readContract: async q => q.functionName === 'ownerOf' ? address(30) : 0n, getBlock: async () => ({ hash: hash(5) }) });
  const result = await readHolderStandardInventory({ clients: [client(), client()], source, assets });
  assert.equal(result.complete, true); assert.equal(result.empty, true); assert.equal(result.nonstandardAssets, 'OWNER_REVIEW_REQUIRED');
});
test('held, reverting and disagreeing standard holdings block burn eligibility', async () => {
  const assets = observedHolderAssets([transfer()], wallets);
  for (const values of [[1n, 1n], [0n, 1n], [Error('RPC'), 0n]]) {
    const clients = values.map(value => ({ readContract: async () => { if (value instanceof Error) throw value; return value; }, getBlock: async () => ({ hash: hash(5) }) }));
    const result = await readHolderStandardInventory({ clients, source, assets }); assert.equal(result.empty, false);
  }
});
test('malformed and zero ERC721 owner results remain unknown, not empty', async () => {
  const assets = observedHolderAssets([transfer('ERC721')], wallets);
  for (const value of [null, '', address(0), 'not-an-owner', 0n]) {
    const client = () => ({ readContract: async () => value, getBlock: async () => ({ hash: hash(5) }) });
    const result = await readHolderStandardInventory({ clients: [client(), client()], source, assets });
    assert.equal(result.complete, false); assert.equal(result.empty, false); assert.equal(result.assets[0].status, 'UNKNOWN');
  }
});
function scannerFixture({ resetSupported = false } = {}) {
  let row = null; const requests = []; let fail = false, reorg = false, control = true;
  const positiveControl = { filter: { address: address(100) }, transactionHash: hash(100), blockHash: hash(100) };
  const client = () => ({ getChainId: async () => 4663, getBlock: async ({ blockNumber }) => ({ hash: reorg && blockNumber === 1n ? hash(999) : hash(blockNumber) }),
    request: async ({ params: [q] }) => {
      if (q.address) return control ? [{ transactionHash: hash(100), blockHash: hash(100) }] : [];
      requests.push(q); if (fail) throw Error('ARCHIVE_UNAVAILABLE'); return [];
    } });
  const store = { load: async () => row, create: async value => (row = structuredClone(value)),
    advance: async (_key, revision, value) => { assert.equal(revision, row.revision); row = { ...row, ...value, revision: revision + 1 }; return row; } };
  if (resetSupported) store.reset = async (_key, revision, proof) => {
    assert.equal(proof.oldCursor, row.cursor); assert.equal(proof.oldHash, row.anchorHash);
    row = { ...row, cursor: '-1', anchorHash: null, assets: [], generation: (row.generation ?? 0) + 1, revision: revision + 1 }; return row;
  };
  const scanner = createHolderHistoryScanner({ clients: [client(), client()], store, positiveControl, rangeBlocks: 2, maxRanges: 1 });
  return { scanner, requests, row: () => row, fail: () => { fail = true; }, reorg: () => { reorg = true; }, noControl: () => { control = false; } };
}
test('history advances complete bounded ranges from genesis and resumes after process recreation', async () => {
  const f = scannerFixture();
  let result = await f.scanner.advance(source); assert.equal(result.cursor, '1'); assert.equal(result.complete, false);
  result = await f.scanner.advance(source); assert.equal(result.cursor, '3');
  result = await f.scanner.advance(source); assert.equal(result.cursor, '5'); assert.equal(result.complete, true);
  assert.equal(f.requests.length, 12); assert.equal(f.requests[0].fromBlock, '0x0'); assert.equal(f.requests[4].fromBlock, '0x2');
  assert.equal(result.indexedProviders, 1); assert.equal(result.anchorVerifiedProviders, 2);
});
test('failed range cannot skip ahead or erase previously scanned history', async () => {
  const f = scannerFixture(); await f.scanner.advance(source); f.fail();
  await assert.rejects(f.scanner.advance(source), /ARCHIVE_UNAVAILABLE/); assert.equal(f.row().cursor, '1');
});
test('reorg and failed archive positive control fail closed', async () => {
  const f = scannerFixture(); await f.scanner.advance(source); f.reorg(); await assert.rejects(f.scanner.advance(source), /RESET_REQUIRED/);
  const g = scannerFixture(); g.noControl(); await assert.rejects(g.scanner.advance(source), /CONTROL_FAILED/); assert.equal(g.row(), null);
});
test('two-provider agreed history reorg begins a new audited generation from genesis', async () => {
  const f = scannerFixture({ resetSupported: true }); await f.scanner.advance(source); f.reorg();
  const result = await f.scanner.advance(source); assert.equal(result.restartedHistory, 1);
  assert.equal(result.cursor, '1'); assert.equal(result.complete, false); assert.equal(f.requests[4].fromBlock, '0x0');
});
test('obligation reader requires every category and no failed query is interpreted as zero', async () => {
  const descriptors = HOLDER_OBLIGATION_CHECKS.map(name => ({ name, pool: 'application', sql: 'SELECT 0 AS count', parameters: () => [], remediation: 'Resolve activity.' }));
  const pools = { application: { query: async () => ({ rows: [{ count: '0' }] }) } };
  assert.equal(validateHolderObligations(await createHolderObligationReader({ descriptors, pools })(source), source).clear, true);
  const missing = await createHolderObligationReader({ descriptors: descriptors.slice(1), pools })(source);
  assert.equal(missing.complete, false); assert.throws(() => validateHolderObligations(missing, source));
  const failing = await createHolderObligationReader({ descriptors, pools: { application: { query: async () => { throw Error('TABLE_MISSING'); } } } })(source);
  assert.equal(failing.checks.every(c => c.status === 'UNKNOWN'), true);
});
test('stale obligation anchor or unresolved refund cannot authorize a burn', async () => {
  const evidence = { schema: 'GOGH_HOLDER_BURN_OBLIGATIONS_V1', sourceTokenId: '812', anchor: source.anchor, complete: true, clear: true,
    checks: HOLDER_OBLIGATION_CHECKS.map(name => ({ name, status: 'CLEAR', count: 0 })) };
  validateHolderObligations(evidence, source);
  const refund = structuredClone(evidence); refund.checks.find(c => c.name === 'REFUNDS').count = 1; assert.throws(() => validateHolderObligations(refund, source));
  assert.throws(() => validateHolderObligations({ ...evidence, anchor: { ...source.anchor, number: '4' } }, source));
});
test('database-only observations cannot replace missing bid and escrow evidence', async () => {
  const pools = Object.fromEntries(['application','training','holder','legacy'].map(name => [name, { query: async () => ({ rows: [{ count: '0' }] }) }]));
  const evidence = await createHolderObligationReader({ descriptors: HOLDER_DATABASE_OBLIGATION_DESCRIPTORS, pools })(source);
  assert.equal(evidence.complete, false); assert.equal(evidence.clear, false);
  assert.equal(evidence.checks.find(check => check.name === 'BIDS').status, 'UNKNOWN');
  assert.throws(() => validateHolderObligations(evidence, source));
});
test('missing all-owner public paid hold reader remains an unresolved purchase obligation', async () => {
  const pools = Object.fromEntries(['application','training','holder','legacy'].map(name => [name, { query: async sql => {
    if (sql.includes('broker_public_paid_pending_for_token')) throw Error('FUNCTION_NOT_INSTALLED');
    return { rows: [{ count: '0' }] };
  } }]));
  const evidence = await createHolderObligationReader({ descriptors: HOLDER_DATABASE_OBLIGATION_DESCRIPTORS, pools })(source);
  assert.equal(evidence.checks.find(check => check.name === 'PURCHASES').status, 'UNKNOWN');
});
test('source wallet addresses are dynamically resolved for arbitrary IDs and both owners are live checked', async () => {
  const code = '0x6000', runtimeBytecodeHash = keccak256(code), reads = [];
  const pins = ['V1', 'V2', 'V3', 'AGENT'].map((role, i) => [role, { address: address(30 + i), runtimeBytecodeHash }, { address: address(40 + i), runtimeBytecodeHash }]);
  let wrongOwner = false;
  const client = () => ({ getChainId: async () => 4663, getBlock: async () => ({ number: 5n, hash: hash(5), timestamp: 1800000000n }),
    getCode: async ({ address: at }) => [HOLDER_BURN_COLLECTION, ...pins.flatMap(p => [p[1].address, p[2].address])].includes(at) ? code : '0x',
    getBalance: async () => 0n, getTransactionCount: async () => 0,
    readContract: async q => { reads.push(q); if (q.functionName === 'ownerOf') return wrongOwner ? address(2) : owner;
      if (q.functionName === 'account') return address(10 + pins.findIndex(p => p[1].address === q.address)); return 0n; } });
  const options = { clients: [client(), client()], selection, pins, collectionCodeHash: runtimeBytecodeHash, now: () => 1800000000000 };
  const result = await readHolderSource(options); assert.equal(result.wallets.length, 4);
  assert.equal(reads.filter(r => r.functionName === 'account').every(r => r.args[0] === 812n), true);
  wrongOwner = true; await assert.rejects(readHolderSource(options), /OWNER_CHANGED/);
});
