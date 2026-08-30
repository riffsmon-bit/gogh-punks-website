# Supabase operational migration runbook

## Authority boundary

Robinhood Chain remains authoritative for Punk ownership, Punk Accounts,
authorization, limits, pause/revoke, and every execution permission. Supabase stores
sanitized operational evidence only. The production signer remains in the existing
server-only Netlify worker and is never stored in Supabase or browser code.

## Required configuration

Configure exactly one server-only PostgreSQL connection variable on the linked Netlify
project, scoped to Functions and the intended contexts:

- `SUPABASE_DATABASE_URL` (preferred), or
- `SUPABASE_DB_URL`.

The Broker does not require a browser anon key or Supabase service-role key for this
integration. Do not add either one merely to satisfy this migration.

## Schema

`supabase/migrations/20260830210000_create_gogh_broker_operational_shadow.sql`
creates:

- `gogh_broker_punk_state` — separated authorization and per-Punk worker state;
- `gogh_broker_punk_jobs` — durable, idempotent, independently leased Punk jobs;
- `gogh_broker_worker_runs` — run attempts and results;
- `gogh_broker_agent_activity` — bounded, sanitized activity evidence;
- `gogh_broker_ownership_projection` — canonical snapshots used only as hints;
- `gogh_broker_diagnostics` — sanitized operational categories.

All tables have RLS enabled. The claim function uses `FOR UPDATE SKIP LOCKED`, so one
leased or failing Punk cannot block another due Punk. The schema contains no signer,
signature, raw transaction payload, RPC credential, or Supabase credential columns.

## Staged rollout

1. **Disabled:** apply and verify the schema while
   `BROKER_SUPABASE_QUEUE_MODE=DISABLED`. No runtime connection is opened.
2. **Shadow:** set `BROKER_SUPABASE_QUEUE_MODE=SHADOW`. The existing Netlify worker and
   ownership reconciliation stay authoritative; successful canonical snapshots and
   worker outcomes are mirrored.
3. **Verify:** compare legacy runs, scheduled Punk IDs, per-Punk outcomes, ownership
   counts, failure isolation, latency, and missing-write rate. Do not proceed on drift.
4. **Canary:** select a bounded worker release, set the exact cutover release and
   acknowledgement, and process an operator-defined canary subset only. The canary must
   reuse the existing V3 ownership, authorization, adapter, price, cap, policy,
   simulation, and submission checks.
5. **Active:** only after repeated canary evidence and a reviewed rollback drill.

The cutover gates are:

```text
BROKER_SUPABASE_QUEUE_MODE=CANARY|ACTIVE
BROKER_SUPABASE_QUEUE_CUTOVER_RELEASE=<exact 40-character worker release>
BROKER_SUPABASE_QUEUE_CUTOVER_ACK=I_UNDERSTAND_PER_PUNK_QUEUE_CUTOVER
```

Without all three, queue enqueue, claim, and completion fail closed without opening the
database.

## Apply and verify

After placing the PostgreSQL URL in a local process environment without printing or
persisting it:

```sh
npm run broker:supabase:migration:check
npm run broker:supabase:migration:apply
```

The check prints only connection/table booleans. Apply is transactional, takes an
advisory lock, and verifies that all six tables exist. It never prints the URL,
database name, or role name.

## Rollback

Operational rollback does not require a chain transaction:

1. Set `BROKER_SUPABASE_QUEUE_MODE=DISABLED`.
2. Remove the cutover acknowledgement and cutover release.
3. Confirm the legacy Netlify schedule and worker release remain enabled.
4. Preserve Supabase rows read-only for audit; do not drop evidence during an incident.

Because shadow writes never drive execution, rollback from `SHADOW` is only the first
step. A canary/active rollback must also stop new Supabase claims and allow already
leased jobs to expire before the legacy scheduler resumes those Punks, preventing
duplicate signer work.

## Cutover evidence required

- exact legacy-versus-shadow scheduled Punk and outcome parity;
- zero cross-Punk failure propagation;
- idempotent retry proof;
- fresh live owner/authorization rechecks before every candidate execution;
- no duplicate transaction submission during a rollback drill;
- observed database latency and availability within the worker deadline;
- ownership projection counts equal pinned canonical `balanceOf` snapshots.

Until these checks pass in production shadow and canary runs, production cutover is
**not ready**.
