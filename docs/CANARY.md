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

Before risking live gallery assets, run the Alice-to-Bob scenario on a current Robinhood fork and a dedicated test collection. The live Gogh Punks contract currently locks secondary transfers until its mint threshold; do not bypass or alter that rule for this test.

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
