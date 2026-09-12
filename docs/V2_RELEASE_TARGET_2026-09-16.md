# V2 release target: September 16, 2026

**September 12:** the owner reaffirmed a next-week launch and requested a complete
live test guide. The [guide is prepared](LIVE_OWNER_TEST_GUIDE_2026-09-16.md).
The [burn-source candidate](v2-forge-reviewed-burn-source-checkpoint.md) now passes
contract and local integration checks, while production burn integration remains
open. The owner explicitly included burn-to-training in the September 16 launch.
This supersedes the earlier training/burn deferral.
The [connected-contract checkpoint](V2_FORGE_CONTRACT_DEPLOYMENT.md) records atomic
deployment, application test wiring and the remaining owner-wallet deployment step.

The owner confirmed the Wednesday, September 16 target (America/Detroit):
**reliable V2 minting, agent gas funding, mission setup/chat, Forge research/loadouts,
and owner-reviewed burn-to-training**. Contract deployment, wallet review, durable
transaction recovery and live burn/training acceptance are now launch requirements.

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
- Include owner-reviewed literal burn, exactly-once credit issuance, permanent
  learning, slot unlocks and equip/unequip. Keep runtime gates closed until the
  deployed stack, complete wallet review and transaction recovery pass acceptance.

## Acceptance required for Wednesday

[The acceptance checklist](V2_SEPT16_ACCEPTANCE.md) records the concrete checks and
remaining evidence. Local fixtures and hosted page loading do not establish a live
mint receipt or production worker readiness.

| Date | Required result |
| --- | --- |
| Sep 11 | Confirm scope, publish a working full-broker PR preview and preserve production chat/gas behavior. |
| Sep 12–13 | Exercise connect/select, both gas funding sources, chat-to-review, mission activation/scouting, receipts, collection and failure recovery. Deploy/rehearse the connected Forge contracts; test burn, credit, training and wallet recovery alongside research/loadouts. |
| Mon Sep 14 | Prepare rollout/rollback for this scope and complete controlled live mint acceptance, including #93 session accounting, controlled owner-selected burn/training and canonical receipts. |
| Tue Sep 15 | Resolve acceptance failures, freeze the accepted candidate and check the hosted build/worker health. |
| Wed Sep 16 | Release the accepted V2 broker and Forge burn-to-training scope; report actual enabled capabilities. |

The verified loadout implementation still needs a deployed, pinned backing state.
The current read manifest has null registry/progression/source addresses. That is
an open **loadout acceptance item**, separate from enabling permanent training or
burns. Do not replace it with a mock source, assume an empty loadout, or silently
change the original-NFT progression design to bypass deployment work.

## Burn-to-training launch requirement

The September 12 owner decision includes literal burning in next week's launch.
An owner selects a source Punk and a different owned recipient, reviews all source
wallets, withdraws known assets and confirms the permanent loss of the NFT and its
wallet access. No recovery vault was selected. Burning earns one credit atomically;
learning, slot unlocks and equipping remain separate exact reviews.

The remaining critical path is the deployed/pinned registry, reviewed progression
and burn source; production wallet/inventory and mission cleanup; durable approval
and burn recovery with independent finalized receipt checks; restricted database
roles; hosted desktop/mobile acceptance; and the owner's explicitly selected first
live burn/training. Independent broker testing continues while these are completed.
Local fixture success does not satisfy these live requirements.

See [the burn decision](V2_FORGE_SACRIFICE_DECISION.md),
[contract checkpoint](v2-forge-reviewed-burn-source-checkpoint.md) and
[database rollout](V2_FORGE_DATABASE_ROLLOUT.md).

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
  preparation for the now-required training release; live acceptance remains open.

No production release, production database change, real mint, contract deployment
or real burn was performed in preparing this candidate. The #93 worker fix remains
in the PR until the production rollout and live receipt acceptance are completed.
