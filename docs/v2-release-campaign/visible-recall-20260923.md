# Visible Punk recall

Starting production: `39fdfae1cd8d49a0ab52581820e65bde6e02a748`.
Branch: `fix/visible-punk-recall`.

User reported #93 showing Reserve reached and could not find recall. Existing Actions → Pause already invoked the on-chain session revocation controller; the old explicit button was inside a hidden review console.

Changes:
- Expose Recall Punk directly beside the selected Punk's mission status on every tab, including Reserve reached.
- Use the existing authenticated fresh status and exact zero-value `revokeAutonomousSession()` owner-wallet flow. No new signing authority or funds movement is added.
- Show checking, wallet confirmation, submitted transaction, confirmed recall and failure feedback in the visible status area.
- Do not claim recalled before receipt reconciliation. Retain the original transaction hash on receipt failure; duplicate clicks use the existing busy guard.
- Clear old feedback when the selected Punk/owner changes. Late results cannot mark another Punk recalled.
- Explain that recall revokes permission and pauses strategy, funds remain in wallets, and already-submitted mints still need reconciliation.

Local validation passed:
- 43 targeted tests passed, including original recall/controller readiness checks and six new UI integration regressions.
- Browser fixture explicitly checks visible, enabled recall while reserve is reached.
- Deployment gate: 476 tests passed, zero failures, plus typecheck, build, site/secret, syntax and broker checks. Log: `/private/tmp/gogh-recall-deploy-check.log`.
- Responsive browser: 24 screens at 1440/375/320, zero exceptions/errors/overflow; Reserve reached recall visibility passed. Evidence: `/private/tmp/gogh-preview-browser-evidence-zwxHPT/result.json`.
- Independent read-only review found no blockers.
- Cloud preview/production verification pending.
- Existing contracts/backend/authorization are unchanged; no real recall or other owner transaction is submitted by this release.
