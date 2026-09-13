# Art Broker V2 holder testing guide

Open **[Gogh Punks Art Broker V2](https://goghpunks.xyz/broker/v2/)**. Start with **Punk #93** on Robinhood Chain. You can connect, explore, talk and review your collecting rules without funding anything.

This guide is dated September 13, 2026. The artwork and Collection repair is already live. The final hardening build is live as release `61cb6a9`: provider choices, funding recovery, supported contract inspection and mobile refinements are published. Refresh an already-open tab. [Release verification](release-acceptance.json). **The preview is not a practice chain.** Use the separate disposable environment supplied for transaction practice.

## What is already confirmed

- #93 completed its first paid mint and received **Peppies World #1599** in its Agent wallet. The live Collection check found it among 34 verified holdings. [View the recorded delivery evidence](../v2-swarm/paid-mint-delivery-1599.json).
- Original **#1753 has not been burned** by this hardening work. The controlled test used copies of #1753, #93 and #94.
- The earlier unused paid-mint refund was **not withdrawn**. The last recorded amount was **0.000183954 ETH**; a fresh reviewed balance would be needed before any later withdrawal.
- The controlled Forge test completed burn → one credit → learn Rarity Eye → equip → use → unequip, plus an extra copied burn to unlock a slot. Skills, slots and holdings stayed with the copied Punk after transfer.
- Gemini, GPT, Claude and Grok passed real conversation and structured-response checks. All four also passed on the published production runtime. **Bankr is unavailable until a reviewed credential is configured.**

## 1. Connect and choose your Punk

1. Open the production broker and connect the owner wallet ending **7AA6**. Sign in if asked. A sign-in message is different from a purchase or transfer transaction.
2. Select **#93**. Check the large artwork and Punk number before each action.
3. Browse the other Punks you own. Artwork may fill in progressively; each number should stay visible and the selected card should be clear. Use arrow keys on desktop or swipe the roster on a phone.
4. Switch to another Punk and back. The wallet, collecting rules and activity should follow the selected Punk. Late results from the previous Punk should not replace the current view.
5. Open Fund, Collection, Activity and Forge. A new or empty Punk should explain what is missing and offer a useful next step; exploration should never require a deposit.

If the page has been open since before the display repair, save any unsent message and refresh once. A picture still loading does not mean you lost the NFT. A failed ownership check should offer a retry, rather than invent an empty roster.

## 2. Find #93's minted NFT

Open **[Collection](https://goghpunks.xyz/broker/v2/?tab=collection)** with #93 selected and refresh the collection.

Look for **Peppies World #1599**. Its collection is `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`; its recorded destination is #93's Agent wallet, `0xcadcfd37e715bc031cf0cec7fa2335091c878c83`. Its current dark animated pre-reveal artwork is valid artwork, not automatically a load failure.

Check the custody label on each item. The Punk Wallet and Agent wallet are separate places. **Acquisition history** records what was acquired previously; **Collection** verifies currently held NFTs. A missing picture or unavailable source must be explained separately from ownership.

If the collection cannot load, use its refresh action. Do not repeat the mint to repair the gallery. If #1599 is still absent, report #93, the Collection message and the approximate time.

## 3. Talk naturally and review your rules

Open **[Talk](https://goghpunks.xyz/broker/v2/?tab=talk)**. Expand **Example prompts**, choose an example and edit the filled message before sending. Start with these read-only messages:

| Try this | Expected result |
|---|---|
| `Check my status` | Current Punk/mission state; an existing budget or session must not be mistaken for a completed mint. |
| `What do you think about pixel art, and how does it fit my collecting strategy?` | A conversation using the selected Punk's context; no purchase or mission change. |
| `Show my collection` | Opens Collection when chosen through its example action. |
| `Show my activity` | Opens Activity with checks and confirmed results. |
| `Show my strategy` | Shows your current collecting rules. |
| `Recommend only. Find free pixel art with a website or social profile. Maximum one mint per day and one mint total.` | A recommendation-only strategy draft for review. |
| `Prioritize pixel art and weird experimental art. Avoid PFPs.` | An editable taste draft retaining existing limits and collection restrictions. |
| `Maximum one mint per day and one mint total. Max 0.0005 ETH gas per mint. Show me the updated rules.` | A review showing exact limits; sending the message alone does not activate it. |

For this hardening check, inspect the draft and choose **Edit**. Save/activate strategy changes only in the supplied disposable practice or a separately agreed owner test. Confirm the mode, collection restrictions, maximum mint price, gas, reserve and expiry before any activation. A tiny nonzero amount must never display as zero or “not changed.”

**ASK** recommends. **ASSIST** prepares an eligible action for your review. **AUTONOMOUS** needs an explicit bounded authorization before the existing worker can act. This phase does not activate broad autonomous missions.

In the hardening build, choose a model in Settings, send a normal question, reload and check the preference remains yours. **Auto** may use an available fallback. Choosing a specific model should keep that choice or explain its unavailability; it must not silently switch. No model gains access to unrestricted wallet signing. A failed reply should preserve your message for retry.

## 4. Check a link

Choose **Inspect a collection or mint link** in Example prompts, open the link checker and paste a supported Robinhood collection, mint or explorer URL.

Watch for clear progress and then check the identified collection, chain, mint price, availability and any screening/simulation result. **Needs review**, **unsupported** and **unavailable** are valid results; none means a simulation passed. Robinhood explorer contract links now return anchored contract evidence and, for supported SeaDrop contracts, observed public mint details. Generic sites remain unresolved; this inspection does not run a fresh wallet simulation.

The checker must never ask you to accept a wallet transaction copied from a website. An unknown or ambiguous collection needs further identification. Do not paste a real paid mint and expect it to become a free-mint mission.

## 5. Inspect funds and recovery without sending

Open **[Fund](https://goghpunks.xyz/broker/v2/?tab=fund)**. Check total ETH, reserved ETH, available art budget and WETH. The separate Agent ETH and gas deposit must keep their own labels. A temporarily failed balance should say unavailable and offer a recheck, rather than remain “checking” forever.

For a review-only check, choose a small amount and inspect the source, destination, fee and resulting balance. Close the review before wallet confirmation. Funding from your connected wallet should not require activating an unrelated Punk Wallet. Funding from the Punk Wallet must preserve its protected reserve.

If a previous funding request has an uncertain result, use **Recheck funding** or paste the **original transaction hash** from wallet activity into its recovery field. Rechecking must not send it again. Keep the same browser's saved recovery records while a request is unresolved.

From Collection, selecting **Withdraw NFT** should open a review with the exact NFT and custody account. The current owner is the destination. Supported Agent recovery covers ETH, its gas deposit and standard NFTs, including single and multi-edition tokens; arbitrary other token withdrawals are not exposed. V3 Punk Wallet recovery remains separate. Finish an actual withdrawal only in the disposable practice environment or a separately agreed owner test.

After a practice withdrawal is confirmed, refresh Collection and balances. A confirmed transfer receipt and current custody are separate checks. Do not clear a pending record or submit a replacement merely because a service read failed.

## 6. Understand paid-mint status

#93's existing **#1599 mint is completed**. Use Talk's **Recheck paid mint**, Activity and Collection to inspect that result; there is no reason to buy a replacement because an old screen was stale.

The supported paid flow is currently the selected #93 / Peppies World test, not every paid collection. Its example is:

> Mint one NFT from Peppies World for up to 0.0001 ETH.

For the next separately agreed paid test, one wallet confirmation approves the exact mint price and fixed worker fee. That budget confirmation lets the worker attempt the reviewed mint; it is not itself proof of delivery. Follow the states from **budget confirmed** to **submitted** to **verified delivery**. A second purchase confirmation should not be needed for that same approved job.

If a job expires, cancellation and withdrawal of unused funds are separate reviewed transactions. This guide does not authorize either for the existing refund. Historical ownership checks must be available before a new budget is offered; a failed recheck should retain the original transaction and must not create a duplicate mint.

## 7. Practice the Skill Forge on the disposable chain

Use only the dedicated practice environment supplied for this test. It must clearly identify the disposable chain. The production Forge URL and a deploy preview can still point at real assets.

1. Select the copied Punk to train, then a different copied Punk to sacrifice.
2. Run the asset and mission checks. Any ETH, gas deposit, NFT, other token or unresolved job must block sacrifice unless an explicitly reviewed recovery rule applies. An unknown inventory is not an empty inventory.
3. Read the warning naming both Punks. The source is permanently destroyed on that test chain; its wallet assets do not move to the recipient. Confirm the exact displayed Punk number only in this disposable environment.
4. Complete the test approval and burn as presented. Approval alone does not burn or earn a credit. Verify the recipient gains **exactly one Training Credit**, supply decreases once and a refresh never repeats the burn.
5. Learn **Rarity Eye**. One credit is spent on learning. The skill should appear as learned, then become usable after you equip it in an available slot.
6. Compare a small named sample of Punks. Rarity Eye compares traits within that sample; it does not promise whole-collection rarity or profitable purchases. Unequip it and verify its action becomes unavailable; equip it again and repeat.
7. To test a paid slot unlock after spending the learning credit, use a second eligible disposable source to earn another credit. Unlock one slot and verify both credit and slot counts. One credit does not pay for learning and unlocking simultaneously.
8. Reload during an unresolved practice transaction. Recover the original hash and verify one result, not a second send. An expired unsent review needs a fresh review.
9. Transfer the trained test Punk to the second supplied test wallet. Skills, slots, loadout, wallet addresses and holdings stay with the Punk. The previous owner must lose control; the new owner needs a fresh review and automation must stay paused.

The current composed test passed this sequence using copied #1753 → #93, then copied #94 for the extra slot credit. It also proved the owner's existing wallet delegation can complete the reviewed training flow; no new wallet module or ownership rule was installed. **Original #1753 remains intact.** Mocked asset clearance in that test is not clearance to burn the real NFT.

## 8. Which skills and missions can be tested now?

| Feature | Current honest scope |
|---|---|
| Rarity Eye | Registered v1; full learn/equip/research/transfer sequence passed on the disposable deployed-stack copy. Real #93 has no recorded public learned/equipped completion from this phase. |
| Contract Detective | Existing read-only research lab/package; laboratory availability is not permanent skill acceptance or purchase permission. |
| Market Scout | Read-only research exists. New exact-price v2 passed real bounded listing reads but remains TESTING, and is available in the controlled lab; separate package/runtime/registry review is required before promotion. A listing sample is not a guaranteed floor quote. |
| Chat playbook skills | Reviewable scouting routines; they do not spend permanent credits or authorize purchases. |
| Mint Hunter, Link Sniper and other roadmap skills | Existing related tools do not mean all named Forge packages are accepted, learnable and equipped. Follow the actual released/available label. |
| Free missions | Existing bounded supported-mint lane; review-only prompts and disposable tests are appropriate here. No eligible current mint is a valid outcome. A new broad autonomous mission is outside this phase. |
| Floor sweeps and WETH bids | **Not live.** Wrapping ETH into WETH does not create a bid. Example requests must explain the limitation and leave existing missions unchanged. |

To recall an existing supported free-mint Agent session, the exact example remains **`ok recall please`**. Recall can require a wallet revocation transaction; use it when deliberately recalling that session, not as a read-only status test. A funded paid mint uses its own cancellation control.

## 9. Phone, slow-network and error checks

On a small phone, verify the roster swipes, text remains readable, the Talk composer is easy to reach, buttons are large enough and no page scrolls sideways. Check the real wallet handoff and keyboard on the device; desktop phone-size screenshots cannot prove those interactions.

Try a slow or unavailable read in the supplied practice environment. Useful content should remain visible, unknown balances should stay unknown, and retry should preserve typed messages or recovery hashes. Change Punk while a response is pending and check that the old result is ignored. Empty Collection and Activity should explain what to do next.

For any failure, report **Punk number, page/action, displayed message, approximate time and transaction hash if one exists**. Include whether you were on production, preview or the disposable chain. Never send a private key, recovery phrase, provider credential or raw signed transaction. A screenshot plus the public hash is enough to start investigating; a hash by itself does not establish success.
