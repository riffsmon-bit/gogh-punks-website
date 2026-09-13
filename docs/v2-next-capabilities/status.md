# Remaining V2 capabilities — September 13, 2026

Base: published hardening and evidence at `fe655155`. Lead branch: `v2/remaining-capabilities-20260913`; integration checkout `/private/tmp/gogh-punk93-mint-stall`. The original user checkout remains untouched.

The user requested continued implementation of burn/training, remaining skills, Bankr, floor sweeps, WETH bids and the cosmetic budget-meter issue. This is a new capability expansion; the preceding controlled-testing verdict does not certify these additions.

## Ownership and shared contracts

| Scope | Agent | Exclusive files | State |
|---|---|---|---|
| Burn, credits, skill progression and interactive practice | forge_completion | `broker/src/v4/skill-forge` excluding market readers; `site/forge-*`, `site/broker-v2-forge.*`; Forge functions/runtime; dedicated tests/scripts | RUNNING |
| Marketplace purchase/sweep/offer lifecycle | market_execution | New `broker/src/v4/marketplace/**`, new marketplace contracts/tests/scripts | RUNNING — wallet/Seaport compatibility audit and interface proposal first |
| Free AI / Bankr disabled | bankr_enablement + lead | Groq/Bankr adapters, registry/runtime/preference seams, provider constraint migration, tests/probes/docs | INTEGRATED — PR #67 published as `8c84817`; direct, preview and production quota-backed Groq checks passed; 28 native PostgreSQL assertions |
| Versioned real skills | real_skill_completion | Versioned packages/adapters and research runtime; shared MCP context integration owned by lead | RUNNING |
| Integration, core UI, API/chat seams, cosmetic fix | lead | `site/broker-v2.js/.css`, core page, integration docs and shared seams | RUNNING |
| Paid-mint completion display and independent review | lead + free_ai_release_review | `site/directed-paid-panel.js`, `site/directed-paid-status.js`, focused tests; reviewer owns new browser regression and review doc | INTEGRATED — `bdc5725`, published in PR #67; 15 browser scenarios passed at 1440/375/320; actual production DOM confirms #1599 complete and separate expired review |

Reuse `ArtBrokerAIProvider`, existing exact review/receipt/idempotency contracts, fixed current-owner checks, Skill Registry hashes and `EffectiveCapabilities`. Marketplace interfaces must be proposed and accepted before another scope consumes them. Accepted v1 skill packages and hashes cannot silently change.

## Initial audit

- Burn/credit/learn/equip/transfer has composed disposable proof. The existing selected #1753→#93 release separately authorizes only that owner canary; the generic training release does not enable burns. No public burn was submitted. Asset inventory and operational checks must fail closed. Forge runtime still hardcodes older public RPC endpoints and needs the configured, validated two-provider service.
- Rarity Eye has real equipped-tool proof. Other catalog entries distinguish unreleased research/transaction capability. Inspect each package before promotion; labels alone grant no authority.
- Bankr adapter exists, but prior release found no usable project credential/credit. Official gateway requires paid credits; the user chose to keep Bankr disabled and requested a free alternative. No paid top-up is authorized.
- Marketplace listings are bounded read-only observations, not a verified floor. Actual bids/purchases need current-owner authority, exact orders, custody, reserve, simulation, cancellation/settlement and durable idempotency. Existing wallet restrictions must not be weakened to add them.
- Budget numbers become unavailable correctly after read failure, but the decorative meter retains cached width. Lead now clears/hides that visual on an unknown balance; full UI regression follows integration.

## Execution boundaries

Implement and test on disposable environments. Do not broadcast a public burn, refund, order, purchase, deployment, sweep or wallet transfer; do not broaden autonomy or install wallet modules. Existing #93 custody, original #1753 and all existing practice chains remain intact. Production setup that requires an owner transaction must become a concrete, reviewable artifact first.

Final integration requires diff/interface review, adversarial tests, composed journeys and fresh independent review of any execution-capable additions. Missing credentials, payment and unsupported deployed-wallet semantics are explicit blockers, not reasons to mark a capability READY.

## Release separation

PR #67 contains the free Groq runtime, configured Forge reads, stale budget-meter
repair and paid-completion reload repair. The completed-mint panel now reads the
existing session once on selection; it never signs in or recovers a wallet request
automatically. Explicit recheck and transaction recovery retain their existing
owner gates. [Independent completion review](../v2-hardening/paid-completion-review.md).

An authenticated read of the holder's existing production session additionally
confirmed completed Peppies World #1599 and a separate expired unsigned mint
review. The panel preserves that completed result and offers an explicit dismiss
action for the unused review. It neither cancels the review automatically nor
creates a replacement. [Sanitized live state](../v2-hardening/paid-completion-live-read.json).

Further Forge, versioned skills and marketplace practice work is being reviewed
in `/private/tmp/gogh-capabilities-integration`, branch
`v2/skill-market-practice-20260913`. Its local contract/simulation results do not
activate public purchases, bids or burns. The real-skills specialist owns the
token-bound MCP integration; the marketplace specialist owns the new isolated
interactive practice server and UI. These changes are excluded from PR #67.
