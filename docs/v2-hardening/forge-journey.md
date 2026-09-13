# Controlled Forge journey — H05

Status: the composed deployed-stack journey passed on September 13, 2026. This establishes controlled Forge functional acceptance. It is not evidence of a completed public burn, independent provider finality, browser/mobile acceptance or overall production launch readiness.

`test-forge-composed-journey.mjs` composes the existing deployed selected-burn coordinator, durable training coordinator, restricted native PostgreSQL roles, browser review/confirmation modules, receipt reconciler, pinned Rarity Eye implementation, existing `createV2McpResearch` server bridge and original Punk profile reader. It does not introduce a new Forge architecture or modify a contract, release manifest, package hash or runtime business rule.

Run from the repository root:

```sh
node scripts/test-forge-composed-journey.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin
```

An optional `--archive-keychain` reads the already provisioned archive endpoint from the project's macOS Keychain item. No secret is accepted on the command line or printed. The default uses the public Robinhood endpoint. The fork source is behind a strict read-method proxy; only the owned, dynamically allocated loopback Anvil receives mutations. Known user practice ports are rejected. The test owns and cleans up only its new node and PostgreSQL cluster.

The journey uses fork copies of source #1753 and training target #93. A second distinct fork copy, #94, supplies the extra credit needed to unlock a slot after learning Rarity Eye consumes the first credit. Both real originals remain intact. The source-clearance prerequisite is explicitly mocked: this test does not certify #1753 or #94's live inventory or off-chain obligations.

The verified acceptance sequence is:

1. Verify remote chain/anchor and copied runtime pins; start isolated native PostgreSQL with request/worker permissions and denied browser access.
2. Review and enable only Rarity Eye on the fork, approve #1753, then burn its fork copy. Reject incorrect confirmation and missing owner acknowledgment. Race duplicate claims and recover a saved transaction hash after simulated receipt unavailability using a recreated coordinator.
3. Verify one supply decrement and exactly one credit. Learn the released Rarity Eye through the actual durable browser controller and SQL coordinator. Lose the wallet response, retain its attempted marker, reload the controller and reconcile the original hash without sending again.
4. Reject duplicate learning and an unfunded slot unlock. Burn the second fork copy, claim the fixed rarity allocation if needed, and unlock one slot using its credit.
5. Equip Rarity Eye and read actual inline metadata from forked originals #93, #95 and #96 using `rank_trait_sample` through the production server research bridge. Its normal release filtering, state reader and owner-continuity checks run unchanged. Verify the result grants no wallet authority and requires separate economic authorization. Deny `prepare_mint`; unequip and deny the bridge research call; re-equip. The result compares this three-token sample, not global collection rarity.
6. Create a bounded session only on the copied Agent account, then transfer the trained original Punk copy to a second Anvil owner. Verify skills, slots, loadout, Wallet/Agent addresses and the copied Peppies World #1599 custody persist. Reject the old owner and the old worker continuity window. Require a fresh new-owner training review. Training must not reactivate automation.
7. Prove an expired exact training call reverts and its unsent request can be released by the reconciler. Re-read the actual public originals to establish that the test did not change their owners.

The same harness applies the existing sacrifice eligibility function to explicit mocked wallet dust/native, NFT, ERC20, other assets, EntryPoint deposit, open mission, active automation, pending transaction and legacy-lock cases. Passing these logic checks is separate from demonstrating complete live asset discovery.

Limits remain explicit: the two receipt clients share one owned Anvil, so this does not prove independent public providers or public-chain finality. The second-owner allowlist exists only in harness memory; production remains limited to its released owner list. Anvil funds its fresh test actors and credits the impersonated original-owner copy only for local transaction fees. A JavaScript invocation of the browser controller is not a visual browser or mobile-wallet acceptance test. Existing browser suites provide separate presentation evidence. The released account's away-and-back session-revival semantics are not changed by the managed continuity guard. No broad autonomous execution, real burn, refund, sweep or user-fund movement is performed.

`forge-journey-evidence.json` records the latest passing run, its read-only public anchor, fork transaction hashes, pinned skill hashes and SQL event counts. The final run including the server research bridge took 45.4 seconds, sent 16 transactions only on the owned fork, settled eight training operations exactly once and expired one unsent review. It created two credits, spent one learning Rarity Eye and one increasing slots from one to two. The source guard exercised 24 explicit asset/state cases and checked their exact rejection reasons.

## Reproducible local history

The long composition initially exposed an Anvil historical-state availability race after the new owner's first transaction. Raw numeric and `finalized` nonce reads failed at the same immutable local block, then succeeded without any chain writes; the product verifier correctly refused settlement while history was unavailable. The harness now keeps up to 10,000 historical states in memory and uses its own cache directory. This exceeds the bounded journey, avoids shared practice-node caches and preserves the existing finalized block/hash/nonce/receipt checks. The fixture uses fresh random Anvil genesis actors, because well-known development addresses already have unrelated delegation on the public chain. No owner code is cleared or authority check bypassed.

An optional `--inspect-failure` writes sanitized owned-node diagnostic context under `/private/tmp`, allows a bounded two-minute read-only investigation, then performs normal cleanup. It is not used by the passing command. Public fork-source URLs and private keys are never emitted.

## Composed acceptance finding: delegated owner rejected

The September 13 run passed the copied deployed selected burn and native PostgreSQL recovery sequence, then failed `createTrainingCoordinator.prepare(learn)` with `FORGE_TRAINING_STATE_UNVERIFIED`. The baseline owner-code requirement in `broker/src/v4/skill-forge/training-state.mjs` accepted only absent/empty bytecode. An independent read confirmed that the selected owner currently has a 23-byte EIP-7702 delegation designation (`0xef0100` prefix). The copied registry/progression/source runtime pins and constant bindings passed.

This was a product compatibility blocker for that owner's burn→learn journey. The public baseline evidence remains in `forge-owner-runtime-evidence.json`. It was resolved by the reviewed compatibility correction below, without clearing owner code or changing release manifests. Existing burn eligibility, durable wallet and training API fixtures had not established support for that real owner runtime.

## Delegated-owner correction

The parent authorized a narrow correction in `training-state.mjs` and the new `training-owner-origination.mjs`. Training now accepts the existing registry/deployment review pattern: an exact EIP-7702 designation to a nonzero, nonself target with nonempty, nonnested code. The current review's immutable canonical block anchor binds both the designation hash and target runtime hash; claim continuity re-reads and compares them at the current canonical head. Any changed designation or target code fails closed and requires a fresh review. No new review field, database schema, signature type, authorization list, wallet module or contract call is introduced.

This observes designation/runtime continuity, not delegate behavior. A delegate's storage or an indirect proxy implementation can change without changing its observed runtime bytecode. Training remains the same exact direct EIP-1559 transaction from the current owner to the reviewed progression contract. Arbitrary contract owners, malformed designations, missing/empty/nested delegate code, owner changes and changed code hashes are rejected. The parent reviewed the runtime diff independently. Twenty new delegated-owner regressions and 71 combined owner/durable-review/wallet tests passed; the composed journey then passed. Fresh independent security review remains an integration gate.

On-chain burn safety is limited to the exact owner/distinct-token/approval/state/nonce/deadline/supply and exactly-once credit invariants. Inventory completeness and mission clearance are application checks, not atomic on-chain enumeration. These tests do not eliminate the risk from later asset deposits or off-chain obligations. Public burn remains unauthorized.
