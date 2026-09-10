# Original-NFT Forge integration — September 10, 2026

**Implemented and tested on the feature branch; not deployed. Real-Punk training is not ready yet.**

The original Gogh Punk remains the ownership key. There is no wrapper, receipt NFT, buyer claim, account recreation or re-equipping step on sale. This continuation integrates the existing research bench with the original-NFT V2 frontend; it does not replace the core mint worker or change current missions.

## What is connected

- `site/broker/v2/index.html` and `broker-v2.js` now mount the shared Forge controller on this feature branch. Navigation has seven tabs, including Forge.
- `/api/v2/punks/:tokenId/forge` requires an authenticated current owner. Both profile reads and diagnostic results recheck original-NFT Transfer history and canonical blocks before returning. Seller-private conversation state is not part of the Forge response.
- A new original-NFT profile reader validates the collection, registry, progression and immutable training-source runtime hashes; original collection binding; fixed rarity root/snapshot; chain; one base slot; seven-slot cap; learned keys/levels; credit balance; equipment; and canonical block. A malformed or incomplete read is unavailable, never a fabricated empty profile.
- The equipment display distinguishes **unknown**, **locked**, **empty** and **equipped**. Disabled/deprecated skills remain in learned history. Package names/icons are accepted only when repository package hashes match the registered version.
- A verified profile refreshes every 30 seconds while its Forge tab is visible. Refresh does not ask for login or a wallet signature. A changed owner/token clears the previous result; a late old-owner response cannot refill it. An expired session or verification failure requires an explicit recheck.
- The existing canonical capability resolver is reused. This release exposes **no production skill tools or wallet capability through progression**. Lab diagnostics remain explicitly separate from earned/equipped capabilities.

The new `deployments/robinhood-skill-forge.json` is an **UNDEPLOYED proposal**, with null contract addresses and false training/burn authorization. It is not a deployment record. Setting an environment variable or URL flag cannot turn it into a transaction route. A future reviewed `READ_ONLY_CANARY` manifest can enable verified reads only; this handler still has no learn/equip/burn transaction path.

## What was actually tested

| Check | Result |
| --- | --- |
| Full JavaScript regression suite | 1,426 passed; 0 failed/skipped |
| Final targeted profile/API/package tests | 39 passed; 0 failed/skipped |
| Forge, rarity, supply-floor and original inheritance Solidity suites | 34 passed; 0 failed/skipped; fuzz runs 1,024 |
| New contract-to-profile integration | PASS on disposable Anvil: mock sacrifice → credit → learn → equip → original-token safe transfer → buyer profile; zero buyer setup transactions |
| Emergency disable | Learned history and equipment preserved, disabled state displayed; no tools granted by profile reads |
| Full V2 browser integration | PASS: locked/verified/error profiles, wrong-token rejection, late old-owner rejection, silent auto-refresh, no overflow at 1440/390px, zero wallet writes or JS exceptions |
| Live research, public Robinhood RPC | PASS: contract inspection at block **59,417,324**, inline metadata for #93/#94/#95 at **59,417,325**, explicit three-token trait ranking |
| Static checks | Site/assets/secret scan, JS syntax and Art Broker checks passed |
| Bundling | V2 browser source and Forge function source bundled; relocated research catalog loaded three implementation-hashed TESTING packages |

The Anvil integration uses a **disposable fixture at the original collection address and chain ID**, not the live collection. No public RPC is accepted by that script. Mock credit sources and fixture READY registry entries are not production approvals. The earlier fork test of the real deployed accounts is documented separately in [original NFT inheritance](punk-original-nft-inheritance.md).

The live read-only probe retrieved actual chain data; it did not screen a mint for execution or mint an NFT. Contract findings are evidence, not a security clearance. Sample rarity is not whole-collection rarity and does not modify the frozen OpenSea snapshot. Market Scout was not re-probed with a live API credential in this pass. **Zero production skills were promoted to READY.**

## Build/release caveats

The shared installed esbuild executable remains damaged. These source bundle checks used the previously integrity-verified exact locked esbuild 0.28.2 binary, without overwriting shared dependencies. They are not a full Netlify deployment build or a new wallet SDK build.

The function explicitly bundles its versioned instruction/manifests and implementation source files. It resolves runtime data from the function task root, not a source-relative `import.meta.url` that bundling would relocate. This follows Netlify's documented [additional-file bundling configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/#functions); a relocated-bundle smoke test verified local loading and implementation hashes. Actual deployed function acceptance remains required.

No main-branch update, push, Netlify environment change, deployment, production transaction, skill registration or real burn was made. The owner's dirty workspace and running local practice chain were not reset. The feature branch also includes separate transfer research; **do not deploy an old whole-branch snapshot over newer core V2 fixes**. Adopt/reconcile the original-NFT and Forge integration changes with the current core release, then deploy frontend and function together so their profile schema stays in sync.

## Tonight's realistic test boundary

**Ready in code:** original-Punk selection → owner verification → read-only research bench → contract-verified loadout display, plus disposable learn/equip/transfer tests.

**Not yet ready:** burning a real Punk to train another, or claiming that an equipped production Forge skill controls autonomous minting. Existing V2 autonomous sessions are untouched by this read-only integration.

Before real-Punk learn/equip testing:

1. Finish and review the immutable production training source. The current mock sources are not acceptable deployment substitutes. Parent burn can strand assets; incomplete inventory must still block sacrifice. Neither a warning nor an owner approval cures this technical blocker.
2. Finish production training transaction lifecycle: on-chain stale/deadline semantics, durable production intent/recovery storage, confirmed receipt/indexer reconciliation and transfer handling. The local journal is not a production service.
3. Complete registry acceptance and explicit owner opt-in enforcement with core V2. Do not silently stop existing untrained agents, or label legacy mint permission as a learned skill.
4. Review exact deployment bytecode, constructor bindings, rarity root, roles and staged release target. Populate read-only manifest pins only from confirmed deployment receipts/code reads. Re-run the browser/function canary against that deployment.
5. Use a separately authorized, tightly scoped owner-wallet canary for training writes. Real burns remain a later decision, contingent on the unresolved recovery/eligibility engineering and exact sacrificed/surviving token approval.

Original-NFT transfers already move live account control to a different buyer. Immutable legacy accounts still have the documented same-owner round-trip session limitation; worker history checks are mandatory and are not equivalent to synchronous on-chain epoch invalidation. Do not deploy the superseded wrapper to hide that limitation.

## Reproduce

```sh
node --test --test-concurrency=2 tests/*.test.mjs broker/test/*.test.mjs
node scripts/test-original-forge-profile-local.mjs --local-only
node scripts/test-original-punk-transfer-browser.mjs --local-only
node scripts/audit-skill-forge-readonly.mjs --live-readonly
forge test --offline --match-contract 'GoghOriginalPunkInheritanceTest|GoghSkillForgeTest|GoghRaritySkillProgressionTest|GoghForgeSupplyPolicyTest' --fuzz-runs 1024 --summary
```

The first two browser/contract scripts start and stop their own disposable processes. They do not provide a persistent live URL, connect MetaMask or move the real #93.
