// OFFLINE TEST DATA ONLY. These attestations do not authorize any deployment or purchase.
import { randomUUID } from 'node:crypto';
import { marketplaceDigest, marketplaceJson, serializeMarketplaceJournal } from '../../broker/src/v4/marketplace/durable-journal.mjs';
export const address = digit => `0x${digit.repeat(40)}`;
export const hash = digit => `0x${digit.repeat(64)}`;
export function marketplaceFixture({ owner = address('1'), punkId = '93', now = Date.now() } = {}) {
  const input = { requestId: randomUUID(), action: 'BUY_LISTINGS',
    selection: { collection: address('3'), orderHashes: [hash('4')] },
    budget: { maxTotalPriceWei: '100', maxNetworkFeeWei: '1000000', minimumReserveWei: '50' } };
  const release = { schema: 'GOGH_MARKETPLACE_RELEASE_V1', status: 'OWNER_ASSIST', chainId: 4663, action: 'BUY_LISTINGS',
    purchaseGuardDeployment: { environment: 'OWNED_DISPOSABLE_CHAIN', address: address('5'), codeHash: hash('6') },
    evidence: { selection: 'a'.repeat(64), screening: 'b'.repeat(64), policySkills: 'c'.repeat(64), database: 'd'.repeat(64) }, blockers: [] };
  const review = { schema: 'GOGH_MARKETPLACE_REVIEW_V1', owner, punkId, walletRole: 'AGENT', chainId: 4663,
    action: 'BUY_LISTINGS', wallet: address('2'), recipient: address('2'), availability: 'OWNER_REVIEW_READY',
    blockers: [], automaticSubmission: false, publicTransactions: 0, walletRequests: 0, broadcastAuthority: 'OWNER_WALLET_ONLY',
    collectionFloorVerified: false, accountState: '8', anchor: { number: '10', hash: hash('7'), timestamp: String(Math.floor(now / 1000)) },
    expiresAt: (Math.floor(now / 1000) + 60) * 1000, purchaseGuard: { address: address('5'), codeHash: hash('6') },
    safety: { status: 'PASS', collectionCodeHash: hash('9') }, simulation: { status: 'PASS' },
    policy: { decision: 'ALLOW', mode: 'ASSIST', requiredSkillsEquipped: true, adapterApproved: true, budgetAllowed: true },
    selection: { collection: address('3'), items: [{ orderHash: hash('4'), tokenId: '12', totalWei: '100', counter: '0' }] },
    cost: { totalPriceWei: '100', minimumReserveWei: '50', maximumNetworkFeeWei: '1000000' },
    transaction: { from: owner, to: address('2'), data: '0x12345678', value: '0x0', type: '0x0', nonce: '0x7',
      chainId: '0x1237', gas: '0x186a0', gasPrice: '0xa' } };
  const transactionHash = hash('a');
  const actual = { hash: transactionHash, from: owner, to: address('2'), input: review.transaction.data,
    value: 0n, type: 'legacy', nonce: 7, chainId: 4663, gas: 100000n, gasPrice: 10n };
  const receipt = { status: 'COMPLETED', transactionHash, blockNumber: '12', blockHash: hash('b'), confirmations: '12', publicTransactions: 0 };
  const client = { ccipRead: false, getChainId: async () => 4663, getTransaction: async () => actual, getTransactionReceipt: async () => receipt };
  return { owner, punkId, input, release, review, actual, transactionHash, receipt, client };
}
export function memoryMarketplaceStore() {
  const rows = new Map();
  const sameScope = (entry, scope) => entry.record.review.owner === scope.owner && entry.record.review.punkId === scope.punkId;
  return {
    rows,
    async get(scope) { const entry = rows.get(scope.intentId); return entry && sameScope(entry, scope) ? structuredClone(entry) : null; },
    async current(scope) { return structuredClone([...rows.values()].reverse().find(entry => sameScope(entry, scope)) ?? null); },
    async save(record) {
      const existing = rows.get(record.intentId); if (existing) return structuredClone(existing);
      if ([...rows.values()].some(entry => ['PREPARED', 'WALLET_REQUESTED'].includes(entry.status)
        && (entry.record.review.owner === record.review.owner || entry.record.review.punkId === record.review.punkId))) throw Error('MARKETPLACE_UNRESOLVED_PURCHASE');
      const entry = { record: structuredClone(record), reviewHash: marketplaceDigest(serializeMarketplaceJournal(record)),
        revision: 0, status: 'PREPARED', reportedHash: null, receipt: null, reason: null };
      rows.set(record.intentId, entry); return structuredClone(entry);
    },
    async update(scope, { status, reportedHash = null, receipt = null, reason = null }) {
      const entry = rows.get(scope.intentId);
      if (!entry || !sameScope(entry, scope) || entry.revision !== scope.revision || entry.reviewHash !== scope.reviewHash) return null;
      if (!((entry.status === 'PREPARED' && ['WALLET_REQUESTED', 'CANCELLED'].includes(status))
        || (entry.status === 'WALLET_REQUESTED' && ['WALLET_REQUESTED', 'COMPLETED', 'REVERTED'].includes(status)))) throw Error('MARKETPLACE_INVALID_TRANSITION');
      if (entry.reportedHash && entry.reportedHash !== reportedHash) throw Error('MARKETPLACE_ORIGINAL_HASH_IMMUTABLE');
      const next = { ...entry, revision: entry.revision + 1, status, reportedHash, receipt, reason };
      rows.set(scope.intentId, structuredClone(next)); return structuredClone(next);
    },
  };
}
export const cas = (f, result) => ({ owner: f.owner, punkId: f.punkId,
  intentId: result.entry.intentId, revision: result.entry.revision, reviewHash: result.entry.reviewHash });
export const sameInput = (left, right) => marketplaceJson(left) === marketplaceJson(right);
