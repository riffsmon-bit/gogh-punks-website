# Swarm selection and review repair

Starting production: `39fdfae1cd8d49a0ab52581820e65bde6e02a748`. Integrated with the visible Recall Punk release in PR78 on `fix/visible-punk-recall`.

## Reproduced problems

- Passive status/roster refresh replaced the editable Swarm form, losing selected Punks, fields and focus. The isolated regression suite reproduced five failures before the fix.
- Opening an individual Swarm review immediately called the authenticated draft loader. A missing session caused MetaMask sign-in before the holder saw that Punk's selected settings.
- Opening Swarm funding explicitly authenticated; selected-Punk profile hydration could also initiate sign-in during navigation.

## Changes

- Preserve the same editable form when the owner and ownership set are unchanged. Preserve fields across validation errors; remove transferred selections; clear drafts on owner/chain changes. Existing funding receipts still update.
- Show a local settings dialog before authentication. It states that nothing is authorized and shows the Punk, free-only requirement, collection, daily/total limits and duration.
- Only **Sign in & load full rules** continues into the existing signed-in draft loader. Login is described as a free signature; actual mission authorization remains a separate, unchanged owner-wallet step after full rules appear.
- Cancel/close/Escape restores the batch row to queued. Owner, chain, selection or ownership changes invalidate an open local review.
- Passive profile/activity hydration uses only an existing session. Swarm funding readiness uses an unsigned read. Explicit sign-in controls remain available. Collection navigation is outside this change and can still request sign-in.
- Add visible **Recall Punk** beside current status, including Reserve reached. Receipt reconciliation is required before showing recall success. Funds remain in the Punk's wallets.
- Update the holder guide. No backend, contract, spending authority or deployment configuration changes.

## Validation

- Isolated draft preservation: 37 tests passed, with five failures reproduced before repair.
- Combined focused review/draft/funding checks: 39 passed.
- Final navigation/wallet-transition/Swarm review checks: 28 passed.
- Independent read-only security review: no concrete blocker; 45 focused tests passed.
- Responsive local browser: PASS, 27 screenshots at 1440/375/320, zero exceptions/console errors/overflow. Opening Swarm review made zero sign-in calls; the complete rules remained closed until explicit continuation. Evidence: `/private/tmp/gogh-preview-browser-evidence-uw8RLl/result.json`.
- Typecheck, wallet build, site/secret, syntax and broker checks passed. Initial gate exposed two test-harness integration expectations; both were corrected and the 28-test final wiring suite passed.
- Full JavaScript suite: 3,627 passed, zero failed, two opt-in integration skips (3,629 total). Log: `/private/tmp/gogh-swarm-final-all-tests.log`. The later same-wallet event guard and related wiring passed 16 targeted tests in `/private/tmp/gogh-swarm-wallet-event-final.log`.
- Preview/production verification: pending.

No real holder signature or transaction was submitted by tests. Browser wallet behavior uses an isolated fixture; the actual connected-holder confirmation remains the owner's action.
