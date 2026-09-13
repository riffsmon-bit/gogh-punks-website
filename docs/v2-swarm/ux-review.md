# V2 independent product / UX review

Reviewed September 13, 2026. Initial source: integrated candidate `9ebe761`, including frontend `f86ae1c` and API recovery links `9c13431`. The reviewer changed no product source. Three medium and two low findings were reproduced; the lead fixed them in `8a08edc`. Independent browser retest against that commit passed. No finding from this bounded review remains open.

## Method and boundaries

`scripts/test-v2-swarm-ui.mjs --mock-wallet-only` starts a separate headless Chrome profile and a random-port loopback server. It serves the actual `site/broker/v2/index.html`, styles and browser modules. The wallet bootstrap script is removed from the served response. Browser requests are intercepted, non-loopback requests denied, external DNS resolution disabled, and a same-origin-only content security policy applied. The owned profile and server are cleaned up on completion or failure. The script does not touch user Chrome, existing Node services, #44 practice, or live #64345/#64346 setups.

Two kinds of evidence are deliberately separate:

- **Actual page:** disconnected entry and the existing design preview, including roster, hero, Talk, Fund, Forge and mobile navigation. Tested at 1440, 768, 375 and 320 CSS-device widths with a 900px viewport height. The actual HTML/CSS/modules are rendered; this is not an isolated panel stylesheet test.
- **Controlled panel states in the actual page:** the harness keeps the host in design-preview mode and appends a test bridge to its served module. It supplies a clearly synthetic selected #93 display fixture and recreates the same recovery/Forge controls in their existing host roots. Recovery controller, sign-in, Forge responses and time are mocked. Every mock provider method throws. These checks establish DOM/presentation behavior, not ownership discovery, authentication, API correctness, browser-controller cryptography, transaction simulation, receipt verification, or live-chain integration.

All 24 initial screenshots were opened with `view_image`. Images use existing repository assets, with missing sparse-worktree assets read from the integration checkout. No screenshot claims the fixture is the real #93 image, balance or loadout. Desktop/tablet screenshots sometimes scroll the panel heading behind the existing sticky header; that deliberate screenshot scroll is not claimed as a user navigation defect.

## Findings and required disposition

| ID | Severity / condition | Reproduced evidence | Required correction / status |
|---|---|---|---|
| R-01 | Medium: open Fund at 375px or 320px; also affects recovery below it | Chrome reports `innerWidth = document.documentElement.scrollWidth = 413`, while Talk and Forge stay at the requested device width. Fund grid children extend to x=412.71875. Mobile Chrome therefore scales the entire Fund/recovery page down. | **Closed.** Constrained grid tracks/children and stacked mobile amount/review row. Retest asserted exact requested viewport and document widths in all tested states; no overflowing elements remained. |
| R-02 | Medium: keyboard-select a roster Punk | The roster advertises a listbox. ArrowRight from #119 leaves both focus and selection at #119. Enter on #546 selects it, but `document.activeElement` becomes `BODY` when roster rendering replaces the focused option. | **Closed.** Roving focus and selection keys added. Retest: ArrowRight selected/focused #546; Enter selected #810 and retained focus on its button. |
| R-03 | Medium: inspect or navigate the action bar with accessibility tools | Chrome's full accessibility tree exposes all seven controls as plain buttons with only `focusable`/`invalid` properties. The active Forge control has no selected/current property; `aria-selected` on a plain button does not supply it. | **Closed.** Tablist/tab/tabpanel semantics and manual keyboard activation added. Retest found seven accessible tabs and exactly one selected tab. ArrowRight moved focus without switching content; Enter activated the focused Strategy tab. |
| R-04 | Low: verified Forge at 320px | The 28px `LOCKED` socket title presses against and slightly crosses the narrow slot boundary. This does not create document overflow, but makes repeated status labels harder to scan. | **Closed.** Mobile socket title reduced to 16px and constrained to its cell. Corrected screenshot opened with `view_image`; label fits. |
| R-05 | Low: programmatically select Forge on narrow mobile | The horizontally scrollable fixed action bar keeps its previous scroll offset, leaving active Forge partially visible at 375px and outside the viewport at 320px. | **Closed.** Activating a tab scrolls the navigation horizontally. Retest: active Forge bounds x=239–307 at 375px and x=184–252 at 320px, fully visible. |

Initial machine observations are in `/private/tmp/gogh-v2-swarm-ux/report.json` and `/private/tmp/gogh-v2-swarm-ux/observations.json`. In this initial characterization run, `status: PASS` means the mocked functional assertions completed; it does **not** override the layout and accessibility findings above.

Final strict results are in `/private/tmp/gogh-v2-swarm-ux-fixed/report.json`. Unlike the initial characterization, the committed harness asserts exact viewport/document sizing, accessible tab selection, keyboard activation, retained roster focus and visible mobile selection. It fails against the pre-fix source. The final run completed with two mock preparations, one mock submission, two mock receipt rechecks, one mock hash-recovery attempt, **zero provider calls, zero external requests and zero uncaught runtime errors**. Both the initial and corrected browser profiles were removed.

## What the controlled scenarios established

- Mounting the recovery fixture and changing page tabs caused no sign-in, preparation, submission, or provider call. Loading set `aria-busy`, disabled draft fields, and preserved the exact decimal input.
- Preparation displayed a separate acknowledgement and confirmation action. The displayed native amount retained all 18 fractional digits. Source Agent address, fixed owner destination, asset, maximum owner-paid network fee and expiry were visible. Tablet addresses wrap into their fact cards.
- Space checked the acknowledgement; Tab reached `CONFIRM IN WALLET`; Chrome reported a visible solid 2px outline. Enter invoked exactly one mock submission with a recursively frozen displayed review. It never called a wallet provider.
- A mocked ambiguous result retained the pending state. Failed receipt recheck and explicit hash-recovery attempts retained the original full hash without another submission. Expiry disabled confirmation; explicit cancellation retained the native draft. An ERC-1155 prefill focused the recovery heading and preserved the full contract/token input.
- Forge loading disabled its check action. A valid mock verified profile displayed zero credits/learned skills and one empty unlocked slot; this zero appeared only after verification. A subsequent mocked service error replaced that profile with unknown/unverified state and disabled the research actions.
- Every visible form control inspected in the tested states had a native label or accessible name. Recovery actions are at least 44 CSS px high. The lead also increased the mobile Connect wallet button from 40px to 44px; final inspection found no enabled buttons shorter than 44px. The page was inspected with reduced motion enabled.
- Disconnected entry explains how to populate the roster. Recovery error text identifies a next action and avoids claiming completion from an unverified hash. The preview Forge library distinguishes read-only tests, unverified progression and coming-soon capabilities.

The recovery state substitution used to move from unresolved to prepared is a test fixture reset, not an available production transition. The harness does not assert that failed receipt reads may reset a real journal. Earlier incomplete harness attempts were discarded: one needed a complete CDP Enter event, one needed to clear a retained mock error before its isolated expiry scenario, and one waited indefinitely for a headless animation frame. The committed screenshot helper uses a bounded host-side yield instead.

## Screenshot evidence

All paths below are local review artifacts, intentionally not Git assets. Initial screenshots total approximately 1.9 MB.

Corrected screenshots use the same filenames under `/private/tmp/gogh-v2-swarm-ux-fixed/`. The reviewer opened the corrected Fund, recovery, keyboard-focus, NFT, tablet recovery, Forge mobile, verified Forge and empty Collection screenshots with `view_image`. In particular, `recovery-320.png` now fills the intended viewport at normal scale, `recovery-keyboard-320.png` shows a clear focus outline, and `forge-verified-320.png` shows the fitting socket label and visible active Forge tab.

| Area | Evidence |
|---|---|
| Actual entry / hierarchy | `/private/tmp/gogh-v2-swarm-ux/disconnected-1440.png`, `control-center-1440.png`, `control-center-375.png` |
| Talk desktop / tablet / mobile | `/private/tmp/gogh-v2-swarm-ux/talk-{1440,768,375,320}.png` |
| Fund overflow | `/private/tmp/gogh-v2-swarm-ux/fund-320.png`, `recovery-320.png` and R-01 DOM metrics in `report.json` |
| Recovery at all widths | `/private/tmp/gogh-v2-swarm-ux/recovery-{1440,768,375,320}.png` |
| Recovery loading / keyboard / error / NFT | `/private/tmp/gogh-v2-swarm-ux/recovery-loading-320.png`, `recovery-keyboard-320.png`, `recovery-error-hash-320.png`, `recovery-nft-320.png` |
| Actual Forge at all widths | `/private/tmp/gogh-v2-swarm-ux/forge-{1440,768,375,320}.png` |
| Forge controlled states | `/private/tmp/gogh-v2-swarm-ux/forge-verified-320.png`, `forge-library-1440.png`, `forge-error-1440.png` |

## Reproduction

From a complete checkout:

```sh
node scripts/test-v2-swarm-ui.mjs --mock-wallet-only
```

From the sparse reviewer checkout:

```sh
GOGH_UI_ASSET_ROOT=/private/tmp/gogh-punk93-mint-stall/site node scripts/test-v2-swarm-ui.mjs --mock-wallet-only
```

`GOGH_UI_SITE_ROOT` optionally serves the current integrated `site/` during retest; `GOGH_UI_OUTPUT_DIR` preserves separate before/after evidence. `GOGH_CHROME_PATH` overrides the local Chrome binary. No dependency installation is needed. Heavy browser runs must remain serialized with the lead's Foundry, PostgreSQL and full-suite validation.

Final validation command:

```sh
GOGH_UI_SITE_ROOT=/private/tmp/gogh-punk93-mint-stall/site GOGH_UI_OUTPUT_DIR=/private/tmp/gogh-v2-swarm-ux-fixed node scripts/test-v2-swarm-ui.mjs --mock-wallet-only
```

The final browser run passed against `8a08edc`. `node --check scripts/test-v2-swarm-ui.mjs` and `git diff --check` also passed. Integration must retain `8a08edc` before running this harness; the reviewer branch intentionally owns only this report and the browser script.

## Remaining limits

This review is desktop Chrome with mobile viewport emulation, native keyboard events and Chrome accessibility-tree inspection. It is not a VoiceOver/TalkBack reading-order audit, iOS Safari/Android device run, real wallet modal review, performance benchmark or complete accessibility certification. Paid mint and selected-burn continuity belong to their existing dedicated controlled browser harnesses and the lead's integrated validation; this harness does not repeat or claim those financial flows. No production transaction, burn, refund, sweep, signature or deployment was requested.
