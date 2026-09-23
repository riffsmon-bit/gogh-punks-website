import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, keccak256, parseAbi, zeroAddress } from 'viem';
import { createHolderBurnCoordinator } from '../broker/src/v4/skill-forge/holder-coordinator.mjs';
import { readHolderCreditEvidence } from '../broker/src/v4/skill-forge/holder-credit-evidence.mjs';
import { burnReviewDigest } from '../broker/src/v4/skill-forge/selected-burn-store.mjs';
import { holderBurnSelection } from '../broker/src/v4/skill-forge/holder-source.mjs';
import { HOLDER_OBLIGATION_CHECKS } from '../broker/src/v4/skill-forge/holder-obligations.mjs';

const a = n => `0x${n.toString(16).padStart(40, '0')}`, h = n => `0x${n.toString(16).padStart(64, '0')}`;
function fixture() {
  const owner = a(1), selection = holderBurnSelection(owner, '812', '119'), code = '0x6000', time = 1800000000000;
  const block = { number: 10n, hash: h(10), timestamp: 1800000000n };
  const release = { status: 'LIVE', productionBurnAuthorized: true, chainId: 4663, collection: selection.collection,
    registry: a(2), progression: a(3), trainingSource: a(4), feeCeilingWei: '1000000000000000' };
  for (const role of ['collection', 'registry', 'progression', 'trainingSource']) release[`${role}CodeHash`] = keccak256(code);
  let row = null, requested = 0, nonce = 0, approved = zeroAddress, asset = false, unknown = false, incomplete = false, paused = false;
  let obligations = true, control = true, receiptPresent = false, receiptReverted = false, receiptReorg = false, clock = time;
  const store = {
    current: async () => row && structuredClone(row), get: async id => row?.review.intentId === id ? structuredClone(row) : null,
    save: async review => { row = { review: structuredClone(review), reviewHash: burnReviewDigest(review), status: 'PREPARED', revision: 0, reportedHash: null, receipt: null }; return structuredClone(row); },
    update: async (id, revision, status, reportedHash, receipt = null) => {
      if (row.review.intentId !== id || row.revision !== revision || ['CONFIRMED', 'REVERTED', 'CANCELLED'].includes(row.status)) throw Error('HOLDER_JOURNAL_CHANGED');
      if (status === 'WALLET_REQUESTED') requested++;
      row = { ...row, revision: revision + 1, status, reportedHash, receipt }; return structuredClone(row);
    },
  };
  store.reviewStore = { get: async id => (await store.get(id))?.review, set: async (_id, review) => store.save(review) };
  const client = () => ({
    getChainId: async () => 4663, getBlock: async () => ({ ...block, hash: receiptReorg ? h(999) : block.hash }), getBlockNumber: async () => 22n,
    getCode: async () => code, getTransactionCount: async () => nonce, getBalance: async () => 10n ** 18n,
    getGasPrice: async () => 10n, estimateGas: async () => 100000n, call: async () => ({}), getLogs: async () => [],
    readContract: async ({ functionName }) => ({ collection: release.collection, progression: release.progression, registry: release.registry,
      trainingSource: release.trainingSource, ownerOf: owner, getApproved: approved, isApprovedForAll: false, totalSupply: 4295n,
      trainingCredits: 0n, burnReviewNonce: 0n, burnReviewStateHash: h(99), globallyDisabled: paused })[functionName],
    getTransactionReceipt: async ({ hash }) => {
      if (!receiptPresent) throw Error('PENDING');
      return { transactionHash: hash, blockNumber: block.number, blockHash: block.hash, status: receiptReverted ? 'reverted' : 'success', gasUsed: 90000n, effectiveGasPrice: 10n,
        logs: [{ address: release.collection, data: '0x', topics: encodeEventTopics({ abi: parseAbi(['event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId)']),
          eventName: 'Approval', args: { owner, approved: release.trainingSource, tokenId: 812n } }) }] };
    },
    getTransaction: async ({ hash }) => { const tx = row.review.transaction; return { hash, from: tx.from, to: tx.to, input: tx.data,
      value: 0n, chainId: 4663, nonce: Number(BigInt(tx.nonce)), gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice), blockHash: block.hash }; },
  });
  const source = { selection, anchor: { number: '10', hash: h(10), timestamp: String(block.timestamp) }, wallets: [10, 11, 12, 13].map(n => ({ address: a(n),
    nativeWei: '0', wethWei: '0', entryPointDepositWei: '0', sessionActive: false, pendingTransaction: false })) };
  const clients = [client(), client()];
  const options = { clients, release, store, selection, now: () => clock, readCredits: options => readHolderCreditEvidence({ ...options, paidReader: async () => null }), readSource: async () => structuredClone(source),
    historyScanner: { advance: async () => { if (!control) throw Error('CONTROL_FAILED'); return { complete: !incomplete, cursor: '10', anchorHash: h(10), assets: [] }; } },
    readInventory: async () => ({ complete: !unknown, empty: !asset, assets: [], nonstandardAssets: 'OWNER_REVIEW_REQUIRED' }),
    checkObligations: async () => ({ schema: 'GOGH_HOLDER_BURN_OBLIGATIONS_V1', sourceTokenId: '812', anchor: source.anchor, complete: true, clear: obligations,
      checks: HOLDER_OBLIGATION_CHECKS.map(name => ({ name, status: obligations ? 'CLEAR' : 'BLOCKED', count: obligations ? 0 : 1 })) }) };
  return { coordinator: createHolderBurnCoordinator(options), options, source, row: () => row, requested: () => requested,
    asset: () => { asset = true; }, unknown: () => { unknown = true; }, incomplete: () => { incomplete = true; },
    obligations: () => { obligations = false; }, nonce: () => { nonce++; }, expire: () => { clock += 60001; },
    confirm: () => { approved = release.trainingSource; receiptPresent = true; }, revert: () => { receiptPresent = true; receiptReverted = true; }, reorg: () => { receiptReorg = true; } };
}
const claim = record => ({ intentId: record.review.intentId, revision: record.revision, reviewHash: record.reviewHash,
  confirmation: '', nonstandardReviewed: true });
test('real reviewed-burn preparation supports a general source/target with durable exact-once claim', async () => {
  const f = fixture(), prepared = await f.coordinator.prepare('APPROVE');
  assert.equal(prepared.record.review.state.sourceTokenId, '812'); assert.equal(prepared.record.review.state.targetTokenId, '119');
  const results = await Promise.allSettled([f.coordinator.claim(claim(prepared.record)), f.coordinator.claim(claim(prepared.record))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.requested(), 1);
  await assert.rejects(f.coordinator.cancel({ intentId: f.row().review.intentId, revision: f.row().revision }), /JOURNAL_CHANGED/);
});
test('assets, incomplete history, unknown holdings and unresolved activity block review preparation', async () => {
  for (const block of ['asset', 'unknown', 'incomplete', 'obligations']) {
    const f = fixture(); f[block](); assert.equal((await f.coordinator.check()).canBurn, false);
    await assert.rejects(f.coordinator.prepare('APPROVE')); assert.equal(f.row(), null);
  }
});
test('fresh funds arriving after review block claim without consuming a wallet request', async () => {
  const f = fixture(), prepared = await f.coordinator.prepare('APPROVE'); f.source.wallets[0].nativeWei = '1';
  await assert.rejects(f.coordinator.claim(claim(prepared.record)), /ASSETS_PRESENT/); assert.equal(f.requested(), 0);
});
test('nonce, review expiry and unreviewed nonstandard assets prevent the wallet claim', async () => {
  for (const condition of ['nonce', 'expire', 'nonstandard']) {
    const f = fixture(), prepared = await f.coordinator.prepare('APPROVE');
    if (condition !== 'nonstandard') f[condition]();
    await assert.rejects(f.coordinator.claim({ ...claim(prepared.record), nonstandardReviewed: condition !== 'nonstandard' })); assert.equal(f.requested(), 0);
  }
});
test('pending original receipt stays reserved and successful approval recovers after service restart', async () => {
  const f = fixture(), prepared = await f.coordinator.prepare('APPROVE'), claimed = await f.coordinator.claim(claim(prepared.record));
  const args = { intentId: claimed.record.review.intentId, revision: claimed.record.revision, transactionHash: h(100) };
  assert.equal((await f.coordinator.recover(args)).pending, true); assert.equal(f.row().status, 'WALLET_REQUESTED');
  f.confirm(); const restarted = createHolderBurnCoordinator(f.options); const result = await restarted.recover(args);
  assert.equal(result.record.status, 'CONFIRMED'); assert.equal(result.record.receipt.creditGain, 0); assert.equal(f.requested(), 1);
  await assert.rejects(restarted.recover(args), /JOURNAL_CHANGED/);
});
test('recovery works while release paused and reverting receipts receive closing canonical checks', async () => {
  const f = fixture(), prepared = await f.coordinator.prepare('APPROVE'), claimed = await f.coordinator.claim(claim(prepared.record));
  const args = { intentId: claimed.record.review.intentId, revision: claimed.record.revision, transactionHash: h(100) };
  const paused = createHolderBurnCoordinator({ ...f.options, release: { ...f.options.release, status: 'PAUSED' } });
  await assert.rejects(paused.prepare('APPROVE'), /NOT_RELEASED/); f.revert();
  const result = await paused.recover(args); assert.equal(result.record.status, 'REVERTED'); assert.equal(result.record.receipt.verifiedProviders, 2);
});
test('reorg cannot commit a completed or reverted recovery record', async () => {
  const f = fixture(), prepared = await f.coordinator.prepare('APPROVE'), claimed = await f.coordinator.claim(claim(prepared.record)); f.revert(); f.reorg();
  await assert.rejects(f.coordinator.recover({ intentId: claimed.record.review.intentId, revision: claimed.record.revision, transactionHash: h(100) }));
  assert.equal(f.row().status, 'WALLET_REQUESTED');
});
