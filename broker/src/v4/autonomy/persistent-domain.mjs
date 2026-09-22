import { createHash } from 'node:crypto';
import { normalizeV2Opportunity } from '../opportunity.mjs';

export class PersistentWatchError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
export const watchFail = (code, message, status) => { throw new PersistentWatchError(code, message, status); };
export const watchHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function exactWatchObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    watchFail('WATCH_INVALID_REQUEST', 'Review the complete Punk settings again.', 400);
  }
}
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
const list = value => {
  if (!Array.isArray(value) || value.length > 12 || value.some(x => typeof x !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(x))) watchFail('WATCH_INVALID_TASTE', 'Use up to 12 short art preferences.', 400);
  return [...new Set(value.map(x => x.trim().toLowerCase()))].sort();
};
export function normalizePersistentConfig(value, now = Date.now()) {
  exactWatchObject(value, ['schema', 'likes', 'dislikes', 'maximumSupply', 'requireWebsite', 'requireX',
    'freeOnly', 'maxMintPriceWei', 'maxGasWei', 'reserveWei', 'dailySpendWei', 'dailyCollectionLimit', 'expiresAt']);
  if (value.schema !== 'GOGH_PERSISTENT_WATCH_CONFIG_V1' || !uint(value.maxMintPriceWei)
    || !uint(value.maxGasWei) || !uint(value.reserveWei) || !uint(value.dailySpendWei)
    || !['requireWebsite', 'requireX', 'freeOnly'].every(k => typeof value[k] === 'boolean')
    || !Number.isInteger(value.dailyCollectionLimit) || value.dailyCollectionLimit < 1 || value.dailyCollectionLimit > 20
    || !(value.maximumSupply === null || Number.isSafeInteger(value.maximumSupply) && value.maximumSupply > 0 && value.maximumSupply <= 10_000_000)
    || !(value.expiresAt === null || typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
      && Date.parse(value.expiresAt) > now && Date.parse(value.expiresAt) <= now + 366 * 86400000)) {
    watchFail('WATCH_INVALID_CONFIG', 'Check the budget, limits and duration before activating.', 400);
  }
  const likes = list(value.likes), dislikes = list(value.dislikes);
  if (likes.some(x => dislikes.includes(x))) watchFail('WATCH_CONFLICTING_TASTE', 'A style cannot be both liked and excluded.', 400);
  if (value.freeOnly && value.maxMintPriceWei !== '0') watchFail('WATCH_INVALID_CONFIG', 'Free-only watching needs a zero mint-price limit.', 400);
  return Object.freeze({ schema: value.schema, likes, dislikes, maximumSupply: value.maximumSupply,
    requireWebsite: value.requireWebsite, requireX: value.requireX, freeOnly: value.freeOnly,
    maxMintPriceWei: value.maxMintPriceWei, maxGasWei: value.maxGasWei, reserveWei: value.reserveWei,
    dailySpendWei: value.dailySpendWei, dailyCollectionLimit: value.dailyCollectionLimit,
    expiresAt: value.expiresAt === null ? null : new Date(value.expiresAt).toISOString() });
}

export function persistentStatus(watch, economics = {}, now = Date.now()) {
  const base = { watching: watch?.state === 'ACTIVE', executionAuthorized: false,
    transactionPrepared: false, transactionSubmitted: false, utcDay: new Date(now).toISOString().slice(0, 10) };
  if (!watch || watch.state === 'PAUSED') return { ...base, watching: false, state: 'PAUSED',
    reason: 'WATCH_PAUSED', message: 'Your Punk is paused. Activate when you want it to keep looking.', action: 'ACTIVATE' };
  if (watch.state === 'OWNER_ACTION_REQUIRED') return { ...base, watching: false, state: 'OWNER_ACTION_REQUIRED',
    reason: 'WATCH_OWNER_CHANGED', message: 'Ownership changed. Review the inherited taste and activate again.', action: 'REVIEW' };
  if (watch.config.expiresAt && Date.parse(watch.config.expiresAt) <= now) return { ...base, watching: false,
    state: 'OWNER_ACTION_REQUIRED', reason: 'WATCH_DURATION_ENDED', message: 'Your watching period ended. Your taste is saved.', action: 'REVIEW' };
  if (economics.verified !== true) return { ...base, state: 'SAFETY_BLOCKED', reason: 'WATCH_PERMISSION_UNVERIFIED',
    message: 'Your Punk is still watching. Its spending permission could not be checked; no new spending is authorized here.', action: 'RECHECK' };
  if (!uint(economics.balanceWei) || !uint(economics.reserveWei)) return { ...base, state: 'SAFETY_BLOCKED',
    reason: 'WATCH_BALANCE_UNVERIFIED', message: 'Your Punk is still watching. Recheck its balance before spending.', action: 'RECHECK' };
  const reserve = BigInt(watch.config.reserveWei) > BigInt(economics.reserveWei) ? BigInt(watch.config.reserveWei) : BigInt(economics.reserveWei);
  if (BigInt(economics.balanceWei) <= reserve) return { ...base, state: 'RESERVE_REACHED',
    reason: 'WATCH_RESERVE_REACHED', message: 'Your Punk is still watching. Its available balance has reached your reserve.', action: 'FUND' };
  if (economics.usageVerified === true && economics.utcDay === base.utcDay
    && (uint(economics.spentTodayWei) && BigInt(economics.spentTodayWei) >= BigInt(watch.config.dailySpendWei)
      || Number.isSafeInteger(economics.collectedToday) && economics.collectedToday >= watch.config.dailyCollectionLimit)) return {
    ...base, state: 'BUDGET_EXHAUSTED', reason: 'WATCH_DAILY_LIMIT_REACHED',
    message: 'Your Punk is still watching. Its daily collecting limit resets at midnight UTC.', action: 'RECHECK' };
  if (economics.sessionActive !== true || !Number.isSafeInteger(economics.sessionExpiresAt) || economics.sessionExpiresAt <= now
    || !Number.isSafeInteger(economics.remainingMints) || economics.remainingMints <= 0) return {
    ...base, state: 'OWNER_ACTION_REQUIRED', reason: 'WATCH_SESSION_REVIEW_REQUIRED',
    message: 'Your Punk is still watching. Approve a new bounded mint permission before it can collect again.', action: 'REVIEW_PERMISSION' };
  return { ...base, state: 'WATCHING', reason: 'WATCH_WAITING_FOR_MATCH',
    message: 'Your Punk stays out looking. Matches still pass its existing wallet permissions and safety checks.', action: 'PAUSE' };
}

// A shared observation is research, not a per-Punk simulation or permission to spend.
export function evaluatePersistentOpportunity({ watch, opportunity: input, economics = {}, now = Date.now() }) {
  const opportunity = normalizeV2Opportunity(input, new Date(now));
  const config = watch.config, reasons = [], styles = opportunity.artStyles.map(x => x.toLowerCase());
  if (watch.state !== 'ACTIVE') reasons.push('WATCH_PAUSED');
  if (config.expiresAt && Date.parse(config.expiresAt) <= now) reasons.push('WATCH_DURATION_ENDED');
  if (config.likes.length && !config.likes.some(x => styles.includes(x))) reasons.push('TASTE_NOT_MATCHED');
  if (config.dislikes.some(x => styles.includes(x))) reasons.push('EXCLUDED_STYLE');
  if (config.maximumSupply !== null && (opportunity.supply === null || opportunity.supply > config.maximumSupply)) reasons.push('SUPPLY_OUTSIDE_RULES');
  if (config.requireWebsite && !opportunity.website) reasons.push('WEBSITE_REQUIRED');
  if (config.requireX && !opportunity.socialUrls.x) reasons.push('X_REQUIRED');
  if (config.freeOnly && opportunity.priceWei !== '0' || BigInt(opportunity.priceWei) > BigInt(config.maxMintPriceWei)) reasons.push('MINT_PRICE_LIMIT');
  if (opportunity.startTime && Date.parse(opportunity.startTime) > now) reasons.push('WAITING_FOR_WINDOW');
  if (opportunity.endTime && Date.parse(opportunity.endTime) <= now) reasons.push('OPPORTUNITY_EXPIRED');
  if (opportunity.screeningStatus !== 'PASSED' || opportunity.riskLevel !== 'LOW'
    || opportunity.unexpectedApprovals || opportunity.unexpectedTransfers) reasons.push('SECURITY_SCREEN_REQUIRED');
  if (opportunity.simulationStatus === 'FAILED') reasons.push('SIMULATION_FAILED');
  const matchesTaste = !reasons.some(x => ['TASTE_NOT_MATCHED', 'EXCLUDED_STYLE', 'SUPPLY_OUTSIDE_RULES', 'WEBSITE_REQUIRED', 'X_REQUIRED', 'MINT_PRICE_LIMIT'].includes(x));
  const status = persistentStatus(watch, economics, now);
  if (status.state !== 'WATCHING') reasons.push(status.reason);
  if (economics.skillVerified !== true || economics.mintHunterEquipped !== true) reasons.push('EQUIPPED_MINT_HUNTER_REQUIRED');
  if (BigInt(opportunity.priceWei) > 0n && (economics.skillVerified !== true || economics.paidMintLicenseEquipped !== true)) reasons.push('EQUIPPED_PAID_MINT_LICENSE_REQUIRED');
  if (economics.globalExecutionPaused !== false) reasons.push('EXECUTION_RELEASE_BLOCKED');
  if (economics.usageVerified !== true || economics.utcDay !== status.utcDay) reasons.push('DAILY_USAGE_UNVERIFIED');
  else {
    if (!uint(economics.spentTodayWei) || BigInt(economics.spentTodayWei) + BigInt(opportunity.priceWei) + BigInt(opportunity.estimatedGasCostWei) > BigInt(config.dailySpendWei)) reasons.push('DAILY_SPEND_LIMIT');
    if (!Number.isSafeInteger(economics.collectedToday) || economics.collectedToday < 0 || economics.collectedToday >= config.dailyCollectionLimit) reasons.push('DAILY_COLLECTION_LIMIT');
  }
  if (BigInt(opportunity.estimatedGasCostWei) === 0n || BigInt(opportunity.estimatedGasCostWei) > BigInt(config.maxGasWei)) reasons.push('GAS_REVIEW_REQUIRED');
  if (uint(economics.balanceWei) && uint(economics.reserveWei)) {
    const reserve = BigInt(config.reserveWei) > BigInt(economics.reserveWei) ? BigInt(config.reserveWei) : BigInt(economics.reserveWei);
    if (!uint(economics.pendingSpendWei) || BigInt(economics.balanceWei) < reserve + BigInt(opportunity.priceWei)
      + BigInt(opportunity.estimatedGasCostWei) + BigInt(economics.pendingSpendWei ?? '0')) reasons.push('AVAILABLE_BUDGET_LIMIT');
  }
  // Discovery PASSED cannot substitute for a fresh per-Punk simulation/adapter/policy check.
  reasons.push('EXISTING_EXECUTOR_REVIEW_REQUIRED');
  return Object.freeze({ schema: 'GOGH_PERSISTENT_WATCH_DECISION_V1', opportunityId: opportunity.opportunityId,
    collectionName: opportunity.collectionName, collectionContract: opportunity.collectionContract,
    sourceUrls: opportunity.sourceUrls, watchVersion: watch.version, utcDay: status.utcDay, matchesTaste,
    result: matchesTaste ? 'CANDIDATE' : 'PASSED', reasons: [...new Set(reasons)],
    executionAuthorized: false, transactionPrepared: false, transactionSubmitted: false });
}

export function persistentObservationKey(watch, opportunity, now) {
  const phase = opportunity.startTime && Date.parse(opportunity.startTime) > now ? 'BEFORE' :
    opportunity.endTime && Date.parse(opportunity.endTime) <= now ? 'ENDED' : 'OPEN';
  return watchHash({ version: watch.version, day: new Date(now).toISOString().slice(0, 10), phase,
    dedupeKey: opportunity.dedupeKey, priceWei: opportunity.priceWei, screeningStatus: opportunity.screeningStatus,
    contractCodeHash: opportunity.contractCodeHash, adapterCodeHash: opportunity.adapterCodeHash,
    artStyles: opportunity.artStyles, supply: opportunity.supply, website: opportunity.website, socialUrls: opportunity.socialUrls });
}
