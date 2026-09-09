# Rarity-based starting slots — approved rules, snapshot pending

User approved locking in the proposed rules while requesting a rarity snapshot from the Gogh Punks OpenSea collection. The rules are now recorded in `slot-policy.mjs`; the disposable UI fixture uses 1 base / 7 maximum slots. No production rights have been awarded. Individual rarity bonuses remain pending a complete verified snapshot.

## Recommended starting point

Use rarity for **starting slots**, not a permanent ceiling that stops less-rare Punks from developing. Keep learning separate from equipment: a Punk can learn many skills while equipping at most seven under this proposal. Both Sniper mission choices are part of one equipped skill, not two slots. Owner authorizations still bound each selected mission.

Approved allocation rule, not yet applied to production tokens:

| Frozen collection rarity band | Starting slots | Maximum after training |
|---|---|---|
| Top 5% | 3 | 7 |
| Above 5%, through top 25% | 2 | 7 |
| Remaining Punks | 1 | 7 |

One sacrificed Punk creates one training credit, regardless of rarity. One credit learns one approved Tier-I skill OR unlocks one slot; it does not do both. The sacrificed Punk's own learned skills, slots and unused credits do not transfer to the survivor. Production burning remains disabled.

Rank cutoffs use exact integer comparisons: rank × 100 ≤ population × 5, then ≤ population × 25. Equal ranks receive equal allocations; tied groups can cross an exact percentage headcount. At a 4,295-token baseline these numerical cutoffs are rank 214 and 1,073. This is arithmetic only, not a claim that any specific token has those ranks. Freeze the reviewed rank/population pair rather than recalculating from later burns.

## Data and persistence requirements

OpenSea's [Get NFT API](https://docs.opensea.io/reference/get_nft) documents NFT rarity data. Its [OpenRarity help article](https://support.opensea.io/en/articles/8867099-what-is-openrarity) says enabled collection ranks can be available through its API. This does NOT establish that Gogh Punks currently has complete usable ranks. Authenticated live Gogh rarity retrieval has not succeeded yet.

Before assigning permanent slots, obtain and review a complete, collection/chain-bound rarity snapshot. Record collection contract, chain, token ID, rank, method/version, full baseline population, ties, snapshot date/block, metadata fingerprints and content hash. Publish reproducible evidence and anchor the reviewed allocation (for example a Merkle root) if incorporated into production contracts. A marketplace response alone cannot confer economic permissions.

- Freeze the allocation once approved. Do not continually rerank and change capacity.
- Burning another Punk must not change everyone else's denominator or slots.
- Metadata updates, API downtime, collection setting changes and sale/transfer must not erase earned capacity.
- Missing rarity is UNKNOWN, never rank zero or automatically rare. Decide missing-data treatment before rollout; never strip earned slots later.
- Explicit tie handling and full denominator required; do not infer percentiles from three samples.
- No price/floor/value claim: rarity is a trait-distribution measure, not an investment-return metric.
- Rarity unlocks capacity only, not learned skills, paid execution, relaxed security or spend authority.
- Apply only through a reviewed additive contract/migration. Current immutable base/cap progression needs a deliberate design change; do not silently reinterpret already-learned versions.

## Snapshot still required

OpenSea collection metadata was successfully retrieved and identifies `openrarity` version `1.0`, `max_rank=4295`, `rarity.total_supply=4295`, and matching Robinhood contract identity. Public individual-NFT and paginated-NFT endpoints returned HTTP 401 without a key. The existing Netlify OpenSea variable is secret and its values are unreadable through the API; protection was not changed. No complete per-token snapshot is saved or frozen. See [the retrieval checkpoint](v2-rarity-snapshot-status.md). A readable, authorized API key or verified complete export is still required.
