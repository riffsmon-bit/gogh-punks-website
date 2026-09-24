# Fund before starting a mission — 2026-09-24

Status: LOCALLY VALIDATED RELEASE CANDIDATE. Independent scoped review found no P0/P1 issue. Preview and production verification are pending.

Base: production `6749c6d94519a5284d4b898ac9be4848348d7c54` (Swarm Wallet release, PR #79). Production Swarm verification: Netlify `6ab517294fb0da0008fcae65`, 15 desktop/mobile screenshots, 29 matching served sources, zero browser errors, protected holder endpoints returned 401, AI provider list empty. These checks did not create or fund a real holder wallet.

## Problem and behavior

Creating a new Punk Agent Account used the same setup artifact as mission authorization. The UI then returned the holder to funding after permission was already granted. Holders could mistake wallet activation for preparation only.

The holder path is now **Fund → Review rules → Start mission**. Fund creates the Agent wallet only if needed, using one reviewed, simulated, zero-value call to the existing pinned registry. Funding is separately reviewed. Start mission requires a created, currently owned Agent wallet with verified native ETH above the reviewed reserve and accepts exactly one mission-permission transaction. The legacy backend artifact format remains compatible; the public page rejects a combined creation-plus-permission artifact.

Unfunded drafts stay saved while the page opens Fund. Existing active permissions are not revoked by creation checks or funding. An active mission may resume after receiving gas; users do not need Recall merely to top up. Changing an active mission still requires the existing recall/review boundary.

## Transaction boundary

Creation uses fixed registry `createAccount(tokenId)`, zero value, pinned runtimes and deterministic address, current ownership, chain, nonce, simulation and fee cap. Its owner-scoped durable journal is separate from funding. Web Locks, saved pre-wallet intent, receipt confirmation and replacement/cancellation recovery prevent automatic retries. It never calls the mission setup or receipt API and never funds or configures a session.

No contract deployment, database migration, custody change, AI provider, broad execution enablement or real holder transaction is included. Contracts and worker policy retain their existing limits. Browser automation uses explicit fixtures and never signs owner transactions.

## Validation

- Full JavaScript suite: **3,778 passed, 0 failed, 2 existing optional skips** (3,780 total). The new panel test file was added after the full-suite glob was expanded; all 22 panel tests passed separately and are included in the deployment gate.
- Final focused integration: **144 passed**, including 54 creation helper, 22 panel and 68 activation/funding checks. New tests cover wrong owner/chain, stale reads, mutated calldata, fee/nonce changes, duplicate requests, wallet rejection, unknown responses, reload, replacements/cancellations, receipt finality and selection races.
- Typecheck, production wallet bundle, site/secrets scan, syntax check (975 modules), broker manifest check: PASS. No Solidity changes; prior contract release validation is preserved rather than claimed as newly executed.
- Production read-only checks: #93 existing registry/Agent runtime verified at block 71378973. #1135 creation was simulated (48 bounded RPC reads/calls, zero-value createAccount); maximum fee at that sample was 5979089016000 wei. No transaction was sent.
- Local browser at 1440, 375 and 320 pixels: 30 screenshots, 31 matching served sources, zero application/console/network errors and no horizontal overflow. Verified fund-first redirect, saved draft, explicit mission review, reserve/recall display, Swarm review/funding, notifications and zero-Punk Swarm Wallet access. Evidence: `/private/tmp/gogh-preview-browser-evidence-BUyTbG/result.json`, code commit `a5e8961f8b5ae70bf5694cc7d84e03eac5c67acb`.
- Independent review: no concrete P0/P1 in this changed scope. Corrected misleading active-top-up wording. Updated an old wording assertion and a browser fixture that supplied only prepaid gas; both were test expectations incompatible with the truthful new flow.
- Owner-confirmed account creation/funding/mission actions remain holder wallet tests. Automated checks did not sign or send any transaction.
- Preview / production: pending. Release does not activate any Punk automatically.
