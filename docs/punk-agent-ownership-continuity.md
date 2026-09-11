# Worker ownership-continuity mitigation

September 9, 2026. Local feature-branch code only: no main push, deployment, environment change, revocation or fund movement.

## What changed

The scheduled Punk Agent worker now loads the existing `authorization_transaction_hash` from `broker_v2_agent_sessions`; no migration is needed. Its mandatory guard:

1. Verifies a successful canonical authorization receipt from the selected account, with exactly one session-configured event matching the mission's owner, session key and generation.
2. Reads canonical collection ownership, account generation and active-session status at one block.
3. Scans canonical collection Transfer logs for the selected Punk from the authorization block through that head, including away-and-back transfers.
4. Rechecks the authorization block and head, rejecting reorgs, stale heads or a head advance during the read.

The check runs before discovery, immediately before signing after candidate work, and after estimation/reservation immediately before submission. No caller can omit this guard from `runPunkAgentMissionOnce`.

A verified transfer returns `OWNERSHIP_CHANGED_SINCE_AUTHORIZATION`, persists the mission as PAUSED through the existing failure handler and records an activity reason. A changed owner/session also pauses. An unverified read blocks that attempt without signing/submitting and remains retryable. A freshly approved later session uses its own receipt/generation, not a manually reset “transfer seen” flag.

If the final guard fails after a signed operation has been reserved, the existing conservative RECONCILIATION_REQUIRED record is retained. It is never silently marked collected or retried as a new send.

## Deliberate limits and deployment impact

- Queries use 2,000-block pages, with a 40,000-block inclusive maximum. Exceeding that bound pauses the worker and requires fresh mission approval; it does not assume an unscanned range is empty.
- This cap is an initial engineering limit, not the desired long-term mission duration. Existing long-lived sessions may exceed it. Measure RPC latency/rate limits and design a durable, reorg-aware incremental history index before deployment if this is too restrictive.
- Even a transfer earlier in the authorization block is conservatively rejected. Reauthorization in a later block is required.
- The head must be no more than 30 seconds old (with at most five seconds future clock skew), and cannot advance during a check. Busy/slow RPCs may cause repeated deferrals. No production liveness claim is made.
- Missing authorization hashes, malformed data, RPC errors, unmatched events, removed logs and inconsistent block hashes fail closed. Provider details are not exposed through activity codes.
- The result assumes an honest, complete RPC history response. It is not a cryptographic proof that a provider did not omit logs, nor a burn-eligibility attestation.

## What this does NOT fix

The deployed account contract still cannot distinguish original owner → another owner → original owner using owner-address equality alone. Its previously demonstrated old-operation behavior is unchanged.

This worker patch cannot cancel a previously signed operation, a signature already supplied for bundler estimation, or a transfer occurring after the last check and before inclusion. It adds no on-chain transfer epoch and does not upgrade an immutable account. Low-level signing/submission helpers are not independently upgraded by this patch; the scheduled worker is the guarded application path.

The complete on-chain requirement remains a production blocker. It needs a separately reviewed account-level invalidation design and deployment/migration plan. Possible use of transfer-cleared ERC721 approvals as a revocation latch would introduce a new approval workflow and requires an inert, non-executing marker design, verified collection behavior and security review; none is implemented or installed here. Do not approve a worker/session signer to transfer a controlling Punk.

No new withdrawal authority, project custody, arbitrary NFT approval or execution module has been added. Forge production enrollment and burns are not enabled.

## Verification

54 tests passed across continuity, worker/endpoints, account runtime, ownership and mint/UserOperation regression suites. Coverage includes a successful mock worker run, old-owner round trip before discovery, during candidate inspection, during gas estimation and during reservation; database pause/activity persistence; fresh authorization; chunk bounds; same-block conservative rejection; stale/malformed/reorged evidence; and no provider-error leakage. These are deterministic RPC/database fixtures, not a live-chain canary or an on-chain cure.

The existing contract characterization in [the transfer checkpoint](./v2-forge-transfer-checkpoint.md) remains valid and must remain visible until an actual account-level fix is verified.
