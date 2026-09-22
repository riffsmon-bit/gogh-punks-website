# Public token withdrawal interface

Status: IMPLEMENTED AND LOCALLY TESTED. No mainnet token was transferred by this work. Production acceptance still requires the integrated preview, Netlify packaging/routing, archive RPC checks, and a holder-confirmed small transfer.

## Holder flow

1. Open Collection and choose Withdraw tokens.
2. Select **Punk Wallet · V3** or **Agent Account · separate wallet**. These are different custody addresses. V1/V2 recovery remains linked through the existing Control Center.
3. Enter the exact Robinhood Chain token contract, or choose WETH. A token symbol does not establish authenticity.
4. Check the balance, enter an amount, and choose Review withdrawal.
5. Review the token address, source wallet, fixed current-owner destination, amount, and maximum ETH network fee.
6. Confirm in the connected owner wallet. No approval is requested. Your owner wallet pays gas.
7. Check the original transaction. Confirmed success requires finalized exact transaction identity, exact Transfer event, and exact historical sender/recipient balance changes from both configured providers.

The form performs no polling. Checking/reviewing/recovering is user initiated. Reviews expire in the UI after 60 seconds. The existing account's execute method does **not** enforce an on-chain deadline; a request already sent to the wallet can remain valid. An unknown wallet response is therefore never cleared by a timer or automatically resent. A definite wallet rejection (provider error 4001) is separately recorded and permits a new review.

## Scope and custody

- V3 account resolution: the verified V3 registry and implementation in `deployments/robinhood-automation-v3.json`.
- Agent account resolution: verified Agent registry and implementation in `deployments/robinhood-punk-agent-account.json`.
- Both require original collection `ownerOf`, account `owner`, fixed registry resolution, salt, and exact ERC-6551 runtime footer for the selected token ID and chain 4663.
- Runtime hashes are independently pinned in the browser and tied to deployment manifests by tests.
- Legacy V1/V2 funds are never represented as balances in the V3/Agent wallets. Their existing recovery path remains linked.
- No private key, session key, relayer, worker or administrator can use this interface to withdraw. The connected current holder calls the existing account directly.
- No contracts, database schema or signing permission were changed.

## Supported token behavior

The interface is general by exact token address, not a prepopulated token list. It supports 0–36 decimals and exact integer conversion, without JavaScript floating-point arithmetic. Symbols are bounded plain text.

Before exposing wallet confirmation, both providers and the connected wallet simulate the account's `executeBatch` with source balance, destination balance, transfer, source balance, destination balance. The token must return exactly `true`, the source must lose exactly the chosen amount and the destination must receive exactly that amount. Missing return data, false return, currently observable transfer fees and rebasing/delta changes fail closed. The actual transaction is only owner-only `execute(token, 0, transfer(currentOwner, units), CALL)`. It cannot include approval, arbitrary calldata, a third-party destination, ETH transfer or delegatecall.

The two reviewed account implementations block unprivileged reentrancy and persistent approvals. The contract test exercises a malicious token callback attempting to withdraw ETH from both account types and proves it fails. Simulated reads/calls, request sizes, gas estimates, maximum fee, RPC timeout/retries and Netlify endpoint rate are bounded.

**Limitations:** an arbitrary malicious or upgradeable token can change behavior between simulation and inclusion. Pinning the token's runtime does not pin the implementation behind a token proxy. No existing account postcondition contract was added. Simulated behavior is evidence of the current call, not a guarantee about future token behavior. A transaction can therefore consume gas without delivering the exact amount. The interface never reports that as confirmed delivery. Final receipt/event/balance mismatch becomes REQUIRES_ATTENTION and cannot be automatically resubmitted. Other token movements within the same block can also conservatively cause REQUIRES_ATTENTION because block-level balance reads cannot isolate a transaction.

## Request/recovery integration

- `POST /api/v2/punks/:tokenId/erc20-withdraw`
- `inspect`: exact `operation, role, contract`
- `prepare`: exact `operation, role, contract, amount` (human-readable exact decimal string)
- `verify`: exact `operation, review`
- `recover`: exact `operation, review, transactionHash`

Every request requires a same-origin authenticated owner session. Controlled deploy previews use the project's existing preview-origin gate. Prepare/verify recheck current chain ownership; recovery is a read-only exact-transaction check for the original signed-in sender even if the Punk later transfers.

`createForgeRpcClients` provides configured archive endpoints first, two distinct RPC hosts, zero transport retries, disabled CCIP reads, bounded batching and forbidden HTTP redirects. No provider URL leaves the server. Historical reads are essential to confirmation; failed history reads do not silently downgrade to logs-only verification.

The browser persists before `eth_sendTransaction`, uses an owner-scoped Web Lock, and saves an owner-wide unresolved token-withdrawal marker as well as the Punk recovery record. Another Punk tab under that owner cannot submit a second token withdrawal until recovery finishes. A missing/broken local record blocks new sends. These browser holds do not claim a universal cross-feature/server-wide owner nonce reservation; unrelated wallet transactions remain subject to wallet and live latest/pending nonce checks.

Mount:

```js
import { createErc20WithdrawalPanel } from './erc20-withdraw-panel.js';
const tokenWithdrawals = createErc20WithdrawalPanel({
  root: document.querySelector('[data-v2-erc20-withdraw]'),
  getSelection: () => ({ tokenId, owner, chainId, preview }),
  getProvider: () => window.__GOGH_WALLET_PROVIDER__,
  ensureSession: ensureV2Session,
  request: jsonRequest,
});
// On Punk or owner changes, local only:
tokenWithdrawals.selectionChanged();
```

Load `/erc20-withdraw.css`. Request uses the existing `jsonRequest(path, fetchOptions)` seam. Mount near collection/NFT recovery with `id="token-withdrawals"`; link from Fund and holder instructions. Root integrator owns main HTML, main JS and Netlify routing.

## Local evidence

- Targeted browser-code/server and DOM interaction tests: **67/67 passed**. Tests cover decimal conversion, wrong owner/chain, source balance, nonce, stale state, runtime changes, exact typed calldata, false/fee tokens, receipt mismatches, transfer, unknown wallet response, storage failure, cross-tab/cross-Punk suppression and zero automatic requests.
- Existing NFT/Agent recovery plus new withdrawal regression run: **153/153 passed** before the final additional storage-getter test; the complete new 67-test suite passed afterward.
- Repository JavaScript syntax check: **896 modules passed**.
- `contracts/test/GoghErc20Withdrawal.t.sol`: **5/5 passed**, offline Solidity 0.8.34. Both real V3 and Agent account source implementations exercised; no public RPC or broadcast.
- Fixture RPC/provider doubles are deterministic test evidence, not a claim of fresh production RPC health or a live withdrawal.
- Root integration must still run full repository checks and actual desktop/mobile rendered preview validation, then production read-only checks after its reviewed release.
