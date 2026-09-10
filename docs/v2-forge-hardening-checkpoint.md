# Forge integration hardening — September 9, 2026

Scope: isolated feature branches, disposable chain 31337, shared V2 browser components. No production deployment, wallet signature, NFT burn, fund movement or live mission mutation.

## Fixed in this pass

- Selection identity includes owner and chain, not just token ID. Changing wallet/network closes reviews, clears results and rejects late responses even for the same Punk.
- Snapshot validation rejects unknown/duplicate skills, invalid levels/credits, missing ownership epoch, mismatched capability blocks, unlearned equipment and cross-token/future history. Recovery records are identity/status/hash checked.
- Known receipts are rechecked on reload, before preparing another review and before confirming it. Missing/reorged evidence relocks training. This is conservative local reconciliation, not production finality.
- Reviews bind the exact account transaction nonce. Another pending wallet transaction invalidates the review; the UI cannot silently substitute a fresh nonce.
- Lost-hash recovery accepts an intent ID and existing hash only. It verifies current owner, saved nonce, hash, sender, destination, calldata, zero value and fee bounds, then canonical receipt/event evidence. Wrong hashes preserve the blocker. It never calls a signer or sends a transaction.
- The UI exposes **VERIFY EXISTING HASH · NO SEND** for ambiguous requests. A browser test drops a hash after real Anvil broadcast, recovers it and verifies one SkillLearned event.
- Wallet preflight failure is distinguished from ambiguous broadcast. Only the adapter can attest that it never called `eth_sendTransaction`; a provider error cannot falsely clear an actual send attempt.
- Independent coordinator races and twelve simultaneous confirmations of one intent produce one broadcast in tests.

## Local protocol version

Nonce-bearing reviews are version 2 of the local review protocol, not a new product or core architecture. The journal deployment identity includes that version. Old entries without a nonce fail closed; no silent migration into economic authority. Restarting the preview creates a new disposable chain and practice state.

The wallet adapter reads `eth_chainId`, `eth_accounts` and `eth_getTransactionCount`; `eth_sendTransaction` requires explicit review. It does not auto-connect accounts, switch networks, sign messages or use production wallets.

## Verification and build environment

Final results: **166/166 Forge tests** (including 49 transaction/recovery cases), **128/128 V2 regressions**, and **27/27 shared snapshot/recovery-view tests** passed. The 27 view tests are also included in the Forge total, not additional unique tests. Both shared and standalone browser flows passed. An under-load standalone browser timeout was reproduced as passing in isolation; the final combined rerun passed after aligning its bounded wait with the shared harness and adding status diagnostics.

The Forge and broader V2 chat/collection/discovery/execution suites were exercised. Shared training browser tests cover learn/equip/unequip, pending receipt + coordinator restart + reload, lost-hash recovery, owner/network changes and stale responses. The research-only V2 browser retains its no-training boundary. Desktop/mobile widths: 1440, 390 and 375px.

Site integrity and JavaScript syntax checks passed. The V2 entrypoint bundled in memory (266,774 bytes), without generated-asset edits or deployment.

The shared installed esbuild 0.28.2 executable is truncated: 2,768,384 bytes, with Mach-O segments pointing past EOF. It cannot start. This check used a separate exact locked `@esbuild/darwin-x64` 0.28.2 archive, verified against package-lock SHA-512 and selected via `ESBUILD_BINARY_PATH`. Shared dependencies were not overwritten. Ordinary builds still need that local installation repaired. Disk space was approximately 160 MB before the isolated download; free space before a full dependency reinstall.

## Remaining production gates

Owner follow-up approved the recommended opt-in rollout policy. This records the product decision only; it does not enroll #93, activate production training or authorize a real burn.

Follow-up smoke test on the existing chain-31337 preview passed: Test #1 equipped Rarity Eye, ran real read-only metadata research, unequipped it and verified tool denial. Its original loadout and credits were restored; Test #44 retains one unused mock-earned credit and no learned skills for owner practice. No new chain, browser profile or screenshot files were created for this smoke test.

1. **Rollout choice:** immediate equipment enforcement disables untrained existing agents; silent grandfathering bypasses the rule. Recommended: explicit owner opt-in, leaving existing agents unchanged until enrollment. No policy has been activated or assumed.
2. **Burn source and recovery:** parent burn can remove wallet authority. Complete empty-wallet proof or an approved recovery path is not established. Unknown assets and obligations remain blockers; acknowledgment cannot override them.
3. **On-chain lifecycle:** local nonce recovery does not add deadlines or ownership epochs to the progression ABI. Delayed signatures and sell/buy-back lifecycle require reviewed core/on-chain handling.
4. **Production persistence:** local SQLite is not Netlify/Postgres. Production authentication, multi-worker intents, finality/indexing, deployment pins and operational recovery remain separate integration work.
5. **Skill acceptance:** zero new production READY registrations. Passing fixtures does not approve Mint Hunter, marketplace purchases or paid trading.

No main push or production deployment is required to inspect this checkpoint. The practice route is `http://127.0.0.1:64341/control-center` on this Mac only. Test #44 starts with one mock-earned credit after restart. Do not burn real Punks to test this route.

## Screenshot follow-up: idle-chain review recovery

The local clock advances the disposable chain after idle time. Preparing against the block displayed before that advance caused `STALE_REVIEW_STATE`; the UI previously cleared the loadout.

The shared UI now fetches a fresh validated snapshot before preparing, checks unchanged owner/deployment/ownership epoch, and retries only an explicit stale preparation rejection once. Repeated rejection refreshes the verified loadout and recovery state with an actionable message. Confirmation and submission are never automatically retried.

The local preview additionally rejects mixed-block progression/capability snapshots, retrying the read once. This backend guard was tested on a separate disposable preview; the owner's running preview was not restarted, preserving its practice state. Its updated static frontend is already served; the backend guard takes effect at the next normal restart (which creates a new disposable chain).

Verification: 76/76 targeted transaction/recovery and snapshot-view tests passed. The shared browser suite passed at 1440/390/375px, including an advanced displayed block, one stale prepare retry, repeated stale rejection with loadout recovery, explicit cancel/confirm, learn/equip/research/unequip, pending receipt reload and lost-hash recovery. Read-only checks confirmed the existing preview still serves its practice state and the updated script. No production changes or burns.
