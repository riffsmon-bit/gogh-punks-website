# Durable training tracking and verified receipts

September 10, 2026. Isolated `feat/punk-transfer-epoch` worktree; original NFT design, no wrapper.

This checkpoint implements and tests another part of the production preparation work.
**It is not a production release, a live training coordinator, or authorization to burn.**
The production manifest is still `UNDEPLOYED`. The new SQL migration has not been applied
to Netlify or any production database. No production function imports the new store.
The two existing user practice servers were left running with their state intact.

## Implemented

- A strict, canonical reviewed-transaction format for learn, unlock, equip, unequip and
  rarity claim. It only encodes `applyTrainingReview`; there is no burn, marketplace,
  arbitrary target, arbitrary calldata, ETH-value or delegation field.
- A PostgreSQL store with immutable review bytes and SHA-256, database-time expiry,
  idempotency keys, row-locked claims, revision checks and atomic audit events.
- Token reservations span **owner changes and deployments**. Wallet nonce reservations
  also prevent two Forge reviews from preparing different Punk actions with the same nonce.
- A committed wallet-request marker precedes any future wallet request. A lost COMMIT
  acknowledgement does not return a usable claim. Retrying cannot reset the marker.
- Exact transaction-hash recovery: wrong sender, target, nonce, data, value, fee envelope,
  chain or transaction type is rejected. No replacement or resend implementation exists.
- Owner/deployment-scoped private review lookup. An unresolved-state query exposes only
  a boolean, so a buyer need not receive the seller's private review to respect the hold.
- Read-only receipt verification checks the transaction, pinned progression runtime,
  canonical review anchor, inclusion block, head consistency, gas envelope and exact
  `TrainingReviewApplied` plus operation-specific events. A revert grants nothing.
- Reorg observations require an actually changed canonical inclusion block. A missing
  receipt or RPC outage alone is not treated as successful training or proof of reorg.
- RLS is enabled and PUBLIC table privileges are revoked. No browser grants/policies
  are added. Provisioning and testing the actual server database role remains a release task.

The store does **not** maintain a parallel credit balance, learned-skill list or mastery
counter. Permanent progression remains contract state. It contains no chat history,
wallet key, signer, RPC client, Netlify secret lookup or activation switch.

## Deliberate safety and liveness boundary

Only an unsent `PREPARED` review can expire or be cancelled. Once a wallet request may
have happened, timeout and wallet rejection do not establish that nothing was broadcast.
Those records stay unresolved until reconciliation supplies evidence.

`INCLUDED_SUCCESS`, `INCLUDED_REVERT` and `REORGED` **retain their reservations**. L2
inclusion is not presented as finality. There is deliberately no browser-controlled
"clear pending" action and no finality/nonce-release method in this checkpoint.
This means the store is NOT yet suitable for enabling repeated live owner training.
A reviewed finality/recovery policy and its worker must be completed first.

This is a storage/attestation boundary, not owner authorization. A future coordinator
must authenticate every owner request through V2, verify current ownership and complete
Transfer history, pin the actual deployment and approved skill version, simulate, check
the owner-approved fee budget, and recheck immediately before exposing a wallet request.
The transaction must be sent only for the single successfully committed claim.
The browser may supply a recovery hash, **not trusted transaction or receipt facts**.

The reconciler may internally finish a seller's historic pending record after a sale.
That does not permit it to expose that private review to the buyer, send another owner
transaction, transfer private chat, or reactivate an economic mission.

The original NFT's away-and-back transfer limitation is unchanged. A training nonce
is not an NFT ownership epoch. The existing transfer-history safety guard remains required.

## Verification

- **76 focused JavaScript checks passed**, including lost COMMIT acknowledgement,
  corrupt review storage, wrong owner/deployment, replay, expiry, ambiguous submission,
  unsafe argument shapes, receipt substitution, orphaned anchors and changed blocks.
- **45 PostgreSQL/WASM SQL assertions passed** against the actual migration, triggers,
  partial unique indexes, JSONB behavior, hash constraints, expiry and audit rows.
- **Disposable Anvil + PostgreSQL/WASM end-to-end passed**: learn Contract Detective on
  fresh test Punk #44; deliberately leave the database without the hash; recover via a
  fresh store instance and verified RPC evidence; confirm exactly one reviewed action
  and one spent fixture credit; transfer the test NFT; retain the learned skill and
  deny buyer access to the seller's private review.
- Actual reviewed test transaction from the rerun:
  `0x9d82e0cb3cd8a8e0380ebbbf239e7b8bd344e2197fc40b93c3834c1ada48ffaf`.
  This exists only on a new disposable chain 31337, not Robinhood. Fixture setup includes
  mock mint/burn transactions; it neither uses nor changes the user's real Punks.
- **Full JavaScript regression: 1,556 passed**, zero failed/skipped, concurrency limited
  to two test processes to reduce load on the nearly full machine.
- **Focused Solidity regression: 34 passed**, zero failed/skipped, 1,024 fuzz runs;
  `GoghSkillForgeTest` and `GoghReviewedSkillProgressionTest`. No Solidity source changed
  in this checkpoint; this is not a claim of a new full-contract-suite run or external audit.
- Syntax checks passed for 571 JavaScript modules; ABI trust-boundary and EIP-170 size
  checks passed. Site/assets/secret checks and Art Broker checks passed. No public Netlify deploy,
  production database migration, or wallet SDK rebuild was performed.

The SQL engine was **PostgreSQL 18.3 compiled to WASM, PGlite 0.5.8**, downloaded from the
pinned npm version and checked against this SHA-512 before loading:

`n9tsbUOhwx2epK1V0ZG9Ar4SHWUju04dhmzZXiSBXwBoleOvIfals33NAaWgagQVAL4Rbvx/Ptsu3P+pA09f6Q==`

It runs entirely in memory; neither package installation nor disk database creation is
needed. This is real PostgreSQL SQL execution, but **not native multi-session contention,
disk durability, process-crash recovery, or a Netlify-role deployment test**. Its pool
adapter serializes checkouts because PGlite supports one exclusive connection. Those
limitations are explicit in both test output and this report. See [PGlite's documented
connection model](https://pglite.dev/docs/) and [PostgreSQL locking semantics](https://www.postgresql.org/docs/current/explicit-locking.html).

## Reproduce safely

```sh
node --test tests/skill-forge-durable-review.test.mjs tests/skill-forge-postgres-store.test.mjs tests/skill-forge-training-receipt-verifier.test.mjs
node scripts/test-forge-training-store-sql.mjs --pglite-memory
node scripts/test-forge-training-store-local-chain.mjs --disposable-only
```

The last command starts and closes its own Anvil instance. It never resumes either user
practice server. The memory tests fetch only the exact integrity-pinned test engine;
production code does not download or import it. No application dependency or lockfile changed.

A native runner is also prepared:

```sh
# Set FORGE_TEST_DATABASE_URL privately to a disposable loopback database named gogh_forge_test.
node scripts/test-forge-training-store-sql.mjs --local-postgres
```

It refuses non-loopback URLs, query-string overrides, other database names and unexpected
server identity. It creates a randomly named schema, uses independent pool connections,
and drops only that run's schema on completion. No production-database mode exists.
Native PostgreSQL is not installed on this machine and this variant has NOT been run.

## Remaining production gates

1. Native PostgreSQL concurrency/restart/role testing and reviewed migration application.
2. Canonical finality, unresolved/replaced-nonce recovery and reservation-release worker.
3. Actual V2 session/owner/transfer guard + production review/confirm/recovery endpoint
   and owner-wallet UI integration, with deployment readiness still failing closed.
4. Production training source and full Punk Wallet asset/recovery safety. A warning
   cannot make a funded or incompletely inventoried Punk safe to burn. #93 remains excluded.
5. Registry acceptance, equipped-capability enforcement and skill-specific end-to-end
   acceptance; this checkpoint promotes **no** skill to production READY.
6. Administrator wallet security review, fresh fee ceiling and explicit deployment /
   configuration authorization. The previously recorded administrator choice alone
   does not authorize any of these actions.
7. Reconcile the isolated feature branch with current core V2 before any public deployment.

Current machine storage is critically low (tens of MiB during this work). A temporary
test-package archive downloaded by this task was removed to restore writes. No user files,
practice databases or unrelated worktrees were deleted. The memory-only test runner avoids
installing its roughly 25 MB dependency on disk. Free space is still needed for native
database and release-build work; do not run a production migration as a substitute.
