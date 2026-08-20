# Owner Guide

## What a Punk Account means

Your Gogh Punk controls a deterministic account on Robinhood Chain. You control that account only while the canonical Gogh Punks contract reports you as `ownerOf(tokenId)`. If you transfer or sell the Punk, control changes to the new owner; assets left in the Punk Account may remain there.

Never transfer the controlling Gogh Punk itself to its own Punk Account address. Safe transfers are rejected, but an externally initiated unsafe ERC-721 `transferFrom` can create an ownership cycle and make the account fail closed.

Before transferring a Punk, review every NFT, token, ETH balance, approval, active agent, policy, and pending proposal in its account.

## Safe starting mode

Use `SCOUT`. It discovers and ranks art without moving money. Treat every contract-risk label as relative and every price/value as an estimate.

In Discover, `~` means a low-confidence metadata or completed-activity
heuristic. `—` means the evidence is unavailable; it does not mean a score of
zero. Sampled owners are not the collection's total holder count, and completed
sales are not live liquidity.

## Art Mandate checklist

- Choose a persona and Taste Profile.
- Choose whether this Punk considers free mints, paid mints, or both.
- Set maximum mint and secondary prices.
- Set transaction, daily, and weekly budgets for each currency.
- Keep a meaningful minimum native reserve.
- Limit acquisitions per day.
- Use short proposal expirations and low slippage.
- Approve only contracts and selectors you verified.
- Deny suspicious collections explicitly.
- Avoid unlimited approvals.

A mint-event signal does not prove an open phase or a free price. Until Scout
has verified the mint adapter, exact contract, phase, selector, total payment,
recipient, and expiry, it stays research-only even if the Punk wants to join.

## Approval-required acquisition

Confirm all of the following in your wallet or transaction decoder:

- chain ID 4663;
- exact Punk Account;
- current owner;
- collection and token ID;
- asset standard and quantity;
- marketplace/mint contract;
- adapter and code hash;
- currency and exact payment;
- expected/max price and slippage;
- function selector;
- created/expiry time;
- policy version and nonce;
- resulting minimum reserve;
- risk findings and their observation time.

Never approve a vague “broker action,” a raw calldata blob, or a different target.

## Emergency actions

The current owner can:

- pause account policy;
- revoke one or all agents;
- advance the acquisition nonce;
- remove adapter, venue, collection, currency, or selector permissions;
- lower budgets or increase reserve;
- use direct owner execution to transfer assets;
- revoke ERC-20 and NFT approvals.

These actions do not require the AI or recommendation service to be online.

## Transfer preparation

1. Pause policy.
2. Revoke all agents.
3. Cancel pending acquisition nonces.
4. Revoke token/NFT approvals.
5. Decide which gallery assets intentionally stay with the Punk.
6. Withdraw everything that should not transfer in control.
7. Record the account inventory and indexed block.
8. Explain account semantics to the recipient.

Owner-private notification settings are keyed to your wallet and do not transfer with the Punk.

## Scam warning

No Gogh Punks staff member, bot, Art Agent, or verifier should request your seed phrase, private key, recovery phrase, unlimited approval, or direct asset transfer in a DM.
