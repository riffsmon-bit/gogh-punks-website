# Holder-owned Swarm gas wallet

Status: implemented and locally tested. **Not deployed or live.** No real funds, signatures, or network transactions were used to build this contract.

## Product boundary

Each holder may create one wallet through `SwarmGasVaultFactory`, deposit ETH, review a batch of Punk allocations, confirm that batch in their wallet, and withdraw unused ETH back to their connected owner address. Funding does not activate missions or grant a worker permission. There is no automatic refill, project custody, administrator, upgrade, owner replacement, generic execute function, or token approval.

The immutable owner is the wallet that calls `createVault()`. Any deposit to this wallet becomes controlled by that owner; other depositors do not acquire refund rights. Only native ETH is supported. Do not send NFTs or ERC20 tokens to the Swarm wallet.

## Existing primitives reused

The current repository pins these Agent Account components on chain 4663:

| Component | Address |
| --- | --- |
| Gogh Punks collection | `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6` |
| Agent registry | `0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844` |
| Agent implementation | `0xfdb26c2ec70956227728414ff4ab7a5eda64d13b` |
| Canonical ERC-6551 registry | `0x000000006551c19487814612e58fe06813775758` |

The source is `site/punk-agent-recovery.js`; this work does not freshly certify their production chain state. Deployment/release preparation must independently recheck those pins and their reviewed runtime hashes.

`GoghPunkAccountRegistry.account(tokenId)` derives an Agent Account address, including before creation. `isAccountCreated(tokenId)` alone proves only that code exists. The new vault additionally derives the canonical CREATE2 address, compares exact ERC-6551 proxy runtime including implementation, salt, chain, collection and token ID, checks `token()`, and requires both collection `ownerOf()` and Agent Account `owner()` to match its holder.

The registry's `createAccount` requires the NFT owner. The Swarm vault cannot activate an account on the holder's behalf. The UI must guide the holder through existing account activation before including that Punk in a batch.

Existing token-bound `executeBatch` is not used as the holder vault: its authority follows the NFT, whereas unused Swarm wallet funds must stay with the holder. Existing directed-paid-mint escrows are purpose-specific and are also not reused.

## Public interface

Factory constructor:

```solidity
constructor(uint256 chainId, address collection, address registry, address implementation)
getVault(address owner) view returns (address)
isVaultCreated(address owner) view returns (bool)
createVault() returns (address) // nonpayable, caller's wallet only, idempotent
```

Vault interface:

```solidity
struct Allocation { uint256 tokenId; uint256 amountWei; }
deposit() payable
receive() payable
fundBatch(Allocation[] allocations, uint256 expectedNonce, uint256 deadline)
withdrawToOwner(uint256 amountWei, uint256 expectedNonce, uint256 deadline)
```

Both expose immutable `chainId`, `collection`, `registry`, `implementation`, `canonicalRegistry`, `accountSalt`, `registryCodeHash`, and `implementationCodeHash`. Vault additionally exposes `owner`, `nonce`, and limits. Both funding and withdrawal are nonpayable; deposits are a separate action.

`getVault` uses CREATE2 with `keccak256(abi.encode(owner))` and the exact vault creation code plus constructor arguments. ETH already at that predicted address survives creation. The holder flow should create and verify the wallet before recommending deposits. A repeated creation emits no new `VaultCreated` event.

Events: `VaultCreated(owner,vault)`, `Deposit(sender,amountWei)`, `PunkFunded(nonce,tokenId,account,amountWei)`, `BatchFunded(nonce,count,totalWei)`, `Withdrawn(nonce,owner,amountWei)`. Action events record the **consumed** nonce; the stored nonce then becomes that number plus one.

## Funding and safety rules

- One batch contains 1–10 strictly increasing, unique Punk IDs, each receiving a positive amount up to 1 ETH, total at most 10 ETH, from the vault's existing balance.
- Every recipient must be activated, canonical, and currently owned by the vault owner. Arbitrary destination addresses or calldata cannot be supplied.
- Every batch or withdrawal requires the current shared nonce and a deadline after the current block timestamp, at most 15 minutes ahead.
- All recipients are validated before transfers and again afterward. Any invalid recipient, transfer failure, changed dependency, or ownership change during a receive hook reverts the entire batch, including balances, events and nonce.
- Checked native `call` is required: the real Agent Account receive hook writes storage, so Solidity `transfer`'s fixed gas stipend is unsuitable.
- Reentrancy protection spans funding and withdrawal. No worker or third-party signature can authorize a batch.
- Registry/implementation runtime hashes and immutable configuration are checked for batches and creation. Owner withdrawal remains possible when these dependencies fail, and when the holder no longer owns any Punks.
- After a deposit reaches a Punk Agent Account, that ETH follows the Punk's ownership. Selling or burning a Punk does not return its allocated gas to the Swarm wallet. Unallocated ETH stays with the original holder.
- This contract creates no reusable NFT spending authorization. A still-pending owner-signed manual funding transaction may execute if ownership again matches before its short deadline; it is not an ownership-epoch session. No indefinite or delegated refill permission is introduced.

The constructor accepts test-compatible configuration; production release must pin chain 4663 and the reviewed addresses/hashes above. A deployer-supplied contract with different constructor arguments is not an approved release.

## Local validation and release work

Tests exercise the real repository Agent Account and registry with a local canonical ERC-6551 harness, plus hostile receive callbacks. Coverage includes exact ETH conservation, maximum batches, unauthorized calls, transfers/burns, missing accounts, runtime binding, dependency changes, replay, expiry, atomic failures, reentrancy, deterministic creation and predicted deposits, withdrawal after transfers, and failed owner receipt.

The constrained local runner uses an isolated Forge root containing only the recursive source dependency closure, preserving source paths and the repository's Solidity 0.8.34 / optimizer 500 / via-IR / Cancun / metadata-hash-none configuration. No cloud node or transaction is required.

Executed on 2026-09-23: `forge test --root /private/tmp/gogh-swarm-forge-minimal --match-path contracts/test/SwarmGasVault.t.sol --threads 1 -vv` — **31 passed, 0 failed**, including 256 fuzz cases. `forge fmt --check` for the three new Solidity files and `git diff --check` passed. Runtime sizes: vault 4,945 bytes, factory 8,585 bytes, both below the EIP-170 limit. The full historical contract suite was not rerun for this isolated change; no existing contracts were modified.

Before live availability: independently review the contracts, complete browser exact-calldata/receipt/journal verification, prepare an exact factory deployment for owner wallet confirmation, verify deployed code/configuration, publish reviewed release pins, and complete an owner-approved small live funding/withdrawal canary. Deployment, funding, allocation, and withdrawal each need their own explicit wallet transaction. The current UI repair release does not deploy this wallet.
