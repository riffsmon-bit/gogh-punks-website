import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, http, parseAbi } from 'viem';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';
import { validateReviewedTrainingSnapshot, validateReviewedTrainingReview } from '../site/forge-reviewed-training.js';
import { validateTrainingReview, trainingCalldata } from '../site/forge-training-transaction.js';
const HASH = `0x${'2'.repeat(64)}`, ZERO = `0x${'0'.repeat(64)}`;
const researchClient = { getChainId: async () => 4663, getBlock: async () => ({ number: 123n, hash: HASH }),
  getCode: async () => '0x60016000', getStorageAt: async () => ZERO,
  readContract: async () => true };
async function harness(t) {
  const preview = await startPreview({ controlCenterTraining: true, reviewedTraining: true, researchClient });
  t.after(() => preview.close());
  const read = async (tokenId = 44) => {
    const r = await fetch(`${preview.url}/api/forge?tokenId=${tokenId}`); assert.equal(r.status, 200);
    return validateReviewedTrainingSnapshot(await r.json(), tokenId);
  };
  const initial = await read();
  const post = async (path, body) => {
    const r = await fetch(preview.url + path, { method: 'POST', headers: { origin: preview.url,
      'content-type': 'application/json', 'x-forge-nonce': initial.localTrainingNonce }, body: JSON.stringify(body) });
    assert.equal(r.status, 200, await r.clone().text()); return r.json();
  };
  const prepare = async (operation, extra = {}, tokenId = 44) => {
    const state = await read(tokenId), action = { operation, ...extra };
    const review = await post('/api/local-training/prepare', { tokenId, expectedBlock: state.blockNumber, ...action });
    validateReviewedTrainingReview(review, state, action); return { state, action, review };
  };
  const confirm = review => post('/api/local-training/confirm', { intentId: review.intentId });
  return { preview, read, post, prepare, confirm, key: initial.skills.find(s => s.id === 3).key, initial };
}
test('guarded shared coordinator learns once, recovers receipts, equips and closes tools on unequip', { timeout: 60000 }, async t => {
  const h = await harness(t), { review } = await h.prepare('learn', { key: h.key });
  assert.equal((await h.read()).credits, '1');
  assert.equal(review.transaction.data.slice(0, 10), '0x11fb3835');
  h.preview.reopenCoordinator(); // Prepared guarded calldata survives journal reconstruction.
  h.preview.setReceiptVisibility(false);
  const pending = await h.confirm(review); assert.equal(pending.status, 'SUBMITTED');
  h.preview.reopenCoordinator();
  h.preview.setReceiptVisibility(true);
  const result = await h.post('/api/local-training/status', { intentId: review.intentId });
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.transactionHash, pending.transactionHash);
  let state = validateReviewedTrainingSnapshot(result.snapshot, 44);
  assert.equal(state.credits, '0'); assert.equal(state.learned.length, 1);
  assert.deepEqual(state.capabilityContext.effectiveMcpTools, []);
  assert.equal(state.trainingGuard.nonce, String(BigInt(review.trainingGuard.nonce) + 1n));
  assert.equal((await h.confirm(review)).transactionHash, pending.transactionHash);
  assert.equal((await h.read()).history.filter(e => e.name === 'SkillLearned').length, 1);
  const equip = await h.prepare('equip', { slot: 0, key: h.key });
  state = (await h.confirm(equip.review)).snapshot;
  assert.ok(state.capabilityContext.effectiveMcpTools.includes('inspect_contract'));
  assert.equal((await h.post('/api/local-tool', { tokenId: 44, name: 'inspect_contract' })).result.codeBytes, 4);
  const unequip = await h.prepare('unequip', { slot: 0 });
  state = (await h.confirm(unequip.review)).snapshot;
  assert.deepEqual(state.capabilityContext.effectiveMcpTools, []); assert.equal(state.learned.length, 1);
  const unlocked = await h.prepare('unlock', {}, 1);
  const afterUnlock = await h.confirm(unlocked.review);
  assert.equal(afterUnlock.status, 'CONFIRMED'); assert.equal(afterUnlock.snapshot.slots, 3);
  assert.equal(afterUnlock.snapshot.credits, '0');
});
test('guarded browser checks reject altered guard, calldata, envelope and legacy downgrade', { timeout: 60000 }, async t => {
  const h = await harness(t), { review, state, action } = await h.prepare('learn', { key: h.key });
  assert.throws(() => validateTrainingReview(review, state, action));
  for (const alter of [r => delete r.trainingGuard, r => r.trainingGuard.nonce = '99',
    r => r.trainingGuard.protocol = 'LEGACY', r => r.trainingGuard.stateHash = HASH,
    r => r.trainingGuard.deadline = String(BigInt(r.trainingGuard.deadline) + 1n),
    r => r.trainingGuard.unknownAuthority = true, r => r.transaction.data = trainingCalldata({ tokenId: 44, ...action }),
    r => r.transaction.value = '0x1', r => r.transaction.chainId = '0x1237', r => r.transaction.to = state.owner,
    r => r.slot = 2, r => r.expiresAt += 1000]) {
    const changed = structuredClone(review); alter(changed);
    assert.throws(() => validateReviewedTrainingReview(changed, state, action));
  }
  for (const alter of [s => delete s.trainingGuard, s => s.trainingGuard.protocol = 'LEGACY',
    s => s.trainingGuard.nonce = '-1', s => s.trainingGuard.stateHash = ZERO,
    s => s.history.find(e => e.name === 'TrainingReviewApplied').args.operation = 10,
    s => s.history.find(e => e.name === 'TrainingReviewApplied').args.nonce = '-1']) {
    const changed = structuredClone(state); alter(changed);
    assert.throws(() => validateReviewedTrainingSnapshot(changed, 44));
  }
  const legacy = await fetch(h.preview.url + '/api/local-training', { method: 'POST' });
  assert.equal(legacy.status, 409); assert.equal((await h.read()).credits, '1');
});
test('guarded learned state persists across round trip, but an outstanding review is invalidated', { timeout: 60000 }, async t => {
  const h = await harness(t), { review, state } = await h.prepare('learn', { key: h.key });
  await h.preview.roundTripFixture(44);
  const after = await h.read();
  assert.equal(after.owner, state.owner); assert.equal(after.trainingGuard.stateHash, state.trainingGuard.stateHash);
  assert.notEqual(after.ownershipEpoch, state.ownershipEpoch); // Worker history, NOT a synthetic on-chain epoch.
  const result = await h.confirm(review);
  assert.equal(result.status, 'INVALIDATED'); assert.equal(result.transactionHash, null);
  assert.equal((await h.read()).credits, '1');
  const fresh = await h.prepare('learn', { key: h.key }); assert.equal((await h.confirm(fresh.review)).status, 'CONFIRMED');
  await h.preview.roundTripFixture(44); assert.equal((await h.read()).learned.length, 1);
});
test('a transaction delayed AFTER wallet preflight expires on chain and consumes no training credit', { timeout: 60000 }, async t => {
  const h = await harness(t), { review } = await h.prepare('learn', { key: h.key });
  h.preview.expireNextSubmission();
  const result = await h.confirm(review);
  assert.equal(result.status, 'REVERTED'); assert.match(result.transactionHash, /^0x[0-9a-f]{64}$/);
  const client = createPublicClient({ transport: http(`http://127.0.0.1:${h.preview.resumeConfig.rpcPort}`) });
  assert.equal(await client.getChainId(), 31337);
  const abi = parseAbi(['function trainingCredits(uint256) view returns(uint256)', 'function trainingReviewNonce(uint256) view returns(uint256)']);
  const read = functionName => client.readContract({ address: h.initial.progression, abi, functionName, args: [44n] });
  assert.equal(await read('trainingCredits'), 1n); assert.equal(await read('trainingReviewNonce'), BigInt(review.trainingGuard.nonce));
  const receipt = await client.getTransactionReceipt({ hash: result.transactionHash });
  assert.equal(receipt.status, 'reverted'); assert.ok(receipt.gasUsed > 0n); // Reversion is not free network gas.
  assert.equal((await h.confirm(review)).transactionHash, result.transactionHash);
});
test('guarded server resumes its own journal and rejects protocol downgrade', { timeout: 60000 }, async t => {
  const h = await harness(t), { review } = await h.prepare('learn', { key: h.key });
  const result = await h.confirm(review); assert.equal(result.status, 'CONFIRMED');
  await h.preview.suspend();
  await assert.rejects(startPreview({ controlCenterTraining: true, resume: h.preview.resumeConfig }), /PROTOCOL/);
  const resumed = await startPreview({ controlCenterTraining: true, reviewedTraining: true, resume: h.preview.resumeConfig, researchClient });
  t.after(() => resumed.close());
  const state = await (await fetch(resumed.url + '/api/forge?tokenId=44')).json();
  validateReviewedTrainingSnapshot(state, 44); assert.equal(state.learned.length, 1);
  assert.equal(state.history.filter(e => e.name === 'SkillLearned').length, 1);
});
test('guarded page serves explicit adapter and all dependencies without authorizing burns', { timeout: 60000 }, async t => {
  const h = await harness(t);
  const html = await (await fetch(h.preview.url + '/control-center?testPunk=44')).text();
  assert.match(html, /ON-CHAIN REVIEW TEST/); assert.match(html, /src="\/reviewed-control-center.mjs"/);
  for (const path of ['/reviewed-control-center.mjs', '/forge-reviewed-training.js', '/forge-reviewed-calldata.js', '/forge-training.js']) {
    const r = await fetch(h.preview.url + path); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
  }
  assert.equal(h.initial.canBurn, false); assert.equal(h.initial.productionReadyCount, 0);
});
