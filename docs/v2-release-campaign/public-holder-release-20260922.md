# Public holder release — 22 September 2026

Status: IMPLEMENTING. No new public transaction feature is declared live by this
record until production acceptance is appended. Netlify remains the host; Vercel
migration is paused.

Owner request: public paid-mint missions, burn for Training Credit, general ERC20
withdrawal, and V2 as the main Gogh Punks page.

Starting production: `109b57fde726fdc2b2f461a85a4cef38e3888c11`, published Netlify
deploy `6ab27c0df8b88a0008b98e73`; verified through the project API on 22 September.
The local candidate also contains `d25632e`, the independently reviewed but
UNDEPLOYED optional paid Training Credit implementation. Payments remain off.

## Ownership and release boundaries

| Workstream | Agent | Branch / owned subsystem | Status |
|---|---|---|---|
| Homepage, guide, integration, deployment | Release lead | release/netlify-public-holders; Netlify routing, main UI seams, docs | IMPLEMENTING |
| Public owner-confirmed paid mint | public_paid_missions | feat/public-directed-paid; dedicated public mint API/coordinator/journal/panel/tests | IMPLEMENTING |
| General sacrifice eligibility / protection | public_holder_forge | feat/public-holder-forge; holder inspection, staged burn journal, inventory/obligation protections | IMPLEMENTING; actual general burn BLOCKED |
| ERC20 owner withdrawals | public_erc20_withdraw | feat/public-erc20-withdraw; token inspection/review/wallet/panel/tests | IMPLEMENTING |

Specialists work in separate git worktrees. The lead owns shared main HTML,
application mounting, Netlify configuration and release integration. No edits to
the original dirty checkout or private owner wallet files. No contract broadcast,
burn, asset transfer, public mint or refund is performed by the build.

## Paid mint decision

The old delayed paid-mint lane is pinned to owner/Punk #93 and an immutable vault
which lacks durable ownership-epoch invalidation. Making its allowlist public
would not solve that issue. The public candidate instead prepares one direct
owner transaction to the verified Agent account, using the existing reviewed
SeaDrop target. The exact mint price comes from the connected owner's wallet;
the NFT arrives at the selected account. There is no new delegated worker
permission, escrow or worker fee. An undeployed Agent account requires the
existing activation flow first. UI must say **Review & mint now**, and must not
claim that this starts a public unattended mission.

Original funded canary jobs retain their own cancellation and receipt recovery.
No existing escrow/history is rewritten into a public direct-mint record.

## General burn boundary

The existing immutable progression accepts credit issuance only from its old
burn source, and that source requires its caller to own both Punks. A guard
wrapper therefore cannot simply add checks around the existing EOA flow.
Existing wallet inventories explicitly do not prove complete standard-token
history. Empty/undeployed wallets do not prove absence of NFTs or ERC20s.

Public eligibility inspection can be bounded and useful, but it must retain
unknown inventory and unresolved obligations as blockers. Native/WETH balance
checks alone are insufficient. A deposit while the owner's burn transaction is
pending is distinct from the disclosed danger of later deposits after a burn.
Do not enable general burning by removing these checks. The specialist is
documenting the necessary protected-contract/inventory boundary and preserving
the already-scoped owner test.

## Homepage and cost controls

Netlify force-rewrites `/` and `/index.html` to the existing V2 document, preserving
query parameters and `/broker/v2/` bookmarks. Legacy recovery routes remain
available. The previous landing file stays in source for rollback and is not the
served homepage. The local server applies the same homepage mapping.

The V2 page links a holder guide and the official collection. Optional new
transaction panels perform inspection after a holder action, not on every page
load. Existing Agent status polling skips hidden tabs. Local testing precedes
one coherent preview and production batch; no cloud deploy is used to debug.

## Validation log

- Homepage local HTTP test: passed; both aliases serve the V2 document and retain
  bookmarked recovery/guide routes. Loopback wallet referer check accepts the new
  root path while retaining origin restrictions.
- Other implementation, independent review, integrated suite, preview and
  production results: pending; append exact evidence before release.
