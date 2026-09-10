import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAdministratorSelection, buildRegistryFeeReview, validateRegistryFeeReview,
  assertRegistryTransactionFeeLimits } from '../broker/src/v4/skill-forge/registry-administrator-review.mjs';
import { loadRegistryCanaryInputs, buildRegistryCanaryProposal, EMPTY_GUARDIAN_CONTEXT } from '../broker/src/v4/skill-forge/registry-canary.mjs';
import { manifestHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
const selection = JSON.parse(await readFile(new URL('../ops/forge-registry-admin-selection.json', import.meta.url), 'utf8'));
const inputs = await loadRegistryCanaryInputs();
const proposal = buildRegistryCanaryProposal({ inputs, guardian: selection.administrator, guardianContext: EMPTY_GUARDIAN_CONTEXT,
  nonce: '100', anchor: { number: '500', hash: `0x${'1'.repeat(64)}`, timestamp: 1789000000 } });
const observations = proposal.transactions.map((tx, i) => ({ nonce: tx.nonce, dataHash: manifestHash(tx),
  localGasEstimate: i ? '100001' : '700000', parentGasEstimate: '1000', publicCreationGasEstimate: i ? '0' : '800000' }));
const make = (overrides = {}) => buildRegistryFeeReview({ inputs, proposal, selection, observations, observedGasPriceWei: '100000000', ...overrides });
test('owner selected the exact registry administrator, not spending, wallet changes or launch', () => {
  const result = validateAdministratorSelection(selection);
  assert.equal(result.administrator, '0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6');
  assert.equal(result.ownerSelected, true); assert.equal(result.securityReviewComplete, false); assert.equal(result.deploymentAuthorized, false);
});
test('every authority escalation in the administrator selection is rejected', () => {
  for (const key of ['securityReviewComplete', 'feeBudgetApproved', 'deploymentAuthorized', 'configurationAuthorized',
    'productionTrainingAuthorized', 'productionBurnAuthorized', 'walletDelegationChangeAuthorized']) {
    assert.throws(() => validateAdministratorSelection({ ...selection, [key]: true }));
  }
  assert.throws(() => validateAdministratorSelection({ ...selection, ownerSelectionConfirmed: false }));
  assert.throws(() => validateAdministratorSelection({ ...selection, chainId: 1 }));
  assert.throws(() => validateAdministratorSelection({ ...selection, extraAuthority: true }));
  const hostile = { ...selection }; let invoked = false;
  Object.defineProperty(hostile, 'administrator', { get() { invoked = true; return selection.administrator; } });
  assert.throws(() => validateAdministratorSelection(hostile)); assert.equal(invoked, false);
});
test('fee proposal uses integer rounding, combines parent data cost once, and binds all eight intents', () => {
  const r = make();
  assert.equal(r.steps.length, 8); assert.equal(r.steps[0].composedGasEstimate, '800000');
  assert.equal(r.steps[0].proposedGasLimit, '1200000');
  assert.equal(r.steps[1].composedGasEstimate, '101001'); assert.equal(r.steps[1].proposedGasLimit, '151502');
  assert.ok(r.steps.every(s => s.proposedMaxFeePerGasWei === '200000000' && s.proposedMaxPriorityFeePerGasWei === '0'));
  assert.equal(r.proposedMaximumTotalWei, String((1200000n + 7n * 151502n) * 200000000n));
  assert.equal(r.selectionHash, manifestHash(selection)); assert.equal(r.proposalHash, proposal.proposalHash);
  assert.equal(r.feeBudgetApproved, false); assert.equal(r.canBroadcast, false); assert.equal(r.allStepsPubliclySimulated, false);
  const { reviewHash, ...body } = r; assert.equal(reviewHash, manifestHash(body));
});
test('fee observations cannot be reordered, omitted or detached from their transaction', () => {
  for (const o of [observations.slice(1), [...observations].reverse(), observations.map((v, i) => i ? v : { ...v, nonce: '101' }),
    observations.map((v, i) => i ? v : { ...v, dataHash: `0x${'2'.repeat(64)}` })]) assert.throws(() => make({ observations: o }));
});
test('fees reject fractional, unsafe, negative and excessive inputs without float conversion', () => {
  for (const value of ['0', '-1', '1.5', '1e8', '01', '10000000001', 100000000]) assert.throws(() => make({ observedGasPriceWei: value }));
  for (const field of ['localGasEstimate', 'parentGasEstimate', 'publicCreationGasEstimate']) {
    for (const value of ['-1', '1.5', '1e6', '01', 100000]) {
      assert.throws(() => make({ observations: observations.map((v, i) => i ? v : { ...v, [field]: value }) }));
    }
  }
  assert.throws(() => make({ observations: observations.map((v, i) => i ? v : { ...v, localGasEstimate: '2000001' }) }));
});
test('a creation-only quote cannot be reused as every step or treated as deployment authority', () => {
  assert.throws(() => make({ observations: observations.map(v => ({ ...v, publicCreationGasEstimate: '800000' })) }));
  assert.throws(() => make({ selection: { ...selection, administrator: `0x${'2'.repeat(40)}` } }));
  assert.throws(() => make({ proposal: { ...proposal, canBroadcast: true } }));
});
test('zero parent-data charge is supported explicitly, not silently invented', () => {
  const r = make({ observations: observations.map(v => ({ ...v, parentGasEstimate: '0' })) });
  assert.equal(r.steps[1].composedGasEstimate, '100001'); assert.equal(r.steps[1].parentGasEstimate, '0');
});
test('selection and fee module has no environment, signer, wallet, send or dynamic execution path', async () => {
  const source = await readFile(new URL('../broker/src/v4/skill-forge/registry-administrator-review.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|eth_send|sendTransaction|writeContract|createWalletClient|privateKeyToAccount|eval\(|child_process/);
});
test('fee review rebuild rejects a changed limit, total, lifetime, permission or binding', () => {
  const feeReview = make(); validateRegistryFeeReview({ inputs, proposal, selection, feeReview });
  for (const alter of [r => r.steps[0].proposedGasLimit = '2000000', r => r.steps[0].proposedMaxFeePerGasWei = '900000000',
    r => r.proposedMaximumTotalWei = '0', r => r.expiresAt++, r => r.canBroadcast = true,
    r => r.feeBudgetApproved = true, r => r.proposalHash = r.selectionHash]) {
    const copy = structuredClone(feeReview); alter(copy);
    assert.throws(() => validateRegistryFeeReview({ inputs, proposal, selection, feeReview: copy }));
  }
});
test('a receipt-backed transaction still must obey the reviewed gas, type and fee ceilings', () => {
  const step = make().steps[0], tx = { type: 'eip1559', value: 0n, gas: BigInt(step.proposedGasLimit),
    maxFeePerGas: BigInt(step.proposedMaxFeePerGasWei), maxPriorityFeePerGas: 0n };
  assert.equal(assertRegistryTransactionFeeLimits(tx, step), true);
  for (const alteration of [{ gas: tx.gas + 1n }, { maxFeePerGas: tx.maxFeePerGas + 1n }, { maxPriorityFeePerGas: 1n },
    { type: 'legacy' }, { type: 'eip7702' }, { value: 1n }, { gas: 0n }, { authorizationList: [{}] }]) {
    assert.throws(() => assertRegistryTransactionFeeLimits({ ...tx, ...alteration }, step));
  }
});
