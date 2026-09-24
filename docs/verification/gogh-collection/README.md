# Gogh Punks collection — RobinScan source verification

Date: 2026-09-24. Status: **VERIFIED ON ROBINSCAN; PUBLISHED SOURCE CONFIRMED.**

Collection: `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6` on Robinhood Chain, chain ID `4663`.

The official [Etherscan RobinScan announcement](https://info.etherscan.com/what-is-robinscan/) identifies `https://robin.etherscan.io` as the Robinhood explorer and specifies Etherscan API chain ID 4663. [Collection page](https://robin.etherscan.io/address/0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6#code).

## Current evidence

- Direct explorer HTML returned a Cloudflare challenge, rather than contract status. This is **not** evidence that the contract is unverified.
- The owner saved a new API key locally outside the repository with owner-only permissions. It was supplied to the verification subprocess through its environment; no value was printed, committed or deployed.
- Authenticated Etherscan V2 `getsourcecode` confirmed that the source was unverified. Submission was accepted at **2026-09-24T14:38:21.695Z**, after a fresh exact-chain comparison. See `submission.json` for the public verification GUID.
- The single submission progressed from **Pending in queue** to **Pass - Verified**, confirmed at **2026-09-24T14:59:18.695224Z**. No duplicate submission was sent.
- A separate authenticated `getsourcecode` at **2026-09-24T15:00:17.983488Z** confirmed nonempty published source, contract name `GoghPunksOnchain`, exact compiler `v0.8.17+commit.8df45f5f`, optimizer enabled with 200 runs, London EVM, and non-proxy status. The explorer API's license field was blank; SPDX headers remain in the published source.
- The collection's historical release manifest reports Blockscout source verification. Fresh Blockscout API access was also blocked, so that historical claim is not used as proof of current RobinScan verification.
- At block **71,441,446**, hash `0xe44f870339a324e9b0c78e48f9e114b4afaeabff72ec5f74a08ff26880db17b6`, a fresh public RPC read matched all **18,470 runtime bytes** against the original local compiled artifact after inserting the renderer immutable.
- Runtime keccak256: `0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93`.
- The actual deployment transaction `0x7cd34483503c65b37e7130d73197d399922b7a1cca40318f2a9276e02c38b991` was checked through RPC: exact creation bytecode plus constructor arguments, zero value, expected deployer, successful receipt, and expected collection address. Deployment block: **31,277,277**.
- All **21 source files** match their keccak256 hashes in the compiled metadata. The original creation bytecode is **21,245 bytes**; ABI-decoded and re-encoded constructor arguments are **512 bytes**.
- This work reused the existing original compile artifact; it did **not** claim a new Solidity compilation or contract deployment.

No approvals, wallet signatures, ETH transfers, burns, contract deployments or configuration transactions were performed. Explorer source verification publishes public source; it does not modify the contract or enable OpenSea bulk transfers.

## Exact verification package

| File | Purpose |
| --- | --- |
| `compiler-input.json` | Solidity standard JSON, containing the complete 21-file source closure and original compiler settings |
| `metadata.json` | Original compiler metadata, including source hashes and SPDX licenses |
| `constructor-arguments.txt` | Original ABI-encoded constructor arguments, without `0x` |
| `parameters.json` | Etherscan verification parameters; contains no API key |
| `compiled-evidence.json` | Original compiled creation bytecode and deployed runtime with renderer immutable inserted |
| `chain-evidence.json` | Fresh exact-match read evidence and pinned block |
| `checksums.json` | SHA-256 checksums for the six package files |
| `submission.json` | Accepted submission timestamp and public verification GUID; no API key |
| `explorer-status.json` | Explorer's successful verification response and check timestamp |
| `explorer-source-status.json` | Separate published-source metadata confirmation; no source secrets or API key |

Contract name: `src/GoghPunksOnchain.sol:GoghPunksOnchain`.

Compiler: `v0.8.17+commit.8df45f5f`. Optimizer enabled, **200 runs**. **Via IR enabled**. EVM version **London**. Metadata bytecode hash **IPFS**. Original remappings are preserved in standard JSON. The primary contract SPDX license is MIT; imported sources retain their own SPDX headers.

Original source repository: `/Users/brandonduke/Projects/gogh-punks`.

Existing audited artifact: `/private/tmp/gogh-batch-transfer-audit-out/GoghPunksOnchain.sol/GoghPunksOnchain.json`.

The saved package is self-contained; that temporary artifact is required only to regenerate it. Do not flatten or change import paths/settings, which would alter compiled metadata.

## API credential handling

The **Etherscan API V2 key** is available locally for the verification process. It does not need to be installed in the website or Netlify runtime. No paid API service was requested. Verification does not require an owner-wallet transaction.

Do not place the key in documentation, a command-line argument, the frontend, or the verification JSON files. The helper reads only `ETHERSCAN_API_KEY` from its environment and sends it only to `https://api.etherscan.io`.

## Controlled completion

From the website repository, once the key is securely available:

```sh
node scripts/verification/gogh-collection.mjs check
```

If the source is already verified, stop. If the response says `SOURCE_NOT_VERIFIED`, submit once:

```sh
node scripts/verification/gogh-collection.mjs submit
```

Submission first verifies package checksums and rereads the live collection bytecode and exact original deployment. It never invokes a signing or blockchain-write method. A successful API submission saves a public `submission.json` containing the verification GUID; it is **pending**, not verified.

Check that GUID with a separate bounded request:

```sh
node scripts/verification/gogh-collection.mjs status --guid GUID_FROM_SUBMISSION
node scripts/verification/gogh-collection.mjs check
```

No recurring polling, automatic resubmission or paid service is configured. Do not report verified until the API confirms success and `check` returns `ALREADY_VERIFIED`; then inspect the RobinScan contract page. If an API plan or chain-support restriction appears, stop and report it rather than purchasing an upgrade.

The [official verification API](https://docs.etherscan.io/api-reference/endpoint/verifysourcecode) accepts `solidity-standard-json-input`, the fully qualified contract name, compiler version and constructor arguments. Alternatively, upload `compiler-input.json` through RobinScan's Verify and Publish form, select the exact compiler/version and primary MIT license, and paste `constructor-arguments.txt` if requested.

To regenerate the package from the unchanged original repository and saved artifact:

```sh
node scripts/verification/gogh-collection.mjs prepare \
  --source-root /Users/brandonduke/Projects/gogh-punks \
  --artifact /private/tmp/gogh-batch-transfer-audit-out/GoghPunksOnchain.sol/GoghPunksOnchain.json
```

Validation actually executed: source-hash checks, constructor round-trip, actual deployment-input/receipt check, complete runtime comparison, pinned-block canonicality check, script syntax check, authenticated unverified-source lookup, one accepted submission, successful verification status and separate published-source confirmation. Verification is complete; no deployment or contract change was performed.
