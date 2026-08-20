# Gogh Punk Accounts

## Canonical identity

A Punk Account is identified by the full tuple:

```text
(4663, 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6, tokenId)
```

Token ID alone is never an account identity. `GoghPunkAccountRegistry` fixes the chain, collection, implementation version, and salt, then delegates deterministic creation and lookup to the canonical ERC-6551 singleton registry.

For a fixed implementation and salt, Punk #317 always resolves to the same counterfactual address. It can receive assets before its proxy is deployed. Activation is idempotent and limited by the facade to the Punk's current owner.

## Authority

`GoghPunkAccountV1.owner()` reads the ERC-6551 footer, rejects a wrong chain or collection, then calls `ownerOf(tokenId)` on the canonical Gogh Punks contract.

If Alice transfers Punk #317 to Bob:

- the account address and assets do not move;
- Alice's direct execution authority stops immediately;
- Bob's direct execution authority begins immediately;
- policies configured by Alice become ineffective because `configuredBy != owner()`;
- Alice-scoped agent authorization returns false;
- owner-approved intents bound to Alice fail while Bob owns the Punk.

No database, indexer, admin, or cron job participates in this authority transition.

## Owner execution

The current owner can make ordinary EVM `CALL` operations and atomic batches. V1 rejects every nonzero operation code, so `DELEGATECALL`, `CREATE`, and `CREATE2` are unavailable. The owner path is intentionally independent of global broker pauses, preserving emergency asset recovery if every off-chain service fails.

To prevent an old owner from leaving standard drain rights behind, general
owner calls cannot create ERC-20/ERC-721 `approve`, ERC-721/ERC-1155
`setApprovalForAll`, or standard increase/decrease-allowance state. General
ERC-1271 account signatures are disabled in V1 so signature-based permits cannot
survive a Punk transfer. Dedicated owner methods can only revoke ERC-20,
ERC-721, and operator approvals. Typed acquisitions use exact transaction-local
allowances and clear them atomically.

This protection covers the supported standard approval surfaces. An exotic
asset with a nonstandard delegation mechanism needs an asset-specific review;
owners should not deposit such assets into a transferable gallery by default.

The account blocks a call that would transfer its controlling Gogh Punk into itself. It also resolves nested token-bound owners to a bounded depth and fails closed on cycles.

An ERC-721 contract cannot prevent its owner from using unsafe `transferFrom` externally. Sending the controlling Punk directly to its own counterfactual account that way creates an ownership cycle: `owner()` deliberately returns zero and execution stops. The receiver hook blocks safe transfers, and the account blocks self-transfer calldata routed through itself, but owners and marketplaces must also refuse the unsafe destination in their UI/transaction builders. Do not transfer a controlling Punk to its own Punk Account.

## Broker execution

Agents cannot call `execute` or `executeBatch`. They can only call `executeAutonomousAcquisition` with a typed intent. Owner-approved acquisitions use the separate `executeApprovedAcquisition` entry point. Both paths:

1. bind chain, account, current owner, sequential nonce, policy version, adapter, venue, collection, token, currency, price, expiry, reasoning hash, and adapter code hash;
2. ask a registered adapter to build one deterministic call;
3. consume policy before the external call;
4. use an exact ERC-20 allowance and revoke it afterward when applicable;
5. verify that the specified ERC-721 or ERC-1155 balance increased;
6. revert the complete transaction if any check fails.

## Assets and transfer semantics

The account accepts ETH, ERC-20, ERC-721, and ERC-1155 assets. Assets and public provenance can remain in the account through a Punk transfer. Buyers must understand that they are acquiring control of the token-bound account as defined by live ownership semantics; marketplaces should display this explicitly.

## Important transfer-epoch limitation

The immutable Gogh Punks contract exposes current ownership but no public per-token transfer nonce or transfer hook. Therefore, contracts can prove that Alice is not the owner while Bob owns the Punk, but cannot synchronously prove an unobserved historical round trip if the Punk later returns to Alice.

The implementation limits agent authorizations to 30 days, binds owner-approved intents to short policy expiry windows and sequential nonces, and invalidates permissions whenever a different current owner is observed. Before autonomous production use, a separately reviewed transfer-epoch mechanism—or an operational rule requiring all delegations to expire and be renewed after transfer—must close the same-owner round-trip edge case. Autonomous execution remains disabled until that review is complete.
