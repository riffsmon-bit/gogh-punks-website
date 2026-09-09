# Skill Forge implementation checkpoint

Local feature branch: `feat/gogh-skill-forge`. No push, production deployment, environment change, real NFT burn or transfer is part of this checkpoint. Core V2 remains unchanged.

Latest approved product configuration: **seven maximum equipped skills**, rarity-based starting slots of 3 (top 5%), 2 (next band through top 25%) or 1 (remainder), and no rarity multiplier for sacrifices. One sacrifice grants one credit, spent on one slot OR one approved Tier-I skill. The local UI fixture uses cap seven; old contract regression fixtures retain their independent cap-four test cases. The complete OpenSea rarity snapshot is **captured and verified: 4,295 Punks**; no real token bonus has been assigned. See [snapshot retrieval status](v2-rarity-snapshot-status.md). Latest combined JavaScript run: **93 passed**. Solidity: **29 passed**, with 1,024 runs for each fuzz test. Market Scout has authenticated live read evidence, not production approval. The [current handoff](v2-skill-forge-handoff.md) supersedes historical counts below.

## Implemented and exercised locally

- **GoghSkillRegistry**: append-only skill/version identity; immutable manifest/instruction/capability/prerequisite mapping; controlled review statuses; READY requires TESTING plus evidence hash; per-skill and capability/global emergency disable; permanent deprecation with explicit replacement. Governance attests review—it cannot cryptographically prove an audit was performed. It has no fund-withdrawal methods.
- **GoghSkillProgression**: credits attached to token ID; one credit per source sacrifice identity; one-credit learn/unlock economy; current owner controls loadout; learned version level 1, unlocked slots and equipment survive transfers; no duplicate equipment; deterministic equipment-based capability mask. Learned history persists when a version becomes unsafe.
- **Configuration**: immutable collection, registry and training source. Slot base/cap are explicit constructor parameters, bounded to 32 for execution cost; independent contract regression fixtures use 1 base / 4 cap, while the approved product and disposable UI use a seven-slot cap. Changing immutable deployed configuration would require a separately reviewed migration, not silent admin mutation.
- **Canonical resolver**: reads owner, registry, progression and equipment at one block; verifies deployment code hashes and configured addresses; detects reorg during reads; validates local package/instruction hashes against learned on-chain versions; only exposes approved, implemented tool identities; produces provider-neutral instruction context. A missing/disabled/deprecated/unapproved/unequipped skill grants no tools.
- **MCP/AI integration seam**: `createSkillToolGate` uses the same fresh resolver for context and calls, checks selected Punk identity and current owner, rejects token/owner substitution, and never returns wallet authorization. No live V2 endpoint has been switched to this gate yet.
- **Burn warning prototype**: inventories all known wallet generations and outstanding state; native/ERC20/NFT/deposit/unknown findings block. Always `canBurn=false` in production-facing advisory code. Unmounted component; not a published burn page.
- **Local Forge UI**: arcade-style Punk selector, learned/equipped distinction, empty/locked slots, capability detail dialogs with fixture hashes, readiness labels, training history from local contract logs and blocked-burn safety explanation. Three disposable mock Punks use existing collection artwork; they are explicitly not production holdings. Practice controls now learn, unlock, equip and unequip on the server's own disposable Anvil, with preflight simulation and confirmed receipts. Exact loopback Host/Origin, a per-launch nonce, request allowlists, current fixture ownership, stale-block rejection and serialized mutations guard the local POST route. No browser wallet connection, production signer, burn route or live training control. Files remain outside Netlify's `site` publish directory. This is a local integration harness, not completed V2 Control Center integration.
- **Frozen rarity allocation**: new additive `GoghRaritySkillProgression` binds an immutable Merkle root and snapshot hash. Current owners claim permanent token-specific starting capacity; no credits or economic authority are created. A claim is required before paid slot unlocks, including one-slot claims, preventing late bonuses from exceeding seven slots. All 4,295 proofs verify offline; a JavaScript-built proof is accepted by Solidity on local Anvil. No production claim contract is deployed.
- **Executable research packages**: Contract Detective, Rarity Eye and Market Scout now have v1 instructions/manifests binding real implementation hashes. The shared research runtime routes actual read implementations through the canonical owner/equipment gate. Packages remain unapproved TESTING; local test approval is not production registration. No foreign wallet or dynamic package installation exists.

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
forge test --offline --match-contract 'Gogh(SkillForge|RaritySkillProgression|ForgeSupplyPolicy)Test' --fuzz-runs 1024
node --test tests/skill-forge-*.test.mjs tests/owner-assisted-seadrop-mint.test.mjs tests/art-broker-v2-skills.test.mjs
node scripts/test-skill-forge-local.mjs --local-only
```

The integration runner starts its own loopback-only Anvil, uses unlocked local fixture accounts, accepts no RPC override, loads no private keys, and terminates its local node afterward. It requires compiled Foundry artifacts and Anvil installed.

### Preview the Forge locally

From this feature worktree, with Anvil on PATH and Foundry artifacts already compiled:

```sh
node scripts/dev/skill-forge/preview-server.mjs --local-only
```

Open the loopback URL printed by the process. Stop it with Ctrl-C. Each launch deploys a new disposable mock collection, registry and progression on chain 31337. Mock Punk #1 starts with two learned skills, one equipped skill, two unlocked slots and one remaining credit, created through actual local mock-sacrifice transactions. Mock Punk #44 is untrained. Mock Punk #7 now has a learned, unequipped Sniper fixture to demonstrate both mission choices. Three definitions are marked READY only on this disposable chain; their actual production statuses remain TESTING or ADAPTING. No external skill is promoted to production READY by this preview.

Browser/API regression:

```sh
node --test tests/skill-forge-preview.test.mjs
```

This test requires local Google Chrome on macOS and Anvil. It checks on-chain credit/equipment/history reads, token selection isolation, wrong-origin/Host rejection, read-only data endpoints, a static-file allowlist, CSP, disabled production training, unknown-inventory burn blocking, dialog Escape behavior, snapshot failure handling, no browser runtime exceptions and no horizontal overflow at 1440/390/375px. It also learns/equips a local fixture through the browser; separate local-training API tests cover nonce, stale state, action allowlist and credit accounting. Visible buttons are at least 44px tall. Screenshots are generated in an isolated temporary Chrome profile and their paths printed. Desktop/mobile screenshots were visually inspected; no full accessibility audit or complete site build is claimed.

The preview does not attach to #93 or inspect current production balances. Its safety dialog labels inventory and unresolved jobs UNKNOWN, not empty. Existing #93 gas-funding evidence is preserved in the burn audit. Warning acknowledgement cannot enable sacrifice.

### Sacrifice candidate selection checkpoint

The Training Room now opens **Browse Punks to Sacrifice**. The local server rechecks ownership/existence against its mock collection at the same block as the progression snapshot. It excludes the training target and already-burned fixture tokens. This bounded fixture list is NOT a production ownership indexer. The browser refreshes candidates on opening; failed reads clear selection, and responses from a closed/older picker cannot populate a newly opened one.

Candidate cards show artwork, token ID, progression at risk, and explicit UNKNOWN values for native funds, NFTs, ERC20s, missions/automation and pending transactions. Inspection lists all known wallet generations; no unknown value is converted to zero. Learned skills and unused credits on the sacrificed token do not transfer to the survivor. Review selection is not eligibility or consent: all candidates remain BLOCKED, no transaction route exists, and a Cancel & Keep Both Punks action exits review. No typed irreversible confirmation is offered while eligibility is blocked.

Browser/API regression coverage now also checks candidate exclusion, per-target candidate changes, trained-token warnings, mobile picker overflow, Escape dismissal and candidate-read failures. An optional `--port=NUMBER` argument keeps the loopback preview URL stable across restarts; it cannot change the RPC or bind address. Real wallet inventories, current production ownership discovery, safe migration/withdrawal and authorized burn submission remain future integration work.

## Sniper and expanded library checkpoint

The local library now contains **13 browseable entries**, not 13 functioning production skills. Five existing development fixtures are joined by eight unregistered roadmap candidates: Scheduled Hunter, Art Curator, Social Scout, Paid Mint License, Collection Researcher, Listing Watcher, Portfolio Curator and Whitelist Scout. Research, discovery, execution and locally learned filters make these navigable. Roadmap cards say Coming Soon, include source evidence and missing work, have no registry key/hash/approved tools, and cannot consume credits. Source-sharing variants are not counted as independently tested upstream implementations. No new production SKILL.md packages or registry entries were created.

Sniper is the proposed single-skill product experience with **Mint Link** and **Floor Snipe** choices. Local Punk #7 demonstrates choosing either chat template after learning the fixture; unlearned Punks can inspect but not select the templates. Both templates require explicit price/currency, quantity, total budget, gas, reserve and deadline, with owner confirmation. Templates are not dispatched. The fixture still grants only LINK_REVIEW, is unequipped, and has no mint/purchase authority. Broader production versions require explicit versioning and separate capability review; an old Link Sniper manifest is never silently expanded into marketplace signing.

At this earlier library checkpoint, the combined JavaScript regression run was **68 passed**, including library non-authority invariants, strict learned-state checks, both Sniper choices, category/learned filters, roadmap detail warnings and existing desktop/mobile/HTTP/sacrifice tests. No contract code changed in that checkpoint. Its cap-four UI fixture was subsequently updated to the approved seven-slot policy described at the top of this document. The [rarity-slot rules](v2-rarity-slot-proposal.md) and frozen data baseline are now approved/captured; production application is still not deployed.

## Remaining work, in order

Latest supply-floor addition: [1,111 minimum Forge supply policy](v2-forge-supply-floor.md). Advisory checks and a pre/post Solidity guard library are implemented and tested, but no production burn source is enabled. Direct owner burns in the existing collection cannot be stopped by this additive guard. Updated combined JavaScript suite: **71 passed**. The prior 16 progression contract tests remain passing; five new supply-policy tests cover boundary/race/rollback behavior. Current production supply was read as 4,295 at block 58212032; no NFT was burned.

1. **Security/semantic review of new contracts and resolver**. This is test-backed prototype code, not an audited production release. Add invariant/state-machine, event-indexing/reorg, hostile source and broader property tests.
2. **Real skill acceptance**. Zero new production READY skills. Contract Detective, sample Rarity Eye and Market Scout have narrow live evidence; OpenSea's complete collection rank capture also succeeds. Market Scout still needs freshness/order-validity acceptance and gated integration. Link Sniper/Mint Hunter need complete permitted live/test pipelines. Do not register test fixture manifests for production.
3. **Control Center integration and live training**. The isolated interactive local Forge UI now exists. Mounting it into V2 with approved deployment configuration, authenticated current-owner wallet operations, actual wallet inventories, prerequisite-tree visualization and safe production training transactions remains unfinished. Private-owner notes must remain separate.
4. **Live V2 policy/executor/MCP integration**. Tool filtering is necessary but cannot enforce restrictions on previously signed immutable wallet sessions. Approved on-chain executor/policy hook and deployment pinning must be reviewed with core V2. A capability mask never overrides policy, expiry, gas, reserve, simulation, blocked contracts or session authorization.
5. **Transfer automation pause and privacy verification**. Ownership checks deny an old owner after transfer, but a sell-and-buy-back can revive an old session unless an ownership epoch/revocation mechanism handles it. Durable transfer ingestion and new-owner activation must be integrated/tested. Private chat is not present in progression; application privacy regression coverage still needed.
6. **Usage mastery and achievements**. Level 1 learning exists; no successful-action counters or level-up path is implemented yet. Design receipt-backed, idempotent/reorg-aware proofs and progression/migration compatibility before claiming levels 2/3. No admin-created or failed-transaction XP.
7. **Production burn safety resolution**. Full asset inventory, all wallet generations, deposits, legacy obligations, races and post-burn recovery are unresolved. Native zero is insufficient. See [burn audit](v2-skill-forge-burn-audit.md).
8. **Controlled canary proposal**. Explicit configuration, code/hash verification, owner-reviewed limits and separate production authorization. No public burns or higher-risk paid/trading skills without approval.

Next decision: whether existing V2 agents remain unchanged until explicit owner opt-in, or immediately require learned/equipped Mint Hunter. Immediate enforcement would stop untrained agents; silent grandfathering would change the requested skill economy. Neither behavior has been activated. Complete live skill acceptance and core transfer/session integration after that rollout decision. Production asset safety and burn authorization remain separate blockers; the local preview does not resolve them.
