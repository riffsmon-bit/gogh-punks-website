# Forge training database rollout review

Status: prepared and tested locally; no production migration or role change applied.
The release artifact remains `UNDEPLOYED`. Talk uses its existing broker services.

## Reviewed order

1. Verify the production database target and take its normal recovery checkpoint.
   Apply `netlify/database/migrations/20260910180000_stage_forge_training_intents.sql`
   followed by `20260911140000_settle_forge_training_intents.sql`, through the
   existing administrator migration workflow. Do not rewrite the earlier migration.
2. Review/apply `netlify/database/review/forge-training-roles.sql` as the migration
   owner. It creates separate restricted `NOLOGIN` request/worker groups, explicit
   grants and RLS policies. It is deliberately outside automatic migrations.
3. Provision two separate server login principals with inherited membership in
   exactly their corresponding group. Neither may own the tables, inherit the
   migration owner, bypass RLS, be a superuser or inherit broad application access.
   Browser and public roles get no grants. Store credentials through the hosting
   environment's secret configuration, never in Git or review artifacts.
4. Set `FORGE_TRAINING_REQUEST_DATABASE_URL` and
   `FORGE_TRAINING_WORKER_DATABASE_URL` for the intended deployment context. Use
   credential-bearing PostgreSQL URLs with no query options; the runtime fixes
   TLS certificate verification, schema, timeouts and pool limits. It never falls
   back to the application's broad database credential.
5. Use `verifyTrainingDatabaseRole(pool, 'request')` and the corresponding worker
   check with the actual principals. Then complete the deployed contract/runtime,
   owner allowlist, accepted skill pins and fee review before changing the shared
   release artifact to `OWNER_CANARY` and rebuilding the browser bundle.
6. During the owner canary, verify one committed review/claim, receipt recovery,
   audit revisions, worker lease and terminal settlement. The request route binds
   the verified transaction hash; receipt status and settlement are worker writes.
   The browser must never reopen a claimed review after a lost response or reload.

The native PostgreSQL test executes this exact grant/policy template in its owned
temporary cluster. It tests separate sessions, an immediate database crash,
uncommitted rollback, denied browser/request writes and worker settlement.
It does not establish the permissions of a production credential.

## Pause and recovery

Set the release status to `PAUSED` and `productionTrainingAuthorized` to `false`,
retaining all deployed address/runtime pins. New reviews and wallet requests stop;
the scheduled worker continues settling existing intents with its restricted role.
Keep the worker credential and job table until all outstanding reservations settle.

Do not revert this schema, delete intents/audit records, remove the worker, or change
contract deployment identity while claims are outstanding. Changing owners, skill
acceptance or fee limits does not change deployment identity. A new contract address
or runtime does: drain/reconcile the old deployment before a separately reviewed
cutover. A paused browser cannot start research or training.

RPC failures, non-finalized evidence and worker timeouts retain the reservation.
Leases expire for another worker to retry; elapsed browser time never proves success.
No operator should release a hold by editing status or inventing settlement JSON.
