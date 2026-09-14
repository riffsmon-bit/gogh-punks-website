# Campaign skill release evidence

This is the skills specialist's checkpoint, not a declaration that all skills are live. Current production registration was read directly at the [recorded canonical block](skill-registry-live-audit.json). Registry administrator is the main holder wallet `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. Global pause is off. **Only Rarity Eye v1 is registered and available**, with matching package hashes.

| Skill / immutable version | Tool and actual boundary | Fresh source acceptance | Registry |
| --- | --- | --- | --- |
| Contract Detective v1 | `inspect_contract`; bytecode/interfaces/proxy-slot observations; never a security clearance | Real Gogh contract, 18,470 bytes, 898 ms | Unregistered |
| Rarity Eye v1 | `get_metadata`, `rank_trait_sample`; selected inline trait sample, no collection-wide rank | Three real Gogh tokens, 716 ms; numeric Archetype Edition treated explicitly as categorical | READY, available, hashes match |
| Market Scout v2 | `get_market_listings`; bounded fixed-price ERC721 observations, no executable orders | Five live Gogh listings, 253 ms | Unregistered |
| Floor Hunter v1 | `rank_observed_listings`; observed minima within payment currency, no verified floor or purchase | Five live observations, 80 ms | Unregistered |
| Collection Researcher v1 | `research_collection`; contract and declared sample traits | Three of three real inline metadata records, 495 ms | Unregistered |
| Art Curator v1 | `classify_collection`; exact supported declared style labels, no image classifier | Three actual metadata records, 541 ms; correctly UNKNOWN because these tokens declare no Style; positive recognition is fixture-tested | Unregistered |
| Social Scout v1 | `research_project`; declared project description and website/X/Discord references, no posts/activity/authenticity claim | Three declared links from exact Robinhood collection, 279 ms; similarly named Base collection rejected | Unregistered |
| Link Sniper v1 | Supported link resolution/screen/simulation; no broad website execution | Existing controlled composed acceptance retained; no new live mint opportunity claimed here | Unregistered |
| Mint Hunter v1 | Supported free-mint inspection/simulation/preparation; separate owner, policy, skill and economic gates | Existing controlled composed acceptance retained; no new live mint delivery claimed here | Unregistered |

See [fresh source results](existing-skills-live-read.json) and [Social Scout evidence](social-scout-live-read.json). These are source reads, not authenticated production holder-route tests. The Rarity probe initially used the intentionally rejecting default for numeric metadata, and the Art probe initially supplied `PIXEL` instead of valid `PIXEL_ART`; corrected argument probes and their limitations are explicitly preserved in the evidence. No adapter was changed to turn a failure into a success.

## Exact registration steps

The immutable registry requires three separately reconciled steps for each new version:

1. `register(skillId,version,manifestHash,instructionHash,prerequisite,capabilities,riskTier)` creates DISCOVERED.
2. `setStatus(key,TESTING,reviewEvidenceHash)` records tested status.
3. `setStatus(key,READY,reviewEvidenceHash)` requires previous TESTING and a nonzero evidence hash.

The new `createReadOnlySkillReleaseReview` in `broker/src/v4/skill-forge/read-only-skill-release.mjs` selects the exact next step from fresh pinned on-chain state. It is an administrator preparation service, not a signer. It requires server-owned reviewed package objects and per-key review evidence with matching package hashes and `APPROVED_FOR_REGISTRATION`. Such an attestation must come from independent campaign review; this document does not fabricate one.

`inspect()` returns the registry administrator, canonical anchor, matching definitions, availability and the next required action. `prepareNext({key,administrator})` rechecks that exact administrator, validates chain/runtime code and immutable existing definitions, simulates the step, estimates fees, verifies no other admin transaction is pending, verifies admin gas balance, and returns a zero-value wallet transaction expiring in 60 seconds. It rereads state before delivery. All provider failures are sanitized. Default total fee ceiling is 0.0001 ETH per prepared step; the helper cannot raise it beyond that ceiling.

Blocked/rejected/deprecated/disabled definitions and global or capability pauses are not silently reversed. Unknown versions cannot be injected through request parameters. Read-only registration excludes FREE_MINT, PAID_MINT, LINK_REVIEW, SCHEDULED_MISSION and all wallet/executor capabilities. Mint Hunter and Link Sniper require their separate stronger release review rather than borrowing this administrative read-only path.

After a wallet-confirmed receipt, the admin UI must recheck the original result and prepare the next step, never resend a lost wallet request automatically. Registry READY still does not activate a server release, teach a skill, equip it or confer economic authority. Parent integration must select exact approved package versions in the immutable production release, include the runtime adapter and dependency bytes in the deployment, and verify learn/equip/use through the holder UI. Receipt recovery belongs to the composed admin handler/UI and remains an integration gate for this helper.

## Validation and remaining scope

The helper and Social Scout plus existing planned-research/runtime/capability regression suites passed **100 tests**, zero failures/skips. There are 21 dedicated registry-preparation tests and 23 Social Scout tests. No contracts, accepted package bytes, deployment artifacts, database schema or public registry were mutated by this chunk. No mainnet transaction was sent.

Scheduled Hunter and Paid Mint License remain separate scoped campaign tasks. Bankr stays deliberately disabled. Listing Watcher, Portfolio Curator and Whitelist Scout are not promoted from catalog placeholders by this work.
