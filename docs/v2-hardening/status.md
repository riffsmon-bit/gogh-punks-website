# Final product hardening

Current verdict: **NOT_READY**. Audits and evidence, not compilation alone, determine readiness. This phase continues the existing reviewed architecture and the active production display repair. No production burn, fund movement, refund, sweep or expanded autonomous authority is authorized by this phase.

Integration checkout: `/private/tmp/gogh-punk93-mint-stall`, branch `v2/swarm-integration-20260913`. User checkout is protected. Maximum three concurrent specialists beside the lead. Existing production: `a044582`; broader reviewed swarm candidate: `4f9e450` before current display work.

| Specialist | Status | Owned files | Dependencies / next gate |
|---|---|---|---|
| Product/performance audit (`free_rpc_research`) | RUNNING | `docs/v2-hardening/product-audit.md`, `performance-audit.md` | Inspect actual source and prior evidence; classify every requested subsystem and journeys |
| Artwork specialist (`free_rpc_research`, completed scope) | READY_FOR_REVIEW | `broker-punk-artwork.mjs`, `_shared/original-punk-artwork.mjs`, dedicated tests | Adopted locally; independent security and browser review pending |
| Collection performance (`security_review`, completed scope) | READY_FOR_REVIEW | `broker-v2-collection.mjs`, `_shared/v2-collection-{holdings,discovery}.mjs`, dedicated tests | Adopted locally; lead review, live read-only shadow, independent QA pending |
| Display security (`security_review`) | RUNNING | New dedicated review/test evidence only | Review artwork and root frontend, which this reviewer did not implement |
| Display UX/mobile QA (`ux_review`) | RUNNING | New collection browser harness and review docs | Actual integration source at desktop, tablet and mobile; no frontend edits |
| Lead integration/frontend | RUNNING | `site/broker-v2.{js,css}`, V2 HTML, neutral artwork, frontend tests, trackers | Review/adopt compatible specialist files, request fencing, loading/error/refresh and metadata hydration |

Remaining waves are assigned only after the product audit identifies concrete gaps. Each wave must finish its bug loop and targeted verification. Fresh final reviewers will be separate from feature implementers. Previous contract/fork/SQL evidence is retained only where implementation and fixtures remain applicable; composed journeys and live provider checks require their own proof.

Known active priorities:

- P1: production Collection timeout hides paid delivery #1599; bounded parallel source and live custody fix under review.
- P2: 20 live-owned Punk IDs absent from artwork index; progressive fixed-collection artwork lookup under review.
- P2: gallery error/loading shown as an NFT; replace with text and explicit retry, stale response fencing.
- Audit finding: provider selector is currently cosmetic; finish real selected routing and honest live availability.
- Audit finding: provider quota check requires concurrency review.
- Audit finding: MCP owned-Punk list uses indexed candidates and sequential verification.
- Acceptance gap: composed controlled burn → credit → learn → equip → transfer journey and fresh final QA.

## Audit complete; second wave active

The product/performance audits are frozen at the starting baseline. New implementation owners:

| Specialist | Status | Branch/worktree | Owned scope |
|---|---|---|---|
| AI / quota | RUNNING | `v2/hardening-ai-20260913`, `/private/tmp/gogh-hardening-ai` | Existing AI adapters/router/runtime, chat preference/probe endpoints, AI-only tests/docs. No frontend. |
| Forge composed journey | RUNNING | `v2/hardening-forge-journey-20260913`, `/private/tmp/gogh-hardening-forge` | New disposable integration harness and evidence; report business-code defects before editing. |
| Wallet funding | RUNNING | `v2/hardening-wallet-20260913`, `/private/tmp/gogh-hardening-wallet` | Agent gas funding module, current-owner reserve endpoint, dedicated tests/docs. Parent coordinates main UI caller. |
| Lead | RUNNING | Main integration | Display release, provider preference UI, onboarding/chat presentation, integration and final validation. |

Interface decisions: optional `providerPreference` is exactly AUTO/GEMINI/OPENAI/ANTHROPIC/XAI/BANKR and affects inference only. AI reservations use existing usage rows, an owner advisory transaction lock and a terminal update; uncertain attempts remain counted for the quota window. No schema migration proposed. Grok gateway transport must be explicit and server configured, preserving XAI identity and fixed credential/origin binding.

Display evidence: 140 live-owned Punks, 20 absent from indexed artwork. Canonical image helper returns six distinct missing images in 1,733 ms. Read-only collection shadow verifies #1599 in 1,614/1,165 ms on two providers, with session/alternate database limitations explicitly recorded. Independent browser review passed 14 scenarios at 1440/375/320, including actual canonical artwork, token ID visibility, delayed responses and one sign-in. Scoped security review passed ten independent proofs. Deployment gate passed 140/140. Final full JavaScript suite passed 2,238/2,238 in 276.8 seconds after the existing sign-in test fixture included the new shared in-flight map; all original authentication behavior and the new concurrent-sign-in regression pass.
