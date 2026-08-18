# Mint Security

Minting an unknown contract has a larger call surface than purchasing a known listed token. V1 treats mint permission separately from marketplace permission.

## Rules

- Unknown mints may be discovered and recommended in Scout Mode.
- An owner may manually inspect and call a contract through the owner account path at their own risk.
- A typed owner-approved mint requires the approval-purchase feature, a registered mint adapter, approved mint venue, allowed selector/currency, and policy limits.
- Autonomous minting additionally requires the global autonomous-mint feature and an explicitly approved NFT collection and mint contract.
- Unknown autonomous mints are rejected even if unknown secondary execution is later enabled.
- Token ID and amount must be known so the account can enforce an NFT receipt postcondition.

## Adapter requirements

A mint adapter must bind recipient, quantity, collection, token ID or deterministic token outcome, price, phase proof, and refund behavior. It must not accept arbitrary calldata or arbitrary multicalls. Merkle proofs, signatures, or allowlist data must be checked against the exact mint contract and expiry.

## Approval handling

Native mints send only the validated value. ERC-20 mints use an exact allowance, call the venue, and revoke the allowance in the same transaction. Any attempt to request an unlimited allowance fails policy validation.

## Unsupported in V1

- mints where the resulting token ID cannot be proven;
- upgradeable mint adapters without implementation monitoring;
- arbitrary unknown mint functions;
- post-mint staking or operator approvals;
- cross-chain mints;
- autonomous batch mints;
- autonomous minting in production.
