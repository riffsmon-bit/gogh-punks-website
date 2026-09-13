# V2 swarm status

Base: `eec456222bc8028df1f91b3191ce0ff8874c467e`. Lead integration branch: `v2/swarm-integration-20260913`; checkout `/private/tmp/gogh-punk93-mint-stall`.

Only the lead edits this tracker and integrates commits. States: NOT_STARTED, RUNNING, BLOCKED, READY_FOR_REVIEW, INTEGRATED, REJECTED. Maximum three simultaneous specialists. Large tests are serialized. No automatic production financial actions or broad authority changes.

| Specialist / prompt roles | State | Branch / worktree suffix | Owned scope | Dependencies | Integration commit |
|---|---|---|---|---|---|
| A Architecture | NOT_STARTED | architecture | `broker/src/v4/domain/`, shared-contract docs, dedicated schema tests | Repository map; reuse existing models | — |
| D Source research | NOT_STARTED | sources | `docs/v2-swarm/skill-source-audit.md` | Existing source audit and primary upstream sources | — |
| B Wallet / V1 | NOT_STARTED | wallet | Wallet/V1 audit first; scoped ownership fixes after interface review | Existing account/authority interfaces | — |
| E AI | NOT_STARTED | ai | AI provider modules and dedicated provider tests | A approved | — |
| F MCP | NOT_STARTED | mcp | MCP server/endpoint and dedicated tests | A approved; existing capability resolver | — |
| G/I Discovery / links | NOT_STARTED | discovery | Discovery/link modules and dedicated tests | A approved | — |
| C Forge skills | NOT_STARTED | skills | Skill catalog/registry/resolver scope after coordination | A approved; no source-package hash mutation | — |
| H Market | NOT_STARTED | market | Read-only market adapters, dedicated tests | A approved; D evidence | — |
| O Data | NOT_STARTED | data | Additive persistence review/migration proposals, dedicated DB tests | A approved; existing stores | — |
| J/K Security / policy | NOT_STARTED | policy | Security/simulation/policy modules and dedicated tests | A approved | — |
| L Execution | NOT_STARTED | execution | Execution/archival readiness scope, dedicated tests | A approved; preserve worker lease/owner budgets | — |
| M/N Frontend / Forge UI | NOT_STARTED | frontend | Approved browser modules and responsive tests | Stable API contracts; no API/schema edits | — |
| P Integration tests | NOT_STARTED | tests | Cross-subsystem tests and validation report | Integrated feature candidate | — |
| Q Security review | NOT_STARTED | security-review | `docs/v2-swarm/security-review.md`, proof tests if approved | Reviewed candidate diffs | — |
| R UX review | NOT_STARTED | ux-review | `docs/v2-swarm/ux-review.md`, controlled browser evidence | Integrated frontend | — |

## Known external blockers

- Working independent Robinhood archive RPC endpoints: current production primary historical-state reads fail with JSON-RPC -32000; secondary archive access returns HTTP 403. New paid budgets are blocked before wallet confirmation.
- macOS storage/memory pressure: sparse specialist worktrees, shared dependencies, serialized heavyweight validation.
- Production adoption of additional skills, marketplace trading, migrations or contracts requires its own concrete reviewed deployment/owner authorization; test coverage is not production authority.
