import { createHash } from 'node:crypto';
import { keccak256 } from 'viem';
import { snapshotExactRecord, snapshotDenseArray } from '../../control-center/strict-record.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_REVIEW_SCHEMA } from './contracts.mjs';

export const MARKETPLACE_JOURNAL_SCHEMA = 'GOGH_DURABLE_MARKETPLACE_V1';
export const MARKETPLACE_JOURNAL_STATUSES = Object.freeze(['PREPARED', 'WALLET_REQUESTED', 'COMPLETED', 'REVERTED', 'CANCELLED']);
export const marketplaceAssert = (condition, code) => { if (!condition) throw Error(code); };
const A = /^0x[0-9a-f]{40}$/;
const H = /^0x[0-9a-f]{64}$/;
const D = /^[0-9a-f]{64}$/;
const U = /^(0|[1-9][0-9]{0,77})$/;
const Q = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
export const marketplaceDigest = value => createHash('sha256').update(value).digest('hex');
export function marketplaceJson(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${snapshotDenseArray(value).map(marketplaceJson).join(',')}]`;
  marketplaceAssert(value && Object.getPrototypeOf(value) === Object.prototype, 'MARKETPLACE_INVALID_JSON');
  const keys = Reflect.ownKeys(value);
  marketplaceAssert(keys.every(key => typeof key === 'string'
    && Object.getOwnPropertyDescriptor(value, key).enumerable
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')), 'MARKETPLACE_INVALID_JSON');
  return `{${keys.sort().map(key => `${JSON.stringify(key)}:${marketplaceJson(value[key])}`).join(',')}}`;
}
const uint = value => typeof value === 'string' && U.test(value) && BigInt(value) < 2n ** 256n;
const address = value => typeof value === 'string' && A.test(value) && value !== `0x${'0'.repeat(40)}`;
export function marketplaceScope({ owner, punkId }) {
  marketplaceAssert(typeof owner === 'string', 'MARKETPLACE_INVALID_SCOPE');
  owner = owner.toLowerCase();
  marketplaceAssert(address(owner) && uint(punkId) && BigInt(punkId) <= 5016n, 'MARKETPLACE_INVALID_SCOPE');
  return { owner, punkId, chainId: P.chainId };
}
export function marketplaceInput(value) {
  const input = snapshotExactRecord(value, ['requestId', 'action', 'selection', 'budget']);
  marketplaceAssert(typeof input.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.requestId)
    && input.action === 'BUY_LISTINGS', 'MARKETPLACE_INVALID_INPUT');
  const selection = snapshotExactRecord(input.selection, ['collection', 'orderHashes']);
  const budget = snapshotExactRecord(input.budget, ['maxTotalPriceWei', 'maxNetworkFeeWei', 'minimumReserveWei']);
  marketplaceAssert(typeof selection.collection === 'string', 'MARKETPLACE_INVALID_INPUT');
  const collection = selection.collection.toLowerCase();
  const hashes = snapshotDenseArray(selection.orderHashes);
  marketplaceAssert(address(collection) && collection !== P.collection && hashes.length >= 1 && hashes.length <= 5
    && hashes.every(value => typeof value === 'string' && H.test(value.toLowerCase())), 'MARKETPLACE_INVALID_SELECTION');
  const orderHashes = hashes.map(value => value.toLowerCase()).sort();
  marketplaceAssert(new Set(orderHashes).size === hashes.length && Object.values(budget).every(uint)
    && BigInt(budget.maxTotalPriceWei) > 0n && BigInt(budget.maxNetworkFeeWei) > 0n, 'MARKETPLACE_INVALID_BUDGET_OR_SELECTION');
  return { requestId: input.requestId, action: input.action, selection: { collection, orderHashes }, budget: { ...budget } };
}
export const marketplaceIntentId = (scope, input) => marketplaceDigest(marketplaceJson({ ...marketplaceScope(scope), requestId: input.requestId }));
export function marketplaceCas(value) {
  marketplaceAssert(typeof value.intentId === 'string' && D.test(value.intentId)
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && typeof value.reviewHash === 'string' && D.test(value.reviewHash), 'MARKETPLACE_INVALID_CAS');
  return { ...marketplaceScope(value), intentId: value.intentId, revision: value.revision, reviewHash: value.reviewHash };
}
export function marketplaceTransactionCommitment(transaction) {
  return { from: transaction.from, to: transaction.to, chainId: transaction.chainId, type: transaction.type,
    nonce: transaction.nonce, value: transaction.value, gas: transaction.gas, gasPrice: transaction.gasPrice,
    dataHash: keccak256(transaction.data) };
}

// Immutable persistence envelope. This verifies shape/bindings, not policy or on-chain facts.
export function serializeMarketplaceJournal(record) {
  snapshotExactRecord(record, ['intentId', 'releaseHash', 'input', 'review']);
  const input = marketplaceInput(record.input), review = record.review;
  const serialized = marketplaceJson(record);
  marketplaceAssert(Buffer.byteLength(serialized) < 65_536, 'MARKETPLACE_REVIEW_TOO_LARGE');
  const scope = marketplaceScope(review);
  marketplaceAssert(record.intentId === marketplaceIntentId(scope, input) && D.test(record.releaseHash)
    && review.schema === MARKETPLACE_REVIEW_SCHEMA && review.chainId === P.chainId && review.action === 'BUY_LISTINGS'
    && review.owner === scope.owner && review.walletRole === 'AGENT' && address(review.wallet)
    && review.recipient === review.wallet && review.automaticSubmission === false && review.publicTransactions === 0
    && review.walletRequests === 0 && review.broadcastAuthority === 'OWNER_WALLET_ONLY'
    && review.collectionFloorVerified === false && review.availability === 'OWNER_REVIEW_READY'
    && review.blockers.length === 0 && review.safety.status === 'PASS' && review.simulation.status === 'PASS'
    && review.policy.decision === 'ALLOW' && review.policy.mode === 'ASSIST'
    && review.policy.requiredSkillsEquipped === true && review.policy.adapterApproved === true && review.policy.budgetAllowed === true,
  'MARKETPLACE_REVIEW_INVALID');
  marketplaceAssert(uint(review.accountState) && uint(review.anchor.number) && uint(review.anchor.timestamp) && H.test(review.anchor.hash)
    && Number.isSafeInteger(review.expiresAt) && review.expiresAt === Number(BigInt(review.anchor.timestamp) + 60n) * 1000
    && address(review.purchaseGuard.address) && H.test(review.purchaseGuard.codeHash), 'MARKETPLACE_REVIEW_INVALID');
  const tx = snapshotExactRecord(review.transaction, ['from', 'to', 'data', 'value', 'type', 'nonce', 'chainId', 'gas', 'gasPrice']);
  marketplaceAssert(tx.from === scope.owner && tx.to === review.wallet && tx.type === '0x0' && tx.value === '0x0'
    && tx.chainId === '0x1237' && ['nonce', 'gas', 'gasPrice'].every(key => typeof tx[key] === 'string' && Q.test(tx[key]) && BigInt(tx[key]) < 2n ** 256n)
    && BigInt(tx.gas) > 0n && BigInt(tx.gasPrice) > 0n && typeof tx.data === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(tx.data), 'MARKETPLACE_TRANSACTION_INVALID');
  marketplaceAssert(review.selection.collection === input.selection.collection && Array.isArray(review.selection.items)
    && review.selection.items.length === input.selection.orderHashes.length
    && marketplaceJson(review.selection.items.map(item => item.orderHash).sort()) === marketplaceJson(input.selection.orderHashes)
    && review.selection.items.every(item => uint(item.tokenId) && uint(item.totalWei) && uint(item.counter))
    && new Set(review.selection.items.map(item => item.tokenId)).size === review.selection.items.length, 'MARKETPLACE_SELECTION_CHANGED');
  const total = review.selection.items.reduce((sum, item) => sum + BigInt(item.totalWei), 0n);
  marketplaceAssert(uint(review.cost.totalPriceWei) && total === BigInt(review.cost.totalPriceWei)
    && total <= BigInt(input.budget.maxTotalPriceWei) && review.cost.minimumReserveWei === input.budget.minimumReserveWei
    && uint(review.cost.maximumNetworkFeeWei) && BigInt(tx.gas) * BigInt(tx.gasPrice) === BigInt(review.cost.maximumNetworkFeeWei)
    && BigInt(review.cost.maximumNetworkFeeWei) <= BigInt(input.budget.maxNetworkFeeWei), 'MARKETPLACE_COST_CHANGED');
  return serialized;
}

export function publicMarketplaceEntry(entry) {
  if (!entry) return null;
  const review = structuredClone(entry.record.review);
  review.transactionCommitment = marketplaceTransactionCommitment(review.transaction);
  review.transaction = null;
  return { intentId: entry.record.intentId, revision: entry.revision, reviewHash: entry.reviewHash,
    status: entry.status, reportedHash: entry.reportedHash, receipt: entry.receipt,
    reason: entry.reason, holdsPurchase: ['PREPARED', 'WALLET_REQUESTED'].includes(entry.status), review };
}
