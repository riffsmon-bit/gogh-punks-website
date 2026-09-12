# September 16 acceptance: V2 minting and Forge research/loadouts

Owner-confirmed scope: agent gas funding, mission setup/chat, reliable V2 minting,
Forge research and loadouts. Training and burns are deferred.

Review the [full Netlify PR preview](https://deploy-preview-47.preview.goghpunks.xyz/broker/v2/?tab=talk)
using the owner wallet and selected original Punk. The #44 localhost page is only
a disposable training fixture. Hosted `preview=1` is a visual fixture whose local
chat endpoint is not served by Netlify.

Production already runs owner-authorized autonomous missions. PR #47 is fixing
that existing product; autonomy is not an undeployed feature. The September 11
[production/preview comparison](V2_PREVIEW_PRODUCTION_PARITY_2026-09-11.md) found
old preview-only chat/Pipeline behavior and missing preview worker, signer and
relay settings. The code now shares the authenticated production chat path, but
preview execution configuration remains separate from production. The server mint worker does not automatically run on a PR preview:
[Netlify schedules functions only on published deploys](https://docs.netlify.com/build/functions/scheduled-functions/).
A controlled manual worker invocation is supported by Netlify, but requires the
intended environment, mission and transaction scope to be checked first. Opening
the PR page and waiting is not a test of unattended server mint execution. The #93
fix has not yet been released to the production worker or proven by a new live mint
receipt. Verified production loadouts also remain pending their backing contracts.

| Required behavior | Evidence already recorded | Production acceptance still needed |
| --- | --- | --- |
| Full broker loads before connecting; selecting/changing a Punk refreshes ownership | Actual-wallet startup and desktop/mobile hosted checks pass; empty-selection loop fixed | Recheck the accepted deployed revision with the owner wallet |
| Chat fills mint rules, per-mission/daily limits, gas cap and reserve | Production resolver and full-page fixture tests pass | Owner-connected chat/review, preserving the exact rules through setup |
| Agent gas can come from the Punk Wallet or connected wallet | Both source/amount autofill paths and unchecked confirmation verified; low gas preserves the mission | Review, wallet-confirm and verify canonical funding receipt/balances for each accepted source |
| Saved mission survives funding/setup and resumes the same review | Full-page mission reuse tests pass | Reload/reconnect, funding completion and mission activation with no stale/double submission |
| Autonomous mint totals are scoped to the authorizing session | #93 regression passes; daily/opportunity duplicate guards remain shared | Release worker fix, read current-session usage and verify an actual canonical mint receipt |
| Scouting reports progress and candidate rejection reasons | Candidate rejection display and worker tests pass | Observe the active worker; verify unavailable/rejected opportunities produce accurate status |
| A confirmed mint appears in collection/activity and remains recoverable | Existing receipt, collection and withdrawal tests pass | Owner-controlled mint/collection/withdrawal journey against the deployed contracts |
| Forge research reads real data with original-owner checks | Inspection, rarity and market adapters plus authority/continuity tests pass | Verify intended owner access, provider/market credentials and real read results; never label diagnostics as learned skills |
| Forge loadout reflects original-NFT state and changes owner correctly | Reader, transfer, stale-result and disposable-chain tests pass | Deploy/attest the required backing state and verify slots/learned/equipped values. Current null deployment pins and unknown placeholders do not pass |

Use one bounded mint mission for receipt acceptance: explicitly review its target,
gas ceiling, reserve, count limits, expiry and funding amount before an owner wallet
transaction. A reviewed draft or scout search alone is not a successful mint. Record
the deployed revision, chain, canonical transaction/receipt, resulting account/NFT
state and worker/session accounting. Existing prior-session receipts are not proof
that the new session fix is running.

Do not turn on learning, credit issuance, slot purchases or burns to pass this
release checklist. Learning is not equipment, and equipment does not grant economic
permission. Any later training/source implementation has its own review and rollout.

The production rollout must include both the accepted site/functions revision and
the worker code/configuration. Preserve the last working production revision for
rollback; stop new affected missions before rolling back an active worker, and
reconcile pending operations by their canonical receipts instead of resending them.
Avoid a database or contract change that is unnecessary for the accepted scope.

Recorded baseline: `docs/review/2026-09-11/completion/checks.json`. The local tests,
native database tests and hosted page checks pass; the live acceptance entries in
the last column remain open until their actual evidence is recorded.
