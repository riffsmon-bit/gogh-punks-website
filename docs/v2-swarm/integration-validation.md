# V2 integration validation

Validation date: September 13, 2026. Runtime candidate: integration commit `780b41b`; compiler candidate: `9169176`, which adds only the owning simulation JSDoc correction described below. This is local validation; no production deployment or transaction is implied.

## Scope and compiler contract

`tsconfig.v2-domain.json` runs TypeScript 5.9.3 with `strict`, `noEmit`, `allowJs: true`, and `checkJs: false`. Its roots are `tests/types/**/*.mts`. Imported JavaScript supplies the authoritative JSDoc and inferred result shapes; existing JavaScript implementation bodies and third-party declarations are not a repository-wide checked TypeScript migration (`skipLibCheck` is enabled).

The compiler-only consumer imports `domain/index.mjs` and `domain/types.mjs`, compares derived aliases with their owning function return types, and rejects aliases that collapse entirely to `any`. Positive consumers cover canonical identity, immutable ownership/read models, nullable strategy state, bigint registry masks, learned/equipped snapshots, capability and simulation results, activity, and the provider interface. Negative `@ts-expect-error` assertions require compiler errors for numeric token IDs, other chains, owner fields in stable identity, read-model mutation, lossy balances/masks, wallet signing methods, economic authority from skills/simulation, unknown execution states, un-narrowed activity detail, invalid AI tasks and malformed provider input. A removed constraint makes the associated directive unused and fails the gate.

These checks protect explicit consumer-facing constraints. They do not prove every nested field of every inferred legacy return type is fully typed, nor replace runtime normalization, current-owner reads, package verification, policy, simulation or execution authorization.

Two owning-source issues were found through real typed consumers and coordinated with the lead rather than papered over with duplicate local models:

- The AI base class originally inferred a zero-argument, `void` `invoke`, despite adapters implementing `invoke(task, input)`. Lead commit `9a8e62f` documents the existing task/input/async-result interface.
- The security/simulation merge returned the validated raw gas field from an untyped legacy input, which widened `estimatedGasWei` to `any`. The nullability negative assertion failed after integration. Lead commit `9169176` adds the owning-function JSDoc return annotation to preserve the authoritative `string | null` result; the compiler gate then passes.

Run the scoped gate with:

```sh
node node_modules/typescript/bin/tsc --project tsconfig.v2-domain.json --pretty false
```

The lead owns the pinned TypeScript dependency, lockfile and `typecheck:v2-domain` package script.

## Cross-subsystem regressions

`tests/v2-swarm-integration.test.mjs` imports the real recovery panel, controller, API handler, core preparation, pinned-runtime guards, custody verifier, progression reader, skill gate and execution store. It mocks platform boundaries: a minimal DOM, wallet/RPC responses, authenticated session and browser storage/locks. It uses the common public runtime fixture from `tests/fixtures/punk-agent-runtime.mjs`, verifies its deployed hashes, and makes no network requests.

| Regression | Executed evidence |
|---|---|
| Agent NFT recovery from current holdings | A live-verified fixture holding prefills the actual panel; the real API prepares the review. The panel passes a deeply frozen displayed review to the real controller. The controller journals `WALLET_REQUESTED` before the sole mock wallet request. Eleven confirmations stay `SUBMITTED`; twelve plus the exact transfer event settle `CONFIRMED`. A fresh custody read excludes the delivered NFT. A later unavailable custody read remains unavailable rather than borrowing the receipt as ownership proof. |
| Transfer after displayed review | The chain fixture changes original owner between review and confirmation. The real API returns 409 during revalidation; no mock wallet submission occurs and the UI requires a new confirmation. |
| Ambiguous wallet result | A lost wallet response leaves the durable request journal unresolved. Remounting the actual panel cannot open another review; the original matching transaction hash and exact receipt complete recovery with one total mock wallet request. |
| Cross-tab review substitution | Another real controller sharing storage cancels the unsent NFT review and prepares a native withdrawal through the real API. Confirmation in the first panel still carries its displayed NFT review. The controller rejects the substitution before wallet I/O and the panel clears confirmation. |
| Transferable progression, fresh owner authority | The pinned progression reader rereads unchanged learned/equipped state after original owner transfer. Stable Punk identity and learned level persist; the old owner cannot invoke research or activate their conversational draft for the new owner. The new owner can invoke equipped research. Structured model output asking to sign a transaction cannot reach even an injected signing implementation through the real skill gate. |
| Durable approval expiry | One in-memory PGlite instance executes the original opportunity, execution and activity table DDL plus the entire existing owner-assisted receipt-hardening migration. The live constraint rejects approval without expiry. The real store transitions `RESERVED → SIMULATED → OWNER_APPROVAL_PENDING` with an expiry bounded by database clock readings plus exactly 90 seconds. Invalid ordering and repeated approval transitions fail CAS; idempotent reserve replay preserves one row, original expiry and absent transaction hash. |

The SQL case reproduced the actual pre-fix store failure (`23514`, `broker_v2_execution_attempts_approval_expiry`) before the execution-store change was integrated. It passes with lead commit `780b41b`. No copied replacement DDL, mock query matcher or static source assertion supplies the SQL result. This is a bounded compatibility proof, not a claim that every migration or PostgreSQL role/RLS configuration was exercised.

## Results

| Command | Result |
|---|---|
| `node --test --test-concurrency=1 tests/v2-swarm-integration.test.mjs` | 6 passed, 0 failed, 0 skipped; includes the real PGlite regression. |
| `node --test --test-concurrency=1 tests/v2-swarm-domain.test.mjs tests/punk-agent-recovery.test.mjs tests/punk-agent-recovery-api.test.mjs tests/v2-swarm-frontend.test.mjs tests/art-broker-v2-collection-holdings.test.mjs` | 106 passed, 0 failed, 0 skipped. |
| Scoped compiler command above | Passed on `9169176`, with all positive consumers and required negative assertions checked and no files emitted. |

PGlite ran alone in the agreed heavyweight-validation slot and was closed in `finally`. Contract/Foundry, real browser layout, full JavaScript/deploy checks and independent security review remain the lead's separate integrated gates. The minimal DOM here verifies behavior, not rendering, responsive layout or browser-specific wallet compatibility.

## Security and integration notes

Production signers, RPC credentials, source skill files, contracts, financial operations, paid journals and migrations are unchanged by this test contribution. The test process sets only the fixed nonsecret `SITE_URL` fixture configuration. All wallet submissions are an offline mock method and all database writes are inside disposable in-memory PGlite. No package or skill is installed by the tests; the research catalog is loaded from existing hash-pinned files, and readiness is changed only in an in-memory fixture.

The progression test demonstrates reader/gate behavior against a transfer fixture. It is not an on-chain transfer or a substitute for the contract suite's persistence proof. Permanent invalidation after ownership round trips remains constrained by the deployed account; managed history/continuity guards still matter. Working independent archival RPC providers, production skill adoption, deployment and any owner financial action remain separate prerequisites and authorizations.

Owned files are this report, `tsconfig.v2-domain.json`, `tests/types/v2-domain-contracts.mts` and `tests/v2-swarm-integration.test.mjs`. The lead owns shared provider/simulation annotations, common runtime-fixture extraction, package files and integration into the main validation commands.
