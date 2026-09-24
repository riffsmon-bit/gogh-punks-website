# Swarm and paid-training wallet compatibility

Starting production commit: `f79f29f1f560fb89cd565105febcc9181bb28099` (PR #82).

## Reported failures

- Swarm wallet inspection stopped with a generic verification error for the plan containing Punks #93–#97.
- Paid training stopped at wallet account/network/nonce preflight before opening a transaction.

## Reproduced cause

The installed WalletConnect UniversalProvider returns a JavaScript number from `eth_chainId` (`parseInt(this.getDefaultChain())`). The AppKit adapter exposes this provider through `getWalletProvider()`. The three newer clients assumed a canonical hexadecimal string. That rejected the correct network ID, `4663`, before any transaction could be reviewed or sent.

Using the production reader, the numeric-chain provider shape and real public chain reads reproduced `AGENT_CREATION_READ_INVALID` with the exact reported Swarm message. With the patch, all five reads passed at blocks 71481574–71481601 on 2026-09-24 at approximately 15:36 UTC. #93 and #96 had existing Agent wallets; #94, #95 and #97 did not. The provider used for this reproduction was an explicitly read-only stand-in, not an owner signature or transaction test.

## Changes

- Agent wallet creation, Swarm Wallet and paid training accept a positive safe-integer numeric chain ID as well as its hexadecimal encoding. They still require chain 4663 and validate the independent reader's network.
- Bounded hexadecimal RPC quantities accept equivalent padding and letter case. Numeric nonces, balances and fees remain invalid. Reviewed transaction fields remain canonical and are sent unchanged.
- Ownership, pending nonce, contract code pins, block freshness, simulation, spending caps, exact transaction matching and recovery journals remain enforced.
- Swarm errors identify the failing Punk and check; existing wallet results and the saved plan remain visible. A failed check cannot advance to funding.
- The guide explicitly explains its sequence: create missing Agent wallets, fund together, activate each mission. Wallet creation and funding do not grant new mission permission. Each mission still requires its owner's separate confirmation.
- Paid-training errors distinguish a changed account/network, a pending transaction, a stale reviewed nonce and malformed responses.
- The final mission authorization, owner/Punk gas funding, funding receipt recovery and native Punk Wallet funding/withdrawal gates also accept the exact numeric Robinhood network ID. Gas funding still enforces the source Punk's reserve and fixed destination.

## Training status

Read-only contract calls on 2026-09-24 confirmed paid purchases were unpaused and priced at 0.0005 ETH. The website release remains an owner canary; Rarity Eye is its released skill. Punk #93 had zero purchased credits and had not activated the paid-training extension at the time of this check.

General holder sacrifice remains blocked. Complete asset/obligation coverage and protection during burn confirmation are unfinished. This change does not enable burning, register new skills or change contract permissions.

## Validation and release

The targeted creation/Swarm/guide tests passed 117 checks. Paid wallet/panel tests passed 47 checks; mission activation/wiring passed 19; gas funding/native-funds tests passed 51. Negative coverage includes wrong networks, invalid numeric values, changed ownership/nonces, simulation failures, spending limits and exact outgoing payloads. Independent source reviews found no release-blocking regression in the changed clients or guide.

Full-suite, build, browser, preview and production results are recorded in the release PR after execution. Do not interpret this implementation record as a completed holder wallet test. No owner transaction was signed or submitted by the development agent.

## Release revalidation after disk recovery

Production was rechecked against `f79f29f1f560fb89cd565105febcc9181bb28099`; it still served the hexadecimal-only clients. No unrelated changes from the main local checkout were included.

- `npm run site:check` completed successfully: domain typecheck, wallet production build, static/site secret scan, syntax validation of 986 modules, broker manifest checks, and the full JavaScript suite (3,923 passed, zero failed, two skipped). Contract sources and deployed permissions are unchanged.
- The local Swarm browser journey passed at 1440, 375 and 320 pixels: review before any wallet request, missing-wallet creation, one funding batch, separate mission permissions, and recovery after refresh. No horizontal overflow or browser exceptions were reported. Wallet responses were fixtures, not real signatures.
- The paid-training browser fixture passed with no external requests or browser exceptions, including review/confirmation, rejected or lost wallet responses, receipt recovery, network switching and mobile layouts.
- Fresh public-chain reads with the WalletConnect numeric-chain response shape verified Punk #93's existing Agent wallet at block 71555524. Punk #476 had no Agent wallet at block 71555539; the patched client successfully prepared and simulated its exact zero-value creation transaction. Only account/network/nonce reads were exposed through the stand-in wallet. No transaction was submitted.
- Source review confirmed that normalization is limited to provider responses. The expected owner, chain 4663, pinned contracts, canonical reviewed payloads, reserve checks, spending limits, and recovery/idempotency journals remain enforced.

Holder steps after deployment: reload the site, connect the owner wallet on Robinhood Chain, check the selected Punk's Agent wallet, review and confirm creation if needed, fund its Agent gas above the chosen reserve, then review the rules and confirm Start mission. For Swarm, the saved guide performs those steps in order. A saved pending wallet request must be recovered rather than repeated. Wallet creation or funding alone does not authorize a new mission.

## Remaining compatibility work

The separate Agent asset-recovery implementation (`site/punk-agent-recovery.js`) still uses hexadecimal-only network checks in preflight and receipt recovery. That pre-existing withdrawal compatibility gap is outside this Swarm/paid-training patch; this release is not a claim that every V2 wallet surface is fully validated with WalletConnect. Recall uses its own existing network check and was not changed here.
