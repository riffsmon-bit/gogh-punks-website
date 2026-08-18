# Robinhood Infrastructure

## Verified configuration

| Field | Value |
| --- | --- |
| Network | Robinhood Chain mainnet |
| Chain ID | `4663` (`0x1237`) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Native currency | ETH, 18 decimals |
| Verification API | `https://robinhoodchain.blockscout.com/api/` |
| Canonical ERC-6551 registry | `0x000000006551c19487814612e58FE06813775758` |
| Canonical Gogh Punks | `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6` |
| Gogh Punks deployment | Block `31277277`, transaction `0x7cd34483503c65b37e7130d73197d399922b7a1cca40318f2a9276e02c38b991` |
| Gogh Punks SeaDrop | `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5` |
| Seaport settlement | `0x0000000000000068f116a894984e2db1123eb395` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

The live RPC executed a minimal state-override bytecode probe containing `PUSH0` and `MCOPY` on 2026-08-15, so the current Foundry target is `cancun`. This is a point-in-time compatibility check, not a substitute for a pre-deployment fork simulation.

Sources: [connection settings](https://docs.robinhood.com/chain/connecting/), [contract addresses](https://docs.robinhood.com/chain/contracts/), and [deployment/verification](https://docs.robinhood.com/chain/deploy-smart-contracts/).

## Account abstraction

Robinhood documents first-class ERC-4337 support. This project does not assume a particular EntryPoint, bundler, paymaster, or gas-sponsorship contract until each address and runtime bytecode is independently verified. V1 Punk Accounts use ERC-6551 identity and ordinary owner transactions; ERC-4337 integration remains an extension point.

## NFT infrastructure

- OpenSea officially returns Robinhood in its supported-chain API.
- Gogh Punks uses SeaDrop for primary mint configuration.
- The Seaport contract at `0x0000000000000068f116a894984e2db1123eb395`
  is verified on Robinhood Blockscout and emits the `OrderFulfilled` records
  observed in completed OpenSea sales. It was deployed at block `605917`; the
  observed runtime code hash is
  `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00`.
- This verification authorizes read-only Scout indexing only. It does not approve
  purchase execution: recent OpenSea buyers have reached settlement through
  different wallet/router paths, including a verified `RelayApprovalProxyV3`
  and the ERC-4337 `EntryPoint`.
- No marketplace adapter will be registered from a name, documentation example, or Ethereum mainnet address alone.
- Additional Robinhood-native marketplace and launchpad contracts are **UNVERIFIED**.
- Blockscout's `contract/getabi` response is used only to identify verified ABI
  surface for Scout analysis. Explorer availability or verification never grants
  execution authority and never overrides confirmed on-chain bytecode.

## Indexing

The public RPC is suitable for bounded reads but is rate-limited. Production indexing needs a provider with archive/log capacity, documented limits, health monitoring, and a second RPC for cross-checking high-risk reads. Blockscout provides explorer data; Robinhood also documents data-provider infrastructure. The database is a derived read model and can be rebuilt from confirmed logs.

Contract analysis probes one confirmed block consistently. A missing historical
storage or interface response is recorded as unavailable rather than retried at
`latest`, because mixing block states would create misleading evidence.

A 2026-08-17 live read-only probe at block `38939744` resolved the canonical
identity as `Gogh Punks` / `GOGH`, sampled `ownerOf(1929)`, and decoded token
1929's on-chain JSON metadata while matching the contract-analysis block hash.
The metadata heuristic was explicitly non-executable; no signer or transaction
path was involved.

Default finality policy in this repository is 20 confirmations plus a 64-block rewind window. These are operational defaults, not a claim about absolute finality, and must be reviewed against Robinhood's current sequencer/finality documentation before production.

The indexer also limits one invocation to 10,000 blocks by default. Canonical
Gogh Punk transfers and Seaport activity have independent verified starts;
market-wide NFT transfers remain excluded from the default stream set.

## UNVERIFIED items

- OpenSea purchase routers, marketplace fee recipients, conduits, and controller addresses.
- Launchpad mint contracts.
- Canonical price feeds for NFT valuation.
- Production bundler, EntryPoint, paymaster, or smart-wallet provider addresses.
- Third-party collection verification claims.

Unknown values remain labeled `UNVERIFIED`; no Ethereum mainnet address is substituted.
