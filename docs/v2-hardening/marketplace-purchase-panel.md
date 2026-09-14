# Owner-assisted selected purchase panel

The new `site/marketplace-purchase-panel.js` renders an exact selected-listing review, opens the reviewed owner wallet boundary once, and keeps the original purchase available for recovery. It imports the existing `submitMarketplacePurchase` and `validateMarketplaceEnvelope`; it contains no transaction builder, marketplace provider, production release pins, or public listing chooser.

The panel is ready for controlled integration. This does **not** release public purchasing. The root application supplies `purchaseRelease: null` while no reviewed production release exists; its empty panel stays hidden and makes no API request.

## Mounting interface

```js
import { createMarketplacePurchasePanel } from './marketplace-purchase-panel.js';

const panel = createMarketplacePurchasePanel({
  container,                    // dedicated element; styles stay in its shadow root
  api: request,                 // request(path, { method, headers, body }) -> parsed envelope
  getSelected,                  // { tokenId, chainId: 4663, preview: false, owner? }
  getOwner,                     // currently authenticated owner address
  getProvider,                  // returns or resolves the owner's EIP-1193 provider
  purchaseRelease: null,        // explicit trusted reviewed release required for sending
  storage: localStorage,
  authenticate: ensureV2Session, // optional; invoked only by explicit sign-in action
  onSettled                     // optional; receives { owner, punkId, chainId, entry }
});

await panel.refresh();
panel.clear();                  // invalidate view/awaits on identity change; retain journal
panel.destroy();                // invalidate view/awaits and remove shadow content
```

`refresh()` skips external work only when the release is absent/null **and** no scoped local journal exists. A known `PAUSED` release still reads the server's latest owner/Punk history on a new device. A saved journal is always checked by its exact original intent ID, even when the release is absent or paused. `clear()` does not erase saved requests or transaction hashes.

When the injected API rejects with `V2_SESSION_REQUIRED` or `V2_SESSION_EXPIRED`, an available `authenticate()` callback enables an explicit **Sign in to recover** action. Background refresh never invokes this callback. The click captures the owner/Punk/chain generation and original local intent, waits for authentication, and rejects a changed selection (including a cleared A→B→A round trip) or active intent before any recovery read. This action performs only the scoped GET and, when an original hash is bound, the existing CAS recovery request. It does not replay a missing draft preparation, claim or wallet send. Declined/failed sign-in preserves the journal and offers an explicit retry; unrelated authorization errors do not enable authentication. The callback takes no arguments and can directly use the root application's `ensureV2Session`.

A future reviewed selection consumer can call `await panel.prepare(input)` with exactly:

```js
{
  selection: {
    collection: '0x…',
    orderHashes: ['0x…']
  },
  budget: {
    maxTotalPriceWei: '1100000000000000',
    maxNetworkFeeWei: '4000000',
    minimumReserveWei: '500000000000000'
  }
}
```

One to five unique exact order hashes are normalized/sorted. Budgets are canonical unsigned uint256 decimal strings; price and network fee limits must be positive. Extra fields, sparse arrays, accessors, numeric budgets, zero collection, and the controlling Gogh collection are rejected. No URL, calldata, marketplace order payload, recipient, or transaction is accepted from this consumer. The authenticated server resolves the reviewed exact orders.

Methods resolve to the latest valid envelope or `null`; expected errors render in the component. Concurrent operations on one panel are serialized. Call `refresh()` when selecting/signing in, and `clear()` immediately when the selected Punk or authenticated identity changes. The component also checks the captured owner/Punk/chain after awaits and before the wallet boundary. `onSettled` includes the original scope so the root can discard unrelated balance refreshes after a selection change.

## Durable behavior

Before the first prepare POST, the component generates a UUIDv4 and persists the exact normalized input and server-compatible SHA-256 intent identity. Storage writes are read back before proceeding. The scope key is `gogh-marketplace-purchase-v1:4663:<owner>:<punkId>` with an `:active` pointer and retained `:intent:<intentId>` records. The digest uses exactly `JSON.stringify({chainId:4663, owner, punkId, requestId})`.

An interrupted preparation first GETs that same intent. If the server has not saved it, an active reviewed release may repeat the original UUID/input; it never manufactures a replacement request. A pending purchase prevents preparation of a different selection. A terminal purchase permits a fresh request while retaining the old record.

A blocked unattempted draft can be explicitly discarded after a fresh GET for its exact original intent confirms `entry: null`. The retained local record becomes `DISCARDED`, which permits corrected input with a new UUID. This is a local unsent-request action, never a claim that a server purchase was cancelled. Any late server entry is adopted instead. Failed/mismatched reads, changed active pointers, or local attempt/hash markers prevent discard. Known paused-release read errors remain visible with a refresh action even on a new device.

Before claim, the actual wallet helper validates the release, wallet identity/network, immutable review and decoded guard call. The component persists `attempted: true` before claim. A lost claim response, wallet rejection, send error, or unknown outcome never re-enables wallet submission for that request. Original transaction hashes are persisted to the captured original scope even if the user changes selection during the wallet prompt. A storage failure after a returned hash also retains that hash in the current component's memory so it remains visible for recovery; persistence failure is reported and sending remains blocked. Manual hash input stays a hint until the server verifies and binds it.

Received reviews are checked against saved collection, exact order hashes and integer budget bounds. Failed refresh or validation disables confirmation of any previously displayed review. Terminal success/revert requires a matching original hash and a matching receipt status with at least twelve confirmations. Terminal cards have no review, cancel, or wallet buttons. Recovery and unsent cancellation remain explicit CAS requests to the existing durable API.

## Verification

- `node --test tests/marketplace-purchase-panel.test.mjs` — **33/33 PASS**. Covers persistence before preparation, exact intent replay after lost response, null/paused behavior, real helper invocation, terminal verification, transfer while awaiting, rejected wallet, concurrency, storage/input failures, safe discard of blocked unsent drafts, and explicit session recovery with selection/intent race checks.
- `node scripts/test-marketplace-purchase-panel-browser.mjs --mock-wallet-only` — **PASS** in local Chrome at 1440, 375 and 320 pixels. The fixture uses the actual panel, actual reviewed helper, actual bundled calldata codec, and existing broker CSS. It checks lost prepare/claim/recovery responses, reload recovery, an unobserved manual hash, rejected wallet, concurrency, transfer, HTML-safe error display, local storage failure, paused new-device recovery, and no stale terminal actions. See [machine-readable result](marketplace-panel-evidence/result.json).
- The earlier independent [wallet boundary review](marketplace-wallet-independent-review.md) and `tests/marketplace-wallet-boundary.test.mjs` cover the helper's order hash/counter binding, guard/release restrictions and malformed claims.

Inspected screenshots: [320px review](marketplace-panel-evidence/review-320.png), [375px review](marketplace-panel-evidence/review-375.png), [desktop review](marketplace-panel-evidence/review-1440.png), [pending recovery](marketplace-panel-evidence/recovery-375.png), [375px completed](marketplace-panel-evidence/completed-375.png), [320px reverted](marketplace-panel-evidence/reverted-320.png), [safe error](marketplace-panel-evidence/error-375.png). Exact ETH amounts are retained without floating-point conversion or rounding; narrow layouts stack long totals without horizontal overflow.

The browser script requires the repository's installed `esbuild`, Node with WebSocket support, and Chrome at the current macOS application path. It starts its own random-port loopback server and isolated temporary Chrome profile, forbids fixture network connections with CSP, and cleans up only its own process/profile. It does not use a public RPC, real wallet, SQL journal, or deployed guard. Evidence records **zero public requests and zero public transactions**. API/release/wallet responses are controlled fixtures, so production release, durable database CAS, copied-chain receipt proofs, and the root application mount remain separate integration gates.

Only the new panel, dedicated fixture/tests/script and this evidence/document are owned by this change. Existing wallet helper/codec, API contracts, controller, global styles and production releases are unchanged by the panel commit.
