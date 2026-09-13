# Paid completion reload review

## STATUS

**APPROVE — no P0/P1 or functional blocker found in the focused reload change.**

Reviewed the lead's working-tree changes to `site/directed-paid-panel.js`,
`site/directed-paid-status.js`, `site/broker-v2.css`, and `tests/v2-swarm-frontend.test.mjs` over
`9fc8b02628b594ea372316d2308423e12def7130` on September 13, 2026.

## FILES CHANGED

- `scripts/test-paid-completion-browser.mjs`: independent headless Chrome
  regression using the actual panel, wallet validator, status, release, and CSS.
- `docs/v2-hardening/paid-completion-review.md`: this review.

## FILES INTENTIONALLY NOT CHANGED

No application implementation, existing test, contract, deployment manifest,
credential, or production setting was changed by this reviewer. No commit made.

## SUMMARY

The returning selected owner now receives one automatic status GET. During that
read, the panel says it is checking the saved result and offers no new review.
A validated completed fixture restores **PAID MINT COMPLETE**, Peppies World
**#1599**, the Collection link for Punk #93, and **REVIEW ANOTHER MINT** after an
actual browser reload. Completion also renders when no current review record
exists. Explicit rechecks preserve the delivered result without resending it.

The lead subsequently observed the actual saved shape: a separate `PREPARED`
`AUTHORIZE` review with expired `expiresAt=1789321008330`, an earlier `COMPLETED`
execution for #1599 with a different intent ID, and `missionStatus=2`. The
expanded review and browser fixtures now cover that shape. It shows completion
first, explains the separate expired review, and offers **DISMISS EXPIRED
REVIEW**. It neither opens a fresh quote nor cancels the expired one automatically.
Fresh and `WALLET_REQUESTED` reviews remain separate from the earlier delivery.

The default automatic path passes `authenticate=false` to `work` and
`recover=false` to `refresh` (`directed-paid-panel.js:16`). It cannot invoke
`ensureSession`, `prepare`, `recover`, `decline`, or the wallet. Invalid
selection hides and clears the panel; request sequence checks discard delayed
responses after owner or Punk changes. `jsonRequest` uses same-origin cookies
and no-store without initiating authentication (`broker-v2.js:1790`).

## INTERFACES

`createDirectedPaidPanel` gains `autoLoad=true`; `autoLoad=false` remains useful
for existing isolated test fixtures. Server API, release binding, transaction
construction, durable claim, confirmation, and recovery interfaces are unchanged.

The existing explicit recheck still calls `ensureSession`. In production that
may request a login signature if the session has expired; it does not send a
mint transaction. For a pending wallet request, explicit recheck can still
recover or decline the original request through the existing API. Automatic
loading deliberately stops after GET and validation.

The new dismiss control reuses the existing `cancel` operation only after an
explicit click. Its exact body identifies the separate expired review and its
revision. The server coordinator still requires `PREPARED` plus a matching
revision (`directed-paid-coordinator.mjs:114`), so this operation cannot cancel a
claimed wallet request or affect the completed worker mint.

## TESTS

```sh
node scripts/test-paid-completion-browser.mjs --mock-read-only
node --test tests/v2-swarm-frontend.test.mjs tests/directed-paid-owner-flow.test.mjs
```

The browser test serves exact production modules from a local HTTP server in a
new temporary Chrome profile. The selected owner comes from the real
`PAID_RELEASE`; the review calldata is built by the real `paidOwnerCalldata` and
validated by the unmodified `validatePaidEnvelope`. Server responses and
session checks are synthetic fixtures. The injected request function accepts
only the fixed GET route during all automatic-load/recheck scenarios. A final
explicit dismiss test permits exactly one armed in-memory cancel response with
the exact `{operation:'cancel', intentId, revision}` body; every other write-shaped
call fails. This synthetic cancel never reaches the HTTP server, database, or
chain. The wallet getter throws if called. CSP disables network connections,
and CDP intercepts and blocks every
non-local page request. No provider, wallet extension, or authenticated browser
profile is used.

Fifteen browser scenarios passed:

1. Initial delayed GET shows loading, with no new-review button or sign-in.
2. Actual reload restores completed delivery using exactly one new GET.
3. Repeated explicit completed-result rechecks do not resend.
4. Completed execution without a current review record remains completed.
5. Missing session explains sign-in and requires explicit recheck.
6. Unavailable historical verification blocks an initial new review and explains recovery.
7. Delayed response after changing Punk is discarded.
8. Delayed response after changing owner is discarded.
9. Pending wallet request preserves its original stored hash without automatic recovery.
10. The actual wallet validator rejects an envelope for a different owner.
11. The observed expired separate-review shape preserves completion after actual reload.
12. Rechecking that expired review neither cancels it nor prepares another quote.
13. A fresh separate review keeps its explicit review/confirmation controls after reload.
14. A separate wallet request keeps recovery controls and its own hash after reload.
15. Explicit dismissal issues only the exact synthetic cancel, then GET; it never prepares a quote.

## RESULTS

Latest browser result at **2026-09-13T20:40:03.308Z**: **PASS**, 24 mock GETs and
one explicitly clicked, strictly validated **in-memory cancel fixture**.
There were **0 automatic POSTs, 0 automatic authentication calls, 0 wallet calls,
0 public page network attempts, 0 public transactions, and 0 browser exceptions**.
Six session-stub calls correspond to five deliberate rechecks and one deliberate
dismiss click. The focused Node suite passed **23/23**
with no failure, skip, or cancellation. Its existing wallet tests retain durable
claim-before-send, exact transaction binding, hash persistence, and stale-owner
rejection coverage. This read-only browser fixture does not perform a wallet send.

Screenshots at **1440, 375, and 320 pixels** show both the restored completion state
and the observed completed-mint/separate-expired-review shape.
All controls fit the viewport and there is no horizontal overflow. The reviewer
visually inspected the three new expired-review screenshots in addition to the
previously inspected simple-completion screenshots. Local artifacts:

- `/private/tmp/gogh-paid-completion-1440.png`
- `/private/tmp/gogh-paid-completion-375.png`
- `/private/tmp/gogh-paid-completion-320.png`
- `/private/tmp/gogh-paid-completion-expired-extra-1440.png`
- `/private/tmp/gogh-paid-completion-expired-extra-375.png`
- `/private/tmp/gogh-paid-completion-expired-extra-320.png`
- `/private/tmp/gogh-paid-completion-browser.json`

The Collection-link cosmetic observation is **closed**. The lead's scoped CSS
rule at `broker-v2.css:555` centers the anchor label with inline-flex, adds an
8-pixel right margin, and removes its underline. The browser regression reran
successfully at **2026-09-13T20:32:35.316Z** after that change with all ten scenarios
and zero POST/wallet/network/error results. Those three screenshots were
regenerated and visually inspected: the Collection label is centered, its
desktop spacing is restored, and the controls still fit at 375 and 320 pixels.
The later fifteen-scenario run retains that fix. Final approval includes the
CSS and expired-review increments; no review finding remains open.

## SECURITY

No additional financial authority is introduced. The new automatic request is
GET-only and uses the existing authenticated server response. Completion display
depends on that trusted server result; this fixture does not independently prove
actual NFT ownership or chain delivery. Existing server verification remains
necessary. The Collection destination is fixed, and the explorer URL accepts
only a transaction-hash-shaped value with `noopener noreferrer`.

The existing explicit wallet path remains behind a prepared validated review,
owner/session continuity, durable claim, and separate confirmation. No new
wallet call is added. The new explicit dismiss button reuses the existing cancel
API for an unsent review; no cancel runs on load or recheck. Pending recovery
data is not cleared or resubmitted automatically. The expired-summary branch
requires a different execution intent, completed delivery, no active mission,
and an `AUTHORIZE` review already beyond the existing wallet-send cutoff;
it cannot replace the fresh-review or unresolved-wallet controls.

## DEPENDENCIES

No package dependency added. The regression requires Node 24 and the existing
macOS Google Chrome installation. It creates and removes its own temporary
profile. Production still depends on the authenticated paid-mint GET route and
its existing durable mission/receipt verification.

## BLOCKERS

None found for the focused reload/display change. Full-site regression and live
deployment verification remain lead-owned; their earlier results do not cover
this subsequent change until rerun.

## INTEGRATION NOTES

Integrate only the two reviewer-owned new files. The application changes and
reviewed CSS adjustment remain lead-owned. Screenshots are isolated fixtures clearly
labeled as such; they must not be represented as fresh production chain proof.
No credentials, public RPC calls, financial operations, or real wallet actions
were used in this review.
