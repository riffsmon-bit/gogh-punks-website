# AI platform swarm review

Reviewed September 13, 2026. The existing provider-neutral platform is retained: OpenAI and xAI use the Responses adapter, Anthropic uses Messages, Bankr is an LLM gateway, and Gemini uses stateless generateContent. Registry selection, AUTO ordering, quota, usage recording, structured intent normalization and the server-only domain facade already exist. This change adds no model, dependency, environment setting, signing path or production call.

## Boundary fixes

The common `providerJsonRequest` previously called `response.text()` before checking its two-million-byte limit. An undeclared, incorrectly declared or chunked response could therefore allocate its entire body first. It now requires a readable byte stream, checks actual bytes while reading into bounded storage, preserves split UTF-8 characters, cancels oversized bodies and rejects bodies that exceed 2,000,000 bytes. It does not retain a text-only transport escape hatch. The existing adapter test helper now returns a native `Response` to exercise that production boundary.

The request deadline now covers both fetch and body reads, including injected transports that ignore AbortSignal. Cleanup aborts the request and attempts stream cancellation without awaiting a potentially stalled cancellation. A response that arrives after the deadline is cancelled without reading its body. Native fetch remains responsible for transport-level buffering and observing cancellation; this change bounds application buffering and completion time.

HTTP status is checked before JSON parsing. Previously an HTML or empty 429/503 response became a terminal invalid-JSON error and prevented the existing router fallback. HTTP 408, 429 and 5xx responses now retain the established retry classification without reading or exposing the error body. Other HTTP failures remain terminal. Malformed successful JSON, oversized responses and invalid structured output remain terminal; this change does not broaden the router's retry policy. Raw transport errors are no longer attached as causes at this boundary, preventing credentials or upstream details from appearing in error inspection.

OpenAI/xAI response and message status, Anthropic stop reasons and Bankr finish reasons are now checked before returning text or parsing a draft. Explicitly truncated output raises the existing terminal `PROVIDER_OUTPUT_INCOMPLETE` error, including when its text happens to be valid JSON. Tool requests, paused tool turns, refusals and other explicit non-final states cannot masquerade as completed text in these adapters, which expose no tools. Normal completion and Anthropic stop-sequence completion remain supported. Gemini already had an equivalent token-limit guard. Compatibility with responses omitting completion markers remains unchanged; this change does not infer that missing markers prove completion.

The markers were checked against [OpenAI structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs), [Anthropic stop-reason documentation](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), and [Bankr's OpenAI-compatible response format](https://docs.bankr.bot/llm-gateway/api-reference/). Applying the Chat Completions `length` rule to Bankr follows that advertised compatibility; no live Bankr model was invoked to independently verify it.

## Authority and compatibility

The `AIProvider` interface remains `getCapabilities()`, `healthCheck()` and `invoke(task, input)` plus existing named helpers. Result fields remain `provider, modelId, task, text, value, requestId, usage, latencyMs`. The normalized collecting intent remains an unsigned draft with `economicPermissionsActivated: false`; the interpreter rejects changes to chain, Punk ID, owner or recipient wallet. No endpoint, model registry entry, provider secret handling, database field or owner authorization changes.

Providers continue to expose analysis tasks, with `tools: false`. Bankr integration invokes only its model gateway, not upstream wallet execution or social posting. A model response cannot grant wallet authority. Existing deterministic policy, simulation and owner/session gates remain required independently of model output.

## Availability and remaining limitations

- Provider `healthCheck()` reports `CONFIGURED` or `NOT_CONFIGURED` from credential presence. This is configuration status, not proof of provider acceptance, model access, quota or network health. The existing protected AI connection-check endpoint has fixed live probes; this swarm did not invoke it or spend model credits.
- Model IDs and pricing remain server configured. Missing token usage or missing prices produce unknown cost, not zero. A failed remote request can still incur provider cost without returning usable usage; current failed-attempt records cannot recover that amount.
- AUTO fallback is bounded by configured candidates and each provider's request deadline, rather than one shared router deadline. Invalid successful output does not automatically trigger additional paid requests.
- Model image capability flags do not add an image-upload input to the current text-prompt invocation interface.

## Validation

Mocked verification only; no credentials, paid model calls or production transactions were used. `node --test tests/v2-swarm-ai.test.mjs tests/art-broker-v2-ai.test.mjs tests/art-broker-v2-ai-check.test.mjs` passed 48 tests, including all five adapters, strict intent identity, structured output, usage/cost behavior, gateway credential binding and public diagnostic redaction. The 25 new boundary tests cover exact-limit UTF-8, declared and actual overflow, dishonest/missing length, early cancellation, status-based fallback, empty/malformed success, transport-cause redaction, deadlines for uncooperative fetch/read/cancel implementations, and incomplete chat/structured responses without added generation retries. Full repository validation is owned by the lead after integration.
