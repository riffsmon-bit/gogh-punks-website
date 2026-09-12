# Gogh Punks Art Broker V2 — local build review

Review date: 2026-09-06

Build status: **local + pull-request review candidate**

Production status: **not deployed, not migrated, no live transaction submitted**

The architecture audit and V1 disposition are in
[`ART_BROKER_V2_IMPLEMENTATION_MAP.md`](./ART_BROKER_V2_IMPLEMENTATION_MAP.md).
This report records what the local implementation actually does and does not claim readiness where
an integration, credential, migration, or production authorization is absent.

## 1. V2 architecture

The public product is V2; new internal domain modules use `broker/src/v4` to avoid colliding with
the retired repository's older V2/V3 naming.

```text
owner -> live NFT ownership -> canonical Punk Wallet -> structured strategy
      -> shared normalized opportunity -> deterministic screen/match/simulation
      -> ASK recommendation or ASSIST owner transaction review
```

AI interprets and classifies. Protocol code validates and constructs. The owner supplies rules and
money. The Punk Wallet retains custody. No LLM adapter receives signing or arbitrary calldata
authority.

## 2. V1 compatibility status

V1 hosted execution remains retired. The build retains ownership discovery, canonical wallet
resolution, balances, V1 activity and acquisition history, metadata, refund/reconciliation records,
and existing owner-only withdrawal surfaces. Six lanes, rotation, priority processing, project gas,
PREPAY + SEND, and hosted worker lifecycle are not dependencies of the V2 product.

## 3. Punk Wallet integration

The server resolves the deployed V3 registry account, activation state, runtime bytecode, and native
balance at one pinned block. Direct funding rechecks the current owner and canonical destination;
the browser sends native value owner-to-Punk-Wallet and never through project custody. Withdrawals
route to the existing live-checked owner recovery UI and require neither AI nor the V2 executor.

## 4. Ownership model

Every Punk mutation requires a signed V2 session and a fresh on-chain `ownerOf` check. Strategy
activation adds an intent-specific SIWE signature. Indexed ownership is only a bounded discovery
hint. Tests prove an old owner is rejected and a new owner is accepted immediately after transfer.

## 5. Database migrations

The V2 migrations are additive. They create profiles, signed-session state,
strategies, explicit preferences, conversations, opportunities and sources, cached analyses,
screenings, simulations, durable execution attempts, activity, provider/model usage, read-only
owner-taught Punk skills, and legacy
links. It contains no destructive V1 statement or key material. The migration has **not** been
applied to any database.

## 6. AI provider matrix

| Provider | Adapter | Current protocol | Structured output | Local tests | Production configuration |
| --- | --- | --- | --- | --- | --- |
| Gemini | `GeminiArtBrokerProvider` | stateless generateContent via the configured Google/Netlify base URL | response JSON Schema | pass | configured model + direct or Netlify-injected credential |
| OpenAI | `OpenAIArtBrokerProvider` | Responses API | strict JSON Schema | pass | model + key required |
| Anthropic | `AnthropicArtBrokerProvider` | Messages API | `output_config.format` | pass | model + key required |
| xAI | `XAIArtBrokerProvider` | Responses API | strict JSON Schema | pass | model + key required |
| Bankr | `BankrArtBrokerProvider` | OpenAI-compatible gateway | JSON Schema response format | pass | route + key required |
| Future | `ArtBrokerAIProvider` | adapter-owned | capability declared | interface pass | adapter required |

Model IDs and token prices are server configuration, not frontend constants. API keys remain
server-only. `gemini-3.8-flash` is the reviewed free-tier preview choice; free-tier quotas apply and
Google states that free-tier content may be used to improve its products. No production provider
credential was used during this build.

## 7. AUTO model router

The router chooses enabled registry entries by task, cost tier, speed tier, capability class, and
fallback priority. It calls one provider at a time and falls back only for retryable failures.
Quota enforcement is 100 requests per owner fingerprint and 25 per Punk per 24 hours by default.
Provider, tokens, cache state, latency, outcome, and configured token-cost estimate are recorded.

## 8. MCP implementation

The JSON-RPC MCP endpoint lists and dispatches the requested read, analysis, strategy-draft,
simulation-read, and preparation tools with accurate strict input schemas. `tools/call` requires the
owner session and fresh Punk ownership where Punk-specific. Arbitrary transaction, signing, key,
asset transfer, and admin-withdraw tools do not exist.

## 9. Conversational intent system

Production chat uses the provider router and validates the returned object against the canonical
domain normalizer. The pull-request review combines deterministic policy parsing with a configured
server-side Gemini conversational provider. The PR endpoint first verifies the selected Punk's current
owner and canonical Punk Wallet, returns an ephemeral structured draft, and is absent from production. The database-backed
path persists the owner message, Punk response, and pending strategy version after its migration is
authorized; neither path activates economic permission from conversation alone. Chat can also
compile an owner-taught skill into a bounded `GOGH_PUNK_SKILL_V1` draft. Skills are read-only,
require confirmation, and cannot alter structured policy or wallet authority.

## 10. Strategy schema

`PunkCollectingIntentV1` includes identity, ASK/ASSIST/AUTONOMOUS mode, free/paid ceiling, gas cap,
daily and total limits, reserve, maximum supply, taste/avoid state, required website/socials,
contract/adapter allow and deny lists, risk ceiling, simulation, expiry, and discovery/link controls.
Unknown fields, unsafe combinations, expired intents, and autonomous-without-simulation fail closed.

## 11. Link scanner

The scanner accepts only clean HTTPS URLs, blocks local/private targets and credentials, recognizes
OpenSea collection/drop, direct X post, Robinhood explorer contract, and generic project-site forms,
and never accepts external wallet requests or transaction data. Trusted source-specific contract
resolvers are an explicit integration boundary; an unconfigured source returns `NEEDS_REVIEW`.

## 12. Discovery engine

The in-memory and Postgres repositories normalize and deduplicate source sightings, serialize
analysis by input hash, and reuse one collection analysis across Punks. The isolated deploy-preview
queue can ingest confirmed Robinhood SeaDrop events and fail closed through reviewed
runtime, adapter registry, price, supply, timing, fee-recipient, and per-Punk simulation gates. No
production discovery schedule or external feed has been enabled.

## 13. Opportunity schema

`NormalizedOpportunityV2` binds chain, collection, mint contract, mint stage, known adapter, method,
price, gas estimate, supply, per-wallet limit, start/end, public HTTPS metadata, art styles, runtime
hashes, screening/simulation state, risk, receiver, and unexpected-effect flags. Dedupe identity is
chain + collection + mint contract + stage + adapter.

## 14. Security screening

The deterministic screen rejects wrong chain/recipient/value/receiver, unknown selectors or
adapters, unpinned or changed code, delegatecall, approvals, and asset transfers. Product copy says
screening reduces known risk; it never promises safety.

## 15. Simulation

Simulation evidence must prove success, exact value, expected NFT receiver, bounded gas cost, no
approvals, no unexpected transfers, and verified post-call effects. The API currently exposes only
persisted known-safe Punk-specific simulation evidence; it does not trust a mint website or perform
a generic live call.

## 16. Policy matcher

Matching is deterministic and covers owner/wallet identity, active time window, screening,
simulation, adapters/contracts, price, gas, daily/total/per-wallet counts, reserve, risk, supply,
website/social requirements, and taste. It returns transparent rejection and match reasons. No AI
call is used for field comparison.

## 17. Execution engine

The stateless preparation engine rechecks ownership and policy, reserves a durable attempt, builds
through an injected known-safe adapter, screens, simulates, and emits either an ASK recommendation
or ASSIST envelope for explicit owner review. It has no production submit method. AUTONOMOUS fails
before adapter construction under the current deployed-wallet limitation.

## 18. Idempotency

Attempt identity binds chain, Punk Wallet, opportunity, canonical strategy hash, account nonce, and
mode. Postgres reservation uses a unique key with conflict replay. State advances monotonically from
reservation through simulation and owner approval; production submission/reconciliation states are
defined but intentionally unwired.

## 19. Control Center UI

The control center implements the original premium art-broker roster, selected Punk hero,
Talk, Strategy, Fund, Collection, Activity, Withdraw, and Settings. Live mode hydrates authenticated
profile, wallet balance, V1+V2 activity, and NFT holdings. The pull-request review uses live pinned-block
ownership, ephemeral strategy drafts, AI conversation, and review-only link inspection. Owner-approved
funding, WETH wrapping/unwrapping, and withdrawals remain explicit wallet transactions; agent discovery
cannot broadcast. A confirmed chat mission can send a tab-scoped Punk into the shared review queue. It
rechecks once per minute, deduplicates eligible collection contracts, and returns only when its requested
unique-match count is reached or the owner pauses it. Closing the tab stops this preview loop.

## 20. Mobile UI

Mobile uses a horizontal roster, large selected Punk, fixed scrollable action navigation, stacked
strategy/funding panels, two-column gallery, full-width confirmation actions, and bounded chat
scrolling. It is designed directly at 375/390 px rather than scaled from desktop.

## 21. Design review

The visual system uses semantic surfaces and acid/cyan/safety colors, strong display hierarchy,
minimal shadows, restrained diagonal motion texture, and no proprietary fighter-game asset or
layout. After review, authenticated live hydration, empty/error states, operations hierarchy, and
44 px interactive targets were tightened.

## 22. Screenshot review results

Eleven local states were captured: 1600 px desktop, 1280 px laptop, 820 px tablet, 390/375 px
iPhone, confirmation modal, disconnected wallet, one Punk, twelve Punks, long mobile conversation,
and admin operations. Automated metrics found no horizontal document overflow, wrong visible tab,
or rendered `undefined` marker. Images are local temporary review artifacts and are not shipped.

## 23. Accessibility

Semantic landmarks, labeled navigation, listbox roster, visible focus, live regions, screen-reader
labels, skip links, minimum interaction heights, contrast-oriented semantic tokens, and reduced
motion are implemented. A manual screen-reader pass on physical mobile hardware remains a canary
check.

## 24. Test results

- Current mission/chat-focused Node tests: **53 passed, 0 failed**.
- Deploy-preview-equivalent site gate: **127 passed, 0 failed**.
- Contract build/lint/test/ABI gate: **142 passed, 0 failed** at 1,024 fuzz runs.
- Full repository Node suite: **1,032 passed, 13 failed**. The same 13 tests failed before V2 work;
  all assert obsolete pre-retirement V1 worker behavior after the fixed 2026-09-05 cutoff now returns
  `V1_RETIRED` or `V1_REGISTRATION_CLOSED`. V2 added no new failing category.

## 25. Build results

Site asset/secret checks pass. JavaScript syntax checking passes for 445 modules. The Art Broker
manifest/database check passes. All 18 V2 Netlify functions bundle locally into an isolated
temporary directory. No production build or deployment command was run.

## 26. Cost and usage observability

The private aggregated API and operations page show opportunity screening, active strategies,
execution outcomes, provider/model usage, token counts, cache hits, latency, configured token-cost
estimates, and executor lock state. Owner identities are one-way short fingerprints in usage rows;
the admin response returns no wallet or conversation data.

## 27. Security review

The build keeps keys server-side, uses fixed provider origins and bounded responses/timeouts, stores
opaque session hashes in an HttpOnly/Secure/SameSite=Strict cookie, requires same-origin mutations,
uses intent-specific owner signatures, rechecks live NFT authority, validates public URLs, and never
accepts LLM or website calldata as authority. Static scans found no embedded provider/signing secret.

## 28. Canary readiness

ASK can now be exercised in the PR review against live owner/Punk Wallet reads with ephemeral drafts.
Chat can activate and immediately dispatch a review-only mission. A mission remains `SCOUTING` across
repeated queue checks and becomes `RETURNED` only after its unique-match target is met. A phrase such as
"this mint" binds only when the link scanner has resolved an exact Robinhood contract; unresolved marketplace
or project links request clarification instead of broadening authority.
Its persistent AI-backed path remains integration-ready after migration/configuration. ASSIST has the
domain and owner-approval boundary but still needs one production-reviewed adapter/simulator wiring
before a transaction can be offered. AUTONOMOUS is built as a fail-closed policy/execution mode but
is **not canary-ready** with the current deployed wallet gas model.

## 29. Remaining blockers

- Apply and smoke-test the additive migration in a non-production review database.
- Authorize and configure production server-side model IDs, keys, and token prices; run provider
  contract tests with controlled low-cost calls. The isolated PR preview currently uses Gemini.
- Implement and review source-specific URL resolvers and production discovery feed jobs.
- Move tab-scoped mission polling into a durable authenticated scheduler before claiming that a Punk keeps
  scouting after its browser tab closes.
- Wire at least one reviewed adapter to live, pinned simulation for ASSIST.
- Resolve how a Punk-funded AUTONOMOUS transaction pays gas without restoring hosted project gas or
  giving an executor unrestricted withdrawal authority.
- Complete physical-device wallet, screen-reader, and degraded-provider canary testing.

## 30. Exact items requiring production authorization

1. Applying `20260906010000_create_art_broker_v2.sql` to a hosted database.
2. Adding/enabling Gemini, OpenAI, Anthropic, xAI, or Bankr credentials and current model registry entries.
3. Enabling any external discovery, contract-resolution, or simulation network job.
4. Publishing the V2 site/functions or changing production routes.
5. Presenting or submitting any live ASSIST transaction.
6. Registering/authorizing an executor, changing on-chain policy, deploying or upgrading a wallet,
   or adding a reimbursement mechanism.
7. Activating one autonomous canary Punk.
8. Broadening autonomous activation beyond the separately proven canary.

None of these actions occurred in this local build.
