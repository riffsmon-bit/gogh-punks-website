# Netlify V2 release plan

Status: **NOT READY FOR PUBLIC RELEASE**

Basis: `origin/main` at `b442b4425bf21b16d5186ed76333e2c42d3a6121`, audited locally on
2026-09-21. The public Netlify site responds successfully, but the V2 production data path and
transaction-capable features are still gated.

Local checks completed on this release branch: the Netlify deploy gate passed **140/140** targeted
browser/wallet tests, the broker manifest check passed, and the V2-focused suite passed **63/63**.
The extended 3,024-test run reached **2,999 passed / 25 failed** because this clean checkout lacks
the generated Foundry Skill Forge artifacts required by its browser harness; that artifact build
must pass before a final release claim.

## What is already implemented

The repository contains the V2 control center, wallet connection and ownership checks, Punk Wallet
funding/withdrawal surfaces, chat/provider routing, strategy validation, link inspection, shared
opportunity normalization, deterministic policy matching, simulation evidence, ASK recommendations,
ASSIST transaction preparation, activity/collection views, and Skill Forge review flows. The targeted
V2 suite and broker manifest check pass locally when dependencies and contract artifacts are present.

## Release gates

| Area | Current state | Required before public release |
| --- | --- | --- |
| Static site/functions | Implemented | Netlify deploy from a clean release commit and smoke test |
| V2 database | Migration files present, production application not evidenced | Apply additive migrations to a review database, validate RLS/indexes, then production |
| Chat | Implemented with provider fallbacks | Validate the configured production provider and quotas; keep secrets server-side |
| ASK | Closest to release | Review with a connected holder wallet and verify live reads |
| ASSIST | Preparation path implemented | One reviewed adapter must pass live simulation and owner wallet confirmation |
| AUTONOMOUS | Intentionally fail-closed | Separate Punk Agent Account/bundler/session-key canary and receipt reconciliation |
| Discovery | Local/shared pipeline implemented | Configure and monitor a bounded production feed before enabling ingestion |
| Skill Forge | Review/test flows present | Complete artifact-backed Forge validation and one controlled test-mode journey |
| Paid mints/floor sweeps/WETH bids | Not public-live | Marketplace contracts, transfer-epoch invalidation, spend/reserve controls, and security review |
| Mobile/accessibility | Implemented and locally reviewed | Physical-device wallet and screen-reader canary |

## Recommended release sequence

1. **Review build (1–2 days):** apply migrations to a non-production database, configure one low-cost
   chat provider, deploy one Netlify preview, and run connected-wallet smoke tests.
2. **ASK holder release (1–2 additional days):** validate ownership, wallet, collection, chat,
   strategy, link inspection, Contract Detective, Rarity Eye, and Market Scout with read-only data.
3. **ASSIST canary (3–5 additional days):** finish one reviewed adapter/simulator path, require the
   owner wallet confirmation, reconcile receipts, and test failure/retry behavior.
4. **Forge controlled release (2–4 additional days):** validate burn safety, one Training Credit,
   skill learning/equip persistence, and refresh/ownership-transfer recovery. No production Punk burn
   is part of this estimate.
5. **Autonomous and marketplace release (2–4 weeks after the above):** deploy and verify the bounded
   agent account, bundler/session signer, free-mint canary, then separately review paid purchases,
   floor sweeps, and WETH bids. These cannot be compressed into a static-site deployment.

## Estimate

The first useful public V2 release (ASK plus read-only holder features) is approximately **3–5
working days after owner-provided Netlify/database access and a controlled preview authorization**.
ASSIST and a controlled Forge release are approximately **1–2 weeks total**. A genuinely public
release that includes autonomous execution, paid marketplace purchases, floor sweeps, and WETH bids
is approximately **3–5 weeks**, subject to contract/bundler review and live canary results.

These are engineering estimates, not promises. The largest external dependencies are the hosted
database migration, production secrets/provider quotas, Netlify preview access, and owner wallet
confirmation for any irreversible action.

## Explicitly held back

No production burn, paid mint, floor sweep, WETH bid, autonomous signer, or unrestricted wallet
authority should be enabled by a Netlify deploy. The UI must continue to show these as gated until
their specific backend, policy, simulation, and receipt checks are live.
