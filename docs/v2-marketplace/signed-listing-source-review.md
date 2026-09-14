# Fixed OpenSea signed-listing source review

Status: the bounded GET adapter is implemented and tested. Live read-only probes authenticated successfully, but both observed original-order responses omitted executable signatures. No eligible signed native-ETH original was obtained, no ready purchase review was demonstrated from the public source, and production release remains blocked. This observation does not establish that every OpenSea GET response omits signatures.

## Interface and authority

`broker/src/v4/marketplace/opensea-signed-listings.mjs` exports `createOpenSeaSignedListingReader({ apiKey, fetchImpl = fetch, now = Date.now, timeoutMs = 8000, callTimeoutMs = 4000 })`, `OPENSEA_SIGNED_LISTING_LIMITS` and `OpenSeaSignedListingError`. The constructor is server-owned. It returns `{ loadListings }`, matching the existing [marketplace dependency interface](interface.md):

```js
const { loadListings } = createOpenSeaSignedListingReader({ apiKey: serverCredential });
const originals = await loadListings({
  collection: verifiedCollectionAddress,
  orderHashes: exactOwnerSelectedHashes,
  anchor: { number: canonicalBlockNumberString, hash: canonicalBlockHash, timestamp: canonicalTimestampString },
});
```

The request record accepts those keys and the optional server wallet described below. It cannot supply a transport, credential, chain, RPC, URL, protocol, listing record, signature, review, fulfillment callback or calldata. Owner authentication and selection authorization remain responsibilities of the existing server coordinator. The source never discovers or chooses orders for an owner.

The extended core dependency may also supply its already resolved `wallet`. The GET reader accepts this optional field only as a lowercase nonzero address and ignores it; legacy three-field calls remain valid. Browser requests still cannot supply wallet authority. The separate [staged fulfillment reader](fulfillment-listing-source-review.md) requires this server-derived wallet because its signature retrieval body binds the actual Agent caller and recipient.

Each selected hash uses precisely `GET https://api.opensea.io/api/v2/orders/chain/robinhood/protocol/0x0000000000000068f116a894984e2db1123eb395/{order_hash}`. This is OpenSea's documented single-order lookup; the response's `order` wrapper agrees with the official SDK. Robinhood and Seaport 1.6 come from the repository's existing pins. [OpenSea order API](https://docs.opensea.io/reference/get_order), [official SDK order reader](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/src/api/orders.ts), [Seaport deployment addresses](https://github.com/ProjectOpenSea/seaport#deployments).

At most five unique hashes are requested concurrently, once each. There are no retries, pagination, collection discovery, RPC calls or POSTs. Each response is limited to 65,536 streamed bytes; calls have a four-second deadline and the whole lookup an eight-second deadline. Injected test deadlines may only be shorter. Redirect following, cookies and referrer transmission are disabled. The final URL must equal the fixed endpoint. JSON MIME, valid UTF-8 and the original-order envelope are mandatory. Declared and actual oversized bodies fail; abandoned streams are cancelled. Errors expose fixed codes without provider bodies, transport messages or credentials.

## Accepted original records

Acceptance requires the selected order hash, chain and protocol to match; ACTIVE status; original signature bytes; and an original canonical decimal-string uint256 counter. Numeric counters fail closed rather than risking JSON integer precision loss. The adapter passes the response through `normalizeNativeListing`, then independently hashes all normalized `OrderComponents` fields plus that counter and compares the result with the selected hash. Provider changes to the seller, salt, counter, assets, consideration or other order fields cannot preserve a mismatching claimed hash.

The existing normalizer requires a full-open, quantity-one, fixed-price ERC721 listing with zero zone/zoneHash, one exact selected collection/token, native ETH consideration only, matching exact total and remaining quantity, and expiry more than 60 seconds after both the anchor and observed server time. It limits consideration to 16 entries and accepts only the supported 64/65-byte signature shapes. The Seaport model distinguishes order components, signatures and restricted zones; presence of shaped signature bytes alone does not prove validity. [OpenSea Seaport models](https://docs.opensea.io/docs/seaport-models).

Returned records preserve the provider's original signature, counter, parameters, asset and price values needed by the normalizer. No missing field is filled from a fixture, observed floor, or guessed price. Unknown provider fields are discarded. The results and nested records are frozen. Distinct orders for the same NFT reject the entire selection; any failed lookup rejects the entire batch.

Each record adds `sourceProvenance` with schema `GOGH_OPENSEA_SIGNED_LISTING_SOURCE_V1`, source `OPENSEA_ORDER_BY_HASH`, exact endpoint/hash, chain 4663, observation time, response SHA-256 and the supplied anchor. It explicitly reports `OBSERVED_LATEST_NOT_BLOCK_PINNED`, `REQUIRES_PINNED_SEAPORT_SIMULATION`, `executionAuthority:'NONE'` and `collectionFloorVerified:false`. The supplied anchor is context, not a claim that OpenSea served historical data. Core preparation still verifies pinned chain code, seller/current NFT owner, Seaport counter/status/hash and signature execution through its exact pinned simulation. This adapter supplies neither collection safety nor policy/skill authorization.

## Observed live evidence

On 2026-09-13, the existing project OpenSea credential was read into process memory from its configured local credential store. No credential, authorization header, raw signed payload or private key was written to an artifact or printed. Diagnostic discovery used fixed read-only collection endpoints; the implemented adapter itself has no discovery path.

| Exact order hash | Asset | Native/order eligibility | Observed exact GET |
| --- | --- | --- | --- |
| `0x7f49ca4095c0f998246ca55f95944b2b1fda2be9edf9fa5c0efa70c53e289d3c` | PEPPies contract `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`, token 727 | USDG 3,000,000 at 6 decimals; orderType 0; unsupported currency | HTTP 200; Robinhood/canonical Seaport; ACTIVE; counter string `0`; signature `null` |
| `0x4192c75ef0ff95f5aaf6c3d4f3b278574203bfff444a21366627152be9f38ee6` | Gogh contract `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`, token 3513 | ETH 1,089,800,000,000,000 wei; orderType 2; restricted and controlling collection | HTTP 200; Robinhood/canonical Seaport; ACTIVE; counter string `0`; signature `null` |

These exact GET facts were reconfirmed at 23:45:05.980 and 23:45:06.080 UTC. Both responses had original `asset`, `price`, `remaining_quantity`, parameter counter and consideration-count fields. Their absent signatures are a real blocker, not a transport authentication failure. The actual new adapter was also invoked against the native order at 23:35:24 UTC and rejected with `OPENSEA_SIGNED_SIGNATURE_UNAVAILABLE`. That diagnostic used an explicitly noncanonical zero-height/hash anchor with wall-clock time; it was a source transport check, not a chain review, owner selection, safety check or purchase permission. No RPC, fulfillment POST, order creation or public transaction occurred.

## Separate fulfillment lookup, staged only

OpenSea documents `POST https://api.opensea.io/api/v2/listings/fulfillment_data` to retrieve fulfillment information including signatures. The separate staged fulfillment reader constructs this exact body after validating every original in the quantity-one selection:

```json
{
  "listing": {
    "hash": "EXACT_SELECTED_HASH",
    "chain": "robinhood",
    "protocol_address": "0x0000000000000068f116a894984e2db1123eb395"
  },
  "fulfiller": { "address": "SERVER_DERIVED_CANONICAL_AGENT" },
  "recipient": "SERVER_DERIVED_CANONICAL_AGENT",
  "units_to_fill": 1,
  "include_optional_creator_fees": false
}
```

The optional `consideration` object uses `asset_contract_address` and `token_id`; exact ordinary listings do not require this field. The response schema requires `fulfillment_data.orders[]` with `parameters` and `signature`, plus `transaction` containing `chain`, `function`, `input_data`, `to`, `value` and optional `value_hex`/`calldata_suffix`. Its function union includes several distinct Seaport operations. [OpenSea fulfillment API and OpenAPI schema](https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2).

This documented operation retrieves data; it is separate from listing creation and transaction broadcasting. However, signature vending should not be described as universally free of offchain effects: OpenSea states that SignedZone cancellation is assured only if a fulfillment signature was not already vended. No fulfillment POST was called in this work. [OpenSea cancellation semantics](https://docs.opensea.io/reference/cancel_order).

The canonical Agent must be both fulfiller and recipient because it is the actual Seaport caller inside the owner-authorized account batch. The external owner signer is not the inner fulfiller. The core's reviewed interface extension now passes the server-resolved `wallet` after verifying the Agent binding (root integration `fa6d1d9`). The [staged fulfillment adapter review](fulfillment-listing-source-review.md) describes its validation and remaining live-canary limitations.

The staged implementation extracts and validates the signed original, independently recomputes the selected full order hash with counter, binds all asset/fee/currency/amount/expiry/zone/conduit fields, and leaves pinned on-chain checks to core preparation. Generated API transaction fields are untrusted evidence, never wallet instructions. The supported call is only `fulfillAdvancedOrder` with selector `0xe7acab24`, numerator/denominator 1/1, empty criteria resolvers, empty extraData, zero fulfiller conduit, exact Agent recipient, canonical Seaport target, chain 4663 and exact native consideration value. It is independently encoded/decoded and compared with the fixed call; alternate functions, extra calls, fee changes, approvals, token swaps and restricted-zone data are rejected. Exactly four-byte attribution metadata may be recorded, but is never appended to the execution bytes. Returning a signature for orderType 2 would not make that restricted sample eligible under today's core.

## Validation and remaining boundaries

`node --test tests/marketplace-opensea-signed-listings.test.mjs` passed 35 tests: fixed source/provenance, lossless large amounts, maximum selection, request SSRF/authority injection, exact hash and complete component binding, wrong chain/protocol/asset/price, missing/null/malformed signature/counter, duplicate hashes/NFTs, inactive/expired/partial/restricted orders, redirect/final-URL rejection, sanitized HTTP/transport errors, no retries, declared/streamed oversize, stalled fetch/body/whole-request deadlines, late body cancellation, invalid MIME/UTF-8/JSON, and clock/configuration bounds.

Fixture signatures are explicitly offline bytes; these tests prove source validation and transport boundaries, not live Seaport signature validity. The live signed-original positive case remains unproven. No coordinator, core reviewer, reconciler, runtime, release manifest, database, site, wallet flow or shared schema was changed for this source adapter. Integration may supply its `loadListings` function only when the other reviewed release dependencies exist. Missing signatures remain a hard failure; they do not authorize a synthetic record or production ALLOW result.
