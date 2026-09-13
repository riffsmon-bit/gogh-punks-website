# Agent recovery interface V1

Owner-reviewed withdrawals only. No server signer, worker integration, broad execution, contract deployment, sweep, refund broadcast or V3 changes. Existing Agent Account methods supply current-owner authority.

## API and typed intent

`POST /api/v2/agent-account/recovery` requires the existing same-origin V2 authenticated session. Owner is derived from that session. Body has exactly one field, `intent`:

```json
{"intent":{"schema":"GOGH_AGENT_RECOVERY_INTENT_V1","tokenId":"93","action":"NATIVE","amountWei":"100000000000000","assetContract":null,"assetTokenId":null}}
```

Actions: `NATIVE`, `ENTRY_POINT`, `ERC721`, `ERC1155`. `amountWei` is a positive decimal string; for NFTs it means raw token units, and ERC721 requires `"1"`. Native/EntryPoint asset fields are null. NFT asset fields identify a nonzero contract and decimal NFT ID. Withdrawing the controlling Punk collection is excluded. No destination, calldata, spender, operation or signer field is accepted.

Response `{ok:true,review}`. Review schema `GOGH_AGENT_RECOVERY_REVIEW_V1` includes the exact normalized `intent`, `owner`, `account`, `accountSalt`, `accountRuntimeCodeHash`, optional `assetRuntimeCodeHash`, canonical numbered/hash/timestamp `anchor`, millisecond `expiresAt`, `balances`, `session`, exact legacy `transaction` and `maximumNetworkFeeWei`. Review expiry is 90 seconds. Fees are capped at 0.001 ETH; gas is capped at 500,000. All quantities except expiry are decimal strings or transaction hex quantities. The account is separately registered Agent custody; V3 is not involved.

Native withdrawal preserves the active session's native reserve. EntryPoint withdrawal requires recall first while a session is active. NFT custody and ERC165 standard support must be verified. API and browser independently derive transaction bytes from the typed intent, and each checks live owner, registry, implementation, proxy footer, balances, chain and simulation. Browser requires the current owner's wallet to pay network fees. Contract-level owner authority remains decisive.

## Frontend consumer

Import `createAgentRecoveryController` and optionally `normalizeAgentRecoveryIntent` from `/punk-agent-recovery.js`.

```js
const recovery = createAgentRecoveryController({
  provider, fetchFunction: window.fetch.bind(window), storage: window.localStorage,
  owner, tokenId, isCurrent: () => selectionStillMatches(),
  onChange: state => renderRecoveryState(state), locks: window.navigator.locks,
});
await recovery.prepare(intent); // inspect and render review; never opens wallet
await recovery.submit();        // only from explicit user confirmation
await recovery.refresh();       // receipt check; never resends
await recovery.recover(hash);   // wallet hash recovery; never resends
await recovery.cancelReview();  // only unsent review or explicit wallet rejection
const state = recovery.getState();
```

Methods return state snapshots. `getState()` includes `schema`, `status`, `review`, `transactionHash` and `receipt`. States: `EMPTY`, `PREPARED`, `WALLET_REQUESTED`, `SUBMITTED`, `CONFIRMED`, `REVERTED`, `REJECTED`, `CANCELLED`. Expired PREPARED remains inspectable but must be cancelled and reviewed again. UI should render the current action, source Agent address, owner destination, amount/token, maximum fee and expiry before enabling confirmation.

Web Locks are mandatory for state changes; absence blocks submission rather than bypassing cross-tab serialization. The journal uses a chain/owner/Punk key. A durable WALLET_REQUESTED entry is written and read back before the provider sees `eth_sendTransaction`. Ambiguous response, refresh, owner/network switch, or failed receipt read never clear the journal and never resend. Only a definite wallet rejection (4001), verified reverted receipt or verified completed receipt frees the next review. Pasted hashes are candidates until the chain transaction matches the exact reviewed from/to/calldata/value/chain/nonce/gas limits. Missing, unrelated or unavailable candidates leave WALLET_REQUESTED unchanged and can be corrected. Once transaction identity is verified the recovered hash is durably bound before receipt reads, and canonical confirmation requires 12 confirmations. Browser storage loss or deliberately clearing browser data remains an external limitation; the module does not claim a server-side durable ledger.

`onChange` receives snapshots after successful durable writes; rendering callback failure cannot change transaction status. Do not call submit on mount, refresh, timer or provider events. Host should catch stable `AGENT_RECOVERY_*` errors and show their safe messages. Do not replace the owner's explicit confirmation with chat or AI approval.

## Validation evidence

Implementation is in `broker/src/agent-account/punk-agent-recovery.mjs`, `netlify/functions/broker-v2-agent-account-recovery.mjs` and `site/punk-agent-recovery.js`. The core uses viem encoding; the browser independently constructs each permitted call from the typed intent and rejects mismatching API bytes. Successful empty EntryPoint responses follow viem's `{data:undefined}` representation. Confirmed NFT recovery additionally requires the exact ERC721 Transfer or ERC1155 TransferSingle event from the requested contract, account and owner.

The two public implementation/registry runtimes were fetched read-only from the official Robinhood RPC on September 13, 2026 and matched the release manifest hashes before being embedded as compressed offline test fixtures. No API credential, private key, wallet request or transaction was used to capture them. Runtime addresses and hashes are asserted against the deployment manifest in the test.

`node --test --test-concurrency=1 tests/punk-agent-recovery.test.mjs tests/punk-agent-recovery-api.test.mjs tests/v2-swarm-wallet.test.mjs`: **65 passed**, including 59 new recovery/API cases and the six existing swarm wallet proofs. Coverage includes all four actions, original-owner transfer and new-owner recovery, native reserve and EntryPoint recall gates, missing custody, provider/code/chain/fee drift, independent wallet rechecks, exact NFT events, cross-origin/session rejection, malformed intent and added destination/calldata fields, storage failure, missing Web Locks, concurrent controllers, wallet rejection, ambiguous send, reload, saved-hash recovery, wrong-hash correction, missing/unavailable candidate retry and sanitized read failures.

This is a local implementation result. Browser layout mounting, full repository/contract validation and independent security review belong to the integrated review gate. No recovery transaction has been broadcast. General ERC20 recovery, old V1/V2 account UI, server-side recovery journals and replacement-transaction reconciliation remain outside this interface.
