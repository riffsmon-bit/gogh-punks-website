# Skill and marketplace follow-up — integration report

**FINAL_TESTING_READY for the bounded copied-chain skill and marketplace increment.** Repository validation and independent review passed; publication still requires the served-preview gate below. Public marketplace execution is **NOT_READY**. This follow-up does not register new public skills, deploy the candidate contracts, burn an original Punk or move real funds.

The already-published PR #67 fixes the user's completed-mint screenshot: #93 shows **Paid mint complete**, Peppies World **#1599**, and a Collection link. A separate expired unsigned review remains explicitly dismissible. Groq is saved in the server-only Netlify configuration and passed its real production conversation and structured-output probes. Bankr remains disabled by the owner's choice.

## Product and user journeys

| Area | Result and practical boundary |
|---|---|
| Wallet connection, roster and selection | Existing production ownership/artwork repair retained. Integrated actual-UI tests cover empty owners, 140-Punk keyboard selection, owner changes and delayed replies. |
| Collection and completed paid mint | Existing verified #1599 delivery retained. No replacement mint, automatic review cancellation or wallet recovery. Production verification is recorded separately from fixture browser tests. |
| Chat / AI | Groq, Gemini, OpenAI, Anthropic and xAI passed actual production probes in prior published acceptance. Groq quotas fail closed; explicit selection does not cross providers. Bankr disabled; no top-up or new paid subscription. |
| Rules, policy and execution | Existing confirmed owner rules, reserve, price, simulation and idempotency gates retained. Mint Hunter research reads exact confirmed rules and conservative completed/pending usage; it grants no wallet execution. |
| Funding / withdrawals | Existing current-owner ETH, gas deposit and supported NFT recovery paths retained. Integration browser proves funding review/recovery without broadcasting. General Agent ERC20 recovery remains outside supported paths. |
| Burn safety | Standard history uses bounded provider-compatible pages and a reviewed hash-pinned extension. Current balances, account identity, history and obligations still fail closed. Nonstandard assets and off-chain obligations require owner review. |
| Burn / credit / progression | Copied #1753→#93 sacrifice gives exactly one credit; copied training, slot unlocking and transfer persistence pass. Original #1753 remains intact. Existing narrowly selected owner canary authorization is unchanged; generic burn stays disabled. |
| Forge / loadout UX | Library labels distinguish released training, learned, equipped, paused and laboratory packages. A direct loadout action returns to the durable training panel. Labels do not grant authority. |
| Real skills | Controlled proofs cover Contract Detective, Rarity Eye, Market Scout v2, Link Sniper and Mint Hunter. The last returns a fixed SeaDrop simulation/recommendation with no signing bytes. New package registrations/READY/release entries remain separate. |
| Transfer persistence | Copied skills, slots, loadout, account and holdings follow tokenId. Old owner training/tools are rejected. New owner cannot inherit the old mint strategy; fresh confirmation is required. |
| MCP | New explicit equipped-skill aliases reuse approved interfaces. Owner/strategy/history/usage context is server-owned and verified. Complete packaged raw source pins and the restricted database CA are tested. Baseline diagnostics retain their semantics. |
| Discovery / links / market reads | Shared opportunities reused; no per-Punk scan introduced. Link observation is not a safety clearance. OpenSea data is a bounded listing sample, not a verified floor. |
| Security / simulation | Fixed adapters, chains, recipients, price, code, canonical blocks and exact receipts remain enforced. Simulation does not claim a full effect trace or perfect safety. |
| Purchases / sweeps | Candidate guard and review/reconciliation code perform exact selected-listing purchases on copied accounts with atomic delivery/reserve checks. New guard is not publicly deployed. A two-item practice purchase is not verified floor sweeping. |
| WETH offers | Copied exact-item and collection offers, seller fulfillment, cancellation and exactly-once return pass. Public offers remain blocked by original-token transfer continuity and unverified acceptance of restricted escrow orders by marketplace posting. |
| Mobile / visual / errors | Integrated Control Center: 25 actual UI scenarios, 59 captures, no findings at 320–1440px. Marketplace: nine actual copied-chain browser journeys, seven captures, no overflow/tiny enabled controls. Real iOS keyboard and wallet-app switching still need holder testing. |
| Database / V1 | No migration or V1 table/account-semantic changes. New context reads explicit columns, verifies role visibility, counts unresolved work conservatively and rejects filtered history. Native disposable PostgreSQL: 28 assertions. |

## Performance and reliability

No production p95 improvement is claimed from local fixture timings. This follow-up bounds transfer history to 2,000 blocks/page, four workers and a fixed deadline; missing or malformed pages cannot mean no transfers. Full source coverage exceeding its bound requires refreshed history. The existing UI request deduplication remains exercised by browser checks. New package verification includes every raw runtime dependency needed in serverless bundles.

The marketplace independent reviewer reproduced and closed three P2 issues: expired offers could keep an active headline; failed receipt checks could preserve an old success; retained seller claims could present a misleading retry. The real-skill review closed two P2 integration issues: provider-incompatible history ranges and missing bundled source/certificate files. The test-only Forge correction preserves exact historical accepted hashes while permitting unrelated compiler AST renumbering. No signed/deployed evidence was rewritten.

## Validation and independent review

Final repository gate: **PASS**, `npm run site:check`: 2,732 JavaScript tests, zero failures/skips, domain typecheck, wallet build, static/secret/syntax checks and broker gate. Full browser gate: **PASS**, 25 scenarios/59 captures. Final marketplace browser: **PASS**, nine journeys/seven captures, zero public transactions. Solidity gate: **PASS**, formatting, offline build/sizes, high-severity lint, 305 tests with 1,024 fuzz runs, ABI/EIP-170 checks. No deployed wallet or Forge contract source changed.

Specialist groups overlap: marketplace 106 tests; real-skill MCP/history 153; independent package tests nine; historical Forge deployment/recovery 79. Native PostgreSQL context 28 assertions. Composed skill proof: 38 local transactions; Forge progression proof: 16 local transactions. None is a public transaction.

- [Independent real-skill review](../v2-hardening/real-skills-independent-review.md)
- [Independent marketplace core review](../v2-marketplace/independent-security-review.md)
- [Independent marketplace practice review](../v2-marketplace/practice-independent-review.md)
- [Final convergence review](final-integration-review.md)
- [Current browser evidence](control-center-browser-evidence.json)
- [Marketplace browser evidence](../v2-marketplace/practice-final-browser-evidence.json)
- [Holder testing guide](../v2-hardening/testing-guide.md)

Final independent convergence review: **PASS**, 89 targeted regressions and actual packaged-file loading across three Forge/MCP functions. Remaining demonstrated P0: **0**; P1: **0**; P2: **0** within this bounded controlled-testing increment. This does not certify the unreleased public trading features. Bankr's paid service remains deliberately excluded.

## Production gates still outstanding

1. Review and authorize exact new skill registration, TESTING-to-READY attestations and server release selection. Code tests alone do not promote packages.
2. Review/deploy/pin the purchase guard and connect real bounded owner authorization, policy, simulation and durable production accounting before public purchases.
3. Resolve original-token transfer continuity and prove marketplace acceptance/posting of restricted escrow orders before public WETH offers. No workaround may weaken current-owner control.
4. Any actual burn, fund movement, paid purchase, bid posting, refund or production contract deployment needs its concrete owner-authorized action. None was submitted during this increment.

Agents and integration commits are tracked in [status](status.md). The original dirty checkout and prior practice sessions remain untouched. New branch/worktree: `v2/skill-market-practice-20260913` at `/private/tmp/gogh-capabilities-integration`.
