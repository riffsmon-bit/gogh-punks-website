# Rarity-based starting slots — approved rules and verified snapshot

User approved locking in the proposed rules while requesting a rarity snapshot from the Gogh Punks OpenSea collection. The rules are recorded in `slot-policy.mjs`; the disposable UI fixture uses 1 base / 7 maximum slots. A complete verified 4,295-Punk snapshot is now saved; see [snapshot status](v2-rarity-snapshot-status.md). No production rights have been awarded. On-chain application still requires a reviewed additive migration.

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

OpenSea's [Get NFT API](https://docs.opensea.io/reference/get_nft) documents NFT rarity data. Authenticated single-NFT and batch-by-ID reads have now succeeded for Gogh; the complete frozen baseline is verified against canonical token existence. Documentation alone was not used as proof of availability.

Before assigning permanent slots, obtain and review a complete, collection/chain-bound rarity snapshot. Record collection contract, chain, token ID, rank, method/version, full baseline population, ties, snapshot date/block, metadata fingerprints and content hash. Publish reproducible evidence and anchor the reviewed allocation (for example a Merkle root) if incorporated into production contracts. A marketplace response alone cannot confer economic permissions.

- Freeze the allocation once approved. Do not continually rerank and change capacity.
- Burning another Punk must not change everyone else's denominator or slots.
- Metadata updates, API downtime, collection setting changes and sale/transfer must not erase earned capacity.
- Missing rarity is UNKNOWN, never rank zero or automatically rare. Decide missing-data treatment before rollout; never strip earned slots later.
- Explicit tie handling and full denominator required; do not infer percentiles from three samples.
- No price/floor/value claim: rarity is a trait-distribution measure, not an investment-return metric.
- Rarity unlocks capacity only, not learned skills, paid execution, relaxed security or spend authority.
- Apply only through a reviewed additive contract/migration. Current immutable base/cap progression needs a deliberate design change; do not silently reinterpret already-learned versions.

## Snapshot captured

The snapshot contains all 4,295 circulating token IDs with OpenSea ranks, per-record metadata fingerprints, retrieval timestamps, start/end canonical blocks, approved slot allocations and payload hash `8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de`. Allocation totals: 214 Punks start with three slots, 859 with two, and 3,222 with one. #93 ranks 1,295 and starts with one. All can train up to seven. See [the verification checkpoint](v2-rarity-snapshot-status.md). The owner-provided key remains in macOS Keychain; Netlify protection was not changed.
