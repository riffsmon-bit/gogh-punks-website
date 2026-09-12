# Skill Forge: burn and Punk Wallet safety checkpoint

Status: additive local work only; **production burns locked**. No NFT has been burned, moved or approved by this work. Read-only RPC simulations do not sign or broadcast transactions.

## 1. Collection burn support

Local collection source: `/Users/brandonduke/Projects/gogh-punks/src/GoghPunksOnchain.sol`, inherited `lib/seadrop/src/ERC721SeaDrop.sol:154`. `burn(uint256)` calls ERC721A `_burn(tokenId, true)`: owner or approved operator; clears approvals, emits `Transfer(owner, address(0), id)` and increments burned count. Owner balance and circulating `totalSupply` decrease. Historical minted count does not decrease. `ownerOf`, `tokenURI` and `locked` reject nonexistent/burned tokens.

Read-only public RPC at block **58172057**: owner simulation of `burn(93)` succeeded; nonowner `0x...dEaD` reverted (`0x59c896be`). Owner `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. `totalSupply=4295`, `historicalMintCount=5016`, `secondaryTransfersUnlocked=true`. These are dated snapshots, not permanent UI constants.

Collection transfer lock gates transfer/approval until the historical mint threshold; burn is deliberately available before unlock. Source exposes collection administration (SeaDrop config, royalties/metadata configuration, reserved airdrop), not an owner-funded recovery override for burned accounts. Renderer is immutable in this local implementation. The source is not a substitute for deployed-artifact verification: explorer source retrieval failed and a byte-for-byte local artifact match has not yet been completed. Live runtime hash recorded in the source audit.

OpenSea/ERC721 indexing should observe standard burn Transfer events; actual marketplace refresh timing was not tested. Ownership discovery must query current existence, not enumerate historical IDs as owned.

## 2–3. Wallet authority and stranded assets

`GoghPunkAccountV1.owner()` resolves canonical collection `ownerOf`; V2/V3 inherit this logic. `GoghPunkAgentAccount.owner()` likewise returns zero when ownership lookup reverts. Agent sessions require the current nonzero owner to match their authorizer. After burn, these owner paths do not offer an authorized recovery caller.

Account code and deterministic registry addresses still exist after parent burn. They can still receive native assets or token transfers, including deposits made after burn. Existing registries continue computing the address; registry resolution is not recovery authority. Burning does not migrate any asset. No approved general post-burn recovery mechanism has been demonstrated.

**Never represent a warning acknowledgement as proof assets are safe.** Incomplete ERC20/ERC721/ERC1155 inventories, counterfactual wallets, pending transfers, EntryPoint deposits, approvals, legacy obligations and inspection-to-burn races all matter. Unknown/completeness errors fail closed. Even a clean indexer response cannot prove no arbitrary token contracts hold balances for an address.

Punk #93 observation: V3 canonical wallet `0x06D5e0Df2Eb9512777403bF017031618F4713e19` holds **0.0012 ETH**; separate agent account `0xcadcfd37e715bc031cf0cec7fa2335091c878c83` and EntryPoint deposit were empty. Original V1 and V2 accounts were empty in native ETH only. No token-inventory completeness claim. #93 is not burn-eligible. No funds were moved.

## 4. Skill module compatibility

Existing wallets have bounded executor/policy surfaces, not a generic audited plugin installer. Add capabilities to the application policy/MCP/AI layers and use existing reviewed adapters. Do not install external wallet runtimes. Off-chain gates alone cannot retroactively constrain a previously signed immutable account session. Any economically binding on-chain skill hook requires separate core integration/security review; leave existing owner withdrawal access intact.

## 5–6. State placement

Recommended additive registry + progression contract keyed by the immutable collection and token ID: burn-backed credit balances, pinned learned skill versions, levels/milestones, unlocked slots, equipped skills, public achievement/provenance events. Current owner checks use canonical on-chain `ownerOf`, not stored owner addresses. Rich display content and manifest packages are content-addressed off-chain. Database is an index/cache, not permanent skill authority. Private chat/preferences remain owner-specific.

## 7–9. Realistic initial capabilities

See [source audit](v2-skill-source-audit.md). Contract evidence, rarity and market reads are read-only. Link resolution does not grant mint authority. Mint Hunter is free-only and requires existing owner policy, simulation, code/adapter checks and bounded executor permission. Paid Mint License and trading are not activated. None of the new production skill packages is READY yet.

## 10. Emergency disable and transfer model

Require deny-only global capability/adapter/version switches checked at resolution AND execution time; preserve learned history. No admin withdrawal power. Registry changes must not silently broaden a pinned version. On transfer, keep token progression and loadout but invalidate/revoke economic authorization pending new-owner reactivation; owner-specific conversations must not migrate. Existing owner comparison protects a different owner, but sell-and-buy-back/session resurrection and transfer event/reorg handling still require tests and an ownership epoch—not merely comparing two addresses.

## Warning UI and current implementation

`burn-eligibility.mjs` checks evidence from all V1/V2/V3/agent wallets, exact wei and EntryPoint deposit, token counts, jobs/automation/unsettled/legacy state, owner identity, token existence, snapshot freshness and block identity. It is an **advisory preflight**, not an asset attestation or signing authority. `canBurn` is unconditionally false in this build.

`burn-warning-view.mjs` is an unmounted standalone component. It shows exact balances (never rounds dust to zero), per-wallet review/withdraw buttons, blockers and irreversible-loss warning. No provider/signing callback, no checkbox override. It is not deployed or wired into the public Control Center yet.

Required future local UX: select burn/target Punks; display all asset/state evidence; review/withdraw safely; recheck; show irreversible loss and no asset migration; require exact `BURN <id>` text only after safety eligibility; sign narrowly scoped transaction; finalize credit only after receipt/reorg policy. Never mint credits from a chat message, optimistic UI event, or transaction submission alone.

## Production implementation gap (updated September 11)

The latest owner direction accepts an owner-approved literal burn after wallet review,
as recorded in [the current decision](V2_FORGE_SACRIFICE_DECISION.md). It supersedes
the earlier requirement to keep burns disabled while designing post-burn recovery.
There is still no proof that every possible asset is absent, and the UI must explain
loss of access to remaining or later-deposited assets. The real burn source and
transaction integration remain unfinished; local mock credits are not production
implementation evidence. No actual burn is authorized by this design discussion.
