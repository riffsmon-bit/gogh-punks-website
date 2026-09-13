# Independent final capability integration review

**Verdict: PASS_FOR_CONTROLLED_TESTING_AND_REVERSIBLE_CODE_RELEASE**, subject to the lead's final full validation and served-preview checks. No P0, P1, or P2 integration finding remains in this review scope. This is not approval to deploy new financial contracts, release additional skills, burn a production Punk, buy listings, post bids, or move funds.

Reviewed September 13, 2026, at `5bc966771bc4afb19515a39f49a447c0a49df09d`, against published PR #67 / `origin/main` at `8c848176346e3077976f2c11246647e2364f6e95`. The committed diff contains 84 files. The lead's concurrent changes to testing guides, status and final browser evidence are outside that immutable diff; production source hashes below identify the reviewed implementation.

## Scope and findings

The review inspected the complete file inventory and the public integration seams: MCP dispatch and authentication, exact skill package selection, the new read-only mint context, package source verification, Netlify runtime files, Forge display state, selected-burn source checks, registration proposals, marketplace activation boundaries, and the historical Forge build fixture. It also checked the independent [real-skills review](../v2-hardening/real-skills-independent-review.md), [marketplace core review](../v2-marketplace/independent-security-review.md), and [practice review](../v2-marketplace/practice-independent-review.md). Their specialized proofs remain attributed to their authors; this review does not claim to repeat their live-fork or native PostgreSQL work.

| Boundary | Finding |
| --- | --- |
| Production financial activation | No new public marketplace endpoint, deployment manifest, production order posting, or execution switch is added. Marketplace preparation returns a null transaction without trusted purchase-guard deployment pins. WETH construction requires an explicitly owned disposable-chain dependency and assertion. New Solidity contracts remain candidates. |
| Existing wallet and V1 behavior | No existing account/registry contract, account deployment manifest, withdrawal implementation, V1 code, existing strategy policy, worker or executor is changed. The new mint reader observes the canonical AGENT account; it does not change baseline diagnostic wallet semantics or grant a session. |
| Burn authority | The generic training and separate selected-burn release files are byte-identical to published main. The pre-existing selected #1753-to-#93 owner canary remains a distinct authority; generic `productionBurnAuthorized: false` must not be described as globally disabling that canary. The new checkpoint advances standard-transfer evidence, not the allowed owner, source, recipient, confirmation, approval or send permissions. No production burn was performed by this review. |
| Burn evidence | The source extension has an exact pinned digest and contiguous bounded ranges extending the prior evidence. Current checks revalidate its canonical anchor with both configured providers, then require subsequent history, balances, undeployed wallets, derivation/runtime, nonces and operational records. Any observed standard transfer or failed page blocks eligibility. Nonstandard assets and off-chain obligations remain explicit owner-review limits; this evidence is not a universal inventory assertion. |
| Skill activation | New packages load as unapproved `TESTING`. Only the trusted release's exact skill key and both package hashes allow the runtime's existing local approval mapping. The actual release still contains only Rarity Eye v1. No additional registry READY transition, enabled mask or release entry is added. Registration artifacts remain proposals and omit an executable READY/activation operation. |
| Existing Rarity Eye | The current immutable v1 implementation, manifest and instructions are unchanged. The default diagnostic catalog remains Contract Detective v1, Rarity Eye v1 and Market Scout v1. The MCP selection chooses only Rarity Eye v1 from the actual current release, while retaining the original bounded sample and learned/equipped gates. Baseline tool names and stored-evidence semantics remain unchanged. |
| MCP authority | New equipped aliases route through the existing selected-owner and skill gates. Caller arguments cannot substitute owner, wallet, strategy, usage, endpoint, package version or transaction bytes. Current owner, training state and continuity are checked again after work. Mint output is a recommendation with null transaction, no signing authority, no execution reservation and explicit simulation limits. |
| Database | No migration, grant, RLS policy or production write is added. Usage reads require complete SELECT visibility and reject unknown accounting. The selected-paid path uses its existing restricted request role and explicitly rejects access to raw signed transaction bytes. Cross-database observations remain non-atomic and cannot substitute for a future execution reservation. |
| Secrets and packaging | Added runtime includes contain source, public release data and a public CA certificate. They are function files, not browser-published assets. No credential file or private key is included. Changed files were scanned for recognizable provider-key, private-key and credential-URL patterns; the only URL match was a deliberate synthetic error-redaction fixture under `provider.invalid`. No real secret was read or printed. |
| Public frontend | New Forge library labels are display-only. The training link navigates to the existing durable panel, and labels cannot grant a tool, credit or transaction. Selected-owner validation, response clearing, current selection checks and explicit wallet-review behavior remain intact. |

No release-blocking integration defect was found. One documentation-only cleanup was sent to the lead: `versioned-skill-mcp-integration.md` still said “READY FOR INDEPENDENT REVIEW” after the specialist review had completed. That wording does not affect runtime safety or capability availability.

## Independent validation

This reviewer ran:

```sh
node --test tests/v2-swarm-mcp.test.mjs \
  tests/v2-mcp-versioned-skills.test.mjs \
  tests/real-skills-independent-review.test.mjs \
  tests/skill-forge-research-runtime.test.mjs \
  tests/skill-forge-deployment.test.mjs \
  tests/skill-forge-source-history-extension.test.mjs \
  tests/skill-forge-selected-burn-api.test.mjs \
  tests/skill-forge-library-state.test.mjs \
  tests/v1-retired-entrypoints.test.mjs
```

**89 tests passed, zero failed, skipped or cancelled**, in 10.93 seconds. These exercise real local dispatch/runtime code with controlled chain/service fixtures; they do not establish a new production RPC or provider-health result. `git diff --check origin/main...HEAD` also passed.

The reviewer separately copied each function's actual `included_files` into a new temporary root and called the real catalog loader against only those files. All temporary roots were removed after inspection. Results:

| Function | Raw included files / bytes | Loaded catalog | Current accepted package |
| --- | ---: | --- | --- |
| `broker-v2-forge` | 50 / 297,374 | Three existing v1 diagnostic packages | Rarity Eye v1; exact release hashes match |
| `broker-v2-forge-skill` | 52 / 1,311,784 | Three existing v1 packages | Rarity Eye v1; exact release hashes match |
| `broker-v2-mcp` | 80 / 482,778 | Exact current release selection | Rarity Eye v1; exact release hashes match |

These are raw included-file totals, not final compressed function bundle measurements. The independent package regression in the 89-test run additionally loads all six explicitly reviewed versions from the actual MCP include patterns and verifies the public database CA fingerprint. Static bundling alone would not prove these runtime source-byte reads, so the filesystem tests matter.

## Historical Forge fixture assessment

The fixture change is test-only. Original accepted setup, finalized evidence, plan hash, deployment manifests and production validation helpers are unchanged. The test reloads the current compiled artifacts through the existing build loader, hashes their actual creation bytecode, runtime template and metadata against the recorded pins, then compares complete immutable-reference groups. It preserves each group's offsets, lengths, multiplicity and membership; only compiler AST identifiers and group ordering are ignored for equivalence.

The frozen historical maps themselves must reproduce their original hashes. Reconstructed pins and aggregate build hash must match the accepted historical plan before the unchanged manifest verifier runs. Fresh deployment tests still use current artifacts, and the historical plan cannot validate directly against a different current build hash. Regression cases reject shifted offsets, changed lengths, split/merged/regrouped references, duplicate occurrences, changed historical identifiers and changed compiled content. This preserves meaningful historical evidence instead of rewriting the accepted plan to make new compilation pass.

## Source identity

| File | SHA-256 |
| --- | --- |
| `netlify.toml` | `a521dcd2f7fc787fe01c5a30fbc186600a3a20080dad6904bd6ece69c1326a8c` |
| `netlify/functions/_shared/v2-mcp-research.mjs` | `cd3a7920dcfce2424ca7640a732d6a42cd4efd02c0f1e1c84f8ba82174ab3913` |
| `netlify/functions/_shared/v2-mint-research-context.mjs` | `61f5bbeacf1297d8a4160fc6b5d273ec97d19841ca9d007638fb604c86a65ba2` |
| `broker/src/v4/skill-forge/research-runtime.mjs` | `d490b9432c89d006c3e516fa04272ba87ed6987c35b7078d39013762a27b48c4` |
| `broker/src/v4/skill-forge/selected-burn-source.mjs` | `4a30e84e7dbec4d8e3cf372a6180667c42c1afe29cddf538df240d336f72625d` |
| `site/broker-v2-forge.js` | `3bb2bf3e71fca47d1d8f19932280e229cbcebcf460b43c068c4a97b6e87e291c` |
| `site/forge-library-state.js` | `4cf00132cd1cfeb27e9099ff83fb34bbc872011bd80b43e58ae46a346df05b68` |
| `tests/skill-forge-deployment.test.mjs` | `7c195ee5df80fdd01b96fde7533a6f7defa475dd7b908a6300900df12dbfa6e4` |
| `tests/fixtures/forge-accepted-build-immutable-references.json` | `b2e7a32f3310dc7ae47dba957bcb65786834776f8c7e8f98002a01333c674d8a` |
| `deployments/robinhood-forge-training.json` — unchanged | `20d325846a6cce0e64431bc9886c7c35988703c4003a046ebb95eb6c68d3de2f` |
| `deployments/robinhood-selected-burn.json` — unchanged | `20ffe75be328c070bb996b419752eccf041516293dab4a366b7860047f6a2efa` |
| `deployments/robinhood-punk-agent-account.json` — unchanged | `637cabf7ab4f698ecb4d2c1a40afea0c7fd84776631b49f6371af2194d6ebdf9` |
| `contracts/src/GoghPunkAgentAccount.sol` — unchanged | `9324d9a2cfded428db0f454459ce9c957e5020a3b9be7102815bd40e94321c67` |
| `contracts/src/GoghPunkMarketplaceGuard.sol` — new candidate | `cb9084cde5e785985c1dbd7ac06d68d884983b51fb81af578c0e97b9776af226` |
| `contracts/src/GoghPunkMarketplaceBid.sol` — new candidate | `39d9ec5fc15365df076be8faf1d89c11ba0afeaf5b2817f4d67e0a86bb5253d3` |

## Remaining release gates and limits

The lead owns final full repository validation, fresh Control Center/browser proof, preview/runtime checks, and any reversible production code publication. Those are not inferred from this finite targeted run. At report completion, the lead reported the integrated site gate passing 2,732/2,732 tests without skips or failures, the contract gate passing 305 tests, 25 Control Center browser scenarios with 59 captures, and nine repaired marketplace browser journeys with seven captures. These are lead-executed results, not additional runs by this reviewer. Draft PR #68 was created at `59504cf`; its preview/runtime verification was still pending. Existing independent marketplace sign-off requires a new practice process after source repairs; the lead's marketplace result used that fresh process, with its evidence retained separately.

Public native purchases still require reviewed deployment and pinning of the guard plus authenticated production review/journal integration. Public WETH remains blocked by original-Punk away-and-back ownership continuity and unverified OpenSea acceptance/posting of the restricted escrow order. Local Seaport settlement cannot close those public gates. New skills require separate registry/release activation and live adapter/context acceptance; this code review does not mark them publicly READY. The user has kept Bankr disabled; this diff changes no Bankr/provider configuration.

The reviewer changed only this report. No production code, test, credential, external service, git commit, user browser state or running practice node was changed. No signature or public transaction was requested.
