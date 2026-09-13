# Versioned equipped skills in the MCP API

Status: **INDEPENDENTLY REVIEWED AND INTEGRATED — public skill release unchanged**.

This increment wires the reviewed local Market Scout v2, Link Sniper v1 and Mint Hunter v1 packages into `/api/v2/mcp`. Only exact keys and package hashes already present in the server's `OWNER_CANARY` release can become available. It adds no registry transaction, release entry, secret, migration, public capability, or execution authority. The current public release still determines what a holder can use.

## Compatibility and boundaries

The original unscoped tool list is unchanged. In particular, baseline `inspect_mint_link` remains a URL diagnostic without a selected Punk, `simulate_mint` remains a stored simulation summary, and `prepare_mint` remains a requirements report.

Selected, authenticated discovery can expose these additional tools:

| Public tool | Gated package implementation | Input after authenticated token selection |
| --- | --- | --- |
| `skill_inspect_mint_link` | Link Sniper `inspect_mint_link` | URL only |
| `skill_inspect_mint` | Mint Hunter `inspect_mint` | Existing shared opportunity ID only |
| `skill_simulate_mint` | Mint Hunter `simulate_mint` | Existing shared opportunity ID only |
| `skill_prepare_mint` | Mint Hunter `prepare_mint` | Existing shared opportunity ID only |

The four previous equipped research names remain unchanged. Market Scout's exact release key selects v1 or v2 explicitly. A v2 key never falls back to v1. Unknown versions, mismatching accepted hashes, missing equipment, zero learned level, changed owner, or changed training state do not grant a tool. Both stages of the existing skill gate remain in place, followed by the training ownership continuity check.

New mint tools run the actual fixed SeaDrop inspection, simulation and deterministic policy adapter. Preparation returns a recommendation with `transaction: null`, `executable: false`, and a requirement for a separate owner review and durable execution reservation. A successful call check does not establish post-state asset safety or final NFT delivery. No execution is added.

## Server context

`v2-mint-research-context.mjs` reads the deployed canonical **AGENT** account through the existing pinned runtime. For #93 this is `0xcadcfd37e715bc031cf0cec7fa2335091c878c83`. Registry and implementation hashes, exact token-bound proxy bytes, original NFT owner, deployed status and native balance are checked at one fresh block. Baseline diagnostic wallet semantics remain unchanged by this increment.

A context requires the latest ACTIVE strategy for the current owner, its recorded confirmation, unexpired lifetime, matching canonical strategy hash, and the same Agent wallet. Older ACTIVE rows cannot bypass a newer PAUSED row. The shared opportunity comes from the application database and must agree with its stored ID, chain, collection and screening state. The client cannot supply an opportunity body, strategy, usage, capability flags, endpoint or calldata.

Historical `ownerOf` and Transfer logs cover the strategy's recorded `ownership_block` through the current anchor inclusively. The scan uses 2,000-block provider windows, four concurrent requests, at most 512 pages (1,024,000 blocks), and an eight-second scan deadline within the existing 30-second authority freshness limit. A scan exceeding either bound returns unavailable and never truncates its range. Requests stop being scheduled on failure; at most the existing four read-only RPC calls may remain in flight until their transport timeouts.

Every required raw `eth_getLogs` page must complete. The reader decodes provider results itself because viem's event-aware `getLogs` silently filters malformed/unmatched records; an actual viem transport regression proves that such a response is rejected here. Missing/non-array/sparse/malformed/oversized pages or continuation metadata cannot become an empty history. Transfers are decoded against the exact collection and Punk, checked within the requested page and against their canonical block, and reject inherited strategy authority. The original ownership block and common current anchor are both captured and rechecked after pagination. Reorgs, a changed chain, a transfer away and back, or stale evidence invalidate the result. This preserves the previous authority semantics while avoiding an unbounded provider request. The session/paid-history helpers use similar windows but require authorization receipts or hardcode #93, so the strategy reader retains its own existing authority anchor.

The MCP bridge uses the configured Forge archive pair's primary client. Link Sniper also receives the server environment, so it can use the existing configured fixed-source resolver. Neither accepts a request-supplied endpoint.

## Usage and database semantics

Usage is real recorded activity across the relevant stores:

- Canonical Agent V2 attempts include completed and all unresolved reservations.
- `broker_acquisitions` uses exact `asset_amount` for the current chain, collection, Punk and Agent wallet. Completed copies are deduplicated by transaction and NFT collection, taking the greatest count across the acquisition, V2 attempt and selected-paid sources.
- UserOperations must agree with their attempt and session scope; an unresolved signed operation cannot disappear behind a cancelled attempt.
- #93's separate selected-paid store is read through the existing restricted Forge request database runtime. Its completed receipts must match the pinned recipient and collection with two-provider evidence. Budget confirmation is counted conservatively as one pending unit until an execution outcome is recorded. It is never labeled a completed mint.
- Other Punks have no selected-paid scope under the fixed #93 release. This is established from the server release, not inferred from an unavailable connection.
- Acquisition `opportunity_id` bytes32 values and V2 text opportunity IDs are never equated. The per-opportunity cap conservatively counts the entire requested NFT collection plus every unresolved reservation. Daily usage is the UTC day, with all unresolved reservations counted today. Total usage is the Agent's recorded lifetime acquisition total. These bounds can reject a new mission earlier than session-local counts would; a previous one-mint mission can therefore require a larger explicitly confirmed total limit.
- A legacy paid job without an attributable Agent wallet, an unresolved/historical V4 attempt whose quantity semantics are outside this reader, orphan COLLECTED activity, inconsistent receipt/state, future completion time, missing table/access, incomplete SELECT visibility, invalid count, or count above JavaScript's exact integer range makes accounting unavailable. Nothing defaults to zero after a failed read.

RLS coverage is verified. When PostgreSQL applies row security, the current role must have a full permissive SELECT policy and no applicable restrictive filtering policy. An empty result under a filtering policy cannot prove zero usage. Selected-paid access additionally requires that the request role cannot SELECT `raw_transaction`. The code never selects those bytes, `transaction_json`, or keys. It performs SELECT statements only.

The selected-paid history read is bounded to 1,001 rows and fails if more than 1,000 applicable reviews exist. This explicit limit needs a reviewed paginated/aggregate replacement before that scale. Accounting across the two databases is a read-only observation, not an atomic reservation. The Mint Hunter adapter repeats context and policy after simulation; a future execution flow must perform its own durable reservation and revalidation.

## Validation

- **153 focused Node tests passed**, including 71 new context, HTTP alias and bounded-history tests. Real native adapters are invoked, including an exact mint call targeting #93's canonical Agent using pinned offline runtime fixtures.
- **28 native PostgreSQL assertions passed** using actual repository table DDL, real read-only application and restricted paid roles, actual budget/execution journal transitions, transaction dedupe, quantity accounting, session/attempt disagreement, UTC periods, missing permissions, and RLS filtering failures. No production database was used.
- No public chain transactions, registrations, burns, refunds, fund moves, external package installation or public capability changes.

Reproduce:

```sh
node --test tests/v2-swarm-mcp.test.mjs tests/v2-mcp-versioned-skills.test.mjs tests/v2-mint-research-context.test.mjs tests/v2-mint-research-history.test.mjs tests/skill-forge-real-package-adapters.test.mjs tests/skill-forge-research-runtime.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/owner-assisted-seadrop-mint.test.mjs
node tests/mint-research-context-postgres.integration.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin
```

The native harness creates and removes its own loopback cluster. It does not load `.env`. The recorded native result is `versioned-skill-mcp-postgres-evidence.json`.

## Remaining gates

Exact public skill registration/review/availability and release additions require the separate reviewed process. This work does not mark any new public skill READY. Mint Hunter requires an ACTIVE current-owner strategy already bound to the canonical Agent and sufficient verified usage headroom. Missing history credentials, scoped database visibility, unsupported historical accounting, or incomplete post-state execution evidence remain explicit blockers. Root owns final integration, full repository validation and any controlled release.
