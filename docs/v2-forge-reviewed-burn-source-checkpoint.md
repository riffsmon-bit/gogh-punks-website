# Reviewed original-Punk burn source — September 12 checkpoint

**Connected stack continuation:** [the deployment checkpoint](V2_FORGE_CONTRACT_DEPLOYMENT.md)
adds atomic paused deployment, runtime/receipt attestation, manifest candidates
and actual-source wiring in new browser practice instances. Public deployment and
production burn integration remain open.

The approved disposable review now has a contract candidate and an unsigned
approval/burn preparation library. This is implementation evidence for the
September 16 training release; it is not a deployed or enabled production burn flow.

The existing live local practice was preserved. Its confirmed Test #7 burn awarded
Test #44 one credit; the owner spent that credit to unlock its second slot. That
action did not learn a skill. No earlier practice process was restarted.

## Implemented

`GoghReviewedBurnSource` uses the original collection's ordinary ERC-721 approval,
ownership, burn and total-supply interfaces. A new reviewed-progression deployment
binds to the source exactly once; collection/progression/source identity is checked,
and the creator has no rebinding, withdrawal, upgrade or arbitrary-call authority.
The source has 4,550 runtime bytes under the current optimized build.

The owner must approve the individual source NFT and separately submit an exact
burn review. Operator-wide approval is rejected, including when it accompanies
individual approval. The source checks current ownership of both distinct Punks,
its per-source nonce, the source and recipient's progression state, supply, chain,
deployment identity, pinned runtimes, the registry's global pause and a maximum
60-second deadline. Burning and awarding exactly one credit are atomic. The
1,111 supply floor applies before and after; unexpected supply changes revert the
whole transaction. Learning, unlocking a slot and equipping remain separate reviews.

The owner can invalidate outstanding burn reviews without burning. A burn review
cannot accept ETH. NFT approval itself has no on-chain expiry and should be revoked
when abandoned; the unsigned approval review explicitly explains this.

`forge-burn-calldata.js` independently encodes only individual approval, the fixed
burn tuple and nonce invalidation. It rejects malformed values, extra fields and
accessors. `reviewed-burn.mjs` reads pinned contracts, simulates and estimates
bounded zero-value transactions, preserves the exact reviewed bytes, rechecks
ownership/approvals/state/fees/nonces, and verifies approval or burn receipts.
It contains no wallet connection, signer or send method. Its outputs explicitly
retain `productionAuthority: false` and `walletInventoryReviewed: false`.

Burn receipt verification binds the transaction, gas, chain and canonical block,
the exact collection Transfer, progression credit event and source review event,
recipient ownership, supply change and credit state. A missing receipt is pending;
altered evidence is rejected. These are canonical receipt checks against the given
RPC client, not a production finalized-block or independent-provider attestation.

## Original-NFT transfer boundary

The production collection does not provide the mock's synchronous ownership-epoch
counter. Source transfers clear individual ERC-721 approval, but a recipient's
away-and-back transfer can leave the contract's owner/state hash unchanged.

The preparation library therefore checks both Punks' canonical Transfer logs from
the review block through each fresh submission recheck, including after simulation.
A transfer of either Punk invalidates the review even when it returns to the same
owner. The review anchor must remain canonical; scans are limited to 256 blocks.
Tests explicitly document the on-chain limitation and exercise the client guard.
This does not create a new synchronous hook in the original collection or prevent
a transfer after the final client check. Deployment acceptance must retain this
boundary rather than claim full on-chain ownership-epoch protection.

## Wallet access is still lost

A separate test uses the actual V1, V2, V3 and Agent Account implementations with a
disposable collection and EntryPoint. After the new source burns their parent,
all four owners become zero, their code and native assets remain, and the former
owner cannot withdraw. The Agent's EntryPoint deposit remains but cannot be
withdrawn by that former owner either.

The loss test deliberately leaves assets to demonstrate the consequence. The source
contract does not attest wallet inventories. It is not sufficient to deploy this
contract and display a checkbox: the owner flow still needs known-asset recovery,
mission/session shutdown, fresh inspection and the explicit remaining/future-asset
warning before offering a live burn.

## Verification

- All 1,741 JavaScript tests passed, with zero failures or skips.
- All 260 contract tests passed; fuzz cases used 1,024 runs. Of these, 26 exercise
  the new burn source, adversarial collection callbacks and actual wallet access.
- The site deployment gate passed, including all 127 deployment tests, wallet
  bundle build, site validation, JavaScript syntax and broker checks.
- Formatting, offline build, high-severity lint, ABI boundary and EIP-170 size
  checks passed. Fixed browser calldata matches independent ABI encoding.
- The new disposable-chain integration sent individual approval and the exact
  reviewed burn, verified both receipts, rejected source/recipient round trips,
  operator approval, stale cancellation, pause and altered receipt evidence, and
  confirmed exactly one credit. It used a new Anvil process and left the owner's
  completed practice session intact.

Machine-readable evidence is in
[`review/2026-09-12/reviewed-burn/`](review/2026-09-12/reviewed-burn/).
Reproduce with:

```sh
npm run contracts:check
npm test
node scripts/test-reviewed-burn-local.mjs --local-only
npm run site:deploy-check
```

## Release work still required

The production training manifest still has null deployment addresses and disabled
authority flags. There is no production burn endpoint or public wallet sender for
this candidate. Production wallet inventory/recovery integration, durable burn
intents and nonce/hash recovery, independent finalized receipt reconciliation,
source mission/lifecycle cleanup, deployment verification and owner-operated live
acceptance are still required. The owner explicitly made burn-to-training a September 16 launch requirement
on September 12; these items now belong to the release critical path.

The owner requested a guide for the complete live product. It is prepared in
[the live owner test guide](LIVE_OWNER_TEST_GUIDE_2026-09-16.md), with expected
results, recovery cases and conditional sections for features not yet released.
The guide does not mark any of the pending live acceptance cases as passed.
