# Gogh Punks Art Broker V2 — community announcement brief

September 23, 2026 brief; Swarm Wallet and funding-first instructions updated September 24. Released-feature baseline for the existing features below: production commit `7811eff1ddb343670b3ef19c547d762d75e8c511`. The dedicated Swarm Wallet website was deployed September 24; its production smoke verification and the separate funding-first patch are tracked below. This is a feature brief, not a claim that every holder has live-tested every path.

## Instructions to ChatGPT

Create a Discord announcement thread and an X post/short thread from this brief. Use an energetic, art-focused voice and plain English. Separate LIVE, LIMITED RELEASE and IN DEVELOPMENT. Do not promise profits, guaranteed mints, unlimited autonomy, gas-free minting, a professional audit, or unavailable skills. Do not invent release dates, rewards or integrations.

## The idea

**THE PUNK IS THE AGENT. YOUR PUNK. YOUR RULES.**

Gogh Punks V2 gives your Punk a configurable art-collecting experience on Robinhood Chain. Connect, choose your Punk, fund its account, define its tastes and limits and authorize supported collecting actions. Its identity, wallets, collection and activity come together in one Control Center.

V2 uses explicit options and deterministic rules. **AI inference is disabled. No AI credits are needed to use these controls.** Chosen mint prices and blockchain network fees still apply.

Website: https://goghpunks.xyz/

Direct route: https://goghpunks.xyz/broker/v2/

Holder guide: https://goghpunks.xyz/guide/

## Released holder features

### Your Punk Control Center

- Connect your holder wallet and see your owned Punks.
- Switch Punks through an arcade-inspired character selector.
- Open Actions, Strategy, Fund, Collection, Activity, Skills/Forge and Settings.
- Follow setup guidance and see account, funding and mission status.
- Use desktop or mobile layouts without terminal commands.

### Set the rules

- Configure supported missions with on-screen options instead of paid AI chat.
- Set art preferences, supported collection targets, daily and total mint limits, a gas cap and a protected reserve.
- Review complete rules before authorization.
- ASK supports review; ASSIST prepares supported owner-approved actions.
- Autonomous free-mint missions require separate, bounded wallet permission. Saving a strategy or funding an account alone does not activate a mission.

### Free-mint hunting

- Authorize a funded Punk to look for supported free-mint opportunities within your confirmed rules.
- Shared discovery serves multiple Punks; each Punk does not need a dedicated AI process.
- Ownership, approved adapters, budgets, reserve and required safety checks constrain execution.
- Once properly configured, funded and authorized, the owner does not need to keep the browser open.
- “Free mint” means zero mint price. Gas is still spent; finding or successfully minting an NFT is not guaranteed.

### Keep Hunting

- The longer-running option allows **up to 100 mints or 30 days**, whichever comes first.
- Daily limits, reserve, gas availability and safety checks can stop spending sooner.
- Permission needs renewal after its limit or expiry. Do not call this unlimited or perpetual authority.

### Swarm — multiple Punks, one planner

- Select **up to 10 owned Punks**.
- Plan supported free-mint searches or a directed free-mint collection.
- See per-Punk limits and the combined maximum before proceeding.
- Each Punk retains separate wallets, reserve, gas limits, preferences and authorization.
- Review the batch, then review and authorize each Punk separately.
- The current optional funding planner splits a total gas budget into exact allocations; **each current deposit has its own wallet confirmation**.
- Recent fixes preserve selections across passive refreshes and show a local review before the explicit “Sign in & load full rules” step. Mission authorization follows separately.

### Direct a mint

- Direct supported free-mint missions to a chosen collection.
- A separate public direct-paid flow supports **one NFT from an eligible open Robinhood Chain SeaDrop Studio mint**.
- Current direct-paid mint-price limit: **0.001 ETH per NFT**, plus gas.
- The connected holder wallet pays; the NFT goes directly to the chosen Punk’s Agent Account.
- Each paid mint has a separate review, simulation and wallet confirmation. This direct flow has no worker fee or continuing paid-spending permission.
- It does not support arbitrary mint websites, every contract or unattended paid-shopping missions.

### Wallets, funding, collection and withdrawals

- View verified balances, reserve and available budget.
- The ordinary Punk Wallet and autonomous Agent Account are separate addresses; funding screens identify the destination.
- Add Agent gas from the connected wallet or move existing Punk Wallet ETH where supported, through an owner-reviewed transaction.
- An existing Agent Account can receive gas without recalling its mission. If its minting permission remains active, adding gas can allow collecting to resume within those approved rules.
- View discovered NFTs and verify a missing item using its exact OpenSea link.
- Review ETH, NFT and supported standard-token withdrawals to the connected current owner.
- Retain recovery access to older wallet versions.
- WETH wrapping is distinct from bidding and does not place an offer.
- Recover pending or unknown results using the original transaction, rather than blindly submitting again.

### Mission status, Recall and badges

- Status distinguishes setup needed, activation needed, missing gas, permission needed, hunting, reserve reached and attention states.
- “Looking for mints” requires recent worker evidence; a saved strategy alone is insufficient.
- **Recall Punk** is visible beside mission status, including at Reserve reached.
- Recall revokes permission and pauses the strategy after confirmation. Funds remain in the Punk’s wallets; withdrawals are separate.
- Already-submitted transactions still need receipt reconciliation.
- Roster/Activity badges highlight completed, failed, expired and attention-needed missions. These are browser-local in-app updates, not email or mobile push notifications.

### Ownership and progression

- Current NFT ownership controls supported Punk wallet actions.
- Punk-specific progression and wallet identity belong with the token, rather than the former holder’s login.
- A buyer does not inherit the previous owner’s active economic authorization; the current holder must authorize it.
- Assets deposited into a Punk account follow that Punk’s ownership model. They are different from unused funds retained in a personal wallet.

## Limited release — do not announce as generally open

### Forge and paid training

The Forge has progression, learned/equipped skills and slot controls, gated by released contracts, functioning tools and holder eligibility.

- The paid Training Credit route costs **0.0005 ETH per credit, plus gas**.
- The website currently limits it to an **approved-owner test**, not a public sale to all holders.
- The currently released paid-training skill is **Rarity Eye**, for comparing a chosen trait sample.
- Credit purchase, setup, learning and equipping are separate owner-confirmed steps.
- Purchased credits stay with the selected Punk and are nonrefundable.
- A catalog card alone does not mean a skill is live or purchasable.

### Burn for Training Credit

**General holder burning is unavailable.** Full asset/obligation verification and protection against stranding assets remain release requirements. Existing selected-test receipts and recovery do not enable arbitrary Punk sacrifices.

## Website deployed; production smoke verification pending — dedicated owner-controlled Swarm Wallet

**Implemented and locally tested/reviewed. Factory deployment is confirmed by two providers. The website release was published at 12:29:03 UTC on September 24 as Netlify deployment `6ab517294fb0da0008fcae65`; production smoke verification was still pending when this brief was updated. Do not call the holder flow LIVE-TESTED from deployment alone.**

Factory: `0xab82241505a64edfbb3031542e137fadf5567dba`. Confirmed transaction: `0x736cba695d35137e60d1f2f89b663e512fc280194bebcb03214f26207aeb6a1c`. The project factory deployment does not create or fund a holder's individual Swarm Wallet.

The optional holder route is below. Step 4's separate creation-only control and the clearer funding-first sequence are part of the next patch described below, not a claim that this new patch is deployed:

1. Connect the holder wallet on Robinhood Chain and open **Swarm Wallet**, above the selected Punk controls. This owner-controlled wallet remains separate from the per-Punk mission planner, including when no Punks are owned.
2. Choose **Check Swarm Wallet**. Review and confirm creation of that holder's dedicated wallet once.
3. Deposit an ETH budget from the connected wallet, after reviewing its destination and amount.
4. For each currently owned Punk to be funded, open its **Fund** screen. If needed, review and confirm creation of its Agent wallet only. Creating a wallet does not grant minting permission. Return to Swarm Wallet before starting any new mission.
5. Select **1–10 Punks** and enter a total ETH amount. The review lists them in Punk-number order, splits the total equally and assigns any smallest-unit remainder to lower Punk numbers. Maximum **1 ETH per Punk / 10 ETH per batch**.
6. Choose **Review gas batch**, inspect every allocation, total and fee, then **Confirm in wallet**. Each batch needs its own approval; the selected transfers succeed together or none do.
7. After funding, use **Actions → Swarm · multiple Punks**, set the rules and choose **Start mission** for each Punk separately. Review and confirm each mission's permission. Funding does not activate a new mission or grant minting permission.
8. To recover unused ETH, choose **Review withdrawal** and confirm. Only the owner can withdraw, and the destination is that owner's wallet.

The connected holder wallet pays transaction gas for creation, deposits, batches and withdrawals; keep some ETH there even when the Swarm Wallet is funded. Allocated ETH stays in the Punk's Agent Account and follows its ownership if transferred. Withdrawing from the Swarm Wallet recovers only unallocated ETH still there, not funds already sent to Punks.

An existing Punk does not need Recall just to receive more gas. If its mission permission is still active, funding can let it resume collecting within those rules. Recall is for stopping that permission, not a funding prerequisite.

There are **no automatic refills**, worker withdrawal authority, project custody or upgrade administrator. Pending or unknown results are recovered from the original, speed-up or cancellation transaction instead of blindly submitting again.

The existing individual funding planner remains available. Its per-Punk deposits each require separate wallet confirmation and do not spend the dedicated Swarm Wallet balance. Factory deployment, public release and successful holder testing are separate milestones.

## Next patch — fund before starting a new mission

**In development, not yet a released-feature claim.** Account creation and mission permission previously shared one setup flow, which could make a newly activated Punk start hunting before the holder had finished funding it. The new flow separates those actions:

1. Select a Punk and open **Fund**.
2. If its Agent wallet does not exist, review and confirm **wallet creation only**. No mission permission is granted and no hunt starts.
3. Add gas individually or through an approved Swarm Wallet batch. Check the reserve and keep separate ETH in the connected wallet for transaction fees.
4. Open **Actions**, choose the mission, taste and limits, then review the complete rules.
5. Choose **Start mission** and confirm the separate, bounded minting permission. Check Activity for the actual mission and worker status.

Each transaction requires its own review and wallet confirmation. Creating the wallet must not automatically request the next signature or start the worker. Existing funded Agent Accounts skip creation. Existing active permissions and supported individual funding remain intact; holders do not need to recall a Punk solely to add gas.

## Intentionally unavailable

- Public floor sweeps, automated marketplace purchases and WETH bids/offers.
- Broad unattended paid spending.
- General burning and public paid-credit sales to all holders.
- Automatic shared-wallet refills.
- AI chat/inference and Bankr.
- Unverified or planned skill capabilities.

## Costs and responsible wording

Exploration does not require funding. Login is a free signature, distinct from a transaction. Creation/activation, funding, minting, recalls and withdrawals can incur gas. No AI-credit requirement does not mean no fees. A review, simulation, funded budget or active mission does not prove NFT delivery; confirmed receipts and custody do. Safety checks reduce risk and cannot guarantee project safety.

## Suggested announcement focus

Lead with: **Gogh Punks now opens straight into your Art Broker Control Center.**

Highlight rule-based free-mint hunting, up to 10-Punk Swarm planning, bounded Keep Hunting, supported directed mints, guided setup/funding, clear mission status, Recall, owner-reviewed withdrawals and no AI credits required.

Call to action: **Open goghpunks.xyz → connect your holder wallet → select a Punk → check setup → review its rules.**

Keep Forge expansion, Swarm Wallet production verification and the funding-first patch accurately labeled until their respective release gates are verified. Do not promise a date or claim holder testing is complete based on a submitted deployment transaction.
