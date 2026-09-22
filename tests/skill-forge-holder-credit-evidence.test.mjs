import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { readHolderCreditEvidence } from '../broker/src/v4/skill-forge/holder-credit-evidence.mjs';
import { createHolderInspection } from '../broker/src/v4/skill-forge/holder-inspection.mjs';
import { HOLDER_BURN_READINESS } from '../broker/src/v4/skill-forge/holder-release.mjs';

const hash = `0x${'12'.repeat(32)}`, address = `0x${'12'.repeat(20)}`, code = '0x6000';
const source = { selection: { owner: address, sourceTokenId: '812', targetTokenId: '119' },
  anchor: { number: '12', hash, timestamp: '1800000000' }, wallets: [] };
const release = { progression: address, progressionCodeHash: keccak256(code) };
const client = (credits = 0n) => ({ getCode: async () => code, readContract: async () => credits, getBlock: async () => ({ hash }) });
const options = (a = 0n, b = 0n, paid = null) => ({ clients: [client(a), client(b)], release, source, paidReader: async () => paid });

test('unused old burn credits and separately purchased credits block source eligibility', async () => {
  assert.equal((await readHolderCreditEvidence(options())).clear, true);
  assert.equal((await readHolderCreditEvidence(options(1n, 1n))).clear, false);
  const purchased = await readHolderCreditEvidence(options(0n, 0n, { purchasedCredits: '2' }));
  assert.equal(purchased.clear, false); assert.equal(purchased.purchasedCredits, '2');
});
test('paid reader receives exact source token and canonical inventory anchor', async () => {
  await readHolderCreditEvidence({ ...options(), paidReader: async input => {
    assert.equal(input.tokenId, '812'); assert.equal(input.owner, address); assert.deepEqual(input.anchor, source.anchor); return null;
  } });
});
test('ledger disagreement, runtime changes, stale anchors and unreadable paid ledgers fail closed', async () => {
  await assert.rejects(readHolderCreditEvidence(options(0n, 1n)), /DISAGREE/);
  await assert.rejects(readHolderCreditEvidence({ ...options(), release: { ...release, progressionCodeHash: hash } }), /RUNTIME/);
  const unavailable = options(); unavailable.clients[1].getBlock = async () => ({ hash: `0x${'34'.repeat(32)}` });
  await assert.rejects(readHolderCreditEvidence(unavailable), /REORG/);
  await assert.rejects(readHolderCreditEvidence({ ...options(), paidReader: async () => { throw Error('RPC'); } }), /RPC/);
  await assert.rejects(readHolderCreditEvidence(options(0n, 0n, { purchasedCredits: null })), /UNKNOWN/);
});
test('current public inspection cannot turn zero balances into approval or burn authority', async () => {
  const inspection = createHolderInspection({ clients: [client(), client()], selection: source.selection,
    readSource: async () => source, readCredits: async () => ({ status: 'VERIFIED', clear: true, burnCredits: '0', purchasedCredits: '0' }) });
  const result = await inspection.check();
  assert.equal(result.canBurn, false); assert.equal(result.inventory.complete, false); assert.equal(result.inventory.empty, false);
  assert.equal(result.history.automaticBackfill, false); assert.equal(result.obligations.complete, false);
  assert.equal((await inspection.get()).availability.publicBurnAvailable, false);
  assert.ok(HOLDER_BURN_READINESS.blockers.includes('PENDING_BURN_ASSET_PROTECTION_REQUIRED'));
  for (const operation of ['prepare', 'claim', 'cancel', 'recover']) await assert.rejects(inspection[operation]({}), /NOT_RELEASED/);
});
test('inspection surfaces assets, pending transactions, active sessions and unreadable credits', async () => {
  const inspection = createHolderInspection({ clients: [client(), client()], selection: source.selection,
    readSource: async () => ({ ...source, wallets: [{ nativeWei: '1', wethWei: '0', entryPointDepositWei: '0', sessionActive: true, pendingTransaction: true }] }),
    readCredits: async () => { throw Error('RPC_WITH_PRIVATE_URL'); } });
  const result = await inspection.check();
  for (const code of ['HOLDER_ASSETS_PRESENT', 'HOLDER_AUTOMATION_ACTIVE', 'HOLDER_TRANSACTION_PENDING', 'HOLDER_CREDITS_UNKNOWN']) assert.ok(result.blockers.includes(code));
  assert.equal(JSON.stringify(result).includes('RPC_WITH_PRIVATE_URL'), false);
});
