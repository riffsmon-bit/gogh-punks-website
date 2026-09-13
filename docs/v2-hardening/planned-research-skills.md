# Bounded planned research packages

Status: three functional versioned adapters have passed dedicated adversarial tests. They load as **unapproved TESTING** packages. Public registration, promotion, server release selection and holder learning/equipment remain separate. No public release manifest or accepted v1 package bytes changed.

| Package | Exact identity | Existing capabilities | Only declared tool | Demonstrated scope |
| --- | --- | --- | --- | --- |
| Floor Hunter | `floor-hunter/1`, skill 9 | MARKET_READ = 4 | `rank_observed_listings` | Exact integer price ordering within identical payment-token groups from the unchanged OpenSea v2 reader |
| Collection Researcher | `collection-researcher/1`, skill 11 | CONTRACT_READ = 1, RARITY_READ = 8 | `research_collection` | Contract evidence and declared trait presence in a caller-selected inline metadata sample |
| Art Curator | `art-curator/1`, skill 6 | ART_CLASSIFY = 64 | `classify_collection` | Deterministic exact matching of explicit metadata style labels against optional supplied preferences |

Skill 10 remains reserved for the separately proposed Paid Mint License. No new capability bits, contracts, external providers or dependencies were added. These native adapters reuse previously reviewed readers; they are not three independent upstream integrations.

## Integration

`loadResearchSkillCatalog({selection: PLANNED_RESEARCH_SELECTION})` selects these three exact versions. The default remains Contract Detective v1, Rarity Eye v1 and Market Scout v1. Each new package pins its implementation and directly used local dependency bytes. A changed dependency fails catalog loading until the new package is re-reviewed. The runtime requires exact package keys and the shared gate checks current owner, learned/equipped state, manifest/instruction hashes and registry availability before and after calls. The shared tool allowlist intersects each package's declared tools: owning a common capability bit cannot expose another package's tool.

- `createFloorHunterV1({apiKey, fetchImpl, now})` in `floor-hunter-v1.mjs` exposes `rankObservedListings({slug, contract, limit=20})`.
- `createCollectionResearcherV1({client, timeoutMs=12000})` in `collection-researcher-v1.mjs` exposes `researchCollection({contract, tokenIds})`.
- `createArtCuratorV1({client, timeoutMs=12000})` in `art-curator-v1.mjs` exposes `classifyCollection({contract, tokenIds, preferredStyles=[]})`.

The runtime tools use the same argument names. `now` on Floor Hunter returns integer milliseconds. The server owns credentials, fixed client and clocks. No new context service is required. Absent credentials remove Floor Hunter; absent client removes the metadata tools. No URL, endpoint, recipient, calldata or owner-policy fields are accepted by the runtime tools.

Metadata arguments require 1–20 unique canonical uint256 decimal strings. At most three `tokenURI` calls run together at the contract inspection block; the final block hash and chain ID are checked. A total 12-second response budget bounds delivery; the configured RPC transport still owns per-request cancellation. Inline base64 JSON is limited to 2,000,000 URI characters and 128 attributes, with trait names at most 128 characters, string values 256, display types 64 and names 160. External metadata and images are unavailable, never fetched. Viem `OffchainLookup` is disabled on the action client, including the bound-call bypass; controlled clients without `request` must explicitly declare `ccipRead:false`.

## What results mean

Floor Hunter returns `GOGH_OBSERVED_LISTING_RANKS_V1` with payment-qualified `rankedGroups`, exact decimal-string totals and premiums above that group's observed minimum. ETH and WETH stay separate. Ties sort by order hash. Multiple orders for one NFT remain multiple orders. Coverage, exclusions and stale/unsupported order handling come from the unchanged v2 reader. Even exhausted pagination never establishes a collection floor, fair value, liquidity or fulfillability. `collectionFloor` is always null and `collectionFloorVerified` is false.

Collection Researcher returns `GOGH_COLLECTION_RESEARCH_V1`, contract evidence, normalized declared traits, excluded/duplicate counts, per-trait token presence and a hash of the sampled evidence. Missing metadata remains unavailable. Interface responses and metadata can lie; none of this verifies authenticity, token existence, inventory completeness, rarity, value or security.

Art Curator returns `GOGH_DECLARED_ART_STYLE_MATCHES_V1`. A single categorical Style, Art Style or art_style declaration is normalized by case and spaces/hyphens and must match the existing Gogh style enum. Duplicate, malformed, missing and unsupported declarations remain UNKNOWN. It does not inspect images: `visualClassification` is UNAVAILABLE and `confidence` is null. Preferred styles are arguments for the current read, not confirmed owner policy. This version makes no claims about artistic quality, originality, provenance or value.

All results have `walletAuthority: NONE` and `executable: false`. They contain no signatures, transaction payloads, approvals, bids or purchases. Metadata and provider text remain untrusted evidence, never instructions.

## Remaining planned scope

Listing Watcher stays a roadmap item. A bounded listing sample cannot prove newly created/cancelled orders or support durable monitoring without owner-bound checkpoints, deduplication, pagination/reconnect semantics, freshness and notification acceptance. Scheduled Hunter, Social Scout, paid minting, portfolio coverage and allowlist proofs retain their separate missing services or economic review. This batch does not label them functional.

## Validation

`node --test tests/skill-forge-planned-research.test.mjs` exercises the actual adapters with controlled fixed RPC/OpenSea responses, exact large-integer sorting, currency separation, exclusions, partial/unavailable metadata, bounded IDs, malformed/ambiguous style declarations, reorg and timeout rejection, real viem OffchainLookup blocking, every implementation/dependency pin, exact shared-bit isolation, missing services, before/after owner/equipment gating and registration calldata round trips.

Composed copied-chain acceptance is tracked separately and does not confer public READY status.
