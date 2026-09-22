# Independent read-services release review

STATUS: **APPROVED_FOR_REGISTRATION** for the seven exact read-only package identities below. No unresolved P0/P1 finding in this bounded review. This approves package registration preparation; it does not activate a server release, authorize a transaction, establish production holder acceptance, or approve transaction-capable skills.

Reviewed at 2026-09-14T02:55:27Z by the independent campaign read-services reviewer. Scope: integration worktree `/private/tmp/gogh-capabilities-integration`, comparison base `b442b44`, integration commits `f9118ba` and `aa3cb93`, and the final uncommitted operator-probe, test, and Social Scout empty-state corrections present during review. Implementation changes were made by the integration owner; this reviewer wrote only this document and performed no registration, status promotion, signing, broadcasting, production configuration change, installation, or database mutation.

## FILES

Inspected Social Scout's manifest, instructions, native implementation, package loader/runtime, canonical capability resolver, holder API, MCP bridge/roster, diagnostic lab, catalog/action mappings, durable panel, result renderer, and deployment raw-file inclusion tests. Inspected `read-only-skill-release.mjs` against the actual `GoghSkillRegistry.sol` register/status/availability semantics. Inspected the operator endpoint and `release-readiness.mjs`, their origin/bearer/HTTP helpers, RPC-pair factory, training-runtime initialization, and restricted database-role verifier.

Selected final source SHA-256 pins:

| File | SHA-256 |
| --- | --- |
| `broker/src/v4/skill-forge/research-runtime.mjs` | `618de777e008a250b920baac31887a74f9b177eb864ed2d4d47e2eb081dd3416` |
| `broker/src/v4/skill-forge/read-only-skill-release.mjs` | `70430e55db4e75ef9ec37ae872ce5207fe54da342f80d6db8ef0296472a999d6` |
| `broker/src/v4/skill-forge/social-scout-v1.mjs` | `c9445fcdd4053154a598a544d564e22cb19f507618b01a12adcdd223f04a2d9e` |
| `broker/src/v4/operations/release-readiness.mjs` | `094d50bfbdac3a187def1bea6c2db32ad4936f4898c054d50dd555e74084e518` |
| `netlify/functions/broker-v2-release-check.mjs` | `1ff482801dfbcac45a9c02e5474be63e76431a98130aa93f790da9b0829cbed6` |
| `site/forge-research-result.js` | `1e40b0b69182f5909a41ec4bb539eeca89fb264e187c04b41c4822f5fdd8f743` |

`package.json`, `package-lock.json`, and the six existing approved package directories are unchanged against the comparison base. The installed versions match the lockfile: viem 2.55.11, pg 8.23.0, and @netlify/database 1.1.0. The lockfile records integrity hashes. Social Scout adds no third-party package or imported upstream skill runtime; it uses built-in `node:net` and the existing authenticated OpenSea API boundary. All seven actual packages loaded successfully with their implementation/direct-dependency hashes checked; their manifest and instruction hashes exactly match the recorded live registry audit.

## TESTS

Final independent reruns passed **202 tests**, zero failures/skips:

```
node --test --test-reporter=dot tests/social-scout-v1.test.mjs tests/read-only-skill-release.test.mjs tests/planned-research-integration.test.mjs tests/planned-skills-independent-integration.test.mjs tests/skill-forge-equipped-research-api.test.mjs tests/skill-forge-planned-research.test.mjs
node --test --test-reporter=spec tests/skill-forge-capability-resolver.test.mjs tests/skill-forge-research-runtime.test.mjs tests/skill-forge-research-tools.test.mjs tests/v2-hardening-market-reader.test.mjs tests/release-readiness.test.mjs
```

The first command passed 102 tests after the integration owner's corrections; the second passed 100. The initial 102-test run exposed three real integration regressions: two three-package identity expectations and an unconditional dependency-map read that failed for standalone Social Scout. The owner updated the expected fourth package and allowed an absent local dependency map; the implementation pin mutation test still covers Social Scout. The initial failure was not excluded from the final run.

Additional independent in-memory assertions used actual recorded Social Scout evidence with the actual renderer: observed references display as text; the recorded wrong-chain result renders unavailable without links; hostile HTML remains literal text with no link/image/script/iframe nodes; a wallet-authority assertion is rejected; malformed/unsupported declarations remain UNKNOWN through the adapter and corrected empty-state renderer. The general admin token was rejected by the dedicated release endpoint before any client creation. This assertion first encountered missing `SITE_URL` test configuration and correctly returned 503; supplying the same production-origin fixture as the endpoint suite produced the intended 401. No production environment was changed.

Independent evidence checks recomputed Contract Detective, Floor Hunter, Collection Researcher, and Art Curator report hashes. Rarity Eye's full ranking was reproduced from the recorded live metadata with explicit numeric categorical treatment. All seven exact packages passed the read-only preparation helper's package validation using their matched audit identities; this validation made no RPC call. `git diff --check` passed. No Chrome, Anvil, Forge build, new install, or broad database test was run by this reviewer.

## SECURITY

- **Provenance and data meaning:** The [Social source record](sources.md), [existing ecosystem source audit](../v2-swarm/skill-source-audit.md), [Market Scout v2 review](../v2-hardening/market-mcp-review.md), and [planned research acceptance](../v2-hardening/planned-research-skills.md) support native, bounded adapters. No broad Bankr, wallet, posting, shell, mutable MCP-catalog, or external skill runtime is imported. Social Scout observes OpenSea-declared collection text and website/X/Discord references; it does not fetch those destinations, posts, or account activity, or prove authenticity/ownership. Its fixed request checks exact slug, Robinhood chain label, and contract identity. The recorded similarly named Base collection is rejected.
- **Untrusted inputs and secrets:** Social Scout accepts only a bounded canonical slug and nonzero contract, uses one fixed-host HTTPS GET with redirects rejected, and bounds response bytes and total time. It strips query strings/fragments from returned reference URLs, rejects unsafe/unsupported reference forms, sanitizes provider exceptions, and bounds/control-filters text. Provider strings are evidence, never package instructions. The UI uses `textContent`; no provider markup or reference navigation is executed. Missing or filtered links now render explicitly unknown. Missing API credentials withhold the tool, and unavailable responses retain `project: null` with no favorable inference.
- **Capability and owner gates:** The actual loader checks implementation/direct dependency bytes and leaves packages unapproved TESTING. Only immutable release key/hash matches become server-approved. The holder route binds session owner, path token, exact selected/equipped key and its declared tool; the MCP roster/call bridge uses fixed local tool identities and scopes. Both reuse canonical READY/learned/equipped/effective-capability checks before and after the provider call, plus training state and Transfer-log continuity checks. A shared capability bit does not expose another package's tool. Requests cannot substitute the collection, slug, RPC URL, owner, signer, or capability object. The owner-gated diagnostic lab remains explicitly separate from learning/equipment authority.
- **Registration preparation:** The helper rejects wallet/executor capability requirements, nonzero risk tiers, non-read capability bits, unreviewed keys/hashes, missing nonzero review evidence, invalid fees, deployment code/chain mismatches, blocked/rejected/deprecated/disabled definitions, and emergency pauses. It snapshots reviewed definitions, anchors bounded registry reads and detects a changed canonical block. Its next-step calldata agrees with the actual contract: register DISCOVERED, attest TESTING, then READY with evidence. Existing immutable definitions must match exactly. It verifies the current registry administrator, simulates, estimates gas, limits total network fee to at most 0.0001 ETH, checks pending/latest nonce twice and pending balance, and rereads administrator/step state before returning a zero-value transaction. No signer or broadcast method exists. The returned 60-second expiry is a preparation/UI boundary, not a new on-chain expiry condition; the administrator composition must enforce freshness and reconcile each wallet result before the next step.
- **Operator endpoint:** A dedicated `GOGH_V2_RELEASE_CHECK_TOKEN` is checked with the existing constant-time hash comparison, together with allowed origin, before RPC/database initialization. The generic admin token is not a fallback. Only POST with exact `chain` or `training` action is accepted; users cannot supply targets, SQL, methods, token IDs, or credentials. Responses are private/no-store and generic failures do not expose provider URLs, SQL identities or exception details. Runtime initialization checks actual restricted-role/RLS grants; it does not invoke coordinator, journal, settlement, or write methods. The chain probe requires two separately configured RPC hosts, fresh correct-chain heads, a common confirmed anchor, exact deployed runtime hashes, matching historical block/owner observations and the fixed positive transfer control. Final chain/anchor rereads reject mid-check reorgs. Passing one fixed historical read is a bounded connectivity observation, not proof of all historical ranges or future provider availability, and this endpoint grants no wallet authority.

## Independent source evidence

This approval combines source inspection, independently rerun shared/integration/adversarial tests, and the other specialist's recorded real source reads. This reviewer did not relabel fixture tests as live production calls and did not repeat authenticated external calls.

| Artifact | SHA-256 | Relevant recorded evidence |
| --- | --- | --- |
| [Existing skills live reads](existing-skills-live-read.json) | `e61ba04fd88f06b353b43ef157c1109c10d7872e98cd32db6b6764dbb5efec08` | Actual contract bytecode/interfaces; three inline metadata records; reproducible sample rarity; five observed market listings and price grouping; 3/3 collection sample records; Art Curator correctly UNKNOWN for three tokens without supported style labels. |
| [Social Scout live reads](social-scout-live-read.json) | `ea2fd0ddc5d58c3e3e9477e638e88626865be82a1e3961d99e17c66097cbdc63` | Exact Gogh Robinhood collection returns three declared references; similarly named Base collection rejected; zero public transactions. |
| [Live registry audit](skill-registry-live-audit.json) | `88f53137fc9cae14b521d9c0c7794760f2bb3a033218852686644f1ef30ad712` | Exact local package hashes match audit identities. Only Rarity Eye v1 was registered and available at the recorded block; global pause was off. |

Market values are historical observations at their recorded timestamps. No collection floor, executable quote, security clearance, OpenRarity equivalence, image analysis, social activity score, or verified authenticity claim is approved. Positive Art Curator label recognition is controlled-test evidence; the real Gogh sample establishes correct UNKNOWN behavior.

## APPROVED exact package identities

Every row has status **APPROVED_FOR_REGISTRATION** only for the exact `skillKey`, `manifestHash`, and `instructionHash` shown. Use SHA-256 of the final bytes of this review document, prefixed with `0x`, as its independent `reviewEvidence.evidenceHash` if composing the administrator helper. Do not substitute a hash from an earlier document revision. Rarity Eye v1 is already READY in the recorded audit and should be preserved; the helper must freshly inspect and refuse redundant preparation.

| Package | Skill key | Manifest hash | Instruction hash |
| --- | --- | --- | --- |
| Contract Detective v1 | `0x1a7bb5f14ab81288db8a451245c3aa880c3696e9f2aae4ca3e72171416f9a837` | `0x80695d48a12865c2c633b4977cd8f24dd598dd8808eae5ebf733052f8091ba24` | `0x1e283e611d6f72e8fa34d1412a5cbef8dd4d936f0138a5f18fdf519bafc93252` |
| Rarity Eye v1 | `0x2109a1600733ac7484f1358fcf5a116586a8e66b993ae96f479098fffbb7b1c1` | `0x9f17224444ef8938c9d998754a6be4c9dce2029c5e6e6a5f918effdc276c0d26` | `0x7f7baae864b35a8230361de2ac3a6abda099669a6659e3d76e5bdf105bf859f0` |
| Market Scout v2 | `0xf9e55d813fbee91e69b57f90249ab5bb4b482e4028ebdfd6d26b90e12b770b22` | `0x16453f218e08bc65d1ff0323759f4885616a4547a4fc39d36b25271161151d32` | `0x33e760db794e833ac2ef0b6804bc326954d100b49cf812f2108dd578c4358b0b` |
| Floor Hunter v1 | `0x06bc3f25d3f333e9317bce16741bdef285f4a55d00de11b43db7614f5d27b230` | `0xf5f61885bbf3ba023970de11ab86756144a3350858ef93e42500e156a506c3c9` | `0x86e45147308a07fa367bac81239a214b09d627abd8c45c1498b52c100f1d384b` |
| Collection Researcher v1 | `0x2040f8777bd900d065ac2ba4a2df7b49e6bd6625196d859057d5dfd7f05d0480` | `0x45448ac9ea41e308cf8206c555b844adac7c5c9602f35743f51a851e6561d89d` | `0xd0b6ce87162a8efcdf003b1431c107badfcbf99ece2316c35dad7fffa9e67f23` |
| Art Curator v1 | `0xef3df33dded5f7e7d58f37ca5ecd4ce095803bfa298d391740897de071ea2ae2` | `0xd28c0c762745ba86efd41fb9387a48ddbc8874e1f1c53acaa5eb54ec18dab808` | `0x0775e25b3d7371df3e5e5f1fe4239960e50f55b6db939d6401730ca94ef55ed8` |
| Social Scout v1 | `0xf37cf3a8d630bcf10e0bbd78566b9327875f9674b1a65aa8a78286a14274a7bf` | `0xebba5f2aca5f762aec3179ed44776c2e8038fe6451ae92b32658654a1eafe7d2` | `0x796985fd3e3075380104af2f93fc6dbad295bd81c60909004d238f981b52feed` |

## Blockers and integration limits

The three failing integration tests and Social Scout's absence-versus-unknown display issue found during review are corrected and independently rechecked. No remaining P0/P1 fix is requested for these reviewed read services.

Production activation still requires the exact reviewed server release, final deployed raw-file inclusion, fresh administrator state/fee/nonce checks and per-step wallet/receipt reconciliation, plus authenticated holder learn/equip/use/unequip acceptance. The operator chain/database probes need real deployed responses for operational readiness; controlled tests alone do not establish live credentials or role grants. The integration owner retains those tasks. This review does not approve Link Sniper, Mint Hunter, Scheduled Hunter, Paid Mint License, Bankr, listing/portfolio/allowlist placeholders, automatic minting, bidding, or spending.
