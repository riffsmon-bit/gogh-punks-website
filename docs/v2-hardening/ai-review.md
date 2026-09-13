# AI hardening review

September 13, 2026. Candidate branch `v2/hardening-ai-20260913`, based on `4f9e450`. This report describes code and disposable tests, not a live-provider acceptance certificate. No production environment or database was modified by this specialist.

## Completed behavior

- Production chat accepts optional `providerPreference`: `AUTO`, `GEMINI`, `OPENAI`, `ANTHROPIC`, `XAI`, or `BANKR`. Omission means AUTO; invalid or unknown values fail before provider invocation. Explicit choices stay on the selected provider. The authenticated owner and selected Punk remain the quota identity; this field carries no wallet authority. Parent owns browser persistence by owner and chain.
- Every provider attempt reserves its allowance in the existing usage table before network access. The server acquires a transaction-scoped owner advisory lock, counts that owner's rolling 24-hour rows, and commits a `RESERVED` usage row only below 100 attempts per owner and 25 per Punk. Fallback has a separate reservation. A locked count uses a fresh READ COMMITTED snapshot. Historical usage rows still count.
- Finalization updates exactly the reserved `usage_id`, owner fingerprint, Punk, provider, registry key, task and `RESERVED` state. No duplicate usage row is inserted. Wrong identity or repeated finalization fails closed. A crash, timeout, missing finalization privilege or uncertain provider outcome leaves a counted reservation; unknown tokens and cost remain null. This is conservative usage accounting, not proof that an upstream charged the request.
- A router call has one 20-second budget, including reservation, fallback and usage persistence. Individual network attempts have at most 10 seconds and receive the remaining budget and cancellation signal. Late reservation completion cannot start a generation. Late provider completion cannot publish a result or start fallback. Malformed/incomplete successful output remains terminal. A successful generation followed by a usage-write failure never buys another generation.
- Successful model-registry initialization is reused for the same database pool and registry hash; concurrent requests share the initialization promise. Failed initialization is not cached. This removes repeated registry upserts within a warm runtime. Cold runtimes still initialize against the database.
- The operator-only fixed check accepts optional `provider` using the same enum. It sends only the existing two bounded probes (256 output tokens each), pins an explicit provider, and accepts only that provider's exact expected response. Safe diagnostic codes never include prompts, response bodies, credentials or authenticated gateway URLs. `CONFIGURED` in the public provider list remains configuration evidence, not READY or a live health test.

## Provider routing and credential boundaries

Netlify injects provider keys and base URLs at function initialization; absence from the user-defined environment API is not evidence of missing managed credentials. Its gateway charges the existing Netlify credit quota. No new account, card, recharge or top-up was requested. These facts come from [Netlify AI Gateway](https://docs.netlify.com/build/ai-gateway/overview/) and its [function environment reference](https://docs.netlify.com/build/functions/environment-variables/).

| Provider | Candidate transport | Acceptance status |
|---|---|---|
| Gemini | Existing stateless `generateContent`, direct Google or the exact platform-bound gateway | Existing production configuration; this specialist performed no new live probe. |
| GPT / OpenAI | Existing Responses API, direct OpenAI or `OPENAI_BASE_URL` exactly bound to `NETLIFY_AI_GATEWAY_URL` | Unit-tested; real fixed probe required for the chosen model and deployment. |
| Claude / Anthropic | Messages API, direct Anthropic or `ANTHROPIC_BASE_URL` exactly bound to the platform gateway | Unit-tested; real fixed probe required. |
| Grok / xAI | Direct xAI Responses by default. Explicit `GOGH_XAI_TRANSPORT=NETLIFY_GATEWAY` selects tool-free gateway chat-completions with a constrained `x-ai/grok-*` model and the injected platform gateway key | Unit-tested; real fixed chat and JSON probes required. Provider identity remains XAI; this is not a fake OpenAI label. |
| Bankr | Existing fixed `https://llm.bankr.bot/v1/chat/completions` model gateway | Not established configured or live-ready. Requires an approved model/key and fixed probe; no wallet/agent API is used. |

The exact GPT gateway Responses protocol is documented in Netlify's [September 4 gateway announcement](https://www.netlify.com/changelog/gpt-6-astra-ai-gateway-agent-runners/). The example establishes transport support; it is not a reason to switch the project to an expensive model. Existing `store:false`, strict structured requests and final-output checks retain the [OpenAI Responses contract](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Netlify's gateway overview documents Grok through OpenRouter using its OpenAI-compatible `/v1/chat/completions` path. This is selected once by server configuration; it does not retry a generation across protocols. Unknown transports or non-Grok model identities are rejected.

Gateway bindings reject arbitrary hosts, mismatched platform URL, HTTP, credentials in URLs, alternate ports, fragments, queries and concealed path traversal. Direct provider endpoints remain available. Redirects are refused. The model receives no raw keys, arbitrary signing tools, contract calls or new wallet permissions. Endpoint overrides cannot broaden the approved destination.

## Gateway base-format follow-up review

The published `@netlify/serverless-functions-api` **2.21.2** distribution assigns the same gateway context URL to each configured provider URL variable; its injected gateway has the unversioned `/.netlify/ai/` prefix. The inspected archive SHA-256 is `2c49cb6c911b39aee27e20b0e1c7d3f55db7db3179467516a56ff8213eba1564`. This is published runtime source evidence, not an observation of the current production process. Sources: [published package](https://www.npmjs.com/package/@netlify/serverless-functions-api/v/2.21.2), [CLI gateway bootstrap at reviewed revision](https://github.com/netlify/primitives/blob/4e64893bb8d45bce11190f0f1feda7fa10ffe931/packages/ai/src/bootstrap/main.ts).

OpenAI's official client uses a `/v1` base and appends `/responses`; Anthropic's client uses an unversioned base and appends `/v1/messages`. As an explicit compatibility form, only OpenAI may use the exact authoritative gateway plus `/v1`. The adapter normalizes either accepted OpenAI base to one `/v1/responses` path. It rejects repeated versions, other paths/versions/hosts, encoding or traversal, and a versioned authoritative gateway. Anthropic retains its documented unversioned form. Sources: [OpenAI client](https://github.com/openai/openai-node/blob/main/src/client.ts), [Responses resource](https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts), [Anthropic Messages resource](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts).

The protected fixed admin check now first reads SQL grants through its actual injected request pool. Its response exposes only `databasePrivileges.checked`, `usageSelect`, `usageInsert`, `usageUpdate`, `registrySelect`, `registryInsert` and `registryUpdate`. A missing/unknown grant or a three-second catalog timeout returns `AI_DATABASE_PRIVILEGES_UNAVAILABLE` before any provider generation. It grants no permissions and exposes no database/role identity, URL or arbitrary query interface. Positive catalog grants are prerequisites; they do not alone prove successful writes or provider health. The fixed generation probes still provide the end-to-end usage-write check.

## Database and deployment requirements

No migration is needed. The existing `broker_v2_provider_usage` schema has a UUID primary key, nullable usage/cost and a constrained result-code field suitable for reservation. The production request role must have SELECT and INSERT to reserve, plus UPDATE to finalize usage; the registry needs its existing SELECT/INSERT/UPDATE privileges. Root must verify actual deployed role grants before promoting this candidate. No role grant or production row was changed here.

All callers of the database-backed router must supply a nonempty bounded owner fingerprint and a canonical decimal Punk string. A missing identity fails before network. The fixed operator probe retains its separate operator identity and Punk `0`; it cannot impersonate a holder or read conversations.

The owner lock serializes only the quota transaction. It is released before provider network access, and lock/statement timeouts are bounded. The count now filters by owner in the WHERE clause instead of scanning all owners in the 24-hour aggregate. No index change is proposed without a real production query-plan audit. Existing old release instances do not participate in the new reservation lock; complete deployment cutover is necessary for the new guarantee across all requests.

## Validation

- Existing AI, chat routing, persistence and transfer authority plus new hardening regressions: **85/85 passed** (`/private/tmp/gogh-hardening-ai-reviewed-final.log`).
- New tests prove exact managed destinations, explicit Grok credential selection, terminal usage failure, provider pinning, deadline during stalled reservation and provider, chat preference owner binding, and refusal to count another provider as a fixed probe pass.
- Native PostgreSQL proof: **24/24 assertions passed**, including 60 concurrent same-Punk requests with exactly 25 accepted, a further 120 requests across Punks with exactly 75 accepted (owner total 100), native disk restart, restricted-role failures, fallback accounting and wrong-owner finalization. Workload duration was 1,549 ms, excluding cluster creation. Evidence: `/private/tmp/gogh-hardening-ai-native-sql-review.log`. Command: `node tests/ai-quota-postgres.integration.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin`. The harness accepts only explicit local binaries, creates its own loopback cluster, applies only the existing AI table definitions, uses a restricted request role, restarts the disk-backed database, and cleans up only its own random directory.
- No live provider, production database, owner wallet or financial transaction is invoked by these tests. The parent integration suite and independent review remain required.

## Limits and remaining acceptance

The 20-second budget bounds the AI router, not all preceding authentication, ownership/history queries or later conversation persistence. End-to-end chat p95 and real first-token latency remain unmeasured; this candidate does not add streaming. The UI must continue to distinguish a grounded deterministic response from a live model response.

A timed-out request may already be billable upstream. The reservation remains counted; usage and price are null until actual evidence exists. The router does not repeat malformed or unfinished output to guess a better result, and does not retry paid generation after uncertain accounting.

Live GPT, Claude and Grok must not be marked READY until each configured deployment passes both fixed probes. Root will record sanitized provider/code/status evidence and verify existing Netlify credit limits before doing that bounded test. Bankr remains an explicit configuration/acceptance blocker unless the existing approved gateway credential is found. No provider adds autonomy or bypasses deterministic strategy confirmation, current-owner checks, skills, policy, simulation or execution gates.
