# Skill administrator browser acceptance

**PASS**, executed at `2026-09-22T12:15:14.989Z` with `Chrome/150.0.7871.125`. Eleven scenarios passed and nineteen screenshots were captured at widths **1440, 375 and 320 CSS pixels**. Every captured page had `scrollWidth === innerWidth`; visible buttons, inputs and the administration summary were at least 44 pixels high and remained inside the viewport. There were zero page exceptions, external page requests or public transactions. Visual inspection of the registration, cancellation and long-error captures found no clipping or unreadable controls.

Run from the repository with Node 24, installed dependencies and Google Chrome at the standard macOS application path:

```sh
node scripts/test-forge-skill-admin-browser.mjs --mock-wallet-only
```

The harness starts its own loopback HTTP server and Chrome profile. It serves the actual administrator panel, production styles and Settings administration markup. Requests use the actual administrator API handler and coordinator with the existing skill-admin fixture's in-memory journal, registry preparation and chain clients. Mock signing is explicitly labelled; the harness creates no wallet key and supplies no RPC transport. CSP and request interception restrict the page to its local origin. The profile and server are removed after the run; screenshots and `result.json` remain in the printed evidence directory.

## Executed scenarios

1. Collapsed administration mounts without sign-in, API reads or wallet requests.
2. Disconnected controls are disabled; a non-administrator cannot inspect skills or saved administrator records.
3. Explicit mock sign-in precedes reviewed registration. The mock wallet receives exactly the claimed transaction; a successful receipt confirms it. Reload and recheck do not resend.
4. A user-rejected original remains reserved. A separately reviewed zero-value transaction uses the same nonce; confirmed replacement settles the original without repeating its registry calldata.
5. A wallet response lost after the mock transaction leaves no locally saved hash. Reload keeps recovery available, and manually supplied original receipt recovery produces no second wallet request.
6. A lost claim acknowledgement leaves `WALLET_REQUESTED`, with zero wallet sends before and after reload and only one backend claim.
7. A pending receipt stays `SUBMITTED` across reload until both mock providers report twelve confirmations; subsequent recheck confirms without replay.
8. A reverted original settles as `REVERTED` without a registration-success message.
9. Account and chain switches clear stale reviews. A chain round trip during pending sign-in cannot claim or send.
10. An account round trip discards an outstanding administrator API response.
11. A long untrusted error renders as literal text, creates no image element, removes stale wallet actions and remains within all three viewport widths.

## Evidence

Final local evidence directory:

```text
/var/folders/4m/68pfyqlj18v5bncgqqhf2n580000gn/T/gogh-skill-admin-browser-evidence-vfdz08
```

`result.json` records every scenario, screenshot path and layout measurement. Representative captures are `registration-review-375.png`, `nonce-cancellation-review-1440.png`, `nonce-cancellation-review-320.png`, `lost-wallet-response-recovery-375.png` and `long-error-320.png`. The final run also repeats the successful registration and cancellation layouts at desktop and small-phone sizes.

SHA-256 of executed source:

| File | SHA-256 |
| --- | --- |
| `scripts/test-forge-skill-admin-browser.mjs` | `8a567f7d087c568480a8e8eb1f748280641d328cf492e2433e4b25928df8e6c1` |
| `site/forge-skill-admin-panel.js` | `2e195e4ef7fea2762d95e20ef72538c2c1a719bf9e3e515d2cc7951d40ff6450` |
| `site/broker-v2-forge.css` | `5dfb71850538fcbfd64d6652c52c3c00a1bc359f12219e83635a66a60a4ca283` |
| `broker/src/v4/skill-forge/skill-admin-coordinator.mjs` | `09006d61e9017bf3f56224ba3eba7da45603f0f562ebd12255d935a6f3235633` |

`node --check scripts/test-forge-skill-admin-browser.mjs` and `git diff --check` also passed. No product-code change was needed for this browser acceptance.

This is Chrome acceptance of the locally mounted administration section. It does not prove a real wallet extension/signature, all three live registry steps, the complete broker shell, deployed Netlify responses, production role provisioning or native SQL durability. Those remain separate acceptance evidence.
