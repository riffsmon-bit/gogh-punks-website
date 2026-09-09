# Agent Gas Fund — implementation checkpoint

September 9, 2026. Branch `feat/punk-agent-gas-funding`, based on `bce4c8c`. Additive V2 UI change; Skill Forge is not involved. No production deployment, environment change, signature, transfer or mission activation performed.

## User flow

Fund now separates canonical Punk Wallet ETH, Agent Account native ETH and EntryPoint gas deposit. Two sources are explicit:

- **Use Punk Wallet ETH**: current owner signs one V3 `execute(agentAccount, amount, 0x, CALL)` transaction with zero outer value. Existing Punk ETH moves directly to the same token's registered Agent Account. The connected owner wallet pays the transfer transaction fee.
- **Add ETH from my wallet**: owner signs a plain ETH transfer directly into that registered Agent Account.

Neither path funds the retired hosted prepaid pool, installs a skill/module, changes strategy, activates a session or mints. Existing canonical wallet funding remains available separately. Funding is reviewed/simulated first, then rechecked before a separate MetaMask submission. The UI waits for a successful receipt and refreshes both balances. No automatic payment on load, mode selection or chat.

## Controls

`site/punk-agent-gas-funding.js` reuses canonical V3 ownership/runtime gate checks. It requires an authenticated server runtime result for the selected Punk/owner and independently resolves `account(uint256)` through the fixed deployed Agent Registry `0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844`. Live Agent owner/code checks and the exact value/data simulation must succeed. No form/chat destination is accepted.

Punk-funded transfers require fresh active-strategy reserve data and sufficient live canonical balance after the selected amount. Checks repeat on submission; reserve enforcement is a preflight check, not a new atomic on-chain reserve hook. Concurrent owner transactions can change balances after review. The owner retains normal withdrawal authority. Amounts are positive canonical decimal ETH, at most 18 decimals and 1 ETH per transfer. Wrong owner/chain/token/account, missing reserve, failed simulation, changed plan or changed UI selection fails closed. Busy guard prevents duplicate in-flight clicks. Wallet transaction confirmation remains explicit; check wallet history after an ambiguous provider response.

## Autonomous lock diagnosis

The UI previously disabled the mode based on `setupAvailable`/mission state but offered no direct sign-in/recheck beside it. Talk now offers **Check Autonomous Readiness**, opening Fund's **Recheck / Sign In** action. Readiness errors and returned blocker codes are shown instead of only generic deployment language. These controls do not bypass blockers or enable automation.

Read-only production checks during this work: worker enabled; direct private relay mode; global pause false; background allowlist includes Punk Agent Worker and discovery ingest. Relay signer had 0.001 ETH. Those facts do not establish the user's authenticated `setupAvailable` result or prove the cause of the current locked mode. The requested screenshot/readiness response is still needed to identify that exact blocker. No server switch was changed.

### Follow-up: recalled-session lock reproduced and fixed locally

Subsequent read-only checks identified the concrete failure: #93's on-chain `sessionActive` is false and its session key is zero after `revokeAutonomousSession()` deletes `_session`. Reading that runtime with the configured public worker key reproduces `SESSION_KEY_MISMATCH`. The status endpoint had supplied this execution-key constraint even when no active session existed, producing HTTP 503; the UI mislabeled the failure as sign-in required.

The status endpoint now reads ownership-bound account state without requiring an inactive key match. An **active** key mismatch is still an explicit blocker and prevents setup/execution readiness. Worker execution and receipt reconciliation retain the original strict expected-key checks. An inactive session remains unauthorized and cannot mint; owner setup must still pass manifest, database, signer and bundler checks. No session is reactivated by this GET. UI auth errors are distinguished from service errors and unverified balances no longer display as zero.

Follow-up suite: **36 tests passed**, including five new recalled-session/readiness regressions plus existing function/runtime/funding/UI checks. The newly reproduced fix is local, not a confirmed production deployment. The earlier paragraph records the state of the investigation before this reproduction; no more wallet screenshots are required to establish this bug.

Expanded final regression: `node --test tests/punk-agent-*.test.mjs tests/punk-wallet-funds.test.mjs tests/art-broker-v2-ui.test.mjs` — **55 passed, zero failed/skipped**, including mint intent, UserOperation and strict signing/submission tests.

## Verification

- 27 targeted tests passed: gas funding (7), existing Punk Wallet funds (5), V2 UI (11), Agent runtime (4).
- Syntax check passed for 470 JavaScript modules; site validation passed for 7 pages/16 previews, including assets and secret scan.
- Chrome local preview checked 1440/390/375px without horizontal overflow or runtime exceptions. Preview funding is blocked, and changing Punk clears confirmation. Mobile screenshot visually inspected. This does not substitute for a live owner-wallet interaction test.
- Read-only Robinhood `eth_call` at block **58517866** succeeded for owner `0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6` moving **0.0005 ETH** from canonical #93 wallet `0x06d5e0df2eb9512777403bf017031618f4713e19` to Agent Account `0xcadcfd37e715bc031cf0cec7fa2335091c878c83`. Separate current gas estimate: 92,233 units. This is not a fee quote or transaction receipt. Nothing was broadcast.

## Test / release handoff

```sh
node --test tests/punk-agent-gas-funding.test.mjs tests/punk-wallet-funds.test.mjs tests/art-broker-v2-ui.test.mjs tests/punk-agent-account-runtime.test.mjs
node scripts/code-check.mjs
node scripts/site-check.mjs
```

Local visual preview: `http://127.0.0.1:64340/broker/v2/?preview=1&tab=fund` while the local demo process runs. It cannot fund real accounts. No Netlify build/deployment or push to main was performed. Next: reviewed preview release, identify authenticated readiness blocker, then owner-driven funding/mission canary with exact limits. Do not mark a live mint complete until the canonical receipt and acquired NFT ownership are verified.
