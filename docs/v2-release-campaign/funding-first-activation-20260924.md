# Fund before starting a mission — 2026-09-24

Status: IMPLEMENTED; local validation and release review in progress. Not yet deployed.

Base: production `6749c6d94519a5284d4b898ac9be4848348d7c54` (Swarm Wallet release, PR #79). Production Swarm verification: Netlify `6ab517294fb0da0008fcae65`, 15 desktop/mobile screenshots, 29 matching served sources, zero browser errors, protected holder endpoints returned 401, AI provider list empty. These checks did not create or fund a real holder wallet.

## Problem and behavior

Creating a new Punk Agent Account used the same setup artifact as mission authorization. The UI then returned the holder to funding after permission was already granted. Holders could mistake wallet activation for preparation only.

The holder path is now **Fund → Review rules → Start mission**. Fund creates the Agent wallet only if needed, using one reviewed, simulated, zero-value call to the existing pinned registry. Funding is separately reviewed. Start mission requires a created, currently owned Agent wallet with verified native ETH above the reviewed reserve and accepts exactly one mission-permission transaction. The legacy backend artifact format remains compatible; the public page rejects a combined creation-plus-permission artifact.

Unfunded drafts stay saved while the page opens Fund. Existing active permissions are not revoked by creation checks or funding. An active mission may resume after receiving gas; users do not need Recall merely to top up. Changing an active mission still requires the existing recall/review boundary.

## Transaction boundary

Creation uses fixed registry `createAccount(tokenId)`, zero value, pinned runtimes and deterministic address, current ownership, chain, nonce, simulation and fee cap. Its owner-scoped durable journal is separate from funding. Web Locks, saved pre-wallet intent, receipt confirmation and replacement/cancellation recovery prevent automatic retries. It never calls the mission setup or receipt API and never funds or configures a session.

No contract deployment, database migration, custody change, AI provider, broad execution enablement or real holder transaction is included. Contracts and worker policy retain their existing limits. Browser automation uses explicit fixtures and never signs owner transactions.

## Validation

- Activation/status/integration/sign-in regression checks: 72 passed; an additional behavioral test confirms that new and unfunded drafts preserve their rules and open Fund.
- A missing test-context binding for the new controller was fixed before the passing rerun.
- Production read-only checks: #93 existing registry/Agent runtime verified at block 71378973. #1135 creation was simulated (48 bounded RPC reads/calls, zero-value createAccount); maximum fee at that sample was 5979089016000 wei. No transaction was sent.
- Creation helper tests: 54 passed during implementation; final recovery and panel coverage still being completed.
- New creation helper/panel tests, full JS suite, deploy gate, responsive browser, independent review: pending.
- Preview / production: pending; no cloud deployment has been triggered for this change.
