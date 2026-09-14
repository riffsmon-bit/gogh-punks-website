# Capability continuation and release review

This report covers the increment after merged PR #69 (`1063614`). The original dirty checkout and existing holder practice sessions were preserved. Final validation and publication results are recorded below as they complete.

**Public marketplace verdict: NOT_READY.** No public NFT was burned, no funds were moved, no order or refund was broadcast, and Bankr remains disabled. Passing controlled tests does not clear the known public WETH transfer-continuity defect or promote unregistered skills.

## Delivered behavior

| Area | Result |
| --- | --- |
| Burn, credits and learning | Existing copied #1753→#93 journey was read-only verified. The holder learned Rarity Eye and later unequipped it. Zero remaining credits is correct after learning; equip the learned skill again without another burn. A separate three-skill composition proves three credits, exactly-once learning, equip/unequip and transfer persistence with 28 copied-chain transactions and zero public transactions. |
| New research skills | Floor Hunter ranks exact observed prices within each currency. Collection Researcher summarizes selected metadata traits. Art Curator compares recognized metadata style declarations. The real sample's missing style labels remain unknown; no image-analysis claim. All three remain TESTING for permanent public training. |
| Forge and MCP | The actual registry key now includes the canonical `GOGH_SKILL` prefix, fixing a hidden equipped research action. Tool exposure intersects the exact package's declared tools, registry capabilities and current loadout. New adapters reuse existing domain models; raw dependencies are included in serverless source verification. Research results scroll into view and render untrusted metadata as text. |
| Durable purchases | Owner/Punk-scoped immutable reviews, one winning database claim, original-byte simulation and receipt recovery are implemented. The database confirms durable commit before releasing wallet instructions. Losing, timed-out or lost-ack requests cannot authorize a resend. A canonical reverted receipt also receives a closing block check. |
| Purchase UI | Selected NFT IDs, exact ETH totals, separate owner network fees and Punk reserve appear in one review. Completed/reverted cards remove stale action buttons. Unsent blocked drafts can be explicitly discarded after a fresh exact lookup proves no server record. Unknown/submitted transactions retain recovery. The public mount uses no purchase release and makes no idle marketplace API request. |
| OpenSea source | Fixed, bounded original-order GET reader and staged fulfillment-signature adapter validate complete order components, counter, fees, chain, recipient and the supported canonical call. Attribution is recorded without changing execution bytes. Actual GET reads authenticated but did not supply an eligible signed original. No live fulfillment POST occurred. |
| Wallet, ownership and withdrawals | Existing owner authority and asset access remain unchanged. New wallet-boundary tests verify exact displayed-order hashes, canonical account calls, trusted guard pins, prices, reserve, expiry and identity changes. Existing funding, withdrawal and transfer suites remain in the full gate. |
| Chat, AI and existing missions | Existing provider-neutral integrations and confirmed-rule behavior are retained. Groq, Gemini, OpenAI, Claude and Grok have prior live acceptance; this increment makes no new provider-readiness claim. Bankr remains off. The existing paid-mint #1599 delivery is not repeated. |
| Discovery and policy | Shared discovery and bounded observation remain separate from signing authority. A listing sample is not a guaranteed floor. Existing mint rules are not silently reused as secondary-market purchase permission. |
| Database and V1 | One additive staged migration adds marketplace reviews/audit, constraints, RLS and owner-scoped lookup indexes. It has no public grants and has not been applied to production. No V1 history was deleted or changed. |
| Contract changes | No new Solidity production implementation in this increment. Five tests reproduce WETH's transfer-continuity counterexample. An exact offline native purchase-guard deployment proposal exists; it lacks a fresh wallet deployment review and public receipt. |

## Swarm and review

Three specialists worked in isolated branches: marketplace journal/source, research skills/UI, and independent security/QA. The lead owned shared interfaces, capability resolution, API/MCP/UI seams, packaging and integration. Specialists reviewed other authors' work and returned regression evidence. Exact assignments and integration commits are in [continuation status](continuation-status.md).

The review loop closed the registry-key mismatch, missing packaged dependency, wallet/order commitment gap, asynchronous database durability gap, reverted-receipt reorg gap, blocked-draft dead end, invisible paused-history error and selection change during sign-in. The WETH ownership round-trip finding remains a public release blocker. Review documents distinguish independent evidence from author tests.

## Validation

- Contract gate: 310 passing Solidity tests with 1,024 fuzz runs, formatting, offline build, size, high-severity lint and ABI checks.
- Native database security: nine independent cases pass, including actual mutation-connection durability, unsafe engine settings/storage rejection and canonical terminal receipt checks.
- Composed marketplace proof: one copied purchase, two verified NFT deliveries, durable claim, PostgreSQL restart and paused-release original receipt recovery; zero public transactions.
- Purchase component: 67 author/wallet-boundary tests plus seven independent recovery/identity cases pass. Actual Chrome review/recovery/terminal/error screens pass at 1440/375/320 pixels.
- New research browser: seven scenarios, 12 screenshots at 1440/768/375/320, no wallet requests. Actual handlers/adapters use fixed provider fixtures; this is not public skill-registration evidence.
- Control Center: 25 actual browser journeys, 59 screenshots at 1440/1280/768/430/375/320, no reported functional/layout findings, no external requests or real wallet calls. Covers roster, ownership changes, collection, exact balances, chat, rules, stale replies, links, funding recovery and Forge.
- Staged source adapter: 113 author cases and 23 independent adversarial cases pass. Final controller/component independent suite: 16 cases pass, including the sign-in race, owner/Punk/chain switches and A→B→A.
- Full final JavaScript/build results: pending final gate at report preparation.

The first full JavaScript attempt exposed old local fixture manifests that omitted explicit tool declarations. Their fixture definitions were corrected without weakening production checks; all 64 affected Forge tests pass. A browser launch initially timed out in Chrome navigation before the app loaded; the unchanged harness rerun completed all 25 journeys. Neither failed attempt is counted as passing evidence. A later full run reproduced a separate test clock bug (the same mocked block changed its timestamp between reads) and an unbounded Chrome/CDP cleanup path. Test-only fixes pin the mock block while preserving changed-block rejection, bound CDP diagnostics and clean up only the owned browser. The original 120-second test limit is retained; 68 focused concurrent cases pass, and the full gate is rerunning.

## Performance and user experience

The idle purchase mount adds zero API calls and clears stale views on identity changes while preserving journal history. Listing reads are limited to five exact orders, ten requests for the staged two-step source, fixed response sizes and an eight-second overall deadline. Research samples are bounded and metadata queries are concurrent. Database lookup has an index matching its exact current/history ordering.

The local controlled browser measured a 3.90-second disconnected usable shell, 5.50-second connected roster/selected shell, and 0.34-second 140-Punk fixture roster update under shared Mac load. These are single fixture samples, not production p95 measurements or before/after improvement claims. The unchanged published ownership/artwork baseline remains in the historical performance audit. Phone-size screenshots cannot prove real mobile-wallet handoff or keyboard behavior.

## Remaining release gates

1. **WETH public P1:** current-owner checks can revive a stale offer after Alice→Bob→Alice, including a single-transaction transfer round trip. The collection provides no required ownership epoch. The candidate stays rejected for public offers; a watcher or deployment flag cannot repair this on-chain condition. Restricted-order marketplace acceptance is also unproven.
2. **Public native purchases:** a real supported signed listing, actual reviewed collection screening, marketplace-specific owner policy/equipped-skill composition, a deployed verified guard and a restricted production journal connection are required. Local test callbacks cannot fill these roles. The [composition gap assessment](../v2-marketplace/production-composition-gaps.md) names reusable existing APIs and separates code, evidence and authorization dependencies.
3. **Permanent new skills:** reviewed package/registry registration and release promotion have not been publicly executed. Lab availability grants no permanent skill, credit or execution permission.
4. **Production owner actions:** no mainnet burn, contract deployment, registration, bid, purchase, refund, broad autonomy or asset movement is included in this build release. Any next wallet step requires its fresh exact transaction/fee review and the owner's explicit confirmation.

The copied practice environment and reviewed research increment can be exercised without those public actions. Use the [holder testing guide](../v2-hardening/testing-guide.md), which includes how to continue the completed Forge session without sacrificing another Punk.
