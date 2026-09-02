# Scatter autonomous free-mint path

Status: the hosted V3 worker lane and local safety tests are implemented. No Scatter target adapter
is deployed, registered, permissioned, or configured in production yet, so the lane remains inert.

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

The hosted worker reads only exact reviewed targets from
`BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON`. For every Punk and target, it pins one confirmed block
on two independent RPC providers, verifies the target-bound adapter, clone and implementation
runtime hashes, reads the public-list limits, simulates the full Punk Account call on both
providers, and performs another latest-state simulation before submission. Scatter and SeaDrop
share the four-candidate run budget; reviewed Scatter targets rotate and receive at most two slots
while live SeaDrop candidates exist, so neither route can starve the other.

The Scatter API is optional discovery evidence only. Its returned `to`, `value`, `data`, and
`erc20s` are strictly decoded by `automated-scatter-api-screen.mjs`, but the on-chain adapter
reconstructs the mint call itself from immutable bindings and current contract state. API calldata
is never passed through to the Punk Account. Scatter's current public chain-ID page does not list
Robinhood, so the production worker does not depend on the hosted API continuing to accept chain
4663.

## Reviewed target configuration

The server-side value is an exact JSON array with at most eight records:

```json
[
  {
    "collection": "0x...",
    "adapter": "0x...",
    "adapterCodeHash": "0x...",
    "publicInviteKey": "0x0000000000000000000000000000000000000000000000000000000000000000"
  }
]
```

Unknown fields, duplicate collections or adapters, non-public invite keys, zero addresses, and
non-canonical hashes fail the entire worker run before discovery or signing. An empty array is the
production-safe default.

## Production rollout still required

Each candidate must complete a separate reviewed rollout:

1. Discover a currently active public zero-price list and obtain its collection and public invite
   key. An API mint response may be captured as additional evidence when Scatter serves chain 4663.
2. When API evidence exists, run the strict API screen. Always run the dual-provider on-chain
   state and full Punk Account simulation screen.
3. Confirm the collection is the pinned clone, the list remains active and unexhausted, and the
   direct zero-value call succeeds from the Punk Account at a confirmed block.
4. Deploy one target-bound adapter, source-verify it, and adopt its immutable manifest evidence.
5. Have the Guardian Safe register that adapter against the exact collection venue.
6. Have the Punk owner explicitly allow that adapter, collection, venue, native-zero currency,
   and the Scatter `mint` selector in the current permission generation.
7. Add the exact record to `BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON` only after the registered
   adapter and complete owner policy are live. The hosted worker then requires a fresh full Punk
   Account simulation immediately before every submission.
8. Disable the adapter and revoke its account permissions when the list ends, sells out, changes,
   or fails simulation.

Scatter currently documents its API mint response as arbitrary transaction data and can return
ERC-20 approval requirements. Those broader capabilities are intentionally unsupported here.
Official references:

- <https://docs.scatter.art/api/getting-started>
- <https://docs.scatter.art/api/chain-ids>
- <https://docs.scatter.art/collectors/contract-minting>
