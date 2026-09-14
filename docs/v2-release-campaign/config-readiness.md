# Production configuration readiness

Campaign baseline: main b442b44. Values and credential-bearing endpoints must never be recorded here. Prior successful probes are historical evidence, not a fresh validation.

| Name | Purpose | Present | Production | Validated this campaign | Missing impact |
|---|---|---|---|---|---|
| ROBINHOOD_ARCHIVE_RPC_URL | Historical chain state and transfer logs | Auditing | Auditing | Pending | Owner continuity, Forge and execution checks fail closed |
| ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL | Independent anchored chain validation | Auditing | Auditing | Pending | Dual-provider Forge checks unavailable |
| FORGE_TRAINING_REQUEST_DATABASE_URL | Restricted owner training/selected burn journal | Auditing | Auditing | Pending | Review/claim/recovery unavailable |
| FORGE_TRAINING_WORKER_DATABASE_URL | Training settlement worker | Auditing | Auditing | Pending | Settlement reconciliation unavailable |
| OPENSEA_API_KEY | Approved marketplace data | Auditing | Auditing | Pending | Market reads/listing source unavailable |
| GROQ_API_KEY | Free-service Groq inference | Previously present | Previously configured | Pending | Explicit Groq model unavailable; no paid fallback implied |
| Other configured AI provider/gateway settings | Gemini/OpenAI/Anthropic/xAI | Auditing | Auditing | Pending | Provider-specific unavailable status |
| Dedicated marketplace request DB configuration | Restricted purchase journal | Not released at baseline | No | Pending implementation | Public purchases blocked |
| BANKR | Deliberately excluded by owner | Not required | Disabled | Retained exclusion | None for this release |
