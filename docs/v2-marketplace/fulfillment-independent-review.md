# Independent staged fulfillment adapter review

Status: **PASS for the inspected staged adapter boundary, with activation gates remaining**. No blocking defect was found in the bounded code path reviewed here. This is an offline source and adversarial-fixture review; it does not approve public fulfillment lookups, establish live provider compatibility, or authorize purchasing.

Reviewed implementation: `broker/src/v4/marketplace/opensea-fulfillment-listings.mjs`, author commit `c7f8094`, SHA-256 `6af2318aba8af78847a0d6f8745178693ae48fd54441ca7101a1b42d14db271b`. The reviewer did not modify the adapter or its existing tests. The separate core integration in commit `fa6d1d9` was read to confirm that `loadListings` receives the Agent wallet resolved through pinned registry/account reads, after owner/token/wallet checks. That core's explicit `ccipRead: false` remains present on contract reads and the exact transaction simulation.

## Reviewed contract

`createOpenSeaFulfillmentListingReader({apiKey, fetchImpl?, now?, timeoutMs?, callTimeoutMs?})` returns `loadListings({collection, orderHashes, anchor, wallet})`.

The reader validates an exact argument shape with one to five unique hashes, a noncontrolling collection, anchor and lowercase nonzero wallet. It snapshots these values before waiting on transport. It cannot prove the wallet is an Agent by address shape alone; the server core must supply the verified address, never a client-selected fulfiller. Transport, credential and clock are trusted server dependencies.

The sole GET route is the fixed OpenSea origin, Robinhood chain and pinned Seaport exact-order endpoint. Every original in a selected batch must pass before any POST. The only POST route is fixed `/api/v2/listings/fulfillment_data`; its body binds the original hash/protocol/chain and the verified Agent as fulfiller and recipient. This is a staged signature-data retrieval capability. Its provenance explicitly states that signature vending may occur; it has no wallet request, signer, RPC transport, approval, order-creation or broadcast operation.

## Findings and evidence

| Boundary | Independent evidence | Result |
| --- | --- | --- |
| Exact original identity | An invalid original counter anywhere in a selected batch prevents every POST. GET order components are hashed with their counter and compared with the selected hash. | PASS |
| Required fees | Fixtures preserve three original native consideration recipients and exact totals above JavaScript's safe integer range. Coordinated redistribution, removal and recipient changes across both returned order and call are rejected. | PASS |
| Signed order binding | Changed seller, NFT and exact counter are rejected even when copied consistently into all returned call descriptions. Unsafe numeric counter rounding is rejected. An observed GET signature cannot be replaced in the returned order/call. | PASS |
| Execution description | Fixed Seaport target, chain, amount, supported function and structured call are checked by the implementation. Independent probes reject raw calldata beside/in place of structured input, recipient substitution, criteria injection and function-signature extension. | PASS |
| Canonical call and suffix | A separate reconstruction with the existing core normalizer/ABI matches the returned provenance data hash. The optional four-byte suffix is excluded from those bytes; a longer suffix is rejected. No API transaction is returned for execution. | PASS |
| Request immutability | Mutating the caller's wallet, collection, order hashes and anchor after GET begins cannot redirect the POST or change returned evidence. Accessors and sparse input arrays fail before IO. | PASS |
| SSRF and retries | Both stages reject redirects, changed final URLs and rate limits without alternate requests or retry. Arbitrary endpoint fields/path-injection hashes fail before IO. Fixed request options omit credentials/referrer and reject redirects. | PASS |
| Resource limits and late completion | Oversized streamed POST bodies are cancelled. A timed-out POST that later resolves has its body cancelled and cannot return a listing or initiate another request. Expiry is checked again after vending. | PASS |
| Evidence honesty | Output is frozen, carries exact request/response digests, records observed latest provider state, and leaves signature executability to pinned Seaport simulation. It contains no transaction for caller execution. | PASS |

The source limits each call to at most five GETs and five POSTs, no retries, 65,536 streamed bytes per response, four seconds per request and eight seconds for both stages together. It uses no CCIP or arbitrary URL fetch mechanism. The independent suite covers transport failure/cancellation paths; the author's additional suite covers the broader malformed shape, deadline, clock and pre-vending cases.

## Repeatable verification

```sh
node --test tests/opensea-fulfillment-independent-review.test.mjs
```

**23/23 PASS** against the exact source above. The test imports the adapter with a repository-relative path and uses independently constructed full-open fixtures, exact large counters/prices/token IDs, and a deliberately synthetic 64-byte signature. Every fetch is injected and returns local data. No live OpenSea request, fulfillment POST, RPC call, wallet request, order creation or public transaction occurred.

The author reports **113/113 PASS** for its fulfillment and GET compatibility suites. Those counts are separate from the 23 independently executed cases here. The test can run after the source commit is integrated; it adds no runtime dependency beyond the repository's existing `viem` and Node test runner.

## Remaining gates and practical limits

- A well-shaped signature is not a cryptographic proof of seller authorization or executability. The synthetic signature intentionally supplies no such proof. Pinned Seaport order hash/counter/status/owner checks and exact transaction simulation remain mandatory.
- The API response is observed latest data, not evidence anchored by the provider to a specific block. The core's anchored chain reads, final anchor check, ownership checks and short review expiry remain necessary.
- The address-shape check cannot establish that OpenSea will accept the canonical Agent contract as a fulfiller. A supported live response and provider account eligibility remain unproven. No live canary was attempted in this review.
- Restricted/partial orders, signed zones, nonzero fulfiller conduits, criteria and alternate/basic/batch execution functions deliberately fail closed. Broader OpenSea compatibility is not established by this bounded adapter.
- The optional attribution suffix is recorded as metadata and never appended to the core's call. This review verifies the omission and fixed-byte boundary; it does not independently establish provider analytics behavior.
- Public source installation, production guard/release approval, collection safety, skills/policy, integer budgets/reserves and the durable one-claim wallet path remain separate gates. Passing this review creates none of those authorities.

Only `tests/opensea-fulfillment-independent-review.test.mjs` and this review document are owned by the review change.
