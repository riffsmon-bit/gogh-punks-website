# Production configuration readiness

Audited September 13, 2026 (UTC evidence timestamps September 14). Values and credential-bearing endpoints are excluded. Evidence: [config-evidence.json](config-evidence.json), [database-inventory.json](database-inventory.json).

| Name | Purpose | Present | Production | Validated this campaign | Missing impact |
|---|---|---|---|---|---|
| ROBINHOOD_ARCHIVE_RPC_URL | Historical state / logs | Yes | Functions | Local saved Validation Cloud endpoint passed known historical read; deployed probe pending | Owner continuity, Forge and execution fail closed |
| ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL | Independent chain evidence | Yes | Functions | Saved provisioning record identifies Blockmachine; known receipt/topic-filter query passed. Deployed probe pending | Dual-provider checks unavailable |
| FORGE_TRAINING_REQUEST_DATABASE_URL | Restricted training requests | Yes | Functions | Role metadata verified; deployed runtime-role probe pending | Training review/recovery unavailable |
| FORGE_TRAINING_WORKER_DATABASE_URL | Training reconciliation | Yes | Functions | Role metadata verified; deployed runtime-role probe pending | Settlement unavailable |
| SUPABASE_DATABASE_URL | Legacy/training administration | Yes | Functions | TLS-verified read-only schema audit passed | Additive provisioning blocked |
| OPENSEA_API_KEY | Approved market/project reads | Yes | Functions | Reviewed read-skill acceptance evidence; no trading authority | Market/Social Scout data unavailable |
| GROQ_API_KEY | Free Groq inference | Yes | Functions | Production chat and structured-output probes passed | Groq unavailable |
| Configured Gemini/OpenAI/Anthropic/xAI credentials and model settings | Existing AI providers | Yes | Functions | All four production chat and structured-output probes passed | Individual provider unavailable |
| GOGH_V2_AI_CHECK_TOKEN | Protected AI diagnostic | Yes | Functions | Production diagnostic authorization passed | Operator health check unavailable |
| GOGH_V2_RELEASE_CHECK_TOKEN | Bounded chain/database diagnostic | Yes, created this campaign | Functions / production + deploy preview | Handler passed unit and independent review; deploy pending | Fresh protected runtime proof unavailable |
| FORGE_SKILL_ADMIN_DATABASE_URL | Restricted skill-registry request journal | Not yet | Not yet | Migration, recovery and native proof in review | Administrator wallet setup blocked |
| MARKETPLACE_REQUEST_DATABASE_URL | Restricted purchase journal | No | No | Not released | Public purchases blocked |
| BANKR | Deliberately excluded by owner | Not required | Disabled | Exclusion retained; no paid top-up | None for available chat providers |

Netlify Secrets Controller masks secret values in management API responses. A masked response is not evidence of an invalid runtime URL. Deployed restricted diagnostics validate those credentials without disclosing them.

The five live AI checks took 1.6–4.4 seconds per combined chat + structured-output diagnostic. These are single diagnostic samples, not p95 latency or first-token measurements.

No private key was exported, no new financial permission was activated, and no owner funds were moved.
