# Final testing acceptance matrix

Evidence snapshot: September 13, 2026, integration `49816b2` on `v2/final-hardening-20260913`. Independent documentation review: `hardening_acceptance_guide`. This review changed no application, contract, deployment, database or wallet state.

**Verdict at this snapshot: NOT_READY.** The composed Forge journey and independent browser review passed. Final integrated validation, the supported-link resolver correction and final release/signoff reconciliation are still in progress. A missing final gate is not automatically an implementation defect; neither is it a passed gate. The lead must update the dated release verdict after integration. This matrix must not be used to claim that preview-only changes are already deployed.

## Evidence rules and release identity

| Label | What it establishes |
|---|---|
| SOURCE | Inspected behavior or boundary; does not prove runtime success. |
| UNIT / SQL | Real module or SQL behavior with controlled dependencies; not public-chain or production-account acceptance. |
| BROWSER | Actual candidate DOM/modules in isolated Chrome with substituted wallet/API/RPC dependencies and blocked external traffic. |
| DISPOSABLE | Real transactions/contracts and durable database behavior on an owned copied chain; no original NFT or user funds moved. |
| LIVE READ | Actual public chain, authenticated service or production route observation at a recorded time. |
| LIVE DELIVERY | Public receipt plus independently checked delivery and durable completion of the existing owner-authorized mint. |

Production currently recorded in [status](status.md): `3ebaa6d05cd17d2e36a0f96346e47b5493735e40`, PR #64, Netlify `6aa6e937f5737700082a7d35`. URL: <https://goghpunks.xyz/broker/v2/>. Hardening PR #65 is a separate candidate at <https://deploy-preview-65.preview.goghpunks.xyz>. A preview hostname does not make a connected wallet or contract a disposable test environment.

The baseline [product audit](product-audit.md), [performance audit](performance-audit.md) and older swarm records preserve historical failures. Later evidence below supersedes only the specific resolved finding. For example, archive access and #1599 delivery are no longer blocked; all ten requested skills have not thereby become released.

## Every requested FINAL TESTING READY gate

“PASS, bounded” means sufficient evidence exists for the stated supported test scope. The qualification remains part of the result.

| # | Required gate | Status at snapshot | Evidence and practical limit |
|---|---|---|---|
| 1 | Wallet connection stable | PASS, bounded | Existing `tests/wallet-connect.test.mjs`, owner/discovery race suites, production connected-holder Collection response. BROWSER tests deliberately replace wallet bootstrap. Actual iOS wallet app switching remains a final holder check. |
| 2 | Punk ownership stable | PASS, bounded | `site/broker-v2-ownership.js`, ownership/transfer suites; LIVE READ of 140 owned originals. Indexed rows/artwork are hints, never owner authority. Failed history remains unavailable. |
| 3 | Punk roster fast | PASS, bounded | Progressive canonical artwork and owner-scoped request fencing deployed in PR #64; 140-item BROWSER keyboard test. LIVE READ scan observations are about two seconds, not a service-level guarantee. New MCP helper separately found all 140 with zero hints in 1,743 ms; its production route remains a cutover check. |
| 4 | Control Center polished | PASS, bounded | [Final UX review](final-ux-qa.md): 24 adversarial scenarios, 58 screenshots at 1440/1280/768/430/375/320 widths; recorded P1/P2 findings corrected. |
| 5 | Funding works in test environment | PASS, bounded | [Wallet review](wallet-review.md): 145 focused tests; actual OWNER path skips inactive V3 checks, PUNK path preserves reserve, exact review and ambiguous-result journal. BROWSER runs actual preparation/recovery modules with wallet responses mocked. No new live deposit is claimed. |
| 6 | Withdrawals work | PASS for supported assets | [Cross-subsystem proof](../v2-swarm/integration-validation.md), recovery/controller/API and contract tests cover exact owner destination, custody, transfer rejection, immutable review and original-hash recovery. V3 recovery retained; Agent ETH, gas deposit and standard single/multi-edition NFTs supported. Arbitrary Agent ERC20 and complete V1/V2 recovery UI are not delivered. |
| 7 | Chat works | PASS, bounded | Provider LIVE fixed conversation/JSON probes plus persistence, owner/selection fencing, retry and exact-draft BROWSER/module tests. No end-to-end streaming or first-token latency claim; production hardening cutover still pending. |
| 8 | GPT works | PASS on preview | [Provider evidence](provider-live-checks.json): actual OpenAI fixed conversation and structured-output probes, 3,498 ms, injected database privileges verified. Candidate configuration is not yet production activation. |
| 9 | Claude works | PASS on preview | Same evidence: actual Anthropic probes, 2,254 ms, exact provider identity and required database privileges. |
| 10 | Grok works | PASS on preview | Same evidence: actual XAI probes through the constrained managed gateway, 3,020 ms. No wallet tools or signing authority. |
| 11 | Bankr works or documented blocker | PASS as documented exception | [AI review](ai-review.md) and provider evidence: no reviewed Bankr credential/funded gateway configuration found. Bankr must remain unavailable, not READY. No account purchase or wallet integration is inferred. |
| 12 | Strategy creation works | PASS, bounded | Structured intent normalization, chat tests, scoped domain compiler and actual confirmation BROWSER. Identity, allowed adapters and exact wei amounts are deterministic. |
| 13 | Strategy confirmation works | PASS, bounded | Existing owner message/activation tests and review binding. Final BROWSER proves one-wei mint/gas/reserve remain visible; malformed amounts block confirmation. No automatic broad-autonomy activation is authorized. |
| 14 | Link scanner works | **PENDING P1 integration** | URL boundary tests pass, but baseline production/review/MCP default callers have no trusted resolver. `broker-v2-inspect-url.mjs:14`, `broker-v2-review-inspect-url.mjs:14`, `broker-v2-mcp.mjs:90`. Active specialist is adding the bounded supported-source path. Require actual default-route identity/price/screen/simulation evidence; generic accepted URL syntax is insufficient. |
| 15 | Shared discovery works | PASS for existing shared source; coverage bounded | [Discovery review](../v2-swarm/discovery-review.md), shared SeaDrop source/converter, repository dedupe/provenance and actual SQL tests. No per-Punk scanner. New generic ingest is intentionally gated/unscheduled; tests do not establish fresh opportunities on every site or an available live free mint today. |
| 16 | Security screen works | PASS for reviewed adapters | [Policy/simulation review](../v2-swarm/policy-simulation-review.md), sparse/unknown hazard regressions and immutable evidence gates. Unknown bytecode/effects remain unknown; no claim of universal contract safety. |
| 17 | Simulation works | PASS for reviewed transaction paths | Existing execution, funding, recovery, selected-paid and controlled Forge tests simulate exact calls. Stored MCP simulation evidence is labeled stored, not a newly executed simulation. Fresh supported-link integration remains gate 14. |
| 18 | Policy engine works | PASS, bounded | `tests/v2-swarm-policy.test.mjs`, execution/runtime tests: mode, exact price/gas/reserve, adapter, owner, skills, immutable transaction and known risk gates. AI output cannot bypass them. |
| 19 | Skill Registry works | PASS, bounded | Existing deployed runtime pins and [composed journey](forge-journey.md). Rarity Eye v1 accepted in the recorded production registry. Presence in a catalog does not imply acceptance. |
| 20 | Training Credits work | PASS, DISPOSABLE | [Forge evidence](forge-journey-evidence.json): exactly one credit per copied original burn; duplicate claims/settlement cannot create another. Two credits spent once each on learning and slot unlock. |
| 21 | Burn works in controlled environment | PASS, DISPOSABLE | Real copied deployed stack, browser envelope/controller, restricted native PostgreSQL and receipt reconciler: 16 local transactions, no public transactions. #1753/#94 were fork copies. |
| 22 | Burn safety blocks asset-bearing Punk | PASS for guard behavior; no live clearance | Same evidence: 24 explicit asset/state failures block the wallet request. Actual source inventory/obligation prerequisite is mocked in the composed fork. Nonstandard assets, later deposits and off-chain obligations remain outside complete enumeration. |
| 23 | Skill learning works | PASS, DISPOSABLE | Actual Rarity Eye learn, credit decrement, duplicate prevention and lost wallet response/reload recovery. Delegated-owner correction supported the real owner's copied existing designation without clearing code or installing a module. |
| 24 | Slot unlocking works | PASS, DISPOSABLE | One slot became two after a separately earned second credit; no-credit unlock rejected. Seven-slot cap and rarity allocation have dedicated tests. |
| 25 | Equip/unequip works | PASS, DISPOSABLE + BROWSER | Actual reviewed transactions settle once; BROWSER shows empty/locked slots and plain learned/equipped distinctions. |
| 26 | Equipped skills change capabilities | PASS for Rarity Eye | Actual production server research bridge reads three forked original metadata records when equipped, rejects research after unequip and still denies `prepare_mint`. Skills do not grant spending. |
| 27 | Skills survive transfer | PASS, DISPOSABLE | Learned skills, slots and loadout persist with copied #93; Wallet/Agent addresses and copied #1599 custody persist. |
| 28 | Old owner loses control | PASS, bounded | Composed journey rejects seller training/research and prior worker continuity window; contract/ownership suites cover current-owner methods. Retain documented away-and-back session limitation and managed history gates. |
| 29 | New owner gains control | PASS, DISPOSABLE | Fresh buyer training review and equip/unequip settle; buyer cannot access private seller review. Test-only buyer allowlist does not broaden production access. |
| 30 | Automation pauses on transfer | PASS for managed/direct transfer case | Copied Agent session active before transfer, inactive after; training never reactivates it. Current released account does not permanently invalidate an old session after ownership returns to the former owner; broader autonomy remains blocked. |
| 31 | Activity feed works | PASS, bounded | LIVE DELIVERY #1599 durable completion; endpoint/history tests and BROWSER verified-empty/loading/error treatment. Authorization, submission, delivery and application reconciliation remain separate states. |
| 32 | Collection works | PASS, bounded LIVE READ | Actual authenticated production #93 route: 34 verified holdings including #1599 in 4,114 ms, no unavailable discovery sources. Current custody is rechecked; this bounded collection view is not burn-clearance inventory. |
| 33 | Mobile polished | PASS for browser viewport testing | Six-width independent review with no remaining overflow, field-label or target-size findings; phone inputs at least 16px. Native iOS keyboard, screen-reader and wallet handoff remain physical-device acceptance checks. |
| 34 | Major load-time issues fixed | PASS for measured repairs | Collection timeout repaired; progressive artwork, deduplicated owner authentication/balances, bounded MCP, 20-second AI router budget and reused registry initialization. Final mocked usable shell 680 ms; no production API p95 or AI first-token claim. |
| 35 | No P0 bugs | NO NEW P0 demonstrated in reviewed scope | Independent reviews preserve current-owner, immutable review, no-resend, secret and fail-closed boundaries. This is bounded evidence, not a perfect-safety claim or approval to broaden execution. |
| 36 | No unresolved P1 bugs | **PENDING** | Gate 14 and final validation/release evidence must close. Final UX P1 exact-price and WETH-loading defects are already fixed/retested. Do not relabel unfinished required behavior as polish. |
| 37 | Full build passes | **PENDING final integrated head** | Last deployment gate passed 140/140, including domain typecheck, wallet/site build, syntax and secret checks. New later integration requires a final gate. Retained contracts: 284 tests across 27 suites, unchanged Solidity/manifests. |
| 38 | Full test suite passes | **PENDING final integrated head** | First combined run 2,342/2,343; only stale loading-copy assertion fixed with its 12-test suite passing. This is not a full passing run. Parent is running the final integrated suite. |
| 39 | Security reviewer signs off for final test phase | **PENDING final signoff record** | [Independent security review](final-security-review.md) accepts bounded implementation; 19 adversarial proofs and three corrected findings. The committed report still requires exact final UI SHA, composed/provider evidence and integrated gates. A later reviewer result must explicitly supersede this pending record. |

Gemini also passed actual conversation/structured-output checks on production (2,382 ms) and the hardening preview (3,301 ms, September 13 at 18:47:45Z, sanitized local artifact `/private/tmp/gogh-live-gemini-preview.json`). The latter should be folded into the committed provider evidence by the lead. None of these two fixed probes measures general conversational quality or a long-running provider SLA.

## Remaining release blockers and follow-through

| ID | Priority / classification | Concrete closure |
|---|---|---|
| A-01 | P1, required link behavior | Integrate/review the active resolver work at the three default callers above, prove its bounded supported path without accepting website wallet requests, rerun route/secret/timeout tests. Keep unsupported sites explicit. |
| A-02 | Required validation gate, not a newly proven code defect | Record all passing full tests and deployment/build checks against the exact final commit. Do not add overlapping test counts as unique coverage. |
| A-03 | Required independent signoff gate | Reconcile final security review with latest source, 24-scenario browser proof, 16-transaction composed proof and actual provider privileges; record acceptance for final testing. |
| A-04 | P1 release communication if left stale | Update `site/broker/v2/test-guide/index.html` from the [holder guide](testing-guide.md) before publishing a final-ready claim. It currently invites new autonomous/paid/refund steps inside a phase that authorizes controlled testing and preserves production assets. New market packages/providers must not be described as already released. |
| A-05 | Production cutover acceptance | After reviewed deployment, record release SHA, static assets, real provider probes and read-only roster/Collection/MCP checks. Preview success cannot establish production configuration. This does not require a real burn, funding, refund or sweep. |

No new application defect beyond the already assigned link gap is demonstrated by this documentation-only review. Known unsupported behavior remains visible scope, not a hidden promise: floor sweeps/WETH bids, arbitrary paid collections, all ten accepted Forge skills, general Agent ERC20 recovery and complete legacy inventory. Market Scout v2 has live read-only data proof and 99 targeted tests but is TESTING and not automatically loaded/registered. Its versioned implementation must not silently replace accepted v1 hashes.

## Final holder acceptance still worth doing

Use [the holder guide](testing-guide.md) for production read-only checks and explicitly labeled disposable transaction practice. Record selected Punk, action, exact displayed result, time and public transaction hash when one exists. Check one small phone with a real supported wallet, reconnect after returning from the wallet app, and verify keyboard navigation/screen-reader labels. These observations close device-specific limits; mock Chrome screenshots cannot establish them.

Preserve original #1753, existing #93 holdings and the untouched earlier paid refund throughout this phase. Marketplace indexing after a real burn is not established by a local fork and is not needed to pretend a production burn occurred. Source NFT approval itself has no on-chain expiry and does not create a credit; the app must retain that distinction in any later separately authorized burn review.
