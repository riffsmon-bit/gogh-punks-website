# V2 release target: September 16, 2026

Target: Wednesday, September 16, America/Detroit. This is the requested release
target, not a claim that production acceptance is complete.

## Integrated candidate

PR #47 combines the live production source (`0daf269`), the #93 session-usage fix
(`8f9ff08`) and the newest original-NFT Forge work (`22ba691`). It preserves the
live gas-funding, chat review reuse and collection/history flows. The working tree
is isolated from the owner's older, modified checkout.

- Mint limits count prior confirmations and pending operations against the correct
  session. Daily and per-opportunity duplicate protection still spans sessions.
- Scout activity explains why candidates were rejected. #93's historical mint
  must not exhaust its newer one-mint mission.
- The new Forge includes research, verified loadout display, original-NFT ownership
  refresh and disposable reviewed learning/equipping tests. Original-NFT transfer
  carries account/Forge state; private chat and unsigned seller reviews stay private.
- Production training remains disabled. The immutable account's away-and-back
  ownership limitation still requires the worker's canonical transfer-history guard.

## Work toward the target

| Date | Required result |
| --- | --- |
| Sep 10–11 | Restore and verify the combined hosted preview; complete merge regression checks; record remaining live-release blockers. |
| Sep 12–13 | Exercise the full V2 owner journey: connect, select, fund gas, create/reuse a review, activate, scout, explain rejections, collect and withdraw. Verify failures and ownership changes on desktop/mobile. |
| Mon Sep 14 | Produce the release candidate and concrete production rollout/rollback review. Complete controlled live acceptance of the #93 fix after deployment authorization, including session usage and canonical receipts. |
| Tue Sep 15 | Fix acceptance failures, freeze the candidate, verify the hosted build and monitoring. Resolve any missing owner-operated wallet steps. |
| Wed Sep 16 | Release only the accepted scope; report actual enabled capabilities and remaining gates. |

The owner requested the complete V2/Forge work and undeployed contracts be prepared
for morning review. The integrated candidate includes V2 minting and the new Forge
research/loadout surface. Live training and burns still require the implementation
and acceptance work below; preparing their review does not make them finished or
authorize deployment. See [the morning review](V2_MORNING_REVIEW_2026-09-11.md).

## Live Forge release dependencies

The detailed baseline is [the durable training checkpoint](v2-forge-durable-training-checkpoint.md).
The remaining items are concrete implementation and acceptance work:

1. PostgreSQL concurrency, restart and restricted-role validation; reviewed migration
   application. Memory-engine tests do not establish deployed database durability.
2. Canonical finality, unresolved/replaced nonce recovery and reservation release.
3. Authenticated production review/confirm/recovery endpoints and owner-wallet UI,
   with original-NFT continuity checks throughout.
4. A production training source, registry acceptance and enforcement of equipped
   capabilities. No research skill is promoted to production READY by this merge.
5. Administrator security review, a fresh fee ceiling and deployment/configuration
   authorization before live contract changes.
6. For real burns: complete account asset inventory/recovery, guarded 1,111 supply
   floor, exact transaction review and a separately approved first burn. Funded #93
   remains excluded while its recovery inventory is incomplete.

## Preview failure and correction

Netlify deploy `6aa369aa1af589000823a99a` passed `site:deploy-check`, then the
read-only Forge canary failed with `PROVIDER_READ_UNAVAILABLE` after its contract
inspection succeeded. The failed provider read prevented the preview from publishing.

Deploy previews now run the full application deployment gate independently of live
provider availability. Production retains the live research canary. This change does
not establish provider health or enable training; authenticated runtime failures still
withhold unverified data and capabilities.

## Current evidence

- 63 focused Solidity tests passed, with 1,024 fuzz runs where applicable.
- The merged full-page browser check passed desktop/mobile layout, same-wallet
  purchase/sale refresh, stale private-review and gas-confirmation clearing, Forge
  loading/failure recovery and late-response rejection. Zero wallet writes and
  zero browser exceptions.
- `site:deploy-check` passed, including its 127 deployment-gate tests.
- All 1,600 JavaScript tests passed, with zero failures or skips.
- The disposable-chain profile integration passed learning/equipping and retention
  across original-NFT transfer, denied the seller and required zero buyer setup
  transactions. No public transaction was submitted.

No production release, training-contract deployment, real mint or real burn was
performed as part of preparing this candidate.
