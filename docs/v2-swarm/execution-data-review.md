# Execution and persistence review

Reviewed September 13, 2026 in the isolated execution/data worktree. Scope is generic prepare-only execution, a read-only history diagnostic, and source inspection of existing journals, roles, leases and V1 preservation. No production database, live RPC, keychain, signer, migration application or transaction broadcast was used. The policy specialist's `d36983f0d2696f29eec32c76536f8363e8f1f280` was integrated for compatible validation.

## Changes and interfaces

`StatelessV2Executor` retains its constructor, `prepare` arguments, result fields, attempt identity and ASK/ASSIST semantics. Both broad AUTONOMOUS execution and the `production` submission request remain blocked. Every returned fresh review still has `submitted: false` and `productionAuthorized: false`.

- Reserve arithmetic now uses the actual validated simulation gas, mint price and a fresh wallet balance. The reproduced balance 1100 / reserve 1000 / cached gas 100 / actual gas 500 / cap 500 case rejects with `MINIMUM_RESERVE_VIOLATION` in the policy error. Exact-boundary success returns the actual gas in `policyMatch`, while durable identity retains the original opportunity/strategy/nonce inputs.
- Authority is read again after reservation, adapter work and simulation; replay also refreshes after reservation. Owner or wallet changes reject. Supplied canonical chain, collection, token, activation and block binding are checked; refreshed binding cannot disappear, move backwards or change hash at the same height. Strategy and mint end times are rechecked with the current clock. Explicit unknown usage counts remain invalid instead of becoming zero.
- The adapter envelope, screening facts, authority and normalized opportunity are detached immutable plain data. The simulator receives the exact frozen envelope returned in a successful ASSIST review. Accessors/exotic objects reject; changes to adapter-retained transaction or screening data are detected after simulation and after the final authority read. Failure before the successful transitions records REJECTED rather than leaving a new attempt reserved. Existing evaluated screening/simulation summaries are reused; no universal proof schema was added.
- `PostgresV2ExecutionStore.transition` now supplies `approval_expires_at` when moving SIMULATED to OWNER_APPROVAL_PENDING, using database wall time plus the existing 90-second owner-assisted review lifetime. Its previous-state CAS, reserve uniqueness, parameters and response remain unchanged. Replay does not renew expiry. The source of the existing lifetime is `broker-v2-review-mint.mjs` and `owner-assisted-seadrop-mint.mjs`; no migration or approval state was added.

The generic executor has no production route instantiation in the inspected source. Its reviewed draft is not the deployed owner-assisted submission artifact. The generic store continues to return a durable status on replay, without reconstructing transaction calldata or claiming that a stored pending status is fresh signing authority. Usage is an injected snapshot, not a new live counter reader.

## Read-only archive diagnostic

The existing `check-directed-paid-live.mjs` uses hardcoded public providers, enters the coordinator's authorization-preparation simulation and writes an evidence file. The existing direct-relay readiness script reads a signer key. Neither is the bounded archive-only diagnostic added here.

`scripts/check-v2-execution-readiness.mjs` requires exactly `--read-only` and calls `checkV2ExecutionReadiness`. It accepts no release file, account, transaction, budget or signer argument. The normal CLI pins the checked-in selected #93 release. The helper supports trusted release/provider/clock injection for offline tests; it still checks canonical chain/collection/token scope.

The provider pair uses the existing HTTPS/distinct-host validator. Configuration precedence matches the selected history runtime: archive primary, normal primary, RPC_URL, then the public primary default; archive secondary, normal secondary, then the public secondary default. Existing environment values are used without being printed or changed. The diagnostic reads fresh heads and invokes the existing `verifyPaidHistoryAccess` for its 20,000-block lookback, including historical block/code/ownerOf/Transfer reads and two-provider agreement. Each HTTP request has a six-second timeout and no retries; there is no polling loop.

Output is limited to stable diagnostic codes, public block metadata, provider labels and bounded numeric HTTP/RPC codes. No URL, error message/cause, environment or client object is serialized. Exit codes are 0 for history access ready, 1 for unavailable/configuration failure, and 2 for missing or extra CLI arguments. `scope: SELECTED_PAID_HISTORY_ACCESS_ONLY`, `continuityVerified: false`, `productionAuthorized: false`, and zero database writes/public transactions explicitly limit the result.

This task did not run the CLI against live providers. The previously observed archive failures remain an external dependency. Successful access to this recent bounded range would not prove availability of every receipt block or authorize a mission.

## Persistence audit: source evidence and limits

| Surface inspected | Existing protection / finding |
|---|---|
| Generic V2 schema (`20260906010000`, `20260906083000`) | Unique idempotency key and transaction hash; strategy/opportunity/account/nonce fields; envelope/submission/confirmation constraints; unique COLLECTED activity per attempt. The hardening migration requires pending approval expiry. The generic store omitted that field; the minimal store fix above closes the demonstrated incompatibility. |
| Generic execution store | INSERT ON CONFLICT prevents duplicate identities; updates match the expected prior state; rejected transitions fail. It remains a prepare-only store and does not persist/recover signed bytes. Existing owner-assisted endpoints independently bind envelope hashes and verify receipts. |
| Selected paid schema (`20260913050000`) | Immutable review hash, revision increments, guarded state transitions, one live owner review and one signed/submitted signer hold, one execution per intent, immutable signed transaction columns, and append-only event revisions maintained by triggers. Terminal execution rows require receipt presence; chain/receipt truth is verified by the existing application reader, not inferred from JSON or SQL alone. |
| Selected paid roles (`netlify/database/review/directed-paid-roles.sql`) | RLS enabled on the three paid tables and PUBLIC access revoked by migration. Reviewed grants split request and worker updates; request-role execution SELECT excludes raw_transaction and transaction_json. anon/authenticated/service_role access is revoked in the separate reviewed role script. These are source guarantees only; this audit did not inspect deployed role membership or apply the role script. |
| Paid store/worker | Review hashes revalidated on decode; revision CAS on writes; exact raw signed bytes persisted before broadcast; signed transaction and signer recovered and compared on retry. Existing recovery waits for canonical receipt/delivery evidence and preserves ambiguous signed work. This task changed no paid journal, signer or reconciliation behavior. |
| Worker leases | Existing lease table has one holder per lane key and bounded expiry; the reviewed worker retains lease checks before signing, persistence and sending. No new scheduler, lease or worker path was added. |
| Forge training | Existing staged/settled migrations retain immutable review fields, revision CAS, unique transaction identity, receipt/finalized-block settlement constraints, RLS and event journals. No skill/training schema or role change was needed in this scope. |
| V1 retirement | Existing Netlify retirement finalizer serializes with a transaction advisory lock, releases reserved unsent paid jobs and waits for operational receipt reconciliation. Supabase retirement cancels unsent work while retaining submitted attempts and journals. Legacy link/history tables remain intact. Retirement is not evidence that historical liabilities were refunded. |

The generic V2 migration itself does not declare the selected paid lane's RLS/request-worker role split. The generic tables are used through authenticated server handlers; actual operational database privileges and any further least-privilege work need a separate deployment-role review. No production exposure is inferred solely from the absence of table-local RLS, and no broad grant or migration was proposed here.

## Security boundaries and remaining dependencies

Fresh current-owner equality cannot detect Alice → Bob → Alice or revoke an old on-chain signature. The deployed original-NFT account's round-trip limitation remains. The managed free/paid workers' canonical authorization receipt, transfer-history, session and lease checks remain required, including their final pre-sign/pre-send guards. This generic preparation change neither adds an ownership epoch nor activates the undeployed wrapper proposal.

The history diagnostic proves an RPC prerequisite only. Existing runtime pins, exact mission review, owner authorization, simulation, account/nonce/price limits, custody verification and signed-receipt reconciliation remain separate requirements. No broad execution switch, account deployment or recovery transaction follows from a diagnostic READY result.

## Validation

New `tests/v2-swarm-execution.test.mjs` covers actual/free/paid reserve arithmetic and caps, changed owner/wallet/balance at every slow step, immutable exact bytes, accessor rejection, adapter-retained mutations, failed fresh reads, identity/block changes and missing bindings, expiry, strict unknown counters, unchanged durable identity/replay, production blocks, store expiry/CAS query behavior, mocked two-provider archive agreement/failure/redaction, and CLI argument gating.

Offline combined command:

```sh
node --test --test-concurrency=1 tests/v2-swarm-execution.test.mjs tests/v2-swarm-policy.test.mjs tests/art-broker-v2-executor.test.mjs tests/punk-agent-ownership-continuity.test.mjs
```

Result: **137 passed, zero failed/skipped**, including **52 new execution/readiness tests**, in approximately 6.2 seconds. `node --check` passed for all four changed runtime/CLI modules and `git diff --check` was clean.

The existing original-owner round-trip/history-failure tests execute the actual managed guard with mocks; passing epoch research fixtures does not claim a deployed epoch account. No private keys, live providers, database mutation or public wallet operation is involved. The lead/P owns the separately serialized actual-migration PGlite proof for expiry, CAS and replay nonrenewal, plus full repository, contract and browser validation.

Only the executor, its exact PostgreSQL store, the new diagnostic/helper, the new execution test and this review are owned changes. The opportunity repository, policy/simulation/screen modules, paid journals, worker leases, signer, contracts, migrations, deployment manifests, V1 paths, site and shared node_modules symlink are intentionally unchanged by this specialist.
