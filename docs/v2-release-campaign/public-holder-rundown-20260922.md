# Current holder functionality — 22 September 2026

**Options-based V2 is deployed at <https://goghpunks.xyz/>. Full public V2 remains
incomplete.** Production commit `6d03fa800e708fe1edb573e6295f86a5b645343a`, Netlify
deployment `6ab2a6ada57dfe000840503e`, published 16:05:02 UTC.

This supersedes the earlier same-day maintenance-release rundown. Netlify remains
the host. Vercel migration is paused.

## What users can access

| Feature | Actual released scope |
|---|---|
| V2 homepage | The main domain opens V2. Existing `/broker/v2/` bookmarks and legacy recovery routes still work. |
| Agent options | Actions replaces free-text chat. Choose recommend-only, prepare-for-approval or permission-gated free-mint automation; art preference; daily/total limits; reserve; maximum network fee. Review complete rules before saving. |
| AI | Disabled with `GOGH_AI_COST_MODE=OFF`. The provider picker and chat entry are removed. Rule drafts and action shortcuts use deterministic code. Keys are retained but no provider is eligible. This removes app inference usage; hosting, external infrastructure, network fees and development-tool charges are separate. |
| Wallet connection and Punk roster | Existing signed-session, current-owner and selection flows retained. The latest production check was signed out, not a fresh real-wallet acceptance. |
| Balances, funding and NFT collection | Existing controls retained. Funding requires wallet confirmation. Collection discovery can be incomplete when an upstream source fails; missing cards do not establish missing custody. |
| ETH and NFT withdrawals | Existing current-owner wallet flows retained. No live asset transfer performed in this release. |
| ERC20 withdrawals | New Collection control for standard tokens held by the verified V3 Punk Wallet or Agent Account. Enter a token address, inspect, review, confirm in the owner wallet and reconcile the original receipt. Destination is the current owner. Unsupported token behavior fails closed; this is not support for every possible ERC20 implementation. V1/V2 retain legacy recovery links. |
| Public paid mint review | New owner-confirmed, one-NFT direct mint through an activated Agent Account. Supported reviewed SeaDrop Studio runtime only, price at most 0.001 ETH, active sale and live limits required. Owner pays exact mint price plus network fee; NFT goes to the Agent Account. No new escrow or worker fee. This is not an unattended paid mission. |
| Link inspection | Existing supported-contract/link inspection remains. A recognized URL does not automatically mean a mint can be executed. |
| Free-mint missions | Existing bounded account/session, adapter, simulation and spending rules retained. Choosing automation does not create permission or activate broad autonomy. Worker readiness and eligible opportunities remain necessary. |
| Strategy and activity | Existing confirmed structured rules and activity views retained. No LLM is required to create option-based rule drafts. |
| Forge safety inspection | Holders may select another owned Punk for inspection. Incomplete inventory or unresolved obligations block sacrifice. No general-public burn button is enabled. |
| Rarity Eye / existing Forge canary | Existing selected-owner registration, learning and equipment paths retained. Requires eligible credits and confirmation. The release does not make every catalog skill generally learnable. |
| Help | Holder walkthroughs available at <https://goghpunks.xyz/guide/>. |

## What is still unavailable

| Feature | Exact remaining reason |
|---|---|
| General public burn for Training Credit | Incomplete asset/obligation coverage and an immutable-contract safety gap: an asset arriving after review can become stranded. The existing progression only accepts its original burn source; a wrapper cannot simply fix its owner-caller requirement. Do not enable public burning by removing checks. Existing selected-owner canary is preserved, not expanded or freshly live-tested. |
| Buy Training Credit for 0.0005 ETH | Implemented and locally tested, but contract is not deployed or activated. Payments remain OFF. No payment is accepted. |
| Unattended public paid missions | Existing delayed vault lacks durable ownership-epoch invalidation. Its old permissions must not revive after ownership transfers away and back. Public direct wallet minting does not solve that separate authorization design. |
| Default Peppies paid-mint target | Its sale ended September 20. The UI must report the closed sale. Another currently open collection with the exact approved runtime and configuration is required for a new supported paid-mint test. |
| Public floor sweeps / ETH marketplace purchases | Marketplace validation, spending/reserve accounting, purchase-protection deployment and controlled wallet acceptance remain release gates. Listing data alone is not purchase readiness. |
| Public WETH bids | Ownership-away-and-back permission revival must be resolved at the contract/authority level before public release. |
| Broad autonomous spending | Disabled; owner-scoped permissions, skills, rules and staged validation are still required. Persistent research watching remains default OFF. |
| All planned catalog skills | Reviewed packages are not equivalent to registered, activated and holder-tested capabilities. Additional registrations and release checks remain. |

## Validation and its limits

- Local type checking, wallet build, site/source/secret checks passed. Netlify
  preview and production deployment gates passed.
- Initial full JavaScript run: 3,494 passed, five failed, two skipped. All five
  failures were subsequently corrected or rerun successfully: 25 targeted UI and
  routing tests and 58 serial tests passed. There was no single final full-suite
  clean run.
- Full contract rebuild was stopped after prolonged compilation under severe
  local CPU/disk pressure. Earlier paid-training baseline: 346 contract tests
  passed; specialists separately passed 13 new contract proofs. No fresh full
  contract-suite success is claimed.
- Native PostgreSQL journal proof: 37 assertions passed. Reviewed additive public
  mint journal migration applied; forced RLS, restricted grants and immutable
  review fields verified. No existing escrow/history was changed.
- Independent source review reported zero open P0/P1 findings within the new
  manual paid-mint and ERC20 withdrawal scopes. General burn remains blocked.
- Local, preview and production browser checks each covered 15 captures across
  desktop, 375 px and 320 px. Production had zero browser errors or horizontal
  overflow; all 12 checked served files match the production commit exactly.
- Deployed protected routes reject unsigned requests. Authenticated cloud wallet
  acceptance remains outstanding. The production-only restricted database secret
  was not copied from a masked management response into preview.
- No real wallet transactions or AI inference were performed in these checks.

## Holder test steps

1. Open <https://goghpunks.xyz/>, connect and select a Punk.
2. Open Actions, choose preferences and limits, then review the complete rules.
   Saving rules is separate from granting economic permissions.
3. Check balances, collection, activity and existing skills.
4. To withdraw a standard token, open Collection, choose V3 or Agent Account,
   enter its address and inspect. Review destination, amount and fee before
   confirming in your wallet. Recover/recheck an existing transaction instead of
   resending if confirmation is interrupted.
5. A paid mint needs an open, supported collection and an activated Agent
   Account. Review the exact price and destination before wallet confirmation.
6. Forge inspection explains sacrifice blockers. General public burn and paid
   Training Credit purchases remain disabled; do not treat an inspection as
   burn authorization.

Detailed integration evidence: [release record](public-holder-release-20260922.md).
