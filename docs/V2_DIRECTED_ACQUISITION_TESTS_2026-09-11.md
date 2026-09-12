# Directed mint and marketplace acceptance

The owner requested directed mints, NFT floor sweeps and WETH offers against
user-selected collections. No collection is hardcoded in the product. The first
requested live test target is [Lilbeet](https://opensea.io/collection/lilbeet).

## Verified target

Lilbeet's collection contract is `0xd1cda9e06764161772bc7840a1af6a0140557824`
on Robinhood Chain, 4663. At block **60,769,335**, two independent RPC providers
returned the same block hash, collection code hash, name and mint state:

- Total minted / max supply: **6,337 / 6,337**.
- Public SeaDrop price: zero; the public mint window has ended.
- Public wallet mint limit: one.
- The mint is sold out. It must never fall back to a different collection or a
  paid listing when the owner requested a directed mint.

The observation is saved in
[`review/2026-09-11/completion/lilbeet-read-only.json`](review/2026-09-11/completion/lilbeet-read-only.json).
[OpenSea's mint overview](https://opensea.io/collection/lilbeet/overview) also
reports sold out and ended stages. Its collection page exposes floor purchase and
collection offer controls; these do not establish broker support or a fresh
executable quote. Prices on cached pages varied, so no spending limit was inferred.
No wallet transaction was submitted. The user supplied a link, not a signed order
or an exact count, spend limit or duration.

## Code findings and corrected behavior

Before this change, each of these could open a generic FREE_ONLY strategy with
an empty allowed-contract list:

```
Mint 1 free NFT only from 0x4444444444444444444444444444444444444444. Use Assist mode.
Sweep 2 NFTs from https://opensea.io/collection/lilbeet up to 0.002 ETH total. Use Assist mode.
Make a 0.001 WETH collection offer on https://opensea.io/collection/lilbeet for 1 NFT for 24 hours. Use Assist mode.
```

The latter amounts are test inputs, not owner-authorized budgets.

Directed mint chat now binds one exact user-supplied collection address or mainnet
explorer link. OpenSea links resolve only through one unambiguous server-indexed
collection identity. An unknown/ambiguous link asks for its collection contract;
private, spoofed, testnet and multiple targets cannot create a broader mission.
This identifies the requested target only. Live code screening, availability,
balance, gas, simulation and policy checks remain required at execution.

The target is part of the persisted and owner-signed intent hash. Existing gas and
reserve limits remain in place when omitted; new strategies use existing defaults.
The executor rejects other collections before reserving/building a transaction.
The Agent Account setup already maps a single allowed contract to the on-chain
session's `targetCollection` check.

Paid mint, floor purchase and collection-offer commands now return no mint draft.
They cannot activate unrelated free-mint rules. Existing OpenSea connector
`execute` is still a revalidation step with `executionReady: false`; it is not a
deployed paid-mint submission path.

## Test status and remaining implementation

| Flow | Local evidence | Live acceptance / missing work |
| --- | --- | --- |
| Directed free mint | Chat → SQL draft → owner signature → active collection restriction; another collection rejected by executor; gas/reserve preserved | Use an open supported SeaDrop collection. Lilbeet provides closed-mint rejection evidence, not a successful mint |
| Directed paid mint | Existing policy/resolution/simulation component tests; unsupported V2 command produces no free-mint draft | Connect reviewed paid-price preparation, receipt tracking and owner submission |
| Floor buy/sweep | Existing Seaport research/indexing tests; request cannot become a mint strategy | Build listing quote, bounded purchase preparation, wallet execution and canonical receipt flow |
| WETH collection offer | Existing wrap/unwrap tests; request cannot become a mint strategy | Build exact collection criteria/order review, finite allowance, publication, cancellation/expiry and fill reconciliation |
| Burn → other Punk's skill | Updated owner decision and prepared source/recipient warning component | Original-token burn source, bound skill/credit transaction, public review and receipt integration |

The PGlite regression tests use the real SQL migrations and disposable signatures;
their collection state is synthetic. The full browser fixture exercises real chat
routing and modal behavior with local RPC responses. Neither is a live mint.

## Marketplace implementation requirements

Floor quotes must bind chain, selected collection, exact orders/token IDs, recipient,
NFT count, fee-inclusive total price and expiration. Gas is estimated automatically
under the owner's saved cap and reserve. Stale, sold or changed listings require a
new review; partial fills and retries must not exceed the approved aggregate spend
or quantity. Only canonical receipts make holdings appear as owned.

WETH offers need an explicit price per item, maximum quantity/aggregate commitment,
expiration and recipient. Wrapping ETH is separate from authorizing or posting an
offer. Finite allowances, cancellation, partial fills, expiry, owner transfers,
burns and replenished WETH balances must all be covered. A published offer is an
open order, not an NFT acquisition.

Both current account implementations reject generic ERC-1271 signatures. Do not
enable arbitrary contract-wallet signatures to make Seaport offers appear ready.
Choose and review a compatible account/order authorization path before production
execution. The [Seaport order model](https://docs.opensea.io/docs/seaport-models)
describes signed and on-chain validated orders; the
[Seaport interface](https://docs.opensea.io/docs/seaport-interface) describes
multi-order fulfillment. These are protocol primitives, not existing broker flows.

## Owner test commands

For a free directed mint, replace the placeholder with an open Robinhood collection:

```
Mint one free NFT only from <collection contract>. Use Assist mode. Keep my existing gas cap and reserve. Show the collection and exact plan before I approve.
```

The review must show that exact collection, quantity one and the retained gas and
reserve values. Strategy activation alone is not a mint receipt. Floor and offer
commands currently return an unavailable message; they are not live trading tests.
