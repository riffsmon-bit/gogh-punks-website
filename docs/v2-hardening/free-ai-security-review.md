# Free AI independent security and functionality review

## STATUS

**APPROVE FOR REVERSIBLE DEPLOYMENT — no P0, P1, or code-level deployment blocker found.**

Reviewed candidate `e135197f065395eb5f19543ea38e7eff001c56de` against
`origin/main` `fe6551552b0726c8241d93c4a050a0c1eda1ed0a` for PR 67 on September 13,
2026. This recommendation covers the reviewed application change; it does not
declare the deployed quota-backed Groq runtime verified. That remains a release
check. The lead's two follow-up working-tree edits described below were also
reviewed. Other later implementation changes require incremental review.

## FILES CHANGED

- `docs/v2-hardening/free-ai-security-review.md` — this independent assessment.
- `tests/free-ai-security-review.test.mjs` — eight synthetic, offline tests of
  the actual Groq adapter/router/admin seam and invalid RPC configuration.

## FILES INTENTIONALLY NOT CHANGED

The reviewer changed no application implementation, migration, contract,
deployment manifest, environment setting, credential, browser state, or existing
test. No branch commit was created. Lead-owned follow-up changes are separate.

## SUMMARY

Groq is fixed to `openai/gpt-oss-20b` and its exact HTTPS chat endpoint. It rejects
wrong-model, ambiguous, incomplete, refused, and tool-call responses. Its request
body does not accept caller-selected endpoints, models, tools, or wallet actions.
Bankr's dedicated-key preference does not fall back when that key is malformed.
Both adapters reuse bounded, redirect-rejecting transport that discards upstream
error bodies and replaces raw transport failures with local errors.

The new migration adds `GROQ` to the existing two provider CHECK constraints. It
does not add privileges, change quota limits, relax identity binding, or grant
execution authority. Runtime selection and browser preferences recognize Groq
without exposing its key. A key alone does not activate the model.

The configured Forge pair remains a server dependency. Its primary occupies
index 1, preserving training coordination's existing selection. Both clients
remain required for terminal settlement. Invalid configured values stop setup;
they do not silently fall back. The balance meter now hides and resets to `0%`
while balances are unknown, and restores visibility when known.

## INTERFACES

- Provider construction and invocation keep the existing provider contract.
  Groq's accepted model is deliberately narrower than the registry's general
  model string type; an invalid configured Groq model fails construction.
- Explicit `GROQ` preference stays within that provider. In `AUTO`, Groq rate,
  credit, authentication, access, and input errors are terminal. Existing
  transient transport/5xx fallback remains possible to another configured
  provider and reserves another quota attempt; `AUTO` is not a universal
  no-paid-provider guarantee. High-capability task ordering is also unchanged.
- `createForgeRpcClients` returns `[secondary, primary]`. Configured URLs may
  contain path/query credentials, remain server-side, require HTTPS and distinct
  hostnames, reject userinfo/fragments, and disallow redirects. Distinct hostnames
  do not independently prove separate operators; trusted deployment
  configuration must supply the intended independent providers.
- No schema name, stored settlement hash format, wallet interface, contract
  authorization, or signing path changes in this candidate.

## TESTS

Independently executed against the candidate:

```sh
node --test tests/groq-provider.test.mjs tests/groq-runtime.test.mjs \
  tests/bankr-enablement.test.mjs tests/v2-swarm-ai.test.mjs \
  tests/v2-hardening-ai.test.mjs tests/art-broker-v2-ai.test.mjs \
  tests/art-broker-v2-ai-check.test.mjs tests/skill-forge-rpc-clients.test.mjs \
  tests/robinhood-rpc-endpoints.test.mjs \
  tests/skill-forge-training-settlement.test.mjs \
  tests/skill-forge-training-reconciler.test.mjs \
  tests/skill-forge-training-api.test.mjs \
  tests/skill-forge-selected-burn-api.test.mjs
node --test tests/free-ai-security-review.test.mjs
```

Results: **148/148** existing focused tests passed (13.015 seconds) and **8/8**
independent review tests passed (0.926 seconds), with no failure, cancellation,
or skip. These tests use synthetic credentials and fixtures, with no real
provider, chain, or database request from this reviewer.

The lead separately reported 28 assertions on disposable native PostgreSQL,
including actual migration, restricted-role Groq accounting, shared quota,
concurrency and restart; 2,488 full-site tests; and 25 browser scenarios with
59 screenshots. Those are lead-reported results, not independently rerun here.
The checked-in direct adapter proof records two successful live responses while
explicitly setting `productionRuntimeVerified: false`.

## RESULTS

No P0/P1 issue found. Two nonblocking metadata observations were sent to the lead:

1. In the reviewed candidate, `registry.mjs:73` advertises Bankr image support
   while `bankr.mjs:43` reports `images: false`. Current inputs are text-only and
   Bankr remains disabled. The lead's reviewed follow-up now sets that registry
   flag to false for both Bankr and Groq, resolving the mismatch.
2. `training-settlement.mjs:8` and `:55` use original provider names even when
   the new helper selects configured vendors. The persisted V1 source array
   `['PUBLICNODE', 'ROBINHOOD']` must be interpreted as the legacy
   secondary/primary slot identifiers, not proof of current operator identity.
   Preserve these strings and historical hashes in this release and document
   that meaning. Literal provider provenance needs a later versioned change.

The lead's reviewed follow-up adds the V1 slot interpretation directly beside
`SOURCES` and changes the client-order comment to secondary/primary. It changes
no evidence values, serializer behavior, hash, or SQL. A focused rerun after both
lead edits passed **57/57**, with no failure, cancellation, or skip (1.696 seconds):

```sh
node --test tests/groq-runtime.test.mjs tests/bankr-enablement.test.mjs \
  tests/skill-forge-training-settlement.test.mjs tests/free-ai-security-review.test.mjs
```

The second observation does not remove quorum checks. Candidate line references
below precede the added comment. The serializer at
`training-settlement.mjs:32`, emitted evidence at `:132`, and SQL CHECK at
`20260911140000_settle_forge_training_intents.sql:39` require the legacy array.
Simply renaming it would break durable settlement compatibility. The actual
verifier still checks both chain IDs, a shared finalized anchor, matching
nonces/receipts, expected runtime, and a final canonical/finality recheck. Tests
reject unavailable finalized tags, stale/future heads, mismatched chain/block/
nonce/receipt/code, and provider outage; no one-provider fallback is introduced.

## SECURITY

- Credential and destination evidence: `ai/provider.mjs:56` and `:64`,
  `ai/groq.mjs:14`–`:17` and `:45`–`:48`, `ai/bankr.mjs:8`–`:12`.
  No request-controlled endpoint or credential lookup was added.
- Response and cost boundaries: `ai/groq.mjs:49`–`:71` and
  `ai/router.mjs:57`–`:84`. Failed attempts retain committed quota reservations;
  usage-accounting failures do not generate another answer. Invalid/truncated
  output is terminal. Free-plan zero cost remains an operator configuration
  fact, not something the adapter can infer from an API key.
- Safe admin check: `broker-v2-ai-check.mjs:48`–`:73` authenticates a dedicated
  token, enforces origin and a fixed body, checks DB privileges before inference,
  and sends only fixed probes. Its response at `:81`–`:100` allowlists local
  diagnostics rather than returning model output or raw exceptions. The new
  independent tests exercise this through the real adapter and router for all
  six new terminal HTTP statuses and for denied quota.
- Structured output remains a draft. JSON parsing is not complete local JSON
  Schema validation; existing domain normalization and owner confirmation are
  still required (`ai/intent-interpreter.mjs:16`, `art-intelligence.mjs:38`).
  This release does not replace either boundary with model assertions.
- Financial RPC reads: `skill-forge/rpc-clients.mjs:6`–`:27`,
  `_shared/forge-training-runtime.mjs:58`–`:63`, and
  `skill-forge/training-settlement.mjs:58`–`:133` preserve read verification and
  endpoint ordering. Training and selected-burn HTTP routes sanitize downstream
  failures. Client configuration supplies no signing credential or automatic
  transaction submission.

## DEPENDENCIES

No dependency or package-lock change. The additive provider migration must be
applied before enabling the Groq model in that environment. The exact reviewed
model, Functions-scoped key, zero rates for the verified Free plan, existing
durable quota role, and valid independent RPC configuration remain deployment
dependencies. Bankr's account, credits, and live model support were not verified
by this reviewer and Bankr remains disabled.

## BLOCKERS

None at the reviewed code boundary for a reversible deployment. Production
readiness still requires the authenticated deployed `GROQ` admin check to pass
both fixed probes and actual database privilege checks after migration. The
lead reported preview check authentication configuration still being resolved
at the time of this assessment; that is not proof of an adapter failure.

## INTEGRATION NOTES

This reviewer read source, tests, and sanitized proof only. No live credential or
browser inspection, billing change, provider request, chain transaction, or
production DB write was performed. Integrate the owned files without claiming
their test counts cover a later unreviewed implementation. The reviewed lead
follow-up consists only of the Bankr registry flag alignment (one changed line)
and legacy-source/order comments (four added lines, one removed comment).
Neither rewrites persisted settlement evidence or broadens the migration.
