# Marketplace review interface

Status: controlled implementation; no marketplace transaction broadcasting is installed. Existing free-mint account/session semantics are unchanged.

`broker/src/v4/marketplace/contracts.mjs` owns versioned constants and ABIs. `review.mjs` exports `prepareMarketplaceReview(request, deps)` and `normalizeNativeListing(raw, { collection, nowSeconds })`. `reconcile.mjs` exports `reconcileMarketplaceReview(review, { client, transactionHash, minConfirmations: 12 })`.

The server obtains the authenticated owner and selected Punk. It must overwrite any client owner/Punk identity before invoking this interface. Client requests may contain only selected order hashes and exact decimal-string limits, never provider records, calldata, policy/screen conclusions, deployment pins or dependency callbacks.

```json
{
  "action": "BUY_LISTINGS",
  "owner": "authenticated owner address",
  "punkId": "93",
  "walletRole": "AGENT",
  "selection": {
    "collection": "verified collection address",
    "orderHashes": ["exact server-indexed order hash"]
  },
  "budget": {
    "maxTotalPriceWei": "200000000000000",
    "maxNetworkFeeWei": "100000000000000",
    "minimumReserveWei": "100000000000000"
  }
}
```

`deps` is constructed by reviewed server code:

- `client`: bounded read-only viem public client. Use authenticated archive reads where necessary. No wallet client, signing, send, relay or arbitrary JSON-RPC tool.
- `loadListings({ collection, orderHashes, anchor, wallet })`: fixed OpenSea source returns original records, each with chain `robinhood`, canonical Seaport 1.6, ACTIVE status, exact matching asset, price, `protocol_data.parameters` including counter, and signature. `wallet` is the canonical Agent just resolved and verified by the server, never a request field. It permits a separately reviewed fulfillment-signature lookup to bind its fulfiller and recipient to the actual caller. Returned marketplace transactions are never executed; the core constructs its own fixed batch. Missing/inconsistent original order data fails closed. Existing normalized market observations omit signatures and are intentionally insufficient.
- `screenCollection({ collection, codeHash, anchor })`: authoritative reviewed runtime/security result, returns `{ status: 'PASS', collection, codeHash }` only after actual supported inspection. Unknown/malicious runtime is blocked.
- `policyEvidence({ action, owner, punkId, wallet, selection, totalPriceWei, budget, anchor })`: consume existing shared deterministic policy/capability logic; returns `decision:'ALLOW', mode:'ASSIST', requiredSkillsEquipped:true, adapterApproved:true, budgetAllowed:true` only after those checks. These are trusted attestations, not client flags. No autonomous execution is added.
- `purchaseGuardDeployment`: absent in production today. When reviewed/deployed, `{ environment:'REVIEWED_PRODUCTION', address, codeHash }`, matching the guard's canonical registry/hash. Controlled harness uses `environment:'OWNED_DISPOSABLE_CHAIN'` plus `assertDisposable()` proving the invocation's owned node. No dummy production address.
- `disposableBidDeployment`: only `{ environment:'OWNED_DISPOSABLE_CHAIN', address, codeHash }`, plus `assertDisposable()`. Public WETH creation remains blocked regardless of an environment switch because no reviewed production branch exists.

The result is `GOGH_MARKETPLACE_REVIEW_V1`. Missing purchase guard returns `BLOCKED`, `transaction:null`, `PURCHASE_POSTCONDITION_GUARD_NOT_DEPLOYED`. WETH without owned disposable configuration returns `BLOCKED`, `transaction:null`, `WETH_BID_ESCROW_NOT_DEPLOYED` and `OWNERSHIP_CONTINUITY_NOT_PROVEN`.

Successful purchase reviews bind owner, Punk, AGENT wallet, exact order hashes/assets/prices, fixed chain/code, block anchor, account state, 60-second expiry, explicit legacy transaction type (`0x0`), gas limit/price, pending=latest owner nonce, exact total/reserve and a stable idempotency key. The transaction is one existing current-owner `executeBatch`: up to five exact native-ETH Seaport `fulfillAdvancedOrder` calls, then one stateless `assertPurchase` postcondition call. All calls revert together if any item fails. No WETH/ERC20 approvals are requested from the Agent.

The guard requires final Punk balance at least the reviewed reserve, current original owner, canonical account, exact next account state, collection code hash, every expected NFT delivered to that account, unique IDs, and unexpired review. The existing Agent increments state once **before** batch calls; the guard expects captured state + 1. The guard has no admin, funds, persistent state, or wallet-module permission.

`availability:'OWNER_REVIEW_READY'` means a simulated owner-assisted transaction exists, never permission for a server broadcast. `automaticSubmission:false`, `broadcastAuthority:'OWNER_WALLET_ONLY'`, `publicTransactions:0`, `walletRequests:0` are invariant. `collectionFloorVerified:false` is invariant: a selected listing sample never proves a complete collection floor.

The route/browser must persist an owner/Punk/chain-scoped journal and exact review before showing a wallet button, re-read owner/state/nonce/expiry at claim, atomically move to `WALLET_REQUESTED` before the one wallet request, and recover only the original transaction hash. An RPC timeout or unknown wallet response must not unlock another send. Do not trust a client-supplied review object or recalculate its calldata during recovery. The root integrator owns this HTTP/auth/database/UI surface.

For controlled WETH creation, selection is `{ collection, tokenId, anyToken, priceWei, deadline }`, all numeric values decimal strings; `anyToken:true` requires `tokenId:'0'`. Value is the exact owner-funded ETH price, wrapped to WETH inside the escrow. A quantity-one NFT/collection offer pays the canonical Agent wallet. Cancellation request selection is `{ orderHash }`. Its server-issued review adds `bidEscrow:{address,codeHash}` and `selection.bidBinding:{collection,tokenId,priceWei,salt,counter,createdAt,deadline,anyToken,collectionCodeHash,recipientCodeHash}` (all uints decimal strings), capturing immutable order identity. This binding is checked against `bids(orderHash)` and escrow runtime at the canonical receipt block, including when no new event is emitted. Original funder recovery does **not** require current ownership, equipped skills or a strategy; after the escrow verifies the funder, unused WETH returns to that same funder. The new owner's assets are never swept. Cancellation is idempotent, and a filled order records settlement rather than refunding spent funds.

`reconcileMarketplaceReview` verifies the original transaction hash/block identity/calldata/value/nonce/chain/legacy type and all fee fields, canonical receipt and confirmation count. Purchase completion requires the exact Seaport fills, exact native consideration, ERC721 Transfer events, pinned guard/protocol code and historical NFT ownership in the Agent wallet. It reports `PENDING`, `PENDING_FINALITY`, `REVERTED`, `COMPLETED`, `BID_ACTIVE`, `BID_CANCELLED`, `BID_ALREADY_CANCELLED`, or `BID_ALREADY_SETTLED`; it never sends/retries a transaction. Persist its single terminal transition using the existing journal's compare-and-set semantics.

A first refund reports `refundedWethWei` and `refundInThisTransaction:true`. A successful repeated cancellation or cancel-after-fill uses pinned historical terminal state and reports `refundedWethWei:'0', refundInThisTransaction:false`; it never attributes an old refund to the current receipt. Unknown receipt status, missing fees/type, unsupported transaction types, inconsistent block identities and unexpected fee-cap fields fail closed. Legacy-only reviews reject EIP-1559/2930/7702 conversion and require a fresh supported review instead of assuming it was authorized.

The disposable harness accepts `--interactive` and imports only the fixed local `scripts/dev/marketplace/practice-server.mjs` entrypoint supplied by the root UI integration. It awaits the holder's practice session, skips automatic adversarial transactions, and cleans up its owned Anvil when that session closes. This flag is never enabled for normal validation.
