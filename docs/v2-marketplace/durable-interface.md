# Durable owner-assisted marketplace interface

Status: implemented and locally tested; **production release is blocked**. The production constructor returns no transaction and does not open a marketplace database or RPC connection. This interface supports only one to five exact native-ETH ERC721 Seaport purchases in the canonical Punk Agent. Public WETH bids remain outside this interface.

## HTTP and authenticated scope

`netlify/functions/broker-v2-marketplace.mjs` exports `handleMarketplace(request, serverDependencies)` and the route `/api/v2/punks/:tokenId/marketplace`, GET/POST. Root integration owns Netlify packaging and browser code.

The handler reads the owner from the existing `requireV2Session` session and the Punk from the strict route. POST requires the existing same-origin check. It rejects unknown body/query fields, provider records, RPC URLs, owner flags, wallet roles, calldata, reviews, dependency functions and deployment pins. Bodies are limited to 4096 bytes. Neither GET nor POST accepts a review to recover. Responses use `Cache-Control: no-store`.

GET accepts only optional `?intentId=<64 lowercase hex digits>` and returns that original scoped entry or the newest scoped entry, preferring an unresolved entry.

POST prepare:

```json
{
  "operation": "prepare",
  "input": {
    "requestId": "11111111-1111-4111-8111-111111111111",
    "action": "BUY_LISTINGS",
    "selection": {
      "collection": "0x1111111111111111111111111111111111111111",
      "orderHashes": ["0x1111111111111111111111111111111111111111111111111111111111111111"]
    },
    "budget": {
      "maxTotalPriceWei": "200000000000000",
      "maxNetworkFeeWei": "100000000000000",
      "minimumReserveWei": "100000000000000"
    }
  }
}
```

These addresses are input-shape examples, not offered listings or release pins. Numeric limits must be canonical unsigned decimal strings, never JSON floating-point numbers. The browser generates one UUID v4 for each explicit new preparation, preserving that UUID across transport retries. The server derives the intent ID from normalized owner/Punk/chain/requestId. Reusing the ID with changed input is rejected. A new ID cannot bypass an unresolved purchase hold.

All mutations require optimistic concurrency:

```json
{
  "operation": "claim",
  "intentId": "64 lowercase hex digits, without 0x",
  "revision": 0,
  "reviewHash": "64 lowercase SHA-256 hex digits, without 0x"
}
```

`operation` is exactly `claim`, `cancel`, `decline`, or `recover`. Only `recover` may additionally include `transactionHash`, a lowercase 0x-prefixed 32-byte hash. Omitting the hash recovers the previously bound original hash. An unobserved hash is only a hint and is not persisted. A hash differing from the bound original is rejected.

## Coordinator exports and envelope

`createMarketplaceCoordinator({store,release,deps,now})` exports:

```js
get({ owner, punkId, intentId? })
prepare({ owner, punkId, input })
claim({ owner, punkId, intentId, revision, reviewHash })
recover({ owner, punkId, intentId, revision, reviewHash, transactionHash? })
cancel({ owner, punkId, intentId, revision, reviewHash })
decline({ owner, punkId, intentId, revision, reviewHash })
```

The owner parameter is an internal server argument. The HTTP handler always derives it from the session. `release` may be a trusted release reader, allowing a running service to pause. Optional verifier overrides are server-only offline-test seams; the reviewed runtime uses the real core functions.

Every successful response contains:

```js
{
  schema: 'GOGH_DURABLE_MARKETPLACE_V1', owner, punkId, chainId: 4663,
  availability, blockers: [], entry: null,
  transaction: null, walletClaimed: false,
  automaticSubmission: false, publicTransactions: 0,
  broadcastAuthority: 'OWNER_WALLET_ONLY', collectionFloorVerified: false
}
```

Availability is one of `RELEASE_BLOCKED`, `EMPTY`, `OWNER_REVIEW_READY`, `RECOVERY_REQUIRED`, `COMPLETED`, `REVERTED`, `CANCELLED`. A successful first claim has `RECOVERY_REQUIRED`, `walletClaimed:true`, and the one exact `transaction` payload. Availability represents its now-reserved journal state.

An entry is `{intentId,revision,reviewHash,status,reportedHash,receipt,reason,holdsPurchase,review}`. The review includes original identity, listing items, cost, safety/policy/simulation evidence, anchor and expiry. Each listing retains its decimal-string Seaport `counter` for exact order-hash reconstruction. `review.transaction` is always null in the public entry. Its `transactionCommitment` contains exact `from,to,chainId,type,nonce,value,gas,gasPrice,dataHash`, where `dataHash` is keccak256 of the immutable original calldata.

The wallet client must preserve the prepared commitment, validate every returned transaction field and calldata hash, decode the exact batch, and verify each Seaport OrderComponents hash using its counter. It must check the current wallet account, chain and expiry, persist the attempted intent before claim, and dispatch only the first response with `walletClaimed:true`. It must never treat GET/retry/decline, a timeout, missing hash, or failed local persistence as permission to send again.

## Durable transitions

| State | Allowed next states | Reservation |
| --- | --- | --- |
| PREPARED | WALLET_REQUESTED or CANCELLED | Held |
| WALLET_REQUESTED | WALLET_REQUESTED, COMPLETED, REVERTED | Held |
| COMPLETED | None | Released |
| REVERTED | None | Released; network fee may have been paid |
| CANCELLED | None | Released; wallet was never claimed |

Claims re-run the existing core preparation against trusted current source/screen/policy/skill evidence, compare identity/account state/nonce/selection/runtime/fees, confirm the original anchor, and simulate the **stored original transaction** before the CAS. Refreshed calldata is never substituted. Database time independently rejects expired insertion and claim. A release change prevents claim. Only the committed CAS winner receives a transaction. A lost database acknowledgement or HTTP response leaves `WALLET_REQUESTED` held.

Cancellation is permitted only from `PREPARED`, including after expiry. It records `OWNER_CANCELLED_UNCLAIMED`. No automatic expiry releases a claimed review. `decline` records `WALLET_DECLINED_UNVERIFIED` while retaining `WALLET_REQUESTED`: a browser assertion that its prompt was rejected does not prove the transaction was never submitted.

Recovery does not require current Punk ownership, refreshed policy/skills, an unexpired review, or an active release. It requires the original authenticated owner/Punk scope. Before first binding a supplied hash, the fixed client must observe a matching sender, recipient, exact calldata/value/nonce/chain and supported legacy fee fields. The existing reconciler then verifies canonical receipt/finality, exact Seaport fills/consideration, ERC721 delivery and pinned historical code/ownership. Pending, unknown, mismatched, unavailable, or insufficient-finality evidence retains the reservation. Only a verified `COMPLETED` or `REVERTED` receipt makes one terminal CAS transition. Recovery never rebuilds or broadcasts a transaction.

## Store and release composition

`createMarketplaceStore(pool)` exports `get(scope)`, `current(scope)`, `save(immutableRecord)`, and `update(cas,mutation)`. The journal record stores `{intentId,releaseHash,input,review}` as canonical JSON plus SHA-256. Every read revalidates bytes, bindings, state and receipt identity. All reads/writes are scoped to owner/Punk/fixed chain; mutations also require revision and digest.

`20260913210000_stage_marketplace_reviews.sql` stages only new tables, indexes and triggers. It adds no production grants, role credentials or RLS policies. Immutable JSON/identity, legal transitions, monotonic revisions, original-hash binding, expiry at claim, terminal receipt identity and append-only event revisions are enforced by PostgreSQL. Unique active holds cover both `(chain,Punk)` across owner transfers and `(chain,owner)` across different Punks. This journal does not change the paid/free-mint ledgers or create a global cross-feature nonce lease.

`currentMarketplaceRelease()` returns an explicit `BLOCKED` release; there is no environment switch. Future server composition uses `createReviewedMarketplaceRuntime({release,pool,deps})`. It requires a dedicated restricted request-role pool, RLS, no ownership/superuser/bypass/delete/truncate/audit writes/review rewrites, and the required select/insert/narrow update privileges. It must use pinned, bounded read-only RPC with **client-level `ccipRead:false`**; per-read arguments are insufficient in viem. A `PAUSED` release may retain this store and fixed client for recovery.

An `OWNER_ASSIST` release requires `schema:'GOGH_MARKETPLACE_RELEASE_V1'`, chain 4663, `action:'BUY_LISTINGS'`, empty blockers, reviewed `purchaseGuardDeployment:{environment,address,codeHash}` and SHA-256 evidence identifiers for `selection`, `screening`, `policySkills`, `database`. Evidence identifiers are references to independently reviewed server artifacts, not permission flags. The current repository has no such production composition. A release cannot be enabled by a request or deployment environment flag.

The remaining production adapters must supply the existing core dependency signatures documented in `interface.md`: original fixed-source signed Seaport listings, actual supported collection runtime/security screening, shared deterministic policy plus equipped-skill/capability and budget evaluation, and a genuinely reviewed deployed guard. The observational market reader omits original signatures and cannot fill this role. Local proof callbacks are explicitly disposable test fixtures. They must not be copied into production. The generic runtime seam cannot establish the truth of a server callback's attestation; release review must verify its actual composition.
