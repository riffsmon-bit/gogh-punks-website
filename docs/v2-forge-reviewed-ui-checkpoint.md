# Reviewed Skill Forge — shared browser integration

September 10, 2026 · feature branch `feat/punk-transfer-epoch` · original NFT ownership model.

## Next test page

[Open reviewed training — Test #44](http://127.0.0.1:64342/control-center?testPunk=44) on this Mac.

The earlier practice page on port **64341** and its chain/journal were preserved. Port **64342** uses a separate disposable chain **31337**, reviewed progression deployment and journal. These are not real Gogh Punks, production ETH or MetaMask transactions.

1. Review learning **Contract Detective**. The dialog now shows **ON-CHAIN EXPIRY**, a training nonce and its deadline. Cancel once; no credit should be spent.
2. Review again, confirm, then equip in Slot 1. The tool stays locked until equipment is confirmed.
3. Run inspection, unequip and verify the tool locks while the learned skill remains.
4. Refresh/switch Punks and verify contract state and history persist. Test #1 has prelearned research skills and a spare slot-unlock credit.
5. Optional expiry check: leave a review open past its displayed deadline, then confirm. The browser should require a fresh review without sending. Automated tests additionally verify expiry **after** wallet preflight, where the actual transaction reaches the contract and reverts.

One practice credit buys one skill **or** one slot. Restarting either disposable chain resets that chain's practice state; page reload does not. Neither page permits a real Punk sacrifice. Research calls use read-only PublicNode data, not wallet execution.

To start this separate server if it is no longer running:

```sh
node scripts/dev/skill-forge/run-reviewed-control-center.mjs
```

## What is now connected

The new `GoghReviewedSkillProgression` contract is connected through the existing training coordinator, SQLite recovery journal, one-shot EIP-1193 test-wallet adapter and shared equipment UI. This closes the preceding checkpoint's **local browser** integration gap; it does not activate production training.

- Preparation constructs the exact reviewed contract call and binds it to the selected original token, owner, contract, operation, training nonce, state hash and on-chain deadline.
- The browser independently reconstructs guarded calldata and verifies the same zero-value, gas, account nonce, cost and expiry envelope. Explicit reviewed adapters reject legacy/missing/altered guard data. The legacy flow does not silently adopt the new protocol.
- The server checks current ownership, transfer history, state, account nonce and simulation again before the one-shot wallet request. It records the request durably before sending.
- Successful reconciliation requires the exact transaction and canonical receipt, the matching learning/equipment event **and** `TrainingReviewApplied` with the reviewed token, nonce and operation.
- Prepared/submitted/unknown-hash reviews can recover through the existing journal machinery. A known hash is never sent again. The journal identity separates reviewed and legacy deployments, and resume rejects a protocol downgrade.
- Original-NFT transfers retain training. Transfer-history changes invalidate a pending review even if ownership later returns to the same address. This is still an off-chain continuity guard, **not** a synchronous NFT transfer epoch.

The reviewed preview initializes one-slot rarity allocations using a **disposable mock Merkle tree**, so inherited rarity-before-slot-unlock rules are exercised. This is not the frozen production snapshot or a production rarity claim. Fixture READY definitions remain disposable test data.

The existing live practice session remains compatible: shared modules gained explicit validation callbacks, without adding a static dependency that its already-running server cannot serve. Legacy journal fingerprints remain unchanged. The new deployment mode is a trusted local launcher choice, not an HTTP/query toggle.

## Verification

- Full JavaScript suite: **1,443 passed**, zero failed/skipped.
- Six new integration tests passed: complete HTTP/coordinator/contract learn/equip/unequip/unlock flow; altered requests and legacy downgrade rejection; round-trip continuity; real reverted transaction after delayed wallet submission; durable server resume; and explicit page/module routing.
- Both full shared browser scenarios passed: **legacy and reviewed**. Each covered real disposable transactions, live read-only inspection/trait sampling, confirm/cancel, pending receipts, coordinator restart, page reload without resend, lost-hash recovery, owner/token/chain changes, stale responses and layouts at 1440/390/375px. The reviewed dialog's on-chain expiry notice was checked.
- The reviewed Solidity suite passed again: **15 tests**, zero failed/skipped, 1,024 fuzz runs. No Solidity source changed in this checkpoint.
- Syntax checks passed for **552 JavaScript modules**. Site/assets/secret scan, Art Broker checks and ABI/EIP-170 checks passed.
- The reviewed browser adapter bundled successfully (10,934 bytes before minification). As previously documented, this used the verified locked esbuild binary because the shared installed binary is damaged; shared dependencies were not overwritten. This is not a full Netlify or wallet SDK rebuild.

These are engineering regressions, not an independent contract/security audit. The late-transaction test proves **no training credit/nonce mutation on revert**, not free network fees: a reverted transaction still uses gas. Synthetic research data in unit tests is not counted as live acceptance; browser research did use live public reads.

## Production boundary

No production deployment, manifest pin change, skill READY promotion, real training credit, NFT burn, mint, wallet module installation, funds movement, Netlify environment update or main-branch push occurred.

Still required before real training writes: an approved immutable production training source; resolved burn inventory/post-burn asset safety; a production durable coordinator/indexer and receipt recovery service; acceptance of the deployed registry/capability integration; exact deployment/role/rarity pins; and a scoped production canary authorization. Existing V2 agent sessions remain unchanged. A warning cannot substitute for proof that a sacrifice will not strand assets.

See [previous reviewed-contract checkpoint](v2-forge-reviewed-training-checkpoint.md) and [original-NFT release readiness](v2-forge-original-nft-readiness.md).
