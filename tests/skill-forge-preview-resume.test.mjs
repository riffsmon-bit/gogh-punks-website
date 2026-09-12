import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, http } from 'viem';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';

test('preview handover retains chain, credits, receipts and unknown submissions without resend', { timeout: 90000 }, async t => {
  const original = await startPreview({ controlCenterTraining: true });
  t.after(() => original.close());
  const config = original.resumeConfig;
  const rpc = createPublicClient({ transport: http(`http://127.0.0.1:${config.rpcPort}`) });
  const read = async (preview, id) => (await fetch(`${preview.url}/api/forge?tokenId=${id}`)).json();
  const post = async (preview, state, operation, body) => {
    const response = await fetch(`${preview.url}/api/local-training/${operation}`, { method: 'POST',
      headers: { origin: preview.url, 'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  let state = await read(original, 1);
  const review = await post(original, state, 'prepare', { tokenId: 1, operation: 'equip', slot: 1,
    key: state.skills.find(s => s.id === 4).key, expectedBlock: state.blockNumber });
  const confirmed = await post(original, state, 'confirm', { intentId: review.intentId });
  assert.equal(confirmed.status, 'CONFIRMED');
  state = await read(original, 44);
  const learning = await post(original, state, 'prepare', { tokenId: 44, operation: 'learn',
    key: state.skills.find(s => s.id === 3).key, expectedBlock: state.blockNumber });
  original.loseNextSubmissionHash();
  assert.equal((await post(original, state, 'confirm', { intentId: learning.intentId })).status, 'SUBMISSION_UNKNOWN');
  const before = await read(original, 44);
  const nonce = await rpc.getTransactionCount({ address: config.owner });
  await original.suspend();
  await assert.rejects(startPreview({ controlCenterTraining: true, resume: { ...config, owner: `0x${'1'.repeat(40)}` } }), /OWNER_CHANGED/);
  await assert.rejects(startPreview({ controlCenterTraining: true, resume: { ...config, collection: config.registry } }), /JOURNAL_DEPLOYMENT_MISMATCH/);
  await assert.rejects(startPreview({ controlCenterTraining: true, resume: { ...config, journalPath: `${config.journalPath}.missing` } }), /ENOENT/);
  const resumed = await startPreview({ controlCenterTraining: true, resume: config });
  t.after(() => resumed.close());
  const after = await read(resumed, 44);
  assert.equal(after.progression, before.progression);
  assert.equal(after.credits, before.credits);
  assert.deepEqual(after.learned, before.learned);
  assert.deepEqual(after.history, before.history);
  assert.notEqual(after.localTrainingNonce, before.localTrainingNonce);
  const recovery = await post(resumed, after, 'recover', { tokenId: 44 });
  assert.equal(recovery.records[0].status, 'SUBMISSION_UNKNOWN');
  assert.equal(recovery.records[0].intentId, learning.intentId);
  const trained = await read(resumed, 1);
  assert.equal((await post(resumed, trained, 'recover', { tokenId: 1 })).records[0].transactionHash, confirmed.transactionHash);
  const hash = after.history.find(e => e.name === 'SkillLearned').transactionHash;
  assert.equal((await post(resumed, after, 'recover-hash', { intentId: learning.intentId, transactionHash: hash })).status, 'CONFIRMED');
  assert.equal(await rpc.getTransactionCount({ address: config.owner }), nonce);
  await resumed.close();
  assert.equal(await rpc.getChainId(), 31337); // Attached preview does not own/kill the chain.
});
