# Scatter autonomous free-mint path

Status: implementation and local safety tests only. No Scatter adapter is deployed, registered,
permissioned, or enabled in production yet.

## Supported envelope

`AutomatedScatterFreeMintAdapter` is deliberately target-specific. One deployment binds one
Robinhood collection and one public invite key. It accepts only:

- chain ID 4663;
- the exact EIP-1167 clone of Scatter's reviewed `ArchetypeErc721a` implementation at
  `0xb195891c61c68bd518cbE66f176bed204A222b54`;
- implementation runtime hash
  `0x51f009ed661c60923fea65913c59ee3271ada196bd60a64f2c3f1dda9485e40a`;
- public invite keys 0 through 255 and an empty Merkle proof;
- native-token price, reserve price, delta, and price interval all equal to zero;
- an active, non-blacklist list using no ERC-20 and no bonus-mint schedule;
- quantity and unit size exactly one, zero affiliate, and empty signature;
- a live wallet/list/collection supply slot and the exact next ERC-721 token ID;
- empty adapter data, zero value, zero allowance, and zero slippage.

The Scatter API is discovery evidence only. Its returned `to`, `value`, `data`, and `erc20s` are
strictly decoded by `automated-scatter-api-screen.mjs`, but the on-chain adapter reconstructs the
mint call itself from immutable bindings and current contract state. API calldata is never passed
through to the Punk Account.

## Production rollout still required

Each candidate must complete a separate reviewed rollout:

1. Discover a currently active public zero-price list and obtain its collection, list ID, and API
   mint response for the exact Punk Account.
2. Run the strict API screen and dual-provider on-chain state/simulation screen.
3. Confirm the collection is the pinned clone, the list remains active and unexhausted, and the
   direct zero-value call succeeds from the Punk Account at a confirmed block.
4. Deploy one target-bound adapter, source-verify it, and adopt its immutable manifest evidence.
5. Have the Guardian Safe register that adapter against the exact collection venue.
6. Have the Punk owner explicitly allow that adapter, collection, venue, native-zero currency,
   and the Scatter `mint` selector in the current permission generation.
7. Extend the hosted worker only after the registered adapter and complete owner policy are live;
   require a fresh full Punk Account simulation immediately before every submission.
8. Disable the adapter and revoke its account permissions when the list ends, sells out, changes,
   or fails simulation.

Scatter currently documents its API mint response as arbitrary transaction data and can return
ERC-20 approval requirements. Those broader capabilities are intentionally unsupported here.
Official references:

- <https://docs.scatter.art/api/getting-started>
- <https://docs.scatter.art/api/chain-ids>
- <https://docs.scatter.art/collectors/contract-minting>

