# Forge practice expiry recovery: independent review

Date: 2026-09-13

Status: PASS_FOR_CONTROLLED_TESTING. The final source, targeted regressions, fresh browser evidence and desktop/mobile expiry screens are approved. No open P0, P1 or P2 findings remain in this bounded repair. This is not a public-burn authorization or a review of unrelated product features.

## Scope and reported failure

Review covers the local copied-chain Forge practice served by `scripts/dev/skill-forge/original-practice-server.mjs` and its browser interface. It does not authorize a production burn, change deployed contracts, change owner authority, or certify production asset inventories.

The reported practice had an unsent `TRAINING / claim_rarity` review in persisted `EXPIRED` state. The interface disabled confirmation and cancellation while also disabling the next practice actions. The result was a dead end before the copy burn and training-credit journey.

## Confirmed cause

`createTrainingCoordinator().get(identity)` expires a persisted `PREPARED` review whose database deadline has passed by calling `cancelPrepared`. This creates an `EXPIRED` record with an incremented revision. The practice server then copied that status into its display review, but accepted cancellation only for display status `PREPARED`. The browser likewise disabled its cancellation control for `EXPIRED`. The immutable envelope's original revision also becomes stale after this transition.

An expired unsigned review is not the same as an unresolved wallet submission. The interface must distinguish them rather than describe every non-`PREPARED` state as “Submission reserved.”

## Safety invariants checked against existing implementation

| Persisted state | What it proves | Permitted practice recovery |
| --- | --- | --- |
| `PREPARED` | Claim has not committed; storage requires no transaction hash. | Re-read the matching intent and cancel using its current revision. Clear the display only after cancellation succeeds. |
| `EXPIRED` | A previously `PREPARED` review expired before claim; storage requires no transaction hash, observation or settlement. | Explicitly discard the matching display review only after a fresh persisted read and no local send hash. No transaction is needed. |
| `WALLET_REQUESTED` | The durable reservation committed before a possible send. A lost response may conceal that commit. | Keep reserved and recover the original result. Missing local hash and elapsed time do not prove it was unsent. |
| `SUBMISSION_UNKNOWN` | A prior wallet request has an ambiguous outcome. | Keep reserved; no cancel-to-retry path. |
| Submitted, included, reorged, or hash-bearing result | A transaction is known or needs reconciliation. | Preserve its original transaction identity and reconciliation path. |
| `REVIEW_EXPIRED` | A separate worker-verified terminal settlement, potentially after claim. | Do not mistake this for the never-claimed `EXPIRED` state or classify it as an unsent discard. |

Evidence inspected:

- `broker/src/v4/skill-forge/training-coordinator.mjs`: prepare, get, claim and mutate paths.
- `broker/src/v4/skill-forge/postgres-training-store.mjs`: row validation, `cancelPrepared`, claim transaction ordering and hold states.
- `netlify/database/migrations/20260910180000_stage_forge_training_intents.sql` and `20260911140000_settle_forge_training_intents.sql`: allowed state transitions, null-hash constraints, immutable review/transaction rules, and token/nonce hold indexes.
- `broker/src/v4/skill-forge/selected-burn-coordinator.mjs` and `selected-burn-store.mjs`: burn reviews have no `EXPIRED` storage state; elapsed unsigned burn reviews remain `PREPARED` and require current-revision cancellation.
- `site/forge-durable-wallet.js`: rejects training reviews with five seconds or less remaining, commits the reservation before sending, and never automatically retries a send.

The store's transition rules prohibit `WALLET_REQUESTED → EXPIRED` and `SUBMISSION_UNKNOWN → EXPIRED`. A lost claim commit acknowledgement can therefore leave a hashless but reserved `WALLET_REQUESTED` record. This is why an empty local hash is insufficient evidence for discarding a review.

## Required repair properties

1. Read the persisted record for the selected review; reject missing or mismatched identity and malformed phase data.
2. Explicitly offer discard for verified unsent `PREPARED` or never-claimed `EXPIRED` only. Check both persisted and local hash evidence.
3. Cancel `PREPARED` using its fresh revision and retain the display if cancellation fails.
4. Preserve claimed, unknown and submitted reservations after errors or elapsed time.
5. Explain the expired state plainly and permit another review after explicit discard.
6. Retain the existing deadline and strong copied-burn confirmation; do not lengthen production transaction guards to hide a UI issue.
7. Prove expiry → discard → renewed review → burn copy → exactly one credit → learn → equip in a newly owned disposable practice. Preserve the user's existing practice processes.

## Final diff and test evidence

### Finding during implementation review

P2, repaired: a failed or lost confirmation response previously left the browser's old `PREPARED` snapshot intact. Its cached `canDiscardUnsent: true` could continue to display “Nothing was submitted” and offer another confirmation after the server might already have committed its claim. The browser now retires the cached status to `CHECKING` with `canDiscardUnsent: false` before confirmation or cancellation reaches the network. Only a fresh successful API response may restore unsent status. The review identity remains available for recovery, both transaction controls remain disabled after ambiguity, and the holder is directed to refresh the original result. Freshness-error wording no longer asserts that nothing was submitted.

The final source diff keeps the deadline, existing source-asset checks, strong `BURN COPY 1753` confirmation, transaction construction and reservation semantics unchanged. Cancellation reads the exact persisted review, checks both stored and local hashes, and uses the current durable revision. The optional starting-slot work is collapsed separately from the required burn → learn → equip sequence. The UI stops offering confirmation with five seconds or less remaining, matching the training-wallet guard.

Independent baseline: 64 tests passed, zero failed, using:

```sh
node --test tests/skill-forge-postgres-store.test.mjs tests/skill-forge-durable-wallet.test.mjs tests/skill-forge-selected-burn-wallet.test.mjs tests/skill-forge-training-settlement.test.mjs
```

These exercise the existing stores, coordinator-facing wallet guards and settlement logic, including lost commit acknowledgement, rejected or hashless wallet requests, expired unsent claims, ambiguous cancellation denial, immutable transaction identity, and canonical finalized expiry. The store tests use a protocol/failure-injection pool; they do not claim to execute SQL. The existing database migrations were inspected separately.

Independent expiry-specific run: `node --test tests/forge-practice-expiry.test.mjs` passed 21 tests, zero failed. This checks never-claimed expiration, claimed/unknown reservations despite elapsed deadlines, mismatched intent/hash/revision/phase data, and preservation of a known submitted hash. Combined with the baseline, 85 targeted tests passed independently.

The actual-browser harness was reviewed. It injects a one-shot confirmation transport failure before the fixture request reaches the server, verifies the UI withholds both controls and the non-submission claim, then refreshes the durable unsent state. It subsequently waits for the real review deadline, reloads, verifies persisted `EXPIRED` and no credit/burn, explicitly discards the review, and proceeds through the actual copied-chain burn/learn/equip/research flow. The transport injection proves browser behavior under ambiguity; it does not claim an actual lost blockchain send. Lost commit/hash behavior is covered by the existing reservation tests above.

No new feature test was added by this reviewer because the implementing agent owns the expiry regression harness; the independent review checks that harness against the storage invariants above.

Fresh browser evidence inspected: [forge-interactive-evidence.json](forge-interactive-evidence.json), `checkedAt: 2026-09-13T21:57:58.282Z`, copied-chain anchor `62291709 / 0xe26a72ddce6d60912c1d70e536fb54f8af01f6206b4829af863e72e6edb3ab67`. The actual run passed the ambiguous-confirmation UI recovery, real review expiry, reload, explicit discard, approval, copied burn granting exactly one credit, reload without duplicate credit, learning with credit consumption, equipment, real trait research, and denial after unequipping. It recorded zero wallet requests and zero public transactions.

Independently inspected expiry screenshots at 1440, 375 and 320 pixels: the expiry explanation and enabled **Discard expired review** are visible, confirmation fields are hidden, text wraps within the viewport, and the optional slots are separate from the main learning flow. Source/helper/UI hashes still match the reviewed implementation. The final browser harness hash below includes its corrected JSON-read syntax, reviewed after the successful run.

Limits remain explicit: the copied database contains fixture-empty application jobs, nonstandard/later assets and live obligations are not certified, and independent public finality is not proven by this local exercise. This review did not access credentials, modify the user's existing practice, or initiate a production transaction.

Reviewed SHA-256 source hashes:

| File | SHA-256 |
| --- | --- |
| `scripts/dev/skill-forge/original-practice-review.mjs` | `58405b63a25df87782efcd6a52e21965ea2c2d9a1ba4d0e6d3fb20e31ccf6a43` |
| `scripts/dev/skill-forge/original-practice-server.mjs` | `d725743004479775747a7520b1a438e8b1232c76ff27304d739fd2d2f2ad6169` |
| `scripts/dev/skill-forge/original-practice.js` | `73d26fead7f6559f065f9f09f561b9464d463cd67e8e2f0079b5549210878e39` |
| `scripts/dev/skill-forge/original-practice.html` | `9f7a6c1ac8b614dcf3f0571282f9b6dcd3f629a637a379444bd0e99545b25fd8` |
| `scripts/test-original-forge-practice-browser.mjs` | `dbadf41fcbc12486efc353be38098af5b9dc4f22880252200ba7c964793f16b3` |
| `tests/forge-practice-expiry.test.mjs` | `78e897450c4f4e490612ca334b6408d4e158ad7cdc7cd3a191e21f329e17bb71` |

The updated browser and API must run together in a newly started owned practice process. An older process can retain its old imported server code even if its HTML/JavaScript files change on disk; refreshing the older URL alone is not a reliable repair.
