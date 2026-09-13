# Collection and original artwork security review — 2026-09-13

STATUS: PASS for the inspected display changes; no open release-blocking security finding in this scope. This is independent review of the new original-artwork endpoint/helper and the parent-owned frontend changes. The reviewer previously implemented the collection latency backend, so its own tests and live shadow are supporting evidence, not independent approval of that backend.

Reviewed candidate: parent integration HEAD `4f9e45092cd33db3c567cfbd3c3131231199566f` plus its uncommitted display changes. Isolated review checkout HEAD is production `a0445825969e8c404eb5b8bcb728e9a37f2c41de` plus the shared display candidate. No commit, deployment, worker execution, transaction, or production database write was performed in this review.

## Findings and independent reasoning

| ID | Severity/status | Evidence and conclusion |
| --- | --- | --- |
| DISPLAY-01 | Informational, resolved | `netlify/functions/broker-punk-artwork.mjs:15`, `_shared/original-punk-artwork.mjs:21`, and `site/broker-v2-ownership.js:5`: the artwork maximum 5016 agrees with the browser's actual `maxSupply()` selector `0xd5abeb01`. Both live providers returned 5016 for that method. The distinct `MAX_SUPPLY()` selector `0x32cb6b0c` returned 10000. The initial concern confused these methods; there is no demonstrated range defect and no bounds expansion is recommended. |
| DISPLAY-02 | No finding, checked | `broker-punk-artwork.mjs:19` constructs only token IDs and nullable artwork. Its fixed chain/collection response and public cache carry no session, wallet owner, ownership decision, or recovery capability. `_shared/original-punk-artwork.mjs:82` verifies the chain before new reads; lines 89–103 read the fixed original collection and accept bounded embedded JSON/SVG/PNG only. Arbitrary metadata URLs are not followed. Public caching therefore does not cache private ownership authority. |
| DISPLAY-03 | No finding, checked | `site/broker-v2.js:1221` binds collection replies to owner, selected token, chain, and request generation; line 1611 checks that guard after both session and collection awaits. Independent tests resolve old successes and failures after a newer same-token response and after a wallet switch: none overwrite current state. Wallet events reset the gallery generation at line 2837. |
| DISPLAY-04 | No finding, checked | `site/broker-v2.js:1751` coalesces pending session requests by wallet and chain. `readV2Session` rechecks current wallet/chain after each asynchronous authentication step and verifies the final cookie session. Tests prove concurrent Fund/Collection reads request one login signature and one completion, clear the pending slot afterward, and stop a changed wallet/chain before challenge/signature. This does not claim epoch invalidation for an owner who transfers away and later returns. |
| DISPLAY-05 | No finding, checked | `site/broker-v2.js:1934` accepts artwork only for the exact requested token set, canonical collection, and chain. It applies only image fields to an already-present roster item and checks the current wallet/chain first. Independent duplicate, foreign-token, foreign-chain, and stale-wallet response proofs leave the roster's ownership fields unchanged. Actual roster ownership still passes through `verifyOwnedPunkIds` at line 1990. |
| DISPLAY-06 | No finding, checked | `site/broker-v2.js:91` restricts image URLs. `renderGallery` at line 1235 uses image elements and `textContent`, not HTML insertion, for metadata. The independent mock DOM throws if an HTML sink is used; hostile names remain literal text, script URLs are rejected, and an untrusted OpenSea URL creates no link. Inline SVG is used only as an image, not injected into the document. This is a source/DOM-unit proof, not a browser engine security test. |
| DISPLAY-07 | No finding, checked | `site/broker-v2.js:1278` offers an Agent recovery button only for live-verified ERC721/ERC1155 entries. Clicking enters Fund and calls `openAsset`; `site/punk-agent-recovery-panel.js:231` only selects a draft, clears the confirmation checkbox, and focuses the review. It does not prepare, sign, or submit a transaction. The V3 link must exactly match the selected Punk's existing assets route. Backend Agent holdings, including selected paid receipts, use `/broker/v2/?tab=fund&tokenId=93#agent-recovery`. |

There is no source-fix recommendation from this review. Keeping the display maximum aligned with a future intentional collection-supply change is a maintenance dependency; the current two-provider evidence supports 5016. Token zero is within the legacy scan bound but its live owner lookup reverted; the artwork endpoint safely returns null for absent tokens.

## Live read-only collection shadow

Executed the integrated `handleV2Collection` with the real default authority reader, real viem clients, and the real `readDirectedPaidHistory` validator over the production paid journal. Only the session boundary was mocked as the selected known owner: **this was not live authentication**. Mocking the session avoided the normal session reader's `last_seen_at` UPDATE and avoided creating any login challenge.

The database connection used the available general paid-database credential, constrained with PostgreSQL `default_transaction_read_only=on` and `statement_timeout=3000`; a local query wrapper accepted SELECT statements only. The dedicated request-role URL and managed application database URL were not available in the local shadow. Accordingly, application acquisition and worker-receipt SELECTs were attempted against that read-only connection and failed as optional sources; they were not replaced with fabricated empty success. The same paid-journal review-digest/owner/action/receipt checks ran without weakening. No signed transaction column was selected. Six SELECTs ran across the two endpoint invocations; no worker was imported or invoked.

| Read path | HTTP | Endpoint elapsed | Authority block | NFT result | Artwork |
| --- | --- | --- | --- | --- | --- |
| Actual configured main RPC | 200 | 1614 ms | 62150066 | Peppies World #1599, `LIVE_VERIFIED`, Agent `0xcadcfd37e715bc031cf0cec7fa2335091c878c83` | null; `metadataUnavailable: 1` |
| Validation Cloud archive RPC | 200 | 1165 ms | 62150090 | Same collection/token and live Agent custody | Real tokenURI/IPFS display, name `pre-reveal`, HTTPS image; `metadataUnavailable: 0` |

Both returned `inventoryComplete: false`, `paidMintHistoryAvailable: true`, and `ownershipChecksUnavailable: 0`. Both reported `ACQUISITIONS`, `AGENT_INDEX`, `WALLET_INDEX`, and `WALLET_RECEIPTS` unavailable. OpenSea was attempted with the real configured key and failed as an optional source; no key, database URL, provider URL, cookie, signature, or signed bytes appears in the evidence. The one displayed holding is collection `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`, token `1599`, with the Agent recovery URL. Other holdings are not claimed absent or completely enumerated.

The shadow finished at `2026-09-13T17:55:33.669Z`. At block 62150097, the Validation Cloud client reported chain 4663; `ownerOf(5016)` and `tokenURI(5016)` succeeded, with 24001 characters of embedded JSON metadata. `ownerOf(0)` and `ownerOf(5017)` reverted. Follow-up reads through **both** configured main and Validation Cloud confirmed:

| Method | Selector | Result |
| --- | --- | --- |
| `maxSupply()` | `0xd5abeb01` | 5016 |
| `MAX_SUPPLY()` | `0x32cb6b0c` | 10000 |
| `totalSupply()` | `0x18160ddd` | 4295 |

The browser names its selector variable `MAX_SUPPLY` but calls the lower-case method. The circulating total is not a maximum token ID. The initial uppercase-method observation does not establish any defect in the existing ownership fallback.

Sanitized local shadow output: `/private/tmp/gogh-collection-display-release/.validation/display-live-shadow.json`. The credentials-fetching script is outside the repository, reads secrets only in memory, and is not a release artifact. Its older `boundary.maximum` label records the uppercase constant; the table above records the conclusive distinction.

## Test evidence

Added `tests/display-security-review.test.mjs`: ten independent tests evaluate the actual frontend function bodies in Node VM and invoke the new artwork endpoint/helper directly. No wallet, full browser, worker, or production transaction is involved in those tests. The source-root override exists only so the isolated review checkout can evaluate the parent-owned frontend; when copied into integration, the test reads that checkout by default.

Command:

```sh
DISPLAY_REVIEW_SOURCE_ROOT=/private/tmp/gogh-punk93-mint-stall node --test --test-concurrency=1 tests/display-security-review.test.mjs tests/original-punk-artwork.test.mjs tests/art-broker-v2-collection-holdings.test.mjs tests/art-broker-v2-collection-endpoint.test.mjs tests/art-broker-v2-ownership.test.mjs
```

Result: **47 passed, 0 failed, 0 skipped, 0 cancelled**, 4955.099277 ms. Log: `/private/tmp/gogh-collection-display-release/.validation/display-security-tests.log`. `node --check tests/display-security-review.test.mjs` and `git diff --check` passed. An initial review-test run was interrupted because the test harness used insufficient cross-realm microtask synchronization; replacing that harness wait with an event-loop turn resolved it. No production source was changed to make a proof pass.

Final recheck after the parent's explicit `TOKEN #1599` detail text: **10/10 independent tests passed**, 948.259744 ms; log `.validation/display-security-final-tests.log`. That detail uses the existing text-only rendering path. Frozen reviewed SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `site/broker-v2.js` | `f42ed0dbe455b7bb5ac8bb6a15470f2e72881e7ad2f3e7043a84d6fa7cf979ad` |
| `netlify/functions/broker-punk-artwork.mjs` | `e8888d7396cc082ea82b23ae53a5ea455a36da2b3aa57739833f6a6dd3cf18f3` |
| `netlify/functions/_shared/original-punk-artwork.mjs` | `544370b8c45512101547373c4cbd01d85e2818013ec6e0aef33d5fe03678dec6` |

The adjacent tests additionally cover slow/failed optional discovery and metadata, moved-away paid NFTs, unknown Agent accounts, real receipt candidates, auth failures, acquisition caps/deduplication, ownership timeouts, and explicit incomplete inventory. Collection limits remain 18 seconds overall, 4 seconds of ownership work with four concurrent checks, and a separate one-second metadata budget. Artwork has at most 32 new reads per request, eight concurrent reads, two-second individual limits, a 512-entry cache, and a 2-million-character image response budget. Existing read-only requests can finish after a timeout; their results cannot later mutate an already-returned holdings response.

## Release criteria and limits

1. Preserve the independently reviewed source files and rerun the targeted test in the final integration checkout after copying it. Any later change to authority/session gates, display identity validation, request generations, or recovery routing needs review of that diff.
2. Parent release gates must cover the final integrated JS/site build and actual browser account/chain transitions, loading/error/empty states, refresh, roster artwork, and opening recovery review without submission. This scoped Node review does not replace those browser or full-release gates.
3. Verify the deployed authenticated collection route and configured application database after release using existing authorized read-only checks. This shadow proves real paid-journal discovery and live custody, but does not establish live cookie authentication, production Netlify cold-start latency, or application-index availability.
4. Keep all partial-inventory/source/metadata notes and mandatory owner checks. Do not infer complete inventory, burn safety, or transfer authorization from a gallery image, a paid receipt candidate, or public artwork cache.
5. No contract, paid worker, recovery authority, RPC configuration, migration, or managed-worker continuity change is part of this display review. Broader swarm release approval depends on its separate completed reviews and final integration gates; this report does not claim a new production activation or production financial validation.

FILES CHANGED in this review phase: `tests/display-security-review.test.mjs`, `docs/v2-hardening/display-security-review.md` only. Earlier collection implementation and the other agent's artwork files remain present in the shared candidate but were not edited during this independent phase.

FILES INTENTIONALLY NOT CHANGED: parent frontend; artwork implementation; collection implementation; authentication; ownership; metadata sanitizer; recovery/signing; paid worker; contracts; deployment manifests; configuration; migrations; dependencies and node_modules.

IMPLEMENTATION SUMMARY: independent adverse proofs and bounded live read-only evidence; no runtime implementation change.

INTERFACES USED: actual browser collection/session/artwork function bodies, public artwork handler, canonical tokenURI/maxSupply/ownerOf calls, existing V2 authority reader, collection dependency injection for the session and database connection, unchanged paid history validator.

TESTS ADDED / TEST RESULTS: ten independent proofs; combined focused suite 47/47 passing as above.

SECURITY CONSIDERATIONS: metadata remains advisory, fixed-chain original artwork is public display only, live owner/custody checks remain mandatory, stale responses are discarded, session calls coalesce without replacing authentication, and recovery entry opens a draft review only.

DEPENDENCIES: parent integration, independent collection-backend review, final full-release/browser gates, real deployed session/application-database verification. BLOCKERS: none in reviewed display diff; the shadow's authentication/application-database coverage limitations remain explicit release-validation dependencies.

INTEGRATION NOTES / SHA: no commit was made. Copy only the two review-owned files for this phase; keep `.validation` logs local and do not stage the node_modules symlink. Reviewed base SHAs are recorded above.
