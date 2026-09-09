# Skill Forge implementation checkpoint

Local feature branch: `feat/gogh-skill-forge`. No push, production deployment, environment change, real NFT burn or transfer is part of this checkpoint. Core V2 remains unchanged.

## Implemented and exercised locally

- **GoghSkillRegistry**: append-only skill/version identity; immutable manifest/instruction/capability/prerequisite mapping; controlled review statuses; READY requires TESTING plus evidence hash; per-skill and capability/global emergency disable; permanent deprecation with explicit replacement. Governance attests review—it cannot cryptographically prove an audit was performed. It has no fund-withdrawal methods.
- **GoghSkillProgression**: credits attached to token ID; one credit per source sacrifice identity; one-credit learn/unlock economy; current owner controls loadout; learned version level 1, unlocked slots and equipment survive transfers; no duplicate equipment; deterministic equipment-based capability mask. Learned history persists when a version becomes unsafe.
- **Configuration**: immutable collection, registry and training source. Slot base/cap are explicit constructor parameters, bounded to 32 for execution cost; local tests use 1 base / 4 cap. That is NOT a final product slot-cap decision. Changing immutable configuration would require a separately reviewed migration, not silent admin mutation.
- **Canonical resolver**: reads owner, registry, progression and equipment at one block; verifies deployment code hashes and configured addresses; detects reorg during reads; validates local package/instruction hashes against learned on-chain versions; only exposes approved, implemented tool identities; produces provider-neutral instruction context. A missing/disabled/deprecated/unapproved/unequipped skill grants no tools.
- **MCP/AI integration seam**: `createSkillToolGate` uses the same fresh resolver for context and calls, checks selected Punk identity and current owner, rejects token/owner substitution, and never returns wallet authorization. No live V2 endpoint has been switched to this gate yet.
- **Burn warning prototype**: inventories all known wallet generations and outstanding state; native/ERC20/NFT/deposit/unknown findings block. Always `canBurn=false` in production-facing advisory code. Unmounted component; not a published burn page.
- **Local Forge UI**: read-only arcade-style Punk selector, learned/equipped distinction, empty/locked slots, capability detail dialogs with fixture hashes, readiness labels, training history from local contract logs and blocked-burn safety explanation. Three disposable mock Punks use existing collection artwork; they are explicitly not production holdings. No wallet connection, signer, POST route or live training control. Files live outside Netlify's `site` publish directory. This is a design/contract harness, not completed V2 Control Center integration.

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
| Local UI integration + HTTP boundary checks + Chrome desktop/mobile | 4 additional test results passed; combined JavaScript run 66 passed |
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

### Preview the Forge locally

From this feature worktree, with Anvil on PATH and Foundry artifacts already compiled:

```sh
node scripts/dev/skill-forge/preview-server.mjs --local-only
```

Open the loopback URL printed by the process. Stop it with Ctrl-C. Each launch deploys a new disposable mock collection, registry and progression on chain 31337. Mock Punk #1 starts with two learned skills, one equipped skill, two unlocked slots and one remaining credit, created through actual local mock-sacrifice transactions. Mock Punks #44 and #7 are untrained. The two learnable fixture definitions are marked READY only on that disposable chain; their actual production status remains TESTING. No external skill is promoted to production READY by this preview.

Browser/API regression:

```sh
node --test tests/skill-forge-preview.test.mjs
```

This test requires local Google Chrome on macOS and Anvil. It checks on-chain credit/equipment/history reads, token selection isolation, wrong-origin/Host rejection, GET-only endpoints, a static-file allowlist, CSP, disabled training, unknown-inventory burn blocking, dialog Escape behavior, snapshot failure handling, no browser runtime exceptions and no horizontal overflow at 1440/390/375px. It checks visible buttons are at least 44px tall. Screenshots are generated in an isolated temporary Chrome profile and their paths printed. Desktop/mobile screenshots were visually inspected; no full accessibility audit or complete site build is claimed.

The preview does not attach to #93 or inspect current production balances. Its safety dialog labels inventory and unresolved jobs UNKNOWN, not empty. Existing #93 gas-funding evidence is preserved in the burn audit. Warning acknowledgement cannot enable sacrifice.

### Sacrifice candidate selection checkpoint

The Training Room now opens **Browse Punks to Sacrifice**. The local server rechecks ownership/existence against its mock collection at the same block as the progression snapshot. It excludes the training target and already-burned fixture tokens. This bounded fixture list is NOT a production ownership indexer. The browser refreshes candidates on opening; failed reads clear selection, and responses from a closed/older picker cannot populate a newly opened one.

Candidate cards show artwork, token ID, progression at risk, and explicit UNKNOWN values for native funds, NFTs, ERC20s, missions/automation and pending transactions. Inspection lists all known wallet generations; no unknown value is converted to zero. Learned skills and unused credits on the sacrificed token do not transfer to the survivor. Review selection is not eligibility or consent: all candidates remain BLOCKED, no transaction route exists, and a Cancel & Keep Both Punks action exits review. No typed irreversible confirmation is offered while eligibility is blocked.

Browser/API regression coverage now also checks candidate exclusion, per-target candidate changes, trained-token warnings, mobile picker overflow, Escape dismissal and candidate-read failures. An optional `--port=NUMBER` argument keeps the loopback preview URL stable across restarts; it cannot change the RPC or bind address. Real wallet inventories, current production ownership discovery, safe migration/withdrawal and authorized burn submission remain future integration work.

## Remaining work, in order

1. **Security/semantic review of new contracts and resolver**. This is test-backed prototype code, not an audited production release. Add invariant/state-machine, event-indexing/reorg, hostile source and broader property tests.
2. **Real skill acceptance**. Zero new production READY skills. Contract Detective and sample Rarity Eye have narrow live evidence; Market Scout still needs successful authenticated live listing retrieval; Link Sniper/Mint Hunter need complete permitted live/test pipelines. Do not register test fixture manifests for production.
3. **Control Center integration and interactive training**. The isolated read-only Forge UI now exists. Mounting it into V2 with approved deployment configuration, authenticated current-owner loadout operations, actual wallet inventories, prerequisite-tree visualization and safe training transactions remains unfinished. Private-owner notes must remain separate.
4. **Live V2 policy/executor/MCP integration**. Tool filtering is necessary but cannot enforce restrictions on previously signed immutable wallet sessions. Approved on-chain executor/policy hook and deployment pinning must be reviewed with core V2. A capability mask never overrides policy, expiry, gas, reserve, simulation, blocked contracts or session authorization.
5. **Transfer automation pause and privacy verification**. Ownership checks deny an old owner after transfer, but a sell-and-buy-back can revive an old session unless an ownership epoch/revocation mechanism handles it. Durable transfer ingestion and new-owner activation must be integrated/tested. Private chat is not present in progression; application privacy regression coverage still needed.
6. **Usage mastery and achievements**. Level 1 learning exists; no successful-action counters or level-up path is implemented yet. Design receipt-backed, idempotent/reorg-aware proofs and progression/migration compatibility before claiming levels 2/3. No admin-created or failed-transaction XP.
7. **Production burn safety resolution**. Full asset inventory, all wallet generations, deposits, legacy obligations, races and post-burn recovery are unresolved. Native zero is insufficient. See [burn audit](v2-skill-forge-burn-audit.md).
8. **Controlled canary proposal**. Explicit configuration, code/hash verification, owner-reviewed limits and separate production authorization. No public burns or higher-risk paid/trading skills without approval.

Next deliverable: complete real-skill acceptance paths and review the V2 capability/transfer integration before mounting interactive training in the Control Center. Production asset safety and burn authorization remain blockers; a polished local preview does not resolve them.
