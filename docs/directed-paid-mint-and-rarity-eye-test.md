# Directed paid mint and Rarity Eye owner test

Status on September 12, 2026: chat fixes are live. The paid mint contract and selected burn/skill sequence pass disposable-fork simulations. Public paid-mint execution and public burn execution are still pending setup and integration; a simulation receipt is not a public transaction.

## Selected test

- Robinhood Chain, chain ID 4663.
- Owner: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.
- Burn **#1753**, award one credit to **#93**, then learn **Rarity Eye v1** and equip it.
- Directed paid collection: **Peppies World**, `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`. The tested price was 0.0001 ETH; every live review must read the current price.

## Setup now

Open `http://127.0.0.1:64346/` in the browser with the selected administrator wallet. This local page sends wallet transactions to the public chain. It has no signer.

For each displayed setup step, choose **Prepare next transaction**, review its contract and maximum network fee, then **Confirm setup · open wallet**. After signing, use **Recheck receipt**. Each next step waits for both chain providers to verify the preceding receipt. An RPC failure never authorizes resending; recover the original transaction hash from wallet activity if necessary.

The four steps register Rarity Eye, record its testing status, approve its reviewed definition, and deploy the directed paid-mint factory and adapter. These are one-time setup transactions. Forge remains paused. This page does not burn, authorize a mint budget, or spend a training credit.

## Burn and learn acceptance, after the live flow is enabled

1. Select #93 in [the production Forge](https://goghpunks.xyz/broker/v2/?tab=forge). Verify source #1753 and recipient #93 in the burn review.
2. Complete fresh source-wallet asset and mission checks. An empty OpenSea result covers only its indexed NFTs; missing token-history checks must not be treated as an empty wallet.
3. Approve only #1753 for the reviewed burn contract, then review and confirm **BURN 1753**. Burning permanently destroys #1753 and can remove access to its wallets, including later deposits. Its assets do not move to #93.
4. Verify the public receipt: source #1753 burned, collection supply decreased by one, #93 gained exactly one training credit. A transaction hash alone is not completion.
5. Learn Rarity Eye. Verify one credit was consumed and the skill is learned. Equip it in the available slot. Learning and equipping are separate transactions from the burn.
6. Compare #93, #94 and #95. The result must identify **SAMPLE_ONLY**, the three-token sample and the metadata block. This is a trait-frequency comparison within that sample, not a collection-wide rarity score or price prediction.
7. Unequip Rarity Eye and verify its equipped research action becomes unavailable. Re-equip it and repeat the comparison.

## Directed paid mint acceptance, after the live flow is enabled

Use [production chat](https://goghpunks.xyz/broker/v2/?tab=talk):

> Mint one NFT from 0xb73f1d1aee57410d537d87b656e98b9d3df5b213 for Punk #93. Show me the exact mint price, execution fee and expiry before I approve the budget.

The owner makes **one funding and authorization transaction** for that mission. The reviewed worker then executes it without another purchase confirmation. First use creates the Punk's separate mint vault and therefore costs more setup gas than later missions. The acquired NFT is delivered to #93's existing Agent wallet.

Verify quantity one, exact collection and native-ETH price, explicit execution fee, expiry no longer than ten minutes, and the final recipient. A changed price must stop execution. Refreshing or repeating worker execution must not mint twice. A failed mint must leave the budget available for cancellation/refund. Cancellation returns unused escrow to its original funder, including after a Punk transfer.

The existing free-only Agent session cannot authorize paid purchases. The new vault keeps a separate finite budget. Current ownership is checked on chain; the original collection has no transfer epoch, so the worker must also check transfer history. Do not claim automatic on-chain invalidation of every transfer away and back.

## Validation evidence

- Chat: 1,857 JavaScript tests and 127 deployment checks passed; live Gemini chat and structured-output probes passed after release.
- Contracts: 284 tests passed, including 17 directed-paid-mint tests and 1,024 budget fuzz cases; ABI and contract size checks passed.
- Selected Rarity Eye fork: source #1753 → #93, one credit, learn/equip/unequip, actual metadata comparison, denied mint tool, denied tool after unequip. [Evidence](review/2026-09-12/atomic-forge/rarity-eye-selected-pair-fork.json).
- Directed paid-mint fork: one owner authorization, worker execution, actual Peppies World mint and delivery to #93's Agent wallet. [Evidence](review/2026-09-12/atomic-forge/directed-paid-mint-fork.json).
- Setup journal: restart, stale-tab, duplicate-claim, altered-hash and transaction-recovery tests passed. Browser layout checked at 1440, 375 and 320 pixels without a wallet request.
- Source wallet review: no incoming standard ERC-20, ERC-721, ERC-1155 or ERC-2309 transfer events from genesis through block 61601377, with canonical anchors checked by a second provider and #93's known mint as a positive control. All four source wallets had zero native ETH, WETH, EntryPoint deposit and transaction nonces. This covers standard transfer events; it does not prove absence of nonstandard entitlements. Fresh checks remain necessary before burning. [Evidence](review/2026-09-12/selected-launch/source-standard-asset-history.json).
- Training storage: separate request and reconciliation roles provisioned in the existing Supabase project; role permissions and certificate/hostname verification passed. Credentials are Netlify secrets restricted to Functions and Production. Training remains paused.

Floor sweeps and WETH bids remain outside these completed tests and must not be described as live on this evidence.
