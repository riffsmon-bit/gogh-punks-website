# Owner-controlled Swarm Wallet — 23 September 2026

Status: IMPLEMENTED / LOCALLY TESTED. Factory NOT DEPLOYED. Public release manifest remains `null`.

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
| Typecheck, wallet bundle build, syntax, site/secret scan, broker checks | Passed |
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

The one-time deployment flow is receiving the same replacement/cancellation recovery checks. Its final results must be recorded before owner review is requested.

## Remaining release steps

1. Finish deployment recovery tests and independent review.
2. Present the exact factory transaction and current maximum network fee at the local review page. Only the owner’s wallet can sign.
3. Verify the confirmed deployment with both providers, exact compiled runtime and all immutable configuration.
4. Populate the public release manifest using verified factory address/code hash and the compiled vault runtime.
5. Run the final release gate, one coherent Netlify preview and browser/API checks, then ordinary protected merge/deployment.
6. Verify served production files and controls. Holder wallet creation, deposit, batch funding and withdrawal remain explicit holder actions; do not mark them LIVE-TESTED until those receipts are observed.

No deployment, actual holder deposit, batch funding, withdrawal, NFT burn or mission was executed during these local checks.
