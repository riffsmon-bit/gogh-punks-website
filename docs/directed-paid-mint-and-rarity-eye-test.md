# Directed paid mint and Rarity Eye owner test

Status on September 12, 2026: all four public setup transactions are verified. Rarity Eye is registered and READY, and the paid-mint factory and adapter are deployed. The selected burn and training interface is prepared for the owner release; paid-mint chat execution remains pending integration. Fork receipts below are simulations, not public burns.

## Selected test

- Robinhood Chain, chain ID 4663.
- Owner: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.
- Burn **#1753**, award one credit to **#93**, then learn **Rarity Eye v1** and equip it.
- Directed paid collection: **Peppies World**, `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`. The tested price was 0.0001 ETH; every live review must read the current price.

## Completed setup

The local setup page at `http://127.0.0.1:64346/` is complete. Do not repeat its four transactions. [Verified public deployment record](review/2026-09-12/selected-launch/deployed-contracts.json).

Paid-mint factory: `0x9f6750857663b77facdebaccdd9025ac168881a5`. Adapter: `0x5e9a4f10b1b4e616f9577932024a0f6001f8cc0b`. Their runtime code and immutable constructor bindings match the tested build. No mint budget has been authorized by this setup.

Forge remains paused on chain until the administrator confirms **Enable Forge** in the production review. This unpauses the shared contracts for all owners while enabling only the Rarity Eye research capability. The production interface is restricted to the selected owner. Neither the administrative transaction nor the interface grants purchase authority.

## Burn and learn acceptance

1. Select #93 in [the production Forge](https://goghpunks.xyz/broker/v2/?tab=forge), sign in, and select **Recheck selected test**. Verify source #1753 and recipient #93. If shown, review **Enable Forge** and confirm the administrator transaction, then recheck its receipt.
2. Select **Review #1753 approval**. Both providers check the four source wallets and canonical anchor. The official chain RPC checks post-baseline standard transfer history, and the server checks current application and legacy records. Read the evidence and confirm that you have no remaining nonstandard assets or off-chain obligations to preserve.
3. Confirm approval for only #1753, then recheck its receipt. Select **Review burn #1753 → credit #93**, review the fresh checks, and type **BURN 1753** before confirming in your wallet. Burning permanently destroys #1753 and can remove access to its wallets, including later deposits. Its assets do not move to #93. An unsent expired review can be cancelled and prepared again; a requested wallet transaction must be recovered, not resent.
4. Verify the public receipt: source #1753 burned, collection supply decreased by one, #93 gained exactly one training credit. A transaction hash alone is not completion.
5. Use **Recheck training**. If offered, claim the Punk's initial rarity slots first; this does not consume the burn credit. Learn Rarity Eye, verify one credit was consumed, and equip it in an available slot. Learning, claiming initial slots and equipping are separate transactions. Training waits for chain finality between actions; recent observations were about 14 minutes. Keep the review saved and recheck while settlement is pending.
6. Compare #93, #94 and #95. The result must identify **SAMPLE_ONLY**, the three-token sample and the metadata block. This is a trait-frequency comparison within that sample, not a collection-wide rarity score or price prediction.
7. Unequip Rarity Eye and verify its equipped research action becomes unavailable. Re-equip it and repeat the comparison.

## Directed paid mint acceptance, after the live flow is enabled

Use [production chat](https://goghpunks.xyz/broker/v2/?tab=talk):

> Mint one NFT from 0xb73f1d1aee57410d537d87b656e98b9d3df5b213 for Punk #93. Show me the exact mint price, execution fee and expiry before I approve the budget.

The owner makes **one funding and authorization transaction** for that mission. The reviewed worker then executes it without another purchase confirmation. First use creates the Punk's separate mint vault and therefore costs more setup gas than later missions. The acquired NFT is delivered to #93's existing Agent wallet.

Verify quantity one, exact collection and native-ETH price, explicit execution fee, expiry no longer than ten minutes, and the final recipient. A changed price must stop execution. Refreshing or repeating worker execution must not mint twice. A failed mint must leave the budget available for cancellation/refund. Cancellation returns unused escrow to its original funder, including after a Punk transfer.

The existing free-only Agent session cannot authorize paid purchases. The new vault keeps a separate finite budget. Current ownership is checked on chain; the original collection has no transfer epoch, so the worker must also check transfer history. Do not claim automatic on-chain invalidation of every transfer away and back.

## Validation evidence

- Current JavaScript suite: 1,881 tests passed. Chat: 1,857 JavaScript tests and 127 deployment checks passed; live Gemini chat and structured-output probes passed after release.
- Contracts: 284 tests passed, including 17 directed-paid-mint tests and 1,024 budget fuzz cases; ABI and contract size checks passed.
- Selected Rarity Eye fork: source #1753 → #93, one credit, learn/equip/unequip, actual metadata comparison, denied mint tool, denied tool after unequip. [Evidence](review/2026-09-12/atomic-forge/rarity-eye-selected-pair-fork.json).
- Directed paid-mint fork: one owner authorization, worker execution, actual Peppies World mint and delivery to #93's Agent wallet. [Evidence](review/2026-09-12/atomic-forge/directed-paid-mint-fork.json).
- Setup journal: restart, stale-tab, duplicate-claim, altered-hash and transaction-recovery tests passed. Browser layout checked at 1440, 375 and 320 pixels without a wallet request.
- Production burn integration: actual deployed Forge contracts on a disposable fork with a separate PostgreSQL journal; enable, token-specific approval, exact burn/credit receipts, concurrent claims, lost-provider hash recovery and server recreation passed. [Evidence](review/2026-09-12/selected-launch/production-burn-integration-fork.json).
- Source wallet review: no incoming standard ERC-20, ERC-721, ERC-1155 or ERC-2309 transfer events from genesis through block 61601377, with canonical anchors checked by a second provider and #93's known mint as a positive control. All four source wallets had zero native ETH, WETH, EntryPoint deposit and transaction nonces. This covers standard transfer events; it does not prove absence of nonstandard entitlements. Fresh checks remain necessary before burning. [Evidence](review/2026-09-12/selected-launch/source-standard-asset-history.json).
- Fresh source check: all four wallets passed; 13 application checks and 12 legacy checks returned zero records. Standard transfer history uses the official chain RPC plus a known positive control; wallet state and anchors use both providers. The live flow repeats these checks before preparation and confirmation. [Evidence](review/2026-09-12/selected-launch/fresh-source-check.json).
- Training storage: separate request and reconciliation roles provisioned in the existing Supabase project; role permissions and certificate/hostname verification passed. Credentials are Netlify secrets restricted to Functions and Production. The separate burn journal uses the restricted request role and a trigger-maintained audit trail; browsers and the broad service role have no journal access. [Burn storage evidence](review/2026-09-12/selected-launch/burn-storage.json).

Floor sweeps and WETH bids remain outside these completed tests and must not be described as live on this evidence.
