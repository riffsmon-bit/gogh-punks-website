# Skill shortlist: demonstrated versus available to adapt

Checked September 8, 2026 Detroit / September 9 UTC. Source revisions, licenses and the full fourteen-candidate inventory are in [the source audit](v2-skill-source-audit.md). This shortlist does not promote any skill to production READY.

## Demonstrated by our code against Robinhood

| Proposed skill | Working capability | Evidence | Limits / authority |
|---|---|---|---|
| Contract Detective | Retrieve bytecode/hash, ERC721/ERC1155 interface responses, standard EIP-1967 implementation/beacon slots and minimal-proxy pattern evidence | Read-only probe succeeded at block 58203895, hash `0xd70f3630135942b54e2b1e676d1a00ccccf744109b0d209141c55194322a9c16`; code 18,470 bytes; evidence hash `b7a6a637578938625587a83e3aaec1edfbd784ad929fbd6711869309048ff986` | No verified-source audit or safety guarantee. Wallet authority NONE. Full skill status TESTING. |
| Rarity Eye | Retrieve inline on-chain metadata, calculate explicit sample trait frequencies and rank candidates | #93/#94/#95 retrieved at block 58203905, hash `0x52b388cdec5c831e51c41eb855f838d88f4b8127a6286626f7cb245d7fa765a3`; metadata hash `b0418987f384183b4d7e1f0ad54349520fe61b475252121574c2c0aabc1bd2e2`; all tie at 13 in the three-token sample | NOT collection-wide ranks, price estimates or the OpenRarity algorithm. Wallet authority NONE. Full skill status TESTING. |

Both paths ran successfully again at `2026-09-09T02:51:51.461Z` using `node scripts/audit-skill-forge-readonly.mjs --live-readonly`. Source: Gogh-native `research-tools.mjs`, after reviewing external contract/rarity implementations. These are two narrow working capabilities, not two complete production-ready skills. Production loadout/tool integration and acceptance remain required.

## Concrete upstream implementations worth adapting

These have inspectable implementations, not just proposed names. We have NOT demonstrated their complete authenticated workflows inside Gogh. Documentation is not an end-to-end test.

| Proposed Gogh skill | Upstream implementation | Useful capability | Current Gogh blocker |
|---|---|---|---|
| Market Scout | [OpenSea API skill](https://github.com/ProjectOpenSea/opensea-skill/tree/main/opensea-api) | Retrieve listings and collection statistics | Restricted Gogh adapter passes fixtures; usable API key and successful live Robinhood retrieval still needed. |
| Collection Researcher | Same OpenSea API skill | Retrieve collection/NFT metadata and public collection information | Separate acceptance case, identity/chain validation and live API access. Not counted as an independently tested integration. |
| Listing Watcher | Same OpenSea API skill and event interfaces | Observe new listing/event data | Durable checkpoints, deduplication, freshness/reconnect behavior and live data acceptance. No buying. |
| Social Scout | [Bankr Neynar package](https://github.com/BankrBot/skills/tree/main/neynar) | Farcaster profiles, feeds and search using Neynar tools | Read-only extraction, API credentials, license review and end-to-end tests. Does not imply X coverage; no posting/signing. |
| Contract Detective extension | [Blockscout MCP](https://github.com/blockscout/mcp-server) | ABI/source/code inspection and contract reads | Robinhood API access and custom-license review. No generic unrestricted REST tool or wallet authority. |
| Rarity Eye extension | [OpenRarity reference implementation](https://github.com/OpenRarity/open-rarity) | Reproducible information-content rarity scoring | Compatible Python runtime, actual upstream tests, complete metadata and numeric-trait compatibility. Current Gogh sample model is different. |

OpenSea's [official repository](https://github.com/ProjectOpenSea/opensea-skill) explicitly separates API queries from marketplace trading and wallet signing. We would retain only approved reads for the first three skills. No upstream wallet provider, signing key, Seaport approval or swap route is inherited.

The [Emblem research packages](https://github.com/EmblemCompany/Agent-skills/tree/main/skills/emblem-market-research) offer an additional inspectable research route. Anonymous MCP tool discovery previously worked, but authenticated research and Robinhood compatibility have not been demonstrated. Not counted as a proven working Gogh skill.

## Minting is a separate acceptance bar

Link Sniper and Mint Hunter remain ADAPTING. Existing V2 mint-envelope tests pass, but that is not proof of a complete equipped-skill → owner policy → live simulation → submission → confirmed receipt path. No live mint was submitted during these probes. Paid Mint License, NFT Trader and Bidder remain excluded from activation.

Suggested order: finish Contract Detective acceptance, finish Rarity Eye coverage/acceptance, unblock OpenSea market reads, then complete gated Link Sniper/Mint Hunter acceptance. This preserves canonical Punk custody and does not weaken screening to achieve a skill count.
