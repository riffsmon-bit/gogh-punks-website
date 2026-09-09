# Gogh Skill Forge — local implementation handoff

Checkpoint: September 9, 2026. Branch `feat/gogh-skill-forge`, isolated worktree `/private/tmp/gogh-skill-forge`.

**Local implementation and tests are ready to review; the full production product is not complete.** No push, production deployment, Netlify environment change, main-branch change, production skill registration, NFT burn or fund movement was performed by this checkpoint. Existing V2 agents are unchanged. Public burn controls remain locked.

## 1. Skill Forge architecture

Additive registry → token-ID progression → fresh capability resolver → reviewed tool implementations. Current canonical `ownerOf` controls changes. Skills enable capabilities; they do not authorize spending. Existing Punk custody, owner withdrawals and V2 architecture are retained. See [implementation details](v2-skill-forge-progress.md).

## 2. Burn support audit

The local collection source inherits owner/approved-operator burn from ERC721SeaDrop/ERC721A. Read-only owner simulation succeeded; nonowner simulation reverted. Burn emits a standard zero-address Transfer and decreases circulating supply. Deployed source/artifact equivalence and marketplace refresh behavior remain unverified. No broadcast occurred. See [burn audit](v2-skill-forge-burn-audit.md).

## 3. Punk Wallet burn safety

Existing accounts persist after parent burn, but canonical ownership lookup fails and their owner path becomes zero. Registry address resolution still works; this does not provide recovery authority. Accounts can receive later transfers. Punk #93 has recorded canonical wallet gas funds and is blocked. Empty native balance cannot prove absence of arbitrary tokens, deposits, pending transfers or legacy obligations. No general safe recovery design has been established; acknowledgement never bypasses a blocker.

## 4. Training credit model

One mock sacrifice atomically creates one credit for the surviving token ID. Credit buys one Tier-I skill OR one slot; no rarity multiplier. Duplicate sources and unauthorized issuance fail. Credits follow transfers. The training-source contract is immutable and security-critical: nonexistence alone does not prove a legitimate sacrifice. Only a chain-31337 mock source exists; no production source is approved.

## 5. Skill Registry

Append-only versions pin manifest/instruction hashes, capability masks and prerequisite. Review lifecycle requires TESTING plus evidence before READY. Disable/deprecation preserves learned history. Review evidence is an attestation, not proof that an audit occurred. There is no arbitrary browser installation or fund-withdrawal method.

## 6. Initial catalog and source counts

**Seven external repositories inspected; fourteen candidate surfaces evaluated; two hosted surfaces probed; zero external implementations vendored; three whole-runtime integrations rejected.** Three independent Gogh read paths have narrow live evidence and now have versioned packages plus local gated tests. These are not five fully accepted production skills. Detailed pinned commits, licenses, credentials, chain support and rejection reasons: [source audit](v2-skill-source-audit.md).

| Skill | Actual implementation/evidence | Status / authority |
|---|---|---|
| Contract Detective | PublicNode code/hash, ERC interface and EIP-1967 evidence; live read plus gated fixtures | TESTING / no wallet authority |
| Rarity Eye | Inline metadata retrieval and explicit sample trait ranking; live read plus gated fixtures | TESTING / no wallet authority |
| Market Scout | Fixed-host OpenSea GET reader; actual authenticated Robinhood listings, gated fixtures | TESTING / no wallet authority |
| Sniper | Existing V2 URL boundary identified; local learned-skill Mint Link/Floor Snipe choices | ADAPTING / no purchase or mint authority |
| Mint Hunter | Existing screened free SeaDrop construction/simulation identified | ADAPTING / full skill-gated acceptance unfinished |

The 13 browseable cards include roadmap concepts, not 13 working capabilities. Paid trading is not enabled.

## 7. Skill manifest format

`broker/skills/<slug>/v1/{SKILL.md,manifest.json}` binds chain, identity/version, capabilities/tools, empty wallet/executor grants for research, costs, level ceiling, implementation path/SHA-256 and source audit. Runtime verifies implementation hashes. Manifest hash is SHA-256 of recursively key-sorted canonical JSON; instruction hash is SHA-256 of exact UTF-8 bytes. Any change requires review/versioning; no runtime fetch of HEAD.

| v1 package | Manifest SHA-256 | Instruction SHA-256 |
|---|---|---|
| Contract Detective | `80695d48a12865c2c633b4977cd8f24dd598dd8808eae5ebf733052f8091ba24` | `1e283e611d6f72e8fa34d1412a5cbef8dd4d936f0138a5f18fdf519bafc93252` |
| Rarity Eye | `9f17224444ef8938c9d998754a6be4c9dce2029c5e6e6a5f918effdc276c0d26` | `7f7baae864b35a8230361de2ac3a6abda099669a6659e3d76e5bdf105bf859f0` |
| Market Scout | `558793169f07ac6af696cb2ad2f1d2a2678cc29b03fe9887586fb6a0fb0948e3` | `002f585d2764331cd2fbbe96b12a382143e8f698d066d2929993c84acff43cce` |

None of these hashes represents production approval. Default packages are unapproved TESTING and grant no tools.

## 8. On-chain state

Implemented locally: credit balances, consumed sacrifice IDs, learned version/level 1, unlocked slots, equipment and provenance events. New `GoghRaritySkillProgression` adds one-time owner claims against immutable snapshot/root. No production deployment. Mastery and achievements beyond initial learning are not implemented.

## 9. Off-chain state and frozen rarity

Instructions, manifests, rich display and source evidence remain off-chain. Private chat/preferences must remain owner-specific. Database/indexer integration is unfinished; local history reads contract logs.

Frozen OpenSea snapshot: 4,295 currently existing Punks, full token-set checks at recorded blocks, tied ranks preserved. Payload SHA-256:

`8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de`

Reviewed allocation root:

`0xf291febce8dc49ed133d39028f9b20061ea60c51d2e318096f122707dc558b97`

The committed review artifact explicitly says `productionAuthorized: false`. Leaf binds domain, chain, collection, snapshot hash, token ID and starting slots. All 4,295 proofs verify offline. The frozen dataset remains authoritative for this proposal despite later marketplace rank changes. See [snapshot status](v2-rarity-snapshot-status.md).

## 10. Capability resolution

One canonical resolver checks pinned deployment code/addresses, block consistency/freshness, current owner, equipment, learned version, registry status, package hashes and implemented tool identities. The shared call gate re-resolves for each invocation. Its output explicitly has no wallet authority. Public V2 endpoints have not yet been switched over.

## 11. MCP mapping

Contract Detective → `inspect_contract`; Rarity Eye → `get_metadata`, `rank_trait_sample`; Market Scout → `get_market_listings`. Actual read implementations are wired through the same gate. A missing market credential removes the market tool. Undeclared arguments are rejected. No raw transaction, signing, approval or arbitrary remote skill tool is exposed.

## 12. AI skill loading

Only effective approved/equipped packages supply provider-neutral context. Default TESTING packages supply none. Model provider is not custody or permission. No live GPT/Claude/Grok/Bankr route was changed by this work; provider integration remains a core seam.

## 13. Wallet capability mapping

Research grants NONE. Future free Mint Hunter must intersect existing reviewed mint executor/session, owner strategy, contract/adapter restrictions, price zero, gas, budget, reserve, expiry and successful simulation. Skill possession cannot override any owner limit. No module was installed. Existing signed sessions need coordinated on-chain enforcement; server tool filtering cannot retroactively change them.

## 14. Equip slots

Approved rarity bands: top 5% starts 3; through top 25% starts 2; remainder starts 1. Frozen allocation counts: 214 / 859 / 3,222. Maximum 7. Punk #93 starts 1 (rank 1,295), not a rarity bonus. Claim first, including one-slot allocation, before credit-funded slot unlock. Claim cannot create credits/skills or exceed the cap. Local preview uses labelled fixture capacity, not real holdings.

## 15. Transfer persistence

Learned skills, credits, slots, rarity claims and equipment follow token ID. Local direct/safe transfer tests retain progression and replace owner control. Burned parent loses effective capability. Actual marketplace transaction/indexer integration remains untested.

## 16. Transfer automation safety

Former-owner access denial is tested. Full durable transfer ingestion, reorg handling, privacy regression and economic-session invalidation are unfinished. Comparing current owner alone does not solve sell-and-buy-back resurrection; ownership epoch/revocation must be coordinated with core V2. No claim that all existing automation automatically pauses on transfer.

## 17. Skill levels

Permanent level 1 on learning exists. Levels 2/3, successful-receipt counters, mastery and achievements are not yet implemented. No failed attempt, chat message or fixture display earns real XP. Future progression must be idempotent and reorg-aware and must never weaken safeguards.

## 18. Skill tree

Local library has readiness/category filters and capability detail cards. Registry supports a prerequisite, but a complete interactive multi-branch skill tree and mastery visualization are not implemented. Roadmap cards cannot consume credits.

## 19. Burn UX

Local candidate picker excludes the selected training token and nonexistent/burned fixture IDs. It displays progression at risk, wallet generations and UNKNOWN inventory/state as BLOCKED. No production burn request exists. Typed irreversible confirmation is deliberately unavailable until real safety eligibility is solved; a warning alone is insufficient. The additive Forge guard enforces pre/post supply ≥1,111, but cannot prevent direct burns through the original collection.

## 20. Loadout UX

Local Training Room can learn fixture skills, unlock a slot, equip, replace and unequip using confirmed disposable Anvil transactions. It shows credits/history and does not auto-equip a learned skill. Guarded local POST accepts only fixed fixture IDs/actions, nonce, exact origin and expected block; simulates before submitting. No MetaMask or production key is used. Restarting discards this practice state.

## 21. Mobile UX

Chrome integration passed at 1440/390/375px with no horizontal overflow or runtime exceptions, candidate/dialog flow and local learn/equip. Buttons tested at least 44px tall. Mobile screenshot inspected. No full accessibility audit, all-device test or production Control Center mounting is claimed.

## 22. Security controls

Global/per-skill capability denial; immutable versions; current-owner checks; no unsafe foreign wallet installation; hash/code pinning; freshness/reorg rejection; separate economic permission; fixed API source; no secret in browser; production burn always blocked. Local HTTP only binds loopback, requires exact Host/Origin and per-launch nonce for writes, limits body/action/fixture scope and serializes writes. These are test-backed controls, not an independent audit.

## 23. JavaScript test results

**93 passed, 0 failed, 0 skipped** across `tests/skill-forge-*.test.mjs`, `tests/owner-assisted-seadrop-mint.test.mjs` and `tests/art-broker-v2-skills.test.mjs`. Includes frozen snapshot/proofs, tool gating, research implementations, all-wallet burn blockers, credit/local API and Chrome UI coverage. External provider acceptance is limited to evidence explicitly documented above; mocked calls are not counted as live tests.

## 24. Contract test results

**29 passed, 0 failed, 0 skipped**: 16 registry/progression, 5 supply policy and 8 rarity progression tests. Both fuzz tests used 1,024 runs. Separate real local Anvil integration passed JS Merkle proof → Solidity claim, mock sacrifice → credit → learn → equip → tool gate → transfer → old-owner denial → emergency disable. Zero production transactions.

## 25. Build results

Targeted offline Foundry build passed. Runtime sizes: Registry 3,175 bytes; base Progression 4,328; Rarity Progression 5,666, below contract size limits. Compiler/linter reports style/gas suggestions, not a clean independent security audit. JavaScript imported/executed in the suites above. No complete site/Netlify build or deployment was run; production site sources are unchanged.

## 26. Skills ready to activate

**Zero production READY skills.** Three read packages have working narrow tools and local gating, but still need reviewed deployed integration and acceptance. Disposable READY fixtures are test data only.

## 27. Skills requiring more engineering

Contract Detective: broader analysis and deployed acceptance. Rarity Eye: whole-collection methodology/revealed-state acceptance. Market Scout: freshness and precise listing semantics. Sniper/Mint Hunter: full URL/discovery → screened simulated intent → equipment/policy/session → confirmed permitted mint. Floor Snipe: reference floor, currency/order validation and separately approved purchase capability. Scheduled/paid/trading/mastery remain future work.

## 28. Controlled production canary plan

1. Resolve rollout compatibility below without changing running agents silently.
2. Complete independent security review, core ownership-epoch/executor integration and rollback design; separately solve production burn safety. Do not deploy progression with an arbitrary fake training source.
3. Start with disposable test collection/accounts and the same registry/gate; exercise real research reads and the complete permitted free-mint pipeline, reorg/expiry/transfer/disable cases. Production burns stay disabled.
4. Produce reviewed deployment addresses/code hashes, registry evidence/package hashes, exact chain/owner/token and credential scope; verify no main/public exposure.
5. Request narrowly scoped production read-only canary authorization. Progress to economic canary only with exact approved account, mint target, value/gas/total caps, quantity, expiry, stop condition and session policy; require owner wallet confirmation.
6. Reconcile confirmed receipts and asset ownership; test callback/revoke/transfer pause before any wider rollout. Burn authorization is a separate later decision, never inferred from a mint canary.

## 29. Remaining risks / decision needed

Immediate skill enforcement would stop existing untrained V2 agents. An opt-in path preserves those agents but needs explicit owner-selected Forge enrollment and clear capability enforcement after enrollment. This is a product/core compatibility decision, not a switch to choose silently.

Other blockers: no universal empty-wallet proof/recovery; arbitrary incoming assets and pending obligations; source/artifact verification; irreversible-source safety; old-session enforcement/ownership epoch; private chat isolation; full acceptance for five skills; XP/indexing/tree/admin/analytics; production UI integration. These are not solved by passing the local tests or freezing rarity.

## 30. Exact production authorization required

Current authorization covers local/test work, not public real burns. Before any production change, approve the specific feature branch/deployment target, contracts/code hashes/configuration, owner/guardian roles, rollout mode and canary limits. No approval can substitute for unresolved wallet asset safety. A real sacrifice requires a separately reviewed recovery/eligibility design plus explicit authorization naming the sacrificed token, surviving token, immutable training source and irreversible outcome. No such authorization or burn readiness exists at this checkpoint.

## Reproduce locally

```sh
forge test --offline --match-contract 'Gogh(SkillForge|RaritySkillProgression|ForgeSupplyPolicy)Test' --fuzz-runs 1024
node --test tests/skill-forge-*.test.mjs tests/owner-assisted-seadrop-mint.test.mjs tests/art-broker-v2-skills.test.mjs
node scripts/test-skill-forge-local.mjs --local-only
node scripts/dev/skill-forge/prepare-rarity-allocation.mjs
node scripts/dev/skill-forge/preview-server.mjs --local-only --port=64339
```

Requires existing dependencies, Foundry/Anvil on PATH, compiled artifacts and local Chrome for browser tests. Preview uses only its own disposable chain 31337; no production RPC override, credentials or browser signer.
