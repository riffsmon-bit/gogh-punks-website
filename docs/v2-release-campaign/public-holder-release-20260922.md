# Public holder release — 22 September 2026

Status: LIMITED RELEASE DEPLOYED AND BROWSER-VERIFIED. Production is
<https://goghpunks.xyz/> at commit `6d03fa800e708fe1edb573e6295f86a5b645343a`,
Netlify deploy `6ab2a6ada57dfe000840503e`, published 2026-09-22 16:05:02 UTC.
Netlify remains the host; Vercel migration is paused. This is not completion of
all requested public V2 functionality or a live wallet transaction acceptance.
See [current holder rundown](public-holder-rundown-20260922.md).

Owner request: public paid-mint missions, burn for Training Credit, general ERC20
withdrawal, and V2 as the main Gogh Punks page.

Starting production: `109b57fde726fdc2b2f461a85a4cef38e3888c11`, published Netlify
deploy `6ab27c0df8b88a0008b98e73`; verified through the project API on 22 September.
The local candidate also contains `d25632e`, the independently reviewed but
UNDEPLOYED optional paid Training Credit implementation. Payments remain off.

## Ownership and release boundaries

| Workstream | Agent | Branch / owned subsystem | Status |
|---|---|---|---|
| Homepage, guide, integration, deployment | Release lead | release/netlify-public-holders; Netlify routing, main UI seams, docs | DEPLOYED; production browser PASS |
| Public owner-confirmed paid mint | public_paid_missions | feat/public-directed-paid; dedicated public mint API/coordinator/journal/panel/tests | DEPLOYED; live wallet acceptance outstanding |
| General sacrifice eligibility / protection | public_holder_forge | feat/public-holder-forge; holder inspection, staged burn journal, inventory/obligation protections | Inspection DEPLOYED; actual general burn BLOCKED |
| ERC20 owner withdrawals | public_erc20_withdraw | feat/public-erc20-withdraw; token inspection/review/wallet/panel/tests | DEPLOYED; live wallet acceptance outstanding |

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
- Implementation, independent review, integrated-suite limits and cloud
  acceptance are recorded below.

## Owner revision: remove AI inference

The owner first requested lower app/development costs, then explicitly requested
removing AI and giving holders options. This release therefore sets
`GOGH_AI_COST_MODE=OFF` in Netlify Functions (verified configuration update) and
in the checked-in configuration. No AI providers are eligible under OFF,
including explicit provider preferences. Existing keys are preserved, not used.

Actions replaces the chat entry point. A structured form creates deterministic
free-mint rule drafts for ASK, ASSIST or permission-gated AUTONOMOUS mode. Holders
choose art preference, reserve, gas cap, daily limit and total limit. The existing
confirmation and execution permissions still apply. Mint reviews, link checks,
funding, collection, withdrawals, skills and pause controls remain available.
No additional agents were started after this cost instruction.

## Integrated evidence

- 15 local Chrome captures across 1440, 375 and 320 px: no exceptions, console
  errors, failed requests or horizontal overflow. New options mounted; provider
  picker removed and free-text chat hidden. This was simulated roster state,
  not a real wallet transaction.
- Options/routing/UI targeted regressions: 25 passed. All three mode drafts
  produced the exact entered limits without a model invocation.
- Native PostgreSQL public paid journal proof: 37 assertions passed. Reviewed
  additive migration applied to Supabase; production metadata verifies forced
  RLS, owner policy, restricted request-role grants and immutable review data.
  Existing records and escrow were not modified.
- Netlify secrets are masked by Secrets Controller. Production request secret
  remains intact. Its masked management value was not copied into preview.
  Authenticated public-mint preview therefore still needs that existing restricted
  credential supplied securely; local native proof and production role metadata
  do not establish authenticated cloud preview success.
- Public mint/withdrawal independent source review: zero open P0/P1 findings in
  the explicitly reviewed manual owner-confirmed scopes. General burning remains
  blocked and was not included in that approval.
- Full local suite initially: 3,494 passed, 5 failed, 2 skipped (3 old UI label
  expectations; two time-sensitive local tests under concurrent compile load).
  UI expectations were corrected. Final targeted results appear below. No
  single clean run of the entire updated suite is claimed.

### Release gate limits

Three new Netlify bundles passed isolated import and method-rejection checks with
no node_modules symlinks. The full contract rebuild was stopped after prolonged
compilation under severe disk/CPU pressure; it did not pass. Contract source was
unchanged by the public-holder additions: the earlier paid-training candidate had
346 passing contract tests, and the specialists separately ran 13 new actual-account
and burn-boundary contract tests. These are separate executed proofs, not a new
combined full-suite result.

The two time-sensitive JavaScript failures were local copied-chain review expiry
and a read-only CLI subprocess deadline under resource pressure. The final serial
recheck of both affected files passed all 58 tests. Together with the UI recheck,
every initially failing case was rerun successfully. This does not replace the
uncompleted full contract rebuild.

## Final deployment acceptance

- PR [73](https://github.com/riffsmon-bit/gogh-punks-website/pull/73) merged through
  the normal reviewed pipeline. The production source tree matches the reviewed
  release head `c09d11c00888f3bd0274ec3f10906aee8810a28d`.
- One controlled preview (`6ab2a515cfbf370008a2107d`) and one production deployment.
  Netlify production reports ready with no deployment error. No extra deployment
  is triggered for this final evidence update.
- Preview: 15 captures at 1440, 375 and 320 px, no application exceptions or
  overflow. Only Netlify's injected preview toolbar differed from source and was
  blocked by the existing CSP. The CSP was not weakened.
- Production: 15 captures at the same sizes; zero exceptions, console/log errors,
  failed or blocked requests, and no horizontal overflow. All 12 checked HTML,
  JavaScript and CSS files exactly match production commit bytes. Root V2,
  `/broker/v2/` and `/guide/` return HTTP 200.
- `/api/v2/providers` returns an empty provider list. Public mint, general-burn
  inspection and correctly shaped ERC20 inspection each return 401 without a
  signed wallet session. ERC20 requests without the same-origin header return
  403. These checks establish deployed routing and authorization rejection, not
  authenticated transaction success.
- Production evidence: `/private/tmp/gogh-preview-browser-evidence-ozP5IA/result.json`.
  Final serial regression evidence: `/private/tmp/gogh-public-serial-recheck.log`.
  Config/schema evidence: `/private/tmp/gogh-public-production-config-result.json`.
- No real NFT burn, mint, withdrawal, refund, bid, purchase or contract deployment
  was submitted. No AI inference was needed for these release checks.
