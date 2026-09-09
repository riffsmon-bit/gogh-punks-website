import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters } from 'viem';
import { createLocalTrainingIntents } from '../broker/src/v4/skill-forge/training-intents.mjs';
import { trainingCalldata, validateTrainingReview } from '../site/forge-training-transaction.js';
import { createTrainingWalletAdapter } from '../site/forge-training-wallet.js';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';
import { openTrainingJournal } from '../broker/src/v4/skill-forge/training-journal.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const owner = `0x${'1'.repeat(40)}`, progression = `0x${'2'.repeat(40)}`, key = `0x${'3'.repeat(64)}`;
const hash = `0x${'4'.repeat(64)}`, blockHash = `0x${'5'.repeat(64)}`, zero = `0x${'0'.repeat(64)}`;
function fixture() {
  const f = { now: 1000, sends: 0, chain: 31337, receiptAvailable: true,
    state: { localOnly: true, chainId: 31337, canBurn: false, tokenId: 44, owner, progression, collection: owner, registry: progression,
      blockNumber: '10', credits: '1', slots: 1, cap: 7, learned: [], equipped: [zero] } };
  const abi = parseAbi(['event SkillLearned(uint256 indexed tokenId,bytes32 indexed key,uint8 level)']);
  f.receipt = { status: 'success', transactionHash: hash, blockNumber: 11n, blockHash, gasUsed: 100_000n, effectiveGasPrice: 1n, logs: [{ address: progression,
    topics: encodeEventTopics({ abi, eventName: 'SkillLearned', args: { tokenId: 44n, key } }), data: encodeAbiParameters(parseAbiParameters('uint8'), [1]) }] };
  f.client = { getChainId: async () => f.chain, simulateContract: async () => ({}), estimateGas: async () => 100_000n, getGasPrice: async () => 1n,
    getTransactionReceipt: async () => { if (!f.receiptAvailable) throw Error('Not found'); return f.receipt; },
    getTransaction: async () => ({ from: owner, to: progression, input: f.last.data, value: 0n, gas: 120_000n, gasPrice: 1n, ...f.transactionOverride }),
    getBlock: async () => ({ hash: f.canonicalHash ?? blockHash }) };
  f.makeManager = journal => createLocalTrainingIntents({ client: f.client, owner, progression, approvedKeys: [key], now: () => f.now, journal,
    readSnapshot: async () => structuredClone(f.state), sendTransaction: async tx => { f.sends++; f.last = tx; if (f.send) return f.send(); return hash; } });
  f.manager = f.makeManager();
  f.prepare = () => f.manager.prepare({ tokenId: 44, operation: 'learn', key, expectedBlock: '10' });
  return f;
}
test('review contains exact zero-value calldata and a bounded gas estimate; prepare never signs', async () => {
  const f = fixture(), review = await f.prepare();
  assert.equal(f.sends, 0); assert.equal(review.maximumGas, '120000'); assert.equal(review.maximumNetworkFeeWei, '120000');
  assert.equal((await f.manager.status(review.intentId)).status, 'NOT_SUBMITTED'); assert.equal(f.sends, 0);
  validateTrainingReview(review, f.state, { operation: 'learn', key }, f.now);
  for (const altered of [{ value: '0x1' }, { to: owner }, { chainId: '0x1237' }, { data: '0x1234' }, { gas: '0xffffffffff' }, { extra: 'unsafe' }]) {
    assert.throws(() => validateTrainingReview({ ...review, transaction: { ...review.transaction, ...altered } }, f.state, { operation: 'learn', key }, f.now), /Unverified/);
  }
  const confirmed = await f.manager.confirm(review.intentId); assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal((await f.manager.confirm(review.intentId)).transactionHash, hash); assert.equal(f.sends, 1);
});
for (const change of ['owner', 'chain', 'credits', 'equipment', 'expiry', 'ownershipEpoch']) test(`${change} change invalidates review without sending`, async () => {
  const f = fixture(), review = await f.prepare();
  if (change === 'owner') f.state.owner = progression;
  if (change === 'chain') f.chain = 4663;
  if (change === 'credits') f.state.credits = '0';
  if (change === 'equipment') f.state.equipped = [key];
  if (change === 'expiry') f.now += 60001;
  if (change === 'ownershipEpoch') f.state.ownershipEpoch = 'transferred-away-and-back';
  assert.equal((await f.manager.confirm(review.intentId)).status, 'INVALIDATED'); assert.equal(f.sends, 0);
});
test('pending receipt and transport retry never broadcast twice or allow another review', async () => {
  const f = fixture(), review = await f.prepare(); f.receiptAvailable = false;
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED');
  await assert.rejects(f.prepare(), /UNRESOLVED/);
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED'); assert.equal(f.sends, 1);
  assert.equal((await f.manager.status(review.intentId)).status, 'SUBMITTED'); assert.equal(f.sends, 1);
  f.receiptAvailable = true;
  assert.equal((await f.manager.confirm(review.intentId)).status, 'CONFIRMED'); assert.equal(f.sends, 1);
  f.receiptAvailable = false; // A previously returned receipt disappears after a reorg.
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED'); await assert.rejects(f.prepare(), /UNRESOLVED/);
});
test('two reviews cannot race the same Punk while its wallet request is pending', async () => {
  const f = fixture(), a = await f.prepare(), b = await f.prepare(); let release;
  f.send = () => new Promise(resolve => { release = resolve; });
  const first = f.manager.confirm(a.intentId);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.manager.confirm(a.intentId)).status, 'AWAITING_WALLET');
  await assert.rejects(f.manager.confirm(b.intentId), /UNRESOLVED/);
  release(hash); await first; assert.equal(f.sends, 1);
});
test('wallet rejection is distinct from ambiguous submission; ambiguous reviews block further sends', async () => {
  for (const code of [4001, -32000]) {
    const f = fixture(), review = await f.prepare(); f.send = () => { throw Object.assign(Error('wallet error'), { code }); };
    assert.equal((await f.manager.confirm(review.intentId)).status, code === 4001 ? 'REJECTED' : 'SUBMISSION_UNKNOWN');
    if (code !== 4001) await assert.rejects(f.prepare(), /UNRESOLVED/);
    assert.equal((await f.manager.confirm(review.intentId)).status, code === 4001 ? 'REJECTED' : 'SUBMISSION_UNKNOWN');
    if (code !== 4001) await assert.rejects(f.prepare(), /UNRESOLVED/);
    assert.equal(f.sends, 1);
  }
});
for (const wrong of ['event', 'calldata', 'canonicalBlock', 'fee']) test(`wrong ${wrong} cannot count as confirmed training`, async () => {
  const f = fixture(), review = await f.prepare();
  if (wrong === 'event') f.receipt.logs = [];
  if (wrong === 'calldata') f.transactionOverride = { input: '0x1234' };
  if (wrong === 'canonicalBlock') f.canonicalHash = zero;
  if (wrong === 'fee') f.receipt.effectiveGasPrice = 100n;
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED'); assert.equal(f.sends, 1);
});
for (const scenario of ['success', 'chain', 'account', 'state', 'rejection']) test(`EIP-1193 wallet boundary: ${scenario}`, async () => {
  const f = fixture(); f.now = Date.now(); const review = await f.prepare(); const calls = [];
  const snapshot = structuredClone(f.state);
  const adapter = createTrainingWalletAdapter({ readSnapshot: async () => scenario === 'state' ? { ...snapshot, credits: '0' } : snapshot,
    provider: { request: async request => {
      calls.push(request);
      if (request.method === 'eth_chainId') return scenario === 'chain' ? '0x1237' : '0x7a69';
      if (request.method === 'eth_accounts') return [scenario === 'account' ? progression : owner];
      if (request.method === 'eth_sendTransaction') { if (scenario === 'rejection') throw Object.assign(Error('Rejected'), { code: 4001 }); return hash; }
      throw Error('Unexpected wallet method');
    } } });
  const submit = () => adapter.submit({ review, snapshot, action: { operation: 'learn', key } });
  if (scenario === 'success') { assert.equal((await submit()).status, 'SUBMITTED'); assert.deepEqual(calls.at(-1).params, [review.transaction]); }
  else await assert.rejects(submit());
  assert.equal(calls.filter(c => c.method === 'eth_sendTransaction').length, ['success', 'rejection'].includes(scenario) ? 1 : 0);
  assert.ok(calls.every(c => ['eth_chainId', 'eth_accounts', 'eth_sendTransaction'].includes(c.method)));
  if (['success', 'rejection'].includes(scenario)) { await assert.rejects(submit(), /ALREADY_REQUESTED/); assert.equal(calls.filter(c => c.method === 'eth_sendTransaction').length, 1); }
});
test('browser fixed ABI matches the contract ABI for all four permitted operations', () => {
  const abi = parseAbi(['function learnSkill(uint256,bytes32)', 'function unlockSlot(uint256)', 'function equipSkill(uint256,uint8,bytes32)', 'function unequipSkill(uint256,uint8)']);
  for (const [operation, functionName, args, extra] of [['learn', 'learnSkill', [44n, key], { key }], ['unlock', 'unlockSlot', [44n], {}], ['equip', 'equipSkill', [44n, 2, key], { slot: 2, key }], ['unequip', 'unequipSkill', [44n, 2], { slot: 2 }]]) {
    assert.equal(trainingCalldata({ tokenId: 44, operation, ...extra }), encodeFunctionData({ abi, functionName, args }));
  }
  assert.throws(() => trainingCalldata({ tokenId: 44, operation: 'burn' }));
});
test('HTTP prepare → confirmed transaction → repeated confirm returns one real training event', { timeout: 60000 }, async t => {
  const preview = await startPreview({ controlCenterTraining: true }); t.after(() => preview.close());
  const read = async () => (await fetch(`${preview.url}/api/forge?tokenId=44`)).json();
  const state = await read(), skill = state.skills.find(s => s.id === 3);
  const post = (path, body, headers = {}) => fetch(preview.url + path, { method: 'POST', headers: { origin: preview.url,
    'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce, ...headers }, body: JSON.stringify(body) });
  const input = { tokenId: 44, expectedBlock: state.blockNumber, operation: 'learn', key: skill.key };
  assert.equal((await post('/api/local-training/prepare', input, { origin: 'https://evil.example' })).status, 403);
  const prepared = await post('/api/local-training/prepare', input); assert.equal(prepared.status, 200);
  const review = await prepared.json(); assert.equal((await read()).credits, '1');
  validateTrainingReview(review, state, { operation: 'learn', key: skill.key });
  assert.equal((await post('/api/local-training/confirm', { intentId: review.intentId, data: '0x1234' })).status, 409);
  const result = await (await post('/api/local-training/confirm', { intentId: review.intentId })).json();
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.snapshot.credits, '0');
  const retry = await (await post('/api/local-training/confirm', { intentId: review.intentId })).json();
  assert.equal(retry.transactionHash, result.transactionHash);
  assert.equal(retry.snapshot.history.filter(e => e.name === 'SkillLearned').length, 1);
  preview.reopenCoordinator();
  const restored = await (await post('/api/local-training/status', { intentId: review.intentId })).json();
  assert.equal(restored.status, 'CONFIRMED'); assert.equal(restored.transactionHash, result.transactionHash);
});

async function withJournal(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-journal-test-'));
  const options = { path: join(directory, 'journal.sqlite'), deploymentIdentity: 'a'.repeat(64) };
  let current = openTrainingJournal(options); t.after(() => current.close());
  return { options, get current() { return current; }, reopen() { current.close(); current = openTrainingJournal(options); return current; } };
}
test('disk journal restores a submitted hash after restart without broadcasting again', async t => {
  const j = await withJournal(t), f = fixture(); f.manager = f.makeManager(j.current);
  const review = await f.prepare(); f.receiptAvailable = false;
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED');
  f.manager = f.makeManager(j.reopen());
  assert.equal((await f.manager.recover(44))[0].transactionHash, hash);
  await assert.rejects(f.prepare(), /UNRESOLVED/);
  f.receiptAvailable = true;
  assert.equal((await f.manager.status(review.intentId)).status, 'CONFIRMED'); assert.equal(f.sends, 1);
});
test('process exit after durable pre-wallet marker recovers as blocked, never resent', async t => {
  const j = await withJournal(t), f = fixture(); f.manager = f.makeManager(j.current);
  const review = await f.prepare();
  const module = new URL('../broker/src/v4/skill-forge/training-journal.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {openTrainingJournal} from ${JSON.stringify(module)}; const j=openTrainingJournal(${JSON.stringify(j.options)});const e=j.loadAll()[0];e.status='AWAITING_WALLET';j.save(e);process.exit(23);`]);
  assert.equal(child.status, 23);
  f.manager = f.makeManager(j.reopen());
  assert.equal((await f.manager.status(review.intentId)).status, 'RECOVERY_REQUIRED');
  await assert.rejects(f.prepare(), /UNRESOLVED/); assert.equal(f.sends, 0);
});
test('same deployment journal supports concurrent status reads without stealing a wallet claim', async t => {
  const j = await withJournal(t), f = fixture(); f.manager = f.makeManager(j.current);
  const a = await f.prepare(), b = await f.prepare();
  const secondStore = openTrainingJournal(j.options); t.after(() => secondStore.close());
  const second = f.makeManager(secondStore); let release;
  f.send = () => new Promise(resolve => { release = resolve; });
  const first = f.manager.confirm(a.intentId); while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await second.status(a.intentId)).status, 'RECOVERY_REQUIRED');
  await assert.rejects(second.confirm(b.intentId), /UNRESOLVED/);
  release(hash); assert.equal((await first).status, 'CONFIRMED'); assert.equal(f.sends, 1);
});
for (const when of ['before_wallet', 'after_wallet']) test(`journal write failure ${when} stays fail-closed after recovery`, async t => {
  const j = await withJournal(t), f = fixture();
  const faultStore = { loadAll: () => j.current.loadAll(), save: entry => {
    if (when === 'before_wallet' && entry.status === 'AWAITING_WALLET' || when === 'after_wallet' && entry.transactionHash) throw Error('DISK_FULL');
    j.current.save(entry);
  } };
  f.manager = f.makeManager(faultStore); const review = await f.prepare();
  assert.equal((await f.manager.confirm(review.intentId)).status, 'RECOVERY_REQUIRED');
  assert.equal(f.sends, when === 'before_wallet' ? 0 : 1);
  f.manager = f.makeManager(j.reopen()); await assert.rejects(f.prepare(), /UNRESOLVED/);
  assert.equal((await f.manager.status(review.intentId)).status, 'RECOVERY_REQUIRED');
});
test('journal refuses a different deployment identity', async t => {
  const j = await withJournal(t);
  assert.throws(() => openTrainingJournal({ ...j.options, deploymentIdentity: 'b'.repeat(64) }), /DEPLOYMENT_MISMATCH/);
});
test('journal corruption blocks all new wallet actions rather than starting an empty ledger', async t => {
  const j = await withJournal(t), f = fixture(); f.manager = f.makeManager(j.current);
  const review = await f.prepare();
  const corruptor = new DatabaseSync(j.options.path);
  corruptor.prepare('UPDATE training_intents SET checksum=? WHERE id=?').run('bad-checksum', review.intentId); corruptor.close();
  f.manager = f.makeManager(j.reopen());
  await assert.rejects(f.manager.confirm(review.intentId), /JOURNAL_CORRUPT/);
  await assert.rejects(f.prepare(), /JOURNAL_UNAVAILABLE/); assert.equal(f.sends, 0);
});
test('stale journal revision cannot overwrite a newer state', async t => {
  const j = await withJournal(t), f = fixture(); f.manager = f.makeManager(j.current); await f.prepare();
  const [first] = j.current.loadAll(), stale = structuredClone(first);
  first.status = 'CHECKING'; j.current.save(first);
  stale.status = 'REJECTED'; assert.throws(() => j.current.save(stale), /REVISION_CONFLICT/);
  assert.equal(j.current.loadAll()[0].status, 'CHECKING');
});
test('a reverted receipt must match the reviewed transaction before it releases the pending lock', async () => {
  const f = fixture(), review = await f.prepare(); f.receipt.status = 'reverted'; f.receipt.transactionHash = zero;
  assert.equal((await f.manager.confirm(review.intentId)).status, 'SUBMITTED'); await assert.rejects(f.prepare(), /UNRESOLVED/);
  f.receipt.transactionHash = hash;
  assert.equal((await f.manager.status(review.intentId)).status, 'REVERTED'); assert.equal(f.sends, 1);
});
test('real round-trip ownership transfer invalidates the old training review but keeps learned state', { timeout: 60000 }, async t => {
  const preview = await startPreview({ controlCenterTraining: true }); t.after(() => preview.close());
  const read = async () => (await fetch(`${preview.url}/api/forge?tokenId=1`)).json();
  const before = await read();
  const post = (path, body) => fetch(preview.url + path, { method: 'POST', headers: { origin: preview.url,
    'content-type': 'application/json', 'x-forge-nonce': before.localTrainingNonce }, body: JSON.stringify(body) });
  const review = await (await post('/api/local-training/prepare', { tokenId: 1, operation: 'unlock', expectedBlock: before.blockNumber })).json();
  await preview.roundTripFixture(1);
  const after = await read(); assert.equal(after.owner, before.owner); assert.notEqual(after.ownershipEpoch, before.ownershipEpoch);
  assert.deepEqual(after.learned, before.learned); assert.deepEqual(after.equipped, before.equipped); assert.equal(after.credits, before.credits);
  assert.equal((await (await post('/api/local-training/confirm', { intentId: review.intentId })).json()).status, 'INVALIDATED');
});
