# Chat-first setup and duplicate strategy review

September 9, 2026 — additive change on `feat/punk-agent-gas-funding`; no main merge, contract change, owner signature, funding or mission activation by the release process.

## Confirmed failure

Production chat logs for the owner's 08:22 EDT requests showed PostgreSQL `23505`, not an AI-provider outage. Read-only inspection of #93's strategies reproduced both collisions: selecting Autonomous reproduced the paused version 3 hash; asking for one free mint reproduced pending version 6. The chat handler unconditionally inserted a new row despite the unique `intent_hash` constraint.

The handler now looks up the exact collection/token/hash under its existing per-Punk transaction lock. Pending and paused reviews belonging to the same current owner are returned at their existing version. No strategy is activated, reset, or superseded by reuse. Active/retired hashes return explicit state messages, not a generic outage. The base-strategy query excludes previous-owner rows. Normal owner verification and fresh activation signatures remain mandatory.

## Talk actions

- `Check my gas` or `Are you minting right now?`: authenticated account/mission status, with no invented balance or current-execution claim.
- `Fund gas`: opens the existing gas review component directly in Talk.
- `Move 0.0005 ETH from my Punk Wallet to agent gas`: prefills that review only. The checkbox stays unchecked; simulation and a separate MetaMask submission are required.
- `Call my Punk back`: routes to the existing pause/recall path, preserving required revocation approval.
- An autonomous draft with a verified empty Agent balance opens funding in Talk and retains the draft for **REVIEW SAVED MISSION**. Confirmed funding never automatically starts it.

The Fund tab and Talk share one real component, not duplicate transaction forms. No arbitrary target addresses, generated calldata, dynamic tools, or model-provided economic authorization are accepted. This covers the existing setup/status/funding/recall workflow; it does not claim every future Skill Forge capability is implemented.

## Gas budget correction

The previously suggested phrase “total gas spending within 0.0005 ETH” describes an aggregate retry budget the current executor does not separately enforce. Chat now asks for clarification rather than silently treating that as a per-mint limit. The supported test request is: “Autonomously find and mint one free NFT. Max one mint per day and one mint total. Max 0.0005 ETH gas per mint.” Existing reserve/security rules are retained and shown for review.

## Verification

- 68 targeted tests passed, including full-handler duplicate pending/paused requests, no mutation on reuse, wrong owner/retired state rejection, transaction funding boundaries, strict signing/runtime checks and chat actions.
- Syntax: 474 modules passed. Site: 7 pages, 16 previews and asset/secret checks passed.
- Chrome local preview: 1440, 390 and 375px, no horizontal overflow or runtime exceptions. Chat prefills exact amount without confirmation, moves the single component between Talk/Fund, and never auto-submits.
- Live authenticated wallet/browser flow still requires the owner's test. No mint receipt or new mission activation is claimed.
