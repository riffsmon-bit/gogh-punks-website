# Independent final UX, mobile and functional review

Reviewer: `final_ux_qa`, independent of the application implementation. Review worktree: `v2/hardening-ux-qa-20260913`, based on `eacfef6`. The browser serves a startup snapshot of the lead's actual candidate site at `/private/tmp/gogh-punk93-mint-stall/site`, including uncommitted refinements. Application changes were made by the lead after findings were reported; this reviewer owns only the new harness and evidence.

Scoped verdict: **PASS FOR FINAL UI TESTING**. All 25 adversarial functional scenarios pass, including the repaired production WETH loading path and new observed-contract result card, and 59 screenshots were captured. No open P0, P1 or P2 remains from this review. The final harness fails when any automated finding remains. All 74 captured source hashes matched the lead's candidate after the final follow-up run. A source-only decorative budget-meter observation remains P3; numeric unknown-balance labels are correct. This review does not establish global `FINAL_TESTING_READY` on its own.

## Method and limits

`scripts/test-v2-final-hardening-ui.mjs --mock-wallet-only` launches a disposable isolated Chrome profile and loopback server. It serves actual non-preview Control Center HTML, JavaScript and CSS. Primary script files are snapshotted before navigation and SHA-256 recorded. It preserves the app's real DOM rendering, event handlers, provider preference module, funding validation and durable recovery controller. It substitutes only wallet connection/ownership and HTTP/RPC dependencies. No production credentials, databases, user browser, private key, real signature, transaction or arbitrary external URL are used.

Every network request outside the loopback origin is blocked. Write RPC methods are rejected and counted; successful checks require zero calls. The owner-funding review uses pinned public Agent runtime fixtures and the actual validation code. Funding recovery starts from an explicitly seeded local journal and reconciles a mocked matching receipt; it never submits a wallet transaction. Provider responses are fixtures, not proof of model availability. Native iOS keyboard behavior, wallet app switching, screen-reader behavior and production API/model latency are not established by headless Chrome emulation. The mocked original NFT ownership reader does not prove live ownership discovery latency or transfer authority.

Screenshots cover 1440 and 1280 desktop/laptop, 768 tablet, and 430/375/320 phone widths. Each width includes welcome, Talk, Strategy, Fund, Collection, Activity, Forge and Settings. Additional captures cover observed contract results, unavailable native/WETH balances, exact strategy confirmation, saved funding recovery, one-wei balances, verified empty Forge slots, unavailable saved model, a 140-Punk roster and an empty owner roster. All widths receive viewport/overflow, target-size and visible-field label checks. The final pass verifies a 16px minimum field-text size on phone widths; all visible fields meet it.

The wallet bootstrap is intentionally absent from this isolated fixture; the static header may therefore say Wallet disconnected even while the mocked application owner is selected. This is a harness artifact, not a claim about production wallet connection. The fixture deliberately provides no artwork for #93 and #4999, so their neutral artwork placeholders test missing-art behavior. #235/#241 and minted #1599 use previously captured canonical local image fixtures. #1599's dark animated pre-reveal artwork is real metadata artwork, not a failed image request.

## Bug loop

| Finding | Priority | Resolution / evidence |
|---|---|---|
| Strategy confirmation rounded nonzero gas/reserve to `0.0000 ETH`, and a paid maximum showed `NOT CHANGED` | P1 | Lead uses exact ETH formatting and shows explicit paid maximum. One-wei price/gas/reserve all appear correctly in the real confirmation modal; Edit closes it without authority changes. |
| Non-preview Fund/Collection left WETH at `CHECKING…` without requesting its balance | P1 | Lead wired a bounded, deduplicated balance read. Actual non-preview Fund/Collection request and display WETH; two concurrent panels share one pending read; a failure displays UNAVAILABLE and explicit Collection refresh recovers. |
| One-wei balance expanded the 320px layout to 434px | P2 | Lead constrained wrapped-balance columns, child widths and amount wrapping. Exact amount remains visible; 320px viewport remains 320px on retest. |
| Funding recovery hash input was a narrow default gray field with ~21px height | P2 | Lead applied full-width dark styling and 48px controls. Real saved-hash recovery/recheck continue to pass. |
| Mobile Talk placed mode/readiness and eight quick actions ahead of the composer | P2 | Lead collapsed mode options and moved quick actions below the composer on phones. The composer and Send button now appear in the initial 320px Talk view. |
| Forge diagnostic catalog led the training journey | P2 | Loadout and permanent training now lead; diagnostic examples are collapsed below. This rearrangement does not enable training or production burn. |
| Fixed desktop/tablet header obscured navigated panel headings | P2 | Primary-section scroll margins keep heading/kicker visible on repeat capture. |
| Verified empty Activity told the holder to open Activity, and its text occupied a narrow grid column | P2 | Empty history is full width with a useful Talk action after a verified empty response. |
| Provider/gas form fields inherited ~10px label type on phones | P2 | Lead added a mobile 16px field rule. All computed-style checks pass; the resulting Settings width issue was also resolved below. |
| Verified zero-owned roster still instructed an already connected holder to connect | P2 | Lead added a distinct verified-empty message and checking/disconnected states. The prior Punk controls are removed on a zero-owned result. |
| Provider select intrinsic width forces the Settings grid beyond 320px | P2 | Lead constrained desktop/mobile tracks, articles, labels and selects. The final 320px Settings viewport remains exactly 320px with readable 16px fields. |
| Modal close icon overlapped a long status kicker at 320px | P3 | Lead reserved space beside the kicker. |

No application files were changed by this reviewer. No issue was accepted solely because a module compiled.

## Functional proofs

The actual browser proves welcome requires no funding; a selected model is sent in the chat request; failed chat restores the owner's text; late success/error replies from another Punk or owner are ignored; late link successes/errors cannot overwrite a newer Punk; a current link result is clearly marked as needing review; selecting an explicit unavailable saved model does not silently switch to Auto; preferences and welcome dismissal persist across reload and remain owner-specific; owner-sourced gas review omits V3 funds/withdrawal endpoints; missing funding results recover by the original hash; saved submissions recheck without a new send; one-wei balances and reviewed limits remain visible; verified Forge state renders three empty slots and four locked slots; a 140-item roster retains keyboard navigation; switching to a verified empty owner removes the previous Punk's controls.

The separate collection-display harness remains necessary for delayed/error/empty collection source scenarios and authentication deduplication; this new review does not replace it. The separate composed Forge fork journey remains necessary for burn, exactly-once credits, learning, equip/unequip, transfer persistence and authority rejection. Real provider checks, SQL grants/RLS, execution safety and real mobile wallet app switching remain separate acceptance evidence.

## Performance observations

The initial clean pass measured 680ms from navigation request to usable disconnected shell, 1,371ms to connected mocked roster and selected shell, panel-change p50 104ms / p95 219ms / maximum 273ms, and a 140-Punk mocked roster shell in 16ms. The final observed-link follow-up measured 1,081ms to usable shell, 1,381ms to connected mocked roster, panel p50 109ms / p95 219ms / maximum 291ms, and the 140-Punk mocked roster shell in 16ms. Panel measurements include an intentional 80ms screenshot/paint settling wait and CDP round trips. They are useful regression observations, not production API/AI/RPC latency claims. Two earlier navigation attempts were affected by simultaneous full-repository testing; those timeouts are not classified as application load regressions.

Do not derive a speedup percentage by comparing loaded and quiet runs. Do not infer real 140-Punk chain discovery speed from mocked ownership. Production before/after collection and artwork timings belong in the lead's independent live-read evidence.

## Post-integration follow-up: observed contract and unavailable balance

The lead added the observed-contract card and extended the browser harness after the initial review was integrated. This reviewer preserved those harness changes and reran the actual site from candidate `9c9f76f` plus the final uncommitted link-form CSS correction. All 74 startup-snapshot file hashes matched the candidate after the run. This follow-up changes review documents and evidence only.

The first follow-up completed all 25 functional scenarios but found a P2 phone overflow: the mint-link input/button row expanded a 320px viewport to 345px. The lead constrained its grid/input widths and stacked the 48px Check Link button on phones. The repeated run passes all 25 scenarios and 59 captures with no overflow, small-field, small-target or unnamed-field findings. The observed card and link form both remain inside 320px. Its exact one-wei price wraps fully; it does not become zero or FREE.

The card derives only from matching Robinhood contract/code/block evidence. Wrong-chain, mismatched, missing-code, blocked and noncanonical evidence cannot produce an observed result. Security says “Full review still needed”; Simulation says “Not run.” The contract URL is fixed to the explorer and output uses text nodes. Three dedicated evidence-validation unit tests pass. Existing stale-owner and stale-Punk success/error fences also pass. These tests do not establish that a live mint is safe or executable.

The native-read failure screenshot shows both ETH and WETH as UNAVAILABLE. Source review confirms available-budget and reserve amounts become unknown. The existing explicit collection refresh recovers the read in the browser. The decorative budget meter still computes width from the cached balance; this is a nonblocking P3 source observation, not an amount or authorization claim. The controlled Market lab source now presents limited listing observations or unavailable data and explicitly avoids floor, purchase and bid authority claims; live market availability is outside this mocked browser test.

Raw final evidence: `/private/tmp/gogh-final-link-followup-qa-clean/report.json`. Visual checks: `link-contract-evidence-320.png` and `balance-unavailable-320.png` in that directory. The final run reports zero browser errors, external requests, wallet calls and public transactions. The mocked-wallet limitations above continue to apply.

## Reproduction

```sh
GOGH_UI_SITE_ROOT=/private/tmp/gogh-punk93-mint-stall/site \
GOGH_COLLECTION_ARTWORK_FIXTURES=/private/tmp/gogh-collection-artwork-fixtures.json \
GOGH_UI_OUTPUT_DIR=/private/tmp/gogh-final-hardening-ux \
node scripts/test-v2-final-hardening-ui.mjs --mock-wallet-only
```

Committed evidence is `docs/v2-hardening/final-ux-evidence.json`; the initial screenshots are under `/private/tmp/gogh-final-hardening-ux-final` and the final follow-up screenshots are under `/private/tmp/gogh-final-link-followup-qa-clean`. `report.json` contains source hashes, scenarios, findings, view measurements, RPC/API observations and screenshot paths. `observations.json` is written even on failure. Chrome and the loopback server are stopped by the harness; only its own temporary profile is removed. No protected practice process or user browser is touched.
