# Independent planned-skills integration review

Date: 2026-09-13. Reviewer: `real_skill_completion`, independently assigned to review the planned adapters built by other agents. Baseline: `1063614`. Reviewed package commits: `9f8a3f5`, `f8f7998`, `c5b6031`; integration commit: `32f3831`, observed within HEAD `a9dd567`. The seven-line result-focus follow-up in `site/broker-v2-forge.js` was also reviewed before its commit: it only focuses/scrolls a populated result after the current selection and request sequence still match. Exact file hashes below bind this verdict to the reviewed contents.

## Verdict

**PASS for controlled integration of the read-only planned research skills.** No unresolved P0 or P1 was identified within this review scope. This is not a public skill registration, registry promotion, broad execution authorization, or a whole-product FINAL_TESTING_READY verdict. Existing exact OWNER_CANARY release gates remain necessary.

The reviewer modified only this report and `tests/planned-skills-independent-integration.test.mjs`. Feature fixes belong to the parent integrator. No public transaction, NFT burn, refund, order posting, wallet request, production secret/configuration write, or paid-service action was performed by this review.

## Closed findings

| ID | Priority | Finding and impact | Resolution and independent verification |
| --- | --- | --- | --- |
| PSI-01 | P1 | The existing durable training panel used `keccak256(abi.encode(id, version))`, while the registry uses `keccak256(abi.encode("GOGH_SKILL", id, version))`. Real learned/equipped keys could never reveal the research button. The parent discovered this defect. | The parent introduced the browser key/action helper. Independent tests compare its actual output to viem's Solidity ABI encoder and drive the actual durable panel for all seven supported skill/version identities. The old, incorrect hashes never map to an action. |
| PSI-02 | P1 | Forge's Netlify included-files list omitted raw `collecting-intent.mjs`, which Art Curator hashes as a reviewed dependency. Bundling its import does not preserve the raw file path; a locally successful adapter could fail after deployment. | The parent added that dependency and expanded the equipped-research package closure. Three independent tests construct separate packaged roots from each function's actual declared included-files patterns and successfully load all three exact planned packages. |
| PSI-03 | P3 | Collection Researcher catalog copy described metadata as verified even though token metadata remains a declaration from an untrusted contract. | The parent changed the wording to declared metadata. Results preserve bounded-sample and unknown-authenticity limitations. |

## Interface and authority review

- The new package identities are Floor Hunter `9/1`, Collection Researcher `11/1`, and Art Curator `6/1`. Their only declared tools are respectively `rank_observed_listings`, `research_collection`, and `classify_collection`; all have wallet authority NONE and no executor capability.
- A shared capability bit does not grant another package's tools. The capability resolver intersects exact reviewed manifest declarations with implemented tools and required capability bits. It rejects unsupported declarations, stale ownership, missing learned/equipped state, unavailable registry entries, and mismatched package pins.
- Runtime selection is explicit and versioned. Existing defaults remain Detective `3/1`, Rarity Eye `4/1`, and Market Scout `8/1`; new packages are TESTING and unapproved when loaded. The API release selection uses exact release keys and pins, with separate before/after state and ownership-continuity checks. There is no silent Market Scout v1/v2 substitution.
- MCP uses distinct `skill_*` aliases for equipped research; existing diagnostic tool names retain their previous meaning. Neither MCP nor Forge accepts client-supplied owner authority, arbitrary URLs, signing operations, calldata, or execution-ready flags for these tools.
- Forge's research lab is explicitly read-only. The equipped endpoint separately requires the exact owner-canary release, session owner, learned skill, equipped slot, accepted package pins, registry capability gates, and unchanged owner/loadout state after the tool result.
- Source/dependency SHA-256 verification remains active for all three packages. The raw source closure is present for `broker-v2-forge`, `broker-v2-forge-skill`, and `broker-v2-mcp`.
- A baseline diff confirmed no changes to deployment/release artifacts, public training release configuration, accepted Rarity Eye v1 or Detective v1 packages, or the existing `research-tools.mjs` implementation.

## Untrusted-data and network review

Collection evidence uses fixed server-owned chain clients and bounded token samples at one block. The viem action client explicitly disables CCIP reads and removes an inherited bound `call` action, preventing OffchainLookup from initiating metadata-driven HTTP requests. The shared RPC clients also disable CCIP reads. Contract and metadata outputs remain evidence rather than security clearance, complete inventory, or proof of token existence.

Only bounded inline base64 JSON metadata is interpreted. No token-URI URL or metadata image is fetched. Attribute types, lengths, counts, duplicate handling, and unknown values are validated; provider exception bodies do not enter public responses. Timeouts and bounded concurrency stop new work, and the original chain/block anchor is rechecked before results are accepted.

The existing OpenSea reader uses a fixed HTTPS host, server-only API key, GET requests, redirect rejection, bounded pages/body size/time, and strict collection/chain/payment normalization. Floor Hunter ranks only those observed listings with integer arithmetic, separated by currency. It does not identify a verified collection-wide floor, produce an executable quote, or sign/post an order.

Art Curator matches supported declared style labels. Prompt-like metadata remains an unknown label; it is not sent to an LLM. It explicitly lacks visual classification. Caller preferences are described as unconfirmed research input, not an owner-approved strategy. Collection Researcher summarizes a bounded metadata sample and makes no authenticity, valuation, or rarity claim.

Browser results use text nodes rather than metadata HTML. Exact integer prices avoid precision loss. Pending results are tied to the selected owner/Punk and discarded when selection changes. New research output is a readable summary; technical evidence remains collapsible.

## Independently executed validation

**150 tests passed: 143 existing focused tests and 7 new independent regressions; zero failures or skips.**

The focused suite was run in the integration checkout:

```sh
node --test tests/skill-forge-planned-research.test.mjs tests/planned-research-integration.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/skill-forge-rpc-clients.test.mjs tests/art-broker-v2-forge.test.mjs tests/skill-forge-equipped-research-api.test.mjs tests/v2-mcp-versioned-skills.test.mjs tests/v2-swarm-mcp.test.mjs tests/skill-forge-research-runtime.test.mjs tests/real-skills-independent-review.test.mjs
```

The review-owned regression file was run from the isolated review worktree:

```sh
GOGH_PLANNED_REVIEW_ROOT=/private/tmp/gogh-capabilities-integration node --test tests/planned-skills-independent-integration.test.mjs
```

After integration, omit the optional checkout override to test the current repository. The override exists only in the test harness and is never consumed by production code.

The seven independent tests establish:

1. All seven offered identities match the real registry ABI: Detective `3/1`, Rarity Eye `4/1`, Market Scout `8/1` and `8/2`, Floor Hunter `9/1`, Collection Researcher `11/1`, and Art Curator `6/1`. Invalid IDs/versions and the old incorrect hashes cannot map to an action.
2. Only the three sample-based tools require sample IDs.
3. Each of the three deployed function package declarations retains every raw dependency needed to verify/load the planned packages (three isolated packaged-root tests).
4. The actual durable training panel reveals and invokes equipped research for each canonical key, including the previously broken Rarity Eye path, without requesting a wallet transaction or writing recovery state.
5. A pending equipped research result cannot cross a selected-Punk change.

These are local, deterministic tests. They do not establish live RPC/provider availability or execute public transactions. The package tests validate declared raw-file closure, not a newly deployed Netlify bundle.

## Other evidence inspected and limits

The author-produced copied-stack journey records exact reviewed packages, local registry acceptance, learning, unequipped denial, equipping, real bounded research calls, transfer persistence, old-owner rejection, and unchanged original public NFTs. The author-produced browser evidence covers the three research cards at desktop/tablet/mobile sizes and stale/error/hostile-label states. These artifacts were inspected, not independently regenerated during this review; they must not be represented as additional independent runs.

- `planned-research-composed-evidence.json`: SHA-256 `e78edaf51817233746d54b8eec5c5e840391ec9870bb28ab288f89c47a7f5594`, author PASS at 2026-09-13T23:09:02.460Z, public transactions 0.
- `planned-research-browser-evidence.json`: SHA-256 `5e3719d1596942a82db71198490fd70bc78b232b6e42d6e46496868f9ea13c51`, author PASS at 2026-09-13T23:31:03.349Z, public transactions 0.

No new SQL, contract, or native-database behavior is introduced by the scoped research adapters; marketplace persistence and execution receive a separate review. No full-repository build or production canary was run by this reviewer. The parent must run the integration-wide gates after all compatible work is assembled.

## Remaining product limitations

- New package registration/promotion remains a separate controlled action. Local TESTING packages do not become publicly READY merely because this review passes.
- Floor Hunter is observed-listing research; a purchase or floor sweep requires separately reviewed marketplace execution and deployment gates.
- Art Curator recognizes declared supported labels, not image content or artistic quality. Real Gogh metadata without supported style labels correctly returns UNKNOWN.
- Collection Researcher is a selected sample, not complete collection inventory or verified project identity.
- Rarity Eye v1 and its accepted pins remain unchanged.

## Reviewed source hashes

Any subsequent authority, raw dependency, package selection, network, or rendering change needs a focused re-review. Unrelated branch commits do not change this file-level scope.

| SHA-256 | File |
| --- | --- |
| `0ec1d53339f458c74f6147bb16dda4ea445b7e61e9d16e000f307f2846fa3ab2` | `broker/src/v4/skill-forge/collection-evidence-v1.mjs` |
| `70a2b76c1f24e92c83f8ebf0af48a0c415f291a1167ac5192581fb6f3837e94e` | `broker/src/v4/skill-forge/art-curator-v1.mjs` |
| `25b02ac23a4b4b9ff6da16d470126502677fc620b1e2c9c5ddbf9f85f5bae9b1` | `broker/src/v4/skill-forge/floor-hunter-v1.mjs` |
| `c9e98e26cb5ff8c5695b68d5fc172c50953a97f1441416b3b4683cd7f2bbad38` | `broker/src/v4/skill-forge/collection-researcher-v1.mjs` |
| `881d7187ba1e879705a57d91b7f089df7d9e45a792321b158a7a43af45308ede` | `broker/src/v4/skill-forge/capability-resolver.mjs` |
| `03cc723dcb44952a1e13059ea807ecb78482cd870306331e7125d29c3e6aeff1` | `broker/src/v4/skill-forge/rpc-clients.mjs` |
| `7745ed13725052c1942064dc36a8c2afc2eababbfa41e0ca73300c4e8a3e2720` | `broker/src/v4/skill-forge/research-runtime.mjs` |
| `2b8f5ccfca24e24a31079735a84c39cb7962bfe768487385367292641e6d6b31` | `netlify/functions/broker-v2-forge.mjs` |
| `6a2212eb01685bada619fc7d94cc3368f98dfc07f60303372dba69b60be9896f` | `netlify/functions/broker-v2-forge-skill.mjs` |
| `244b5e45922a55c8207042028d31cc6d7600ba9242e80e8f19b9c0b213707753` | `netlify/functions/_shared/v2-mcp-research.mjs` |
| `b1f78d0593937bf17726740a71eae8fa885bc2f37dfcd2edbcc44fa16e41c188` | `broker/src/v4/mcp/art-broker-mcp.mjs` |
| `9e138d9a12da26af2c081bf3621d19d920b266b906899457084a05ff9d331495` | `site/forge-research-result.js` |
| `bc6f4828f877753c1183b1e9adc7d01f5843e1b247a71ff27eba3293c4cda4e2` | `site/forge-research-actions.js` |
| `6a5093278c23cc81376782d1ef4a521c4c2f62d61b654e905374f2717a922314` | `site/broker-v2-forge.js` |
| `88078a691e7dc7763afa52d47447d2911c4a174a0c7dcbc89cce2d962c47c46d` | `site/forge-durable-training-panel.js` |
| `29596aaf062b0a0138599cfd750aa6cd1937e98382845ead0e411e16219d169b` | `site/forge-catalog.js` |
| `94913d38ddc52b27f5bb3c31e138b446f01d0435f9cdc1e9509bae1037857d1d` | `netlify.toml` |
| `622a01ff3748cadb52a58b377cd4d665cb4ee93e44f16f39fbfe475559fc3397` | `scripts/dev/skill-forge/preview-server.mjs` |
