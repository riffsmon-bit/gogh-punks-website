# Live owner-wallet setup test

Open **http://127.0.0.1:64345/** on the machine running this workspace. This is an
owner-wallet connection to Robinhood Chain (4663). Ports 64343 and 64344 remain
separate disposable practice chains.

**September 12 live progress:** the first deployment transaction succeeded and
its original receipt was recovered through both RPCs. Registry acceptance has
also succeeded and its original receipt is saved. The complete stack now passed
two-provider finalized verification at block `61353065`, with separate state
providers serving the same finalized block as the receipt/header providers.
Continue with **Read live Forge state** for #93; **Recheck transaction receipts**
can repeat verification using the existing journal. Do not submit either setup
transaction again. See the
[public setup record](review/2026-09-12/live-owner/README.md) for the transaction,
addresses and remaining verification. The selected pair is **burn #1753 → credit
#93**. No burn has been requested. Use **Check selected Punks live** to read both
owners, all four source wallets, the recipient's Agent-session state and its
training-credit baseline through both RPCs. This is a read-only preflight; missing
inventory, operational and production-integration checks stay explicit blockers.

The September 12 preflight update batches live reads and shares concurrent checks
without caching completed snapshots. If a network check cannot return fresh data,
the page clears the old results. Wait for it to finish, then use **Check selected
Punks live** again. A successful read may still list the outstanding burn setup
checks; it does not grant burn approval.

1. Click **Connect wallet** and select the existing administrator,
   `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. Switch to Robinhood if prompted.
   Connecting requests accounts; it does not deploy, sign in, approve or burn.
2. Click **Get live deployment review**. Both fixed public RPCs check the code,
   predicted addresses, nonce, balance, fees and creation simulation. Review the
   displayed maximum fee and exact transaction.
3. Click **Deploy paused Forge · open wallet**, then approve that transaction in
   your wallet if its network and fee match your review. It creates and connects
   the registry, reviewed progression and burn source. The page records the
   request durably before opening the wallet.
4. Once the creation receipt is verified, click **Review registry acceptance**.
   This gets a fresh nonce, fee quote and simulation against the contracts that
   now exist. Click **Accept registry control · open wallet** and approve the
   exact zero-value call. The registry remains paused.
5. Use **Recheck transaction receipts** until both RPCs verify a finalized
   deployment. Enter a Punk you own, such as #93, and click **Read live Forge
   state**. This reads real slots, credits and progression without another wallet
   transaction. A new stack has no learned skills or earned burn credits.

These two setup transactions cost real network gas. Neither transaction approves
or burns a Punk, spends a training credit, registers READY skills, or activates
the Forge. Actual burn-to-training remains required for launch and follows the
production wallet/recovery integration and a separate source/recipient review.

## Wallet cancellation, lost responses and recovery

Canceling before clicking a wallet button leaves an unsigned review. Once the
wallet has been requested, the page will not automatically request it again,
including after reload, expiry, a missing response or a server restart.

If the hash response was lost, copy the original hash from wallet activity into
**Recover a wallet transaction** and choose the matching setup step. Recovery
verifies the original sender, destination, calldata, nonce, fees and chain through
both RPCs. It does not resend. The page also saves any returned hash in browser
storage before asking the server to verify it.

The server saves a reported hash before its first RPC lookup and verifies it
against the exact review before trusting it. If that lookup is unavailable,
**Recheck transaction receipts** resumes verification from the saved hash after
a reload or server restart. It can also recover a hash saved by this browser if
the original HTTP report failed. An entirely missing hash needs wallet activity;
the page now says this explicitly instead of suggesting it is awaiting finality.

If the wallet transaction was canceled or replaced on chain, **Check canceled /
replaced nonce** requires finalized nonce consumption and verifies that the
expected action did not occur. An expired review or client-side rejection alone
does not establish that a missing transaction was never sent. If a deployed stack
already exists, recover its original hash rather than create another one.

Creation and registry acceptance do not expire on chain. The page checks review
freshness before opening the wallet, while a late exact receipt remains
recoverable. Registry acceptance has an independent review so deployment can be
continued after a delay or other owner-wallet activity.

## Running and checking the page

```sh
node scripts/dev/skill-forge/run-owner-deployment.mjs --live-owner-wallet
```

The server binds to `127.0.0.1:64345` and has no signer or private-key loader. It
persists its journal in `~/.gogh-punks/forge-deployment.sqlite` with restricted file
permissions and SQLite FULL commits. Do not delete that journal to clear a pending
request. Wallet signatures are requested only by the browser buttons. The API
requires the exact local Host/Origin and a per-process nonce for mutations.

The deployment record link exports the original plan, both step records,
acceptance review and verified evidence. The public verifier also accepts that
export through its existing `--plan` argument. Only finalized public evidence can
produce proposed site/training manifest contents; this page does not publish the
website or enable production burn execution.

Validation uses a separately owned Anvil and a disposable Chrome profile. The
browser test completes both actual local wallet calls, loses and recovers the
creation hash across a server restart, changes the nonce before acceptance, tests
wrong-owner/foreign-origin rejection, and verifies layouts at 1440, 390 and 375
pixels. It never accesses the user's MetaMask or sends a public transaction.

```sh
node --test tests/skill-forge-deployment.test.mjs tests/skill-forge-deployment-wallet.test.mjs
node scripts/test-owner-deployment-browser.mjs --local-only
```
