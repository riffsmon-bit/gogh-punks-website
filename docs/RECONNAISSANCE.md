# Phase 0 Reconnaissance

Snapshot date: 2026-08-15. Live-chain values change over time; deployment records remain the authority for historical facts.
The Seaport verification row was refreshed from verified Blockscout data and live sale receipts on 2026-08-17.
The canonical Gogh Punks creation record was refreshed from Blockscout on 2026-08-17.

## Existing repository

- Frontend: static HTML, CSS, and JavaScript under `site/`.
- Hosting: Netlify, configured by `netlify.toml`.
- Backend: JavaScript ESM Netlify Functions.
- Storage: Netlify Postgres for the former GTD capture flow.
- Wallet tooling: `viem` in server functions; no existing account-management UI.
- Tests: Node test runner. The new Solidity workspace uses Foundry.
- Discord: a separate TypeScript/Fastify/SQLite service performs SIWE holder verification and live `balanceOf` checks.
- Existing broker, portfolio indexer, or Punk-bound account system in this repository: none before this work.

## Robinhood Chain

| Item | Value | Status |
| --- | --- | --- |
| Network | Robinhood Chain mainnet | VERIFIED |
| Chain ID | `4663` | VERIFIED by official documentation and RPC |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | VERIFIED; rate-limited |
| Explorer | `https://robinhoodchain.blockscout.com` | VERIFIED |
| Native gas currency | ETH | VERIFIED |
| Architecture | EVM-compatible Arbitrum L2 | VERIFIED |
| ERC-4337 support | Documented as first-class | VERIFIED in Robinhood documentation |
| Canonical ERC-6551 registry | `0x000000006551c19487814612e58FE06813775758` | Bytecode VERIFIED on Robinhood |
| OpenSea chain support | Robinhood is returned by OpenSea's chain API | VERIFIED |
| Robinhood Seaport settlement | `0x0000000000000068f116a894984e2db1123eb395` | VERIFIED for read-only event indexing |
| Other marketplaces/launchpads | — | UNVERIFIED |

Primary references: [Robinhood Chain](https://docs.robinhood.com/chain/), [connecting](https://docs.robinhood.com/chain/connecting/), [contract deployment](https://docs.robinhood.com/chain/deploy-smart-contracts/), and [ERC-6551](https://eips.ethereum.org/EIPS/eip-6551).

## Canonical Gogh Punks

- Contract: `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6`.
- Deployment: block `31277277`, transaction `0x7cd34483503c65b37e7130d73197d399922b7a1cca40318f2a9276e02c38b991`.
- Live implementation: `GoghPunksOnchain`, compiled with Solidity 0.8.17.
- Base: OpenSea `ERC721SeaDrop` / ERC721A.
- Interfaces: ERC-721, metadata, ERC-2981, and ERC-5192.
- Authority source: live `ownerOf(tokenId)`.
- Maximum supply: 10,000.
- Public allocation: 9,500; reserved allocation: 500.
- Live supply observed during reconnaissance: 1,973.
- Live public mint setting observed: `0.0003 ETH`, maximum 20 per wallet, start 2026-08-15 23:15 UTC.
- Secondary transfers remain locked until historical mint count reaches 5,000.
- Artwork and metadata are fully on-chain through renderer and bytecode data-store contracts.
- Royalty setting observed: 500 basis points.

The broker design does not change this contract, its ownership, its token IDs, its mint configuration, or its marketplace behavior.

## Reusable smart-account evidence

The local HoodYØØR repository includes a deterministic ERC-6551 account facade and account body. Its useful patterns are live `ownerOf` resolution, owner-only ordinary calls, receiver support, counterfactual addresses, no `delegatecall`, and anti-nesting checks. It is not represented as independently audited.

Gogh Punks uses separate implementations, permissions, policies, guardians, and agent signers. A HoodYØØR agent must never control a Gogh Punk Account, or vice versa.

## Chosen direction

Use the canonical ERC-6551 singleton with a Gogh-specific immutable facade and implementation. Add a policy module, global-plus-owner agent authorization, deterministic venue adapters, confirmed-block indexing, and a read-only Scout. All spend features start disabled.

## Remaining rollout blockers

- Independent smart-contract audit and remediation.
- Venue-specific purchase paths, routers, conduits, and mint contracts verified and audited for execution.
- Venue-specific adapters with calldata-level tests and fixed code hashes.
- Production RPC/archive/indexing provider and operational monitoring.
- Multisig guardian and separate managed agent signer.
- Transfer-epoch hardening for the edge case where a Punk leaves and later returns to the same owner before an old delegation expires.
- One explicitly selected canary Punk and owner.
