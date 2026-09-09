# OpenSea rarity snapshot retrieval checkpoint

Requested collection: https://opensea.io/collection/gogh-punks-255843210/overview

Status: **BLOCKED — per-token ranks unavailable without API authentication. No finalized rarity snapshot.**

Checks performed September 8 Detroit / September 9 UTC:

- Public collection metadata GET: HTTP 200.
- Returned collection slug: `gogh-punks-255843210`.
- Returned contract: `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`, chain `robinhood`.
- Circulating/unique item count: 4,295.
- Rarity: strategy `openrarity`, version `1.0`, max rank 4,295, rarity population 4,295.
- Reported calculation time: `2026-09-09T03:07:01.882077` (provider value; no timezone inferred).
- Single NFT #93 endpoint: HTTP 401 without credentials.
- Paginated NFT collection endpoint with limit 200: HTTP 401 without credentials.
- No OpenSea key in the current shell or project `.env`.
- The project's existing Netlify variable was queried read-only using the existing local Netlify session. `OPENSEA_API_KEY` exists and is marked secret; values were not readable for its configured contexts. No secret was displayed, persisted, altered, or extracted by deploying code. No account/environment settings changed.

The collection-level rarity configuration proves that OpenSea reports a ranking population, not the ranks themselves. It must not be substituted for 4,295 individually verified rank records. No user was awarded a rarity bonus; the three-token native sample ranking was NOT used as OpenSea rarity.

## Next authorized step

Use an owner-provided existing API key through a local secret store/environment (never chat or git), or a complete provenance-bearing OpenSea export. Fetch all pages, validate token IDs/contract/chain, reject duplicates/missing ranks, reconcile the token set against on-chain existence at a pinned block, and verify the collection calculation fingerprint did not change during retrieval. If list responses omit rarity, use the documented individual-NFT endpoint within the allowed rate limit. Stop on 401/403/429 rather than bypassing access controls.

Freeze a complete normalized allocation with source fingerprints, token/rank/population records, timestamps, tie rules and content hash only after these checks pass. Production anchoring/slot migration requires the separately reviewed implementation; this retrieval does not authorize production transactions.

Approved product rules: [rarity slots](v2-rarity-slot-proposal.md), seven maximum equipped skills, one sacrifice = one credit = one slot OR one approved Tier-I skill; no rare-burn multiplier.
