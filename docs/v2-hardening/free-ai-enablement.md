# Free AI provider enablement — September 13, 2026

Groq is the selected free addition. Its adapter, registry, runtime, preference UI and database constraint are implemented and tested. Actual chat and strict JSON responses passed; the deployed quota-backed runtime check is still required before declaring production ready. Bankr remains disabled by the owner's explicit choice; none of this work activates Bankr or a paid plan.

## Current account and credential evidence

On September 13, the existing Groq console session for the project owner's authorized email showed **Free / $0 / Current Plan**. The owner subsequently created a key named `gogh`. The owner explicitly authorized reading that key from the clipboard. The lead stored it as secret `GROQ_API_KEY` in Netlify Functions for production and deploy-preview, without displaying it or writing it to a local file. Other applications' keys were unchanged.

A read-only Netlify inventory returned HTTP 200 and no Bankr-, Groq-, OpenRouter- or Cloudflare-named variables. Narrow checks of exact project Keychain service names also found no matching credentials. This does not prove no credentials exist under other names. No keychain dump or unrelated credential lookup was performed. A new Bankr tab was opened, but no account email, signup, top-up or payment was submitted.

## Reviewed alternatives

| Provider | Free allocation reviewed | Structured output | Decision |
| --- | --- | --- | --- |
| Groq | GPT-OSS 20B: 30 requests/minute, 1,000/day, 8,000 tokens/minute and 200,000/day. Organization limits are shared; the account console is authoritative. | Reviewed model supports strict JSON Schema. | Implement first; actual account is already Free. |
| OpenRouter free | 50 requests/day and 20/minute without purchasing credits. | Free router selects compatible models, including structured-output support, when available. | Documented fallback candidate; no second account or adapter created. |
| Cloudflare Workers AI | 10,000 neurons/day; Free-plan requests fail beyond allowance. | Model-specific; no current project credential or working adapter verified. | Reserve option; no account or upgrade created. |

Sources: [Groq limits](https://console.groq.com/docs/rate-limits), [Groq strict output](https://console.groq.com/docs/structured-outputs), [Groq free-plan/no-card FAQ](https://community.groq.com/t/is-there-a-free-tier-and-what-are-its-limits/790), [OpenRouter free router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground), [OpenRouter rate limits](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/), [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

Free allocations are suitable for bounded holder testing and limited traffic; they are not unlimited production capacity. This change does not upgrade a plan, add payment information, create automatic top-ups, or bypass quotas by creating extra accounts.

## Groq implementation

`GroqArtBrokerProvider` implements the existing `ArtBrokerAIProvider` contract. Its constructor accepts the established `modelId`, `fetchImpl`, `environment`, `timeoutMs` and endpoint arguments. The only accepted model is the exported `GROQ_ART_BROKER_MODEL`, `openai/gpt-oss-20b`; the only endpoint is `https://api.groq.com/openai/v1/chat/completions`.

The provider uses `GROQ_API_KEY` server-side, supports existing text tasks and strict JSON Schema, and exposes no tools or image input. Low reasoning effort and hidden reasoning keep responses concise. It validates actual response model identity, one finished response, refusal/tool-call absence and structured JSON parsing. HTTP 400/401/402/403/422/429 errors are sanitized and terminal. Existing bounded transport, response-size limits, secret redaction and transient outage handling are reused. No prompt can choose another endpoint, model, wallet tool or payment tier. The adapter never upgrades an account; remaining on the Free plan is an account configuration requirement, not a property an inference request can prove.

Root integration owns the provider enum, runtime, registry, schema/database constraints and frontend selection. Those seams must be integrated before enabling `GOGH_GROQ_MODEL`. Bankr and Groq remain distinct providers. Real structured strategy decisions still pass existing domain validation and owner confirmation after model output.

## Safe handoff and live proof

Store the owner-created key in Netlify `GROQ_API_KEY`, scoped to Functions, or macOS Keychain service `Gogh Punks Groq API Key`, account `riffs.mon@gmail.com`. Do not put its value in chat, source, client JavaScript or test artifacts.

Run the local two-response fixed probe after verifying the account is still on Free:

```sh
node scripts/check-groq-gateway.mjs --free-plan-verified --keychain --output=/private/tmp/gogh-groq-live-proof.json
```

Without `--keychain`, the script reads the server process environment. `--free-plan-verified` records an operator attestation of the observed plan; it does not check billing automatically. The script sends exactly one fixed chat and one fixed strict JSON request. It accepts no custom prompts or endpoints, prints only safe proof fields, and performs no chain or billing writes. `ADAPTER_LIVE_VERIFIED` deliberately does not claim deployed readiness. After root integrates the provider and the database constraint, use the existing authenticated, quota-backed admin AI check with provider `GROQ`; its chat, structured result and runtime privileges must all pass.

`GOGH_GROQ_MODEL=openai/gpt-oss-20b` and both configured per-million-token cost rates `0` describe the verified Free plan. Do not reuse those zero rates if the account is later upgraded. Existing owner quotas remain necessary because free provider limits are shared across the organization.

## Bankr disposition

The gateway already existed but has no verified project key or credits. Official documentation states that new accounts start at zero credits and that free terminal messages do not include API inference. The reviewed public first-party purchase form enforces a $5 minimum top-up from the separate Bankr wallet; that UI observation is not a payment quote or authorization. No purchase was attempted. [Bankr gateway](https://docs.bankr.bot/llm-gateway/overview/), [key permissions](https://docs.bankr.bot/security/developer-api/), [first-party credit screen](https://bankr.bot/llm?tab=credits).

The hardened adapter prefers a dedicated `BANKR_LLM_KEY`, with the existing `BANKR_API_KEY` fallback only when the dedicated key is absent. An invalid dedicated key never falls back. It rejects local routing aliases as upstream model IDs, unexpected tools, credit/auth failures and output truncation. HTTP 402 may mean credits or a daily budget limit, so the error does not advise an automatic top-up. Its fixed read-only operator preflight checks authenticated model availability, effective credit balance and any daily budget with two GETs, and requires a later inference proof. Source: [Bankr API reference](https://docs.bankr.bot/llm-gateway/api-reference/).

```sh
node scripts/check-bankr-gateway.mjs
```

This command requires existing server environment values; it does not fetch secrets from unrelated stores or purchase credits. It returns `NOT_READY` without credentials. Bankr model availability remains unverified: unauthenticated `/v1/models` returned HTTP 401, as expected.

## Validation

Focused adapter/probe and existing AI regression suite: **74/74 passed**, zero failures, skipped or cancelled (2.213 seconds). Command: `node --test tests/groq-provider.test.mjs tests/bankr-enablement.test.mjs tests/v2-swarm-ai.test.mjs tests/v2-hardening-ai.test.mjs`. Both operator scripts also passed Node syntax checks and `git diff --check` passed. New tests cover exact model/origin binding, dedicated credential preference, no network without configuration/free-plan verification, no arbitrary tool routing, actual provider identity, strict JSON output, truncated/refused/tool-call responses, sanitized limits, two fixed read-only Bankr checks, daily budget/credit rejection, bounded stalled streams and the distinction between configuration, local live proof and deployed readiness.

No new contracts, wallet permissions, skills, database migrations, frontend controls or production environment changes are included in this specialist branch. Root integrates the approved shared seams separately. Bankr remains disabled; Groq has completed secure credential handoff and direct live probes; deployed verification remains pending.

## Lead integration evidence

The provider is wired into the existing runtime and explicit preference selector. Auto prioritizes it for ordinary text tasks; image capability remains false. A terminal free-tier rate limit does not trigger another provider charge. A key alone does not activate a model. The additive migration `20260913200000_add_groq_provider.sql` adds GROQ only to the two provider CHECK constraints, preserving existing data, quotas, privileges and wallet permissions.

At 2026-09-13T19:58:57Z the fixed direct live probes passed: chat 213 ms and strict intent JSON 125 ms, both reporting the exact reviewed `openai/gpt-oss-20b` model. See [sanitized proof](groq-live-adapter-proof.json). These times are two observed requests, not a production latency guarantee.

The integrated focused suite passed 105 tests. Native disposable PostgreSQL passed 28 assertions, including the actual migration, Groq registry insertion and usage finalization under the restricted request role, exactly-once accounting, shared quota enforcement, concurrency and disk restart. No live database was used by that test.

The complete site gate passed 2,488 JavaScript tests, domain typechecking, wallet build, syntax/static/secret checks and broker checks. The real browser harness passed 25 scenarios and 59 screenshots, including clearing the stale balance meter. The fresh independent reviewer approved reversible deployment with 148 focused and eight adversarial tests; subsequent metadata/comment changes passed 57 tests. See [independent review](free-ai-security-review.md).

Netlify applies the provider constraint migration to the preview database before availability and to production before publishing; migration failures block publication. [Netlify migration lifecycle](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/). No out-of-band production SQL was executed. Legacy V1 settlement source strings remain secondary/primary slot identifiers, not vendor provenance, to preserve saved evidence hashes and the existing training database constraint.
