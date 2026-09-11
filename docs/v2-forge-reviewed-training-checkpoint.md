# Skill Forge — practice link and reviewed training checkpoint

September 10, 2026 · `feat/punk-transfer-epoch` · additive original-NFT integration.

## Test now on this Mac

[Open Test Punk #44](http://127.0.0.1:64341/control-center?testPunk=44).

This is a running, disposable local chain **31337**, not Robinhood production. No MetaMask, real ETH, real NFT or real burn is needed. The page now includes a collapsible test checklist. Selection is retained in the test URL when switching or refreshing.

1. Select **Test #44**. It starts with one practice credit. Review learning **Contract Detective**, then confirm the local transaction. One learned skill and zero remaining credits should appear.
2. **Inspect Contract** must remain locked: learning is not equipping.
3. Choose Contract Detective in Slot 1, review equip and confirm. Run **Inspect Contract**; expect structured code/interface/proxy observations, explicitly not a security clearance.
4. Unequip and confirm. Inspection must lock again, while the learned skill remains.
5. Switch to another test Punk and back, then refresh. The same token's learned state and confirmed history must remain. Test #1 has a separate spare credit to test **Unlock Slot**; cancelling a review must not consume it.

Only the research calls read real public Robinhood data. Training transactions use local fixtures. State survives page reload/Punk selection, but **restarting the disposable chain resets practice state**. The owner's practice server was left running; automated tests used separate chains and did not consume #44's credit.

If the server has subsequently stopped, start `node scripts/dev/skill-forge/run-control-center.mjs` from this feature worktree and use the URL it prints. Do not start another instance merely to reset an error or replace unresolved transaction history.

## Fixed in the practice page

The shared Forge UI imports `forge-profile-view.js`; the local server previously did not serve that dependency. It now serves it. A regression test recursively requests every transitive browser module, so an omitted shared dependency cannot silently pass the preview route tests again. A fresh isolated browser verified the actual running Test #44 URL, selected token, checklist and seven slots with no JavaScript exceptions or transaction sends.

## New on-chain training boundary — not deployed

`GoghReviewedSkillProgression` inherits the existing rarity/progression rules for a **new deployment**. No original collection, existing account, base progression or production manifest was changed. This does not create a wrapper or replacement NFT.

One reviewed call covers learn, unlock, equip, unequip or rarity allocation. It requires:

- The current original NFT owner as transaction sender.
- A deadline no more than 60 seconds ahead, enforced on chain.
- A single-use per-token training nonce and current state hash, bound to the chain, progression contract, collection, token, owner, credits and slot state.
- Strict operation-specific arguments and all inherited registry, prerequisite, credit and slot checks.

Fixed internal calls reuse the existing rules. Direct inherited owner entry points cannot bypass this boundary. Current owners can invalidate outstanding training reviews; doing so does not erase learning, move funds or alter an agent mission. Reverts roll back nonce and credit changes. A transaction mined after expiry can still cost network gas even though training reverts.

The independent `forge-reviewed-calldata.js` encoder matches the compiled ABI and can encode only these calls and review cancellation. It has no wallet, signing, RPC, arbitrary destination or transaction submission interface.

**Integration boundary:** the running practice UI still uses its existing local coordinator/progression protocol. The new contract and encoder were exercised together on a separate disposable chain. They are not yet the production training coordinator or a production wallet flow. No production skill was promoted to READY.

## Transfer and custody safety

Learning, credits, slots and equipment remain attached to the original collection/token ID. A buyer inherits the state without a wrapper, claim or re-equipping transaction. New owner checks reject the different previous owner's training calls.

The training nonce is **not an NFT transfer epoch**. An original owner who transfers away and back within an unexpired review, with unchanged training state, cannot be detected by this contract alone. A test explicitly documents that limitation. The original-NFT Transfer-history guard is still required before submission, and must not be described as synchronous on-chain revocation. This work does not repair the analogous immutable legacy agent-session limitation.

The reviewed progression introduces no wallet execution module, relayer authority, burn implementation or withdrawal path. Native-value training calls revert. It cannot make parent-NFT burning safe: potentially stranded assets and incomplete wallet/legacy/pending-state inventory still block production sacrifice.

## Verification

| Check | Result |
| --- | --- |
| Full JavaScript suite | **1,437 passed**, zero failed/skipped |
| Full Solidity suite, 1,024 fuzz runs | **234 passed**, zero failed/skipped; includes 15 reviewed-progression tests |
| Encoder ABI/argument tests | 10 passed; all five operations, cancellation, exact integer widths and invalid inputs |
| Shared local preview route tests | 2 passed, including transitive module loading |
| Reviewed contract + browser encoder, real disposable Anvil transactions | PASS: expired/replayed/cancelled calls revert; learn → equip → original safe transfer → buyer unequip; seller denied; one credit spent once |
| Shared UI browser suite | PASS: learn/equip/unequip, read-only tools, stale state, lost hash/receipt recovery, wrong owner/network, 1440/390/375px layouts |
| Owner practice URL smoke check | PASS: Test #44, one credit, seven slots, checklist; no transactions sent |
| Solidity formatting / ABI / EIP-170 | PASS; reviewed progression runtime **8,080 bytes** |
| Site/assets/secret scan, Art Broker checks, JS syntax | PASS; 548 modules checked; existing wallet build reused, not rebuilt |

Local fixture READY entries are test data, not production acceptance. These are development regression tests, not an independent security audit. No full Netlify deployment build was performed.

Reproduce the new tests:

```sh
forge test --offline --match-contract GoghReviewedSkillProgressionTest --fuzz-runs 1024
node --test tests/skill-forge-reviewed-calldata.test.mjs tests/skill-forge-control-center.test.mjs
node scripts/test-reviewed-training-local.mjs --local-only
node scripts/abi-check.mjs
```

## Remaining production gates

1. Wire reviewed calls into the durable production intent/receipt coordinator, exact deployment pins and explicit wallet review, including expiry and ownership continuity recovery.
2. Finish/review the immutable production training source. Disposable mock credits cannot be deployed as a substitute; burn eligibility/recovery is unresolved.
3. Complete registry acceptance and opt-in capability enforcement alongside the current V2 release, without disrupting existing agents or their withdrawals.
4. Review exact bytecode, constructor bindings, frozen rarity root, roles and release target before a read-only deployment canary.
5. Obtain scoped authorization for real training writes. Real burns require separate exact token authorization **and** resolved asset safety; a warning is not sufficient.

No push, main-branch change, Netlify environment update, production deployment, real mint, burn or fund movement occurred in this checkpoint. The dirty core V2 worktree was preserved. See [original-NFT integration readiness](v2-forge-original-nft-readiness.md) for the preceding release boundary.
