# Forge ownership-transfer checkpoint — September 9, 2026

Follow-up: [worker ownership-continuity mitigation](./punk-agent-ownership-continuity.md) is implemented and locally tested, not deployed. It reduces worker-side exposure but does NOT fix the already-signed-operation contract gap described below.

Scope: disposable Anvil fixtures and Foundry's in-memory EVM only. No production RPC transaction, deployment, NFT transfer, burn, wallet signature or change to Punk #93. The owner's running practice preview is not used for these mutations.

## Progression lifecycle

`GoghSkillForge.t.sol` now separately exercises direct `transferFrom`, owner `safeTransferFrom`, and approved-operator `safeTransferFrom`. The operator route models the ownership-transfer primitive, not a complete marketplace/Seaport sale.

Each route checks preservation of learned IDs/order, current learned levels, both equipped skills, unlocked slots, unspent credits and aggregate credit counters. Alice loses loadout/slot control. Alice's previously approved operator does not gain progression control. Bob can unequip/re-equip and spend the inherited credit to unlock another slot. No transfer itself consumes a credit.

This verifies the levels implemented today (level 1), not future mastery or achievement machinery.

## Account authority and explicit reauthorization

`testTransferRequiresExplicitNewOwnerSessionBeforeMinting` checks that the agent-account address remains unchanged, Bob becomes its owner, the old session becomes inactive, and Alice cannot configure a replacement session. Only Bob's explicit configuration creates a new session generation. That session can then validate and execute a bounded mock mint. This is separate from Forge equipment integration; it is not a production training acceptance test.

## Round-trip automation safety gap

`testKnownGapRoundTripTransferCanReviveOldSession` is deliberately a **characterization of an unsafe existing behavior**, not a security acceptance test. It tests Alice → Bob → Alice without any new authorization. The account's current predicate compares `session.authorizingOwner` with `owner()` but does not bind a transfer epoch. The test attempts to validate the original signed operation and execute its mock mint after the return transfer.

The characterization PASSED: the original signature validated and its mock mint executed after the return transfer. The requirement “automation stays paused after every transfer until fresh approval” is NOT satisfied. Green test output must not be described as full transfer safety. The core team needs a reviewed mechanism that invalidates old economic authorization across every ownership transition, including away-and-back transfers. No account implementation or production permissions are changed by this checkpoint. This reproduces a contract-level behavior, not a claim that a live worker submitted such an operation or that a production exploit occurred.

The local Forge review coordinator already binds an ownership epoch derived from fixture Transfer logs and rejects a review prepared before a round trip. That off-chain local-review protection does not repair the separate agent-account contract.

## Remaining integration checks

- Production worker/indexer transfer handling and reorg/finality behavior are not proven by these local contract tests.
- Previous-owner chat privacy needs a full authenticated database/API transfer test; source-level owner scoping alone is not end-to-end proof.
- Actual marketplace settlement, production loadout enrollment, delayed signature expiry, higher mastery and achievements remain separate acceptance work.
- Public production training and burns remain locked; there are no new production READY registrations.

## Verification

Final contract run: 19 Forge tests and 14 agent-account tests passed, including 256 unauthorized-owner fuzz cases. One of those 33 passing tests is the explicit unsafe-behavior characterization above; it is NOT a safety pass. Solidity 0.8.34 compilation and formatting completed successfully. Only test code was changed.

JavaScript suites completed: 97 Forge capability/runtime/review/view tests and 18 V2 ownership/account endpoint/runtime tests passed. These include withholding research results when ownership changes mid-call, owner/chain selection invalidation and rejecting a prepared local review after a real fixture round trip.

Read-only post-check: the existing practice UI returned HTTP 200, and Test #44 still had zero credits, one learned skill and one equipped skill. No restart or mutation of that preview was performed.
