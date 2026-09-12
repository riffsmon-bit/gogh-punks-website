# Switching from autonomous to Assist

An owner with an existing autonomous mission asked for five free mints in Assist
mode without specifying gas. The review showed a valid gas cap, but activation
stopped with `OWNERSHIP_CHANGED`: "Punk ownership or wallet binding changed."

The parser preserved the autonomous strategy's Punk Agent Account address while
changing its mode to ASSIST. ASK and ASSIST activation correctly require the
canonical Punk Wallet observed through the current ownership check. This was a
draft binding bug, not a missing gas amount or evidence that the NFT transferred.

Chat now parses against the existing strategy to preserve its rules and then binds
ASK/ASSIST output to the verified Punk Wallet. Autonomous refinements keep their
Agent Account. Confirmation and intent hash are regenerated after binding, before
persistence or owner review. Activation still rejects a wrong owner or wallet.
Saved gas caps/reserves remain unchanged unless the owner supplies replacements;
new strategies use the existing defaults when gas is omitted. No default gas cap
or reserve was changed by this fix.

Strategy-activation SIWE messages also use the exact approved request origin, as
login messages do. Completion rejects a challenge signed for another host. Old
invalid drafts remain invalid: refresh, choose Edit and resend the same prompt to
create a correctly bound review; no gas amount needs to be added.

The new regression executes the chat and strategy handlers against the repository's
actual foundation/V2 migrations in disposable PGlite. It signs the activation with
a deterministic test wallet and verifies the signature locally. The exact reported
prompt passes prepare/complete on production and both supported preview host forms,
preserving a nondefault 0.0007 ETH cap and 0.001 ETH reserve. Tests also cover fresh
strategy defaults, ASK transitions, autonomous refinements, replay, stale wallet,
changed owner and cross-host rejection. No public wallet transaction or owner's
strategy was submitted by these tests.

Test: `tests/art-broker-v2-mode-transition.test.mjs`.

Validation: 1,693 JavaScript tests passed, including 41 focused chat/activation
checks; 127 deployment tests passed. The full desktop/mobile broker browser
fixture also passed with zero public wallet writes and zero browser exceptions.
