# OpenSea rarity snapshot — captured and verified

Requested collection: https://opensea.io/collection/gogh-punks-255843210/overview

Status: **COMPLETE — frozen local data artifact, not deployed/on-chain slot authority.**

Snapshot: [gogh-opensea-rarity-8a492f7…430de.json](../artifacts/skill-forge/rarity/gogh-opensea-rarity-8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de.json).

Payload SHA-256: `8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de`.

## Verified baseline

- **4,295** individually identified circulating Punks; no missing/duplicate IDs.
- Robinhood Chain `4663`, contract `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`.
- OpenSea `openrarity` strategy version `1.0`; population/max rank `4295`.
- Calculation timestamp `2026-09-09T03:38:13.511247` (provider value), unchanged between the capture's collection checks.
- Recorded capture window: `2026-09-09T03:41:19.781Z` through `2026-09-09T03:44:15.517Z` (September 8, 11:41–11:44 PM Detroit). Resumption preserves the first attempt's start time; each record has its own retrieval timestamp.
- Pinned start block `58234167`, hash `0x506b6d387f01ed593f9710fb4c7d8ecc539fd49c723e5ddd43df86ffb99c7c96`.
- Final block `58235011`, hash `0x499e7e4cbe403880c72f595e9d9a62a546f3d3dadabfee1518fa8bbd1520febc`.
- Canonical totalSupply and ownerOf inventory agree at the pinned blocks; every captured token still exists at the final block. Block hashes rechecked.
- Actual rank range `1–4295`, with `3111` distinct rank values. Ties are preserved.

## Frozen starting-slot allocation

| Rank band | Starting slots | Punks |
|---|---:|---:|
| 1–214 (top 5%) | 3 | 214 |
| 215–1073 (through top 25%) | 2 | 859 |
| 1074–4295 | 1 | 3,222 |

**Punk #93: rank 1,295 → one starting slot.** All Punks share the seven-slot maximum after training. Rarity is a trait rank, not a valuation or financial promise.

One sacrifice remains **one training credit**, spent on **one slot OR one approved Tier-I skill**. Burning a rarer Punk does not grant extra credits or inherit its learned progression. Later burns do not change the frozen denominator or allocation. Production burn eligibility remains fail-closed, especially for funded Punk Wallets such as #93.

## Successful retrieval

The owner supplied an existing API key through a hidden Terminal prompt into macOS Keychain. No Netlify environment values were edited, no secret exported to source/logs/browser, and no wallet signing key accessed.

Collection/owner bulk lists omitted rarity. Individual reads worked, but encountered throttling and a changing calculation timestamp; those partial captures were not frozen. The documented [NFT batch-by-identifiers API](https://docs.opensea.io/reference/get_nfts_batch) supplied detailed ranks in 30-token read-only batches. Its HTTP POST is a data query, not a transaction. The complete batch capture passed the strict same-calculation and canonical-token-set checks.

Offline verification:

```sh
node scripts/dev/skill-forge/verify-rarity-snapshot.mjs artifacts/skill-forge/rarity/gogh-opensea-rarity-8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de.json
```

Result: integrity/identity/policy checks pass; allocation counts `214 / 859 / 3222`; `onchainAuthority: false`. See [the runbook](v2-rarity-capture-runbook.md) for the hash convention and secret-safe capture procedure.

No real Punk was burned, no slots awarded on-chain, no production contract/public UI deployed, and no main branch push occurred. This is a fixed data baseline for a separately reviewed additive migration/root, not activation of the overall Skill Forge. Marketplace evidence is off-chain; the hash proves artifact integrity, not an OpenSea signature or atomic historical API state.

## Earlier access checkpoint (superseded)

Initial checks performed September 8 Detroit / September 9 UTC, before the new Keychain credential:

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

## Remaining production step

The verified normalized allocation is now frozen locally. Production anchoring/slot migration requires a separately reviewed implementation; this retrieval does not authorize production transactions.

Approved product rules: [rarity slots](v2-rarity-slot-proposal.md), seven maximum equipped skills, one sacrifice = one credit = one slot OR one approved Tier-I skill; no rare-burn multiplier.
