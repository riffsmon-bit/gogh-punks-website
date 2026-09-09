# Skill Forge implementation checkpoint

Local feature branch: `feat/gogh-skill-forge`. No push, production deployment, environment change, real NFT burn or transfer is part of this checkpoint. Core V2 remains unchanged.

## Implemented and exercised locally

- **GoghSkillRegistry**: append-only skill/version identity; immutable manifest/instruction/capability/prerequisite mapping; controlled review statuses; READY requires TESTING plus evidence hash; per-skill and capability/global emergency disable; permanent deprecation with explicit replacement. Governance attests review—it cannot cryptographically prove an audit was performed. It has no fund-withdrawal methods.
- **GoghSkillProgression**: credits attached to token ID; one credit per source sacrifice identity; one-credit learn/unlock economy; current owner controls loadout; learned version level 1, unlocked slots and equipment survive transfers; no duplicate equipment; deterministic equipment-based capability mask. Learned history persists when a version becomes unsafe.
- **Configuration**: immutable collection, registry and training source. Slot base/cap are explicit constructor parameters, bounded to 32 for execution cost; local tests use 1 base / 4 cap. That is NOT a final product slot-cap decision. Changing immutable configuration would require a separately reviewed migration, not silent admin mutation.
- **Canonical resolver**: reads owner, registry, progression and equipment at one block; verifies deployment code hashes and configured addresses; detects reorg during reads; validates local package/instruction hashes against learned on-chain versions; only exposes approved, implemented tool identities; produces provider-neutral instruction context. A missing/disabled/deprecated/unapproved/unequipped skill grants no tools.
- **MCP/AI integration seam**: `createSkillToolGate` uses the same fresh resolver for context and calls, checks selected Punk identity and current owner, rejects token/owner substitution, and never returns wallet authorization. No live V2 endpoint has been switched to this gate yet.
- **Burn warning prototype**: inventories all known wallet generations and outstanding state; native/ERC20/NFT/deposit/unknown findings block. Always `canBurn=false` in production-facing advisory code. Unmounted component; not a published burn page.

## Local burn harness versus production

`LocalSkillTrainingSource` lives in the **test file**, not production sources. Constructor rejects any chain other than 31337. It uses mocked asset-state blockers and a mock ERC721, verifies ownership of both tokens, invokes a mock burn and awards the credit in the same transaction. This proves accounting/rollback behavior, NOT that real token-bound wallets can be certified empty.

The production progression contract accepts credits only from its immutable training-source contract. It rejects duplicate sacrifice IDs and still-existing sacrifice tokens. A nonexistent token is not proof it was legitimately burned: the training source must prove prior ownership, safe eligibility and actual burn. A faulty source could manufacture credits from never-minted IDs. **No production training source has been implemented or approved. Do not deploy progression with an arbitrary source to bypass this blocker.** The constructor's code-presence check alone is not security approval.

## Test results

| Check | Result |
|---|---|
| New JavaScript skill-forge tests | 55 passed |
| Existing V2 skill/mint-envelope regressions | 7 passed |
| New Solidity suite | 16 passed, including 1,024 fuzz runs for unauthorized loadout changes |
| Actual local Anvil deployment + JavaScript reader/gate | Passed |
| Registry runtime size | 3,175 bytes |
| Progression runtime size | 4,328 bytes |
| New contracts: high-severity lint / formatting check | Passed |

Local integration exercises deploy → mock sacrifice → credit → learn → equip → hash-pinned tool access → NFT transfer → former-owner denial/new-owner access → global skill disable. The tool implementation in this integration is a fixture, not a real mint. Separate read-only Robinhood contract/metadata probes are recorded in the [source audit](v2-skill-source-audit.md).

Reproduce:

```sh
forge test --offline --match-contract GoghSkillForgeTest --fuzz-runs 1024
node --test tests/skill-forge-*.test.mjs tests/owner-assisted-seadrop-mint.test.mjs tests/art-broker-v2-skills.test.mjs
node scripts/test-skill-forge-local.mjs --local-only
```

The integration runner starts its own loopback-only Anvil, uses unlocked local fixture accounts, accepts no RPC override, loads no private keys, and terminates its local node afterward. It requires compiled Foundry artifacts and Anvil installed.

## Remaining work, in order

1. **Security/semantic review of new contracts and resolver**. This is test-backed prototype code, not an audited production release. Add invariant/state-machine, event-indexing/reorg, hostile source and broader property tests.
2. **Real skill acceptance**. Zero new production READY skills. Contract Detective and sample Rarity Eye have narrow live evidence; Market Scout still needs successful authenticated live listing retrieval; Link Sniper/Mint Hunter need complete permitted live/test pipelines. Do not register test fixture manifests for production.
3. **Control Center integration and Forge UI**. Read-only profile/skill tree, learned versus equipped slots, train/learn review, mobile layout, safe warning flow, provenance activity and roster indicators. Private-owner notes remain separate.
4. **Live V2 policy/executor/MCP integration**. Tool filtering is necessary but cannot enforce restrictions on previously signed immutable wallet sessions. Approved on-chain executor/policy hook and deployment pinning must be reviewed with core V2. A capability mask never overrides policy, expiry, gas, reserve, simulation, blocked contracts or session authorization.
5. **Transfer automation pause and privacy verification**. Ownership checks deny an old owner after transfer, but a sell-and-buy-back can revive an old session unless an ownership epoch/revocation mechanism handles it. Durable transfer ingestion and new-owner activation must be integrated/tested. Private chat is not present in progression; application privacy regression coverage still needed.
6. **Usage mastery and achievements**. Level 1 learning exists; no successful-action counters or level-up path is implemented yet. Design receipt-backed, idempotent/reorg-aware proofs and progression/migration compatibility before claiming levels 2/3. No admin-created or failed-transaction XP.
7. **Production burn safety resolution**. Full asset inventory, all wallet generations, deposits, legacy obligations, races and post-burn recovery are unresolved. Native zero is insufficient. See [burn audit](v2-skill-forge-burn-audit.md).
8. **Controlled canary proposal**. Explicit configuration, code/hash verification, owner-reviewed limits and separate production authorization. No public burns or higher-risk paid/trading skills without approval.

Next deliverable: gated, read-only Forge/Control Center experience backed by the progression model, without enabling a production burn or claiming untested skills are learnable.
