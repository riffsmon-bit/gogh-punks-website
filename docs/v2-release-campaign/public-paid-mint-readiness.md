# Public owner-confirmed paid mints — 2026-09-22

Status: IMPLEMENTED / LOCAL TESTING. The release artifact remains TESTING with `publicOwnerMint.enabled=false`. This document does not assert a production release or a completed live mint.

## What is implemented

Any current Gogh Punk holder can inspect an exact Robinhood Chain NFT collection contract and prepare one owner-confirmed paid mint into that Punk's activated Agent wallet. Acceptance requires the collection's **exact** runtime hash to equal the already reviewed SeaDrop Studio hash. Arbitrary calldata, proxy implementations, websites, fee recipients, and quantities are not accepted.

The fixed call is owner wallet → selected Agent account `execute` → pinned SeaDrop `mintPublic`. The connected owner pays the exact mint price (maximum 0.001 ETH) and network gas. The new path has no worker fee, custody escrow, refund step, persistent approval, session grant, or unattended spending permission. Existing Punk operating balance is not required: the exact price is supplied as `msg.value` and forwarded immediately. Every mint requires its own wallet confirmation.

A fresh collection check validates runtime, current owner, canonical Agent account/footer/implementation, active public sale, positive exact price, supply, per-wallet mint limit, and the fixed OpenSea fee recipient. Preparation proves receipt-state archive access and simulates on both chain providers. A final owner/account/price refresh follows simulation before a durable claim. Browser checks independently reconstruct the calldata and validate wallet/chain, code hashes, account, price, nonce, balance and simulation.

A new, immutable request journal reserves one unresolved request **per owner across Punks**. It survives refresh and lost wallet responses. A wrong pasted transaction hash cannot bind the journal. Binding requires the exact reviewed transaction and receipt on both providers. Finalized receipt confirmation verifies one mint Transfer, correct collection/recipient, canonical block/log metadata, runtime hashes, and receipt-block NFT custody. Unknown wallet requests are never retried as new sends just because the review expired.

## What this does not release

This is **Review & mint now**, not a public unattended paid mission. The original selected #93 delayed worker canary and its refund/cancellation history remain unchanged. Its immutable escrow checks current ownership without an ownership epoch; a pre-signed action can revive after an away-and-back transfer within its short deadline. The new public path does not reuse or broaden that delegated authority.

No Paid Mint License skill is granted, and no autonomous paid capability is activated. No contracts are deployed or changed. No public NFT has been minted by these tests. An unactivated Agent account first needs the existing wallet activation flow.

## Current live collection observation

`public-paid-read-only-20260922.json` contains two-provider read-only evidence:

- Punk #93: current owner and exact Agent runtime verified. Peppies World public sale **ENDED**, last mint price 0.0001 ETH, supply 1,786 / 2,222, #93 Agent minted 0 / wallet limit 50. No payment action should appear for this sale.
- Punk #94: same current owner verified; its Agent account is not activated.
- Public transactions sent: **0**.

The holder may inspect a different exact collection address. It proceeds only when its bytecode exactly matches the reviewed Studio runtime and its public sale passes the other checks. There is no claim that arbitrary collections or mint URLs are supported.

## Integration contract

- API: `/api/v2/punks/:tokenId/public-paid-mint`, GET/POST, authenticated session owner, same-origin writes.
- UI: `createPublicDirectedPaidPanel({root,getSelection,ensureSession,request,getProvider,autoLoad=false})`; result has `selectionChanged`, `openDraft`, `destroy`.
- Chat: `PUBLIC_PAID_MINT_REVIEW` with `paidDraft:{collection,quantity:1,maximumPriceWei}` means inspect first, never a spending authorization.
- Release: `publicOwnerMint` inside the existing server/browser directed-paid artifact. Root must enable only after integration, independent review and SQL proof/application.
- No new secret variables. Uses existing restricted Forge request database URL, two read providers, and configured history providers.
- No shared paid worker changes needed.

## Database

`database/supabase/migrations/20260922060000_public_directed_paid_reviews.sql` belongs to the existing **restricted Supabase Forge database**, not Netlify's application migration directory. It is additive and does not mutate legacy records.

`broker_public_paid_reviews` has immutable review text/hash and identity, monotonic revisions, validated lifecycle, original verified transaction hash, one global owner pending hold, unique reconciled transaction hash and indexed history. RLS is enabled and forced. Each store query sets transaction-local authenticated owner context. Only `forge_request` has the minimal SELECT/INSERT/revision-state UPDATE rights. Worker and public roles have no grants.

`broker_public_paid_pending_for_token(text)` is a narrowly scoped count-only SECURITY DEFINER function for burn safety, counting unresolved reviews across **all** past/current owners. No review body or address is returned. Its installer must already be a reviewed BYPASSRLS administrator; the migration creates no elevated role. Invalid/NULL token IDs fail closed. Source safety must count both PREPARED and WALLET_REQUESTED, including prior owners.

## Local validation

- Targeted public/legacy JS suites: 72 passed, 0 failed (`/private/tmp/gogh-public-paid-unit.log`). Final focused public regression after receipt/hash/origin hardening: 17 passed, 0 failed (`/private/tmp/gogh-public-paid-final-unit.log`).
- Native disposable PostgreSQL: 37 assertions passed, 0 production writes (`/private/tmp/gogh-public-paid-native.log`). Includes owner RLS, cross-owner obligation count, global owner pending hold, exact immutable hash, malformed JSON rejection, and no worker access.
- Chrome mock-wallet journey at 1440 / 375 / 320: passed; exactly one wallet send, failed read then reload recovery, zero page exceptions (`/private/tmp/gogh-public-paid-screens-3Xola8/result.json`). Browser API and wallet were local mocks; this is not a live wallet acceptance.
- Actual Agent contract owner-call integration: 4 passed, 0 failed (`/private/tmp/gogh-public-paid-contract.log`). Proves exact owner payment/delivery, price-change revert preserving reserve, old-owner rejection/new-owner authority, and no worker permission. SeaDrop/NFT are local mocks.

## Cost limits

No automatic per-Punk polling, scheduled worker, background LLM loop, or cloud deployment was added. Inspection runs only on explicit holder action. Each prepared mint uses bounded two-provider checks, capped gas/price, rate-limited API and bounded 25-record history. New public endpoints have a 20 requests/minute per-IP platform limit.

## Release gates

1. Integrate public panel/chat route and existing Agent activation navigation.
2. Independently review the exact public execution scope and release artifact.
3. Apply the reviewed additive migration to the restricted Supabase database; prove request-role/RLS/count-only permissions there.
4. Verify deployed function packaging and authenticated same-origin behavior in one controlled preview.
5. Enable the public owner-confirmed artifact, deploy, and verify served files/API.
6. Holder selects a currently open supported collection and confirms one live mint in their own wallet. Verify finalized NFT delivery; never label a local/mock proof as LIVE-TESTED.
