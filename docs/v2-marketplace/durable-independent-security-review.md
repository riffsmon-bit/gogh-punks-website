# Independent durable marketplace security review

Date: 2026-09-13. Reviewer: `real_skill_completion`. Scope: durable coordinator, immutable journal envelope, PostgreSQL store, staged migration, production-blocked runtime and authenticated HTTP route introduced in `74b158f`, plus the receipt verifier where terminal outcomes release the journal reservation. Review performed read-only in the parent integration checkout; only this report and the dedicated independent regression test belong to the reviewer.

## Verdict

**PASS for controlled integration of the durable owner-assisted marketplace backend at `fd0d04e`, including canonical-receipt fix `5a57c24`. No unresolved P0/P1 remains within this review scope.** Public marketplace activation remains BLOCKED independently of the code-review verdict. No production guard deployment, live signed-order submission, production database migration/grant, public purchase, WETH bid, refund, wallet request, or fund movement was performed by this review.

## Findings

| ID | Priority | Finding | Status |
| --- | --- | --- | --- |
| MKT-01 | P1, controlled-release readiness | The original store used a pool's autocommitted INSERT/UPDATE and assumed an acknowledgement meant the claim was durable. A restricted session with `synchronous_commit=off` passed role verification. A reviewer-owned native SQL trigger then proved both PREPARED and WALLET_REQUESTED writes actually ran with that setting, while the coordinator returned `walletClaimed:true`. A crash could lose an acknowledged reservation and permit a repeated claim. | Closed by `fd0d04e` (author source `e274d0e`). The checked-out connection forces LOCAL synchronous commits, verifies fsync/full_page_writes and both permanent public relations before and after mutation, and awaits COMMIT acknowledgement. Independent native tests observe sync=on inside actual writes and reject unsafe engine/storage settings without journal or audit changes. |
| MKT-02 | P1, controlled-release readiness | The receipt verifier returned terminal REVERTED after an awaited head read without repeating the canonical header check used by successful receipts. A deterministic fixture changed that block during the head read; the verifier returned REVERTED and the new journal released the hold. | Closed by `5a57c24`. The parent added a shared number-and-hash canonical check before either terminal return and retains block identity on reverted receipts. Independent journal-level tests pass for stable revert, changed hash/number, unavailable closing header and insufficient finality. |

Both findings are release blockers for the execution-capable composition, not claims that the currently blocked production endpoint has moved funds or exposed a wallet payload. The tests use local fixtures and an owned PostgreSQL cluster. They do not simulate a real production database crash or claim to eliminate future chain reorganizations after an accepted finality threshold.

## Boundaries that passed review

The HTTP handler derives the owner exclusively from the existing authenticated session and the Punk from the strict route. POST requires same origin. Exact body/query keys, 4096-byte limits, canonical unsigned decimal-string budgets, one to five distinct exact order hashes, and fixed action BUY_LISTINGS reject arbitrary authority, URL, calldata, transaction and dependency injection. WETH operations are outside this journal interface.

The production runtime has no environment flag that enables execution: its fixed release is BLOCKED, no marketplace store or RPC client is created, and responses carry no transaction. Authentication still uses the existing session database. Future release composition is server-owned and requires a restricted pool, fixed read-only client with client-level `ccipRead:false`, reviewed guard and real source/screen/policy callbacks. Evidence hash syntax is not proof that those future adapters are valid; actual composition still requires release review. Fixture attestations cannot be used as production evidence.

Canonical immutable journal JSON commits the owner, chain, Punk, request UUID, original listing selection, budget, transaction, anchor, release evidence and expiry. Every database read revalidates stored JSON bytes, digest, scope and state bindings. Prepared/GET/recovery responses redact original calldata and return a calldata hash plus exact transaction-field commitment. The original payload is returned only to the committed first claim winner. Server-only verifier injection seams are not exposed to HTTP.

Every mutation requires exact intent/revision/review digest and owner/Punk/chain scope. SQL enforces monotonic revisions, immutable review fields, legal transitions, original-hash immutability, terminal receipt identity, insertion/claim expiry and append-only audit revisions. Unique active holds cover both owner across Punks and Punk across owner transfer. A changed UUID, expiry, alleged wallet rejection, missing receipt/hash or lost response never releases an already claimed purchase. Only an unclaimed PREPARED entry can cancel.

Claims recheck owner/account state, policy/skills/screen/source evidence, nonce, fixed selection, original guard, gas ceilings and original anchor, then simulate the stored original transaction. Freshly built calldata never replaces the saved review. A release pause after committed CAS withholds the wallet response while preserving the hold. Recovery does not reopen a wallet or rebuild a transaction: an unbound hash is persisted only after the fixed client sees the exact original transaction, and a bound hash cannot be substituted. Pending/unavailable evidence retains the hold; terminal interpretation uses canonical receipt and historical evidence with 12 required confirmations.

The staged migration creates additive tables, indexes and triggers only. RLS is enabled and PUBLIC privileges are revoked, with no production policies or grants. Request-role verification rejects table ownership, superuser/bypass, schema creation, delete/truncate, audit writes and immutable JSON updates. The dedicated server role remains trusted to read application rows; end-user isolation is enforced by authenticated scope and parameterized owner/Punk/chain predicates, not by the disposable test's broad role policy. Store queries, catalog OIDs and privileged audit insertion explicitly use public schema qualification, so temporary shadow tables cannot redirect reads or audit writes. Native tests verify this boundary.

## Validation and reproduction

**153 test cases passed independently with zero failures/skips in the final runs:** 143 focused tests, one existing comprehensive native PostgreSQL case, and nine reviewer-owned cases including the adversarial native durability case.

The independently executed existing focused suite passed 143 tests:

```sh
node --test tests/marketplace-api.test.mjs tests/marketplace-durable-journal.test.mjs tests/marketplace-postgres-durability.test.mjs tests/marketplace-review.test.mjs tests/marketplace-independent-security.test.mjs tests/marketplace-practice.test.mjs tests/marketplace-practice-independent.test.mjs
```

The existing native PostgreSQL suite passed its single comprehensive test with real concurrent preparations/claims, separate-pool recovery, immutable bytes, scope holds, role privileges, expiry and temporary-table shadow checks:

```sh
node scripts/test-marketplace-journal-postgres.mjs --owned-local-only
```

The reviewer-owned tests run against an integration checkout before cherry-picking:

```sh
GOGH_MARKETPLACE_REVIEW_ROOT=/private/tmp/gogh-capabilities-integration GOGH_MARKETPLACE_INDEPENDENT_NATIVE=1 node --test tests/marketplace-durable-independent-review.test.mjs
```

After integration, omit the optional root override. The native opt-in starts and removes only a new loopback PostgreSQL cluster using the existing owned-cluster helper. It never consumes an external DSN. Without native opt-in, the pure fixture tests run and the native case is explicitly skipped.

All nine new cases pass with native opt-in. The new regressions cover release pause after CAS, lost preparation acknowledgement, non-poisoning hash hints, exact terminal-revert outcomes and actual database durability configuration. The native test changes synchronous_commit after initial role verification and observes the setting inside real INSERT/UPDATE triggers, then restarts only its own cluster with fsync/full_page_writes off and tests an UNLOGGED audit table. Each unsafe condition leaves the original revision and two audit rows unchanged; restoring safe settings permits original recovery. The request session remains off outside each mutation, proving LOCAL enforcement is scoped correctly. Startup checks on an arbitrary pool session cannot satisfy this test.

No full repository validation, new browser-wallet run or copied-chain transaction journey was executed by this reviewer. The parent owns integration-wide validation. The existing `durable-disposable-evidence.json` was inspected as author evidence: it records one owned copied-chain purchase, one wallet claim, two delivered NFTs, native PostgreSQL and coordinator restart, paused-release recovery, and revisions 0 through 3. Its fixtures and no-public-transaction limitations remain explicit; this review does not turn them into a live provider or production-policy proof.

## Remaining release requirements and practical limits

- Deploy and independently pin the purchase postcondition guard through a separate owner-authorized process.
- Review real fixed-source signed orders, collection screening, deterministic shared policy/equipped skills, and the exact production runtime composition.
- Apply/provision the additive journal migration and restricted production role under separate authorization. Staged source files are not evidence of production database readiness.
- Keep the browser's original-transaction commitment and one-send recovery boundary; its separate independent review remains required.
- This journal coordinates the owner's marketplace nonce lane, not every paid/free-mint or external wallet action. A conflicting nonce invalidates preparation; it must not be automatically replaced.
- A claimed purchase with an unrecoverable original hash remains held. Browser-decline assertions cannot prove non-broadcast.
- Recovery uses the original authenticated owner scope even after a Punk transfer. A new owner does not gain access to the previous owner's transaction journal.
- WETH escrow transfer invalidation and public marketplace acceptance remain separately blocked, as documented in the WETH release review.

## Reviewed source hashes

These SHA-256 hashes bind the source reviewed and tested. Follow-up authority, SQL, persistence, recovery or release changes require a focused re-review.

| SHA-256 | File |
| --- | --- |

| `108b0b1412e20da6bd2a3677fcd313ad3bbdcbf36ee6c3654d826129c645cef9` | `broker/src/v4/marketplace/durable-coordinator.mjs` |
| `ac50c55d1e21f83c4d8f10784edf58f66b1531f4035bc7a56ae20dc0855087d4` | `broker/src/v4/marketplace/durable-journal.mjs` |
| `2a74dcc4585bb1085e401b1fcf2da10db34ebafdd13531561621c3e2b11e49ae` | `broker/src/v4/marketplace/durable-release.mjs` |
| `0bb7adbfc3774fa67d7b605e53fe33e0ed9e82e1573915872d9b58943137a25e` | `broker/src/v4/marketplace/postgres-journal-store.mjs` |
| `d75b64bee6eff9930a48a800f8ace057cd0ee0aca8ab8e0e73dab4c2d140d4a0` | `broker/src/v4/marketplace/reconcile.mjs` |
| `40db9cb6b95d831e09b25dac4ed2799b21b08c2927c216acd921429fe2e78c83` | `netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql` |
| `12bd903662df1a0cc445b4f29cb760527efc589d62ce5cac95eb3d23411eedd6` | `netlify/functions/_shared/marketplace-runtime.mjs` |
| `13f73128b46e2277de2dbc3465691c5d3877be77212c3fd1120b75fe7932fb96` | `netlify/functions/broker-v2-marketplace.mjs` |

Author disposable evidence inspected at final capture: checkedAt `2026-09-13T23:45:55.251Z`, SHA-256 `5d5fe5f9a4022cb4aea065db624bcfea852c39b4f9c217190299c755415d19b1`, public transactions `0`. This artifact was not independently regenerated by this reviewer.
