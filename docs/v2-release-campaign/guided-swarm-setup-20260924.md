# Guided Swarm setup — 2026-09-24

Starting production commit: `b854e5be463edbcc60cf715d3e27d12e616e9786`.
Branch: `feat/guided-swarm-setup`.
Status: **IMPLEMENTED; LOCAL VALIDATION PASSED; PREVIEW PENDING; NOT DEPLOYED TO PRODUCTION.**

## Holder flow

1. Open Swarm in Actions. Choose up to ten owned Punks, shared free-mint rules and an optional total ETH budget.
2. Review the complete plan before any wallet sign-in or transaction request.
3. Check the selected Agent wallets. Existing wallets are skipped. Create missing wallets one at a time inside the guide; creation does not start a mission.
4. If adding gas, use the embedded owner-controlled Swarm Wallet. Create it if necessary, deposit only the verified shortfall, then review one transaction distributing the exact budget across the selected Punks. Each of these actions has its own explicit review and wallet confirmation.
5. Continue to each Punk's full mission review and wallet approval without rebuilding the selection or shared rules. Existing active missions retain their current rules. Choosing existing gas does not fabricate a funding receipt; the mission flow still requires a fresh balance above the reserve.

This is one guided setup, not one transaction for every operation. The existing account architecture requires individual account-creation and mission-permission confirmations. Gas distribution uses a single Swarm Wallet batch. Funding an already-active mission can let it resume under its existing rules.

## Funding screen repair

The individual Fund screen hides the deposit form until the selected Agent wallet is verified. A clear Check wallet / sign in to fund button performs the required readiness check. Missing wallets lead directly to their creation review. Next mission stays disabled while the wallet or gas is unverified or empty. Owner/Punk binding and freshness checks remain in force on desktop and mobile.

## Recovery and authority

- Local progress is owner-bound and stores exact funding allocations and mission receipt identifiers. It grants no wallet authority.
- No polling or background approvals were added. Wallet checks are bounded by the ten-Punk selection.
- Funding reviews are saved before confirmation. Only the exact confirmed batch can complete the funding step; prior deposits or unrelated batches cannot do so.
- Submitted or unknown wallet requests are preserved after refresh and are never automatically sent again.
- Mission recovery validates the protected endpoint's Punk, session, status and transaction hash. Verified replacement hashes survive MetaMask speed-up and later refresh.
- Active or ended mission status must match the current runtime owner, Punk, Agent account and saved session/hash where applicable. Old-owner, stale or mismatched mission results cannot satisfy the guide.
- Completed, recalled, expired, cancelled or otherwise ended original missions stay ended instead of being silently restarted.
- If a selected Punk transfers away, an explicit archive action preserves the complete plan and original transaction identifiers before freeing the active guide. Pending requests for Punks still owned must be reconciled first.
- Embedded wallet operations block navigation and plan removal while busy. Device-storage failure stops preparation before a new wallet request.

## Validation

- Domain TypeScript check passed.
- Wallet production bundle built locally; site/secret scan passed for nine pages and sixteen collection previews.
- Broker manifest, fail-closed flags and database-entity checks passed.
- Syntax checks passed for 986 JavaScript modules.
- Focused holder-help and integration-wiring run: 11 passed, zero failed.
- Guided model/UI run: 32 passed, zero failed, including interrupted account creation, unknown transactions, replacement hashes, ownership changes, archive safety and stale status.
- Final guided model/UI plus embedded-wallet run: 77 passed, zero failed after copy corrections.
- Dedicated guided browser: passed at 1440/375/320 widths, fifteen screenshots, one exact funding batch per journey, no overflow or browser/network errors. Evidence: `/private/tmp/gogh-swarm-setup-browser-X7Z5l6/result.json`.
- Whole-page holder browser: passed at 1440/375/320 widths, 33 screenshots, all 35 served-file hashes matched, no browser/network errors. Evidence: `/private/tmp/gogh-preview-browser-evidence-Rl2Xly/result.json`.
- First full suite: 3,895 passed, one outdated test fixture failed, two optional skips. Its old function-extraction boundary was corrected without weakening the passive-review assertions; all six tests in that file passed afterward.
- Clean full-suite rerun: **3,896 passed, zero failed, two optional skips**, 3,898 total, 252.6 seconds, bounded test concurrency of two. Evidence: `/private/tmp/gogh-guided-full-final-tests.log`.
- Independent review found no remaining P0/P1 in the reviewed recovery and authority blocks. Full regression and integrated browser results are required before deployment.

## Release boundaries

No contract deployment, database migration, secret/runtime configuration change, asset transfer or mission authorization is part of this website change. Real holder approvals remain wallet-confirmed. The key used for the separate RobinScan source verification is local and is not part of the website deployment.

Preview, merge and production evidence will be recorded after local validation. Do not infer deployment from implementation or fixture tests.
