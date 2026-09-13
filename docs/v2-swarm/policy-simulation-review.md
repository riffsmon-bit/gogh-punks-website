# V2 deterministic policy and simulation review

Reviewed September 13, 2026 in `/private/tmp/gogh-swarm-policy`, branch `v2/swarm-policy`. Scope follows [repository-map.md](repository-map.md) and [shared-contracts.md](shared-contracts.md), with the lead's explicit extension assigning `opportunity.mjs` to this specialist. Owned validation work is complete; the separate executor findings below require L's integration work. This review does not authorize production execution.

## Owned changes and evidence

| Finding | Prior behavior | Corrected behavior |
| --- | --- | --- |
| Simulation compared missing or malformed values without validation | Equally absent `valueWei` or receiver fields could produce `PASSED`; arrays could stringify to matching amounts or addresses | Evidence and expected value must both be canonical decimal wei strings; both receivers must be address strings before comparison |
| Simulation treated unknown reversion as clean | `success: true` with omitted, null or nonboolean `reverted` could pass | Requires explicit `success: true`, `reverted: false`, verified effects and empty approval/transfer arrays; gas must be canonical decimal wei |
| Known-safe screen omitted negative inspection evidence | Missing/nonboolean proxy, delegatecall, approval and transfer flags did not block | Each hazard must explicitly be `false`; unknown values retain the existing blocking reason codes |
| Screen accepted coercible transaction fields | Arrays could become allowed selectors, calldata, amounts or receivers | Requires string transaction/address/selector facts; amount formatting remains canonical |
| Optional envelope chain/sender could contradict the reviewed mint | The outer chain and expected wallet were checked without validating supplied envelope `chainId` / `from` | When supplied, requires chain 4663 and the selected Punk Wallet sender; omitted fields remain compatible |
| Matching counters coerced unknown usage to zero | Null, booleans, empty strings and arrays could become zero counts | Daily/total counts must be nonnegative safe integer numbers; explicitly supplied opportunity counts have the same requirement |
| Matching monetary inputs coerced before comparison | Nondecimal balance strings or arrays/objects/numbers could reach economic comparisons | Wallet balance, price, gas, reserve and owner monetary limits require canonical decimal wei strings; arithmetic remains exact `BigInt` |
| Safety metadata lost malformed input at normalization | Null risk scores became zero; coercible safety statuses, supply and wallet limits could be accepted | Shared opportunity normalizer requires raw scalar types, including nullable numeric supply/wallet limits; matcher rejects unknown risk using `RISK_UNKNOWN` |
| Opportunity hazard flags became clean on normalization | Omitted or nonboolean flags became `false` | Shared opportunity normalizer requires explicit booleans and preserves true hazards for deterministic rejection |

The existing function signatures and result keys are unchanged. `SecurityScreenResult` retains `status, safeToConsider, reasons, selector, disclaimer`; `SimulationResult` retains `status, reasons, estimatedGasWei, expectedReceiver, executionAuthorized`. Simulation always returns `executionAuthorized: false`. Matching retains the existing intent/opportunity normalization and deterministic reason/score result. `RISK_UNKNOWN`, `WRONG_CHAIN` and `WRONG_TRANSACTION_SENDER` explain additional rejection cases, not new result fields or stored schemas. Invalid input still fails through `TypeError` where input validators already throw; failed simulation returns its existing failure result.

Existing valid fixtures pass, including case-insensitive addresses, ASK recommendations with an empty optional owner adapter restriction, and simulation with explicit clean evidence. To preserve current recommendation callers, omitted `opportunityMints` retains the existing zero default; an explicitly present null or undefined no longer does. Economic execution callers must supply measured counts and durable reservations. No policy result proves usage freshness or reserves a budget by itself.

Tests show exact reserve equality passes and one wei below `price + gas + reserve` fails, including amounts above JavaScript's safe integer range. Risk, paid-mode, price, gas, daily, total, wallet, supply and recipient limits remain deterministic. High preference scores and AI-supplied approval/instruction/execution fields cannot override these rejections in ASK, ASSIST or AUTONOMOUS. Extra authority fields in an intent are rejected by its existing exact-field normalizer.

## Separate executor findings sent to L and the lead

These are observed in the unmodified `broker/src/v4/executor.mjs` at this branch's audit revision. All reproductions used in-memory dependencies, fixed time `2026-09-13T12:00:00Z`, a valid ASSIST strategy, free mint, cached gas `100`, gas cap `500`, reserve `1000`, and zero usage unless noted. All returned `OWNER_APPROVAL_REQUIRED`, `submitted: false`, `productionAuthorized: false`; no chain or database was contacted.

| Finding and location | Exact mutation from the valid fixture | Observed outcome and required owner follow-up |
| --- | --- | --- |
| Actual simulation gas does not update reserve: `prepare`, original lines 42 and 70–73 | Balance `1100`, cached gas `100`, simulated gas `500`, reserve `1000`, gas cap `500` | Ready result reports `requiredBalanceWei: "1100"`; spending simulated gas leaves `600`, below reserve. Re-run deterministic matching with actual simulation gas and fresh balance before returning a review |
| Authority can change during async preparation: original lines 32–38 and 61–83 | The injected authority reader initially returns the expected owner; simulator changes its backing owner to another address | Preparation reads authority exactly once and returns ready. Refresh and bind authority after slow work. Final owner equality alone cannot detect transfer away and back; managed session/epoch and canonical-block continuity guards remain separate obligations |
| Mutable transaction breaks screen/simulation binding: original lines 52–63 and 81 | In `simulate({ envelope })`, replace `to` with another recipient, `valueWei` with `"999"`, and `data` with approval selector `"0x095ea7b3"`; return the earlier valid free-mint evidence | Ready ASSIST result contains the changed 999-wei approval transaction while screen/simulation remain `PASSED`. Snapshot and protect the exact validated envelope across dependencies and final output |
| Authority identity is not cross-bound: original lines 32–38 | Return matching owner/wallet with authority `tokenId: "94"`, `chainId: 1` for intent token `"93"` on chain 4663 | Ready result. Apply the agreed original-Punk authority binding to a fresh trusted reader snapshot; matching owner/wallet alone is insufficient |
| Caller usage is coerced before strict matcher: original lines 40–41 | Supply `usage: { dailyMints: null, totalMints: null }` | Executor converts both to zero and returns ready. Preserve raw scalar evidence for validation; a default is only appropriate for an explicitly supported absent field |

The generic executor still has no submission capability and rejects broad autonomous production operation through its existing execution boundary. These findings concern misleading or unsafe preparation, not evidence of a production transaction. The executor, execution boundary, durable store, Agent Account worker and selected paid-mint lanes were not edited here. Receipt recovery, nonce reservations, concurrent budget accounting and managed continuity require L's separate review.

## Shared-normalizer ingress correction

The initial audit of `broker/src/v4/opportunity.mjs` reproduced malformed evidence being discarded before matching. `Number(source.riskScore)` and `source.unexpectedApprovals === true` / `source.unexpectedTransfers === true` erased the original types. An offline composition reproduction with `riskScore: null` and `unexpectedApprovals: "true"`, normalized first, produced `riskScore: 0`, `unexpectedApprovals: false`, and then `matched: true` for an otherwise valid LOW-risk opportunity. Coercible safety-status/amount fields had the same pre-normalization limitation.

The lead extended exclusive ownership to this module to fix ingress directly. Its validator now requires numeric risk, nullable numeric supply/wallet limits, explicit boolean hazards, string safety statuses, decimal wei strings and primitive address strings. This prevents unknown supply from becoming zero, numeric amount precision loss, malformed receiver coercion and flags from becoming clean evidence. The existing enums, bounds, nullability and output keys remain unchanged. Normalization-to-matcher composition tests reject the reproduced malformed inputs, preserve explicit true hazards, and accept canonical valid fixtures. Existing SeaDrop ingest tests also pass.

Evidence already erased in stored data cannot be reconstructed by any input validator; trusted ingestion provenance still matters. Caller usage coerced upstream is similarly unrecoverable, which is why L is removing executor usage coercions. The matcher retains its raw owner monetary-limit check because the separate collecting-intent schema is outside this task and already documents decimal-string wei.

Trusted adapters and readers must supply actual inspection and simulation facts. A fabricated but syntactically valid `PASSED` object is not authenticated evidence. This patch does not add a universal proof schema, verify arbitrary bytecode, perform RPC simulation, bind a simulation block to a transaction hash, grant a skill wallet authority, or relax current-owner checks.

## Validation and integration

Initial new regression run: 12 test groups, 4 passed and 8 failed, reproducing unsafe acceptance before changes. The final focused run passed **58 tests**, including **15 new policy/simulation groups**:

```sh
node --test --test-concurrency=1 tests/v2-swarm-policy.test.mjs tests/v2-swarm-domain.test.mjs tests/art-broker-v2-foundation.test.mjs tests/art-broker-v2-pipeline.test.mjs tests/art-broker-v2-executor.test.mjs
```

The additional `node --test tests/art-broker-v2-discovery-ingestor.test.mjs` run passed **7 tests**, for **65 focused tests** overall. `node --check` passed for all four owned implementation modules and the new test file; `git diff --check` passed. No database, browser, full build, contract compilation, package installation or network/production operation ran. The shared `node_modules` symlink is untracked and excluded from the commit. No dependencies, skills/package hashes, API/UI, migrations, deployed contracts, ownership semantics or settings changed.

Integrate the owned commit, including its coordinated shared-normalizer fix, then apply L's executor corrections. Re-run these focused tests on the integrated candidate and let the lead run the broader serialized gates. The recorded unmodified-executor reproductions are audit evidence, not tests that require preserving those defects.
