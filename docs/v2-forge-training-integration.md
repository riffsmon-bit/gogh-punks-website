# Shared V2 training integration — local checkpoint, 2026-09-09

Permanent training is now exercised through the same `createForgeControl` entry point as the V2 research bench, using an explicit loopback-only training adapter. This is **not a production training release**. The deployed research bench, #93's funds and existing economic sessions are unchanged.

## Run and test

`node scripts/dev/skill-forge/run-control-center.mjs`

Open `http://127.0.0.1:64341/control-center` on this Mac. This starts a private disposable Anvil (31337), not Robinhood and not MetaMask. Restarting resets the practice state.

- Test #44 starts with one credit earned by a mock sacrifice of test #2001. Learn Contract Detective, confirm the local transaction, then equip it in slot 1 and run inspection. Learning alone must leave its tool locked.
- Test #1 already knows Contract Detective and Rarity Eye, has two unlocked slots and one spare credit. Equip/unequip Rarity Eye, or spend the credit to unlock one additional slot. Capacity is seven; these fixtures do not claim the real rarity allocation.
- The read tools inspect the actual Gogh collection or metadata for #93/#94/#95 on Robinhood using PublicNode. Training and authority are still exclusively on the test chain. Provider failure is an error, not substituted sample success.
- Sniper remains a local learning fixture without an implemented execution tool. Market, paid trading and mint execution are not enabled by this adapter.

## What is wired

Confirmed credit balances, learned keys, unlocked slots, equipment and event history render from contracts. Learn, unlock, equip and unequip have review/cancel/confirm screens and update only after a successful receipt. Every write is nonce-bound, fixed-action, current-owner checked, block-bound, serialized and simulated; burns are not exposed through HTTP.

The existing canonical resolver pins contract code and package hashes and resolves fresh equipment for both provider-neutral instruction context and tool calls. It now rechecks after a read provider finishes: a transfer, unequip or disable during that call withholds the stale result. No model provider or wallet execution module is installed. Failed, missing or cross-Punk responses clear the training controls; switching Punks closes pending review.

The browser training adapter requires explicit dependency injection, HTTP loopback and a verified local snapshot. A production query parameter cannot enable it. The ordinary V2 research controller still defaults to read-only operation. The shared UI module is also staged in `feat/punk-agent-gas-funding`; local server/contracts remain isolated in `feat/gogh-skill-forge`.

## Verification

- 61 targeted JavaScript tests passed: burn blockers, frozen rarity proofs, slot/floor rules, research runtime, credits/loadouts and HTTP capability gating.
- 29 Foundry contract tests passed with 1,024-run fuzz cases: credits, atomicity, transfer paths, current-owner control, availability, seven-slot cap and rarity claims.
- Headless Chrome shared training component passed real local learn/equip/unequip transactions plus live PublicNode research, cancellation, selection invalidation and desktop/mobile layouts (1440/390/375). Slot-content overflow is explicitly checked.
- Existing V2 research browser regression passed; 15 endpoint/chat/collection tests passed. No Netlify deployment or main-branch update occurred in this checkpoint.

## Remaining production gates

This does not resolve complete asset inventory or post-burn recovery; public burns remain blocked. Still required: reviewed production training source and deployment pins, owner-operated wallet transactions, complete lifecycle/indexer and ownership-epoch safety, live skill registry acceptance, and coordinated economic executor gating. Existing untrained mint agents must not be silently disabled or grandfathered: the enrollment/migration policy needs an explicit decision before production capability enforcement.

No real Punk was burned and no real funds moved. Successful fixture training is not a production READY registration or a security audit.
