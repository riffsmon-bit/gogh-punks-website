# V2 swarm status

Base: `eec456222bc8028df1f91b3191ce0ff8874c467e`. Lead integration branch: `v2/swarm-integration-20260913`; checkout `/private/tmp/gogh-punk93-mint-stall`.

Only the lead edits this tracker and integrates commits. States: NOT_STARTED, RUNNING, BLOCKED, READY_FOR_REVIEW, INTEGRATED, REJECTED. Maximum three simultaneous specialists. Large tests are serialized. No automatic production financial actions or broad authority changes.

| Specialist / prompt roles | State | Branch / worktree suffix | Owned scope | Dependencies | Integration commit |
|---|---|---|---|---|---|
| A Architecture (`/root/architecture`) | INTEGRATED | `v2/swarm-architecture` / `/private/tmp/gogh-swarm-architecture` | `broker/src/v4/domain/`, shared-contract docs, dedicated schema tests | Repository map; reuse existing models | `0195815` |
| D Source research (`/root/skill_sources`) | INTEGRATED | `v2/swarm-sources` / `/private/tmp/gogh-swarm-sources` | `docs/v2-swarm/skill-source-audit.md` | Existing source audit and primary upstream sources | `54c7e5a` |
| B Wallet / V1 (`/root/wallet_v1`) | INTEGRATED | `v2/swarm-wallet` / `/private/tmp/gogh-swarm-wallet` | Audit integrated; new typed Agent recovery core/API/browser modules and isolated tests | A approved; M mounts new UI | `f5fce5b` (audit); `68dd8a5`, `ec9dd40`, `d1d69dd` (recovery) |
| E AI (`/root/ai`) | INTEGRATED | `v2/swarm-ai` / `/private/tmp/gogh-swarm-ai` | Bounded provider transport and completion-marker guards; mocked provider tests | A approved | `145ed2b` |
| F MCP (`/root/mcp`) | INTEGRATED | `v2/swarm-mcp` / `/private/tmp/gogh-swarm-mcp` | Selected equipped research, honest read semantics, safe errors | A approved; existing capability resolver | `040d759`, bundle `bfce53a` |
| G/I Discovery / links (`/root/discovery_links`) | INTEGRATED | `v2/swarm-discovery` / `/private/tmp/gogh-swarm-discovery` | Link boundaries; canonical dedupe identity/freshness; dedicated tests | A approved; O does not edit this store | `a955aaa`, `506328b` |
| C/H Forge / market (`/root/skills_market`) | RUNNING | `v2/swarm-skills-market` / `/private/tmp/gogh-swarm-skills-market` | Pinned Forge/market review, read-only chain evidence and regression characterization | A/D approved; preserve registered package hashes | — |
| J/K Security / policy (`/root/policy_simulation`) | RUNNING | `v2/swarm-policy` / `/private/tmp/gogh-swarm-policy` | Security, simulation, policy and opportunity ingress validation; dedicated tests | A approved; L consumes result schema | — |
| L/O Execution / data (`/root/execution_data`) | RUNNING | `v2/swarm-execution-data` / `/private/tmp/gogh-swarm-execution-data` | Immutable preparation, fresh authority/reserves, store expiry, read-only archive diagnostic, persistence review | A/J contracts; preserve worker lease and paid journals | — |
| M/N Frontend / Forge UI (`/root/frontend`) | INTEGRATED | `v2/swarm-frontend` / `/private/tmp/gogh-swarm-frontend` | Agent recovery panel, truthful counts, paid/Forge drafts and guide | B reviewed controller; Q/R final review pending | `f86ae1c` |
| P Integration tests | NOT_STARTED | tests | Cross-subsystem tests and validation report | Integrated feature candidate | — |
| Q Security review (`/root/security_review`) | BLOCKED | `v2/swarm-security-review` / `/private/tmp/gogh-swarm-security-review` | `docs/v2-swarm/security-review.md`, proof tests if approved | Initial review identified Q-01/Q-02; B fixed, independent retest pending | — |
| R UX review | NOT_STARTED | ux-review | `docs/v2-swarm/ux-review.md`, controlled browser evidence | Integrated frontend | — |

## Known external blockers

- Working independent Robinhood archive RPC endpoints: current production primary historical-state reads fail with JSON-RPC -32000; secondary archive access returns HTTP 403. New paid budgets are blocked before wallet confirmation.
- macOS storage/memory pressure: sparse specialist worktrees, shared dependencies, serialized heavyweight validation.
- Production adoption of additional skills, marketplace trading, migrations or contracts requires its own concrete reviewed deployment/owner authorization; test coverage is not production authority.

## Reviewed decisions

- Shared facade `0195815` is additive/server-only and reuses existing schemas. Binding checks never grant authority or replace chain reads.
- Source audit `54c7e5a` rejects unreviewed wallet runtimes; native research adapters remain the integration path.
- Wallet audit `f5fce5b` identifies Agent recovery controls as a launch gap. B owns new recovery modules; M owns mounting in the Control Center. Existing V3 recovery stays available.
- The deployed Agent session can revive after an ownership round trip. Managed-worker history guards remain mandatory; no ownership-contract redesign or broadened execution is authorized.
- Parent reran 10 shared-contract tests and 83 wallet/continuity/recovery tests before accepting those commits.

- AI: parent reran 48 mocked provider tests before integration. MCP: parent reran 49 selected interface/research tests, reviewed owner/equipment gating and added the required Netlify bundle files.
- Storage exhaustion interrupted writes in B/F and initial G worktree creation. Incomplete files were identified and repaired; empty/truncated test output was explicitly rejected as evidence. Regenerable cached CLI/downloads and a clean temporary plugin checkout were removed, dependencies and inactive history transparently compressed with byte verification. No user source or history content was deleted. All affected specialist checks must complete again.
- Completed A/D sparse worktrees were removed to recover space; branches and integrated commits remain.

- Parent reviewed and reran 37 discovery/link/real SQL tests, 80 Agent recovery core/API tests and 19 frontend/paid-panel tests. Recovery cross-tab substitution and malformed terminal-journal findings have regression fixes; Q independent retest is required before release readiness.
- Integration remains local and undeployed. Production #1753 remained intact in the C/H read-only verification at 2026-09-13T14:57:08Z; #93 had zero training credits/learned skills, with Rarity Eye v1 registered and ready.
