# Rarity-based starting slots — proposal, not an activated economy

User requested consideration of OpenSea rarity-based slot capacity with a maximum of 7–10 equipped skills. No rarity cap or allocation has been approved. Current test contracts still use 1 base / 4 maximum slots; this document changes neither contracts nor production rights.

## Recommended starting point

Use rarity for **starting slots**, not a permanent ceiling that stops less-rare Punks from developing. Keep learning separate from equipment: a Punk can learn many skills while equipping at most seven under this proposal. Both Sniper mission choices are part of one equipped skill, not two slots. Owner authorizations still bound each selected mission.

Illustrative, unapproved allocation:

| Frozen collection rarity band | Starting slots | Maximum after training |
|---|---|---|
| Top 5% | 3 | 7 |
| Above 5%, through top 25% | 2 | 7 |
| Remaining Punks | 1 | 7 |

This lets rarity provide a head start without making training pointless. Seven maintains more loadout trade-offs than ten; ten remains a product alternative. One credit per additional slot remains the proposed economy, not an executed product migration. Do not charge users based on illustrative bands.

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

## Decision still required

Approve starting-slot bands and whether the maximum is 7 or 10. Alternative: rarity-specific maximum ceilings, but this limits the training potential of common Punks; the recommended design above uses a shared cap. Nothing has been deployed or awarded using this proposal.
