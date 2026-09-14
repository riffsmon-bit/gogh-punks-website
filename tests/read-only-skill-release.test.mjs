import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, keccak256, parseAbi } from 'viem';
import { createReadOnlySkillReleaseReview } from '../broker/src/v4/skill-forge/read-only-skill-release.mjs';
import { skillKey, manifestHash, instructionHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
const manifest = JSON.parse(await readFile(new URL('../broker/skills/social-scout/v1/manifest.json', import.meta.url)));
const instructions = await readFile(new URL('../broker/skills/social-scout/v1/SKILL.md', import.meta.url), 'utf8');
const pack = { manifest, instructions, manifestHash: manifestHash(manifest), instructionHash: instructionHash(instructions) };
const key = skillKey(7, 1), owner = `0x${'1'.repeat(40)}`, registry = `0x${'2'.repeat(40)}`, code = '0x60006000';
const ZERO = `0x${'0'.repeat(64)}`, evidenceHash = `0x${'e'.repeat(64)}`;
const ABI = parseAbi(['function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8) returns(bytes32)', 'function setStatus(bytes32,uint8,bytes32)']);
function context() {
  const state = { chainId: 4663, owner, code, globallyDisabled: false, disabledCapabilities: 0n, existing: null,
    countOverride: null, pending: 7, latest: 7, gasPrice: 100n, estimate: 100_000n, balance: 10n ** 18n, reorg: false };
  const calls = [];
  const client = {
    getChainId: async () => state.chainId,
    getBlock: async args => ({ number: 99n, hash: `0x${(state.reorg && args?.blockNumber ? 'b' : 'a').repeat(64)}`, timestamp: 1000n }),
    getCode: async () => state.code,
    readContract: async ({ functionName, args }) => {
      calls.push(functionName);
      if (functionName === 'owner') return state.owner;
      if (functionName === 'globallyDisabled') return state.globallyDisabled;
      if (functionName === 'disabledCapabilities') return state.disabledCapabilities;
      if (functionName === 'skillCount') return state.countOverride ?? (state.existing ? 1n : 0n);
      if (functionName === 'keyAt') return key;
      if (functionName === 'definition') { assert.equal(args[0], key); return { ...state.existing }; }
      if (functionName === 'available') return state.existing.status === 4;
      throw Error('unexpected read');
    },
    call: async tx => { calls.push('simulate'); assert.equal(tx.value, 0n); assert.equal(tx.to, registry); },
    estimateGas: async () => state.estimate, getGasPrice: async () => state.gasPrice,
    getTransactionCount: async ({ blockTag }) => blockTag === 'latest' ? state.latest : state.pending,
    getBalance: async () => state.balance,
  };
  const options = { client, deployment: { chainId: 4663, registry, registryCodeHash: keccak256(code) },
    packages: [structuredClone(pack)], reviewEvidence: { [key]: { status: 'APPROVED_FOR_REGISTRATION',
      manifestHash: pack.manifestHash, instructionHash: pack.instructionHash, evidenceHash } }, now: () => 1_000_100 };
  const definition = status => ({ skillId: 7, version: 1, manifestHash: pack.manifestHash,
    instructionHash: pack.instructionHash, prerequisite: ZERO, capabilities: 128n, riskTier: 0, status,
    disabled: false, deprecated: false, replacement: ZERO, reviewEvidenceHash: evidenceHash });
  return { state, calls, client, options, definition, review: () => createReadOnlySkillReleaseReview(options) };
}
test('three exact registry steps are simulated, explicit and ready only after chain says READY', async () => {
  const c = context(), review = c.review();
  assert.equal((await review.inspect()).skills[0].action, 'REGISTER');
  const registered = await review.prepareNext({ key, administrator: owner });
  const decoded = decodeFunctionData({ abi: ABI, data: registered.transaction.data });
  assert.equal(decoded.functionName, 'register'); assert.deepEqual(decoded.args, [7, 1, pack.manifestHash, pack.instructionHash, ZERO, 128n, 0]);
  assert.equal(registered.transaction.value, '0x0'); assert.equal(registered.walletConfirmationRequired, true);
  assert.equal(registered.publicTransactions, 0); assert.equal(registered.serverReleaseActivated, false);
  assert.equal(registered.maximumNetworkFeeWei, '13200000'); assert.equal(registered.expiresAt, 1060100);
  c.state.existing = c.definition(0);
  const testing = await review.prepareNext({ key, administrator: owner });
  assert.deepEqual(decodeFunctionData({ abi: ABI, data: testing.transaction.data }).args, [key, 3, evidenceHash]);
  c.state.existing = c.definition(3);
  const ready = await review.prepareNext({ key, administrator: owner });
  assert.deepEqual(decodeFunctionData({ abi: ABI, data: ready.transaction.data }).args, [key, 4, evidenceHash]);
  c.state.existing = c.definition(4);
  assert.equal((await review.inspect()).skills[0].action, 'REGISTERED_READY');
  await assert.rejects(review.prepareNext({ key, administrator: owner }), /ALREADY_READY/);
  assert.equal(c.calls.filter(item => item === 'simulate').length, 3);
});
test('missing, wrong or unapproved review cannot prepare registry mutation', () => {
  for (const patch of [{ reviewEvidence: {} }, { reviewEvidence: { [key]: { status: 'TESTING' } } },
    { reviewEvidence: { [key]: { status: 'APPROVED_FOR_REGISTRATION', manifestHash: pack.manifestHash, instructionHash: pack.instructionHash, evidenceHash: ZERO } } }]) {
    const c = context(); assert.throws(() => createReadOnlySkillReleaseReview({ ...c.options, ...patch }), /REVIEW_REQUIRED/);
  }
});
test('transaction-capable packages and mismatched tool bits are excluded', () => {
  for (const patch of [{ capabilities: ['FREE_MINT'], requiredMcpTools: ['prepare_mint'] },
    { capabilities: ['PAID_MINT'] }, { requiredWalletCapabilities: ['SIGN'] }, { requiredExecutorCapabilities: ['MINT'] },
    { requiredMcpTools: ['inspect_contract'] }, { walletAuthority: 'ANY' }, { riskTier: 1 }]) {
    const c = context(), manifest = { ...pack.manifest, ...patch };
    c.options.packages[0] = { ...pack, manifest, manifestHash: manifestHash(manifest) };
    assert.throws(c.review, /READ_ONLY_PACKAGE_REQUIRED/);
  }
});
test('configuration is snapshotted so caller mutation cannot replace approved calldata', async () => {
  const c = context(), review = c.review(); c.options.packages[0].manifest.name = 'Changed';
  c.options.reviewEvidence[key].evidenceHash = ZERO;
  const next = await review.prepareNext({ key, administrator: owner });
  assert.equal(next.name, 'Social Scout'); assert.equal(next.reviewEvidenceHash, evidenceHash);
});
for (const [name, change, expected] of [
  ['wrong chain', { chainId: 1 }, /WRONG_CHAIN/], ['wrong code', { code: '0x6001' }, /DEPLOYMENT_MISMATCH/],
  ['unbounded registry', { countOverride: 129n }, /REGISTRY_BOUNDS/], ['reorg', { reorg: true }, /CHAIN_CHANGED/],
  ['pending administrator transaction', { pending: 8 }, /PENDING_ADMIN_TRANSACTION/],
  ['missing gas', { balance: 0n }, /ADMIN_GAS_REQUIRED/], ['fee too high', { gasPrice: 10n ** 12n }, /FEE_CEILING/],
  ['zero estimate', { estimate: 0n }, /FEE_UNAVAILABLE/], ['global pause', { globallyDisabled: true }, /EMERGENCY_DISABLED/],
  ['capability pause', { disabledCapabilities: 128n }, /EMERGENCY_DISABLED/],
]) test(`rejects ${name}`, async () => {
  const c = context(); Object.assign(c.state, change);
  await assert.rejects(c.review().prepareNext({ key, administrator: owner }), expected);
});
test('wrong administrator, unknown package and definition conflict are blocked', async () => {
  const c = context(), review = c.review();
  await assert.rejects(review.prepareNext({ key, administrator: registry }), /ADMINISTRATOR_CHANGED/);
  await assert.rejects(review.prepareNext({ key: ZERO, administrator: owner }), /KEY_NOT_REVIEWED/);
  c.state.existing = { ...c.definition(3), capabilities: 4n };
  await assert.rejects(review.inspect(), /EXISTING_DEFINITION_MISMATCH/);
});
test('blocked, rejected, deprecated and disabled versions cannot be silently promoted', async () => {
  for (const patch of [{ status: 5 }, { status: 6 }, { disabled: true }, { deprecated: true }]) {
    const c = context(); c.state.existing = { ...c.definition(3), ...patch };
    await assert.rejects(c.review().inspect(), /REVIEW_BLOCKED/);
  }
});
test('simulation revert returns no transaction and does not estimate or broadcast', async () => {
  const c = context(); c.client.call = async () => { throw Error('SIMULATION_REVERTED'); };
  c.client.estimateGas = async () => { throw Error('should not estimate'); };
  await assert.rejects(c.review().prepareNext({ key, administrator: owner }), /CHAIN_UNAVAILABLE/);
});
test('authenticated RPC failures cannot escape into administrator UI errors', async () => {
  const c = context(); c.client.getBlock = async () => { throw Error('https://rpc.invalid/SECRET_KEY private response'); };
  await assert.rejects(c.review().inspect(), error => error.message === 'SKILL_RELEASE_CHAIN_UNAVAILABLE');
});
test('owner or status change while preparing invalidates the review', async () => {
  for (const change of [state => { state.owner = registry; }, state => { state.existing = context().definition(3); }]) {
    const c = context(); c.client.estimateGas = async () => { change(c.state); return 100_000n; };
    await assert.rejects(c.review().prepareNext({ key, administrator: owner }), /STATE_CHANGED/);
  }
});
test('nonce advancing during second state read blocks stale transaction', async () => {
  const c = context(); let counts = 0;
  c.client.getTransactionCount = async () => ++counts > 2 ? 8 : 7;
  await assert.rejects(c.review().prepareNext({ key, administrator: owner }), /PENDING_ADMIN_TRANSACTION/);
});
test('old chain snapshot and regressed clock fail closed', async () => {
  for (const now of [() => 1_031_001, () => -1, () => NaN]) {
    const c = context(); c.options.now = now; await assert.rejects(c.review().inspect(), /STALE_CHAIN/);
  }
});
