# Worker ownership-continuity mitigation

Updated September 12, 2026 after investigating Punk #93's intermittent production ownership-check failures. This correction changes the worker verifier; it does not change account contracts or authorize a new mission.

## What changed

The scheduled Punk Agent worker now loads the existing `authorization_transaction_hash` from `broker_v2_agent_sessions`; no migration is needed. Its mandatory guard:

1. Verifies a successful canonical authorization receipt from the selected account, with exactly one session-configured event matching the mission's owner, session key and generation.
2. Reads canonical collection ownership, account generation and active-session status at one block.
3. Scans canonical collection Transfer logs for the selected Punk from the authorization block through that head, including away-and-back transfers.
4. Captures a closing head after the history scan. If blocks arrived, scans every new block through that closing head and rechecks ownership, generation and session activity there. Epoch accounts also recheck their epoch binding there.
5. Rechecks the canonical hashes and numbers of the authorization block, initial head and closing head. Evidence names only the fully checked closing block; later block production does not extend the attested range.

The check runs before discovery, immediately before signing after candidate work, and after estimation/reservation immediately before submission. No caller can omit this guard from `runPunkAgentMissionOnce`.

A verified transfer returns `OWNERSHIP_CHANGED_SINCE_AUTHORIZATION`, persists the mission as PAUSED through the existing failure handler and records an activity reason. A changed owner/session also pauses. An unverified read blocks that attempt without signing/submitting and remains retryable. A freshly approved later session uses its own receipt/generation, not a manually reset “transfer seen” flag.

If the final guard fails after a signed operation has been reserved, the existing conservative RECONCILIATION_REQUIRED record is retained. It is never silently marked collected or retried as a new send.

## Deliberate limits and deployment impact

- Queries use 2,000-block pages, with a 40,000-block inclusive maximum. Exceeding that bound pauses the worker and requires fresh mission approval; it does not assume an unscanned range is empty.
- This cap is an initial engineering limit, not the desired long-term mission duration. Existing long-lived sessions may exceed it. Measure RPC latency/rate limits and design a durable, reorg-aware incremental history index before deployment if this is too restrictive.
- Even a transfer earlier in the authorization block is conservatively rejected. Reauthorization in a later block is required.
- Initial and closing heads must be no more than 30 seconds old (with at most five seconds future clock skew). The initial snapshot must still be within that age at completion. The closing head cannot move backwards, change hash at the same height, move its timestamp backwards, or advance by more than 2,000 blocks. A slow or inconsistent read remains retryable. There is one bounded catch-up pass, not an unbounded loop waiting for the chain to stop.
- The 40,000-block legacy history cap includes the closing tail. No range is skipped to make an old mission pass. Production requires archive access; the unauthenticated PublicNode endpoint rejected the historical log request during this investigation.
- Missing authorization hashes, malformed data, RPC errors, unmatched events, removed logs and inconsistent block hashes fail closed. Provider details are not exposed through activity codes.
- The result assumes an honest, complete RPC history response. It is not a cryptographic proof that a provider did not omit logs, nor a burn-eligibility attestation.

## What this does NOT fix

The deployed account contract still cannot distinguish original owner → another owner → original owner using owner-address equality alone. Its previously demonstrated old-operation behavior is unchanged.

This worker patch cannot cancel a previously signed operation, a signature already supplied for bundler estimation, or a transfer occurring after the last check and before inclusion. It adds no on-chain transfer epoch and does not upgrade an immutable account. Low-level signing/submission helpers are not independently upgraded by this patch; the scheduled worker is the guarded application path.

The complete on-chain requirement remains a production blocker. It needs a separately reviewed account-level invalidation design and deployment/migration plan. Possible use of transfer-cleared ERC721 approvals as a revocation latch would introduce a new approval workflow and requires an inert, non-executing marker design, verified collection behavior and security review; none is implemented or installed here. Do not approve a worker/session signer to transfer a controlling Punk.

No new withdrawal authority, project custody, arbitrary NFT approval or execution module has been added. Forge production enrollment and burns are not enabled.

## Verification

104 tests passed across continuity, worker/endpoints, account runtime, ownership, recall and mint/UserOperation regression suites. The 62 continuity tests include advancing heads through all three worker guards, complete tail coverage, tail-only round trips, closing owner/session/epoch changes, reorgs at all three anchors, malformed/unavailable tail evidence, unchanged history bounds and expired evidence. A final-guard transfer after reservation preserves the reconciliation record and prevents submission. These are deterministic RPC/database fixtures, not an on-chain cure.

The read-only production diagnostic reproduced the old rejection with #93's generation-6 authorization at block `61486037`: all 12 history pages were empty and canonical, but the head advanced from `61509058` to `61509119` during the read. The old verifier rejected that ordinary 61-block advance.

Before this correction was deployed, an existing scheduled attempt subsequently passed the old guard and completed the already approved one-mint mission. The receipt for [Project Mars Plots #152](https://robinhoodchain.blockscout.com/tx/0xcbdcc88f9309fce5721326fa8e8e7c088012d6cf4f781e64a10f906d6c6f3b60), block `61509639`, contains a mint transfer to #93's Agent account `0xcAdcFD37e715bC031cF0cEC7fA2335091c878C83`; current `ownerOf(152)` agrees. Production recorded four opportunities checked, one simulation passed and mission completion at 23:55:08 UTC. A subsequent live verifier correctly rejects that consumed session. This receipt demonstrates the existing mission's success; it is not a canary of this correction or permission to start another mission.

The existing contract characterization in [the transfer checkpoint](./v2-forge-transfer-checkpoint.md) remains valid and must remain visible until an actual account-level fix is verified.
