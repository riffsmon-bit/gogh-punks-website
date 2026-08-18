# Gas Estimates

Generated locally with Solidity 0.8.34, optimizer 500, via-IR, Cancun target, and `forge test --offline --gas-report` on 2026-08-15. These are test-environment estimates, not Robinhood fee quotes; Arbitrum L1 data fees, current base fee, constructor arguments, and live venue behavior can change actual cost.

## Deployment

| Contract | Estimated gas |
| --- | ---: |
| ArtAdapterRegistry | 609,135 |
| ArtAgentRegistry | 860,839 |
| BrokerPolicyModule | 3,115,537 |
| GoghPunkAccountV1 implementation | 2,801,946 |
| GoghPunkAccountRegistry facade | 477,073 |
| **Estimated total** | **7,864,530** |

Each Punk Account is a small ERC-6551 proxy created later through the canonical registry. The account-creation test observed approximately 107,190 gas for its primary activation path, but live canonical-registry and L2 data charges must be simulated separately.

## Representative calls

| Operation | Observed average | Observed maximum |
| --- | ---: | ---: |
| Owner-approved acquisition | 181,251 | 377,927 |
| Autonomous typed acquisition | 171,333 | 367,886 |
| Configure policy | 262,993 | 268,543 |
| Authorize agent | 69,401 | 69,577 |
| Owner execute | 11,068 | 90,161 |

The ranges include both successful and reverting adversarial test paths, and mock marketplace behavior is not a substitute for a real adapter. Run a Robinhood fork simulation with the exact selected adapter, venue, order, token, guardian, deployment commit, and current chain head before funding a canary.

## Robinhood no-broadcast simulation

The deployment script completed against Robinhood mainnet chain ID 4663 on 2026-08-15 with a placeholder guardian, no signer, and no `--broadcast` flag. Foundry estimated:

- total script gas: `10,223,902`;
- sampled gas price: `0.063232001 gwei`;
- sampled total: `0.000646477781487902 ETH`.

The simulation-created addresses are intentionally not recorded as deployments: they depend on Foundry's simulation sender and are not production addresses. Current prices and actual deployment costs can differ materially.
