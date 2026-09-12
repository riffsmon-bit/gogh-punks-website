# Forge supply floor: 1,111

User requested a burn cap with desired remaining Gogh Punks supply of **1,111**. Interpret this as a minimum circulating supply for Forge sacrifices, not authorization to burn any real NFT or a mandate to automatically reduce supply.

## Rule

Before each single-Punk sacrifice, read canonical collection `totalSupply()` in the transaction. Require `totalSupply > 1111`. After the burn, require supply is exactly the prior supply minus one and is still at least 1111. Both checks and credit issuance must occur in the same atomic, non-reentrant transaction; any failure must roll back the burn and credit.

- At 1,112: one otherwise eligible sacrifice is permitted by the supply rule.
- At 1,111 or less: no Forge sacrifices permitted.
- Failed/malformed supply reads: fail closed.
- UI estimates, historical minted count, cached counters and off-chain reservations cannot substitute for current supply.
- Separate ownership, empty-wallet, unresolved-job, simulation and production-authorization requirements remain mandatory.
- No admin bypass or reduced-floor setter is present in this policy.

## Implemented, not deployed

`contracts/src/GoghForgeSupplyPolicy.sol` is a small library providing pre/post checks for a **future separately reviewed training source**. It does not implement burning, issue credits or modify the existing collection. It is exercised by a local test harness using a mock supply contract. The existing tiny mock progression demo is not a production-sized burn economy and is not represented as enforcing the 1,111 floor. No production training source is approved or deployed.

`broker/src/v4/skill-forge/supply-floor.mjs` provides an advisory check pinned to chain 4663 and the Gogh collection. The burn preflight now requires fresh supply evidence at the same block/time as ownership and wallet checks. It still always returns `canBurn=false` because production burns remain locked. UI displays the intended floor, not a made-up live supply or burn allowance.

## Scope limitation: direct burns

The collection already exposes owner/approved-operator burning, as documented in the [burn audit](v2-skill-forge-burn-audit.md). A new Forge contract cannot prevent owners calling that existing method directly. Therefore **this is a Forge supply floor, not a global guarantee that only or at least 1,111 Punks will exist forever**. Existing mint paths, if any remain available, are also outside this new guard. Do not market a globally enforced final supply without a separate contract-level feasibility review and authorization. No collection upgrade, replacement or wrapper was authorized here.

## Read-only supply observation

At `2026-09-09T03:05:33.088Z` (September 8 Detroit), PublicNode returned:

- Collection: `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`
- Chain: 4663
- Block: `58212032`
- Block hash: `0x4133a082c9b9a408586e7430b7df56dfa215041b60f7f1d56978931afad29cde`
- Circulating total supply: **4,295**
- Arithmetic headroom above 1,111: **3,184**

Headroom is a dated observation, not an allocation, asset-safety clearance or authorization to burn 3,184 Punks. Re-read supply atomically for any future transaction; direct burns reduce available headroom.

## Tests

Solidity coverage: last permitted burn/next denial; zero or multiple burns rolling back; exact-one requirement above the floor; intervening external burn consuming headroom; unavailable supply; explicit demonstration that direct burns bypass a Forge-only guard.

JavaScript coverage: 1,112/1,111/below boundaries, malformed/missing/stale/future-dated supply, wrong collection/chain, cross-block preflight mismatch and absence of burn authority even above the floor.
