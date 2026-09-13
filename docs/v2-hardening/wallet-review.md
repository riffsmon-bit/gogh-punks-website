# Wallet hardening review: H-07 and H-09

Scope: `v2/hardening-wallet-20260913`, based on integration `4f9e450`. This candidate changes owner-confirmed Agent gas funding and the read-only V3 funding summary. It does not change contracts, account ownership, recovery permissions, missions, workers, production data or deployment configuration.

## H-07: owner funding does not require V3 activation

`prepareAgentGasFunding(provider, context, tokenId, source, amount)` preserves its existing signature. For `source: "OWNER"`, the preferred context is:

```js
{
  agent, // existing authenticated /api/v2/punks/:tokenId/agent-account response
  ownerBinding: {
    chainId: 4663,
    collection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
    tokenId: "93",
    owner: capturedConnectedOwner
  }
}
```

The parent captures this selection; it must not source the owner binding from chat, user-supplied transaction data or a changing selection after review. The old `{gate, agent, funding}` context is backward compatible: only its identity fields are read on the OWNER path. `gate` capability, V3 activation, V3 code/balance and reserve are unnecessary for an owner-to-Agent deposit and are not read. The OWNER plan's `punkWallet` is `null` and its `reserveWei` is `"0"`, because no V3 funds move.

Both sources independently verify the connected account/network, original collection `ownerOf`, Agent owner, fixed registry account lookup, pinned registry and implementation bytecode hashes, and exact token-specific Agent proxy runtime including collection, chain, token ID and registry salt. They estimate and simulate the exact constructed transaction. OWNER funding additionally checks the connected wallet's ETH balance; PUNK funding still calls the existing `readPunkWalletFundsState`, checks V3 runtime/current owner and enforces `balance >= amount + verified reserve`. An unactivated Agent is still blocked; this does not deposit into an unverified counterfactual account.

Transactions now include Robinhood `chainId` and the reviewed sender `nonce`. A pending sender transaction blocks preparation until resolved. Submission repeats live validation and rejects any changed displayed plan, source, amount, destination, nonce, reserve or selection. Funding does not activate a mission or grant signing authority. As with any direct native transfer, ownership may change after final preflight and before inclusion; the deposit itself does not atomically assert NFT ownership. The displayed original owner is rechecked before the wallet request, and existing ownership semantics remain unchanged.

## Funding result recovery and duplicate protection

The previously stateless submit helper could reopen the wallet after an ambiguous response. A funding-specific journal now prevents that. Its key is chain/current sender/Punk, independent of amount or funding source. Browser storage plus Web Locks are mandatory. The journal writes and reads back `WALLET_REQUESTED` before opening the wallet; concurrent tabs cannot bypass a pending request. Only definite wallet rejection `4001`, a verified revert or verified confirmation frees a subsequent explicit funding review. No storage-clearing or automatic replacement path exists.

All exports below are available from `site/punk-agent-gas-funding.js`:

```js
getAgentGasFundingState(owner, tokenId, { storage });
await submitAgentGasFunding(provider, displayedPlan, {
  loadContext, isCurrent, storage, locks
});
await recheckAgentGasFunding(provider, owner, tokenId, {
  isCurrent, storage, locks
});
await recoverAgentGasFunding(provider, owner, tokenId, originalHash, {
  isCurrent, storage, locks
});
```

`storage` and `locks` default to browser localStorage and navigator.locks. `isCurrent` is required for operations that inspect or change the journal. The snapshot getter returns `null` or a record with `status`, `owner`, `tokenId`, exact public `transaction`, `transactionHash` and `receipt`. Statuses are `WALLET_REQUESTED`, `SUBMITTED`, `CONFIRMED`, `REVERTED`, `REJECTED`. It contains no credential, private key, signed bytes or AI payload.

Recheck and recovery are read-only chain actions. A pasted hash must match the reviewed from/to/value/data/chain/nonce and original transaction hash. An unrelated or unavailable candidate does not bind or clear the pending record. A verified recovered hash is saved before receipt reads, so transient failure does not lose it. Confirmation requires a successful canonical receipt and 12 confirmations; a verified revert is separately labeled. No replacement transaction is sent. A fresh preparation and explicit review remain required for later funding.

Parent UI integration requirements:

- Fetch only `agent-account` and provide captured `ownerBinding` for OWNER; retain `gate`, `agent`, `funding` for PUNK.
- Show saved funding state on mount, wallet/Punk selection and after errors. Offer “Recheck funding” and “Recover original transaction” with a hash input when pending.
- Preserve the stored request when the form changes. Never clear it in an exception handler or on a timer.
- After the existing receipt wait, call the journal's recheck. A first receipt alone does not release the pending lock; keep a usable recheck until 12 canonical confirmations.
- Show `error.message` for stable `AGENT_GAS_*` failures. Storage/Web Lock failures explain why the wallet was not opened. A lost wallet response explains how to recover it.

The browser journal survives normal reloads and competing same-origin tabs. Deliberate browser-data deletion, a different browser/device and provider replacement-transaction workflows remain outside this local journal's guarantees. Cached terminal states are receipt evidence from an earlier check, not current balance/custody proof. The UI must refresh balances after confirmation.

## H-09: reserve belongs to this current owner and wallet

`GET /api/v2/punks/:tokenId/fund` still requires the existing authenticated session and live current-owner reader. The single bounded strategy query now requires ACTIVE state, unexpired database expiry, `configured_by` matching the fresh current owner, and intent owner/wallet/Punk/chain bindings. A seller's residual strategy or an Agent-account strategy cannot reduce the V3 wallet's displayed available art budget.

The selected intent is validated using the established collecting-intent schema and its own expiry. Reserve wei must be exact decimal text within uint256; JSON numbers are rejected because their precision may already be lost. Invalid current rules return `FUND_RULES_UNAVAILABLE` with no apparently available balance. No eligible strategy produces reserve zero. Exact BigInt arithmetic floors available balance at zero. The response is `private, no-store` and remains display evidence only, never independent execution authority.

No migration or production database write is required. Existing primary-key/active-strategy indexes serve this token-scoped, `LIMIT 1` query; no unbounded scan or new network call was introduced.

## Evidence and limitations

Focused tests use actual browser modules against deterministic mock wallet/RPC boundaries and the pinned public Agent runtime fixtures. SQL tests execute the existing foundation and V2 migrations in disposable PGlite PostgreSQL, then exercise the real endpoint query. This proves SQL parameter/operator behavior and owner/wallet/expiry filtering rather than only matching query strings. It is not a production role/RLS audit or a live-wallet broadcast.

Final focused command: `node --test --test-concurrency=1 tests/punk-agent-gas-funding.test.mjs tests/art-broker-v2-fund.test.mjs tests/punk-wallet-funds.test.mjs tests/punk-agent-recovery.test.mjs tests/punk-agent-recovery-api.test.mjs tests/art-broker-v2-ownership.test.mjs` — **145 passed, 0 failed**, September 13, 2026. This includes 38 gas-funding cases (31 new), 17 new actual-SQL endpoint cases and 90 unchanged neighboring wallet/recovery/ownership cases. Execution log: `/private/tmp/gogh-hardening-wallet-validation.log` in this workspace session.

Coverage includes inactive V3 owner funding, legacy context, stale owner, wrong chain/account/registry/runtime/footer, insufficient owner funds, PUNK reserve, mutated amount/nonce/transaction, failed simulation, explicit rejection, unknown wallet response, cross-tab concurrency, storage failure, reload recovery, wrong-hash rejection, canonical confirmation and revert. SQL cases cover seller residue, Agent wallet mismatch, expired/paused/draft strategies, exact values above JavaScript's safe integer range, malformed numeric reserves, empty strategy and unauthenticated/former-owner rejection. A recoverable storage readback failure before any wallet request is explicitly marked terminal so it cannot strand an unknown transaction.

The orchestrator owns the final UI wiring, connected-wallet onboarding walkthrough, integrated suite, independent security review and release. This specialist does not declare the whole product FINAL_TESTING_READY or a funding transaction completed in production.
