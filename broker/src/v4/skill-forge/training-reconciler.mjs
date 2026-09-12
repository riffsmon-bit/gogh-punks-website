import { readDurableTrainingReceipt } from './training-receipt-verifier.mjs';
import { readTrainingSettlement, TRAINING_SETTLED_STATES } from './training-settlement.mjs';

const scopeOf = record => ({ intentId: record.intentId, owner: record.review.owner, tokenId: record.review.tokenId });
const safeCode = error => /^[A-Z_0-9]{1,80}$/.test(error?.message ?? '') ? error.message : 'TRAINING_RECONCILIATION_UNAVAILABLE';

// Internal worker: RPC reads and database reconciliation only. Never sends a
// transaction, solicits another signature or returns a seller's private record.
export async function reconcileTrainingBatch({ store, clients, expectedRuntimeHash, expectedSnapshotHash,
  limit = 4, now = Date.now, maxDurationMs = 20000 }) {
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 60000) throw Error('INVALID_WORKER_BUDGET');
  const started = now(), lease = await store.claimPendingReconciliation({ limit, leaseSeconds: 120 });
  const summary = { claimed: lease.records.length, settled: 0, pending: 0, deferred: 0, errors: {}, publicTransactions: 0 };
  for (const claimed of lease.records) {
    const scope = scopeOf(claimed);
    let reason = 'WORKER_TIME_BUDGET', delaySeconds = 15;
    try {
      if (now() - started >= maxDurationMs) { summary.deferred++; continue; }
      let current = await store.get(scope);
      if (!current || !current.holdsTraining || TRAINING_SETTLED_STATES.includes(current.status)) {
        reason = 'ALREADY_RESOLVED'; continue;
      }
      let receiptError = null;
      if (current.transactionHash) {
        let receipt;
        try {
          receipt = await readDurableTrainingReceipt({ client: clients[0], review: current.review,
            transactionHash: current.transactionHash, expectedRuntimeHash, expectedSnapshotHash,
            previousObservation: ['INCLUDED_SUCCESS','INCLUDED_REVERT'].includes(current.status) ? current.observation : null });
        } catch (error) { if (error?.name !== 'TransactionNotFoundError') receiptError=error; }
        if (receipt?.observation && receipt.observation.status !== current.status) {
          current = await store.recordVerifiedObservation(scope, current.revision, receipt.observation);
        }
      }
      const read = await readTrainingSettlement({ clients, review: current.review, transactionHash: current.transactionHash,
        expectedRuntimeHash, expectedSnapshotHash, now });
      if (read.settlement) {
        await store.recordVerifiedSettlement(scope, current.revision, read.settlement);
        summary.settled++; reason = read.settlement.status;
      } else {
        if(receiptError)throw receiptError;
        summary.pending++; reason = read.reason; delaySeconds = 30;
      }
    } catch (error) {
      reason = safeCode(error); summary.errors[reason] = (summary.errors[reason] ?? 0) + 1;
      delaySeconds = 60;
    } finally {
      // Terminal settlement atomically removes the job. A stale/expired lease can
      // never overwrite the schedule of a worker that has since reclaimed it.
      await store.finishReconciliation({ intentId: claimed.intentId, leaseToken: lease.leaseToken, delaySeconds, result: reason });
    }
  }
  return summary;
}
