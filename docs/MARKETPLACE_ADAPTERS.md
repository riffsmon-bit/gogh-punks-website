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

The interface, test-only mock adapters, and an abstract
`ZeroCostMintAdapterBase` exist. The base is reusable validation code, not a
deployable production venue adapter. It accepts only an empty adapter-data field
and the exact ABI shape `selector(address recipient,uint256 tokenId)`. It pins
one code-bearing venue, one code-bearing collection, one selector, and one asset
standard, then requires the deterministic subclass output to:

- call only that venue;
- encode the Punk Account as the canonical recipient word;
- encode exactly the typed token ID;
- contain exactly 68 calldata bytes with no trailing arguments;
- use zero native value, zero ERC-20 payment, and zero allowance.

Mints that require proofs, signatures, phases, quantities, dynamic data, an
unknown output token ID, or any other ABI shape need a separate target-specific
adapter and security review. They must not pass opaque calldata through the
zero-cost base.

No target-specific production marketplace or mint adapter exists. Nothing is
registered or deployed, and this base does not enable live execution.

### Local one-shot free-mint canary

`GoghOneShotCanaryArt` and `GoghOneShotCanaryMintAdapter` provide a deliberately
narrow local integration target. The test-art collection permanently binds one
already-activated Punk Account, its GoghPunkAccountRegistry and controlling Punk
token ID, and one ERC-721 art token ID. Construction requires the account to be
the registry-derived address and verifies the registry's Robinhood chain, Gogh
Punks collection, and canonical ERC-6551 singleton configuration. Only that Punk
Account can call the exact `mint(address,uint256)` entry point, the recipient and
art token ID cannot vary, payment must be zero, and the mint can succeed only
once. The collection has no owner, admin, mutable permissions, treasury, or
alternate mint path. Its adapter independently binds the same account and token
before the zero-cost base validates the final calldata. The NFT metadata and SVG
image are deterministic on-chain data URIs so the local canary can test gallery
and marketplace metadata ingestion without an external mutable URI.

These contracts are test-only canary infrastructure. They are **not deployed**,
registered, or approved for production. A deployment-preparation script exists
for no-broadcast simulation of exactly the canary art and its adapter. The script
does not register the adapter, configure policy, activate approval or autonomous
execution, sign an intent, mint, or submit a transaction. Any broadcast remains
blocked until a separate dual-RPC provenance gate binds the deployed core
manifest, registry and account runtime hashes, canonical ERC-6551 registry hash,
current owner, and exact constructor inputs at one confirmed block. A new,
explicit deployment authorization plus receipt, runtime-code-hash, immutable,
policy, and end-to-end preflight review is still required.

Robinhood Seaport `0x0000000000000068f116a894984e2db1123eb395`
is verified for read-only `OrderFulfilled` indexing. That does **not** make it an
approved execution venue. Recent OpenSea activity shows multiple upstream paths
(`RelayApprovalProxyV3`, ERC-4337 `EntryPoint`, and settlement calls), so a future
adapter must pin the exact direct call path, order structure, recipient,
conduit/controller behavior, fee calculation, and runtime hashes. Until that
review and calldata-level testing is complete, approval purchases and all
autonomous purchases remain disabled.
