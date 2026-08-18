# Art Broker Deployment

Status: **NOT DEPLOYED**.

No command in the default validation workflow signs or broadcasts a transaction.

## Roles

- Deployer: temporary transaction sender only.
- Protocol guardian: reviewed multisig controlling global registries/feature flags; no Punk withdrawal authority.
- Art Agent: separate managed signer, globally registered and individually authorized by Punk owners.
- Punk owner: live `ownerOf` address and sole general account authority.
- Treasury/collection owner: no Art Broker authority by default.

## Environment

Required for simulation:

```text
ROBINHOOD_RPC_URL=https://...
PROTOCOL_GUARDIAN=0x...
GOGH_ACCOUNT_SALT=0x0000...0000
```

Use a Foundry keystore, hardware wallet, or secure signer at deployment time. Do not export a raw private key, seed phrase, or mnemonic into the application environment.

## Local validation

```sh
npm install
npm run check
```

This runs site and service syntax checks, 52 Node tests, Solidity formatting, compilation/size checks, high-severity Foundry lint, 51 Solidity tests plus configured fuzz runs, and ABI trust-boundary assertions. See [gas estimates](GAS_ESTIMATES.md) for the latest local report.

The extended property profile is:

```sh
forge test --offline --fuzz-runs 1024
```

It currently covers four fuzz properties (4,096 generated cases) in addition to the deterministic Solidity tests.

## Read-only workers

Both workers are off by default and do not hold an owner or agent key:

```sh
BROKER_ANALYZER_ENABLED=true npm run broker:analyze
```

The indexer additionally requires a reviewed start for every enabled stream and
a bounded run window. The repository records the verified full-history lower
bounds, but production may deliberately begin later:

```text
BROKER_INDEXER_ENABLED=true
BROKER_INDEX_FROM_BLOCK_GOGH_PUNK_TRANSFERS=<reviewed block at or after 31277277>
BROKER_INDEX_FROM_BLOCK_SEAPORT_ACTIVITY=<reviewed block at or after 605917>
BROKER_INDEX_MAX_BLOCKS_PER_RUN=10000
```

After those values are reviewed, run `npm run broker:index`. Broad market-wide
`nft_transfers` is excluded from the default stream set and must not be enabled
without its own source-capacity and start-block review.

Do not enable either production worker until the database migrations are applied,
the Robinhood RPC/archive provider is selected, advisory-lock behavior is tested,
and monitoring/retry ownership is assigned. The analysis worker writes derived
evidence only and forces `autonomous_execution_eligible = FALSE` on every updated
opportunity.

`BROKER_ANALYSIS_ACTIVITY_LIMIT` bounds historical sale rows per collection
(default 200), while owner sampling is independently capped at 32 token IDs.
The worker never fetches remote NFT metadata and never produces a live quote.

## Fork simulation only

```sh
forge script contracts/script/DeployArtBroker.s.sol:DeployArtBroker \
  --rpc-url "$ROBINHOOD_RPC_URL" \
  -vvvv
```

Omitting `--broadcast` is mandatory during preparation. Review traces, predicted addresses, constructor arguments, runtime sizes, and estimated gas. The script verifies chain ID 4663 through constructors and fails if the canonical collection or ERC-6551 registry has no code.

The 2026-08-15 no-key simulation completed successfully. Its point-in-time gas result is recorded in [GAS_ESTIMATES.md](GAS_ESTIMATES.md); repeat it from the exact release commit before any authorization to deploy.

## Broadcast gate

Do not add `--broadcast` until the owner explicitly authorizes production deployment after:

- audit approval;
- reproducible git commit;
- clean full validation;
- gas and funding review;
- guardian multisig confirmation;
- constructor argument review;
- address collision/code checks;
- incident response readiness.

## Contract order

1. `ArtAdapterRegistry`
2. `ArtAgentRegistry`
3. `BrokerPolicyModule`
4. `GoghPunkAccountV1`
5. `GoghPunkAccountRegistry`

No agent or adapter is registered by the deployment script. Only Scout is globally on; every execution feature is off.

## Verification

Verify each contract against Blockscout using the exact compiler, optimizer, EVM version, constructor arguments, and source commit. OpenZeppelin 5.6 uses Cancun `MCOPY`; a live Robinhood `eth_call` bytecode probe confirmed `PUSH0` and `MCOPY` at the 2026-08-15 reconnaissance snapshot. Repeat that probe and a full fork simulation immediately before deployment because ArbOS can upgrade. The Robinhood verifier URL is:

```text
https://robinhoodchain.blockscout.com/api/
```

Populate `deployments/robinhood.json` with name, address, chain ID, transaction, block, deployer, version, constructor arguments, creation/runtime bytecode hashes, git commit, guardian, and verification status. Independently compare the published runtime bytecode and immutable values.

## Post-deployment assertions

- Every `owner()` resolves through canonical `ownerOf`.
- Counterfactual address matches canonical registry calculation.
- Guardian cannot call account execution.
- Deployer cannot call account execution.
- Agent registry and adapter registry are empty.
- All purchase/mint/unknown/selling flags are false.
- Global pause works.
- Owner emergency execution still works while paused.
- No account is activated or funded automatically.
