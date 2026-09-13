import { decodeFunctionResult } from 'viem';
import { prepareMarketplaceReview } from './review.mjs';
import { reconcileMarketplaceReview } from './reconcile.mjs';
import { ACCOUNT_ABI, SEAPORT_ABI } from './contracts.mjs';
import { currentMarketplaceRelease, validateMarketplaceRelease, marketplaceReleaseHash } from './durable-release.mjs';
import { MARKETPLACE_JOURNAL_SCHEMA, marketplaceAssert as check, marketplaceScope, marketplaceInput,
  marketplaceCas, marketplaceIntentId, marketplaceJson, publicMarketplaceEntry, serializeMarketplaceJournal } from './durable-journal.mjs';

const terminal = status => ['COMPLETED', 'REVERTED', 'CANCELLED'].includes(status);
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
const coreRequest = (scope, input) => ({ owner: scope.owner, punkId: scope.punkId, walletRole: 'AGENT',
  action: input.action, selection: input.selection, budget: input.budget });

// Refresh server-owned listing, screening, policy and skills evidence, then simulate
// the stored transaction itself. The refreshed calldata never replaces the review.
export async function assertMarketplaceClaimable(record, deps, now = Date.now) {
  const original = record.review;
  check(deps.client?.ccipRead === false, 'MARKETPLACE_FIXED_RPC_REQUIRED');
  check(now() < original.expiresAt, 'MARKETPLACE_REVIEW_EXPIRED');
  const fresh = await prepareMarketplaceReview(coreRequest(original, record.input), deps);
  check(fresh.availability === 'OWNER_REVIEW_READY' && fresh.transaction, 'MARKETPLACE_CLAIM_NOT_READY');
  for (const field of ['owner', 'punkId', 'wallet', 'accountState']) check(fresh[field] === original[field], 'MARKETPLACE_STATE_CHANGED');
  for (const field of ['selection', 'purchaseGuard', 'policy', 'safety']) {
    check(marketplaceJson(fresh[field]) === marketplaceJson(original[field]), 'MARKETPLACE_EVIDENCE_CHANGED');
  }
  for (const field of ['from', 'to', 'type', 'nonce', 'chainId', 'value']) check(fresh.transaction[field] === original.transaction[field], 'MARKETPLACE_TRANSACTION_CHANGED');
  check(BigInt(fresh.transaction.gas) <= BigInt(original.transaction.gas)
    && BigInt(fresh.transaction.gasPrice) <= BigInt(original.transaction.gasPrice)
    && Number(BigInt(fresh.anchor.timestamp) * 1000n) < original.expiresAt, 'MARKETPLACE_FEE_OR_EXPIRY_CHANGED');
  const anchor = await deps.client.getBlock({ blockNumber: BigInt(original.anchor.number) });
  check(same(anchor.hash, original.anchor.hash), 'MARKETPLACE_ANCHOR_CHANGED');
  const tx = original.transaction;
  const simulation = await deps.client.call({ account: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value),
    gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice), blockNumber: BigInt(fresh.anchor.number), ccipRead: false });
  const values = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: 'executeBatch', data: simulation.data });
  check(values.length === original.selection.items.length + 1 && values.at(-1) === '0x'
    && values.slice(0, -1).every(data => decodeFunctionResult({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', data }) === true), 'MARKETPLACE_ORIGINAL_SIMULATION_FAILED');
  check(now() < original.expiresAt, 'MARKETPLACE_REVIEW_EXPIRED');
}

// A supplied hash is a hint. Bind it only after the pinned read-only client observes
// this exact reviewed owner/nonce/call. A missing receipt alone cannot prove identity.
export async function assertMarketplaceOriginalTransaction(review, client, transactionHash) {
  check(/^0x[0-9a-f]{64}$/.test(transactionHash), 'MARKETPLACE_INVALID_TRANSACTION_HASH');
  check(client?.ccipRead === false, 'MARKETPLACE_FIXED_RPC_REQUIRED');
  check(await client.getChainId() === 4663, 'WRONG_CHAIN');
  const actual = await client.getTransaction({ hash: transactionHash }), expected = review.transaction;
  check(same(actual.hash, transactionHash) && same(actual.from, expected.from) && same(actual.to, expected.to)
    && same(actual.input, expected.data) && actual.value === BigInt(expected.value)
    && Number.isSafeInteger(actual.nonce) && BigInt(actual.nonce) === BigInt(expected.nonce)
    && actual.chainId === 4663 && ['legacy', '0x0', 0].includes(actual.type)
    && typeof actual.gas === 'bigint' && actual.gas > 0n && actual.gas <= BigInt(expected.gas)
    && typeof actual.gasPrice === 'bigint' && actual.gasPrice > 0n && actual.gasPrice <= BigInt(expected.gasPrice)
    && [actual.maxFeePerGas, actual.maxPriorityFeePerGas, actual.maxFeePerBlobGas].every(value => value == null)
    && [actual.blobVersionedHashes, actual.accessList, actual.authorizationList].every(value => value == null || (Array.isArray(value) && value.length === 0)), 'ORIGINAL_TRANSACTION_MISMATCH');
}

// All factory dependencies are trusted server composition. None are HTTP inputs.
// Optional verifier overrides support offline/disposable tests, not runtime flags.
export function createMarketplaceCoordinator({ store = null, release = currentMarketplaceRelease, deps = {}, now = Date.now,
  reviewBuilder = prepareMarketplaceReview, claimValidator = assertMarketplaceClaimable,
  receiptReconciler = reconcileMarketplaceReview } = {}) {
  const released = () => validateMarketplaceRelease(typeof release === 'function' ? release() : release);
  function response(scope, entry = null, { blockers = [], transaction = null, walletClaimed = false, forceBlocked = false } = {}) {
    const r = released();
    let availability = entry ? ({ PREPARED: 'OWNER_REVIEW_READY', WALLET_REQUESTED: 'RECOVERY_REQUIRED',
      COMPLETED: 'COMPLETED', REVERTED: 'REVERTED', CANCELLED: 'CANCELLED' })[entry.status] : 'EMPTY';
    if (forceBlocked || ((!entry || entry.status === 'PREPARED') && r.status !== 'OWNER_ASSIST')) availability = 'RELEASE_BLOCKED';
    // A pause observed after the committed claim still withholds the wallet payload.
    // That claim stays reserved, exactly like a lost HTTP response.
    if (r.status !== 'OWNER_ASSIST') { transaction = null; walletClaimed = false; }
    return { schema: MARKETPLACE_JOURNAL_SCHEMA, ...marketplaceScope(scope), availability,
      blockers: [...new Set([...(r.status === 'OWNER_ASSIST' ? [] : r.blockers), ...blockers])],
      entry: publicMarketplaceEntry(entry), transaction, walletClaimed, automaticSubmission: false,
      publicTransactions: 0, broadcastAuthority: 'OWNER_WALLET_ONLY', collectionFloorVerified: false };
  }
  async function lookup(scope) {
    check(store, 'MARKETPLACE_JOURNAL_UNAVAILABLE');
    const entry = await store.get(scope); check(entry, 'MARKETPLACE_INTENT_NOT_FOUND'); return entry;
  }
  const casMatches = (entry, scope) => entry.revision === scope.revision && entry.reviewHash === scope.reviewHash;
  async function stale(scope) { return response(scope, await lookup(scope), { blockers: ['MARKETPLACE_REVISION_CONFLICT'] }); }
  async function get(scope) {
    marketplaceScope(scope);
    if (Object.hasOwn(scope, 'intentId')) check(typeof scope.intentId === 'string' && /^[0-9a-f]{64}$/.test(scope.intentId), 'MARKETPLACE_INVALID_INTENT');
    if (!store) return response(scope, null, { blockers: ['MARKETPLACE_JOURNAL_NOT_RELEASED'] });
    return response(scope, scope.intentId ? await store.get(scope) : await store.current(scope));
  }
  async function prepare({ owner, punkId, input: raw }) {
    const scope = marketplaceScope({ owner, punkId }), input = marketplaceInput(raw), r = released();
    if (r.status !== 'OWNER_ASSIST') return response(scope, store ? await store.current(scope) : null, { forceBlocked: true });
    check(store, 'MARKETPLACE_JOURNAL_UNAVAILABLE');
    check(deps.client?.ccipRead === false, 'MARKETPLACE_FIXED_RPC_REQUIRED');
    scope.intentId = marketplaceIntentId(scope, input);
    const previous = await store.get(scope);
    if (previous) {
      check(marketplaceJson(previous.record.input) === marketplaceJson(input), 'MARKETPLACE_IDEMPOTENCY_CONFLICT');
      return response(scope, previous);
    }
    const reviewDeps = { ...deps, purchaseGuardDeployment: r.purchaseGuardDeployment };
    const review = await reviewBuilder(coreRequest(scope, input), reviewDeps);
    if (review.availability !== 'OWNER_REVIEW_READY' || !review.transaction) {
      return response(scope, null, { blockers: review.blockers ?? ['MARKETPLACE_REVIEW_BLOCKED'], forceBlocked: true });
    }
    check(review.owner === scope.owner && review.punkId === scope.punkId, 'MARKETPLACE_REVIEW_SCOPE_CHANGED');
    const record = { intentId: scope.intentId, releaseHash: marketplaceReleaseHash(r), input, review };
    serializeMarketplaceJournal(record);
    check(now() < review.expiresAt, 'MARKETPLACE_REVIEW_EXPIRED');
    const entry = await store.save(record);
    check(marketplaceJson(entry.record.input) === marketplaceJson(input), 'MARKETPLACE_IDEMPOTENCY_CONFLICT');
    return response(scope, entry);
  }
  async function claim(value) {
    const scope = marketplaceCas(value), entry = await lookup(scope), r = released();
    if (r.status !== 'OWNER_ASSIST') return response(scope, entry, { forceBlocked: true });
    check(deps.client?.ccipRead === false, 'MARKETPLACE_FIXED_RPC_REQUIRED');
    if (!casMatches(entry, scope) || entry.status !== 'PREPARED') return stale(scope);
    check(entry.record.releaseHash === marketplaceReleaseHash(r), 'MARKETPLACE_RELEASE_CHANGED');
    check(now() < entry.record.review.expiresAt, 'MARKETPLACE_REVIEW_EXPIRED');
    await claimValidator(entry.record, { ...deps, purchaseGuardDeployment: r.purchaseGuardDeployment }, now);
    check(marketplaceReleaseHash(released()) === entry.record.releaseHash, 'MARKETPLACE_RELEASE_CHANGED');
    check(now() < entry.record.review.expiresAt, 'MARKETPLACE_REVIEW_EXPIRED');
    const claimed = await store.update(scope, { status: 'WALLET_REQUESTED' });
    if (!claimed) return stale(scope);
    return response(scope, claimed, { walletClaimed: true, transaction: structuredClone(claimed.record.review.transaction) });
  }
  async function cancel(value) {
    const scope = marketplaceCas(value), entry = await lookup(scope);
    if (!casMatches(entry, scope)) return stale(scope);
    check(entry.status === 'PREPARED' && !entry.reportedHash, 'MARKETPLACE_CLAIMED_PURCHASE_RESERVED');
    return response(scope, await store.update(scope, { status: 'CANCELLED', reason: 'OWNER_CANCELLED_UNCLAIMED' }) ?? await lookup(scope));
  }
  async function decline(value) {
    const scope = marketplaceCas(value), entry = await lookup(scope);
    if (!casMatches(entry, scope)) return stale(scope);
    check(entry.status === 'WALLET_REQUESTED' && !entry.reportedHash, 'MARKETPLACE_DECLINE_UNAVAILABLE');
    if (entry.reason === 'WALLET_DECLINED_UNVERIFIED') return response(scope, entry);
    // Browser rejection is not proof of non-broadcast. It never releases the hold.
    return response(scope, await store.update(scope, { status: 'WALLET_REQUESTED', reason: 'WALLET_DECLINED_UNVERIFIED' }) ?? await lookup(scope));
  }
  async function recover(value) {
    let scope = marketplaceCas(value), entry = await lookup(scope);
    const hash = value.transactionHash === undefined ? entry.reportedHash : value.transactionHash;
    check(hash === null || (typeof hash === 'string' && /^0x[0-9a-f]{64}$/.test(hash)), 'MARKETPLACE_INVALID_TRANSACTION_HASH');
    if (entry.reportedHash && hash !== entry.reportedHash) throw Error('MARKETPLACE_ORIGINAL_HASH_IMMUTABLE');
    if (!casMatches(entry, scope)) return stale(scope);
    if (terminal(entry.status)) return response(scope, entry);
    check(entry.status === 'WALLET_REQUESTED', 'MARKETPLACE_CLAIM_REQUIRED');
    if (!hash) return response(scope, entry, { blockers: ['MARKETPLACE_ORIGINAL_HASH_REQUIRED'] });
    check(deps.client?.ccipRead === false, 'MARKETPLACE_FIXED_RPC_REQUIRED');
    if (!entry.reportedHash) {
      try { await assertMarketplaceOriginalTransaction(entry.record.review, deps.client, hash); }
      catch (error) {
        if (error.message === 'ORIGINAL_TRANSACTION_MISMATCH' || error.message === 'WRONG_CHAIN') throw error;
        return response(scope, entry, { blockers: ['MARKETPLACE_ORIGINAL_TRANSACTION_NOT_OBSERVED'] });
      }
      const saved = await store.update(scope, { status: 'WALLET_REQUESTED', reportedHash: hash, reason: 'ORIGINAL_TRANSACTION_OBSERVED' });
      if (!saved) return stale(scope);
      entry = saved; scope = { ...scope, revision: saved.revision };
    }
    let receipt;
    try { receipt = await receiptReconciler(entry.record.review, { client: deps.client, transactionHash: hash, minConfirmations: 12 }); }
    catch { return response(scope, entry, { blockers: ['MARKETPLACE_ORIGINAL_RECEIPT_UNVERIFIED'] }); }
    check(receipt.transactionHash === hash && ['PENDING', 'PENDING_FINALITY', 'COMPLETED', 'REVERTED'].includes(receipt.status), 'MARKETPLACE_RECEIPT_INVALID');
    if (['PENDING', 'PENDING_FINALITY'].includes(receipt.status)) return response(scope, entry, { blockers: [`MARKETPLACE_${receipt.status}`] });
    const completed = await store.update(scope, { status: receipt.status, reportedHash: hash, receipt, reason: null });
    return response(scope, completed ?? await lookup(scope));
  }
  return Object.freeze({ get, prepare, claim, recover, cancel, decline });
}
