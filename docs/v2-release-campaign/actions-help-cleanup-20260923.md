# Holder interface correction — 23 September 2026

**DEPLOYED AND PRODUCTION BROWSER-VERIFIED.** Main site:
<https://goghpunks.xyz/>. Production commit
`e89246639c8e89b6c45726402e2754d1d41031ff`; Netlify deployment
`6ab3ceb57730c0000882c850`, published 2026-09-23 13:07:11 UTC.
This verifies the interface correction, not public burn readiness.

The previous release removed the chat input but left the conversation layout and
automatic greetings visible to connected holders. The selected-owner burn panel
also remained beside general wallet inspection, which wrongly suggested a public
burn could follow the check. Signed-out acceptance did not catch that experience.

## Change

- Remove the composer, prompt library, conversation area and avatars from the
  holder document. Options and shortcuts invoke the existing deterministic rules
  handler directly. Results replace one result panel; owner commands are not
  rendered as chat bubbles. Historical records are preserved.
- Show compact mission status and preserve full activity and transaction details.
- Add plain-language help to all seven tabs, with steps, costs, prerequisites and
  links into the holder guide. Add detailed instructions and a direct-mint
  shortcut. A new mint starts with a blank collection field instead of an expired
  default sale.
- Public directed paid mints retain the existing supported runtime, open-sale,
  exact-price, maximum 0.001 ETH, single-NFT and owner-confirmation boundaries.
  No unattended paid authority is added.
- Remove the selected burn panel from Forge. Settings retains an explicitly
  limited receipt-recovery view for the eligible original owner/Punk. It cannot
  prepare, approve, enable or submit a new burn, including a saved prepared review.
  It can recover the original submitted transaction or cancel an unsent review.
- Move older funded paid-mission/refund controls into Settings without modifying
  their existing transaction authority or escrow. Disable their automatic status
  fetch on mount; the owner explicitly rechecks the previous mission.
- Label general burning as unavailable before wallet selection and explain that
  repeat inspection will not enable it. Remove stale training instructions that
  pointed to the old selected burn panel.
- Keep V2 at the main domain using the existing Netlify root rewrites and retain
  `/broker/v2/` bookmarks. No Vercel migration or DNS change.

## Burn boundary remains unresolved

This is a correction to the holder interface, not completion of general burning.
Complete source NFT/token/obligation coverage and protection for assets arriving
during confirmation are still missing. The existing immutable credit source and
owner-caller assumptions prevent simply adding a protective wrapper. Public
burning stays blocked. No contract deployment or irreversible action is part of
this change. Purchased Training Credits also remain disabled.

## Validation

Initial focused regression: 49 passed, including zero-AI options, action feedback,
all-tab help, owner changes, public inspection and recovery-only burn behavior.
Further build, connected-browser and deployment results are appended below.

Local deployment gate passed: domain typecheck, wallet bundle, site/secret checks,
935 JavaScript syntax checks, broker checks and 239 deployment regression tests.
The focused integration group passed 72 tests; additional targeted checks cover
the final recovery-panel placement and stale selection handling. Unchanged
contracts were not rebuilt.

Local browser: options review and edit passed at 1440, 375 and 320 px. Fifteen
captures had no script errors or overflow. A separate connected-owner #93 fixture
verified the paid-mint instructions, blank collection input, seven help sections,
absence of chat and removal of the selected burn from Forge. Its 15 captures had
no errors or overflow. One generic signed-out assertion flagged the administrator's
read-only recheck button; review confirmed it was expected for that fixture, with
no mutation control enabled. No real wallet connection or transaction is claimed.
Evidence: `/private/tmp/gogh-actions-connected-reviewed.json` and
`/private/tmp/gogh-preview-browser-evidence-p6YoK8/result.json`.

Only local fixtures may simulate the connected holder. They do not prove an
actual wallet transaction, spend funds or grant new permissions. No new agents,
LLM calls, contract tests/builds or deployments are needed for unchanged contracts.

## Deployment acceptance

PR [74](https://github.com/riffsmon-bit/gogh-punks-website/pull/74) merged through
the normal pipeline after preview checks. One preview and one production deploy
were used. Preview `6ab3cdbb80c30700086ebbfc` passed its gates; browser differences
were only Netlify's injected preview toolbar, blocked by the existing CSP.

Production browser check passed: 15 captures at 1440, 375 and 320 px, no script,
console or network errors, no horizontal overflow, no chat document elements,
and all seven contextual help sections mounted. All 16 checked served-file entries
matched the production commit exactly. Evidence:
`/private/tmp/gogh-preview-browser-evidence-Mhtc7s/result.json`.

Root V2, `/index.html`, `/broker/v2/` and `/guide/` serve successfully. Providers
returns zero enabled models. Unsigned paid-mint and burn-inspection requests are
rejected with 401. No actual wallet transaction was executed. Final focused
UI/recovery recheck passed 34 tests in addition to the earlier gate and 72-test
group. Full JavaScript and contract suites were not rerun for this interface-only
change. The final evidence update is saved locally without another cloud build.
