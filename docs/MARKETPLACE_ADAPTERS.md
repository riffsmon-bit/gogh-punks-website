# Marketplace Adapters

## Purpose

An adapter converts a typed request such as:

```text
buy collection X, token Y, for at most Z, delivered to Punk Account A
```

into one deterministic venue call. It is the only component allowed to understand marketplace-specific calldata.

The AI cannot submit a call target or calldata blob to the intent builder.

## Registration

`ArtAdapterRegistry` records:

- adapter kind (`MARKETPLACE` or `MINT`);
- exact venue;
- adapter runtime code hash;
- venue runtime code hash;
- version hash;
- metadata hash;
- active status.

The registry queries the adapter's self-reported kind and venue at registration and rechecks both runtime code hashes during validation. Proxies require additional implementation-slot monitoring because proxy runtime code can remain constant through an upgrade.

## Adapter review checklist

- Exact chain and venue address verified independently.
- No Ethereum address assumed to exist on Robinhood.
- Every decoded field is length- and range-checked.
- NFT recipient is the Punk Account.
- Collection, token ID, asset amount, currency, and price match the typed intent.
- Seller and consideration arrays cannot inject unrelated transfers.
- No arbitrary target override.
- No arbitrary multicall item.
- No delegatecall path.
- Refund recipient is the Punk Account.
- Exact allowance spender and amount.
- Expired orders and changed prices fail.
- Fee and royalty behavior is documented.
- Proxy implementation and conduit/controller are pinned or monitored.
- Malicious venue, malformed response, and callback tests pass.

## Postcondition

The Punk Account checks the target NFT balance before and after execution. An ERC-721 must move from not-owned to owned; an ERC-1155 balance must increase by the typed amount. Payment without the specified asset reverts atomically.

This protects against many venue failures but cannot make a malicious allowlisted collection truthful: a collection can lie in `ownerOf`/`balanceOf`. Collection review remains necessary.

## Current status

Only the interface and test-only mock adapters exist. No production marketplace
adapter is registered or deployed.

Robinhood Seaport `0x0000000000000068f116a894984e2db1123eb395`
is verified for read-only `OrderFulfilled` indexing. That does **not** make it an
approved execution venue. Recent OpenSea activity shows multiple upstream paths
(`RelayApprovalProxyV3`, ERC-4337 `EntryPoint`, and settlement calls), so a future
adapter must pin the exact direct call path, order structure, recipient,
conduit/controller behavior, fee calculation, and runtime hashes. Until that
review and calldata-level testing is complete, approval purchases and all
autonomous purchases remain disabled.
