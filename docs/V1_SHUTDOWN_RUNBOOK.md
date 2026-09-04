# Art Broker V1 shutdown map

Canonical cutoff: `2026-09-05T22:00:00Z` (September 5, 2026 at 6:00 PM EDT).
Server time is authoritative. Browser countdown state never grants execution authority.

## Execution map

1. Netlify schedules invoke the V2/V3 automation runners, five regular V3 lane workers,
   the priority worker, Scout, and analysis tasks.
2. The shared background policy blocks V1 discovery/execution tasks at the cutoff while leaving
   ownership, activity, metadata, and NFT indexing available.
3. Every hosted transaction runner checks the lifecycle at invocation and again immediately before
   `sendTransaction`. Owner-paid V1 intent expiry is capped before the cutoff.
4. The priority worker may reconcile a transaction submitted before the cutoff, but it cannot begin
   a new submission at or after the cutoff.
5. The scheduled retirement finalizer converges once per minute. It cancels only unsubmitted queue
   work, releases unsubmitted paid-mint reservations, preserves enrollment/history rows, and leaves
   submitted or reserved priority attempts marked for receipt reconciliation.
6. Punk ownership, canonical Punk Wallets, account balances, NFT holdings, history, and owner-only
   withdrawals do not depend on V1 worker readiness and remain available.

## State model

- `V1_ACTIVE`: compatibility state outside the sunset window.
- `V1_SUNSET_PENDING`: V1 operates until the canonical cutoff; hosted deposits remain retired.
- `V1_SHUTDOWN_EXECUTING`: the cutoff is enforced while durable queues converge.
- `V1_RETIRED`: transaction execution and registration are closed and reconciliation is complete.
- `V2_COMING_SOON`: public post-retirement product state; V2 execution remains disabled.

An emergency `PAUSED_MIGRATION` state remains available before the cutoff, but it cannot extend V1
past the canonical time.

## Financial map

Hosted gas/prepay deposits are user liabilities until proven otherwise. Reconciliation combines
Supabase deposits, credits, sessions, receipt-backed gas usage, prior refunds, Netlify activity, and
dual-provider on-chain balances. The generated ledger and payout manifests are deterministic and
dry-run only. Payout identities reserve signer nonce, envelope hash, and transaction hash durably
before any separately authorized broadcaster could submit.

`FINAL_SWEEP_READY` remains false unless history is complete, user liability is zero, ambiguous funds
are zero, and expected balance equals actual hosted balance. No refund or project sweep is authorized
by the shutdown deployment.

## Cutoff classifications

- `COMPLETED_BEFORE_SHUTDOWN`: already recorded; history is unchanged.
- `SUBMITTED_BEFORE_SHUTDOWN`: receipt is reconciled without another submission.
- `CANCELLED_V1_RETIREMENT`: no transaction was reserved or submitted before cutoff.
- `FAILED_BEFORE_SHUTDOWN`: historical failure remains immutable.
- `REQUIRES_RECEIPT_RECONCILIATION`: durable submission reservation/submission needs proof.

## Operational order

1. Deploy countdown, transaction guards, funding/registration closure, and additive audit schemas.
2. Confirm production release, lifecycle time, worker health, withdrawal reads, and dry-run ledger.
3. At cutoff, let every transaction boundary reject V1 and run the convergent finalizer.
4. Reconcile submitted/reserved work and prove zero active executable jobs.
5. Review and fund the deterministic user-refund manifest; broadcast only after explicit approval.
6. Reconcile balances again; sweep only a positively proven project residual.
