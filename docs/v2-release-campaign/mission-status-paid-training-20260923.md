# Mission status and paid training — 23 September 2026

## Verified starting state

Production started at `e89246639c8e89b6c45726402e2754d1d41031ff` (PR #74).
Work is isolated on `fix/v2-mission-status-training`. Vercel migration remains paused; AI providers remain off.

Read-only application database inspection and on-chain reads showed #93's latest strategy (version 12) in ASK with five total mints and five per day. Its last authorized mission (strategy 9) completed one of one mints. The account's session was inactive with zero remaining mints. Saving the new strategy did not authorize another mission.

## Holder changes

- Current status appears above every tab and on the Punk hero. Looking for mints requires a fresh authenticated status, active chain session, enabled ready worker, and recent successful worker activity. Unknown or stale state is explicitly unverified.
- Start free-mint mission prepares the existing authorization review. It preserves saved daily/total limits, taste, gas limit, reserve and contract rules; it does not sign or spend automatically.
- Current saved strategy is retained after profile hydration and takes precedence over completed mission rules. The old completed mission is labeled history, with dated checks.
- Strategy activity explains the difference between saved rules and wallet permission without exposing JSON.

## Paid contract deployment — LIVE, purchases initially PAUSED

The owner confirmed deployment in their own wallet:

- Robinhood Chain: 4663.
- Contract: `0x5311a2c646efbc6abe7e1d9e6aad5811c5a5f80d`.
- Transaction: `0xe4ba16057c2f1e42965c78c97e85ec95b6bb947cb0557e9daa10af3c88266742`.
- Block: 70552009.
- Block hash: `0xdcd0aaadb72620ba77053bf510f1a32f8c5b78104178d112dc647adb34ca0168`.
- Runtime hash: `0x0d006690030b9aeda4b7664f7691d7536d387b8deb9551f106190de1dbb14293`.
- Credit price: 0.0005 ETH, plus network fees; fixed treasury is the owner's previously approved main wallet.
- Immutable skill allowlist: Rarity Eye only. Eligible extra slots require the original starting allocation first.

Validation Cloud and the official Robinhood RPC independently verified the exact deployment transaction, receipt, compiled runtime and immutable configuration, owner, price, paused state and approved skill. Both also returned verified #93 progression through the production paid/canonical readers. No credit was purchased by these checks.

The initial website release is OWNER_CANARY, restricted to the approved owner's wallet. Contract unpause requires a separate administrator wallet transaction; once unpaused other holders could call the contract directly. General public website payments are not claimed live. Credits are nonrefundable and follow tokenId; purchase, adoption of the paid loadout, learning and equipping require separate holder confirmations. No burn, marketplace permission or automatic spending is enabled.

## Local setup / recovery

`node scripts/dev/skill-forge/run-paid-training-setup.mjs --enable-reviewed-purchases` serves the exact reviewed unpause action at localhost:64349. The server has no signer. It uses a durable local journal, bounded read retries, independent receipt verification, exact nonce/value/fee checks and explicit browser wallet confirmation. Refresh cannot resend a claimed request. Preserve the original transaction hash if the wallet result is lost.

The deployment page at localhost:64348 remains available for its original receipt. Historical PublicNode contract reads returned invalid-parameter errors; setup uses the independently verified official endpoint plus archive provider. Production RPC configuration is not silently changed.

## Validation

- Targeted regression suite: 102 passed after replacing legacy-only test assumptions with explicit fixtures; production still fails closed on paid-reader errors.
- Deployment gate: 277 passed; typecheck, wallet build, site/secret checks, code check and broker check passed.
- Paid contract suite: 36 passed, 256 fuzz runs.
- Local-chain paid journey: passed exact-price purchase, activation, learning, equipment, recovery/idempotency and transfer authority.
- Paid browser fixture: passed 24 desktop/mobile captures, rejection, lost response/reload, exact saved request, recovery, wrong-chain interruption and equipped research. No external calls or browser exceptions.
- Full JavaScript run: 3,508 passed, two browser parent/child failures from one navigation timeout, two existing skips. Re-running that entire Forge browser file in isolation passed all four tests. No assertion or runtime defect remained in that run.
- Final mission browser: 15 captures at 1440/375/320 px, zero exceptions, overflow or failed requests; verified inactive/completed, active, paused-worker and stale states, plus the Start button preserving the 5/5 review.
- Evidence directories: `/private/tmp/gogh-paid-browser-evidence-bjX04t` and `/private/tmp/gogh-preview-browser-evidence-QD5JKi`. Full logs: `/private/tmp/gogh-mission-paid-full-tests-final.log` and `/private/tmp/gogh-forge-preview-retry.log`.

## Release boundaries

No production data migration, new signer, production burn, owner asset transfer, or automatic mission activation is part of this batch. Public burning and marketplace/WETH execution remain gated. First real credit purchase and skill use require the owner to test through the released website; unit tests or local-chain transactions are not live acceptance evidence.
