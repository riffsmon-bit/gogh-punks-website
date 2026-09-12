# V2 release target: September 16, 2026

The owner confirmed the Wednesday, September 16 target (America/Detroit):
**reliable V2 minting, agent gas funding, mission setup/chat, and Forge research/loadouts**.
Permanent training, credit earning and burns can follow. Their unresolved design or
production provisioning must not hold up the independent V2 minting release.

The failed preview was the **Netlify / GitHub PR preview**, not the local #44
training fixture. Start review at [the complete broker in Talk](https://deploy-preview-47.preview.goghpunks.xyz/broker/v2/?tab=talk).

## Candidate and release boundary

PR #47 integrates production source `0daf269`, the #93 session fix `8f9ff08`, and
the original-NFT Forge. The verified application revision is `c0a6b3c`.

- Keep production's natural-language mint rules, agent gas funding, saved-mission
  review, account/session setup, collection and activity together in the full broker.
- Confirmed and pending mint totals use their authorizing mission session. Daily
  and per-opportunity protections still span sessions; prior-session mints must not
  exhaust a new one-mint mission. Scout activity explains rejected candidates.
- Fix the disconnected-startup feedback loop so the PR preview loads before a
  wallet is connected. Purchases/transfers refresh original-NFT ownership and clear
  seller-private chat, gas confirmations and unsigned reviews.
- Release Forge read-only research and verified original-NFT loadout functionality.
  Diagnostics do not claim learned/equipped capabilities or wallet spending authority.
  Unknown loadout data is not zero, and a placeholder is not live acceptance.
- Leave permanent learning, slot purchases, credit issuance and sacrifice/burn
  execution disabled. The existing gated implementation can remain prepared for a
  later release; it is not part of Wednesday's launch requirement.

## Acceptance required for Wednesday

[The acceptance checklist](V2_SEPT16_ACCEPTANCE.md) records the concrete checks and
remaining evidence. Local fixtures and hosted page loading do not establish a live
mint receipt or production worker readiness.

| Date | Required result |
| --- | --- |
| Sep 11 | Confirm scope, publish a working full-broker PR preview and preserve production chat/gas behavior. |
| Sep 12–13 | Exercise connect/select, both gas funding sources, chat-to-review, mission activation/scouting, receipts, collection and failure recovery. Verify research and real loadout state with owner/transfer checks. |
| Mon Sep 14 | Prepare rollout/rollback for this scope and complete controlled live mint acceptance, including #93 session accounting and canonical receipts. |
| Tue Sep 15 | Resolve acceptance failures, freeze the accepted candidate and check the hosted build/worker health. |
| Wed Sep 16 | Release the accepted V2 minting and Forge research/loadout scope; report actual enabled capabilities. |

The verified loadout implementation still needs a deployed, pinned backing state.
The current read manifest has null registry/progression/source addresses. That is
an open **loadout acceptance item**, separate from enabling permanent training or
burns. Do not replace it with a mock source, assume an empty loadout, or silently
change the original-NFT progression design to bypass deployment work.

## Deferred training and burns

The latest September 11 direction is **owner-approved literal burn after wallet
review**: select one owned Punk to burn and a different owned Punk to receive a
skill upgrade. This supersedes the earlier product decision to keep literal burns
disabled pending recovery design. A recovery vault was not selected. Production
execution remains disabled because the real source and transaction flow are
unfinished; this does not delay independent V2 minting or research testing.

The credit-source/recovery choice, live training migrations and restricted roles,
training-contract enablement, paid credit/slot/learning actions and first-sacrifice
acceptance belong to a later release. The owner has deferred these capabilities;
there is no need to resolve the burn-versus-retirement choice to proceed with V2
minting or independent research. Prepared work remains documented in
[V2_REVIEW_CANDIDATE_2026-09-11.md](V2_REVIEW_CANDIDATE_2026-09-11.md),
[V2_FORGE_DATABASE_ROLLOUT.md](V2_FORGE_DATABASE_ROLLOUT.md) and
[V2_FORGE_SACRIFICE_DECISION.md](V2_FORGE_SACRIFICE_DECISION.md).

## Preview corrections and current evidence

The earlier Netlify build failed when the live research canary returned
`PROVIDER_READ_UNAVAILABLE`. PR previews now retain the full application deployment
gate without depending on that live provider check; production retains the canary.
The final hosted check additionally caught the empty-roster/wallet event loop.
Both wallet adapters now ignore unchanged selections while publishing real changes.

- 1,673 JavaScript tests passed, with zero failures or skips.
- `site:deploy-check` passed, including 127 deployment tests; 26 wallet regressions passed.
- Full broker browser checks passed actual disconnected wallet startup, chat mint/gas
  inputs, saved-mission reuse, ownership changes and Forge recovery on desktop/mobile.
- Netlify deploy `6aa40fdbcae45900088f4a6f` (`c0a6b3c`) passed hosted Talk/Forge
  checks with no browser exceptions, failed assets or wallet actions.
- Prior complete Solidity verification passed 234 tests with 1,024 fuzz runs where
  applicable. The continuation changed no Solidity.
- Native PostgreSQL and disposable-chain training checks also passed; those are
  preparation for the deferred training release, not Wednesday's acceptance gate.

No production release, production database change, real mint, contract deployment
or real burn was performed in preparing this candidate. The #93 worker fix remains
in the PR until the production rollout and live receipt acceptance are completed.
