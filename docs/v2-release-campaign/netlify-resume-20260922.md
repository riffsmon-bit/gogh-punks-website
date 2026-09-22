# Netlify release resumption — 22 September 2026

Status: **INTEGRATION AND VALIDATION IN PROGRESS; NOT A PUBLIC RELEASE CLAIM**.

The owner resumed V2 production completion on Netlify and explicitly paused Vercel migration. The original dirty checkout is preserved. No source data, original user work, wallet key, or migration backup was deleted.

## Recovered implementation

The published site is at `b442b44`, deployment `6aa7546a75582e0008ecf57b`. The existing draft PR is [#71](https://github.com/riffsmon-bit/gogh-punks-website/pull/71).

The integration branch recovered the saved campaign through `95f011a`, independent native administrator proof from `2bcf299`/`c4de669`, recovery fix `50e4ee4`, rendered administrator proof `ba08518`, and persistent-watch work `4f4ab74` plus `a4e22b6`, followed by bounded worker fix `b56d009` and paused-capability staging `2c07708`. The unfinished general-holder burn implementation and ownership-epoch candidate were not activated.

The recovered administrator panel prepares exact reviewed registry transactions, journals its wallet claim before prompting, and recovers original or replaced nonces. The new recovery fix permits reconciliation when a package was disabled after submission, without granting new preparation authority.

Persistent watching now mounts in Strategy, uses explicit sign-in, invalidates stale selections, and processes one bounded pass after shared discovery. It remains watch-only: no transaction prepared or submitted, no execution authorization, no additional scheduler or per-Punk process.

## Fresh production reads

- Netlify site/deployment metadata was authenticated and inspected without triggering a build.
- Netlify application database contains existing V2 identity, conversation, strategy, opportunity, execution, activity and skills tables.
- Supabase contains existing restricted Forge training journals. New skill-administrator journals/credential were absent initially; the two reviewed additive migrations were applied on 22 September at 12:31 UTC. Direct login as the dedicated restricted request role passed its runtime privilege verifier and reported zero saved reviews. `FORGE_SKILL_ADMIN_DATABASE_URL` is encrypted, Functions-only, for Production and Deploy Preview. Existing credentials and historical records were not changed.
- Secret metadata was inspected without printing values. Netlify returns masked values for protected secrets; presence is not proof a local client received usable credentials.
- The existing approved macOS Keychain archive item permitted a fresh registry read. At block `69647374`, Rarity Eye was READY/available; Contract Detective, Market Scout v2, Floor Hunter, Collection Researcher, Art Curator and Social Scout were unregistered with capability bits disabled.
- No production NFT burn, asset movement, bid, purchase, refund or chain write occurred during those checks.

## Validation record

| Check | Result | Limit |
| --- | --- | --- |
| Full contract suite | 310 pass / 0 fail; 1,024 fuzz runs | Includes tests proving the WETH release blocker; a passing suite does not make that path safe |
| Netlify deployment gate | PASS, including 140 targeted tests | Local build, not deployed acceptance |
| Integrated JS suite | 3,309 pass / 0 fail / 2 skip, 3,311 total | Includes preview-origin and migration-target regressions; two opt-in marketplace native proofs skipped |
| Focused marketplace integration rerun | 14 pass / 0 fail | Actual controller extraction, lightweight DOM fixture |
| Administrator recovery regression suite | 104 pass / 0 fail | Includes 20 new governance-block recovery cases |
| Seven-package isolated bundle | PASS, including missing/altered dependency rejection | Real esbuild output; separate actual Netlify ZIP was also generated locally |
| Administrator native PostgreSQL | PASS | Synthetic chain proofs, real database concurrency and crash recovery |
| Persistent-watch native PostgreSQL | 58 assertions PASS | Disposable local database |
| Administrator Chrome acceptance | 12 scenarios / 25 screenshots | Mock wallet and chain; widths 1440/375/320 |
| Watch Chrome acceptance | 8 scenarios | Mock services, widths 1440/768/375/320 |

PostgreSQL 16.15 was built from the [official release](https://ftp.postgresql.org/pub/source/v16.15/) after checking the published SHA-256. Native evidence is in `/private/tmp/gogh-native-validation-20260922-RxGCTN/`; its source-build directory was removed after testing, retaining the local test binaries.

## Remaining release boundaries

1. Administrator database provisioning is verified. Finish deployed package/route acceptance; on-chain registration still requires the administrator wallet.
2. Resolve read-capability activation without overwriting newer registry emergency controls. Merely removing an API check cannot provide atomic on-chain protection.
3. Verify watch runtime under the actual application database role, complete independent review and perform controlled deployment checks before enabling it.
4. Complete general-source history/inventory and operational-obligation composition before general holder burns. The existing reviewed-burn contract does not atomically protect against new wallet deposits while confirmation is pending.
5. Finish production marketplace composition and guard validation. Public WETH offers stay disabled until irreversible ownership invalidation is actually enforced.
6. Keep Bankr disabled; retain already configured providers. Broader autonomous spending is a separate staged rollout from persistent research watching.

The release estimate and its assumptions are maintained in [the Netlify V2 release plan](../NETLIFY_V2_RELEASE_PLAN.md). Tests, owner confirmation, deployment, and live holder acceptance are separate gates.

## Restricted database setup evidence

The hosted Supabase migration user can create roles but PostgreSQL gives its new-role membership `ADMIN=true, INHERIT=false, SET=false`. Two attempted verifications failed with `42501` and rolled back before credential creation. This was reproduced using a nonsuperuser native PostgreSQL 16.15 migration account. The reviewed fix grants `SET` inside a savepoint, verifies as the request role, then rolls back that savepoint so every prior membership row/option is restored exactly. Only then is the new login enabled and the schema transaction committed. Direct restricted login was independently verified after commit. No broad database role, browser credential, production signing permission or elevated runtime membership was introduced.

Safe operational report: `/private/tmp/gogh-skill-admin-provision-20260922.json`. Native permission-reproduction result SHA-256: `5f0da20f6b847d7a3ba1bb8a492d4cf6d1c721e08314631f0bdfe1cc239867b4`. Secret values never appeared in reports.

## Independent review

A reviewer who did not implement paused-capability staging approved its limited registration/recovery scope with no P0/P1 or new P2 finding. Registry registration/status transactions cannot change emergency controls. Live capability pauses still block learning, equipment and runtime tools. Rarity Eye's existing holder release remains unchanged. A separately authorized later capability unpause is outside this staging service; the document does not claim an on-chain mask precondition for `setStatus`.

The worker review's two cost issues were fixed: expired watches are excluded by database time before batch selection, and deadlines are checked between authority, continuity, checkpoint and economic reads. Transaction-local SQL/lock limits were tested against native PostgreSQL, including pooled connection cleanup.

## Deployment boundary fixes

The administrator route now uses the existing exact trusted-preview origin validator, retaining session/current-administrator checks. Nine route tests verify production and exact preview origins, reject cross-preview/untrusted origins, and reject signed-out or non-administrator access.

The two new administrator migrations moved, byte-for-byte, to `database/supabase/migrations/`. They target the manually provisioned restricted Supabase journal and must never be automatically installed by a Netlify application build. All 45 published Netlify migration files are unchanged. Netlify's production migration API confirms those same 45 names with `applied: true`; the only additional automatic migration is `20260914050000_add_persistent_watch.sql`. No production application migration was manually executed. The disposable SQL proof passes 40 assertions from the new path; a regression check rejects accidental admin-role SQL in Netlify's automatic migration directory.

Real Netlify ZIPs for administrator, watch API and discovery worker were generated locally, checked for exact raw skill-file bytes, required certificates, and accidental environment/key files. Their archive manifest is `/private/tmp/gogh-netlify-final-bundles-20260922/archive-validation.json`.

Fresh bounded production RPC reads passed current #93 ownership and recent continuity over nine pinned blocks. This does not prove unrestricted historical coverage or the Function's injected database role. The default Netlify database API connection is a read-only role, so it cannot substitute for a deployed trusted-runtime scope check. Watch tables are not yet deployed and the watch flag remains off.

The existing archive RPC pair is now explicitly configured for Functions in Deploy Preview as well as its existing production/branch contexts; production values were preserved. Preview training credentials remain intentionally unavailable, so a preview is not a live burn/training test. No preview scheduler or execution flag was enabled.

The two skipped JavaScript cases are opt-in native PostgreSQL marketplace-journal proofs, not the independently executed administrator/watch proofs. Marketplace purchasing remains disabled and is not certified by this release.
