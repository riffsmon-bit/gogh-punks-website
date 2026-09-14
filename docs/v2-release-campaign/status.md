# V2 production-completion campaign

Started September 13, 2026. Current main audited at `b442b4425bf21b16d5186ed76333e2c42d3a6121` (PR #70). Existing production deployment was verified at that commit; fresh campaign production checks are in progress. The original dirty checkout, private wallet files, and holder practice sessions remain preserved.

## Live gap matrix and ownership

| Subsystem | State | Owner / worktree | Current implementation | Remaining dependency / acceptance |
|---|---|---|---|---|
| Release integration | AUDITING | Lead / gogh-capabilities-integration | Main PR #70; 3,105 JS and 310 contract tests passed in preceding gate | Fresh campaign served/config checks; integrate and rerun affected/full gates |
| General Forge / burn | IMPLEMENTING | Forge specialist / gogh-final-marketplace | Deployed contracts; live source 1753 / target 93 owner canary; general training owner allowlist | Arbitrary eligible owned source/target, per-Punk source evidence/obligations, durable recovery, general owner release |
| Read-only skills / registration | IMPLEMENTING | Skills specialist / gogh-final-skills | Rarity Eye owner canary; seven additional implemented research packages; Social Scout missing | Real source acceptance, exact registration/READY evidence, release/UI integration |
| WETH ownership invalidation | AUDITING | Authority specialist / gogh-final-weth | Copied offers work; old offer revives after ownership round trip | Durable contract/permission solution, adversarial proof, compatibility/deployment review |
| Persistent autonomy / missions | AUDITING | Lead initially | Shared workers/discovery and bounded sessions; selected paid mint delivered | Persistent activation/taste/index/state, execution skill/policy bounds, immediate pause/transfer enforcement, wider supported missions |
| ETH purchases / floor selection | BLOCKED | Marketplace follow-up | Signed-source adapter, durable journal and selected-purchase UI/core tested | Actual source/screen/policy/skills, restricted production DB, deployed guard, former-owner recovery navigation, live acceptance |
| Wallet / legacy recovery | AUDITING | Wallet follow-up | Owner ETH/gas/NFT recovery; V3/Agent custody separated | Supported ERC20 and legacy inventory/recovery breadth; release-safe UI |
| AI / chat / discovery | AUDITING | Follow-up specialist | Five previously live-tested providers; Groq free; Bankr disabled; shared discovery | Current probes, structured/action states, new capability wiring, persistent taste confirmation |
| UX / instructions / mobile | AUDITING | Lead / frontend follow-up | Existing arcade UI and holder test guide; 25 browser scenarios | Feature-state truth, integrated field manual/test checklist, general Forge/autonomy UI, device handoff checks |
| Data / config / operations | AUDITING | Lead / scoped specialists | Existing protected runtime pools; staged marketplace schema | Fresh secret-presence/role checks, additive campaign schema, operator observability |
| Independent security / QA | NOT_STARTED | Fresh reviewers after implementation | Preceding release review passed in bounded scope | Review changed authority, real source results, composed UI/DB/contracts, production boundaries |

## Shared interfaces and edit ownership

Reuse current Punk identity (chainId, collection, tokenId), ownerOf authority, canonical wallet resolution, versioned skill manifests/registry, reviewed training transactions and durable intent state machines. Do not promote fixture callbacks into production evidence.

The lead owns release artifacts under deployments/, shared route/MCP seams, netlify.toml, main Control Center files, status/config documents, and integration. Specialists own their dedicated new files and explicitly assigned existing subsystem files. Any cross-subsystem signature or shared-file change must be agreed before editing.

No automatic real burn, purchase, bid, Punk-funded spend, or asset transfer. Prepare those actions for explicit owner wallet confirmation. Reviewed additive migrations, normal deployment, read-only skill registration and reversible services are authorized by the campaign; secrets stay server-side and never appear in reports.

## Acceptance terms

IMPLEMENTED, TESTED, SIMULATED, DEPLOYED, LIVE and LIVE-TESTED are distinct evidence. No whole-product completion verdict until the campaign acceptance matrix is satisfied. Unsupported/unsafe features stay explicitly disabled. A permanently active research/watch state does not imply unbounded or non-expiring economic authority.
