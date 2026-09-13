# Marketplace practice: purchases and WETH offers

Status: **ready for a holder rehearsal on an owned disposable chain**. This is a local practice surface, not production marketplace activation. It uses a copied Punk #93, copied funds, fixed practice NFTs, the copied Seaport deployment, and locally deployed candidate guard/escrow contracts. No wallet connection is needed.

## Try the running session

The final repaired session was verified at `http://127.0.0.1:50034` on September 13, 2026. It is available only on the machine running the launcher and lasts until that launcher closes. The separate Forge practice at port 62764 was left intact.

1. Open the practice page. Choose **Buy one NFT** or **Buy two together**.
2. Review the exact copied price, maximum network fee, NFT numbers, and expiry. Type **CONFIRM COPY**, then confirm practice.
3. Wait for **Purchase complete**. The result comes from the receipt and NFT ownership checks. **Recheck original result** never sends another purchase.
4. Choose **Bid on one NFT** or **Bid on the collection**, review, and confirm. The practice wraps exactly the copied funding into WETH for that offer.
5. Choose **Play seller · fill offer** to exercise actual fulfillment. The page checks the seller receipt, Seaport fill, escrow settlement, and the copied Punk's ownership of the delivered NFT.
6. Alternatively, choose **Review cancellation** and confirm. An unfilled offer returns its WETH to the copied funder. Repeating a cancellation or cancelling an already-filled offer pays no second refund.
7. Reload or recheck after a fill. A successful offer remains **Filled · NFT received**, even when the original offer-creation receipt is rechecked.
8. Let an unsent review expire. Confirmation becomes unavailable; **Discard unsent review** restores the mission buttons so a fresh review can be prepared.

Each practice NFT costs 0.0001 ETH; a native purchase must leave at least 0.0001 ETH in the copied Punk Wallet. The candidate guard enforces that reserve and NFT delivery in the actual copied transaction. These selected listings do not establish a verified collection floor.

## Start a fresh practice

From the repository, using the already-reviewed artifacts and configured archive credential location:

```sh
node scripts/test-marketplace-disposable.mjs \
  --disposable-only \
  --archive-keychain \
  --artifacts=contracts/out \
  --interactive
```

The launcher creates and verifies its own Anvil process on a random loopback port, checks the copied chain, deploys the candidate contracts locally, and prints the practice URL. It never uses an existing node for writes. Stop only this launcher's process to close its server and disposable node. Do not stop the separate Forge practice or other user sessions.

The browser can choose only fixed practice actions. It cannot provide RPC URLs, contracts, recipients, calldata, transaction hashes, or nonces. Skill and policy permissions are fixed practice fixtures; this rehearsal does not prove the production skill registry or marketplace posting integration.

## Recovery and local request protection

The server atomically saves an owner/seller claim before calling its fixed transaction sender. The claim binds sender, nonce, destination, input, value, and the local pre-send block. If the response is lost, **Recheck original result** searches at most 128 blocks created after that claim for the exact original transaction. It rejects another transaction at the same nonce, incomplete block responses, and inconsistent block identity. It never sends a replacement.

An unspent nonce with no matching transaction remains pending. If more than 128 local blocks have elapsed or the nonce was consumed without the exact transaction being recoverable, the page stays blocked and explains that it will not resend. This practice journal survives browser reloads; it is session-local, bounded to 80 reviews, and discarded when the owned process closes. It does not offer recovery across launcher restarts.

Mutations require the exact local Host, exact Origin, a random per-process nonce, JSON content type, a bounded body, and an exact action schema. A server-side lock prevents concurrent mutation claims. Each action and state request reasserts ownership of the disposable node. Returned errors use a fixed allowlist and do not expose provider URLs, keys, or raw internal exceptions. The page has a self-only content policy and no external scripts, styles, images, wallet requests, or public-order endpoint.

## Validation evidence

`tests/marketplace-practice.test.mjs`: 15 passing tests cover original-nonce recovery, transaction substitution, incomplete history, consumed and pending nonces, local node checks, strict HTTP guards, sanitized first-load failure and retry, concurrent actions, and rejection of arbitrary RPC/send endpoints.

The combined marketplace review, independent security, and practice suite passed **106/106 tests** after integration. No contracts changed in this practice task; the prior reviewed contract and copied-chain validation remains recorded in the adjacent marketplace evidence.

`scripts/test-marketplace-practice-browser.mjs` uses a fresh isolated Chrome profile and the real running practice API. It blocks external origins, injects one initial state-load failure, performs the actual copied-chain transactions, checks their reconciled results, waits through a real review expiry, and records screenshots. Run it against a fresh practice session:

```sh
node scripts/test-marketplace-practice-browser.mjs \
  --url=http://127.0.0.1:50034 \
  --output=/private/tmp/gogh-marketplace-practice-qa
```

Nine real browser journeys passed: initial-load retry; one purchase and duplicate-confirmation protection; a two-NFT purchase; exact WETH bid fill; filled-state persistence across reload; collection WETH bid fill; cancellation and repeated cancellation without another refund; cancel-after-fill without refund; actual expiry and discard recovery. The returned receipt hashes are in [practice-final-browser-evidence.json](practice-final-browser-evidence.json).

Seven screenshots cover 320, 375, 430, 768, and 1440-pixel widths, including loading failure, native purchase, offers, and expiry. All measured widths have no horizontal overflow and no enabled buttons below a 44-pixel touch target. Desktop, small-phone offers, and expired-review screens were also visually inspected.

The backend lost-send search is covered by isolated adverse tests; this browser run did not inject a lost signer response. The browser did exercise initial network failure, receipt rechecks, and reloads against real copied-chain state. Public transactions, public orders, and wallet connections were all zero.

## Production boundary

Public native purchases still require the reviewed guard deployment/pins, real authorization, policy, simulation, and durable production journal. Public WETH offers remain blocked on the original collection's away-and-back ownership continuity limitation and unverified marketplace support for posting these restricted escrow orders. This practice does not change those gates or any existing wallet/collection ownership semantics.

## Final recovery review

The independent reviewer reproduced three P2 issues. Commit `36f8ed5` fixes them:
expired offers now replace prominent active results with an expired status; failed
canonical receipt rechecks clear old success and preserve the original claim for
recovery; a retained failed seller claim no longer offers a false retry button.
Terminal Filled/Cancelled labels take precedence over a historical failed attempt.
Thirteen independent regressions and the full 106-test marketplace group pass.
The fresh repaired process passed all nine actual browser journeys again at
21:09 UTC, with seven screenshots and zero public transactions. The screenshot
review found no desktop/phone overflow or undersized enabled actions.
