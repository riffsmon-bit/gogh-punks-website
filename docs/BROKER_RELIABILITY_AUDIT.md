# Broker reliability audit — 2026-08-30

## Production drift

- Repository `main`, the production `/broker/` HTML, and this branch started at
  `99323857124d54818d4886c31e2b795830f96e1a`.
- Production's persisted V3 worker heartbeat reported release
  `0c9280db31645f74d6f8ab07d13c90d582669905`, an older ancestor. The deployed
  frontend was current, but `BROKER_AUTOMATION_V3_WORKER_RELEASE` / persisted worker
  evidence had not advanced with the frontend release.
- The production schedule is `2-59/5 * * * *`. Deploy previews do not run that
  schedule; their read-only status and manual bridge intentionally use production
  evidence.

## A–Q production data flow

| Stage | Implementation and authority | Cache/failure behavior |
| --- | --- | --- |
| Wallet connect / restore | `site/wallet.js`, Reown AppKit, one shared snapshot | Restored connection is advisory until account and chain settle; revisions prevent stale wallet work replacing a new account. |
| Robinhood Chain | chain ID 4663 from reviewed site configuration | Wrong-chain state blocks ownership/actions and offers a network switch. |
| Canonical balance | `balanceOf(owner)` on the canonical collection through `broker-owner-punks.mjs` and a browser completeness assertion | Never inferred from metadata, V3 accounts, mandates, or agent rows. |
| Owned token IDs | indexed DB/OpenSea/local hints, then Multicall `ownerOf`; count mismatch triggers bounded server reconciliation | Hints accelerate only. A complete reconciliation is persisted atomically. |
| Ownership index | `broker_punk_ownership` rows maintained from verified snapshots | A stale or empty index must not publish a final empty roster before canonical reconciliation. |
| Metadata / art | indexed metadata plus lazy on-chain decoration | Optional enrichment; failure must leave the token card visible. |
| Punk account state | reviewed registry `account(tokenId)` and `isAccountCreated(tokenId)` batched through Multicall | Enrichment only; absence cannot filter an owned Punk. |
| Authorization | V3 Punk/account policy read by the live action/status paths | On-chain, Punk-specific authority. It is independent of hosted-worker health. |
| Enrollment | `broker_automation_v3_enrollments` | Persistent scheduler roster, not spending authority. |
| Punk worker evidence | `broker_punk_agent_heartbeats` and bounded activity rows | Per-Punk evidence only; a global failure must not rewrite it. |
| Platform heartbeat | `broker_automation_v3_worker_state` plus append-only run history | Previously stored only the latest attempt. A single failure therefore made the public platform status globally offline. |
| Schedule / rotation | `broker-autonomy-v3-worker.mjs`, `run-automated-seadrop-v3-worker.mjs` | Five-minute schedule, bounded batch, oldest scheduled/actual scan first. Per-Punk outcomes are persisted separately. |
| Mint submission | deterministic reviewed adapter/runtime/policy path | Live owner, authorization, price, runtime, limits, and simulation remain fail-closed. |
| Activity | Punk heartbeat/activity tables and `/api/broker/autonomy-v3-activity` | Browser reads persisted evidence, not per-Punk chain polling. |
| NFT inventory | Punk Control Center inventory API/index plus live validation before withdrawal | Loaded on demand; never required for the launcher roster. |

## Proven causes

1. `workerHeartbeatIsCurrent` rejects the entire platform whenever the *latest attempt*
   is `FAILED`, even when the immediately preceding successful worker run is fresh.
   The public status and activity endpoints reused that execution-safety boolean as a
   user-facing availability signal, producing false mass-offline cards.
2. The persisted singleton did not retain `lastSuccessfulRun` or consecutive failure
   count, so the UI could not distinguish one retryable failure from an extended outage.
3. Per-Punk summary logic promoted stale/missing worker evidence to holder-facing
   `NEEDS_ATTENTION` without first considering platform delay/recovery.
4. `/broker/` initializes ownership, activation, all-agent monitoring, withdrawal,
   mandate, wallet funding, and automation systems together. This duplicates requests,
   delays the first useful roster, and lets optional subsystems destabilize the launcher.

## Changes required by this audit

- Retain strict latest-attempt evidence for transaction submission, but publish an
  independent platform-health model derived from last success, recency, release, and
  consecutive failures.
- Publish authorization, per-Punk worker state, and platform health as separate fields.
- Add explicit ownership lifecycle/diagnostics and never render a false empty result.
- Reduce `/broker/` to wallet + canonical owned-Punk launcher. Load activation, agent,
  inventory, mint, withdrawal, and activity only in `/broker/punk/:tokenId`.
- Keep privileged mutations on fresh live chain checks; no on-chain security gate is
  weakened by these UI/availability changes.

## Supabase staged operational migration

The reviewed target is additive. It does not replace Robinhood Chain authority or the
current V3 executor:

```text
Robinhood Chain (owner, account, authorization, limits)
                         |
current Netlify worker --+--> Supabase shadow evidence
                                  |
                           per-Punk durable jobs
                                  |
                       canary worker after evidence
```

`20260830210000_create_gogh_broker_operational_shadow.sql` creates six RLS-enabled
operational tables and one atomic `FOR UPDATE SKIP LOCKED` claim function. Each queue
row belongs to one Punk, has its own lease/attempt count, and is completed or retried
independently. Queue enqueue, claim, and completion additionally require:

- `BROKER_SUPABASE_QUEUE_MODE=CANARY` or `ACTIVE`;
- an exact worker-release match;
- the explicit cutover acknowledgement.

The current worker remains authoritative in `SHADOW`. Shadow persistence errors are
logged but cannot alter a mint result, hide an owned Punk, or strand the legacy worker.
Canonical ownership snapshots may be mirrored only after `balanceOf` and every returned
`ownerOf` have reconciled at the same pinned block. Supabase is not read as ownership
authority during the shadow phase.

The linked Netlify project did not expose a Supabase PostgreSQL variable during the
2026-08-30 audit, so this schema is intentionally not applied and the mode remains
`DISABLED`. See `docs/SUPABASE_OPERATIONAL_MIGRATION.md` for the evidence gates and
rollback procedure.
