# Independent purchase-panel review

Date: 2026-09-13. Reviewer: `real_skill_completion`. Component implementation: `32797bc`; fixes: `b5a787f`. Controller mount: `fa3fe3e`; selection-race fix: `abb2760`. The reviewer did not implement the panel, wallet helper, codec or controller integration and changed only this report and the two dedicated independent purchase-panel test files.

## Verdict and scope

**PASS for the component and its main-controller mount at `abb2760`, within controlled owner-assisted integration.** No unresolved P0/P1 remains in the reviewed scope. This verdict does not enable public purchases, validate a production listing source/policy, or approve a guard deployment. The reviewed public mount retains a null purchase release and no public listing selector or purchase preparation action.

No real wallet, external API, public transaction, order post, refund, production migration, or owner-fund operation was used. Native database and transaction-codec boundaries retain their separate reviews.

## Findings resolved before integration

| ID | Priority | Finding | Resolution |
| --- | --- | --- | --- |
| PANEL-01 | P1 before controlled execution release | An ordinary rejected preparation with no server record left a local DRAFT active forever. The holder could neither discard it nor prepare corrected listings/budget because new input had to match the rejected input. | An explicit Discard unsent request action now performs a fresh GET for the exact original intent. Only a still-unattempted, hash-free DRAFT with no server record is marked locally DISCARDED; its history remains. A late PREPARED/CLAIMED record is adopted instead. Corrected input can create a new UUID. |
| PANEL-02 | P2 | A known paused release on a new device made its required server history read, but a failed read hid the entire panel and its recovery error. | The known-release failure now displays Check your purchases, a plain error and Refresh status. An absent release with no local journal still stays hidden without API work. |
| PANEL-03 | P1 before controlled execution release | The initial controller awaited sign-in before dispatching a mutation without checking whether the selected Punk had changed. The server could commit the original claim while the panel discarded its stale response, leaving an unintended reservation with no wallet hash. | `abb2760` captures the selection key and revision before sign-in and verifies both plus live owner/Punk/chain/preview immediately before POST dispatch. A switch, including A→B→A, now rejects before any marketplace mutation. |

Local discard is not presented as a chain success or server cancellation. Failed lookups, changed selection, changed active reference, attempted drafts or saved transaction hashes cannot be used to abandon a potentially submitted purchase. The existing SQL hold remains the cross-device authority boundary.

## Independent checks

The independently executed gates passed **83 cases: 67 existing component/codec boundary cases, seven reviewer-owned component regressions, and nine reviewer-owned controller-mount regressions**, with zero failures/skips. The unchanged component and wallet sources retain their earlier 74-case result; the final mount increment was checked together with the seven component regressions, passing 16/16:

```sh
# Run in the component checkout, or the integrated repository after cherry-pick.
node --test tests/marketplace-purchase-panel.test.mjs tests/marketplace-wallet-boundary.test.mjs

# Run from the review worktree before integration; omit the override afterward.
GOGH_PURCHASE_PANEL_REVIEW_ROOT=/private/tmp/gogh-capabilities-integration node --test \
  tests/marketplace-purchase-panel-independent.test.mjs \
  tests/marketplace-purchase-mount-independent.test.mjs
```

The optional override exists only in the test and is never read by production code. The seven new regressions establish:

1. Rejected, unattempted drafts are discarded only after the exact server lookup, retain their history and permit corrected input with a different UUID. No settlement callback is manufactured.
2. A late PREPARED server record is adopted, not discarded.
3. A late WALLET_REQUESTED record is adopted, with no discard or resend path.
4. Failed lookup preserves the original draft and redacts provider error text.
5. A paused new-device history error stays visible with retry and no wallet confirmation action.
6. An absent release and absent journal cause zero requests and a hidden panel.
7. A delayed wallet hash received after the selected owner changes is written only to the captured original owner's journal; it neither appears in the new selection nor starts recovery against the new owner.

These tests run the actual panel and reviewed wallet helper with controlled API, storage and wallet responses. The wallet codec's economics are separately exercised by the existing 45-case boundary suite, using independent order definitions and both source/generated codecs. No claim of real browser-wallet or production database execution is made here.

## Identity, persistence and phase behavior

The local scope includes chain, owner and Punk, with a separate immutable-intent record and active reference. The request UUID and exact limits are persisted and read back before preparation. The intent hash uses the server's canonical identity field order. Retrying a lost preparation retains its original UUID; a draft read may repeat only the same preparation, never automatically claim or send.

Before claim, the panel retains the exact original input, review and commitment, persists the attempted flag, then delegates to the reviewed wallet helper. The helper checks the trusted release/guard, owner/chain, exact calldata economics, changed selection, fees and expiry before its one wallet request. A failed claim response, storage failure, rejected prompt or unknown wallet result does not re-enable sending. Receipt recovery uses the original hash; manual hashes remain hints until the server binds them. A lost hash-persistence write retains the hash in the original in-memory scope and the prior attempted flag remains reserved.

Current-selection/request-generation checks surround awaited API and wallet work. A sent hash is deliberately preserved in the captured original scope even after a UI change; that is recovery persistence, not permission to act on the new selection. Clearing or destroying the visible panel does not delete original journals.

PREPARED reviews show the selected NFTs, exact price, owner network-fee maximum, Punk reserve and confirmation/cancellation controls. Review expiry, missing release, missing original input, failed verification, changed holder or storage failure disables confirmation. Claimed purchases expose original-transaction recovery instead of another wallet action. COMPLETED/REVERTED/CANCELLED cards omit confirmation, cancellation and other stale review buttons. Completed cards require a matching reported hash and receipt with at least 12 confirmations. Terminal notifications are deduplicated per scoped intent/status.

A null public release does not authorize preparation or signing. A known paused release may read and recover saved history on a new device. Same-origin authentication remains in the supplied application API function and the backend; the component cannot supply owner, RPC, arbitrary transaction or dependency flags.

All dynamic text is rendered as text nodes. Full transaction hashes are validated before fixed Blockscout links are constructed. Provider failures are translated into fixed user-facing messages. Wei values stay integer strings/BigInts and are displayed without floating-point rounding, including prices beyond JavaScript's exact-number range.

## Visual review and evidence limits

The reviewer visually inspected the actual provided `review-320.png`, `completed-320.png`, `reverted-320.png`, and `error-375.png`. Selected token IDs, exact prices, fee ownership, reserve and state are readable; wrapping keeps prices and hashes inside the card. Buttons are at least 46 pixels tall, stack at narrow widths, and the terminal cards remove irrelevant actions. The error screenshot clearly shows its message and disabled wallet confirmation. Longer reviews scroll vertically without a horizontal overflow requirement.

The author's final Chrome run covers 1440, 375 and 320 pixels, with the real component/helper and controlled API/wallet fixtures. It verifies no horizontal overflow, late/lost responses, reload recovery, storage errors, one-send behavior, paused new-device recovery and the draft-discard fix. The reviewer inspected that harness and final evidence but did not regenerate its browser run. The newly fixed error/discard paths are independently verified through the actual component tests above; the screenshots do not constitute a full main-page/mobile-wallet review.

## Scoped SQL index follow-up

The parent commit `3d19229` adds only a nonunique Btree index on `(owner_address,punk_id,chain_id,(status IN ('PREPARED','WALLET_REQUESTED')) DESC,created_at DESC,intent_id DESC)` in the staged marketplace migration. Those equality keys and order terms match `store.current` exactly. It changes no rows, RLS policies, grants, transition constraints, active uniqueness rules or ownership semantics. The existing backend review remains applicable to those unchanged boundaries; the changed migration hash is recorded below. This review does not claim a measured production latency improvement or a production migration.

## Main-controller integration review

The reviewed mount adds a hidden section in Talk, hardcodes `purchaseRelease: null`, uses current owner/Punk/chain getters and exposes no public listing selector or purchase preparation action. `renderRoster` synchronizes identity changes, invalidates in-flight view work and refreshes the panel; clearing never deletes the original journal. Background GET reads do not trigger sign-in. POST operations use normal current-owner authentication and the new selection/revision check immediately before dispatch. Settlement only invalidates the collection cache and starts a read-only status refresh when owner, Punk and chain still match.

The nine independent integration cases execute the actual controller declarations, identity synchronizer and mount block from `site/broker-v2.js` unchanged in a controlled VM, with the actual purchase-panel module. They establish:

1. A null release with no saved journal stays hidden and causes no API, session or wallet work, including repeat refresh and Punk changes.
2. A delayed saved-history response after an owner switch cannot appear in the new owner's view, change the original journal or trigger settlement refresh.
3. Punk, owner, chain, away-and-back, and direct selection changes during awaited sign-in each prevent POST dispatch (five cases).
4. A stable selection sends its original POST exactly once after authentication.
5. Settlement ignores mismatched owner/Punk/chain and refreshes only the matching scope.

This is an independent execution of the actual integration seam, not a claim to have independently run the entire browser application. The parent-produced full-controller browser report at `fa3fe3e` is separately inspected evidence: 25 scenarios, 59 captures, no findings or browser errors, 157 recorded API requests with **zero marketplace requests**, zero external requests, zero real wallet calls and zero public transactions. That browser run predates the small `abb2760` POST guard; the nine independent seam cases cover the guard directly. Public purchasing remains disabled.

## Reviewed source and evidence hashes

| SHA-256 | File |
| --- | --- |
| `a6247bc7b02e699402d9681539b3feea30aef10bf50b956caa44b083002380f2` | `site/broker-v2.js` (`abb2760`) |
| `8b8820a0e4a79a0e8687f081807cd3ece0a54c20875c0240ffbe535f48621689` | `site/broker/v2/index.html` |
| `314b1a4b347655be2ff485545ac20376ce7e05f57f1a8bb55a4a408e6d0eb543` | `/private/tmp/gogh-final-capabilities-ux/report.json` (parent full-controller browser evidence) |
| `05d9136db699052fbac6c0c0120a44634bf88d409abdb0f0dc7313ad9b4d351e` | `site/marketplace-purchase-panel.js` |
| `ff2fbdd7adaff36f5468526a4545f57154538f29eaf532ff94fe2cb42b0320f2` | `site/marketplace-wallet.js` |
| `aee72b693dfd0039a0aa7b10dc78948ac4e23b03277b211138cf620fc5a1e584` | `site/marketplace-wallet-codec.js` |
| `f8999a83e7623b5502008d0d829025a40b35c7b8e1ab9ad19f5f822ed3bc8039` | `tests/fixtures/marketplace-panel.mjs` |
| `dce129baa4420c9d96c75b36a574f0f4826a9b6f7f5d40763128e208ed202251` | `scripts/test-marketplace-purchase-panel-browser.mjs` |
| `e261bfabbc8d7569d2f92d9ffdb108ec4c95464dd47cd5d8da3496d8e87a237c` | `docs/v2-hardening/marketplace-panel-evidence/result.json` |
| `4d58b49eec63e95344a12e5777655802f94a8fedcdb7946ecccfe737575de31d` | `netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql` (parent index follow-up) |

Author browser evidence: PASS at `2026-09-13T23:55:52.712Z`; public requests and transactions 0. The main-controller mount is reviewed above. Production release, real listing-source validation and guard deployment remain separate gates.
