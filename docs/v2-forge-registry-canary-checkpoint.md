# Skill Forge — registry-only canary preparation

September 10, 2026 · feature branch `feat/punk-transfer-epoch` · original NFT ownership.

## Outcome and boundary

The next deployment stage can now be prepared and rehearsed without a production burn source. This is a **registry-only review**, not deployment authorization and not a working production training launch. The original collection, existing Punk Wallets, Agent Accounts and V2 missions are unchanged.

The read-only preparation tool emits eight unsigned transaction intents:

1. Create `GoghSkillRegistry` with a proposed guardian.
2. Set global disable and disable every capability bit.
3. Register Contract Detective v1; stage it as TESTING.
4. Register Rarity Eye v1; stage it as TESTING.
5. Register Market Scout v1; stage it as TESTING.

Each of the last three items is two transactions. The initial registry is empty; no skill is available before the disable transaction. Every definition remains TESTING and unavailable afterwards. No step installs a module, approves a token, changes wallet delegation, calls a Punk Wallet, issues a training credit, creates progression, or burns an NFT. Transaction value is zero; an eventual real deployment would still cost network fees.

`deployments/robinhood-skill-forge.json` remains UNDEPLOYED, with null registry/progression/training-source addresses and both production authorization flags false. A disposable fork address must never be copied into it.

## Reproduce the review

From the feature worktree, with the existing locked dependencies and Foundry installed:

```sh
forge build --offline
node --test tests/skill-forge-registry-canary.test.mjs
node scripts/test-forge-registry-canary-fork.mjs --fork-readonly
node scripts/prepare-forge-registry-canary.mjs --live-readonly --guardian=0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6
```

The last command uses the owner's public address as an **unapproved proposal**, not a governance choice already made. It reads public Robinhood state and estimates registry creation only. It does not access environment secrets, encrypted keys, MetaMask, a signer, or any public transaction-sending method. Its stdout contains the JSON proposal; there is deliberately no public deployment command.

The fork runner creates and tears down its own loopback-only Anvil process. All eight writes use disposable accounts and balances on that process. The public upstream is used only for fork reads. It never resets either existing practice server (ports 64341 and 64342).

After a separately authorized real deployment, the read-only verifier can consume a saved proposal and the eight public receipt hashes in order:

```sh
node scripts/verify-forge-registry-canary.mjs --live-readonly --proposal=review.json --transactions=HASH1,HASH2,HASH3,HASH4,HASH5,HASH6,HASH7,HASH8
```

Replace the placeholder hashes with full `0x` transaction hashes. The input may be the complete preparation result or its `proposal` object. Verification produces evidence only; it does not adopt a deployment manifest or promote a skill.

## What is pinned and checked

- Original collection `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`, chain 4663 and its existing runtime hash.
- Solidity 0.8.34, optimizer 500, via-IR, Cancun, source hashes for the registry and its three OpenZeppelin dependencies, compiler metadata and creation/runtime bytecode hashes. An artifact whose source hashes no longer match is rejected.
- Actual reviewed package manifests, instruction bytes and implementation hashes, with exactly three read-only tool/capability mappings and no wallet/executor grants.
- Proposed guardian, observed wallet/delegate code hashes, pending account nonce, predicted CREATE address, a fresh canonical block anchor, sequential transaction nonces and fixed zero-value calldata.
- Canonical successful receipts, sender, target, chain, nonce, calldata, creation address, ordering and transaction type. Transactions carrying authorization lists are rejected.
- Twelve additional L2 blocks after each receipt, canonical anchor timestamp and a final block-hash recheck. This is a confirmation-depth check, **not a claim of L1 finality**.
- Exact deployed runtime, owner, no pending owner, global disable, all capability bits disabled, three exact definitions, TESTING status and `available=false` for each.

The proposal expires ten minutes after its block anchor. This is an **off-chain review/verification deadline**, not an on-chain expiry on registry admin methods. It must not be confused with the separate reviewed progression contract's on-chain training deadline. There is no sender here that could bypass the review deadline.

This is source/build and RPC/receipt checking, not an independent contract audit or cryptographic proof against a dishonest RPC. Fee fields/gas limits are not a signed owner spending authorization. Receipt `gasUsed × effectiveGasPrice` is recorded as an execution-fee component; additional chain fees are not assumed to be included.

## Existing wallet delegation

The public preflight observed an existing 23-byte EIP-7702 delegation marker on the proposed guardian. EIP-7702 explicitly permits transaction origination from an account carrying a valid delegation indicator. [Transaction origination specification](https://eips.ethereum.org/EIPS/eip-7702#transaction-origination).

The preparer recognizes only an empty-code EOA or the exact indicator format, reads the target code, rejects empty/nested/self targets, and pins both code hashes. Other contract-wallet execution flows are not supported by this proposal. It creates **no** authorization list and does not install, revoke or change wallet code.

The observed delegate target is `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`. Its observed runtime hash is `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0`. These observations do not establish that the delegate is audited, trustworthy, non-upgradeable or appropriate for registry administration. Existing-delegation review remains an explicit blocker before adopting this guardian.

## Skills staged, not activated

| Package | Capability / tools | Canary state |
|---|---|---|
| Contract Detective v1 | CONTRACT_READ / `inspect_contract` | TESTING, globally disabled, no wallet authority |
| Rarity Eye v1 | RARITY_READ / `get_metadata`, `rank_trait_sample` | TESTING, globally disabled, no wallet authority |
| Market Scout v1 | MARKET_READ / `get_market_listings` | TESTING, globally disabled, no wallet authority |

These are the existing narrow research implementations, not newly invented skills or upgraded production approvals. Market Scout still needs its approved API credential at runtime; none was read for this rehearsal. Contract inspection is not security clearance. Sample rarity is not collection-wide rarity. Sniper and Mint Hunter are not included in the canary's capability grants.

## Evidence and verification

The accompanying [machine-readable checkpoint](v2-forge-registry-canary-evidence.json) records the read-only observation, package/build pins and disposable-fork result. Historical quotes and proposal hashes are not current signable authorizations.

The fork verifies all eight real local transactions and rejects insufficient receipt depth, outsider admin calls and twelve corruption cases: value, nonce, chain, target, calldata, transaction type, authorization list, reverted receipt, runtime code, guardian code, emergency state and definition status. Neither the fork nor the unit tests certify an independent security audit.

Regression results:

- Full JavaScript suite: **1,469 passed**, zero failed/skipped. The 26 registry-canary tests also passed again after the final hardening changes.
- Focused Forge/registry and reviewed-progression Solidity suites: **34 passed**, zero failed/skipped, 1,024 fuzz runs. No Solidity source changed in this checkpoint.
- Offline contract build/size check passed (cached compilation); registry runtime is 3,175 bytes. Its pinned runtime hash is `0x6a061b9d291e4402e32f93e7815cb2fe2242e725fe4052740f2be0a78049d3c3`.
- Syntax checks passed for 557 JavaScript modules; site/assets/secret scan, Art Broker and ABI/EIP-170 checks passed.
- Final fork rehearsal passed at public base block 59,491,496. The separate public read-only proposal observed block 59,491,487. The creation estimate was 775,485 gas at the then-observed gas price; this is historical, creation-only and not a full deployment budget.
- No wallet-SDK rebuild, full Netlify build/deploy, new browser-feature test, public signing or transaction occurred. This checkpoint changes operator review tooling, not the shared browser UI.

## Exact next production authorization

Before any public registry transaction:

1. Explicitly choose and approve the registry guardian. The address above has not been approved for this role; review its existing delegate or choose a separately reviewed administration path.
2. Review a fresh proposal, the exact compiled registry/package pins, all eight calls, a complete network-fee budget and explicit maximum fees. The preparer's creation estimate alone is **not** that budget.
3. Authorize only this registry-only deployment/configuration, with all skills TESTING and globally disabled. Coordinate the owner's signing window then; there is no reason to unlock an encrypted key now.
4. Verify public receipts/code/roles after the confirmation threshold and independently review the evidence before adopting any canonical deployment manifest.

This authorization would **not** approve a production burn, training credit, skill learning transaction, new wallet permission, NFT purchase or public training UI.

## Still required for real training

The immutable production training source is not approved. A real sacrifice must prove current control of both original Punks and cannot rely on a mock issuer or token nonexistence alone. Burning a parent can leave persistent wallet addresses without a recoverable owner path; empty native balance and a warning do not establish complete inventory, absence of unresolved state, or future asset recovery.

Production training also still needs the reviewed burn/recovery design, source/deployed-code audit, durable production coordinator/indexer and receipt recovery, accepted registry capability integration, exact progression/source/rarity pins, and its own scoped canary authorization. The 1,111 Forge supply floor and frozen rarity allocation are unchanged; this registry stage does not enforce the floor on the collection's existing direct-burn path.

Existing training remains available at [reviewed local practice — Test #44](http://127.0.0.1:64342/control-center?testPunk=44), with the user's contract state preserved. See the [reviewed browser checkpoint](v2-forge-reviewed-ui-checkpoint.md), [original-NFT readiness](v2-forge-original-nft-readiness.md), and [burn safety audit](v2-skill-forge-burn-audit.md).
