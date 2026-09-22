# Netlify V2 release plan

Status: **NOT READY FOR THE FULL PUBLIC FEATURE SET**. Updated 22 September 2026.
Vercel migration is paused. This campaign preserves Netlify production and uses local validation before a coherent deployment.

## Production published 22 September 2026

The reviewed maintenance release is now published at commit `109b57fde726fdc2b2f461a85a4cef38e3888c11`, Netlify deploy `6ab27c0df8b88a0008b98e73` (13:02:59 UTC), through merged PR #72. Desktop/mobile signed-out browser checks matched all seven served-file hashes with no JS/CSP/HTTP errors. Protected production routes returned expected 401 responses. The production database has 46 migrations, including persistent watch. The watch execution flag remains off. This is not full public feature completion.

The optional paid Training Credit route is being added separately at **0.0005 ETH** per credit, treasury `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. Its release artifact is UNDEPLOYED and payments are disabled. See [paid training](v2-release-campaign/paid-training-implementation.md) and [holder feature rundown](v2-release-campaign/functionality-rundown-20260922.md).

## Preserved starting point

- Production: `https://goghpunks.xyz/broker/v2/`.
- Published Netlify deployment: `6aa7546a75582e0008ecf57b`, commit `b442b4425bf21b16d5186ed76333e2c42d3a6121` (14 September).
- Integration branch: `release/netlify-v2-main`, worktree `/private/tmp/gogh-netlify-main`.
- The original dirty checkout and paused Vercel branch remain preserved.
- Draft PR #71 already contains earlier skill-release work. Its remote head does not include all recovered recovery fixes.

The former version of this document understated existing functionality. V2 application tables exist in the Netlify database; restricted Forge training storage exists in Supabase. The Agent account, selected-owner paid-mint lane, Forge contracts, and Rarity Eye registration are already deployed. Historical evidence records Peppies World #1599 delivery to #93 and real provider probes. Those records are not fresh wallet-connected acceptance tests.

## Actual release gaps

| Area | Evidence now | Remaining release gate |
| --- | --- | --- |
| Holder shell, wallets, collection, chat, strategy | Existing production implementation; local deployment gate passes | Final integrated browser and production checks; mobile wallet handoff |
| Rarity Eye / selected-owner Forge | Current chain reports Rarity Eye READY and available | Existing canary remains scoped; owner wallet confirmation for real actions |
| Six additional read-only skill versions | Reviewed packages and runtime adapters; recovered registration UI/journal | Wallet registration/status steps (restricted administrator database now provisioned and verified), safe capability activation, holder release pins and authenticated use |
| Persistent watching | Shared worker and holder controls integrated; native SQL/browser tests pass | Trusted application-role composition, configured rollout and deployed checks; this is research only, not autonomous spending |
| General holder burn | Separate staged implementation, not mounted or released | Complete inventory/history bootstrap, authoritative obligations, pending-deposit safety boundary, composed holder tests |
| Directed paid mint | Existing owner canary for #93 / Peppies World, historical verified delivery | General adapter/collection release, paid capability, budget/reserve and owner acceptance |
| ETH purchases / floor sweeps | Signed-order adapters, guard, durable journal and panel exist | Real production source/screen/policy composition, restricted database, guard deployment and wallet canary |
| WETH bids | Disposable-chain tests exist; public lane blocked | Durable transfer invalidation and marketplace compatibility. Tests demonstrate old offers can revive on the present public path |
| Broader economic autonomy | Existing bounded account/session execution lanes | End-to-end skill/policy/budget/reserve integration and staged canaries. Watching does not grant spending permission |

At chain block **69,647,374**, only Rarity Eye among the seven reviewed read-only packages was registered and available. The other six were absent with their capability bits disabled. Registration and capability activation are different steps. The existing `setEmergencyControls(bool,uint256)` replaces the whole mask and pause state without an expected-state check; a stale wallet approval must not silently undo a newer safety pause.

## Engineering estimate, not a delivery promise

Estimates assume the current credentials remain accessible, one coherent preview/production pipeline works, and the owner is available for required wallet confirmations. Parallel work can reduce elapsed time but cannot remove those gates.

| Milestone | Planning allowance from completion of this integration batch | Dependency |
| --- | --- | --- |
| Reviewed Netlify maintenance / holder test build | Delivered 22 September | Published PR #72; full maintenance tests, database setup, preview and served-route checks passed |
| Broader usable read-only skills and research watching | 2–4 working days | Administrator confirmations, safe activation path and exact holder capability tests |
| General Forge and supported paid missions | Approximately 1–2 weeks | Inventory bootstrap and burn boundary accepted; supported adapters and controlled wallet tests |
| Public purchases, bounded floor sweeps, WETH bids and broader autonomy | At least 2–4 weeks of additional implementation/review/canaries | WETH authority design first; the current original-account path cannot meet the transfer invariant merely by changing a flag |

A fixed all-features public date is **not yet defensible**. In particular, WETH's authority decision can extend the schedule. A smaller reviewed release must not be called the complete V2 release.

## Fresh validation

- Contract suite: **310 passed, zero failed**, 1,024 fuzz runs.
- Netlify deployment gate: typecheck, wallet bundle, site checks, module syntax, manifest checks and **140 tests passed**.
- Integrated JavaScript suite: **3,309 passed, zero failed, two skipped**. Earlier adjacent-panel and session fixture integration errors were fixed. Final preview-origin and migration-directory boundary tests are included in that passing snapshot.
- All seven reviewed packages verified from an isolated build directory containing only configured Netlify included files; altered/missing dependency bytes rejected. Actual Netlify function ZIP also built locally.
- Native PostgreSQL 16.15 administrator proof passed, including twelve-way concurrency and crash/restart recovery. Persistent-watch native proof passed 58 assertions, including expiry, fair rotation and query timeout cleanup.
- Real Chrome fixture acceptance passed for admin and persistent-watch panels. These use mock wallets/chain transports and are not live wallet transaction claims.

See [current campaign evidence](v2-release-campaign/netlify-resume-20260922.md). No real NFT burn, purchase, bid, refund or unrestricted execution is authorized by these tests.
