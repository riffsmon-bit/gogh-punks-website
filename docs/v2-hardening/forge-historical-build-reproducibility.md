# Historical Forge build reproducibility

Status: PASS — historical acceptance remains exactly pinned; fresh deployment tests use the current compiler output.

Adding unrelated marketplace Solidity sources changed compiler AST identifiers in `immutableReferences`. This changed the aggregate build hash even though all four Forge contracts retained identical creation bytecode, runtime templates, metadata, and immutable groups. The historical acceptance test had incorrectly tried to validate the saved September 12 plan against the current aggregate build identity.

The historical build hash remains `0x63ce4525c0b9cf07182bd867d3630f6875123c7579e2ea14e6495bff44316786`. The current integrated build hash observed during this check was `0x58d470e91ea6d659f6d053fceb7bc267d9c781f40a2348dbf046704b37594b58`. The accepted plan hash remains `0x8cfc3a90a62c833d1298612195ad9b34dc639b3fdb8163f811906f48ba960419`.

## Frozen evidence

`tests/fixtures/forge-accepted-build-immutable-references.json` stores only the four original immutable-reference maps, schema, build hash, and plan hash (3,324 bytes). The maps were copied from preserved artifacts in `/private/tmp/gogh-punk93-mint-stall/contracts/out` and independently matched to every recorded `immutableReferencesHash` in `docs/review/2026-09-12/live-owner/accepted-setup-progress.json` before being written. The test has no dependency on that temporary checkout.

| Contract role | Immutable groups | Total occurrences |
| --- | ---: | ---: |
| deployment | 3 | 3 |
| registry | 0 | 0 |
| progression | 8 | 26 |
| trainingSource | 3 | 9 |

The test-only historical reconstruction first hashes the actual current creation bytecode, runtime template, and metadata and requires exact equality with all recorded pins. The existing current-build loader still validates compiler settings and every metadata source hash. The reconstruction then compares whole immutable groups, preserving the offsets, lengths, multiplicity, and association of occurrences that must hold the same immutable value. Only compiler AST key names and ordering are excluded from this comparison. The frozen maps themselves remain pinned byte-for-byte through their canonical hashes. Finally, all reconstructed build pins and the aggregate build hash must match the recorded acceptance before the unchanged production manifest verifier is invoked.

The original accepted setup, finalized deployment evidence, manifests, signed plan hashes, and production helpers were not modified. Fresh plan, transaction, fee, runtime, and recovery tests continue to consume current artifacts. A current build with a different aggregate identity still cannot validate the historical plan directly.

## Validation

Command:

```sh
node --test tests/skill-forge-deployment.test.mjs tests/skill-forge-deployment-wallet.test.mjs tests/skill-forge-durable-wallet.test.mjs tests/skill-forge-owner-recovery.test.mjs tests/skill-forge-setup-transaction-recovery.test.mjs tests/skill-forge-selected-burn-wallet.test.mjs
```

Result: **79 passed, 0 failed**, including 11 added regression tests. They accept equivalent compiler AST renumbering while rejecting shifted offsets, changed lengths, split groups, merged groups, exchanged group membership, duplicate occurrences, changed historical IDs, changed creation code, changed runtime templates, and changed metadata. Group split/merge/regroup tests preserve the total set of offsets, so merely flattening immutable references would fail to protect these cases.

`git diff --check` passed for the edited test. All checks were local; no credentials, public chain requests, deployments, signatures, or transactions were used.

If future Forge bytecode, metadata, or semantic immutable groups change, this historical compatibility check must fail. A separately reviewed historical artifact and explicit new-build tests would be needed; the accepted plan must not be rewritten to make that change pass.
