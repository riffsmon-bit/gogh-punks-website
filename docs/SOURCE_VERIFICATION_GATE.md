# Robinhood Blockscout source-verification gate

This gate is the only supported transition from a source-verification-pending core or canary
deployment proposal to a `VERIFIED` manifest proposal. It is read only: it fetches public evidence,
reads the clean release and compiled artifacts, and prints JSON to stdout. It cannot write a
manifest, sign, send, deploy, configure, enable a feature, or authorize an agent.

The fixed explorer origin is `https://robinhoodchain.blockscout.com`. The gate calls only these two
exact, address-qualified paths for every expected contract:

- `GET /api/v2/smart-contracts/{checksummed-address}`
- `GET /api/v2/addresses/{checksummed-address}`

The response fields are documented by Blockscout's official
[smart-contract endpoint](https://docs.blockscout.com/api-reference/get-smart-contract) and
[address endpoint](https://docs.blockscout.com/api-reference/get-address-info). Blockscout currently
marks per-instance endpoints for future deprecation. This implementation does not fall back to a
different origin, endpoint, response shape, verified twin, or partial evidence. If the Robinhood
instance stops returning a required field, the result is **UNVERIFIED** and the gate fails closed.

## Preconditions

Use an exact pending proposal printed by the core or canary manifest builder. The proposal must bind:

- Robinhood chain ID `4663`, the canonical collection, and the canonical ERC-6551 registry;
- one full release commit and the Foundry artifact commit that resolves to it;
- the expected contract-name order, addresses, deployer, deployment transactions, constructor
  values, creation-template hashes, and live runtime hashes;
- exact ABI, raw compiler metadata, compiler-settings, and compiler-source-set hashes from the clean
  offline build; and
- `verificationStatus: "NOT_SUBMITTED"` for every expected contract and
  `sourceVerificationAdoption: null`.

Run the adoption gate only at that exact release commit with a completely clean worktree and the
same clean offline artifacts. Every tracked compiler source is read from the release commit. Every
dependency source must match both the compiler metadata hash and a package with an HTTPS resolution
and SHA-512 integrity entry in that release's `package-lock.json`. Preserve a pristine lockfile-based
dependency install; lockfile provenance is not a substitute for reviewing dependency changes.

## Evidence required

For every contract, the gate requires direct, full verification and rejects partial verification,
changed bytecode, verified-twin inheritance, minimal proxies, and implementation/proxy bindings. It
then matches all of the following exactly:

- Solidity `v0.8.34+commit.80d5c536`, Cancun, optimizer enabled with 500 runs, `viaIR: true`, and
  metadata bytecode hash `none`;
- contract name, compilation target, every source path/content hash, compiler settings, ABI, and no
  external libraries;
- compiled creation template plus the exact ABI-encoded constructor suffix against Blockscout's
  full `creation_bytecode` deployment input;
- constructor arguments, deployed runtime bytecode, address, deployer, successful creation
  transaction, and direct-contract status; and
- a bounded verification timestamp no later than the gate observation.

Requests reject redirects, a changed final URL, non-JSON content, oversized headers or streaming
bodies, invalid UTF-8, timeouts, and missing fields. Bytecode equality alone never produces
`VERIFIED`.

## Generate and preserve the immutable wrapper

Core:

```sh
npm run broker:manifest:source-verification -- \
  --kind core \
  --proposal /absolute/path/core-pending-proposal.json \
  > /absolute/path/core-blockscout-verified-wrapper.json
```

Canary:

```sh
npm run broker:manifest:source-verification -- \
  --kind canary \
  --proposal /absolute/path/canary-pending-proposal.json \
  > /absolute/path/canary-blockscout-verified-wrapper.json
```

Shell redirection is the operator's explicit file write; the gate itself writes only to stdout.
Preserve the complete wrapper as immutable review evidence. It embeds the full pending proposal,
its canonical SHA-256, normalized Blockscout and release-source evidence, exact raw-response hashes,
and the proposed final manifest. The validator derives the final manifest from the embedded pending
manifest and permits only three changes: expected contract statuses become `VERIFIED`, the adoption
object is filled, and the fixed verified note replaces the pending note.

## Extract the manifest after review

Do not use `jq`, copy/paste, or manually flip a status. The extractor revalidates the complete
wrapper and prints only its adopted manifest:

```sh
npm run broker:manifest:extract-verified -- \
  --verified-proposal /absolute/path/core-blockscout-verified-wrapper.json \
  > /absolute/path/robinhood.reviewed.json
```

Use the same command for the canary wrapper. Review the wrapper and extracted diff before a separate,
explicit human action installs an extracted manifest as authoritative. Installing a manifest is not
performed or authorized by either command.

The carried `sourceVerificationAdoption` binds the pending proposal, pending manifest, original
pending note, verification evidence, exact contract set/order, explorer origin, chain, and
observation time. Downstream consumers reconstruct the pending manifest by restoring
`NOT_SUBMITTED`, `sourceVerificationAdoption: null`, and the pending note, then require its canonical
SHA-256 to match. This makes post-extraction changes to guardians, canonical identity, feature flags,
contract records, canary identity, or canary configuration fail closed.

The wrapper is deterministic local audit evidence, not an explorer signature. Preserve it with the
reviewed release and adoption commit. Source verification does not authorize deployment,
configuration, account activation, acquisition, minting, or autonomy.
