# Forge practice: recover an expired unsent review

The holder's WETH collection offer completed on the copied chain and delivered practice NFT #10001. Their separate Forge practice was blocked before burn: an optional `claim_rarity` review had reached persisted `EXPIRED`, with no transaction hash, no source approval and zero credits. Both cancellation and subsequent actions were disabled.

The local practice now reads the exact persisted review before displaying or cancelling it. A matching, never-claimed `EXPIRED` review can be explicitly discarded; a `PREPARED` cancellation uses its fresh database revision. Claimed/unknown/hash-bearing work stays reserved regardless of its deadline. Only a successful durable cancellation or verified never-claimed expiry clears the display review. Production coordinators, database rules, releases and contracts are unchanged.

The screen shows a countdown, a clear **Discard expired review** action and the next step. Optional starting-slot and additional-slot work is collapsed: #93 already has a slot for Rarity Eye. The confirmation cutoff matches the existing five-second wallet margin. A failed confirmation response first invalidates the cached unsent display; the user must refresh the original result before controls can be restored. This avoids falsely saying that nothing was submitted after a lost response.

## Holder retry

Fresh repaired practice: **http://127.0.0.1:51952/** on this Mac. It uses new copies and requires no real wallet. The prior stalled Forge process at 50786 and successful WETH practice at 50652 were preserved. Refreshing the old Forge URL alone cannot update that process's imported server code.

1. Choose **Review approval for copy #1753**. Tick the copied-assets acknowledgement, type **CONFIRM COPY**, and confirm.
2. Choose **Review copied sacrifice**. Tick the acknowledgement, type **BURN COPY 1753**, and confirm. #93 should receive exactly one credit.
3. Choose **Learn · 1 credit**, review and confirm with **CONFIRM COPY**. The credit is spent to learn Rarity Eye.
4. Choose **Equip in slot 1**, review and confirm with **CONFIRM COPY**.
5. Choose **Use equipped Rarity Eye** to compare three copied Punks. Unequip to verify the tool becomes unavailable.

If a review expires, discard the expired unsent review and prepare the step again. If the confirmation result is uncertain, refresh progress to check its original record; the screen will not permit another send based on a stale review.

## Verification

- 85 targeted regression tests pass: 21 new expiry/identity/hash cases and 64 existing store, wallet, burn and settlement cases. No skips/failures.
- Repository syntax gate passes for 794 JavaScript modules.
- Actual Chrome journey passed at 21:57:58 UTC on a newly owned fork and native PostgreSQL: injected confirmation transport failure → reserved controls → fresh unsent recovery → real deadline expiry → reload → explicit discard → approval → copied burn → exactly one credit across reload → learn → equip → actual trait comparison → unequip denial.
- Screenshots at 1440, 375 and 320 pixels show the repaired expiry state without overflow. The independent reviewer inspected the safety boundaries and evidence.
- No production burn, wallet request, public transaction, contract deployment or refund occurred. The confirmation transport failure was injected before the test request reached the server; it proves browser ambiguity handling, not an actual lost blockchain send. Lost claim acknowledgement and unknown hashes are covered by the reservation tests.

See [browser evidence](forge-interactive-evidence.json) and [independent review](forge-practice-expiry-review.md). The full repository/contract gates from PR #68 remain the preceding baseline; this local-only follow-up ran targeted safety tests and the actual affected journey rather than claiming a new full-suite run.
