# OpenSea Studio free-mint automation V3

V3 broadens the free-only autonomous lane from one canonical 45-byte OpenSea
Studio clone runtime to exactly two reviewed runtime families:

- the canonical minimal-proxy clone runtime pinned to the reviewed OpenSea
  implementation; and
- the pinned full `ERC721SeaDrop` Studio runtime represented by
  `0xC73Ee4987FDAd897e691EEccfa65C80Efb97f6f4` on Robinhood Chain.

This is not generic SeaDrop execution. A target must use one of those exact
runtime hashes and lengths, support ERC-721, use canonical SeaDrop, expose an
active public drop, charge exactly zero native currency, retain wallet and
supply capacity, use quantity one, have no adapter data, require no token
approval, and pass the complete Punk Account call simulation. The next token ID
is bound to `currentTotalMinted + 1`, matching the reviewed Studio contracts.
Unknown implementations, custom SeaDrop contracts, paid mints, allowlist proofs,
arbitrary calldata, approvals, ERC-1155, selling, and Phase 2 paid minting remain
outside V3.

`BrokerPolicyModuleV3` is the logical V3 deployment role. Its Solidity wrapper
adds no executable code over `BrokerPolicyModuleV2`, so the compiler emits
identical creation and runtime bytecode and Forge, Sourcify, and Blockscout use
`BrokerPolicyModuleV2` as the canonical compiled/source identity. The V3
manifest still binds the deployed policy address to the V3 adapter constructor,
the Guardian Safe, and the existing adapter registry. The V3 Punk Account is
similarly verified under its canonical `GoghPunkAccountV1` bytecode identity.

## Current status

`deployments/robinhood-automation-v3.json` records the four source-verified V3
deployments. V3 configuration remains deliberately disabled: the adapter is not
registered, the Guardian feature flags and global agent approval are off, the
worker is not enabled, and automatic submission is not authorized. The public
status and owner-setup endpoints therefore remain fail closed while V2 stays
available.

## Release sequence

1. Commit a clean release containing the V3 contracts, builder, worker, tests,
   and source-verification support.
2. Run the V3 Foundry deployment script without `--broadcast` and review the
   four CREATE transactions, predicted addresses, constructors, and gas.
3. Obtain a separate explicit broadcast approval and deploy using the encrypted
   deployer keystore. Deployment alone does not configure or authorize V3.
4. After at least 20 confirmations, build the pending manifest from two distinct
   RPC providers:

   ```sh
   npm run broker:autonomy:v3-deployment-manifest-proposal -- \
     --artifact /absolute/path/to/run-latest.json \
     --git-commit FULL_40_HEX_RELEASE_COMMIT \
     --guardian REVIEWED_GUARDIAN_ADDRESS \
     --confirmations 20 > /absolute/path/automation-v3-pending.json
   ```

5. Verify all four contracts from the same clean release, adopt the source
   evidence, and install the reviewed authoritative manifest separately:

   ```sh
   npm run broker:manifest:source-verification -- \
     --kind automation-v3 \
     --proposal /absolute/path/automation-v3-pending.json \
     --release-root /absolute/path/to/clean-release \
     > /absolute/path/automation-v3-verified-wrapper.json

   npm run broker:manifest:extract-verified -- \
     --proposal /absolute/path/automation-v3-verified-wrapper.json \
     > /absolute/path/robinhood-automation-v3.verified.json
   ```

   Review both files before replacing the authoritative manifest. The extractor
   permits only the exact pending-to-`VERIFIED` source transition; it cannot
   enable configuration or automatic submission.
6. The Guardian Safe registers only the V3 adapter and enables the bounded V3
   feature tuple. Publish the worker release with V3 disabled first, confirm the
   public status remains closed, then explicitly enable the worker.
7. Owners activate a V3 Punk Account, set a hard daily cap of 1, 3, 5, or 10,
   and authorize the published agent for 7, 14, or 30 days. Those are explicit
   owner transactions. A mandate signature alone cannot grant authority.

The V3 worker submits at most one mint per invocation and waits for its receipt
before another nonce can be planned. Its transaction value is always zero; the
separate hosted agent pays gas and the selected Punk Account receives the NFT.
The V3 status endpoint is `/api/broker/autonomy-v3-status`; the owner setup
endpoint is `/api/broker/autonomy-v3-owner-setup`.
