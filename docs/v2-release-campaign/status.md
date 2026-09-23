# Current Swarm funding release — 23 September 2026

Production: `7811eff1ddb343670b3ef19c547d762d75e8c511` (PR #78), Netlify deployment `6ab403c2eb714500080cf5ab`. Vercel remains paused; AI inference remains disabled. The [community brief](v2-community-brief-20260923.md) separates released, restricted and unavailable holder features.

| Workstream | Status | Owner / branch | Evidence / remaining gate |
|---|---|---|---|
| Recall and review-before-login repairs | LIVE | Release lead / main | Latest production browser: 15 screenshots, 26 served-file comparisons, zero errors; protected APIs reject unsigned requests. Owner wallet confirmation is still required for an actual recall. |
| Existing Swarm planner and individual gas deposits | LIVE | Release lead / main | Up to 10 Punks; local review before explicit login, retained choices, per-Punk authorization and deposits. |
| Dedicated holder Swarm Wallet contracts | TESTED | keep_hunting / feat/owner-swarm-wallet | 31 targeted Solidity tests including 256 fuzz cases; immutable owner, canonical Agent accounts, atomic manual batches. Not deployed. |
| Swarm Wallet browser adapter and panel | TESTED | funding_release_security + parent / feat/owner-swarm-wallet | 35 client/panel tests after fee/replacement recovery repair; local browser create/deposit/batch/withdraw at 1440/375/320, no errors or overflow. |
| Independent contract/client/panel review | READY_FOR_REVIEW | swarm_wallet_independent_review | No outstanding concrete P0/P1/P2 in reviewed scope; no independent full Forge rerun or live deployment verification. |
| Owner deployment review | TESTING | keep_hunting + parent / feat/owner-swarm-wallet | Two-provider read-only simulation passed. Replacement/cancellation recovery being completed before owner signature. No transaction broadcast. |
| Optional paid Training Credits | OWNER CANARY | Existing release | 0.0005 ETH plus gas; currently approved-owner website access, Rarity Eye release. Not public paid training for all holders. |
| General holder sacrifice | BLOCKED | Existing staged implementation | Asset/obligation inventory and pending-confirmation safety incomplete. No general burn release. |
| Public purchases / sweeps / WETH bids | BLOCKED | Existing staged implementation | Existing authority and marketplace release gates remain. |

New Swarm Wallet public manifest remains `null`: zero holder funding actions are exposed until deployment, runtime pinning and release validation. Manual funding grants no mission permission and never refills automatically. No production funds, NFTs, or ownership were changed during local wallet implementation.

The records below are historical and do not supersede this section.

---

# Current paid-training integration — 22 September 2026

**Whole-product verdict: NOT_READY.** Netlify maintenance is deployed; optional
paid training is locally implemented and tested, with payments disabled. Vercel
remains paused. The current source of holder-facing status is
[the functionality rundown](functionality-rundown-20260922.md).

| Workstream | Status | Owner / branch | Evidence / remaining gate |
|---|---|---|---|
| Netlify maintenance release | LIVE | Release lead / main | Commit `109b57fde726fdc2b2f461a85a4cef38e3888c11`; deploy `6ab27c0df8b88a0008b98e73`, published 13:02:59 UTC; served-file and signed-out desktop/mobile acceptance passed |
| Administrator skill recovery | LIVE | Forge specialist / main | Protected production endpoints reject unsigned requests; restricted DB configuration verified; registry mutations still need administrator wallet confirmation |
| Persistent research watching | DEPLOYED, OFF | Watch specialist / main | Additive migration applied among 46 production migrations; activation flag remains off; no spending authority |
| Optional paid Training Credit contract | TESTED | Contract specialist / feat/paid-skill-training | Price 0.0005 ETH; fixed confirmed treasury; 36 new contract tests, 346 full-suite pass; no deployment or payment |
| Paid API, canonical skills and burn coexistence | TESTED | Release lead / feat/paid-skill-training | 3,358 full JavaScript tests pass, two existing optional skips; private-chain purchase/learning/transfer/recovery pass |
| Paid browser flow | TESTED | Frontend specialist / feat/paid-skill-training | 24 desktop/mobile captures, all six operations and failure/recovery cases; synthetic wallet/API |
| Independent paid security review | READY_FOR_REVIEW | Independent reviewer / feat/paid-skill-training | No open P0/P1 in disabled implementation; release gates and residual immutable-contract limitations documented |
| Paid production release | BLOCKED | Release lead / feat/paid-skill-training | Reviewed usable registry catalog, exact constructor allowlist, owner-reviewed deployment, runtime pinning, production activation and live wallet acceptance remain |
| General holder burn | BLOCKED | Existing staged holder branch | Exhaustive source inventory/obligations and pending-confirmation safety boundary |
| Public purchases / floor sweeps | BLOCKED | Existing marketplace implementation | Production source, screening, limits, pending spend, guard, storage and live wallet acceptance |
| Public WETH bids | BLOCKED | Authority specialist | Original-account ownership round-trip revival; public bids remain off |

Burn remains available only through the existing selected-owner test flow. The
new paid extension does not alter the deployed burn ledger, accept legacy credits,
or grant wallet execution authority. Its committed release status is UNDEPLOYED,
with no extension address and productionPaymentsAuthorized false.

No production blockchain transaction was sent by this integration. The original
dirty checkout and paused migration worktree were preserved. The following
sections are historical and do not supersede the current record above.

---

# Earlier Netlify resumption — 22 September 2026

**Whole-product verdict: NOT_READY.** Vercel work remains paused. The active integration branch is `release/netlify-v2-main` in `/private/tmp/gogh-netlify-main`. Current evidence and gates are in [the Netlify resumption record](netlify-resume-20260922.md); [the release plan](../NETLIFY_V2_RELEASE_PLAN.md) supersedes earlier estimates.

| Workstream | Status | Owner | Branch | Current gate |
| --- | --- | --- | --- | --- |
| Saved campaign/admin recovery | TESTING | Release lead + Forge reviewer | release/netlify-v2-main / fix/netlify-skill-recovery | Native SQL/browser proof passed; restricted production role configured and verified; deployed acceptance and capability activation still gated |
| Persistent research watching | TESTING | Watch integration specialist | feat/netlify-persistent-watch, integrated | 58 native SQL assertions and browser proof passed; worker cost fixes integrated; production role/config/served checks pending |
| Function packaging | TESTING | Release lead | release/netlify-v2-main | Seven isolated packages verified; actual Netlify ZIP built locally |
| Full integrated validation | TESTING | Release lead | release/netlify-v2-main | 310 contracts, deployment gate and 3,309 JavaScript tests passed; final boundary checks passed |
| General holder Forge | BLOCKED | Separate staged holder branch | v2/campaign-holder-forge | Inventory/bootstrap, obligations and non-atomic deposit boundary |
| Public purchases/floor sweeps | BLOCKED | Marketplace review | Existing main implementation | Production source/policy/guard/database composition |
| Public WETH bids | BLOCKED | Independent marketplace review | Existing main implementation | Original-account transfer revival remains demonstrable |
| Netlify preview/production batch | TESTING | Release lead | release/netlify-v2-main | No new deployment until coherent local candidate passes |

No production blockchain transaction has been sent by this campaign resumption. Production remains `b442b44` until a newer deployment is explicitly recorded below.

---

## Historical campaign record (13–14 September; not current release evidence)

# V2 production-completion campaign

Started September 13, 2026. Current main audited at `b442b4425bf21b16d5186ed76333e2c42d3a6121` (PR #70). Existing production deployment was verified at that commit; fresh campaign production checks are in progress. The original dirty checkout, private wallet files, and holder practice sessions remain preserved.

## Live gap matrix and ownership

| Subsystem | State | Owner / worktree | Current implementation | Remaining dependency / acceptance |
|---|---|---|---|---|
| Release integration | TESTING | Lead / gogh-capabilities-integration | Main PR #70; 3,105 JS and 310 contract tests passed in preceding gate | Fresh production AI probes passed. Current campaign JS run: 3,193 pass, one outdated catalog expectation corrected, two optional native-only skips. Preview/deploy checks pending. |
| General Forge / burn | IMPLEMENTING | Forge specialist / gogh-final-marketplace | Deployed contracts; live source 1753 / target 93 owner canary; general training owner allowlist | Arbitrary eligible owned source/target, per-Punk source evidence/obligations, durable recovery, general owner release |
| Read-only skills / registration | IMPLEMENTING | Skills specialist / gogh-final-skills | Seven reviewed read-only package versions including Social Scout; API/MCP/UI adapters integrated | Independent review APPROVED_FOR_REGISTRATION; administrator wallet journal/recovery and native SQL review in progress; six new registry versions still need wallet confirmations |
| WETH ownership invalidation | SIMULATING | Authority specialist / gogh-final-weth | Opt-in authority candidate passed 22 contract tests and actual-original-collection copied-chain round-trip proof | Candidate requires collection administrator/validator migration, new authority-bound account path, independent review and marketplace compatibility; old public bids remain disabled |
| Persistent autonomy / missions | IMPLEMENTING | Authority specialist / gogh-final-weth | Shared workers/discovery and bounded sessions; selected paid mint delivered | Durable watch/taste/index and shared matching implementation in progress; economic authority remains separately scoped and expiring |
| ETH purchases / floor selection | BLOCKED | Marketplace follow-up | Signed-source adapter, durable journal and selected-purchase UI/core tested | Actual source/screen/policy/skills, restricted production DB, deployed guard, former-owner recovery navigation, live acceptance |
| Wallet / legacy recovery | AUDITING | Wallet follow-up | Owner ETH/gas/NFT recovery; V3/Agent custody separated | Supported ERC20 and legacy inventory/recovery breadth; release-safe UI |
| AI / chat / discovery | TESTING | Follow-up specialist | Five providers freshly LIVE-TESTED for chat + structured output: Groq, Gemini, OpenAI, Anthropic, xAI. Bankr stays disabled. | Persistent taste confirmation and watch decision presentation; shared discovery preserved |
| UX / instructions / mobile | AUDITING | Lead / frontend follow-up | Existing arcade UI and holder test guide; 25 browser scenarios | Feature-state truth, integrated field manual/test checklist, general Forge/autonomy UI, device handoff checks |
| Data / config / operations | AUDITING | Lead / scoped specialists | Existing protected runtime pools; staged marketplace schema | Fresh secret-presence/role checks, additive campaign schema, operator observability |
| Independent security / QA | TESTING | Fresh reviewers after implementation | Fresh independent read-services review passed 202 tests with no P0/P1 in that scope | New administrator transaction recovery, native SQL, general burn, authority and persistent watch still require their own reviews |

## Shared interfaces and edit ownership

Reuse current Punk identity (chainId, collection, tokenId), ownerOf authority, canonical wallet resolution, versioned skill manifests/registry, reviewed training transactions and durable intent state machines. Do not promote fixture callbacks into production evidence.

The lead owns release artifacts under deployments/, shared route/MCP seams, netlify.toml, main Control Center files, status/config documents, and integration. Specialists own their dedicated new files and explicitly assigned existing subsystem files. Any cross-subsystem signature or shared-file change must be agreed before editing.

No automatic real burn, purchase, bid, Punk-funded spend, or asset transfer. Prepare those actions for explicit owner wallet confirmation. Reviewed additive migrations, normal deployment, read-only skill registration and reversible services are authorized by the campaign; secrets stay server-side and never appear in reports.

## Acceptance terms

IMPLEMENTED, TESTED, SIMULATED, DEPLOYED, LIVE and LIVE-TESTED are distinct evidence. No whole-product completion verdict until the campaign acceptance matrix is satisfied. Unsupported/unsafe features stay explicitly disabled. A permanently active research/watch state does not imply unbounded or non-expiring economic authority.

## Current integration batch

- Base: `b442b44`. Root branch: `v2/release-campaign-20260913`, worktree `/private/tmp/gogh-capabilities-integration`.
- Integrated: `17e6943`, `f9118ba`, `aa3cb93`: Social Scout and exact reviewed read-only package release helper.
- Integrated: `eacb1c5`: independent review, pinned release artifact and protected operator readiness endpoint.
- Under integration review: `307cc2a`: administrator wallet setup, with rejected-request recovery follow-up required before production.
- Staged, not activated: Forge commits `283ca59` and `347b342`; dynamic owner/source/target checks and durable inventory/journal.
- Staged, not deployed: authority commit `8ec0a6a`; opt-in ownership-generation proof. This does not fix the existing Agent Account validation path.

## Explicit release blockers

General holder burning remains blocked by exhaustive source history, production obligation-reader composition and independent acceptance of the deployed contract boundary: current wallet inventories and ownership history are checked before wallet claim, but are not atomically bound into the deployed burn contract's state hash. Deposits or an ownership round trip while a wallet confirmation is pending require stronger protection or an explicitly reviewed release boundary. No general burn activation is claimed.

Native read-only database audit confirmed application and legacy/training databases are accessible with verified TLS. The new administrator and general burn tables are absent and need reviewed additive migrations. Marketplace request credentials remain absent. Existing historical and financial records are unchanged.

Production remains on `b442b44`; no campaign code is described as deployed until preview, production and served-file checks pass.
