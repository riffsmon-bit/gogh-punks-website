import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { keccak256 } from 'viem';
import { createReadOnlySkillReleaseReview } from '../broker/src/v4/skill-forge/read-only-skill-release.mjs';
import { createSkillAdminCoordinator } from '../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import { instructionHash, manifestHash, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { skillAdminFixture, ADMIN, REGISTRY, TX } from './fixtures/skill-admin.mjs';

const ZERO = `0x${'0'.repeat(64)}`, EVIDENCE = `0x${'e'.repeat(64)}`, CODE = '0x60006000';
const packages = await Promise.all(['social-scout', 'contract-detective'].map(async slug => {
  const root = new URL(`../broker/skills/${slug}/v1/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const instructions = await readFile(new URL('SKILL.md', root), 'utf8');
  return { manifest, instructions, manifestHash: manifestHash(manifest), instructionHash: instructionHash(instructions) };
}));
const [KEY, OTHER] = packages.map(pack => skillKey(pack.manifest.skillId, pack.manifest.version));

// Exercise the actual release reader and coordinator against shared registry
// observations. Only the durable-store and chain transport seams are fixtures.
function context(action = 'REGISTER') {
  const f = skillAdminFixture(), now = Date.now();
  const definitions = new Map(packages.map(pack => [skillKey(pack.manifest.skillId, 1), {
    skillId: pack.manifest.skillId, version: 1, manifestHash: pack.manifestHash,
    instructionHash: pack.instructionHash, prerequisite: ZERO,
    capabilities: pack.manifest.skillId === 7 ? 128n : 1n, riskTier: 0, status: 4,
    disabled: false, deprecated: false, replacement: ZERO, reviewEvidenceHash: EVIDENCE,
  }]));
  const target = definitions.get(KEY);
  if (action === 'REGISTER') definitions.delete(KEY);
  else target.status = action === 'MARK_READY' ? 3 : 0;
  const chain = { owner: ADMIN, code: CODE, globallyDisabled: false, disabledCapabilities: 0n };
  for (const client of f.clients) {
    client.getCode = async ({ address }) => address.toLowerCase() === REGISTRY ? chain.code : '0x';
    client.getBlock = async ({ blockNumber } = {}) => ({ number: blockNumber ?? 111n,
      hash: f.receipt.blockHash, timestamp: BigInt(Math.floor(now / 1000)) });
    client.readContract = async ({ functionName, args }) => {
      if (functionName === 'owner') return chain.owner;
      if (functionName === 'globallyDisabled') return chain.globallyDisabled;
      if (functionName === 'disabledCapabilities') return chain.disabledCapabilities;
      if (functionName === 'skillCount') return BigInt(definitions.size);
      if (functionName === 'keyAt') return [...definitions.keys()][Number(args[0])];
      const definition = definitions.get(args[0]);
      if (functionName === 'definition') return structuredClone(definition);
      if (functionName === 'available') return definition.status === 4 && !definition.disabled && !definition.deprecated
        && !chain.globallyDisabled && (definition.capabilities & chain.disabledCapabilities) === 0n;
      throw Error(`Unexpected read: ${functionName}`);
    };
  }
  const prepare = f.store.prepare;
  f.store.prepare = async (...args) => {
    await prepare(...args);
    f.row.key = args[2].key;
    return structuredClone(f.row);
  };
  const review = createReadOnlySkillReleaseReview({ client: f.clients[1],
    deployment: { chainId: 4663, registry: REGISTRY, registryCodeHash: keccak256(CODE) }, packages,
    reviewEvidence: Object.fromEntries(packages.map(pack => [skillKey(pack.manifest.skillId, 1), {
      status: 'APPROVED_FOR_REGISTRATION', manifestHash: pack.manifestHash,
      instructionHash: pack.instructionHash, evidenceHash: EVIDENCE,
    }])), now: () => now });
  const coordinator = createSkillAdminCoordinator({ ...f, review, now: () => now });
  const prepareTarget = () => coordinator.prepare({ administrator: ADMIN, key: KEY, requestKey: randomUUID() });
  const claim = record => coordinator.claim({ administrator: ADMIN, id: record.id, revision: record.revision, reviewHash: record.reviewHash });
  async function submitted() {
    const { record } = await prepareTarget();
    await claim(record);
    const tx = record.preparation.transaction;
    Object.assign(f.observed, { input: tx.data, gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice) });
    definitions.set(KEY, target);
    target.status = { REGISTER: 0, MARK_TESTING: 3, MARK_READY: 4 }[action];
    return record;
  }
  return { f, chain, definitions, target, review, coordinator, prepareTarget, claim, submitted,
    recover: record => coordinator.recover({ administrator: ADMIN, id: record.id, transactionHash: TX }) };
}

for (const patch of [{ disabled: true }, { deprecated: true }, { status: 5 }, { status: 6 }]) {
  test(`an unrelated blocked package preserves saved receipt recovery: ${JSON.stringify(patch)}`, async () => {
    const c = context(), record = await c.submitted();
    Object.assign(c.definitions.get(OTHER), patch);
    const saved = await c.coordinator.get({ administrator: ADMIN, id: record.id });
    assert.equal(saved.record.id, record.id);
    assert.equal(saved.snapshot.skills.find(skill => skill.key === OTHER).nextCalldata, null);
    const done = await c.recover(record);
    assert.equal(done.record.status, 'CONFIRMED');
    assert.equal(done.record.receipt.kind, 'ORIGINAL');
    assert.equal(done.transaction, undefined);
    await assert.rejects(c.coordinator.prepare({ administrator: ADMIN, key: OTHER, requestKey: randomUUID() }), /REVIEW_BLOCKED/);
    assert.equal(c.f.row.status, 'CONFIRMED');
  });
}

for (const [label, block] of [
  ['disabled', c => { c.target.disabled = true; }],
  ['deprecated', c => { c.target.deprecated = true; }],
  ['global pause', c => { c.chain.globallyDisabled = true; }],
  ['capability pause', c => { c.chain.disabledCapabilities = 128n; }],
]) {
  test(`READY confirmation remains recoverable after ${label}, with no new preparation or claim`, async () => {
    const c = context('MARK_READY'), record = await c.submitted();
    block(c);
    const snapshot = await c.review.inspect();
    assert.equal(snapshot.skills.find(skill => skill.key === KEY).available, false);
    assert.equal(snapshot.skills.find(skill => skill.key === KEY).nextCalldata, null);
    const done = await c.recover(record);
    assert.equal(done.record.status, 'CONFIRMED');
    assert.equal(done.record.receipt.registryActionConfirmed, true);
    assert.equal(done.transaction, undefined);
    await assert.rejects(c.prepareTarget(), /REVIEW_BLOCKED|EMERGENCY_DISABLED/);

    const unsent = context('MARK_READY'), { record: prepared } = await unsent.prepareTarget();
    block(unsent);
    await assert.rejects(unsent.claim(prepared), /REVIEW_BLOCKED|EMERGENCY_DISABLED/);
    assert.equal(unsent.f.row.status, 'PREPARED');
    assert.equal(unsent.f.log.includes('WALLET_REQUESTED'), false);
    await unsent.coordinator.cancel({ administrator: ADMIN, id: prepared.id, revision: prepared.revision });
    assert.equal(unsent.f.row.status, 'CANCELLED');
  });
}

test('blocked package keeps explicit nonce cancellation and exact replacement recovery available', async () => {
  const c = context('MARK_READY'), record = await c.submitted();
  c.target.deprecated = true;
  const { cancellation } = await c.coordinator.prepareCancellation({ administrator: ADMIN, id: record.id, requestKey: randomUUID() });
  const claimed = await c.coordinator.claimCancellation({ administrator: ADMIN, id: record.id,
    cancellationId: cancellation.id, revision: cancellation.revision, reviewHash: cancellation.reviewHash });
  assert.equal(claimed.transaction.to, ADMIN);
  assert.equal(claimed.transaction.data, '0x');
  assert.equal(claimed.transaction.nonce, record.preparation.transaction.nonce);
  assert.equal(c.f.row.status, 'WALLET_REQUESTED');
  c.f.observed.to = ADMIN; c.f.observed.input = '0x'; c.f.receipt.to = ADMIN;
  const done = await c.recover(record);
  assert.equal(done.record.status, 'REPLACED');
  assert.equal(done.record.receipt.registryActionConfirmed, false);
  assert.equal(done.record.receipt.selfAccountCode, '0x');
});

for (const status of [5, 6]) test(`an unsent review cannot be claimed after registry status ${status}`, async () => {
  const c = context('MARK_READY'), { record } = await c.prepareTarget();
  c.target.status = status;
  await assert.rejects(c.claim(record), /REVIEW_BLOCKED/);
  assert.equal(c.f.row.status, 'PREPARED');
});

test('disabled READY receipt stays reserved until both providers observe twelve confirmations', async () => {
  const c = context('MARK_READY'), record = await c.submitted();
  c.target.disabled = true;
  c.f.clients[0].getBlockNumber = async () => 110n;
  assert.equal((await c.recover(record)).record.status, 'SUBMITTED');
  c.f.clients[0].getBlockNumber = async () => 111n;
  assert.equal((await c.recover(record)).record.status, 'CONFIRMED');
});

for (const [label, change, expected] of [
  ['administrator', c => { c.chain.owner = `0x${'2'.repeat(40)}`; }, /NOT_ADMINISTRATOR/],
  ['runtime', c => { c.chain.code = '0x6001'; }, /DEPLOYMENT_MISMATCH/],
  ['definition', c => { c.target.manifestHash = ZERO; }, /EXISTING_DEFINITION_MISMATCH/],
  ['review evidence', c => { c.target.reviewEvidenceHash = ZERO; }, /REGISTRY_DIVERGED/],
  ['saved envelope', c => { c.f.row.preparation.transaction.data = '0x'; }, /REVIEW_NOT_FOUND/],
  ['nonce', c => { c.f.observed.nonce++; }, /TRANSACTION_MISMATCH/],
  ['provider agreement', c => { c.f.clients[0].getTransactionReceipt = async () => ({ ...c.f.receipt, status: 'reverted' }); }, /PROVIDERS_DISAGREE/],
  ['canonical receipt block', c => { c.f.clients[0].getBlock = async () => ({ hash: ZERO }); }, /RECEIPT_REORG/],
]) {
  test(`disabled READY recovery still rejects changed ${label}`, async () => {
    const c = context('MARK_READY'), record = await c.submitted();
    c.target.disabled = true;
    change(c);
    await assert.rejects(c.recover(record), expected);
    assert.ok(['WALLET_REQUESTED', 'SUBMITTED'].includes(c.f.row.status));
  });
}
