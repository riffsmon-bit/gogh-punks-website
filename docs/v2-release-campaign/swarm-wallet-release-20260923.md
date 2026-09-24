# Owner-controlled Swarm Wallet — 23 September 2026

Status: FACTORY DEPLOYED AND VERIFIED. Holder UI locally tested; Netlify release pending. Holder create/deposit/batch/withdraw actions are not yet live-tested.

24 September setup follow-up: the owner confirmed the first MetaMask prompt was account connection only. No deployment transaction was found in the saved journal. Explicit transient Node/Undici read failures now receive at most three attempts on the same provider with the same arguments; signing and send methods remain prohibited. The underlying cause of the earlier live failure was not captured conclusively. The dedicated setup page now explains connection versus deployment, shows preflight progress, and uses a fresh journal read before offering retry guidance. Unknown journal state disables preparing/sending. Server diagnostics expose only bounded error categories, never request URLs, calldata or remote messages.

All 48 setup transport, deployment and recovery tests passed after this fix; independent review reran five new UI/diagnostic checks and found no concrete blocker. The preserved unsent review was refreshed through real two-provider read-only simulation in 2.323 seconds, expiring 24 September 08:19:44 EDT, with maximum network fee 0.000195715289208 ETH. This review is not a broadcast or receipt. Local review reopened for the owner's actual wallet confirmation; public release remains gated.

Branch: `feat/owner-swarm-wallet`, integrated with production/main `7811eff1ddb343670b3ef19c547d762d75e8c511`. Existing Recall and review-before-login fixes are preserved. No new Netlify deployment was used for debugging this feature.

## Holder behavior

Each holder creates an immutable owner-controlled ETH wallet, deposits a budget, selects 1–10 activated Punks and reviews exact per-Punk allocations. Each funding batch requires a separate owner confirmation. The entire batch succeeds or reverts. Unused ETH can be withdrawn only to that wallet’s owner, even if the owner no longer owns any Punks or the funding registry becomes unavailable.

No automatic refills, worker authority, arbitrary targets, administrator, upgrade path or mission activation. ETH already allocated to a Punk follows that Punk’s ownership; it is no longer unused Swarm Wallet ETH. The connected holder pays network gas separately.

## Integration and safety

- Contracts: `SwarmGasVault.sol` and `SwarmGasVaultFactory.sol`; existing account contracts unchanged.
- Vault: current Punk ownership, exact canonical Agent account/proxy, duplicate prevention, nonce/deadline and atomic batch checks. Withdrawal recipient is fixed to the holder.
- Browser: release/runtime pins, fresh owner/chain/nonces, bounded exact simulation, explicit consent, durable original-request journal and cross-tab lock before a wallet request.
- Recovery: independently verified original or same-nonce replacement transactions; canonical receipt/delivery proof; explicit cancellation. Read-only recovery can acknowledge owner-edited mined fees without expanding future submission limits. Above-review actual fees are shown plainly.
- UI: owner/provider/roster/input changes invalidate reviews; passive refresh preserves inputs. Funding failure does not silently activate or retry a mission.
- Deployment: local owner-wallet review, compiler/source hash validation, pinned chain dependencies, two read providers and no server signer. Factory deployment costs gas but funds no wallet or mission.

## Evidence

| Check | Result |
|---|---|
| Full JavaScript suite before deployment-recovery additions | 3,666 passed, 0 failed, 2 existing optional skips; 3,668 total |
| New Solidity suite | 31 passed, including 256 fuzz cases; minimal source closure with production compiler settings |
| Independent client/panel rerun after transaction-recovery fix | 35 passed |
| Subsequent panel/deployment verification tests | 12 passed |
| Final release gate | 560 passed, 0 failed; typecheck, wallet bundle build, syntax, site/secret scan and broker checks also passed |
| Local Swarm Wallet browser journey | Create, deposit, two-Punk batch and withdraw at 1440/375/320; 9 captures, no errors or overflow. Wallet/chain responses are explicit fixtures. |
| Integrated holder browser regression | Passed; 27 captures, 26 served-file comparisons, no errors/blocked/failed requests |
| Initial factory deployment preflight | Read-only simulation passed against both configured providers; no wallet signature or broadcast |

Local evidence:

- `/private/tmp/gogh-swarm-wallet-all-tests.log`
- `/private/tmp/gogh-swarm-wallet-parent-final.log`
- `/private/tmp/gogh-swarm-wallet-browser-JRbHV4/result.json`
- `/private/tmp/gogh-preview-browser-evidence-SrN1sy/result.json`
- `/private/tmp/gogh-swarm-forge-minimal/contracts/out/`

An initial integrated browser attempt timed out during concurrent full-suite/disk pressure. The subsequent isolated run passed. A missing test-harness controller stub after merging was fixed; focused integration then passed. Full historical Solidity tests were not rerun during this change; new contracts were tested through a minimal source closure to avoid exhausting the Mac’s disk during compilation.

## Review

Independent contract/client/panel review reported no remaining concrete P0/P1/P2 in that scope after the fee-edit, speed-up and cancellation recovery fix. The reviewer did not independently rerun Forge or attest a live deployment. Finality uses the explicit confirmation-depth assumption; this is internal review, not a claim of a professional third-party audit.

The one-time deployment recovery fix is committed as `626182c`. Its combined targeted run passed 41 tests (33 Swarm tests plus 8 shared-helper regressions). Independent review ran 34 recovery/deployment checks plus 2 browser checks and found no remaining concrete P0/P1/P2. The owner review is ready for a fresh two-provider preflight; the server holds no signer.

## Confirmed factory deployment — 24 September

- Factory: `0xab82241505a64edfbb3031542e137fadf5567dba`.
- Transaction: `0x736cba695d35137e60d1f2f89b663e512fc280194bebcb03214f26207aeb6a1c`.
- Block: `71359261`; successful canonical receipt confirmed by two providers with at least 12 subsequent blocks.
- Actual fee: **0.00008070728286 ETH**; transaction value zero.
- Runtime hash: `0x0b799708f4f750fd6687d506bb4149ca6734c2291b68eab92ca6ac4ca83a93ac`.
- Compiler/source hashes, 8,585-byte factory runtime and all immutable bindings verified. Public evidence: `deployments/robinhood-swarm-wallet.json`.
- Browser client read against the deployed factory passed: dependencies verified, owner vault not yet created. Exact holder CREATE simulation subsequently passed without any signing or send method. One earlier preparation returned a transient read-unavailable result; no transaction was sent.
- Independent integration review identified inaccessible withdrawal controls after the last Punk leaves the holder wallet. The panel now lives outside selected-Punk content; zero-Punk owner visibility and withdrawal review are covered by browser and unit checks.
- Integrated local desktop/mobile run: 30 screenshots, 29 served-file comparisons, zero exceptions, console/network errors or blocked requests. Wallet responses in these browser journeys are explicit fixtures.

## Final local release validation — 24 September

- Full JavaScript regression: **3,712 passed, zero failed, two existing optional skips** (3,714 total), executed after the release pins, owner-level wallet controls and onboarding reset were integrated.
- Deployment gate: **566 passed, zero failed**, plus typecheck, wallet production bundle, syntax, site/secret scan and broker checks. The five exact-release runtime checks and four holder-help checks were also run separately and are now included in the hosted gate.
- Final focused runtime/help/panel checks: **19 passed**; integration wiring checks: **29 passed**.
- Final integrated browser run at commit `a9f04f925ca9fd5fa8e0f83765c1901bf45414dc`: **30 captures, 29 served-file matches, zero exceptions, console/network errors or blocked requests**, desktop 1440 and mobile 375/320. Zero-Punk owner wallet remains reachable; stale onboarding is hidden.
- Independent final review found no blocker in the owner-level relocation or deployed manifest integration. It did not perform holder signatures or repeat live receipt verification.
- Evidence logs: `/private/tmp/gogh-swarm-wallet-final-all-tests.log`, `/private/tmp/gogh-swarm-live-release-gate.log`, `/private/tmp/gogh-swarm-live-final-targeted.log`, `/private/tmp/gogh-preview-browser-evidence-51LFj7/result.json`.

## Remaining release steps

1. Deployment recovery tests and independent review completed; no transaction sent.
2. Owner signed the exact factory transaction; successful deployment confirmed.
3. Deployment verified with both providers, exact compiled runtime and all immutable configuration.
4. Public release manifest populated from verified address/code hash and compiled vault runtime.
5. Run the final release gate, one coherent Netlify preview and browser/API checks, then ordinary protected merge/deployment.
6. Verify served production files and controls. Holder wallet creation, deposit, batch funding and withdrawal remain explicit holder actions; do not mark them LIVE-TESTED until those receipts are observed.

The owner signed the factory deployment. No holder wallet creation, deposit, batch funding, withdrawal, NFT burn or mission was executed during these checks.
