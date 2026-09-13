# Art Broker V2 performance audit

Audit date: September 13, 2026. Baseline: integration `4f9e450`. Owner: `/root/free_rpc_research`. Source inspection and existing measured artifacts only; no load test, production mutation, provider subscription change or financial action was performed for this audit.

## Measured baselines and their limits

| Measurement | Observed result | Method / evidence | What it does not establish |
|---|---|---|---|
| Complete browser-owned scan | 140 owned NFTs in **2.094 s** | Lead's production read-only ownership investigation supplied to this audit. Canonical bounded ownerOf scan, not a metadata-derived list. | One observed run; no p50/p95, cold/warm split, mobile device or network sample. |
| Indexed owner roster | **123 candidate hints**, HTTP 200 in **2.155 s** | Lead's live indexed endpoint capture: `/private/tmp/gogh-display-roster-before.json`. All returned candidate cards had cached art. | Candidate count is not verified owned count. Lead found **20 verified-owned IDs missing artwork**; do not derive that figure by subtracting 123 from 140. |
| New original-artwork helper/endpoint, cold | Six missing IDs resolved in **1.733 s** | `/private/tmp/gogh-original-punk-artwork-live.json`; Blockmachine public RPC, fixed original collection, real tokenURI JSON/SVG. Each image 17,354 characters; six distinct hashes. | Local invocation against public RPC, not a deployed Netlify endpoint or browser render measurement. |
| Same artwork helper, warm | **3 ms** | Same in-process enrichment cache; no repeated metadata RPC reads. | Serverless cold starts and different instances do not share that memory cache. |
| Six-image content volume | **104,124 image characters**, plus a small JSON envelope | Actual canonical SVG data URI lengths in the live helper report. | Browser decoded image memory, compressed transfer bytes and paint cost were not measured. |
| Selected production paid delivery | **42 s** authorization→mint | Owner authorization at 16:57:35 UTC; mint at 16:58:17 UTC, [receipt evidence](../v2-swarm/paid-mint-delivery-1599.json). | Not end-to-end UI success latency. Application completion was delayed by a receipt mismatch. |
| Paid journal completion after mint | About **19 min 51 s** after the mint | Mint 16:58:17 UTC; scheduled worker completed reconciliation at 17:18:08.117 UTC after diagnostics deployment. | The original failing comparison was never captured. Do not assign this duration to a proven RPC/provider defect or treat it as normal queue latency. |
| Latest full integrated JavaScript gate | **2,198 passed; 179.093 s** | `validation-results.json` → `paidReceiptFollowup.javascript`. | Local test runtime is not service throughput or a production SLO. |
| Prior controlled browser sweep | 24 screenshots at 1440/768/375/320; no runtime errors, external calls or wallet requests | [UX review](../v2-swarm/ux-review.md), `/private/tmp/gogh-v2-swarm-ux-fixed/report.json`. | Viewport emulation and mocked panels; no real provider, wallet-modal or mobile performance evidence. |

The two artwork measurements belong to the prepared `fix/collection-roster-display` worktree, not the audited integrated source. Mark them as candidate evidence until parent integration and deployment checks succeed. No new benchmark was run merely to make this document appear current.

## Critical paths found in source

### Ownership and roster

`broker-owner-punks.mjs` uses one indexed SQL read, parallel enrollment/agent-summary reads and a V3 wallet-created Multicall in the indexed path. Complete server reconciliation can invoke OpenSea pages, candidate verification and, when balanceOf differs, scan up to 5,017 token IDs in 200-token chunks with four workers. Browser ownership checking remains independent and must stay so.

The observed artwork defect is a coverage join problem: fast indexed decoration does not cover every ID the browser later proves owned. Faster SQL alone would not supply those missing images. The prepared public artwork endpoint accepts at most 32 fixed-collection token IDs, reads only embedded metadata, uses concurrency eight and short per-read deadlines, retains positive/negative cache entries and deduplicates in-flight work. Parent should request missing images asynchronously after live ownership verification, preserve current selection/focus, and ignore late responses after owner/network changes.

Do not load all original SVGs before showing a usable roster. Twenty observed missing images total roughly 347 KB of data URI text at the measured image size; this is bounded but still worth deferring until ownership is known. Measure compressed bytes, render duration and image decode separately before selecting a permanent cache or packaging strategy.

### Collection and metadata

At `4f9e450`, `broker-v2-collection.mjs` performs:

1. Session and current-owner authority reads, including block/owner/registry/code/balance.
2. Acquisition-history SQL.
3. Agent account resolution.
4. `buildWithdrawableNftAssets`, which can perform its own DB, RPC, portfolio and metadata work.
5. Selected-paid history.
6. Agent OpenSea portfolio lookup.
7. Live candidate custody checks, then missing image reads.

`_shared/v2-collection-holdings.mjs` caps 128 candidates but processes them in groups of four. Within each item, custody and metadata are sequential; a slow image can hold a whole batch before the next four custody checks begin. The collection RPC client uses an 8-second timeout with one retry. Withdrawal inventory RPC configuration uses 10 seconds and two retries, and its metadata reader can try two IPFS gateways per URI. These are source-level upper-bound risks, not measured 100-second production latency claims.

The existing separate collection release candidate should own the correction: share a bounded discovery/custody budget, distinguish source availability from verified holdings, prioritize confirmed paid candidates, and let optional metadata fail independently. Do not skip custody verification, merge different custody accounts into one identity, change ownership semantics or claim a complete inventory from a bounded list.

### Chat and provider routing

`broker-v2-chat.mjs` reads authority, active owner strategy and eight recent conversation messages before target resolution/provider work. It then opens a DB transaction, obtains a per-Punk advisory lock, rereads authority and transfer history, and persists the answer/draft. Keeping provider network time outside the transaction is useful; the later RPC continuity check still holds the transaction while it runs.

`providerJsonRequest` defaults to a 20-second provider deadline. The router tries retryable failures sequentially across enabled candidates without one overall request deadline. Five default-deadline failures could approach 100 seconds before DB/authority overhead; this is a calculation from source, not an observed run. Registry supports a larger configured entry set, so policy needs a bounded total budget rather than depending on today's provider count. Preserve terminal behavior for malformed/incomplete successful output; do not add silent repeated paid generations to meet a latency target.

`createDatabaseBackedGoghIntelligence` creates a fresh registry/runtime per request. Usage recording upserts each enabled registry entry on the runtime's first record, then inserts usage. Thus configuration metadata writes can recur on every chat request. Quota `consume` scans recent usage with aggregate FILTERs and is not an atomic reservation; this is both a concurrency correctness issue and a scaling concern. The current recent-usage index is `(occurred_at DESC, provider, task)`, not an owner/Punk-specific access path. Establish an actual query plan/cardinality before proposing an index; use exact accounting rather than caching an unenforced quota decision.

No authenticated chat/provider p50/p95, full fallback timing, quota contention timing or production query plan was retained in the reviewed evidence. Unknown token/cost usage must not be converted to zero.

### MCP and research

`broker-v2-mcp.mjs` `getMyPunks` selects indexed IDs and awaits full authority reads serially for up to 256 rows. At six underlying reads per full authority resolution, this can be expensive even when each RPC is fast. The same result remains incomplete for nonindexed owned IDs. Reuse the bounded owner discovery/authority interface, expose coverage, and test concurrency/deadline behavior; do not parallelize 256 unbounded full profiles.

The MCP simulation and cost tools presently read stored evidence. Improving their latency cannot make that evidence fresh. An accepted live-simulation tool requires a separate truthful contract and budget.

Forge research also performs fresh progression/owner checks before and after a bounded provider call. These checks are necessary capability/authority boundaries. Avoid global caching of positive owner/equipped authority across transfers; cache immutable packages or display metadata instead.

### Worker, archive reads and receipt visibility

The selected paid lane uses two archive providers and 2,000-block pages across its full inclusive 20,001-block readiness window. Per provider, this means eleven log pages, plus chain/block/code/owner reads. Pagination must preserve complete coverage and propagate every page failure. Worker continuity has separate exact receipt/head checks. Removing those requests to improve speed would change the safety contract.

The first live paid delivery was timely; its UI-visible final state was delayed by reconciliation. A receipt mismatch should surface a stable diagnostic and preserve signed bytes, not induce a replacement transaction. Track authorizing, submitted, mined, receipt-verifying and application-completed timestamps separately. Existing fixed first-mismatch labels/provider index can diagnose recurrence without logging secrets or raw signed payloads.

The public secondary RPC has a documented free-service limit and no independently proven upstream diversity/SLA. The authenticated primary's 2,000-block log cap is an observed compatibility fact. Existing successful readiness is not a guarantee against future rate limiting; measure sanitized failure categories and duration rather than adding blind retries.

## Prioritized performance work and ownership

| Priority | Task / owner | Required evidence before acceptance |
|---|---|---|
| P1 | Parent + display specialists: finish roster/collection candidate | Same 140-owned scenario, indexed/nonindexed artwork coverage, selected #1599 current custody, page remains interactive while metadata is pending, no stale-owner image application, source failures labeled honestly. |
| P1 | AI/data specialist: atomic quota and bounded request budget | Real disposable SQL contention tests, reservation/fallback/failure accounting, no count-then-spend race, bounded deadline and unchanged authority/parser behavior. |
| P1 | Parent + execution reviewer: receipt-state visibility | Saved mint success across reload; exact transaction retained; missing/mismatched provider response never causes duplicate mint or a new budget prompt. |
| P2 | MCP specialist: bounded complete roster reads | Explicit coverage and timeout semantics, nonindexed ownership fixture, capped concurrent RPCs, no full-profile N+1 scan. |
| P2 | Data specialist: read-only production query/grant audit | Sanitized query identifiers, actual plans/cardinality and role boundaries; migrations only if demonstrated necessary and separately reviewed. |
| P2 | Parent/UX: real device and cold-load measurement | Wallet-connected Chrome plus at least one intended mobile-wallet browser; record cold/warm, response/paint and failures. Controlled desktop screenshots do not substitute. |
| P2 | AI specialist: registry write amortization | Registry configuration versioning/one-time initialization evidence, safe concurrent startup, no loss of usage rows or quota enforcement. |

## Proposed acceptance budgets, not measured promises

Agree these as engineering targets before claiming them publicly:

- A usable verified roster should not wait for every image. Target the observed small number of seconds for ownership, then progressively fill artwork. Record cold and warm cases rather than promising the 2.094-second sample universally.
- Artwork endpoint should finish within its configured worst-case read bound (about 10 seconds for 32 reads in four waves plus chain check); normal six-image behavior should remain near the observed 1.733-second sample. Browser metadata failure must not disable ownership or selection.
- Selected Collection should return useful bounded verified candidates or an explicit retryable unavailable result within a parent-approved overall budget (15 seconds proposed). Optional metadata must not consume that entire budget before custody evidence is returned.
- Chat should have one total server budget compatible with the actual configured function timeout. Record provider time, quota/usage DB time, authority/continuity time and persistence separately before choosing a numerical p95 target.
- A minted NFT should be visibly marked as submitted/mined/awaiting verification without waiting for application completion to pretend no progress occurred. Persistent reconciliation exceptions need an operational signal; they must never trigger automatic duplicate spending.

## Measurement plan for the next wave

Use a bounded set of fixtures: no-Punk owner, one fresh Punk, the observed 140-Punk owner, a nonindexed acquired Punk, a transferred-away Punk, empty/partial NFT holdings, the confirmed #1599 paid result, one unavailable metadata source and one unavailable RPC. Use local fixtures for mutations and failure injection. Production checks stay read-only unless a separately reviewed owner action is explicitly authorized.

Collect a small predeclared sample of cold/warm runs and report count, median, p95 only when the sample supports it, maximum, errors and cache state. Record request correlation IDs, fixed phase labels, durations, candidate/verified counts and sanitized provider status. Do not record keys, authenticated URLs, raw signed transactions, wallet signatures or private chat text. Do not run an unbounded benchmark against free public RPCs.

Preserve baseline artifacts and compare the exact same workload after integration. One successful response or an all-green unit suite cannot establish production latency, inventory completeness or long-term provider reliability.

## Measured hardening results — September 13

The baseline above is preserved. These results supersede its specific pending repairs.

| Path | Before | After / evidence |
|---|---|---|
| #93 Collection | User-visible timeout; paid delivery hidden | Real authenticated production response: 34 verified holdings including #1599, 4,114ms, no unavailable discovery sources. The older timeout has no reliable numeric baseline. |
| Missing original artwork | 20 live-owned IDs absent from the artwork index | Fixed-collection on-chain enrichment: six distinct missing images in 1,733ms cold, 3ms same-process warm. Browser display remains progressive and owner-fenced. |
| MCP owned roster | Up to 256 indexed rows; serial full authority/profile reads | 140 live-owned Punks with zero index hints in 1,743ms, 35 RPC reads, max concurrency 4. Registry/chain/anchor retained; request budget 12s. Existing archive configuration is preferred for this read-only path. |
| Chat provider timeout | Independent 20s attempts could accumulate across fallback | 20s overall budget, 10s attempt cap, aborted HTTP and atomic quota reservation. These are enforced bounds, not measured normal reply times. |
| Live fixed provider checks | Only prior Gemini runtime verified | Gemini 3,301ms; GPT 3,498ms; Claude 2,254ms; Grok 3,020ms on preview, each including actual structured and conversational probes. These are individual checks, not API p95 or first-token measurements. |
| ETH/WETH display | Production WETH stayed checking; failed refresh retained native display | Independent coalesced balances with 10s bound, explicit unavailable state and retry; NFT loading does not wait. Browser tests prove one pending read is shared between Fund and Collection. |
| Small-phone interactions | Crowded pre-chat controls, recovery field and intrinsic-width forms | Native disclosure for mode controls; quick calls follow composer; 48px recovery/link controls; 16px inputs; minmax grids; exact values wrap. Independent six-width screenshots verify no overflow. |

Live production API p95 and real mobile first-token/wallet-handoff times remain unmeasured. The browser report records synthetic shell/panel timings and source hashes; these must not be represented as production network performance. No new database index was justified by the inspected low-volume usage tables; atomic owner quota locks and cached registry initialization address the demonstrated correctness and duplicate-write issue without a migration.

## Published-route follow-up

At 19:26 UTC, the existing authenticated holder session checked the published `61cb6a9` release: complete roster 140 in 2,800ms; Collection 34/#1599 in 6,991ms; fund 5,353ms; supported link 2,657ms; owner-gated Market v2 lab 14,136ms. All returned HTTP 200. These were five different routes under concurrent read load, one sample each; no population p95 is claimed. The slower optional research route remains a performance watch item, distinct from the repaired Collection timeout. Nine static source responses matched local hashes in 314–490ms. [Evidence](release-acceptance.json).
