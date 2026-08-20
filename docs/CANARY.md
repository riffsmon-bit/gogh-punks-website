# Canary Plan

No canary is selected or active. Exactly one Punk may enter each live test stage.

## Preconditions

- Independent audit findings resolved.
- Robinhood deployment and verification manifest complete.
- Guardian multisig tested; deployer has no runtime role.
- One marketplace or mint venue independently verified.
- One adapter audited and code-hash pinned.
- Same-owner transfer-round-trip authorization issue resolved or autonomy excluded.
- Production indexer catches up and passes reorg drills.
- Global approval and autonomous feature flags remain off.
- Current owner explicitly selects one token ID and acknowledges account-transfer semantics.
- Wallet and marketplace transaction builders reject the Punk Account itself as the controlling Punk's transfer recipient.

## Foundation canary

1. Record canonical tuple, current owner, deployment block, and expected account address.
2. Independently calculate the address from two clients.
3. Current owner activates the account.
4. Verify proxy bytecode, footer binding, implementation, owner, and registry event.
5. Deposit only a pre-agreed dust amount.
6. Set a minimum reserve covering the majority of that balance.
7. Configure `SCOUT`; authorize no transaction agent.
8. Run discovery and inspect explanations, evidence timestamps, and `UNKNOWN` handling.
9. Verify gallery, portfolio, decision log, and notification read paths.
10. Pause and unpause Scout without affecting owner recovery.
11. Withdraw the test balance through the owner path and verify no guardian path exists.

## Owner-approved acquisition canary

1. Enable global approval purchases only after a separate reviewed governance action.
2. Owner configures `APPROVAL_REQUIRED` with one adapter, one venue, one collection, native ETH only, one selector, tiny transaction/day/week limits, one acquisition/day, short expiry, and strict reserve.
3. Scout produces one exact typed proposal.
4. Owner verifies account, collection, token, venue, selector, price, max price, gas, expiry, reserve, and risk evidence.
5. Simulate against the current block.
6. Execute exactly one inexpensive acquisition.
7. Confirm the NFT balance increase, acquisition event, policy usage, journal, portfolio, and allowance state.
8. Remove venue/collection/selector permissions and disable approval purchases.

## Transfer authority test

Before risking live gallery assets, run the Alice-to-Bob scenario on a current Robinhood fork and a dedicated test collection. Canonical Gogh Punks secondary transfers are now unlocked; do not use a valuable Punk or retained gallery assets for the first authority test.

When canonical transfers are live and the owner explicitly accepts the test:

1. Empty or intentionally retain only test assets according to written expectations.
2. Cancel pending nonces, revoke every agent, and pause policy.
3. Transfer the canary Punk.
4. Verify Alice cannot call owner execution, approve a proposal, configure policy, withdraw, or authorize an agent.
5. Verify Bob can call owner execution and must create a fresh policy/authorization.
6. Transfer back only if separately approved; test the transfer-epoch design before enabling autonomy.

## Autonomous canary

Autonomous canary requires a new explicit authorization after every previous stage passes. It uses one Punk, dust balance, strict majority reserve, one venue, one collection, one selector, one authorized agent, one acquisition/day, short agent lifetime, short intent expiry, and global pause monitoring. Autonomous minting, unknown collections, and selling remain off.

Stop immediately on any ownership mismatch, unexpected approval, policy mismatch, RPC disagreement, indexer divergence, adapter code-hash change, unexplained transaction, or monitoring outage.

### Preflight gate (required before live canary)

Run this check before enabling any live canary flow:

```sh
npm run broker:canary:preflight
```

The command automatically loads an untracked repository-root `.env` when present. Start from
`ops/canary-live.env.example`, but place provider credentials only in the untracked copy or a
secret manager.

Required environment:

- `BROKER_CANARY_STAGE=FOUNDATION`
- `ROBINHOOD_RPC_URL`
- `ROBINHOOD_SECONDARY_RPC_URL` from a genuinely independent provider
- `BROKER_CONFIRMATIONS` (default `20`)
- `BROKER_CANARY_TOKEN_ID`
- `BROKER_CANARY_EXPECTED_OWNER`
- `BROKER_CANARY_EXPECTED_ACCOUNT`, calculated independently before the run

`deployments/robinhood.json` is authoritative. It must say `DEPLOYED` and contain complete,
verified records for all five contracts, including deployment transactions/blocks, constructor
arguments, bytecode hashes, deployer, guardian, and git commit. Environment address values are
optional mirrors; when present, they must match the manifest exactly. An environment variable
cannot override a `NOT_DEPLOYED` manifest.

The preflight pins every read to one confirmed block agreed by both RPC providers. It validates:

- deployment receipts and manifest runtime-code hashes;
- canonical chain, collection, and ERC-6551 registry bindings;
- implementation, policy, agent-registry, and adapter-registry wiring;
- guardian ownership and absence of a pending ownership transfer;
- fail-closed foundation feature flags and global pause state;
- the selected Punk's current owner on both providers;
- the counterfactual account from both the Gogh facade and canonical ERC-6551 registry;
- an activated account's footer, live owner, canonical identity, and module bindings.

This gate supports the `FOUNDATION` stage only. Approval and autonomous live stages remain blocked
until their separate audited gates exist. Preflight is read-only and never activates or funds an
account.

For the quickest recurring validation during live setup, run the canary drill:

```sh
npm run broker:canary:drill
```

This performs:

1. `npm run broker:canary:preflight`
2. local autonomous canary rehearsal (`forge test --offline --match-contract AutonomousCanaryTest -vv`)

You can run only the local rehearsal during pre-deployment with:

```sh
npm run broker:canary:drill:local
```

Never use `--skip-preflight` for a live action. A local-only pass proves the mock rehearsal, not a
deployment, owner, account, adapter, or transaction.

## Next production move (staged)

Use this sequence once a live owner wallet is available:

1. Select one canary token and confirm the current owner controls it on-block (single-chain RPC read).
2. Compute and save the counterfactual account address twice (registry + contract preview page).
3. Fund only the canary account with a dust amount and set `minimumNativeReserve` above 90% of it.
4. After a separate approval-stage security gate exists, configure `APPROVAL_REQUIRED` with one allowlist only:
   - one adapter
   - one venue
   - one collection
   - one selector
   - one exact owner-wallet transaction or decoded EIP-712 approval; never a stored owner key
5. Run one live dry path by building a real typed proposal and checking explorer simulation before signing.
6. Execute exactly one approved low-value secondary purchase immediately after re-simulation and confirming:
   - owner, policy version, nonce, and reserve are unchanged
   - adapter code hash and venue are still allowlisted
   - opportunity payload has not expired.
7. Immediately remove or pause venue/collection/selector permissions.
8. Revoke the canary agent, pause account-specific policy, and keep autonomous mode off.
9. Transfer the canary Punk out to another wallet and verify:
   - old owner cannot execute, propose, authorize, or withdraw
   - old approvals and relay signatures are not accepted.
10. Execute `policy.setAccountPaused(false)` under the new owner only after a fresh policy and fresh permissions are configured.

### Local autonomous rehearsal

Run the local-only canary before any fork or live test:

```sh
npm run broker:canary
```

The rehearsal uses an ephemeral Foundry EVM, mock art, and a mock marketplace. It broadcasts
nothing and loads no production key. One Punk Account receives `0.01 ETH`; `0.0096 ETH` is
reserved; one allowlisted secondary acquisition may spend `0.0004 ETH`; and the absolute
transaction, daily, and weekly maximum is `0.0005 ETH`. The test permits one collection, one
venue, one adapter, one selector, one native currency, one short-lived agent, and one acquisition
per day. Autonomous minting, unknown collections, and selling remain disabled.

The same rehearsal proves that an excessive price and a reserve violation move no funds, a second
acquisition is rejected, revocation stops the agent, and a global policy pause does not block the
owner's emergency recovery path. Passing this rehearsal does not authorize a Robinhood deployment
or a live autonomous canary.
