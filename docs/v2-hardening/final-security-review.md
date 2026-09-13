# Independent final hardening security review

Review date: September 13, 2026. Reviewer: `/root/final_security`, independent of the wallet, AI, Forge and parent UI implementers. Review branch: `v2/hardening-security-review-20260913`, based on `fcb7fb5`. This is a bounded hardening review, not a blanket audit of every historical contract or the entire product.

Scope verdict: **ACCEPTED FOR INTEGRATION**, with no unresolved new P0/P1 security defect demonstrated in the reviewed changes. Global product verdict remains **NOT_READY — final integration and acceptance remain open**. The parent corrected the reproducible inference-preference defect and two presentation issues; the independent regression now passes. Source inspection alone does not satisfy live-provider or composed-user-journey gates.

## Reviewed versions and scope

| Area | Source reviewed | Scope / outcome |
|---|---|---|
| Funding | Wallet `694aae35d97c01511082c41aa71b67e7e5babe07`, integrated as `057edef` | Exact owner-to-Agent and V3-to-Agent preparation; new durable funding journal; reserve endpoint. No new P0 found. |
| AI | `8243d50`, follow-up `2d49e65`, integrated as `c58d7f0` / `9deed45` | Preference routing, fixed provider-bound gateway, usage reservation/finalization, total deadline, fixed operator probes and actual-runtime privilege gate. No new credential destination or quota bypass demonstrated. |
| Forge | `training-owner-origination.mjs` and `training-state.mjs`, integrated as `eacfef6` | Support already delegated EOAs while retaining anchored owner/code continuity, transfer-history and runtime pins. No ownership-semantic change or wallet module installation. Final composed proof still pending at initial review. |
| Parent UI | Working diff after `057edef` in `/private/tmp/gogh-punk93-mint-stall` | Owner funding context, funding recovery panel, provider preferences, owner/chain/Punk chat and link request fences, welcome guidance. Final exact SHA and browser acceptance pending. |
| Test harness | `scripts/test-forge-composed-journey.mjs` | Public RPC method allowlist, ephemeral localhost Anvil, copied runtime/anchor checks before writes, native disposable DB. Inventory clearance remains explicitly mocked. |

No production transaction, refund, burn, deployment setting, secret value, role grant or database row was changed by this reviewer. Tests use in-memory provider/wallet/chain boundaries and the wallet agent's disposable PostgreSQL-compatible fixtures.

## Findings and routing

| ID | Priority | Finding | Required resolution |
|---|---|---|---|
| FS-01 | P2, CLOSED after correction | Browser `mountBrokerPreferences.preference()` returns AUTO when the saved explicit provider is absent from `available`, including before the first availability response. A saved Claude selection can therefore become a Gemini/AUTO request despite the server's explicit-provider pin. The independent regression returned AUTO where ANTHROPIC was required. | Parent now preserves the saved explicit provider before, during and after failed availability checks; the select retains a checking/unavailable option. Independent regression passes and confirms no silent Auto substitution. |
| FS-02 | P2, CLOSED after correction | Provider status says another model may answer if the holder's first choice is unavailable. The server deliberately forbids cross-provider fallback for an explicit choice. | Parent now explains Auto fallback separately from explicit-provider pinning. Reviewed the corrected source. |
| FS-03 | P2, CLOSED after correction | Funding submit catch calls any transaction with a hash “pending,” including when the legacy receipt wait has already observed a revert. The recovery panel can later reconcile the correct revert, but the immediate message is misleading. | Parent now uses neutral confirmation-unavailable language with an original-transaction recheck action; ambiguity markers remain intact. The recovery panel retains explicit confirmed/reverted states. |

These findings do not grant transaction authority. They still matter to predictable user consent and error interpretation. Existing limitations must remain explicit: direct native funding cannot atomically assert NFT ownership at inclusion; locally stored journals do not protect against deliberate browser-data deletion or independent devices; replacement transactions outside the saved exact transaction are not automatically reconciled. The released Agent's away-and-back session revival is a pre-existing on-chain semantic limitation: retain managed transfer-history guards and do not broaden autonomy under this review.

## Security reasoning and adverse cases

Funding constructs only the fixed pinned Agent deposit or V3 `execute` transfer. Both paths recheck connected account/network, original owner, registry identity, Agent owner, pinned registry/implementation runtime and token-specific proxy footer. The source amount and exact nonce are part of the displayed immutable review. OWNER funding no longer depends on inactive V3 state; PUNK funding still checks V3 owner/runtime/balance and reserve.

The new journal writes and reads back WALLET_REQUESTED under a same-origin Web Lock before opening the wallet. Unknown or malformed wallet outcomes remain pending. A definite 4001 rejection is terminal; storage uncertainty does not authorize a second send. Hash recovery binds sender, recipient, input, value, chain and nonce. Canonical receipt block identity plus twelve confirmations are required before confirmation/revert frees a subsequent explicit review. Tests attempted altered transaction hashes, nonce, input, chain, receipt status and block, storage corruption and selection changes during reconciliation; none released the attempt or submitted twice.

AI quota consumption reserves before provider invocation using an owner advisory transaction lock and READ COMMITTED count. Each fallback spends another reservation. Finalization CAS binds usage ID, owner, Punk, model, provider, task and RESERVED state. Unknown costs remain unknown. A failed or uncertain reservation COMMIT never reaches the provider in the independent test. A successful provider response followed by usage failure is terminal, not a reason to buy a second answer. Native concurrent database evidence belongs to the AI specialist and must not be described as a separate independent run.

Gateway base URLs must exactly match the public provider or platform-injected origin and expected prefix. Explicit OpenAI `/v1` normalization does not authorize arbitrary paths or origins. The independent tests rejected foreign hosts, port changes, query/fragment additions, encoded traversal and caller endpoint replacement; no test sent a credential to a real network. HTTP redirects are rejected by the shared transport. Provider tools and wallet signing are not exposed. The fixed admin check accepts only a bounded provider enum and two fixed prompts; it reports sanitized codes and six privilege booleans. Catalog privileges alone are not a live provider proof; actual successful requests remain necessary.

Forge allows only absent owner code or an exact existing EIP-7702 designation with a nonzero, nonself target, nonempty target code and no nested designation. Its current canonical anchor binds both observed runtimes and the original owner. Transfer logs, changed owner, changed designation/target runtime and reorganized current anchors fail closed. This observes code continuity, not mutable delegate storage or indirect proxy behavior, and does not install/audit the delegation. The transaction remains the exact current-owner call to the reviewed progression contract.

The composed harness publicly exposes only read methods to its fork source. Writes are confined to a newly started owned localhost Anvil after chain, anchor and runtime validation. Fork balances, owner impersonation and a second training-credit source are local fixtures. Two client objects sharing one Anvil do not prove public-provider independence. Mocked inventory and obligation clearance cannot certify a real Punk as safe to burn; later deposits and nonstandard assets remain outside on-chain enumeration.

## Independent validation

| Check executed by this reviewer | Result | Limits |
|---|---|---|
| `tests/final-hardening-security.test.mjs` against the candidate worktrees and parent UI | Final rerun: 19 passed, 0 failed (initial FS-01 reproduced, then fixed) | Actual imported modules; mocked wallet/RPC/HTTP/DB boundaries. No network or financial action. |
| Wallet funding and fund endpoint suites | 55 passed, 0 failed | Actual owner reserve SQL in disposable PGlite; not current production role proof. |
| AI hardening and admin-check suites | 17 passed, 0 failed | Runtime/gateway/privilege behavior under controlled dependencies; no live providers. |
| Forge owner-origination suite | 20 passed, 0 failed | Current source, mocked anchored chain observations. |

Independent suite command during candidate review:

```sh
GOGH_SECURITY_WALLET_ROOT=/private/tmp/gogh-hardening-wallet \
GOGH_SECURITY_AI_ROOT=/private/tmp/gogh-hardening-ai \
GOGH_SECURITY_FORGE_ROOT=/private/tmp/gogh-hardening-forge \
GOGH_SECURITY_UI_ROOT=/private/tmp/gogh-punk93-mint-stall \
node --test tests/final-hardening-security.test.mjs
```

Without the explicit candidate roots, the suite uses the repository containing it, for final integration validation. Test counts overlap implementation coverage and are not additive unique security assertions.

The parent-supplied `database-readonly.json` verifies TLS, table/index/schema facts and no anonymous/public grants for the connection inspected. That connection has SELECT but not INSERT/UPDATE. It must not be misrepresented as the deployed function's managed runtime credentials. The new fixed runtime privilege probe is the proper next gate, followed by real fixed provider responses.

## Remaining signoff gates

1. FS-01 through FS-03 are closed in the reviewed parent working diff after `9deed45`. Record the final committed UI SHA and rerun the independent suite there; later source changes require a diff review.
2. Run the parent browser tests through explicit provider selection, owner funding review, ambiguous-result recovery, selection/network changes and twelve-confirmation/revert presentation.
3. Record the actual managed runtime AI grants and successful fixed GPT/Claude/Grok probes; document any Bankr blocker rather than calling configuration READY.
4. Collect successful composed disposable Forge evidence, including exactly-once credit/training, equip/unequip capability change and transferred-owner rejection/new-owner authority. A script that compiles is not acceptance evidence.
5. Complete the parent’s full integrated validation and remaining subsystem reviews. No global `FINAL_TESTING_READY` signoff is issued by this scoped review alone.

Production burns, financial refunds, fund movement, wallet sweeping, unreviewed wallet modules and broader autonomous execution remain outside this hardening authorization.

## Second independent review — final testing phase

Scope verdict: **PASS FOR CONTROLLED FINAL TESTING** for the changes described below. This is security signoff for the reviewed test phase, not authorization to burn a real Punk, move funds, refund, sweep wallets, promote Market Scout v2 or broaden autonomous execution. Remaining P0: **0 demonstrated in reviewed changes**. Remaining P1 security findings: **0 demonstrated in reviewed changes**. The lead remains responsible for the final complete suite, packaging and product-wide readiness verdict.

The second pass reviewed parent UI through `9c8a57a` and its subsequently committed balance/mobile corrections `d38542b`, reviewed Market/MCP candidate `d98eb541cc5e67e40a20b56aee88d66ee7ca506e` integrated as `7d4f4a1`, and read final Forge (`af5d8b2`) and browser (`49816b2`) evidence. The additional uncommitted MCP archive-selection diff was independently read: it chooses the existing HTTPS `ROBINHOOD_ARCHIVE_RPC_URL` for this read-only roster, otherwise retains the existing RPC URL. It does not change global transaction providers or add write methods.

Parent UI now retains exact decimal ETH amounts through one wei, shows paid maximum mint price explicitly and disables activation if a required exact amount is invalid. Current-owner/chain/Punk request generations fence chat and link responses. Funding still performs its separate fresh owner/code/destination/amount/nonce review and keeps durable unknown outcomes; the recovery panel cannot send a new transaction. WETH/native display requests are bounded and deduplicated, and selection changes invalidate stale reads. A minor follow-up was reported: on a failed balance refresh, previously displayed native balance should be labeled unavailable/stale alongside WETH. This is display freshness, not transaction authority; live funding/withdrawal preparation does not consume these display values as proof.

MCP roster reads now reconcile live `balanceOf` against fixed-collection `ownerOf` results at one captured block, resolving only fixed pinned-registry wallets. Index rows are hints and can be unavailable. Results are explicitly complete **at the recorded block**, not an execution authorization. Reorgs, chain changes, incomplete counts, malformed registry output and timeouts return a sanitized unavailable result rather than a falsely complete/empty list. The unchanged action tools still perform their own current-owner and skill/capability checks. Bounds are four concurrent scan/registry batches, 200 IDs per batch, a 500ms hint deadline, 1.8s RPC deadline and 12s overall limit.

Market Scout v2 is isolated native read-only code and remains TESTING/unpromoted. It rejects JSON numeric prices/token IDs, mismatched asset identities, foreign payment-token addresses despite plausible symbols, mixed currencies, unsupported quantities/types, dynamic prices and expired orders. It sums exact consideration strings with uint256 overflow checks and reports the fixed payment-token address, quantity and order interval. Upstream signatures, calldata, execution flags and instructions are not forwarded. Requests remain GET on the fixed OpenSea origin with redirects disabled and bounded pages/response bytes/time. Even exhausted pagination produces a bounded observation, not a verified floor, ownership proof, fulfillable quote or spending permission. Existing v1 implementation pins remain untouched.

### Evidence independently inspected or executed

| Evidence | Result | Attribution and limits |
|---|---|---|
| Original independent hardening tests rerun against the final root candidate | **19/19 passed** | Executed by this reviewer; mocked provider/wallet/chain boundaries. |
| New `tests/final-hardening-market-security.test.mjs` | **10/10 passed** | Executed by this reviewer; attempts upstream authority injection, exact amount/currency/asset/chain confusion, hostile cursor, stale owner hints, chain/reorg changes and credential error leakage. |
| Market/MCP implementation suites | **67/67 passed** | Executed by this reviewer against `d98eb541`; fixed-provider behavior and actual imported modules under controlled mocks. |
| `provider-live-checks.json` | GPT, Claude and Grok **PASS** on isolated preview; Gemini **PASS** on existing production runtime | Parent-executed real fixed chat + structured-output requests. Each new-preview check also verifies all six runtime usage/registry SELECT/INSERT/UPDATE grants. No wallet authority. Bankr explicitly blocked, not labeled READY. |
| `final-ux-evidence.json` / `final-ux-qa.md` | **24 scenarios**, **58 screenshots**, scoped PASS | Different independent reviewer executed the actual browser source with mocked dependencies. Includes explicit-provider behavior, stale chat/link responses, owner funding without V3 reads, original-hash funding recovery, one-wei review, wallet balance retry and zero-owned roster. No real wallet signing or chain writes. |
| `forge-journey-evidence.json` at 2026-09-13T18:54:24.911Z | **PASS**, 45,398ms, public transactions **0** | Forge specialist's composed native PostgreSQL/owned-Anvil proof. Actual server research bridge and owner-continuity/equipped-skill checks are included. Two source copies burned; each adds one credit, learning and slot unlock consume one each; transfer retains loadout/skills/slots/custody and pauses automation. Inventory clearance remains explicitly mocked; shared-Anvil clients do not prove independent public finality. |

The real runtime privilege/probe evidence closes the earlier distinction between the read-only inspection role and the actual application role. No permission changes were inferred from the read-only role's intentionally absent INSERT/UPDATE privileges. Model configuration and a successful preview probe still do not mean a new model has been enabled in production.

Security accepts the reviewed software for controlled final testing with existing authority limits. The lead must record the final integrated source and full validation result. A future live burn, refund, wallet transfer, new executable marketplace adapter or autonomous-scope change requires its own concrete owner authorization and review.
