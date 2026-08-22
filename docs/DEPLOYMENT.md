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

This runs site and service syntax checks, 522 Node tests, Solidity formatting, compilation/size checks, high-severity Foundry lint, 103 Solidity tests plus configured fuzz runs, and ABI trust-boundary assertions. See [gas estimates](GAS_ESTIMATES.md) for the latest local report.

The extended property profile is:

```sh
forge test --offline --fuzz-runs 1024
```

It currently covers five fuzz properties (5,120 generated cases) in addition to the deterministic Solidity tests.

## Read-only workers

All enrichment workers are off by default and do not hold an owner or agent key:

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

Only after `deployments/robinhood.json` is independently verified and marked
`DEPLOYED`, add the protocol event streams and their reviewed lower bounds:

```text
ROBINHOOD_SECONDARY_RPC_URL=<second HTTPS provider on a distinct origin>
BROKER_INDEX_FROM_BLOCK_ACCOUNT_ACTIVATIONS=<registry deployment block>
BROKER_INDEX_FROM_BLOCK_ACCOUNT_ACQUISITIONS=<account implementation deployment block>
BROKER_INDEX_STREAMS=gogh_punk_transfers,seaport_activity,account_activations,account_acquisitions
```

The account streams fail closed while the manifest is `NOT_DEPLOYED`. The
secondary endpoint is also required for the Scout worker's confirmed Punk
Account reconciliation; it must use a distinct origin, and operators must
verify that it is genuinely independent from the primary provider.
Deployed Punk Account reconciliation refuses confirmation depths below 12;
keep the reviewed production default at 20 unless the finality policy is
explicitly revised.

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

OpenSea display enrichment is a separate scheduled worker. Enable it only after
the metadata migration is applied and `OPENSEA_API_KEY` is present in Netlify's
server-side environment:

```text
BROKER_METADATA_ENABLED=true
BROKER_METADATA_BATCH_SIZE=12
BROKER_METADATA_REFRESH_HOURS=24
BROKER_METADATA_NOT_FOUND_REFRESH_HOURS=24
BROKER_METADATA_ERROR_REFRESH_HOURS=1
BROKER_METADATA_TIMEOUT_MS=8000
```

It caches sanitized artwork/name/trait fields for exact chain-qualified NFTs.
It cannot update ownership, scoring, policy, execution eligibility, proposals,
or acquisitions.

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

After an explicitly authorized core broadcast has mined, use its exact non-dry-run Foundry artifact
to generate the pending manifest proposal. Run this from the full clean release commit with two
genuinely independent HTTPS RPC providers configured in `ROBINHOOD_RPC_URL` and
`ROBINHOOD_SECONDARY_RPC_URL`:

```sh
npm run broker:deployment-manifest-proposal -- \
  --artifact broadcast/DeployArtBroker.s.sol/4663/run-latest.json \
  --git-commit <FULL_RELEASE_COMMIT> \
  --guardian 0x... \
  --confirmations 20 \
  > /absolute/path/core-pending-proposal.json
```

This command is read only apart from the operator's explicit shell redirect. It requires the exact
five successful deployment transactions in canonical order, reconciles their receipts, runtime
hashes, constructor bindings, feature defaults, guardian roles, and a common confirmed block across
both providers, and prints a source-verification-pending proposal. It cannot sign, send, deploy, or
install the proposal as the authoritative manifest.

Then use the stdout-only adoption and extraction flow in
[SOURCE_VERIFICATION_GATE.md](SOURCE_VERIFICATION_GATE.md). Never hand-flip
`verificationStatus`. The installed `deployments/robinhood.json` must retain the validated
`sourceVerificationAdoption`, including its exact pending-manifest hash. Independently compare the
published runtime bytecode and immutable values before a separate reviewed install action.

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
