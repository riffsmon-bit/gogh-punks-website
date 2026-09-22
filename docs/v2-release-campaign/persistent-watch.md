# Persistent watching: bounded release package

Status: **IMPLEMENTED / LOCALLY INTEGRATED / TESTED; production database review, packaging and deployment pending.** This package persists a Punk's research activity after a finite mint session finishes. It does not grant economic autonomy, create or renew a wallet permission, or submit a transaction. The existing fixed mint canary and its worker/session lifecycle are untouched.

## Holder behavior

1. Select a Punk on Robinhood Chain.
2. Open **Keep looking**. Set art preferences, exclusions, supply limit, websites/X requirements, reserve, mint/gas limits, daily limits and optional duration.
3. Select **Review watching settings**, inspect every field, then **Confirm · activate watching**.
4. Watching continues across browser close and finite wallet-permission exhaustion. Shared discoveries are evaluated without a per-Punk daemon or inference calls. Candidates and passes appear with their reasons and a UTC daily summary.
5. **Pause watching** immediately commits a new watch version once current ownership is verified. It stops subsequent watch claims and suppresses an unfinished observation. **It does not revoke an existing wallet mint permission.** The existing economic pause/revoke UI remains the way to stop spending.
6. Changing taste is another draft/review/confirmation. A conversational client can call the same prepare/confirm interface; parsed text alone never changes saved settings.
7. A transfer, including self-transfer or transfer away/back, detected in canonical Transfer history pauses watching and requires the current holder to explicitly review/reactivate. Taste stays attached to tokenId. Skills and wallets are neither changed nor reset by this package.

This is a holder research feature. It must not be labeled “autonomous execution activated,” “minted,” or “simulation passed” based on its output.

## Existing interfaces consumed

- `normalizeV2Opportunity` from `broker/src/v4/opportunity.mjs`; no new opportunity schema.
- Exact existing Agent deployment manifest + `readPunkAgentAccountRuntime`: pinned implementation/registry/account, actual balance and finite session state.
- Existing `createV2McpResearch.resolve`: real released/equipped tool availability; no manifest-only skill claim. If a holder/release is not eligible, skill state is unverified rather than fabricated.
- Existing authenticated V2 session, production/preview origin enforcement, no-store JSON/error contract.
- Existing `broker_v2_opportunities.normalized`, written by shared discovery. No per-Punk scanner or new schedule.

The recovered package does not modify the immutable/hash-pinned collecting intent, AgentAccount or deployment manifests. The September 22 integration adds the holder mount and a bounded follow-on call in the existing shared discovery worker. There is no separate watch schedule.

## Deployment configuration and SQL

Apply `netlify/database/migrations/20260914050000_add_persistent_watch.sql` using the reviewed additive migration pipeline. It creates three new tables only:

| Table | Purpose |
| --- | --- |
| `broker_v2_persistent_watches` | One token-scoped taste/config, current activating owner snapshot, version, ACTIVE/PAUSED/OWNER_ACTION_REQUIRED state and canonical history checkpoint |
| `broker_v2_persistent_watch_drafts` | One current 10-minute review per token/owner; no activation until confirmation |
| `broker_v2_persistent_watch_decisions` | Versioned/day-scoped idempotent shared observations; CLAIMED/DONE/CANCELLED lifecycle |

All tables enable RLS and revoke PUBLIC privileges. They contain no keys, calldata, signatures or economic permission. No browser policies or broad service-role grants are added. The trusted server role needs SELECT/INSERT/UPDATE on these tables and unfiltered SELECT on the existing shared opportunity table. The runtime checks both actual privileges and `row_security_active` before use; RLS-filtered results cannot masquerade as an empty index. Apply privileges only through the established reviewed server role. Do not add anonymous policies.

Only after migration, route, shared worker and holder mount are verified, set `GOGH_V2_PERSISTENT_WATCH_ENABLED=true` for Functions in the appropriate preview/production context. Unset or any other value disables new requests and scheduled reads. Existing permissions remain unchanged. `SITE_URL`, existing V2 session/database configuration and the configured Robinhood history-capable RPC are reused; there are no new secrets or paid services.

## Holder API

`GET /api/v2/punks/:tokenId/persistent-watch`

Requires authenticated V2 session plus fresh current ownerOf. Returns `watch`, derived `status`, recent `history`, UTC `summary`, and actual bounded `permission` projection. Every decision/status explicitly carries `executionAuthorized:false`, `transactionPrepared:false`, `transactionSubmitted:false`.

POST additionally requires the existing production/preview same-origin checks. Exact accepted bodies:

```json
{"action":"prepare","expectedVersion":0,"config":{"schema":"GOGH_PERSISTENT_WATCH_CONFIG_V1","likes":["pixel"],"dislikes":["anime"],"maximumSupply":2000,"requireWebsite":true,"requireX":true,"freeOnly":true,"maxMintPriceWei":"0","maxGasWei":"500000000000000","reserveWei":"10000000000000000","dailySpendWei":"3000000000000000","dailyCollectionLimit":3,"expiresAt":null}}
```

```json
{"action":"confirm","draftId":"<UUID returned by prepare>"}
```

```json
{"action":"pause","expectedVersion":1}
```

Use the latest returned version. Version zero means no prior watch. Prepare is not activation. Confirmation checks fresh ownership and continuous transfer history from the draft anchor. A stale review cannot overwrite pause or another confirmation. A duplicate confirmed review returns its current watch without reactivation. Superseded/expired review IDs reject. Token ID, owner, version and draft identity are checked server-side; browser state is not authority.

## Holder integration

The Strategy screen now mounts `createPersistentWatchMount` from `site/broker-persistent-watch-mount.js`, wrapping the original component below. Selection changes and wallet events invalidate the old component immediately, including events that return early while the wallet is pending or on the wrong chain. The mount probes the existing session cookie without requesting a signature. Its **Sign in to manage watching** button is the only watch entry point that invokes the existing explicit sign-in flow.

Every write rechecks that cookie, owner, expiry and captured selection before sending one serialized request. A changed session invalidates the saved draft, as do Punk/account/chain/context changes and account round trips. Failed fresh reads clear actionable data and drafts. Production and recognized authenticated deploy-preview hosts are supported; disconnected, wrong-chain, mock-preview and unsupported-host selections cannot access the watch API. Funding and permission buttons navigate to the existing screens; they do not activate a permission or payment. Existing administrator and Marketplace mounts are preserved.

Import `/broker-persistent-watch.js`, serve `/broker-persistent-watch.css`, and mount in an existing selected-Punk screen:

```js
const watcher = mountPersistentWatch({
  root: holderElement,
  request: async (path, { method, body }) => {
    // Reuse the existing authenticated request helper/cookie/session behavior.
    // body is an OBJECT, not serialized JSON. Serialize exactly once at fetch.
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return response.json();
  },
  onFund: identity => openExistingFundScreen(identity),
  onReviewPermission: identity => openExistingBoundedMintPermission(identity)
});
watcher.setIdentity({ chainId: 4663, context: 'PRODUCTION', tokenId: '93', owner, sessionVersion });
```

`context` may be `PRODUCTION` or the authenticated `DEPLOY_PREVIEW` context. Parent must pass null if disconnected, not authenticated, wrong chain or an unsupported preview. Call `setIdentity` on **every** selected Punk, wallet, chain, authentication or context change. Calling it increments an internal generation even when A→B→A restores the same address/ID. Old responses and draft confirmations are discarded. `setIdentity` loads one fresh snapshot; no browser polling loop is installed. `destroy()` clears the component and invalidates pending responses. `refresh()` is available after existing holder actions.

The component renders untrusted data through textContent, never HTML. Monetary inputs use integer decimal conversion, not floating point. Controls have 44px minimum targets, scoped responsive CSS, single-column mobile forms and no animated effects. Preserve the distinction **Pause watching** versus **Pause/revoke mint permission**. Do not wire a callback that silently activates a session.

A safe conversational integration is: derive the full proposed config from an existing AI draft → call prepare → show this review → confirm on explicit holder action. Never let an AI/tool call the confirm endpoint as an inferred consent step.

## Shared discovery seam

`netlify/functions/broker-v2-discovery-worker.mjs` now calls this seam once after a successful discovery run, including empty result sets. It reuses the ingest pool, and skips entirely behind existing background RPC/discovery gates or the default-off watch flag. The deployed tick uses **at most five watches**, the first 100 discovery summary IDs and up to 25 normalized stored opportunities. The watch budget is at most 15 seconds, reduced by time already spent ingesting; fewer than one second remaining in the 40-second soft work window skips the batch. An already-started RPC retains its own timeout. Watch failures produce a sanitized `UNAVAILABLE` result while preserving committed discovery, with no repeat watch call in the same tick.

Call **once** from the existing shared scheduled discovery tick, including idle ticks, after discovery work:

```js
await runPersistentWatchBatch({
  pool,
  opportunities: result.results ?? [],
  environment,
  limit: 25,
  maxDurationMs: 45000
});
```

The actual existing `result.results` are summaries (`opportunityId`, screening/status/reasons), not normalized records. This function extracts IDs and performs **one** SQL query for normalized records, then shares them across a fair bounded selection of active Punks. An idle empty array selects the latest 25 unexpired records already in shared storage. It does not rediscover URLs, invoke AI, sign, simulate, prepare, mint, renew or submit.

Up to 25 watches and 25 shared opportunities per tick; oldest unchecked watches rotate first, including failures. Duration-expired configurations are excluded using the database clock **before** selection and LIMIT, so they consume no worker slots or ownership reads. Their saved config, version and history remain available through the holder API with an expired status. Selection does not change or reactivate them.

The default soft 45-second batch budget is checked after loading shared opportunities, selection, the attempt timestamp, ownership, continuity, checkpoint and economics, and before each new observation. Each attempted watch is timestamped before RPC work so a slow provider cannot repeatedly starve the next Punk; this timestamp does not advance its ownership checkpoint. An already-started provider call retains its existing timeout. A confirmed transfer may still perform its safety pause, and an already-claimed observation may finish its bounded SQL finalization; neither starts another RPC. Worker SQL uses awaited transactions with transaction-local **3-second statement** and **500-millisecond lock** timeouts, restored on commit or rollback. Queries are never abandoned with `Promise.race`. Connection acquisition retains the existing pool timeout. These are soft phase boundaries, not cancellation of in-flight work or a hard request-duration guarantee. The deployed shared worker supplies its smaller remaining-time budget described above.

There is no promise that every opportunity reaches every holder under sustained feed volume: this bounded first release examines the selected shared slice, not an unbounded fan-out ledger. A durable source-event cursor/outbox would be needed before claiming complete feed delivery at larger scale. Metrics returned: COMPLETE/PARTIAL/DISABLED, checked, decisions, matched, pausedForTransfer, unavailable and opportunities.

Observation key includes watch version, UTC date, mint-window phase, canonical opportunity dedupe identity and meaningful safety/taste/price fields. Ingest timestamp churn does not duplicate history. Same research may be observed once again on the next UTC day, at window transition, or after a confirmed config version change. New balance/permission state appears immediately in the fresh status; historical reasons remain as observed until the next research observation. They are not a current financial decision.

## Financial integration fence — not implemented by this package

`assertPersistentWatchVersion({pool,tokenId,owner,watchVersion})` is an **additional off-chain check** for an explicitly watch-bound existing mission. It proves only that the matching version is currently ACTIVE and not duration-expired. A standalone SELECT followed later by an economic claim is not atomic and must not be advertised as instant financial pause.

Before an existing worker can claim the watch's Pause stops economic submission, parent integration must:

1. Bind a reviewed mission/session to the explicit watch version; never infer/upgrade an old canary binding.
2. Lock/check the watch row inside the **same database transaction** as the durable execution claim, using the execution store's existing lock order. Pause updates that row/version.
3. Recheck the binding immediately before submission, composed with fresh owner/continuity, session, adapter/code, skills, global pause, simulation, gas, reserve and pending-spend gates.
4. Reconcile already signed/submitted attempts without duplicate submission/accounting and explain their status; pause cannot unbroadcast a transaction.
5. Use actual wallet revocation for on-chain permission removal. An application check cannot revoke a signature or previously accepted user operation.

This package does not claim to close the existing AgentAccount validation-time transfer/roundtrip defect. The separate opt-in authority candidate is on branch `v2/campaign-authority`, commit `8ec0a6a98c8da61bf2ef7e5dc08830ddbe980cdd`. It requires explicit reviewed collection/holder decisions and integration before broad economic autonomy can be enabled. No existing economic authority is widened here.

## Trust and correctness limits

- Current ownerOf is anchored to a fresh canonical block (chain 4663); transfer logs are raw-decoded and block-hash checked, inclusive of both boundaries. Self-transfers, same-transaction away/back and transfer-back-to-original-owner all invalidate the logical watch. Missing/malformed/reorged/history-limit evidence fails closed; never treated as empty.
- Continuity is an **off-chain RPC attestation**, not an on-chain epoch. It is not a fix for marketplace authorization revival. A compromised/lying RPC may omit logs; existing reviewed RPC trust requirements remain. Historical coverage is bounded to 40,000 blocks (2,000-block pages, 8-second evidence window), so a prolonged outage may require a fresh explicit watching review. A freshly verified current owner can still view saved settings/version after a history outage, with watching reported SAFETY_BLOCKED; this provides a review/reactivation path without accepting the missing history.
- The runtime uses actual Agent account balance/session state. If verification fails, it reports SAFETY_BLOCKED and keeps only logical research active. Session expiry/exhaustion reports OWNER_ACTION_REQUIRED while still watching. Reserve exhaustion reports RESERVE_REACHED. Verified daily-cap exhaustion can report BUDGET_EXHAUSTED, with midnight UTC reset.
- Unified daily/pending-spend authority is deliberately not fabricated. The default watch economics context marks usage unverified and economic release blocked; the existing executor must provide actual financial checks per candidate. Taste matching never means eligibility. The default read adapter does not claim all collection wallets or deposited EntryPoint gas are spendable ETH.
- Mint Hunter must be positively verified/equipped; paid candidates also require a positively verified equipped Paid Mint License. This release's watcher does not unlock either skill, deploy a registry entry or modify the finite session. All candidates still require the existing execution review and fresh per-Punk simulation.
- No AI provider is part of the watch loop. Provider outage cannot broaden permissions. No new notification sending/service is introduced.

## Validation evidence

- `tests/persistent-watch.test.mjs`: **27 passed, 0 failed** in the focused command below, covering strict config, independent finite permissions, UTC/budget/reserve/skills/screen/simulation reasons, duplicate observation identity, raw canonical transfer histories, wrong chain/current owner, stale/reorg/malformed evidence, wallet A→B→A, explicit confirmation, double-click suppression, exact ETH decimals, authenticated/origin-protected route, disabled flag, actual pinned Agent runtime fixture and RLS/slow-loadout fail-closed behavior. Added phase-boundary tests prove no economics after ownership/continuity/checkpoint exhausts the budget, fair rotation after slow continuity, and bounded completion of an already-claimed observation.
- `node tests/persistent-watch-postgres.integration.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin`: **58 assertions passed** on September 22, using the native PostgreSQL production migration and concurrent pooled transactions. Covers CAS activation, duplicate confirmation, stale review after pause, no future claim after pause, pause between claim/finish, shared future opportunities, process restart, transfer/reactivation, expiry, reserve, RLS and JSON authority constraints. Added native proof excludes older expired rows before the five-slot limit even with a skewed worker clock, rotates the next active Punk, retains expired holder history, and verifies real lock/statement timeouts restore settings and leave the same pooled connection usable after rollback. No production SQL or chain transactions.
- Recovered ownership continuity, worker lease and mint-research runtime regression baseline: **105/105 passed**, including the first 14 watch tests.
- September 22 integration and cost follow-up: `node --test tests/persistent-watch.test.mjs tests/persistent-watch-mount.test.mjs tests/persistent-watch-worker.test.mjs tests/art-broker-v2-discovery-ingestor.test.mjs` passed **54 tests**, including the actual session-aware mount, pre-write A→B→A and identity races, changed/expired sessions, stale-read clearing, default-off ticks, idle ticks, shared-pool reuse, large feed bounds, remaining-time limits and isolated watch failure.
- `node scripts/test-persistent-watch-browser.mjs --fixture-only` passed rendered Chrome acceptance at 1440, 768, 375 and 320 pixels, with no horizontal overflow and 44px buttons. It exercises explicit sign-in, review/confirm, saved watch reload, pause, session invalidation and untrusted taste text using the actual holder fragment, mount and controller. This is a local fixture, not production session/chain proof. [Evidence](persistent-watch-browser-evidence.json).
- `node scripts/code-check.mjs` passed syntax checks for 872 modules; `node scripts/site-check.mjs` passed seven pages and the asset/dimension/secret checks at this integration checkpoint.

## Remaining release gates

The existing application session/ingest paths use `getDatabase().pool`; this integration shares that trusted application role and introduces no credential or privilege fallback. The additive migration enables RLS and revokes PUBLIC, matching existing staged V2 tables. It does **not** provision grants for an assumed production role. Before release, review the actual application-role identity and its unfiltered SELECT/INSERT/UPDATE access to all three watch tables plus complete SELECT on `broker_v2_opportunities`. The runtime rejects filtered RLS views. No production SQL was applied here; the fresh native PostgreSQL result above uses an owned disposable cluster and does not establish production role privileges.

Both `broker-v2-persistent-watch` and `broker-v2-discovery-worker` must include the same raw reviewed skill packages, runtime/dependency source bytes, training release and CA certificate used by `broker-v2-mcp`; this is required because the watch economics reader verifies packages from `process.cwd()`. Parent release integration owns those `netlify.toml` entries and bundle validation. Production served-file, real-session/current-holder and RPC/history checks remain outstanding. Keep `GOGH_V2_PERSISTENT_WATCH_ENABLED` unset or false until these gates pass. Default economics still reports `usageVerified:false` and `globalExecutionPaused:true`; no financial execution integration was added.

All validation uses owned disposable resources. No production funds, NFT burns, refunds, bids, transfers, wallet module installs or collection administrator changes were performed.
