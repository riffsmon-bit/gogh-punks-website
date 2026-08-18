# Curator Reputation and Leaderboards

Curator reputation belongs to the chain-qualified Punk identity and is reconstructed from confirmed acquisitions and decision logs. It is descriptive, not a financial promise.

## Stored metrics

- unique NFTs, artists, and collections;
- owner-approved and autonomous acquisition counts;
- capital deployed, kept separate by currency;
- average Art Score and Taste Match;
- artist-diversity score;
- emerging-artist discoveries;
- recommendation count and conversion rate.

Estimated values must retain their currency, source, timestamp, and confidence. Values in unlike currencies are never summed without an explicit, timestamped conversion source.

## Version 1 formulas

- **Top Curator:** 30% average Taste Match, 25% average Art Score, 20% artist diversity, 15% recommendation conversion, and 10% emerging-artist discovery ratio.
- **Most Diverse Gallery:** artist-diversity score.
- **Emerging Artist Hunter:** emerging-artist discovery count, then average Taste Match.
- **Most Active Broker:** acquisition count, then recommendation count.
- **Highest Taste Match:** average Taste Match for Punks with at least one acquisition.

Every ranking uses the chain-qualified Punk key as its final deterministic tie-breaker. Formula versions must be stored with snapshots so historical rankings remain explainable.

Financial-return leaderboards are intentionally excluded from the first release. Acquisition cost and estimated value can be displayed with disclaimers, but neither drives the primary curator reputation.
