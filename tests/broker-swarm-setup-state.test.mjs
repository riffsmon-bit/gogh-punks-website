import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, parseAbi } from 'viem';
import { createSwarmSetup, restoreSwarmSetup, captureSwarmSetupFunding,
  swarmSetupFundingMatches, swarmSetupFundingStatus, updateSwarmSetupFunding,
  updateSwarmSetupMission } from '../site/broker-swarm-setup-state.js';

const owner = `0x${'1'.repeat(40)}`, vault = `0x${'2'.repeat(40)}`, factory = `0x${'3'.repeat(40)}`;
const other = `0x${'4'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`, blockHash = `0x${'b'.repeat(64)}`;
const planId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ABI = parseAbi([
  'function fundBatch((uint256 tokenId,uint256 amountWei)[] allocations,uint256 expectedNonce,uint256 deadline)',
  'event PunkFunded(uint256 indexed nonce,uint256 indexed tokenId,address indexed account,uint256 amountWei)',
  'event BatchFunded(uint256 indexed nonce,uint256 count,uint256 totalWei)',
]);
const input = () => ({ owner, chainId: 4663, tokenIds: ['94', '93'], ownedTokenIds: ['93', '94', '95'],
  planId, options: { mode: 'SEARCH', daily: '5', total: '5', duration: 'FIXED', fundingBudgetEth: '0.001000000000000001' },
  fundingBaselineRecord: null });
function review(setup, { nonce = '8', vaultNonce = '3', timestamp = '1000' } = {}) {
  const allocations = setup.allocations.map(({ tokenId, amountWei }) => ({ tokenId, amountWei,
    account: `0x${(BigInt(tokenId) + 100n).toString(16).padStart(40, '0')}` }));
  const expiresAt = Number(BigInt(timestamp) + 90n) * 1000;
  const action = { kind: 'BATCH', allocations: setup.allocations.map(({ tokenId, amountWei }) => ({ tokenId, amountWei })) };
  return { schema: 'GOGH_SWARM_WALLET_REVIEW_V1', owner, chainId: 4663, releaseIdentity: hash,
    factory, action, vault, created: true, vaultNonce, accountSalt: `0x${'0'.repeat(64)}`,
    canonicalRegistry: other, vaultCodeHash: blockHash, allocations,
    anchor: { number: '100', hash: blockHash, timestamp }, expiresAt,
    transaction: { chainId: '0x1237', from: owner, to: vault, value: '0x0', nonce: `0x${BigInt(nonce).toString(16)}`,
      gas: '0x186a0', gasPrice: '0xf4240', data: encodeFunctionData({ abi: ABI, functionName: 'fundBatch',
        args: [action.allocations.map(row => ({ tokenId: BigInt(row.tokenId), amountWei: BigInt(row.amountWei) })), BigInt(vaultNonce), BigInt(expiresAt / 1000)] }) },
    maximumNetworkFeeWei: '100000000000' };
}
function journal(prepared, status = 'CONFIRMED') {
  const nonce = BigInt(prepared.vaultNonce);
  const events = [...prepared.allocations.map(row => ({ address: vault,
    topics: encodeEventTopics({ abi: ABI, eventName: 'PunkFunded', args: { nonce, tokenId: BigInt(row.tokenId), account: row.account } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(row.amountWei)]) })),
  { address: vault, topics: encodeEventTopics({ abi: ABI, eventName: 'BatchFunded', args: { nonce } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }],
      [BigInt(prepared.allocations.length), prepared.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n)]) }];
  return { schema: 'GOGH_SWARM_WALLET_JOURNAL_V1', owner, status, review: prepared,
    transactionHash: ['WALLET_REQUESTED', 'REJECTED'].includes(status) ? null : hash,
    receipt: status === 'CANCELLED' ? { transactionHash: hash, blockNumber: '101', blockHash, status: '0x1', events: [],
      gasUsed: '21000', effectiveGasPrice: '1000000', actualNetworkFeeWei: '21000000000', feeExceeded: false,
      cancellation: { from: owner, to: owner, chainId: '0x1237', nonce: prepared.transaction.nonce,
        value: '0x0', input: '0x', gas: '0x5208', feeCap: '0xf4240' } }
      : ['CONFIRMED', 'REVERTED'].includes(status)
      ? { transactionHash: hash, blockNumber: '101', blockHash, status: status === 'CONFIRMED' ? '0x1' : '0x0',
        events: status === 'CONFIRMED' ? events : [] } : null };
}

test('guided setup preserves shared mission bounds and exact wei split while retaining each Punk existing rules', () => {
  const setup = createSwarmSetup(input());
  assert.equal(setup.schema, 'GUIDED_SWARM_V1'); assert.equal(setup.planId, planId);
  assert.equal(setup.dailyMaximum, 10); assert.equal(setup.totalMaximum, 10);
  assert.deepEqual(setup.tokenIds, ['94', '93']);
  assert.deepEqual(setup.allocations, [
    { tokenId: '93', amountWei: '500000000000001', amountEth: '0.000500000000000001' },
    { tokenId: '94', amountWei: '500000000000000', amountEth: '0.0005' },
  ]);
  assert.match(setup.command, /Keep my existing art preferences, gas limit, reserve, blocked contracts and all other rules/);
  assert.equal(setup.funding.attempt, null); assert.equal(setup.funding.status, 'NOT_REVIEWED');
  assert.equal(Object.isFrozen(setup), true); assert.equal(Object.isFrozen(setup.options), true);
  assert.equal(Object.isFrozen(setup.allocations[0]), true);
});

test('invalid owners, membership, budgets and limits cannot create a setup', () => {
  for (const mutate of [value => { value.owner = '0x0'; }, value => { value.chainId = 1; },
    value => { value.ownedTokenIds = ['93']; }, value => { value.tokenIds = ['93', '93']; },
    value => { value.options.daily = '100'; }, value => { value.options.fundingBudgetEth = '0'; },
    value => { value.options.fundingBudgetEth = '0.000000000000000001'; }, value => { value.planId = 'invalid'; }]) {
    const value = input(); mutate(value); assert.throws(() => createSwarmSetup(value));
  }
});

test('blank budget explicitly uses existing Agent gas without manufacturing funding or receipt authority', () => {
  const value = input(); value.options.fundingBudgetEth = '';
  const setup = createSwarmSetup(value);
  assert.deepEqual(setup.allocations, []); assert.equal(setup.options.fundingBudgetEth, '');
  assert.equal(setup.funding.attempt, null); assert.equal(setup.funding.status, 'NOT_REVIEWED');
  assert.equal(restoreSwarmSetup(setup, { owner, chainId: 4663 }).allocations.length, 0);
  const actualReview = review(createSwarmSetup(input()));
  assert.throws(() => captureSwarmSetupFunding(setup, actualReview), /existing Agent gas/);
  assert.equal(swarmSetupFundingMatches(setup, journal(actualReview)), false);
  assert.equal(updateSwarmSetupMission(setup, { tokenId: '93', status: 'REVIEW', intentHash: hash }).missions[1].status, 'REVIEW');
});

test('directed and keep-hunting plans remain bounded and free-only', () => {
  const value = input(); Object.assign(value.options, { mode: 'DIRECTED', target: other, duration: 'KEEP_HUNTING' });
  const setup = createSwarmSetup(value);
  assert.equal(setup.options.total, '100'); assert.equal(setup.totalMaximum, 200);
  assert.match(setup.command, /free mints/); assert.match(setup.command, /over 30 days/);
  assert.match(setup.command, new RegExp(other));
});

test('restoration rejects altered immutable definition and another connected owner or chain', () => {
  const setup = createSwarmSetup(input());
  for (const mutate of [value => { value.allocations[0].amountWei = '1'; }, value => { value.command = 'Spend freely'; },
    value => { value.tokenIds.reverse(); }, value => { value.dailyMaximum = 50; },
    value => { value.options.fundingBudgetEth = '0.2'; }, value => { value.extra = true; }]) {
    const saved = structuredClone(setup); mutate(saved);
    assert.throws(() => restoreSwarmSetup(saved, { owner, chainId: 4663 }));
  }
  assert.throws(() => restoreSwarmSetup(setup, { owner: other, chainId: 4663 }));
  assert.throws(() => restoreSwarmSetup(setup, { owner, chainId: 1 }));
});

test('mission markers downgrade on refresh; a saved authorized marker grants no live authority', () => {
  for (const status of ['REVIEW', 'AUTHORIZING', 'AUTHORIZED', 'CHECK_STATUS', 'EXISTING', 'SETTLED']) {
    const saved = updateSwarmSetupMission(createSwarmSetup(input()), { tokenId: '93', status, intentHash: hash });
    const restored = restoreSwarmSetup(JSON.parse(JSON.stringify(saved)), { owner, chainId: 4663 });
    assert.deepEqual(restored.missions, [{ tokenId: '94', status: 'QUEUED', intentHash: null, attempt: null },
      { tokenId: '93', status: 'CHECK_STATUS', intentHash: hash, attempt: null }]);
  }
  assert.throws(() => updateSwarmSetupMission(createSwarmSetup(input()), { tokenId: '95', status: 'AUTHORIZED' }));
});

test('reload retains the exact mission session and transaction for receipt recovery without replay', () => {
  const attempt = { sessionId: planId, setupArtifactHash: hash, transactionHash: null };
  const prepared = updateSwarmSetupMission(createSwarmSetup(input()), {
    tokenId: '93', status: 'AUTHORIZING', intentHash: hash, attempt });
  const unknown = restoreSwarmSetup(prepared, { owner, chainId: 4663 });
  assert.equal(unknown.missions[1].status, 'CHECK_STATUS');
  assert.deepEqual(unknown.missions[1].attempt, attempt);
  assert.throws(() => updateSwarmSetupMission(unknown, { tokenId: '93', status: 'QUEUED' }), /Recover/);
  const submitted = updateSwarmSetupMission(prepared, { tokenId: '93', status: 'AUTHORIZING',
    attempt: { ...attempt, transactionHash: blockHash } });
  const restored = restoreSwarmSetup(submitted, { owner, chainId: 4663 });
  assert.equal(restored.missions[1].intentHash, hash);
  assert.deepEqual(restored.missions[1].attempt, { ...attempt, transactionHash: blockHash });
  const settled = updateSwarmSetupMission(submitted, { tokenId: '93', status: 'SETTLED' });
  assert.deepEqual(settled.missions[1].attempt, submitted.missions[1].attempt);
  assert.equal(restoreSwarmSetup(settled, { owner, chainId: 4663 }).missions[1].status, 'CHECK_STATUS');
  const rejected = updateSwarmSetupMission(unknown, { tokenId: '93', status: 'QUEUED', attempt: null });
  assert.equal(rejected.missions[1].attempt, null);
  for (const mutate of [value => { value.sessionId = 'bad'; }, value => { value.setupArtifactHash = 'bad'; },
    value => { value.transactionHash = 'bad'; }]) {
    const saved = structuredClone(submitted); mutate(saved.missions[1].attempt);
    assert.throws(() => restoreSwarmSetup(saved, { owner, chainId: 4663 }));
  }
});

test('an unrelated old matching receipt cannot mark a new setup funded', () => {
  const initial = createSwarmSetup(input()), oldReview = review(initial), oldRecord = journal(oldReview);
  const setup = createSwarmSetup({ ...input(), fundingBaselineRecord: oldRecord });
  assert.equal(swarmSetupFundingMatches(setup, oldRecord), false);
  assert.equal(swarmSetupFundingStatus(setup, oldRecord), 'NOT_REVIEWED');
  assert.throws(() => captureSwarmSetupFunding(setup, oldReview), /earlier funding/);
  const next = captureSwarmSetupFunding(setup, review(setup, { nonce: '9', vaultNonce: '4' }));
  assert.equal(swarmSetupFundingStatus(next, oldRecord), 'REVIEW');
  assert.equal(swarmSetupFundingMatches(next, oldRecord), false);
  assert.equal(swarmSetupFundingMatches(next, journal(JSON.parse(next.funding.attempt.reviewFingerprint))), true);
  const pending = updateSwarmSetupFunding(next, journal(JSON.parse(next.funding.attempt.reviewFingerprint), 'SUBMITTED'));
  assert.equal(swarmSetupFundingStatus(pending, oldRecord), 'CHECK_STATUS');
});

test('exact captured pending, confirmed, rejected and reverted attempts are distinguished', () => {
  const initial = createSwarmSetup(input()), prepared = review(initial), setup = captureSwarmSetupFunding(initial, prepared);
  for (const status of ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'REVERTED', 'CANCELLED']) {
    const record = journal(prepared, status);
    assert.equal(swarmSetupFundingStatus(setup, record), status);
    assert.equal(swarmSetupFundingMatches(setup, record), status === 'CONFIRMED');
    assert.equal(updateSwarmSetupFunding(setup, record).funding.status, status);
  }
});

test('restored or unknown funding remains recovery-only until the captured attempt is reconciled', () => {
  const initial = createSwarmSetup(input()), prepared = review(initial);
  let setup = captureSwarmSetupFunding(initial, prepared);
  assert.equal(swarmSetupFundingStatus(setup, null), 'REVIEW');
  setup = updateSwarmSetupFunding(setup, journal(prepared, 'SUBMITTED'));
  const restored = restoreSwarmSetup(JSON.parse(JSON.stringify(setup)), { owner, chainId: 4663 });
  assert.deepEqual(restored.funding.attempt, setup.funding.attempt);
  assert.equal(restored.funding.status, 'CHECK_STATUS');
  assert.equal(swarmSetupFundingStatus(restored, null), 'CHECK_STATUS');
  assert.throws(() => captureSwarmSetupFunding(restored, review(restored, { nonce: '9' })), /Recover/);
  assert.equal(swarmSetupFundingMatches(restored, journal(prepared)), true);
  const confirmed = updateSwarmSetupFunding(restored, journal(prepared));
  assert.equal(restoreSwarmSetup(confirmed, { owner, chainId: 4663 }).funding.status, 'CHECK_STATUS');
});

test('receipt, allocation, event, owner, chain and attempt mismatches fail closed', () => {
  const initial = createSwarmSetup(input()), prepared = review(initial), setup = captureSwarmSetupFunding(initial, prepared);
  for (const mutate of [value => { value.owner = other; }, value => { value.review.chainId = 1; },
    value => { value.receipt.transactionHash = blockHash; }, value => { value.receipt.blockHash = '0x0'; },
    value => { value.receipt.blockNumber = '99'; }, value => { value.receipt.status = '0x0'; },
    value => { value.receipt.events.pop(); }, value => { value.receipt.events[0].address = owner; },
    value => { value.review.action.allocations[0].amountWei = '1'; },
    value => { value.review.allocations[0].account = other; },
    value => { value.review = review(initial, { nonce: '9' }); },
    value => { value.receipt = null; }]) {
    const record = structuredClone(journal(prepared)); mutate(record);
    assert.equal(swarmSetupFundingStatus(setup, record), 'CHECK_STATUS');
    assert.equal(swarmSetupFundingMatches(setup, record), false);
  }
});

test('a pending baseline blocks a second setup and confirmation cannot be forged using a local marker', () => {
  const setup = createSwarmSetup(input()), prepared = review(setup);
  for (const status of ['WALLET_REQUESTED', 'SUBMITTED']) {
    assert.throws(() => createSwarmSetup({ ...input(), fundingBaselineRecord: journal(prepared, status) }), /unresolved transaction/);
  }
  const forged = structuredClone(setup); forged.funding.status = 'CONFIRMED';
  assert.throws(() => restoreSwarmSetup(forged, { owner, chainId: 4663 }));
  assert.equal(swarmSetupFundingMatches(forged, journal(prepared)), false);
});

test('an uncaptured wallet request or later matching receipt remains recovery-only instead of funding twice', () => {
  const setup = createSwarmSetup(input()), prepared = review(setup);
  for (const status of ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED']) {
    const saved = updateSwarmSetupFunding(setup, journal(prepared, status));
    assert.equal(saved.funding.status, 'CHECK_STATUS');
    assert.equal(swarmSetupFundingMatches(saved, journal(prepared, status)), false);
    const restored = restoreSwarmSetup(saved, { owner, chainId: 4663 });
    assert.equal(swarmSetupFundingStatus(restored, null), 'CHECK_STATUS');
    assert.throws(() => captureSwarmSetupFunding(restored, prepared), /Recover/);
  }
});
