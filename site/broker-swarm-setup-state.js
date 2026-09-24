// Guided setup progress only. These local records never authorize a transaction,
// prove current ownership, or replace the Swarm wallet client's live checks.
import { buildSwarmPlan } from './broker-swarm.js';
import { fundingIdentity } from './broker-swarm-funding.js';
import { getSwarmWalletRecord } from './swarm-wallet-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const FUNDING_STATES = ['NOT_REVIEWED', 'REVIEW', 'WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'REVERTED', 'CANCELLED', 'CHECK_STATUS'];
const MISSION_STATES = ['QUEUED', 'REVIEW', 'AUTHORIZING', 'AUTHORIZED', 'CHECK_STATUS', 'EXISTING'];
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const equal = (a, b) => fundingIdentity(a) === fundingIdentity(b);
const ensure = (ok, message = 'The saved Swarm setup changed. Check the original wallet activity before continuing.') => {
  if (!ok) throw Error(message);
};
function exact(value, keys) {
  ensure(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
function journal(record, owner) {
  if (record === null) return null;
  // Reuse the exact journal, calldata, nonce and receipt-event validation. The
  // supplied storage is in-memory only; this does not read browser storage/RPC.
  return getSwarmWalletRecord(owner, { storage: {
    getItem: () => JSON.stringify(record), setItem() { throw Error('Read only'); },
  } });
}
function matchingReview(setup, review) {
  ensure(setup.allocations.length > 0, 'This setup uses existing Agent gas and has no funding batch to confirm.');
  const checked = journal({ schema: 'GOGH_SWARM_WALLET_JOURNAL_V1', owner: setup.owner,
    status: 'REJECTED', review, transactionHash: null, receipt: null }, setup.owner).review;
  ensure(checked.chainId === setup.chainId && checked.action.kind === 'BATCH'
    && equal(checked.action.allocations, setup.allocations.map(({ tokenId, amountWei }) => ({ tokenId, amountWei }))),
  'This funding review does not match the selected Swarm and exact gas amounts.');
  return checked;
}
function definition(setup) {
  return { schema: setup.schema, owner: setup.owner, chainId: setup.chainId, planId: setup.planId,
    tokenIds: setup.tokenIds, options: setup.options, command: setup.command,
    dailyMaximum: setup.dailyMaximum, totalMaximum: setup.totalMaximum, allocations: setup.allocations };
}

export function createSwarmSetup({ owner, chainId, tokenIds, ownedTokenIds, options,
  planId = globalThis.crypto?.randomUUID?.(), fundingBaselineRecord = null } = {}) {
  ensure(UUID.test(planId ?? ''), 'The Swarm setup ID is unavailable. Reload and try again.');
  const plan = buildSwarmPlan({ owner, chainId, tokenIds, ownedTokenIds, options, fundingBatchId: planId });
  const baseline = journal(fundingBaselineRecord, plan.owner);
  ensure(!baseline || ['CONFIRMED', 'REVERTED', 'CANCELLED', 'REJECTED'].includes(baseline.status),
    'Your Swarm Wallet already has an unresolved transaction. Recover that transaction before planning another funding batch.');
  return freeze({ schema: 'GUIDED_SWARM_V1', owner: plan.owner, chainId, planId,
    tokenIds: plan.rows.map(row => row.tokenId), options: plan.options, command: plan.command,
    dailyMaximum: plan.dailyMaximum, totalMaximum: plan.totalMaximum,
    allocations: (plan.funding?.allocations ?? []).map(({ tokenId, amountWei, amountEth }) => ({ tokenId, amountWei, amountEth })),
    funding: { baselineFingerprint: baseline ? fundingIdentity(baseline.review.transaction) : null,
      attempt: null, status: 'NOT_REVIEWED' },
    missions: plan.rows.map(row => ({ ...row, attempt: null })) });
}

function missionAttempt(value, intentHash) {
  if (value === null || value === undefined) return null;
  exact(value, ['sessionId', 'setupArtifactHash', 'transactionHash']);
  ensure(UUID.test(value.sessionId ?? '') && HASH.test(value.setupArtifactHash ?? '')
    && (value.transactionHash === null || HASH.test(value.transactionHash)) && HASH.test(intentHash ?? ''),
  'The saved mission attempt is incomplete. Check its original wallet transaction before continuing.');
  return structuredClone(value);
}

function validatedSetup(saved, { owner, chainId }, { restoring = false } = {}) {
  exact(saved, ['schema', 'owner', 'chainId', 'planId', 'tokenIds', 'options', 'command',
    'dailyMaximum', 'totalMaximum', 'allocations', 'funding', 'missions']);
  ensure(saved.schema === 'GUIDED_SWARM_V1' && saved.owner === owner?.toLowerCase() && saved.chainId === chainId);
  // Saved IDs are not ownership authority. The caller must refresh the holder's
  // roster before rendering actionable controls or invoking transaction review.
  const expected = createSwarmSetup({ owner, chainId, tokenIds: saved.tokenIds,
    ownedTokenIds: saved.tokenIds, options: saved.options, planId: saved.planId });
  ensure(equal(definition(saved), definition(expected)));
  exact(saved.funding, ['baselineFingerprint', 'attempt', 'status']);
  ensure(FUNDING_STATES.includes(saved.funding.status)
    && (saved.funding.baselineFingerprint === null || typeof saved.funding.baselineFingerprint === 'string'));
  const funding = structuredClone(saved.funding);
  if (funding.baselineFingerprint !== null) {
    const baseline = JSON.parse(funding.baselineFingerprint);
    ensure(baseline && typeof baseline === 'object' && equal(fundingIdentity(baseline), funding.baselineFingerprint));
  }
  if (funding.attempt !== null) {
    exact(funding.attempt, ['reviewFingerprint', 'transactionFingerprint']);
    ensure(typeof funding.attempt.reviewFingerprint === 'string' && typeof funding.attempt.transactionFingerprint === 'string');
    const review = matchingReview(expected, JSON.parse(funding.attempt.reviewFingerprint));
    ensure(fundingIdentity(review) === funding.attempt.reviewFingerprint
      && fundingIdentity(review.transaction) === funding.attempt.transactionFingerprint
      && funding.attempt.transactionFingerprint !== funding.baselineFingerprint);
    if (restoring) funding.status = 'CHECK_STATUS';
  } else {
    ensure(['NOT_REVIEWED', 'CHECK_STATUS'].includes(funding.status));
  }
  ensure(Array.isArray(saved.missions) && saved.missions.length === expected.missions.length);
  const missions = saved.missions.map((row, index) => {
    exact(row, ['tokenId', 'status', 'intentHash', ...(Object.hasOwn(row, 'attempt') ? ['attempt'] : [])]);
    ensure(row.tokenId === expected.missions[index].tokenId && MISSION_STATES.includes(row.status)
      && (row.intentHash === null || HASH.test(row.intentHash)));
    const attempt = missionAttempt(row.attempt, row.intentHash);
    ensure(row.status !== 'QUEUED' || attempt === null);
    return { ...row, attempt, status: restoring && row.status !== 'QUEUED' ? 'CHECK_STATUS' : row.status };
  });
  return freeze({ ...expected, funding, missions });
}

export function restoreSwarmSetup(saved, context) {
  return validatedSetup(saved, context, { restoring: true });
}

export function captureSwarmSetupFunding(setup, review) {
  const current = validatedSetup(setup, setup), checked = matchingReview(current, review);
  ensure(['NOT_REVIEWED', 'REVIEW', 'REJECTED', 'REVERTED', 'CANCELLED'].includes(current.funding.status),
    'Recover the original Swarm funding attempt before preparing another.');
  const transactionFingerprint = fundingIdentity(checked.transaction);
  ensure(transactionFingerprint !== current.funding.baselineFingerprint,
    'An earlier funding transaction cannot fund this new setup again. Prepare a new funding review.');
  return freeze({ ...current, funding: { ...current.funding, status: 'REVIEW',
    attempt: { reviewFingerprint: fundingIdentity(checked), transactionFingerprint } } });
}

export function swarmSetupFundingStatus(setup, record) {
  try {
    const current = validatedSetup(setup, setup), attempt = current.funding.attempt;
    if (!attempt) {
      if (current.funding.status !== 'NOT_REVIEWED') return 'CHECK_STATUS';
      if (record === null) return 'NOT_REVIEWED';
      const checked = journal(record, current.owner);
      if (['WALLET_REQUESTED', 'SUBMITTED'].includes(checked.status)) return 'CHECK_STATUS';
      // A batch appeared after planning without its original attempt being saved.
      // Do not treat its receipt as ours or suggest a duplicate funding request.
      if (checked.status === 'CONFIRMED' && checked.review.action.kind === 'BATCH'
        && fundingIdentity(checked.review.transaction) !== current.funding.baselineFingerprint
        && equal(checked.review.action.allocations, current.allocations.map(({ tokenId, amountWei }) => ({ tokenId, amountWei })))) return 'CHECK_STATUS';
      return 'NOT_REVIEWED';
    }
    if (record === null) return current.funding.status === 'REVIEW' ? 'REVIEW' : 'CHECK_STATUS';
    const checked = journal(record, current.owner);
    if (checked.review.chainId !== current.chainId || checked.review.action.kind !== 'BATCH'
      || fundingIdentity(checked.review) !== attempt.reviewFingerprint
      || fundingIdentity(checked.review.transaction) !== attempt.transactionFingerprint) return 'CHECK_STATUS';
    matchingReview(current, checked.review);
    return checked.status;
  } catch { return 'CHECK_STATUS'; }
}

export function swarmSetupFundingMatches(setup, record) {
  return swarmSetupFundingStatus(setup, record) === 'CONFIRMED';
}

export function updateSwarmSetupFunding(setup, record) {
  const current = validatedSetup(setup, setup);
  return freeze({ ...current, funding: { ...current.funding, status: swarmSetupFundingStatus(current, record) } });
}

export function updateSwarmSetupMission(setup, { tokenId, status, intentHash, attempt }) {
  const current = validatedSetup(setup, setup);
  const prior = current.missions.find(row => row.tokenId === tokenId);
  const nextHash = intentHash === undefined ? prior?.intentHash : intentHash;
  ensure(prior && MISSION_STATES.includes(status)
    && (nextHash === null || HASH.test(nextHash)), 'This mission progress does not match a selected Punk.');
  const nextAttempt = missionAttempt(attempt === undefined ? prior.attempt : attempt, nextHash);
  ensure(status !== 'QUEUED' || nextAttempt === null, 'Recover this mission attempt before starting again.');
  return freeze({ ...current, missions: current.missions.map(row => row.tokenId === tokenId
    ? { tokenId, status, intentHash: nextHash, attempt: nextAttempt } : row) });
}
