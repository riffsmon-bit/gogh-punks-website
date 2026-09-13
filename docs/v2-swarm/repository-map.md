# V2 swarm repository map

Audited September 13, 2026 against production/main `eec456222bc8028df1f91b3191ce0ff8874c467e` (PR 61). This map supersedes older implementation-map statements that the Agent Account and Forge were undeployed. Product name is Art Broker V2; `broker/src/v4` is an internal directory name, not a new product architecture.

## Workspace and operational boundary

The user's primary checkout is on `fix/punk-agent-live-test-readiness` at `bce4c8c`, with nine modified tracked files and extensive untracked operational scripts, manifests, generated function ZIPs and reports. It is preserved. In particular, burn/refund/transfer scripts and historical funding records are not swarm inputs to execute or clean up.

Integration uses the existing clean disposable checkout `/private/tmp/gogh-punk93-mint-stall`, branch `v2/swarm-integration-20260913`, to conserve disk space. Specialist branches use sparse worktrees and shared read-only dependencies. macOS has less than 1 GB free and four total agent slots (lead plus three specialists), so coding/research run concurrently in waves; large test suites, browsers, PostgreSQL and Foundry runs are serialized by the lead.

No applicable AGENTS.md was found in this repository. Production is Netlify Functions plus static browser ES modules, with Netlify/Neon operational storage and Supabase accounting/review ledgers. No global framework or schema replacement is proposed.

Swarm authorization covers inspection, implementation, local tests, additive migration proposals and canary preparation. It excludes production burns, refunds, sweeps, ownership-semantic changes, unrestricted execution, unreviewed wallet modules and automatic irreversible deployment. Existing #44 disposable practice services and owner journals remain intact.

## Existing subsystems and ownership

| Subsystem | Owning files/directories | Dependencies | Existing status / remaining focus | Intended specialist |
|---|---|---|---|---|
| Shared domain contracts | `broker/src/v4/{collecting-intent,punk-policy,opportunity,punk-skill,simulation,security-screen,execution-boundary}.mjs`; new `broker/src/v4/domain/` | Existing normalizers and schemas | Versioned strategy, opportunity and execution models already exist. Create an authoritative compatibility map and shared identity/result validators, not competing schemas. | A architecture |
| Wallet and ownership | `contracts/src/GoghPunkAccount*.sol`, `GoghPunkAgentAccount*.sol`; `broker/src/agent-account/`; `netlify/functions/_shared/v2-ownership.mjs`; owner/withdraw endpoints | Live ownerOf, runtime pins, account registries, signed sessions | Canonical V3 Wallet and separate ownership-bound Agent Account exist. Funding and owner withdrawal paths exist; verify transfer, stale-owner and legacy-asset behavior. | B wallet / V1 audit |
| V1 retirement | `broker/src/lifecycle/` where present; `netlify/functions/_shared/v1-retirement-finalizer.mjs`; `broker-v1-*.mjs`; `docs/V1_SHUTDOWN_RUNBOOK.md`; legacy migrations | Cutoff guards, legacy ledgers, reserved receipt reconciliation | September 5 cutoff is implemented. Retirement is not proof all liabilities are repaid. Preserve historical and recovery paths; no refund/sweep broadcasts. | B wallet / V1 audit |
| Skill Forge | `contracts/src/Gogh*Skill*.sol`, `GoghReviewedBurnSource.sol`, `GoghForge*.sol`; `broker/src/v4/skill-forge/`; `broker/skills/` | Registry, progression, original-token ownership, allocation root, reviewed packages | Registry/progression/reviewed burn/training exist and selected-owner contracts were deployed. Rarity Eye is the selected registered skill. Only three executable research packages exist; larger skill library is a roadmap, not ten live skills. Review persistence, learned/equipped behavior and truthful catalog readiness. | C skills |
| Real skill sourcing | `docs/v2-skill-source-audit.md`, `docs/v2-proven-skill-shortlist.md`; new swarm audit | Pinned upstream source, licensing, chain/API evidence | A substantial source audit already exists for Bankr/OpenSea/Emblem/Blockscout/OpenRarity/Orange Genie. Refresh evidence and decisions; do not install external runtimes. | D source research |
| AI platform | `broker/src/v4/ai/`; `netlify/functions/_shared/v2-ai-runtime.mjs`; `broker-v2-{chat,providers}.mjs` | Collecting intent, capability context, provider secrets, usage store | OpenAI, Anthropic, xAI, Bankr and Gemini adapters, registry/router and structured interpreter already exist. Audit real provider availability versus configuration and bounded fallback/usage. No model owns wallet authority. | E AI |
| MCP | `broker/src/v4/mcp/art-broker-mcp.mjs`; `netlify/functions/broker-v2-mcp.mjs` | Authentication, current ownership, EffectiveCapabilities, approved handlers | Bounded tool server exists. Catalog currently lists its complete static surface; audit capability-derived exposure and invocation, including skill reads. No arbitrary signer/calldata tools. | F MCP |
| Shared discovery and links | `broker/src/v4/discovery/`, `discovery-engine.mjs`, `postgres-opportunity-repository.mjs`, `link-scanner.mjs`; discovery/inspect endpoints | Opportunity schema, known adapters, source provenance, SSRF boundary | Shared ingest, normalization/deduplication and URL resolution already exist. Find concrete provenance/freshness/deduplication or resolver gaps; no per-Punk scanner processes. | G/I discovery + link scanner |
| Market intelligence | `broker/src/v4/skill-forge/market-reader.mjs`, `research-tools.mjs`; marketplace readers | OpenSea identity matching, timestamps, read-only normalization | Live metadata/listing reads and sample rarity research were previously verified. Floor purchases and WETH bids are not live. Extend only reviewed read-only intelligence and explicit limitations. | H market |
| Security/simulation/policy | `broker/src/v4/{security-screen,simulation,policy-matcher,punk-policy}.mjs`; reviewed adapter builders | Canonical identity, reserve/limits, known selectors, runtime/code checks | Deterministic gates and simulations exist. Review cross-subsystem binding, stale results, policy/skill requirements and unsupported paid/secondary actions. | J/K security + policy |
| Execution and paid recovery | `broker/src/v4/{executor,postgres-execution-store,directed-paid-*}.mjs`; `netlify/functions/broker-punk-agent-worker.mjs`; worker lease/runtime | Current authority, policy, simulation, durable storage, RPC history | Owner-session free-mint worker and selected #93 paid mint exist. PR 61 stopped the expired unsigned mission and gates new budgets on archive access. Two Netlify RPC endpoints fail archival reads. No broad execution activation. | L execution |
| Control Center / Forge UI | `site/broker-v2.{js,css}`, `site/broker/v2/`, `site/forge-*.js`, `site/directed-paid-*.js` | Stable authenticated API envelopes, Reown, selected token identity | Original arcade presentation, roster, Talk/Strategy/Fund/Collection/Activity/Forge/settings, prompts and a public guide exist. Focus on action/status clarity, loading/error/mobile and recovery rather than redesign. | M/N frontend |
| Data | `netlify/database/migrations/`, `netlify/database/review/`, `supabase/migrations/`; PostgreSQL stores | Existing identities, schema versions, worker/request role split, CAS | Additive V2 strategy/opportunity/skill/session/training/burn/paid journals exist. Inspect RLS, grants, uniqueness and immutable receipts; propose migrations only for demonstrated gaps. | O data |
| Validation | `tests/`, `broker/test/`, `contracts/test/`, `scripts/test-*`, `foundry.toml`, package scripts | Integrated branch, local fixtures, controlled forks | Baseline: 1,897 JS tests and 140 deployment checks passed before this swarm; paid PostgreSQL/Anvil and responsive wallet mocks passed. Full contract validation must run after integration. | P integration tests |
| Security review | `docs/v2-swarm/security-review.md` | Diffs and integrated behavior across above owners | Independent review after feature commits; blocking findings must be resolved before integration acceptance. | Q security reviewer |
| UX review | `docs/v2-swarm/ux-review.md` | Completed frontend and controlled browser state | Independent desktop/tablet/mobile and accessibility review; evidence, not subjective approval alone. | R UX reviewer |

## Deployment and production evidence

- `deployments/robinhood-punk-agent-account.json`: DEPLOYED account/registry with bounded owner sessions, runtime pins and reconciliation. This is distinct from the older V3 policy account.
- `deployments/robinhood-forge-training.json`: OWNER_CANARY. `robinhood-selected-burn.json`: selected #1753 → #93 authorization from earlier work. This swarm does not exercise or broaden it.
- `deployments/robinhood-directed-paid-mint.json`: OWNER_CANARY, #93/Peppies World only. Latest deployed worker is PR 61, Netlify `6aa6a7f80bea850008cb5b8c`.
- Latest inspected cancellation `0x3e8591c3eb6fea158517541c3e73abe00830fc706f328349323c33d5a76ac444` is confirmed. At 2026-09-13T14:01:39Z the vault's refundable balance was 183954000000000 wei. The swarm does not broadcast the withdrawal.
- Forge observation at 2026-09-13T13:48:25Z: enabled, #1753 intact, #93 credits/learned count zero. The old approval review was expired and unsent.
- Production read-only contract/rarity/market checks passed during PR 61 deployment. That does not establish live mint, burn, floor-sweep or WETH-bid success.

## Build and test map

`npm run site:deploy-check` builds wallet assets, checks static pages/code/broker and runs selected browser/API tests. `node --test --test-concurrency=1 tests/*.test.mjs broker/test/*.test.mjs` is the disk-conscious full JS gate. `npm run contracts:check` includes formatting, offline compilation/size checks, high-severity lint, fuzz tests and ABI verification. Native PostgreSQL/Anvil scripts exercise actual journals/roles, signed-byte recovery and deployed contract behavior on disposable chains. There is no existing global TypeScript compiler gate; shared contracts must fit the current JavaScript/JSON-schema architecture, with a documented type-validation gate rather than a framework migration.

## Integration order

1. A defines compatibility-preserving shared interfaces; D updates source evidence and B audits V1/wallet safety independently.
2. Lead reviews A's interface contract before E/F/G-I and remaining specialists implement against it.
3. C/H/O, then J-K/L/M-N work in disjoint files. Shared-file requests stop for coordination before edits.
4. P/Q/R validate/review the compatible integrated candidate. Lead runs full validation serially and records unresolved external prerequisites separately from implementation defects.
