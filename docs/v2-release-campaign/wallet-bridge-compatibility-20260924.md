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

## Remaining compatibility work

The separate Agent asset-recovery implementation (`site/punk-agent-recovery.js`) still uses hexadecimal-only network checks in preflight and receipt recovery. That pre-existing withdrawal compatibility gap is outside this Swarm/paid-training patch; this release is not a claim that every V2 wallet surface is fully validated with WalletConnect. Recall uses its own existing network check and was not changed here.
