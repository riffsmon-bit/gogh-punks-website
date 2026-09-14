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
