import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSacrifice, BURN_WALLET_ROLES } from '../broker/src/v4/skill-forge/burn-eligibility.mjs';

const owner = `0x${'11'.repeat(20)}`;
const blockHash = `0x${'22'.repeat(32)}`;
function empty() {
  return { chainId: 4663, owner, burnOwner: owner, trainOwner: owner, punkToBurn: '93', punkToTrain: '119',
    burnTokenExists: true, trainTokenExists: true, checkedAt: 1000, blockHash,
    openMissions: 0, activeAutomation: 0, unsettledTransactions: 0, legacyLocks: 0,
    wallets: BURN_WALLET_ROLES.map((role, i) => ({ role, address: `0x${String(i + 1).repeat(40)}`,
      checkedAt: 1000, blockHash, nativeWei: '0', entryPointDepositWei: '0', nftCount: 0,
      erc20AssetCount: 0, otherAssetCount: 0, inventoryComplete: true })) };
}
const assess = (snapshot) => assessSacrifice(snapshot, { now: 1000 });
test('even complete empty mock inventory never enables production burn', () => {
  assert.equal(assess(empty()).status, 'CHECKS_PASSED_PRODUCTION_LOCKED');
  assert.equal(assess(empty()).canBurn, false);
});
for (const role of BURN_WALLET_ROLES) {
  for (const field of ['nativeWei', 'entryPointDepositWei', 'nftCount', 'erc20AssetCount', 'otherAssetCount']) {
    test(`${role} ${field} blocks sacrifice including dust`, () => {
      const snapshot = empty(); snapshot.wallets.find((w) => w.role === role)[field] = field.endsWith('Wei') ? '1' : 1;
      assert.ok(assess(snapshot).reasons.some((r) => r.code === 'ASSETS_PRESENT'));
      assert.equal(assess(snapshot).nextAction, 'REVIEW_WALLET_AND_WITHDRAW');
    });
  }
}
test('93 canonical gas is blocked even when agent account is empty', () => {
  const snapshot = empty(); snapshot.wallets[2].nativeWei = '1200000000000000';
  assert.equal(assess(snapshot).status, 'BLOCKED');
});
for (const field of ['openMissions', 'activeAutomation', 'unsettledTransactions', 'legacyLocks']) {
  test(`${field} missing or nonzero fails closed`, () => {
    const snapshot = empty(); delete snapshot[field]; assert.equal(assess(snapshot).status, 'BLOCKED');
    snapshot[field] = 1; assert.equal(assess(snapshot).status, 'BLOCKED');
  });
}
test('missing, unknown, stale, duplicated and partial wallet evidence is blocked', () => {
  for (const mutate of [s => s.wallets.pop(), s => s.wallets.push(s.wallets[0]),
    s => s.wallets[0].nativeWei = null, s => s.wallets[0].inventoryComplete = false,
    s => s.wallets[0].checkedAt = 0, s => s.checkedAt = -31000,
    s => s.wallets[0].blockHash = `0x${'33'.repeat(32)}`]) {
    const snapshot = empty(); mutate(snapshot); assert.equal(assess(snapshot).status, 'BLOCKED');
  }
});
test('same token, wrong owner, burned target and wrong chain fail closed', () => {
  for (const mutate of [s => s.punkToTrain = '93', s => s.burnOwner = `0x${'44'.repeat(20)}`,
    s => s.trainTokenExists = false, s => s.chainId = 1]) {
    const snapshot = empty(); mutate(snapshot); assert.equal(assess(snapshot).status, 'BLOCKED');
  }
  assert.equal(assess(null).canBurn, false);
});
