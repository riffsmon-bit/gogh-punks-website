# Art Broker Deployment

Status: **NOT DEPLOYED**.

No command in the default validation workflow signs or broadcasts a transaction.

## Punk Agent Account activation

The autonomous product is named **Punk Agent Account**. It combines the Punk's ERC-6551
ownership-bound identity with a narrowly typed ERC-4337 mission session. ERC-8004 identity,
skills, and reputation remain descriptive layers; they do not grant transaction authority.
ERC-8004 is still an EIP draft, and no verified Robinhood registry address is configured here;
on-chain ERC-8004 registration is therefore deliberately deferred and fail-closed. The current
owner-taught playbook is persisted as read-only application data and cannot alter mint policy.

The checked-in
[`robinhood-punk-agent-account.json`](../deployments/robinhood-punk-agent-account.json)
manifest is deliberately `UNDEPLOYED` and fail-closed. The UI may explain and preview the
flow, but it must not offer autonomous authorization while any manifest blocker remains.
The scheduled worker is also disabled by default and returns before constructing an RPC client,
bundler, or signer.

An authorized release must complete these gates in order:

1. Apply `20260907010000_add_punk_agent_accounts.sql` after the earlier V2 migrations and
   confirm its partial unique indexes and foreign keys.
2. Re-run all Node and Foundry tests from the exact clean release commit.
3. Dry-run `DeployPunkAgentAccount.s.sol` on a Robinhood fork without `--broadcast`; review
   EntryPoint v0.8, adapter registry, implementation, salt, predicted registry, runtime sizes,
   and gas.
4. Obtain explicit deployment authorization, broadcast with a secure owner-controlled signer,
   wait for the approved confirmation depth, and verify both sources on Blockscout.
5. Independently compare implementation and registry runtime hashes, confirm the reused
   `ArtAdapterRegistry`, free-mint adapter, and SeaDrop runtimes, then record the exact values in
   the deployment manifest. Do not mark `sourceVerified` or
   `adapterRegistrationConfirmed` from a deployment receipt alone.
6. Provision one dedicated server-side session signer and an HTTPS Robinhood-compatible
   ERC-4337 bundler. Store only `PUNK_AGENT_SESSION_ADDRESS` publicly; keep
   `PUNK_AGENT_SESSION_PRIVATE_KEY` in the Functions secret scope.
7. Exercise setup, immediate recall, owner-transfer invalidation, expired-session rejection,
   zero-balance behavior, failed UserOperation reconciliation, and one free-mint canary. Verify
   the NFT's live `ownerOf`, exact account event, Collection record, and Activity record.
8. Set the manifest receipt/bundler/signer readiness flags only from reviewed evidence. Enable
   `GOGH_V2_DISCOVERY_INGEST_ENABLED=true`, `PUNK_AGENT_WORKER_ENABLED=true`, and
   `automaticSubmissionEnabled=true` last, under a separate production authorization.
9. If ERC-8004 is later adopted, separately verify the final standard, registry deployment, and
   owner-controlled registration flow. Never treat registration, reputation, or validation scores
   as wallet authority.

Required server environment:

```text
PUNK_AGENT_WORKER_ENABLED=false
PUNK_AGENT_BUNDLER_RPC_URL=https://...
PUNK_AGENT_SESSION_ADDRESS=0x...
PUNK_AGENT_SESSION_PRIVATE_KEY=<Functions secret>
PUNK_AGENT_VERIFICATION_GAS_LIMIT=250000
PUNK_AGENT_CALL_GAS_LIMIT=350000
PUNK_AGENT_PRE_VERIFICATION_GAS=75000
GOGH_V2_DISCOVERY_INGEST_ENABLED=false
```

The owner flow is intentionally explicit. If the counterfactual account has not been created,
the wallet first activates it; the wallet then signs the bounded mission authorization. The
owner separately funds the Punk Agent Account with ETH for EntryPoint gas. After that, matching
free mints do not require a popup per mint. “Call Punk Back” submits the owner-only on-chain
session revocation and the server marks the mission recalled only after the exact receipt is
confirmed.

The session key can submit only quantity-one, zero-price ERC-721 mints through the one reviewed
adapter and venue. The contract independently enforces expiration, daily and total mint limits,
maximum gas cost, minimum native reserve, current Punk ownership, adapter runtime hash, collection
scope when supplied, no paymaster, no approvals, and no arbitrary calldata. Every successful
mint must reconcile both the exact `SessionAcquisitionExecuted` event and live NFT ownership
before it appears in Collection. ASK and ASSIST remain available if this autonomous gate is not
fully ready.

The scheduled discovery refresh and Punk worker both honor `PAUSE_BACKGROUND_RPC`, deploy-preview
background restrictions, and `BACKGROUND_RPC_ALLOWED_TASKS`. If an allowlist is configured, include
both `V2_DISCOVERY_INGEST` and `PUNK_AGENT_WORKER`; otherwise they remain intentionally idle.

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

This runs site and service syntax checks, 769 Node tests, Solidity formatting, compilation/size checks, high-severity Foundry lint, 142 Solidity tests plus configured fuzz runs, and ABI trust-boundary assertions. See [gas estimates](GAS_ESTIMATES.md) for the latest local report.

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
without its own source-capacity and start-block review. The scheduled broad stream
also requires `BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER=true`; leave it false by default.

All scheduled Art Broker network jobs share two cost controls:

```text
ENABLE_PREVIEW_BACKGROUND_RPC=false
PAUSE_BACKGROUND_RPC=false
BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER=false
```

Deploy previews and branch deploys do not run autonomous workers or indexers unless
preview background work is explicitly enabled. If provider usage spikes, set
`PAUSE_BACKGROUND_RPC=true`; indexed pages and explicit user actions remain available.
See [RPC_OPTIMIZATION_REPORT.md](RPC_OPTIMIZATION_REPORT.md) for the incident model,
call-site inventory, and safe recovery procedure.

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
