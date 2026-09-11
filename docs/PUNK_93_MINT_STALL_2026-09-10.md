# Punk 93 mission counter fix

## Confirmed production cause

Read-only checks on September 10, 2026 at 10:23 PM EDT
(`2026-09-11T02:23:44Z`) found an active generation-4 mission with a total
limit of one mint, zero completed mints in that session, and one mint remaining
on-chain. The worker repeatedly recorded three successful live simulations and
`NO_ELIGIBLE_MATCH` without submitting an operation.

The worker counted every historical `COLLECTED` activity for the Punk toward the
current mission total. A confirmed September 9 mint from an earlier session
therefore produced `TOTAL_LIMIT_REACHED` for the new mission. Replaying the
matcher with the session-scoped count removed the only rejection for all three
live candidates: x, Tokyo Youth Battle, and Project Mars Plots. Those read-only
simulations do not reserve an NFT or establish a successful autonomous mint.

The corrected production SQL was also exercised read-only at
`2026-09-11T02:31:46Z`: current mission total 0, UTC-day total 0. Its existing
on-chain session and gas balances were not changed.

## Change

Confirmed mint totals are associated with their exact session through the
activity's execution attempt and UserOperation, rather than an activity timestamp
or a reused strategy version. Pending signed, submitted, and reconciliation-required
operations also count against their own session's total. Daily and collection
limits retain the Punk's history and unresolved operations across sessions.

Scouting activity now records bounded rejection-code counts, and the Activity
view explains the rejection. Older activity records remain readable. The
read-only mission audit reports the corrected daily and mission totals.

The existing screening-freshness, simulation, signing, reservation, receipt,
gas, and owner/session checks remain in force. No database migration or contract
change is needed.

## Release source

Production deploy `6aa16a462e74d5c77dfe58c6`, published September 9, is titled
`Owner-gated Forge research bench 0daf269 - no main merge`. Its source includes
gas-funding, mission-setup/chat, receipt-history, and Forge canary work that is
not in GitHub main. Base the deployable fix on that production source so those
existing features are preserved. Later unpublished Forge/transfer-epoch changes
are outside this fix.

## Verification

The PostgreSQL regression suite uses PGlite to execute the actual worker queries.
It covers the earlier-mission reproduction, current confirmed and pending totals,
daily/collection protections, delayed receipt reconciliation, other Punks,
owner-assisted history, failed operations, and UTC rollover. The dependency
version also satisfies the existing Netlify database package's optional peer.

Targeted worker, account runtime, mint-operation, UserOperation, collecting-policy,
and UI tests pass. Site, syntax, and broker validation pass. Production access in
this investigation was read-only; no deployment or new mint is claimed.
