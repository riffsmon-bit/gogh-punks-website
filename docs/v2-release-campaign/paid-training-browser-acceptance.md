# Paid training local browser acceptance

Executed on 2026-09-22 against the uncommitted paid-training implementation in
`/private/tmp/gogh-paid-training`. This evidence covers the actual new panel and
wallet adapter with a synthetic OWNER_CANARY release, synthetic API responses and
an in-memory wallet provider. It does not authorize production payment or deployment.

## Commands and results

- `node --test --test-reporter=spec tests/forge-paid-wallet.test.mjs tests/forge-paid-panel.test.mjs`
  — **22 passed, 0 failed, 0 skipped** after the burn-approval guard was added.
- `node scripts/test-forge-paid-browser.mjs --fixture-only`
  — **PASS**, Chrome `150.0.7871.125`, from `2026-09-22T13:48:06.499Z` to
  `2026-09-22T13:48:15.163Z`; **24 screenshots**, at widths 1440 and 375.
- `git diff --check` — passed.

The browser used its own temporary profile and local HTTP server. The server only
served local GET requests; CSP denied connections and CDP blocked requests outside
the local origin or with a non-GET method. The result recorded **0 page exceptions**
and **0 external requests**. Screenshots also passed page/control overflow checks
and minimum 44px control-height checks. The mobile burn-approval and research
screenshots were visually inspected.

## Evidence

Results and screenshots are local artifacts in
`/private/tmp/gogh-paid-browser-evidence-Biph01/`; `result.json` records the exact run.
Each screenshot below exists with both `-1440.png` and `-375.png` suffixes:

| Screenshot stem | Exercised behavior |
| --- | --- |
| `undeployed` | Optional price/help only; no session, API, wallet RPC or action controls |
| `disconnected` | No wallet action for a disconnected selection |
| `burn-approval-blocked` | Sacrifice-approved Punk cannot buy; explicit revoke-first guidance |
| `buy-review` | Exact 0.0005 ETH credit price, maximum fee, treasury and no-refund disclosure |
| `submitted` | Exact attempt saved before the single mocked wallet request |
| `activation-review` | Explicit permanent setup review, distinct from purchasing credits |
| `canonical-equipped` | Active loadout after mocked setup, learn, slot unlock and equip |
| `equipped-research` | Active equipped Rarity Eye can run the existing research action |
| `lost-wallet-reload` | Lost wallet response survives reload; no replay or fresh purchase |
| `confirmed-revert` | Included receipt stays pending; finalized revert can close explicitly |
| `expired-unused-proof` | User rejection held until explicit finalized unused proof |
| `long-safe-error` | Long untrusted error renders as text without overflowing |

The browser also executed unequip, successful receipt reconciliation and a chain
switch during outstanding verification; that switch produced no wallet request.
Separate unit tests cover mismatched account/nonce/runtime/calldata/value/domain,
inclusive transfer logs, anchor/closing-head changes, failed storage, changed
recovery echoes, recovery while PAUSED, and active/malformed burn-approval state.

## Source SHA-256 at execution

| File | SHA-256 |
| --- | --- |
| `site/forge-paid-release.js` | `015d7274137ee2a880b9a8e9d1540bfe88af3bbc440bebe9d9a2ba66dcb04d60` |
| `site/forge-paid-wallet.js` | `8f0b5acf64a2386942f9135f86d2082aed0f4ccb4c27a4d1b4c6a5f30984971a` |
| `site/forge-paid-panel.js` | `a2b5b295b22fbd14519082ed400d37822614d2919f9a44a646da7440c6769606` |
| `tests/fixtures/paid-training-ui.mjs` | `8df9ab651ee3423d6da5ed102bfaae195e7ceae8ef57a6da4579ee48ddd77488` |
| `scripts/test-forge-paid-browser.mjs` | `9cdb994215a8384fd89ffcbe440b6b961c2bae1a4a21cee35320f0d5b859a4b5` |

## Limits and release state

The browser tests use the real paid panel in a local fixture scaffold, not a full
owner session against a deployed backend. Receipt finality, runtime bytecode,
transfer logs, and expired-unused proofs are mocked; chain and backend guarantees
need their separate contract/runtime tests. Research results are synthetic too.
No public wallet, RPC endpoint, production API, database or chain was mutated.

The checked-in release remains **UNDEPLOYED** with a null extension and both
`canonicalReadersReviewed` and `productionPaymentsAuthorized` false. The browser
artifact is tested for exact parity with the server artifact. No production
deployment or payment enablement was performed as part of this acceptance.
