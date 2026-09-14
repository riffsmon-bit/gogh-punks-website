# Independent continuation security and integration review

Reviewer: `continuation_final_review`. Review date: 2026-09-13 (workspace date). Baseline: `1063614`; initial checkpoint: `17064cdad2ce43b234e10240b2dd0d6a335428b5`; final reviewed source: `95e5be5e89f142045d0d17e233e68649127bd79d`. The reviewer did not implement the reviewed research, marketplace, database, codec, or purchase-panel features. Scope is the integrated production paths and their staged execution seams, not a whole-product or public marketplace release approval.

## Status

**PASS for controlled integration in the reviewed scope; no new P0 or P1 identified.** CFR-01's P2 recovery sign-in affordance is corrected and independently verified. Public marketplace readiness remains BLOCKED by the production requirements and history-navigation acceptance gate described below.

The review performed source inspection and local fixture tests only. It made no live HTTP or RPC requests, opened no database, inspected no keys or secrets, and did not sign, deploy, broadcast, post an order, change release configuration, burn, refund, or move funds. The original dirty project checkout was not modified. The reviewer owns only this report and `tests/continuation-final-security.test.mjs`; the new tests independently exercise the main-controller composition of the recovery correction.

## Finding

**CFR-01 — P2, CLOSED: expired-session recovery lacked an explicit sign-in action.** With a saved purchase and an expired or missing session, the original panel translated the API failure into “Reconnect the original owner wallet and sign in.” Its Refresh status action called the same GET again; the main controller authenticated only POST operations. The user therefore needed an unrelated broker control to establish a session before the saved purchase could load. This failed closed: it neither authorized a claim nor exposed a transaction. It was not a P0/P1 or a reason to weaken background-read behavior.

Source evidence at the initial checkpoint: `site/marketplace-purchase-panel.js` lines 120–135, 190–208 and 378; `site/broker-v2.js` lines 3046–3056. Author correction `7da0835`, integrated as `3add298`, adds an optional authentication callback and a Sign in to recover button only after exact missing/expired-session API errors. Parent commit `95e5be5` binds that callback to the existing session flow without changing the POST selection-revision guard or null purchase release.

Independent source review verified that the action captures the original owner/Punk, generation and active intent; it rechecks them after sign-in and calls lookup/original recovery with draft preparation retry disabled. It cannot prepare a new purchase, claim, send, or automatically authenticate on mount/refresh. Rejected authentication preserves the saved record and an explicit retry. The final 99-test run below covers the integrated correction; five reviewer-owned cases execute the actual main-controller declarations, synchronizer and mount with the real panel. They verify successful explicit recovery of the same saved intent and rejection after owner, Punk, chain, or away-and-back selection changes during login.

## Production authority and compatibility

- The production marketplace constructor returns the fixed BLOCKED release and creates no marketplace RPC client or store. It does not call the separately exported reviewed-runtime seam. The main controller supplies `purchaseRelease: null`; API data cannot promote it. No public listing selector or prepare action was added. A null release without local history causes no marketplace request, sign-in, or wallet work.
- The HTTP route derives owner identity from the authenticated session and Punk identity from the route. Same-origin POST checks, exact body/query shapes and bounded input prevent client-supplied owner, endpoint, dependency, review, raw calldata, WETH operation, or policy authority from entering the coordinator.
- Floor Hunter, Collection Researcher and Art Curator remain versioned, hash-pinned read-only packages. Loading leaves them TESTING/unapproved. The equipped HTTP/MCP paths require exact release keys and hashes, learned/equipped/available chain state, and before/after owner and loadout continuity. New package files do not alter the accepted public release or deployment artifacts.
- Forge's browser key helper matches `keccak256(abi.encode("GOGH_SKILL", uint32, uint16))`. A shared capability bit exposes only tools declared by the exact equipped manifest and implemented by the server. The canonical resolver still rejects unsupported declarations, stale ownership, hash mismatch, disabled/unavailable packages and loadout changes during execution.
- Actual Netlify included-file declarations retain the raw files needed to validate all planned implementation/dependency pins for Forge, equipped Forge and MCP. The independent package-closure tests construct isolated roots from those declarations. This verifies declared file closure, not an actual newly deployed function archive.
- Collection evidence uses fixed read clients with CCIP disabled and bounded inline metadata. External metadata and images are not fetched. Floor Hunter reports exact integer observed-listing ranks; Art Curator reports declared style labels. Neither output is an executable quote, security clearance, complete collection inventory, or economic authorization. Dynamic browser output is rendered as text.

## Durable and wallet boundaries

The immutable journal binds original owner/Punk/chain, request UUID, selected orders, budgets, anchor, release evidence and exact transaction bytes. SQL reads revalidate the canonical JSON and digest. SQL transitions enforce immutable review fields, monotonic revisions, claim expiry, immutable original transaction hashes, matching terminal receipts and audit revisions. Active holds apply both to the owner's nonce lane across Punks and to a Punk across owner transfers.

Every database mutation uses one checked-out connection, forces LOCAL synchronous commits, verifies engine settings and permanent relations, and awaits COMMIT acknowledgement. Lost acknowledgements cannot return a wallet payload. Claim validation refreshes source, owner/account state, policy/skill/screen predicates, order status/counter, fees, nonce and anchor, then simulates the stored original transaction. CAS admits one claimant. A pause after committed CAS withholds the wallet payload while preserving recovery. Decline, expiry and unknown wallet outcomes do not release a claimed purchase.

The browser persists an attempt before claim and persists a returned hash in the captured original owner/Punk scope. It requires a trusted browser release, exact guard pins, current account/chain, unchanged selection and the first winning claim response. Source and generated codecs bind order counter/hash, all consideration recipients and amounts, native price, NFT recipient, canonical calldata and final reserve/owner/account-state/collection guard. Changed outer commitments alone cannot legitimize changed economic meaning.

Recovery binds a hash only after the fixed client observes the exact original sender, nonce, destination, calldata, value and bounded fee type. Pending/unobserved evidence preserves the hold. Canonical receipts require 12 confirmations, matching original transaction and NFT/payment evidence; both successful and reverted terminal outcomes repeat canonical header checks before releasing the hold. Recovery never rebuilds or automatically rebroadcasts a transaction. Native durability and chain behavior were reviewed in source; this final pass did not rerun their separate native/copy-chain journeys.

## Provider boundary

The staged signed-order reader uses only bounded fixed-host GET lookups. Missing or null signatures remain rejection cases. The separate fulfillment reader validates every selected original GET before any signature-vending POST and snapshots the input before awaiting providers. It binds the returned full-open Seaport order and exact fees/counter/hash/signature to the original, requires the canonical server-resolved Agent recipient, reconstructs the allowed call and rejects arbitrary transaction bytes or authority. Attribution is recorded but not appended to execution calldata. Both adapters reject redirects, changed final URLs, oversized/stalled responses and unsupported variants without retries. Neither adapter is wired into the production marketplace constructor.

The executed fulfillment tests replace fetch with in-memory fixtures; they do not send a live POST or establish live OpenSea compatibility. Signed provider data still requires pinned core simulation and genuine production source acceptance.

## Independently executed validation

**212 tests passed, zero failures, zero skips; 36.030 seconds.** This is a fresh rerun against the integrated source, not a restatement of previous reports:

```sh
node --test tests/planned-skills-independent-integration.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/skill-forge-equipped-research-api.test.mjs tests/v2-mcp-versioned-skills.test.mjs tests/marketplace-api.test.mjs tests/marketplace-durable-journal.test.mjs tests/marketplace-postgres-durability.test.mjs tests/marketplace-wallet-boundary.test.mjs tests/marketplace-opensea-signed-listings.test.mjs tests/opensea-fulfillment-independent-review.test.mjs tests/marketplace-purchase-panel-independent.test.mjs tests/marketplace-purchase-mount-independent.test.mjs
```

These tests execute actual package loading/key calculation, capability gates, HTTP/MCP handlers, coordinator, source and generated codecs, provider adapters and actual controller mount excerpts with local fixture dependencies. The database-durability cases use a controlled connection fixture; they are not a native PostgreSQL crash test. No production credentials, wallet or service were used.

The full site gate, Solidity gate, browser journeys, native PostgreSQL and copied-chain artifacts remain separately owned integration evidence. They were not independently regenerated in this final review and their counts must not be added to the 212 independent cases above.

After the recovery correction and main callback were integrated, the focused final run passed **99 tests, zero failures, zero skips; 6.120 seconds**:

```sh
node --test tests/continuation-final-security.test.mjs tests/marketplace-purchase-panel.test.mjs tests/marketplace-purchase-panel-independent.test.mjs tests/marketplace-purchase-mount-independent.test.mjs tests/marketplace-wallet-boundary.test.mjs
```

This includes the five new reviewer-owned main-mount cases, all 33 component cases, seven earlier independent component cases, nine earlier independent mount cases and 45 source/generated-wallet boundary cases. The final run overlaps the initial 212 cases; the counts are not additive. Authentication and wallet providers in this review are fixture callbacks. No real login signature or transaction was requested.

## Existing public release blockers

The known WETH transfer-away-and-back ownership invalidation problem remains a public-release P1. This review does not reinterpret current-owner equality as ownership continuity or claim to fix that problem. Public native-ETH purchases also retain the missing guard deployment, genuine supported listing-source evidence, authoritative collection screen, authentic purchase policy/equipped-skill composition, restricted production journal role/pool and immutable reviewed release. See [production composition gaps](../v2-marketplace/production-composition-gaps.md) and [WETH release readiness](../v2-marketplace/weth-release-readiness.md).

Server-injected callbacks and disposable PASS fixtures are staging seams, not evidence of those production requirements. Public marketplace readiness remains BLOCKED regardless of the clean P0/P1 finding in this bounded code review. Bankr remains disabled; this delta grants no broader autonomous execution.

One additional navigation requirement must be included in public purchase acceptance: the backend supports original-owner recovery after a Punk transfer, but the current main-page scope comes only from `state.selected`, and `applyOwnedPunks` selects only current verified holdings (`site/broker-v2.js` lines 2081–2084). After an actual transfer removes that Punk from the original owner's roster, the mounted panel has no former-Punk history selection path. A future history/recovery affordance must retain original-owner authentication without granting the former owner current-Punk execution authority. This does not alter the dormant null-release mount's safety verdict and is separate from CFR-01's session-expiry correction.

## Source hashes

SHA-256 of the reviewed source. The corrected panel and mounted callback hashes are from the final checkpoint; other listed implementation files retain their reviewed initial hashes.

| File | SHA-256 |
| --- | --- |
| `netlify.toml` | `94913d38ddc52b27f5bb3c31e138b446f01d0435f9cdc1e9509bae1037857d1d` |
| `broker/src/v4/skill-forge/capability-resolver.mjs` | `881d7187ba1e879705a57d91b7f089df7d9e45a792321b158a7a43af45308ede` |
| `broker/src/v4/skill-forge/research-runtime.mjs` | `7745ed13725052c1942064dc36a8c2afc2eababbfa41e0ca73300c4e8a3e2720` |
| `netlify/functions/broker-v2-forge.mjs` | `2b8f5ccfca24e24a31079735a84c39cb7962bfe768487385367292641e6d6b31` |
| `netlify/functions/broker-v2-forge-skill.mjs` | `6a2212eb01685bada619fc7d94cc3368f98dfc07f60303372dba69b60be9896f` |
| `netlify/functions/_shared/v2-mcp-research.mjs` | `244b5e45922a55c8207042028d31cc6d7600ba9242e80e8f19b9c0b213707753` |
| `broker/src/v4/marketplace/durable-coordinator.mjs` | `108b0b1412e20da6bd2a3677fcd313ad3bbdcbf36ee6c3654d826129c645cef9` |
| `broker/src/v4/marketplace/durable-journal.mjs` | `ac50c55d1e21f83c4d8f10784edf58f66b1531f4035bc7a56ae20dc0855087d4` |
| `broker/src/v4/marketplace/postgres-journal-store.mjs` | `0bb7adbfc3774fa67d7b605e53fe33e0ed9e82e1573915872d9b58943137a25e` |
| `broker/src/v4/marketplace/durable-release.mjs` | `2a74dcc4585bb1085e401b1fcf2da10db34ebafdd13531561621c3e2b11e49ae` |
| `broker/src/v4/marketplace/opensea-signed-listings.mjs` | `2a484f1bc8a2db7cde3a7e9798c5c4ecc8d2ac449d02a3f26e595129876cd81c` |
| `broker/src/v4/marketplace/opensea-fulfillment-listings.mjs` | `6af2318aba8af78847a0d6f8745178693ae48fd54441ca7101a1b42d14db271b` |
| `broker/src/v4/marketplace/reconcile.mjs` | `d75b64bee6eff9930a48a800f8ace057cd0ee0aca8ab8e0e73dab4c2d140d4a0` |
| `netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql` | `4d58b49eec63e95344a12e5777655802f94a8fedcdb7946ecccfe737575de31d` |
| `netlify/functions/_shared/marketplace-runtime.mjs` | `12bd903662df1a0cc445b4f29cb760527efc589d62ce5cac95eb3d23411eedd6` |
| `netlify/functions/broker-v2-marketplace.mjs` | `13f73128b46e2277de2dbc3465691c5d3877be77212c3fd1120b75fe7932fb96` |
| `client/marketplace-wallet-codec.js` | `6635d4a82dd97338bca4efaa67586995f1a674bc085b04b538449b48aa4df737` |
| `site/marketplace-wallet-codec.js` | `aee72b693dfd0039a0aa7b10dc78948ac4e23b03277b211138cf620fc5a1e584` |
| `site/marketplace-wallet.js` | `ff2fbdd7adaff36f5468526a4545f57154538f29eaf532ff94fe2cb42b0320f2` |
| `site/marketplace-purchase-panel.js` | `d29ff4c2591527ec94da5e379c9ec65bc8ede1e5f2fed4828494973d2ffc0cc0` |
| `site/broker-v2.js` | `20983cd0c36aeac86fa041a465f44213fe85decb6a1a19da0b372a372eb39279` |
| `site/forge-research-actions.js` | `bc6f4828f877753c1183b1e9adc7d01f5843e1b247a71ff27eba3293c4cda4e2` |
| `site/forge-durable-training-panel.js` | `88078a691e7dc7763afa52d47447d2911c4a174a0c7dcbc89cce2d962c47c46d` |
| `tests/continuation-final-security.test.mjs` | `36b7a555ae197c81ec1de1df77dc668dcb2caf76e95fa04a2c0ec6895fe41fb8` |
