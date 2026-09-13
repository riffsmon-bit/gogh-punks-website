# MCP capability review

The existing V2 MCP endpoint now connects native research tools to the reviewed Forge package resolver and fresh owner/equipment gate. This is a local implementation for integration review, not a deployment or expansion of the owner canary.

## Interfaces and compatibility

`GoghArtBrokerMcpServer.listTools()` still returns the baseline catalog synchronously. JSON-RPC `tools/list` without parameters remains public discovery of owner reads, cached diagnostics and non-executing strategy/preparation tools. Calling these tools requires the existing V2 session; basic balance/profile/strategy access does not require a learned skill.

For a selected Punk, send `tools/list` with `params: { "tokenId": "93" }`. The endpoint authenticates the session and checks current on-chain owner before resolving server-owned `EffectiveCapabilities`. It adds only implemented, accepted and equipped research tools. This explicit selected-token parameter is a Gogh extension to the current JSON-RPC endpoint. Clients supply the selected token on each call; there is no process-global selection or cached authorization.

| Tool | Input beyond selected tokenId | Behavior |
|---|---|---|
| `get_punk_skills` | None | Current-owner read of learned skills, occupied equipped slots, credits and slot count within `CURRENT_SERVER_RELEASE` coverage. Unreleased/locked state is `UNAVAILABLE` with null values. RPC verification failure returns an error, never fabricated zero state. |
| `inspect_contract` | None | Existing Contract Detective implementation, fixed canonical Gogh collection. Exact released/equipped package required. |
| `get_metadata` | Three distinct positive `sampleTokenIds`, including selected Punk | Existing inline metadata reader, fixed canonical collection. Requires Rarity Eye; no arbitrary URLs or metadata input. |
| `rank_trait_sample` | Same three-Punk sample | Existing Rarity Eye categorical comparison. Sample rarity, not collection-wide ranking. |
| `get_market_listings` | None | Existing native reader, fixed Gogh collection/slug and limit five. No implementation without the server OpenSea credential. No trading or signing. |

The immutable release currently accepts only Rarity Eye for the existing owner canary. Catalog definitions do not release or register other skills. Exact server manifest/instruction pins, implementation hashes, on-chain READY/availability and learned/equipped state are required. The bridge never accepts client capabilities, packages, owner overrides, target contracts, approval data or signing arguments.

`get_punk_collection` retains `holdings` for additive compatibility and adds `acquisitions`, `collectionView: ACQUISITION_HISTORY`, `currentHoldingsVerified: false`, `holdingsSemantics: DEPRECATED_ACQUISITION_HISTORY_ALIAS` and the existing current-holdings API path. These rows are acquisition history, not verified custody. Existing `simulate_mint`, `estimate_mint_cost` and `prepare_mint` names remain compatible; descriptions and additive fields now identify stored simulation/estimate evidence and requirements-only preparation. They do not claim a fresh simulation or prepared transaction.

## Security and lifecycle

The new `_shared/v2-mcp-research.mjs` directly consumes `readReviewedTrainingState`, `createProgressionReader`, `createResearchSkillRuntime` and `assertTrainingOwnerContinuity`. It constructs no training coordinator, database store or wallet client. Configuration comes from the unchanged server release; RPC reads use its deployment pins.

Discovery verifies current state. Invocation resolves the same gate again, including the existing gate's post-tool recheck. The bridge additionally compares training nonce/state hash before and after, then checks canonical blocks and ownership Transfer logs. Transfer away and back, changed loadout/owner, disabled skills, stale state and unverifiable provider responses withhold results. Missing event-log/RPC evidence is not bypassed.

Research results state `walletAuthority: NONE`, `requiresSeparateEconomicAuthorization: true`, `canBurn: false`. Basic owner assistance remains separate from learned research powers. No burns, refunds, transaction construction, signing or submission are added.

JSON-RPC catches list and invocation failures. Only locally defined public MCP errors retain their intended messages; arbitrary dependency messages and codes become a fixed verification error. Authenticated RPC URLs and upstream response bodies do not reach clients. Existing HTTP public session errors remain unchanged. The endpoint still uses the existing V2 cookie session; no new external OAuth/token service is implemented or claimed.

## Integration requirements

Owned files: core MCP server, Netlify MCP handler, new `_shared/v2-mcp-research.mjs`, `tests/v2-swarm-mcp.test.mjs`, this document. No existing tests, resolver, research implementation, market reader, package/hash, contract, migration, frontend, deployment artifact or production setting changed.

The lead owns and must add the following bundle entry in `netlify.toml` before integrated build/deployment:

```toml
[functions."broker-v2-mcp"]
  included_files = ["broker/skills/**", "broker/src/v4/skill-forge/*.mjs", "deployments/robinhood-forge-training.json"]
```

Runtime package hash verification needs source files in addition to esbuild imports. No Supabase certificate or rarity allocation file is needed: the bridge never opens the training database or claims an allocation. Parent integration owns actual bundle/build validation and deployment decisions.

## Validation

**65 offline targeted tests passed, including 27 new MCP tests:**

```sh
node --test --test-concurrency=1 tests/v2-swarm-mcp.test.mjs tests/art-broker-v2-pipeline.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/skill-forge-research-runtime.test.mjs
```

New tests exercise real capability resolution with reviewed package metadata and mocked chain/research I/O. Coverage includes selected authentication, baseline compatibility, learned/equipped distinctions, canary unavailability, exact package acceptance, stale owner/loadout rejection, same-owner round-trip transfer rejection, malicious arguments, bounded samples, provider error redaction, HTTP session binding and acquisition labels. Existing runtime tests also execute native research implementations against fixtures. These are not live Robinhood results or evidence of current #93 progression.

Syntax checks and `git diff --check` passed. Full integration/build/security gates remain the lead's responsibility. This specialist used no production RPC, credentials, wallet requests, transactions, refunds, burns, package installations or external skills.
