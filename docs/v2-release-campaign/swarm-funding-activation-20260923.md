# Swarm funding, activation guidance and paid-training confirmation

Starting production: `b857979f47de23b88100fc0a0ed2526f9119f750` (PR76).
Working branch: `feat/swarm-funding-activation`; prior deployment evidence preserved in `1fef679c4345508375c3126f1367235d4d699865`.

Status: IMPLEMENTED and reviewed; local deployment gate passed; final full regression run in progress. Not yet deployed.

## Scope and ownership

| Workstream | Agent | Owned files | Status |
| --- | --- | --- | --- |
| Exact Swarm gas allocation | keep_hunting | broker-swarm.js, broker-swarm-funding.js, funding tests | Reviewed; integration tests passed |
| Activation status model | mission_badges | broker-activation-status.js, status/wiring tests | Implemented; integration review |
| Paid training wallet preflight | public_erc20_withdraw | forge-paid-wallet/panel, tests, paid browser fixture | Tested and read-only simulated |
| Integration and holder instructions | parent | broker-v2.js, HTML/CSS, guide, deployment checks | Testing |
| Independent security review | funding_release_security | Read-only whole diff | No P0/P1 found; 133 targeted + 10 independent adversarial cases passed |

No overlapping feature ownership, no database or contract changes. Existing Netlify pipeline retained; AI remains disabled.

## Behavior

- Fund Swarm optionally splits a holder-entered total ETH budget exactly among 1–10 selected Punks. Deterministic remainder, maximum 1 ETH per deposit and 10 ETH total. Network fees are additional.
- Deposits go directly from the connected owner wallet to each independently verified Agent Account. Each exact transfer still requires simulation and its own wallet confirmation. No pooled custody, bridge, automatic refill, generic approval, new worker or polling loop.
- Funding plans bind owner, Punk, chain, amount, destination and nonce. Opening a review is not evidence of payment. Saved matching confirmed receipts drive funded status; unknown or pending results require recovery.
- The selected Punk and roster distinguish unchecked status, uncreated Agent, missing gas, reserve reached, missing permission, pending receipt and verified hunting. A five-step guide links to existing setup/funding/mission flows.
- Setup uses the existing create-account + mission-permission flow (up to two wallet transactions). If permission already exists, funding does not request it again. Current worker policy requires Agent native ETH above reserve; prepaid EntryPoint gas alone does not satisfy that check.
- Paid training uses the fixed official Robinhood HTTPS read endpoint for pinned contract and transfer-history checks, independent of MetaMask RPC archival support. Connected wallet remains authority for account/chain/nonce/balance/gas/send. Timeouts are bounded; original review, history, code, state, expiry, locks and durable attempt checks remain enforced.

## Paid-training evidence and limits

The reported holder-specific MetaMask failure was not reproduced: no holder tab was available, and current official/PublicNode probes passed. A complete real-chain read-only preparation reached the deliberately blocked send boundary. No transaction was broadcast. The change removes reliance on wallet archival RPC support and adds diagnostics; it does not prove that the holder's extension now opens.

Paid browser fixture: `/private/tmp/gogh-paid-browser-evidence-lzIM0u/result.json`, 1440/375 widths, 24 screenshots, no exceptions/external requests. A wallet rejecting archive methods reaches one simulated send; wrong read-chain/anchor blocks. Paid focused tests: 38 pass.

Mac storage is still constrained. Only rebuildable npm/Homebrew/Chrome disk caches were removed under prior cleanup authorization. Wallet profiles, keys, Keychain, owner files and source were preserved. MetaMask's earlier storage warning is still relevant to actual holder confirmation.

## Review corrections

- Clear Swarm UI context on Punk transfer/wallet switch while preserving original transaction journal.
- Reuse the saved strategy reserve when no new draft exists.
- Age stale activation labels via the existing display timer, without new network requests.
- Preserve unchanged setup DOM to retain keyboard focus.
- Only reuse AUTONOMOUS drafts for setup; ASK/ASSIST cannot silently stand in for mint permission.
- Reset unsent funding review/consent when setup chooses OWNER funding.

## Release validation

- Initial integrated full JS run: 3,599 passed, 0 failed, 2 skipped (3,601 total), `/private/tmp/gogh-funding-full-tests.log`. Later wiring/copy/status changes receive final regression gate below.
- Initial deployment gate: typecheck, wallet bundle build, site checks/secret scan, code syntax, broker checks and 454 tests passed, `/private/tmp/gogh-funding-deploy-check.log`.
- Contracts: 359 passed, 0 failed, `/private/tmp/gogh-funding-contract-tests.log`.
- Connected local holder fixture: 24 screenshots at 1440/375/320, no exceptions/console errors/failed requests/overflow, `/private/tmp/gogh-preview-browser-evidence-6uXfhk/result.json`. Exercises allocation prefill, funding setup, current mission states, target reset, bounded hunting, notifications and guides. Fixture responses are not a real owner wallet test.
- Final deployment gate: 455 tests passed with typecheck/build/site/code/broker checks, `/private/tmp/gogh-funding-final-gate.log`.
- Final funding wiring/allocation: 18 passed; activation wiring: 10 passed.
- Independent security review: no P0/P1 found. Kept the immutable prepared nonce as a conservative boundary; changed guidance directs unsent nonce conflicts to check original deposits and replan only unfunded Punks. Pending/unknown remains recovery-only.
- Reproducible browser runner: `node scripts/test-swarm-holder-browser.mjs --unauthenticated-read-only --ready-commit <full commit> --local-url http://127.0.0.1:8893/` (start existing local demo first). It intercepts connected-holder data and prevents real wallet/network mutations.

Final report must distinguish fixture confirmation, read-only mainnet checks, deployment, and holder wallet testing.
