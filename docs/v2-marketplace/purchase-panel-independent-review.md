# Independent purchase-panel review

Date: 2026-09-13. Reviewer: `real_skill_completion`. Component implementation: `32797bc`; fixes: `b5a787f`. The reviewer did not implement the panel, wallet helper, codec or controller integration and changed only this report and `tests/marketplace-purchase-panel-independent.test.mjs`.

## Verdict and scope

**PASS for the component's controlled owner-assisted integration.** No unresolved P0/P1 remains in the reviewed component. **The parent controller mount is pending a separate follow-up review.** This verdict does not enable public purchases, validate a production listing source/policy, or approve a guard deployment. The intended public mount retains a null purchase release and no public listing selector or purchase preparation action.

No real wallet, external API, public transaction, order post, refund, production migration, or owner-fund operation was used. Native database and transaction-codec boundaries retain their separate reviews.

## Findings resolved before integration

| ID | Priority | Finding | Resolution |
| --- | --- | --- | --- |
| PANEL-01 | P1 before controlled execution release | An ordinary rejected preparation with no server record left a local DRAFT active forever. The holder could neither discard it nor prepare corrected listings/budget because new input had to match the rejected input. | An explicit Discard unsent request action now performs a fresh GET for the exact original intent. Only a still-unattempted, hash-free DRAFT with no server record is marked locally DISCARDED; its history remains. A late PREPARED/CLAIMED record is adopted instead. Corrected input can create a new UUID. |
| PANEL-02 | P2 | A known paused release on a new device made its required server history read, but a failed read hid the entire panel and its recovery error. | The known-release failure now displays Check your purchases, a plain error and Refresh status. An absent release with no local journal still stays hidden without API work. |

Local discard is not presented as a chain success or server cancellation. Failed lookups, changed selection, changed active reference, attempted drafts or saved transaction hashes cannot be used to abandon a potentially submitted purchase. The existing SQL hold remains the cross-device authority boundary.

## Independent checks

The final independently executed commands passed **74 cases: 67 existing component/codec boundary cases plus seven reviewer-owned regressions**, with zero failures/skips:

```sh
# Run in the component checkout, or the integrated repository after cherry-pick.
node --test tests/marketplace-purchase-panel.test.mjs tests/marketplace-wallet-boundary.test.mjs

# Run from the review worktree before integration; omit the override afterward.
GOGH_PURCHASE_PANEL_REVIEW_ROOT=/private/tmp/gogh-final-skills node --test tests/marketplace-purchase-panel-independent.test.mjs
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

## Pending main-controller review

The parent must mount this component with a null release, no public prepare/listing selector, and current owner/Punk getters. Integration must refresh or clear on relevant state changes, preserve original journals after disconnect/transfer, avoid idle marketplace requests, and refresh collection/activity only for the matching settled owner/Punk. Source and integration tests for that mount were not yet available at this report's first commit.

## Reviewed source and evidence hashes

| SHA-256 | File |
| --- | --- |
| `05d9136db699052fbac6c0c0120a44634bf88d409abdb0f0dc7313ad9b4d351e` | `site/marketplace-purchase-panel.js` |
| `ff2fbdd7adaff36f5468526a4545f57154538f29eaf532ff94fe2cb42b0320f2` | `site/marketplace-wallet.js` |
| `aee72b693dfd0039a0aa7b10dc78948ac4e23b03277b211138cf620fc5a1e584` | `site/marketplace-wallet-codec.js` |
| `f8999a83e7623b5502008d0d829025a40b35c7b8e1ab9ad19f5f822ed3bc8039` | `tests/fixtures/marketplace-panel.mjs` |
| `dce129baa4420c9d96c75b36a574f0f4826a9b6f7f5d40763128e208ed202251` | `scripts/test-marketplace-purchase-panel-browser.mjs` |
| `e261bfabbc8d7569d2f92d9ffdb108ec4c95464dd47cd5d8da3496d8e87a237c` | `docs/v2-hardening/marketplace-panel-evidence/result.json` |
| `4d58b49eec63e95344a12e5777655802f94a8fedcdb7946ecccfe737575de31d` | `netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql` (parent index follow-up) |

Author browser evidence: PASS at `2026-09-13T23:55:52.712Z`; public requests and transactions 0. Full application mount and production release remain separate gates.
