# Gogh Punks Art Broker V2 — final hardening report

Date: September 13, 2026. Lead integration branch: `v2/final-hardening-20260913`; release PR [#65](https://github.com/riffsmon-bit/gogh-punks-website/pull/65). The original user checkout and existing practice sessions were preserved.

## 1. Final verdict

**FINAL_TESTING_READY — controlled final testing.** The integrated software, independent reviews and controlled journeys passed the gates below. This is readiness for holder end-to-end testing, not authorization for production financial actions. Production cutover and its read-only acceptance are recorded separately after publication.

## 2–25. Product and integration results

| # | Area | Result and evidence |
|---|---|---|
| 2 | Product audit | Existing architecture retained. The [baseline audit](product-audit.md), [39-gate acceptance matrix](acceptance-matrix.md) and [status ledger](status.md) separate working features, fixes, unsupported scope and proof limits. |
| 3 | User journeys | Owner-scoped optional welcome, progressive selection, meaningful empty/error states, preserved retry text, original-hash recovery and exact review amounts. No funding required to explore. |
| 4 | Performance before/after | Collection previously timed out and hid the paid delivery; actual production response now returns 34 verified holdings including #1599 in 4,114ms. Complete MCP roster: 140 owned Punks, zero hints, 35 reads, four concurrent requests, 1,743ms. [Measurements and limits](performance-audit.md). |
| 5 | Load time | Parallel bounded collection sources; optional metadata; artwork cache and request coalescing; balances no longer block NFTs; bounded MCP batching; reused AI registry initialization. Real API p95 and native-device timings remain unmeasured. |
| 6 | Chat | Actual selected provider reaches the server; explicit choice stays pinned; AUTO can fall back. Late owner/Punk replies are ignored, failed text restored, mode controls collapsed and mobile composer prioritized. Strategy confirmations preserve even one-wei limits. New contract cards show useful observed details without claiming safety or simulation passed. |
| 7 | AI providers | Gemini, GPT, Claude and Grok passed real fixed conversation and structured-output probes on the preview; runtime database privileges passed. Their reviewed configuration is prepared for production. Bankr is explicitly unavailable because no reviewed credential/funded gateway configuration exists. [Provider evidence](provider-live-checks.json), [AI review](ai-review.md). |
| 8 | Wallet | Canonical V3 Punk Wallet and separate Agent custody retained. Owner-funded Agent gas no longer requires an active unrelated V3 wallet. Fresh owner, chain, runtime, exact transaction and nonce checks remain. Current-owner reserve query rejects seller/expired/other-wallet rules. |
| 9 | Withdraw | Existing V3 recovery retained. Agent ETH, gas deposit and standard NFT recovery have reviewed exact destination/amount, continuity, confirmation and durable hash recovery. No withdrawal was sent by this hardening phase. General Agent ERC20 and complete legacy inventory UI remain unsupported. |
| 10 | Burn mechanism | Complete deployed-stack copy journey passed on owned Anvil/native PostgreSQL. Two copied sources each produce one credit; supply falls exactly once per burn. The originals remain intact. [Composed evidence](forge-journey-evidence.json). |
| 11 | Burn safety | Twenty-four explicit asset/state guard cases reject sacrifice. Unknown inventory is not empty. Strong source/recipient acknowledgment, stale state, duplicate, timeout and recovery handling retained. Live clearance is not certified: the composed test mocks inventory prerequisites and both receipt clients share one owned node. |
| 12 | Training Credit | Exactly one credit per burn; duplicate claim/reconciliation cannot add another. Learning spends one; slot unlocking needs its own credit. |
| 13 | Skill Registry | Existing deployed registry/progression/source and immutable release hashes verified. No Solidity, deployment manifest, ownership semantics or package v1 pin changed. |
| 14 | Real skills | Rarity Eye v1 has actual learned/equipped research proof through the server bridge using three real copied metadata records. Contract Detective remains a controlled read-only lab check. Reviewed Market Scout v2 is connected to the controlled lab with exact string prices, identity, expiry and coverage checks; it is not promoted to a learned production skill. Remaining catalog skills are not falsely labeled released. |
| 15 | Loadout | Learn/equip/unequip, locked/empty slots and distinct learned/equipped meanings work. Unequipping blocks the actual research call; re-equipping restores it. Skills provide no purchase authority. |
| 16 | Transfer persistence | The copied Punk retains skills, slots, loadout, Wallet/Agent addresses and #1599 custody. Seller training/research and prior worker continuity fail; buyer fresh reviews succeed; automation stays paused. Existing away-and-back session semantics are unchanged, so broad autonomy remains blocked. |
| 17 | Discovery | Existing shared SeaDrop pipeline, provenance/deduplication and monotonic persistence retained. No per-Punk scanner added. Current lack of an eligible free mint is a valid result, not a failed mint or permission to relax policy. |
| 18 | Link scanner | Production, preview and MCP use the same bounded Robinhood contract resolver. Real Peppies public mint state observed; Gogh correctly reports unsupported mint mechanism. Fixed server RPC, read-method allowlist, byte/request/deadline caps, redirects/CCIP disabled and canonical anchor rechecked. Other websites remain explicit unresolved links. [Source and live evidence](../v2-swarm/fixed-source-link-inspection.md). |
| 19 | Security screen | Reviewed adapter/selector/recipient/chain/hazard gates retained. Contract-interface observations do not claim full security clearance. Unknown effects fail closed. |
| 20 | Simulation | Existing exact funding, withdrawal, supported mint and training simulations remain mandatory in their execution paths. Link observations and stored MCP simulation evidence are never labeled fresh successful simulations. |
| 21 | Policy | Deterministic owner/mode/skill/budget/reserve/risk/adapter checks remain authoritative. AI intent cannot bypass them. Exact decimal amounts are validated before review/confirmation. |
| 22 | Execution | Existing bounded free and selected paid lanes retain leases, nonce/immutable-envelope checks, signed-byte retention, receipt reconciliation and idempotency. #93’s owner-authorized Peppies #1599 mint completed; no replacement was sent. Floor sweep/WETH bid execution and arbitrary paid collections remain unavailable. |
| 23 | Mobile | Independent 320/375/430/768/1280/1440 browser review: readable 16px fields, large recovery/link controls, contained exact values, mobile roster/navigation/composer and no final horizontal overflow. Native wallet app handoff remains a holder test. |
| 24 | UI review | Independent reviewer accepted 25 scenarios and 59 screenshots, with all 74 captured site hashes matching the candidate. No P0/P1/P2 findings remain in that scope. [Review](final-ux-qa.md). |
| 25 | Database | No schema migration or destructive V1 edit. Atomic quota reservation/CAS uses existing tables and native PostgreSQL concurrency proof. Live inspection found no PUBLIC/anon/authenticated grants on six private tables; actual function role passed all six AI usage/registry privileges. Read-only inspection role remains intentionally separate. [Evidence](database-readonly.json). |

## 26. Test results

- Full JavaScript suite: **2,435 passed, zero failures**, 219.7s. The supplemental final security file was integrated afterward and is covered by the independent 39-test gate below.
- Deployment/build gate: **140 passed**, including selected-domain TypeScript, wallet bundle, site/link/asset/secret checks and repository syntax checks. Netlify preview `6aa6f6103d9e95000889f159` passed the final candidate gate at `782247e`.
- Contracts: **284 passed across 27 suites**. No Solidity or manifest change in this hardening phase.
- Independent security: **39 passed** across three review files. These overlap the main suite; counts are not additive unique coverage.
- Final route/Forge/roster integration: **40 passed**; exact link display unit cases: **3 passed**.
- Independent actual-browser UI: **25 scenarios, 59 screenshots**, no browser errors, external requests, real wallet calls or public transactions.
- Composed Forge: **45.4s**, 16 owned-fork transactions, eight settled training operations, one expired review and 24 asset/state rejection cases; **zero public transactions**.
- Wallet/reserve: **145 targeted tests**, including actual PostgreSQL-compatible SQL execution. AI: **85 targeted JS tests and 24 native PostgreSQL assertions**, including concurrency/restart/role cases.

Fixtures, public observations, production receipts and live service probes are identified separately in linked evidence. No result establishes perfect safety, all-token inventory completeness or real-device mobile acceptance.

## 27. Security review

Fresh reviewer, separate from implementation: **PASS FOR CONTROLLED FINAL TESTING**. Final review accepts wallet recovery, atomic quota/provider bindings, delegated-owner continuity, MCP roster, read-only market lab, bounded link resolver and display guards. [Full review and limitations](final-security-review.md).

## 28. Open bugs and limits

One P3 remains: the decorative budget meter can retain its cached width after amounts become unavailable; numeric balance/reserve/budget labels correctly become unknown and execution performs fresh checks. No release-blocking P2 remains in the reviewed UI.

Explicit supported-scope limits: Bankr credential absent; generic website resolution and fresh link simulation not provided; Market Scout v2 unpromoted; not all ten Forge packages accepted; no floor sweeps or WETH bids; no general Agent ERC20 recovery; no complete nonstandard/legacy/off-chain inventory; no physical-device wallet handoff proof. These features must stay unavailable or explicitly bounded in the UI.

## 29–30. Remaining critical issues

- **P0: 0 demonstrated unresolved defects in the reviewed controlled-testing scope.**
- **P1: 0 demonstrated unresolved defects in that scope**, after the link-resolver and previously reported wallet/chat/collection/Forge defects were fixed and retested. Final deployment acceptance is tracked separately until completed.

## 31. Production actions still requiring owner authorization

A real burn; financial refund or withdrawal; a new paid purchase or sweep; new skill/package registration or release expansion; unreviewed wallet modules; broader autonomous execution; changed ownership semantics. This phase performed none of these. Model configuration and reversible site/function deployment do not expand wallet authority.

## Swarm and integration record

The lead coordinated independent specialists for baseline audit/artwork, collection repair, wallet, AI, Forge composition, Market/MCP, link inspection, fresh security, fresh UX/mobile/performance and acceptance documentation. At most three specialists ran beside the lead. Earlier architecture, shared contracts, V1 and execution work was reused.

Scoped worktrees: `/private/tmp/gogh-hardening-wallet`, `gogh-hardening-ai`, `gogh-hardening-forge`, `gogh-hardening-market-mcp`, `gogh-hardening-link-resolver`, `gogh-hardening-security-review`, `gogh-hardening-ux-qa`, `gogh-hardening-acceptance-guide`. Branch/commit ownership is in [status](status.md). Feature branches integrated only after diff/interface/security review and targeted evidence.

Rejected approaches included silently replacing explicit provider choices, weakening historical verification to work around Anvil snapshots, promoting unreviewed marketplace packages, treating an index as complete ownership, displaying failed reads as zero, and accepting compilation as journey proof. Compatible narrow corrections were integrated; no conflicting subsystem rewrite was merged.

User entry points: [Art Broker](https://goghpunks.xyz/broker/v2/), [public test guide](https://goghpunks.xyz/broker/v2/test-guide/), [complete holder guide](testing-guide.md).
