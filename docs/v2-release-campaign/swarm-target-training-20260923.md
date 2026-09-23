# Holder swarm, mission scope and paid-training review recovery

Starting production: `5067719927758341688b56c56d929ce73017aa08` (Netlify). Work branch: `fix/v2-mission-target-paid-wallet`.

## Behavior

- Actions has a Swarm planner for 1–10 currently owned Punks. Choose shared free-mint search or a specific Robinhood collection's free mint; daily/total limits apply **per Punk** and combined maxima are displayed.
- Each Punk uses the existing authenticated deterministic strategy compiler, owner-bound account setup, wallet confirmations and receipt reconciliation. No model requests, new recurring jobs, shared custody, new permission type or release-flag changes.
- **Keep hunting** is available in the individual controls and Swarm: a new pending review sets at most 100 free mints over 30 days. Daily limits, gas caps, reserve and safety constraints can stop spending sooner; wallet renewal is explicit, never automatic. The final review displays its expiration. This is not indefinite authorization.
- Passive **Mission updates** show completed, failed, expired and attention-needed states, with owner-scoped roster/Activity badges and read state. They reuse existing status responses, retain at most 100 browser-local records, and add no polling or AI. Active permission/pending receipts cannot generate completion badges.
- Each mission is reviewed separately. A successful authorization does not automatically open the next wallet. Each Agent needs its own gas, and eligibility, skills, reserve, policy, screening and simulation remain enforced by the existing backend.
- Batch progress is session-local information, never ownership authority. Reloaded reviews/attempts require a status check; no automatic resend. Closing the planner does not recall existing missions.
- Explicit **New free-mint search · Clear target** creates a new owner-confirmed draft with an empty collection allowlist, preserving current limits/taste/reserve/blocked contracts. Ordinary Start retains collection restrictions. Multiple restrictions are now accurately shown, instead of being mislabeled as all NFTs. No active signed strategy was edited by this release.
- Funding an undeployed Agent now offers **Set up Agent · Review mission first**. The existing account/session wallet flow creates the account; funding remains disabled until the destination is verified. Success wording distinguishes authorization from worker readiness.
- Setup rechecks selected Punk/owner/chain around awaits and rechecks wallet account/chain before each transaction. A selection change after the first setup transaction cannot sign the next permission.
- Paid-training review lifetime is 60 seconds, within the deployed contract's existing maximum. Expiry has an actionable error. **Refresh unsent review** requires another fee/payment review and never sends a wallet transaction. Attempted reviews cannot be renewed. Cross-tab changes block replacement. All journal mutations share an owner/Punk Web Lock through the wallet response; stale displayed reviews cannot overwrite an attempted record. Missing browser locks/storage fail closed for payment and leave other controls usable.
- Wallet preflight reports its stage. A failed preflight makes no wallet request. Existing amount, code, recipient, nonce, ownership continuity, canonical chain, fee and balance checks remain in place.

## Verification

- Target/options/paid regression suite: 70 passed before Swarm additions.
- Swarm + mission/options tests: 35 passed.
- Swarm + actual setup function authority tests: 21 passed (selection change, wallet/chain mismatch, interrupted two-transaction setup, no automatic next Punk).
- Paid coordinator/local-chain and chat routing: 61 passed. Paid local-chain + Agent setup: 5 passed.
- Deployment gate after main changes: 358 passed; typecheck, wallet build, site checks, secret scan and 942-module syntax check included. Four new activation tests also pass separately and are added to the deployment gate.
- Paid browser fixture: PASS, 24 desktop/mobile captures, no exceptions or external requests. `/private/tmp/gogh-paid-browser-evidence-jEvmyO/result.json`.
- Connected local browser verifies target clearing with 5/5 retained, Swarm review without sending, responsive layouts and missing-account funding guidance. Evidence path recorded after final run.
- Mainnet **read-only** paid-review probe used the production contract and real owner #93. Fresh review reached the wallet-send boundary with about 57 seconds initially remaining; the provider stub stopped there. No transaction broadcast, no credit purchased. This does not prove that the owner's original MetaMask failure was exclusively expiry; stage-specific messages support the next attempt.
- Final deployment gate: **388 tests passed, zero failures**; typecheck, wallet build, site validation/secret scan, 946-module syntax check and broker checks passed.
- Independent review found and fixed two introduced P1 issues before release: throwing storage getter and cross-tab unsent-review replacement. Fresh review after fixes found no P0/P1 in this change. Paid lock/recovery tests: 33 passed; independent combined review: 43 passed.
- Final connected browser: **PASS**, 21 screenshots at 1440/375/320px; Keep hunting review, Swarm, target clearing, badges/read acknowledgement and funding setup all passed, no exceptions/external requests. Evidence: `/private/tmp/gogh-preview-browser-evidence-Z3XazF/result.json`.
- Final paid browser with real browser locks: **PASS**, 24 screenshots, no exceptions/external requests. Evidence: `/private/tmp/gogh-paid-browser-evidence-ahNd52/result.json`.
- Earlier full run: 3,535 passed, zero failed, 2 skipped. Contract suite: **359 passed, zero failed**, offline. The first final full-suite attempt exposed two integration-test failures after badge wiring: watch invalidation must precede new UI work, and the extracted sign-in fixture needed the notification dependency. Both corrected; 23 related tests pass. **Final full rerun: 3,565 passed, zero failed, 2 skipped (3,567 total).** Skips are optional native durability/PostgreSQL environment checks; no database migration is included. Netlify preview/production checks are recorded below when completed.

## Boundaries

No funds transferred, production burns, contract deployments, automatic mission authorizations, AI activation or Vercel changes. Paid training remains the existing owner canary. General burns, paid automation, sweeps and bids retain their existing release gates. Swarm supports eligible free mints, not bulk paid mints or a single unrestricted signature.

The Mac ran out of storage during the first validation attempt. Removed only superseded generated screenshots and Chrome's separate temporary cache, after owner cleanup authorization. Browser profiles, wallets, keychain, credentials and source remained intact. A later validation run completed after approximately 500 MB was recovered.

## Scoped swarm

| Owner | Scope | Result |
| --- | --- | --- |
| keep_hunting | Option compiler, Swarm planner, bounded intent and tests | Integrated; 56 targeted tests passed; later independent paid-lock review passed |
| mission_badges | Passive notification module and tests | Integrated; 9 tests passed; wiring reviewed |
| public_erc20_withdraw (reused reviewer) | Independent review, then isolated paid-panel concurrency fixes | Two P1 findings fixed; 33 paid tests passed |
| Parent | UI integration, target clearing, gas/setup guards, browser QA, release | Local gates passed; cloud evidence follows |

## Holder steps

1. Reload V2 after deployment; close older V2 tabs before a payment review.
2. Actions → Swarm chooses up to 10 owned Punks. Review each mission and approve each wallet request separately.
3. For longer hunts, choose **Keep hunting · up to 100 mints / 30 days**. Keep daily limits/reserve appropriate, inspect expiration, and authorize. A funded wallet alone does not activate the worker.
4. For an old collection restriction, choose **New free-mint search · Clear target** and review the new rules.
5. Forge → **Refresh unsent review** prepares a fresh paid-training review; **Confirm paid training in wallet** is a separate step. An already attempted request must be recovered, never refreshed/resubmitted.
6. **Mission updates** and roster/Activity badges show recorded results and attention needed. Viewing Activity acknowledges that Punk’s updates.

No live owner wallet actions were performed by this release. Owner-connected wallet confirmations remain required to activate/re-authorize missions, fund gas, or buy/use a credit.
