# Gogh Punks live test guide — September 16 release

**Core broker release published September 12 at 3:43 PM America/Detroit.** Open
[the live broker](https://goghpunks.xyz/broker/v2/?tab=talk). The core release commit is
`78c01ca6a2bc7c8e86994333bfaf9ca69a18a584` (PR #47); Netlify deployment
`6aa5aade39f94100087a8215`. Burn-to-training is not yet enabled. Run the core broker
checks first, then complete the required burn-to-training cases after its live
enablement. Missing burn-to-training is an open launch failure, not a deferred pass.
Run optional purchase/offer cases only when explicitly released.

The release passed 1,789 JavaScript tests, 267 contract tests, 127 deployment
checks, and the native PostgreSQL recovery suite (66 assertions). The actual
deployed Forge contracts also passed a disposable fork simulation for
**#1753 → #93**: approve, burn, award one credit, learn, equip and unequip.
Those fork transactions did not change the public NFTs.

Live checks passed on the production host at 1440px and 375px: disconnected load,
tab selection, no horizontal overflow, no browser errors, no failed site resources,
and no wallet or mutation requests. Served HTML and JavaScript matched the reviewed
build. Netlify's hosted checks also passed real contract inspection, a three-token
rarity sample and five live market listings using its injected credentials.
Private Forge profiles require sign-in, and unreleased training returns
`FORGE_TRAINING_NOT_RELEASED`. These checks do not replace the connected wallet,
actual mint, training, and recovery cases below. The two training-intent migrations
are applied; restricted request/worker credentials and burn integration remain
release requirements.

The finalized Forge follow-up connects the verified registry, progression and
burn-source addresses for read-only profiles. The owner console read #93 at block
`61369169`: zero credits, one unlocked slot, and no learned or equipped skills.
Registry acceptance and two-provider finalized deployment verification are complete.
Use the latest published version recorded with your test run; the core release
reference above remains the starting version for the broker corrections.

The September 12 recall correction recognizes `ok recall please` and the Pause
quick call's `Pause for tonight.` It refreshes authenticated mission state before
choosing session revocation or strategy pause, and confirms the revocation receipt
before announcing success. Connected local-browser tests cover both phrases,
stale cached status, duplicate clicks, wallet rejection and failed receipt/status
reads. These use a simulated wallet and send no public transactions.
General AI conversation remains blocked by a missing production `GEMINI_API_KEY`
(Functions scope); the model setting alone does not configure a credential.
Recall, status and gas quick calls do not require a model provider.

The owner-confirmed Wednesday target is chat, gas funding, missions/minting,
Forge research/loadouts and burn-to-training. Paid minting, floor purchases and collection offers
have separate implementation and acceptance work.

## Your test setup

For the current contract setup stage, use [the live owner-wallet steps](V2_FORGE_OWNER_WALLET_TEST.md)
at http://127.0.0.1:64345/. That page sends real deployment/registry-acceptance
transactions through your wallet. The full release tests below still require
the production integrations and explicit capability enablement.

| Item | Record before testing |
| --- | --- |
| Live URL | https://goghpunks.xyz/broker/v2/?tab=talk; no `preview=1` |
| Release | `78c01ca6a2bc7c8e86994333bfaf9ca69a18a584`, September 12, 3:43 PM America/Detroit |
| Enabled features | Exact list from the release note; mark the others NOT RELEASED |
| Network | Robinhood Chain, chain ID 4663 |
| Devices | Your normal desktop browser/wallet and your phone/wallet browser |
| Owner wallet | Address only |
| Selected Punk | Token ID, Punk Wallet address and separate Agent Account address |
| Mint target | One currently open, supported collection you choose; record its contract |
| Test limits | Quantity 1; your chosen gas cap, reserve, expiry and funding amount |

Choose the amounts yourself and check them in each review. A free NFT can still
cost network gas. The localhost #44 practice links are separate chains and do not
count as production acceptance. Keep transaction links with your results.

## 1. Open, connect and select a Punk

1. Open the live page while disconnected. It should load without freezing or
   requesting a transaction. The page should identify the selected network.
2. Connect the owner wallet and select one Punk you currently own. Confirm its
   image, number and wallet addresses. Switch to another owned Punk and back.
3. Use **CHECK AUTONOMOUS READINESS** and sign in if requested. Sign-in should name
   the correct site. It should not fund gas, create a mission or mint an NFT.
4. Reload, reconnect, then test the same sequence on your phone. Controls and
   reviews must fit the screen; the selected Punk must remain clear.

**Pass:** correct current ownership, usable desktop/mobile controls, no surprise
transaction, and clear sign-in/network errors when a prerequisite is missing.

## 2. Talk, modes and saved mission review

Start in **ASK**, then try **ASSIST**. Use this template, filling every placeholder:

> Mint one free NFT only from <collection contract>. Use Assist mode. Maximum one
> mint per day and one mint total. Maximum gas per mint <your cap> ETH; keep
> <your reserve> ETH in reserve. End the mission at <your expiry>. Show me the plan.

1. Check the exact collection, quantity, mode, daily/mission limits, gas cap,
   reserve and expiry in the review. Changing a mode selector alone should not
   activate a mission.
2. Cancel once. Nothing should be signed or sent; the useful draft should remain
   available for review.
3. Ask to change one limit. The unchanged limits and collection must stay intact.
4. Reload and use **REVIEW SAVED MISSION** when offered. It should restore the
   same plan for the same Punk, rather than start a second mission.

**Pass:** chat becomes an accurate review; plain chat and canceled reviews do not
execute transactions. If a target cannot be resolved, the broker asks for its
contract or reports the issue; it must not choose another collection.

## 3. Fund Agent gas from both sources

Use **FUND AGENT GAS** or **Fund gas here**. Test each source once with an amount
you choose. Record the balances and transaction link for each test.

| Source | What to do | Expected result |
| --- | --- | --- |
| Punk Wallet | Select **USE PUNK WALLET ETH**, enter your amount, then **REVIEW & SIMULATE**. Cancel once; then review again and confirm in your wallet. | The exact approved amount moves from the selected Punk Wallet to its Agent Account. Its protected reserve remains. Canceling moves nothing. |
| Connected wallet | Select **ADD ETH FROM MY WALLET** and review your amount. Confirm only when the source and Agent destination are correct. | The approved amount comes from your connected wallet. The Punk Wallet is not charged for the transfer amount. |

The connected wallet may also pay network gas for owner transactions; account for
that when comparing its before/after balance. Check Agent native ETH and EntryPoint
gas deposit separately. Funding does not itself authorize a mint mission.

After each funding receipt, return to **REVIEW SAVED MISSION** and confirm the
original target, limits and reserve are still present.

## 4. Approve and observe one autonomous mint

1. Recheck readiness. Any missing gas, account setup, authorization or service must
   have a specific explanation. A connected wallet alone is not readiness.
2. Review the account/session setup and the one-mint mission. Cancel the wallet
   prompt once and verify the UI does not claim activation. Then review again and
   approve the exact mission you intend to run.
3. In **ACTIVITY**, watch the actual last-check time, scan results and candidate
   rejection reasons. A rejected or sold-out collection must not count as a mint.
4. Wait for a receipt. A queued task, simulation or submitted hash is not success.
   If there is a pending transaction, recheck its receipt instead of starting
   another transaction.
5. Follow the mint transaction link. Verify success, the exact collection/token,
   and NFT ownership by the reviewed receiving account. Confirm the Collection
   tab and mission progress agree: one confirmed mint and mission completed.
6. Reload and wait through another check. It must not mint a second NFT under the
   completed one-mint mission.

**Pass:** one canonical successful mint, one counted mint, the right NFT owner,
visible activity and no duplicate. A sold-out target is a successful rejection
test, but it does not complete this mint-success case. Choose an open target for
the success case.

Production has scheduled worker checks. The PR preview's **RUN ONE MISSION CHECK**
is a separate preview control: each click can execute within an already approved
mission. A working preview button does not demonstrate unattended production work.

## 5. Stop a mission and check session accounting

1. With a separately reviewed active mission, send `ok recall please` or click
   **Pause** and send `Pause for tonight.` Reject the wallet request once: chat
   must say recall is unconfirmed. Retry and confirm the exact Agent Account's
   session revocation. Verify its receipt and inactive session. A temporary RPC
   failure must not announce success or silently pause only the strategy.
2. Wait through a worker check. It must not initiate a new mint for that revoked
   session. An already-submitted transaction still needs receipt reconciliation.
3. If you choose to run another one-mint mission, check that its session count
   starts correctly. Older sessions must not incorrectly consume its total limit.
   Daily and duplicate-collection protections should still apply across sessions.

Record the old and new session identities and transaction links. This is the live
acceptance case for the Punk #93 session-count correction; prior old-version mints
are not evidence that the released correction works.
“For tonight” does not schedule an automatic restart. A new mission requires a
new owner authorization. Keep the submitted hash if receipt confirmation fails.

## 6. Collection, missing artwork and NFT withdrawal

1. Open **COLLECTION** and find the newly acquired NFT. Confirm its exact collection,
   token ID and custody account. Refresh once.
2. If artwork/indexing is missing, use **VERIFY & ADD** with the NFT's exact item
   link. An unowned item or wrong-chain item must not appear as owned.
3. Choose an NFT you intend to withdraw. Verify the source account, NFT identity,
   quantity and fixed current-owner destination. Cancel the first review.
4. Review again, confirm in your wallet, and follow **VIEW WITHDRAWAL TRANSACTION**.
   The NFT should end up at the reviewed owner destination and leave that account's
   holdings after confirmation.

**Pass:** custody is accurate before/after withdrawal; missing metadata does not
invent ownership; no transfer occurs on preview or cancellation. Verify support
for the actual account holding the NFT, since Punk Wallet and Agent Account custody
are different. Report an unavailable recovery route as a failure for that custody
path instead of treating it as a completed withdrawal.

## 7. ETH, WETH and token recovery

1. Under **FUND**, review a small owner-chosen amount for **WRAP ETH INTO WETH**.
   Check the selected Punk, direction, amount and WETH contract; cancel once.
2. Confirm the intended wrap. Check the receipt and both balances. Repeat for
   **UNWRAP WETH INTO ETH** if that action is enabled for the account.
3. Follow **MANAGE ETH · WETH · TOKENS** to review the enabled recovery actions.
   For any transfer you choose to complete, verify amount, token and destination
   in the owner review and check the final receipt/balance.

Wrapping WETH does not publish an offer or grant trading permission. An unavailable
asset/account recovery route must be recorded explicitly.

## 8. Forge research and original-Punk loadouts

1. Open **FORGE** on an owned Punk. Check the slots, credits, learned skills and
   equipped skills against the accepted on-chain state. An unknown profile must
   say unknown/unavailable; it must not display an invented empty loadout.
2. Run each research tool listed as enabled: contract inspection, the supported
   rarity sample and market research. Check the target, observed data/time and any
   sample or provider limitations. Research should not request asset spending.
3. If the release offers equipped-skill research, test an equipped skill and an
   unequipped skill. Learning alone must not enable an equipped-only tool. A
   diagnostics/research-lab result must not appear as permanent training.
4. Switch Punks and reload. Results, loadout and pending reviews must belong to the
   current selection. A provider failure must not leave an old success looking fresh.

**Pass:** real backing state and correctly scoped research. A mocked local profile,
placeholder or gated unavailable feature does not count as live loadout acceptance.

## 9. Ownership transfer and privacy

Run this only with a Punk you have deliberately chosen to transfer, after reviewing
its assets and active sessions. You do not need to transfer a valuable Punk merely
to test the interface.

1. Stop/revoke its economic sessions and decide which assets should remain under
   the Punk's control. Withdraw assets you do not intend the recipient to control.
2. Transfer the original Punk to the intended other wallet through an owner-reviewed
   NFT transfer. Verify the transaction.
3. In the old browser, refresh and try an old unsigned review. The old owner must
   lose control; private chat and stale reviews must clear.
4. In the receiving wallet, refresh. The original Punk's on-chain skills/slots/
   loadout should follow it, while the old owner's private chat and prior economic
   authorization should not become the buyer's permissions.

**Pass:** the right owner controls the right accounts and loadout, with no stale
seller authority or private data. Record exactly which wallet generations and
mission types were exercised.

## 10. Burn-to-training — required launch acceptance

The first owner-selected pair is **burn #1753 → credit #93**. Both owners were
verified on September 12; #93's initial Forge balance was zero credits. The live
setup page offers **Check selected Punks live** to refresh the pair and its wallet
balances. The expected burn result is **#93: 0 → 1 credit**, followed by a separate
reviewed learning or slot transaction. Selection and preflight do not enable a
burn. Keep #93's existing assets and Agent session accounted for throughout testing.

Do not run a real burn merely because this guide exists. This case starts only
after the release explicitly enables the reviewed burn source and you personally
choose the actual source and recipient Punks. The local Test #7/#44 IDs are not
instructions to burn those real collection tokens.

1. Record the source Punk to burn, a different owned recipient, the intended
   skill/slot result and cost, and the current collection supply.
2. Review the source's V1/V2/V3 Punk Wallets and Agent Account, including undeployed
   deterministic addresses: native ETH, WETH/ERC20s, NFTs, EntryPoint deposits,
   pending transactions, missions, offers and legacy obligations. Stop/revoke
   sessions, withdraw known assets and refresh the review. Unknown holdings must
   remain visible; zero ETH does not prove an empty wallet.
3. Verify both Punks' IDs and images, the resulting credit/skill/slot plan, and the
   wallet-access warning. Burned NFT ownership disappears; account addresses persist,
   and remaining or future assets can become inaccessible. Assets do not migrate.
4. If requested, approve only that source NFT for the exact released burn-source
   contract. Verify the approval receipt. Approval alone must not burn or award
   credits. An NFT approval has no on-chain expiry; revoke it if you abandon the burn.
5. Open the separate burn review. Cancel it once. Nothing should burn and no credit
   should appear. Start a fresh review, type the exact required `BURN <source ID>`
   and acknowledge the loss only if you still intend to destroy that NFT.
6. Approve the exact zero-value burn transaction in your wallet. Check its final
   receipt: the source is burned, the recipient still exists, supply falls by one
   without crossing 1,111, and exactly one credit is awarded to that recipient.
7. Refresh/recheck the same receipt. It must not resend or award another credit.
   A pending or failed transaction must not show successful training.
8. Review the separate learning or slot action. Learning should spend the displayed
   credit and add the reviewed skill; a slot purchase should add a slot without
   claiming a learned skill. Equip a learned skill separately, use its permitted
   tool, then unequip and confirm the learned history remains.

The public collection can permit direct burns outside the Forge. Those direct
burns do not automatically become Forge credits or prove the Forge's floor check.

## 11. Directed purchases and offers — match the release's enabled features

| Case | Expected behavior while unavailable | Success test after separately enabled |
| --- | --- | --- |
| Directed paid mint | Clear unavailable/unsupported result; no unrelated free-mint mission | Exact selected collection, payment, quantity, gas/reserve and canonical mint receipt |
| Floor purchase/sweep | No silent replacement with a free mint | Exact listings and quantities, total including fees, expiry, recipient and bounded partial-fill behavior |
| WETH collection offer | No order or broad approval merely from chat or wrapping | Exact collection, per-item/total commitment, quantity, expiry, finite allowance, publication, cancellation and fill receipts |

Use collections and amounts you choose. An offer being posted is not a purchase;
only a confirmed fill creates an acquired NFT. A missing feature should be marked
NOT RELEASED, not PASS.

## 12. Recovery and repeat checks

Repeat the relevant cases on desktop and phone:

| Trigger | Expected result |
| --- | --- |
| Reject a wallet prompt | Clear rejection; no claim of success or automatic repeat |
| Wrong account/network | Review blocked until the correct context is restored |
| Insufficient gas or protected reserve | Clear explanation; saved mission retained; no unauthorized transfer |
| Sold-out target or changed quote | Review fails or refreshes explicitly; no substitute acquisition |
| Reload after submission | Same transaction recovered; no duplicate send |
| Service outage | Clear unavailable/pending state; previously verified history remains distinguishable |
| Change Punk with a review open | Prior review closes or becomes invalid; no cross-Punk action |
| Paused/revoked session | No new autonomous submission; existing pending receipt still reconciles |

## Record and report results

Use PASS, FAIL, BLOCKED or NOT RELEASED for every applicable case. For a failure,
record: test number, release version, device/browser, Punk ID, expected result,
actual message, time and transaction link (if one exists). A screenshot helps;
never include private keys or seed phrases.

If ownership, destination, amount or duplicate-execution behavior is wrong, stop
new actions in that flow and retain the existing transaction hash for investigation.
The release owner handles pausing affected work and rollback. A page rollback does
not reverse an already confirmed transaction.

Core launch acceptance is complete only when the released site and worker have
passed the live checks, including an actual bounded mint and verified loadout
backing state. Automated/local tests are supporting evidence, not a replacement.
