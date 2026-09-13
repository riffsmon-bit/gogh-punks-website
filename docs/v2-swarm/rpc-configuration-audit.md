# RPC configuration audit

September 13, 2026. Read-only follow-up to the owner's request to locate PublicNode settings in Netlify or macOS encrypted configuration. No environment variable, deployment, database, wallet journal or financial authority was changed. Credentials were not printed or written into this report.

## Located settings

The existing Netlify login identified the `gogh-punks` site at `https://goghpunks.xyz`. Site and team environment-variable reads found:

| Location / variable | Production Functions observation |
|---|---|
| `ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL` | Uses the public `robinhood-rpc.publicnode.com` endpoint, without URL credentials. |
| `PUNK_AGENT_DIRECT_RELAY_RPC_URL` | Uses the same public PublicNode endpoint, without URL credentials. |
| `RPC_URL` | Uses the official public `rpc.mainnet.chain.robinhood.com` endpoint. |
| `ROBINHOOD_RPC_URL` | Present as a protected secret; the API does not return a usable URL. Its underlying endpoint was not verified by this audit. |
| `ROBINHOOD_SECONDARY_RPC_URL` | Present as a protected secret; the API does not return a usable URL. Its underlying endpoint was not verified by this audit. |
| `ROBINHOOD_ARCHIVE_RPC_URL` | Absent from site configuration; direct lookup returned 404. |
| `ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL` | Absent from site configuration; direct lookup returned 404. |
| Team-shared variables | The authorized lookup returned an empty list. |

Netlify documents that production secret values are readable only by code running on its systems. Listing a masked secret does not establish its endpoint or archive access. [Netlify Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)

The original checkout's `.env` contains the official public RPC as primary and an authenticated-URL-shaped Alchemy secondary. The Alchemy endpoint returned HTTP 401 with an authentication-required response. No URL path or credential was displayed.

macOS login Keychain metadata was inspected for Gogh, Robinhood, RPC and provider item names. Project signing/admin/OpenSea items exist, but no RPC/archive provider credential was identified. Wallet-signing password values were not read. A bounded filename scan of the project, `~/.config` and `~/.gogh-punks` found no encrypted configuration candidate. This is not a claim to have searched every file or account on the Mac.

## Direct endpoint checks

The application uses Viem. Checks through that transport read current blocks around 62074501 and then requested state 20,000 blocks earlier:

| Provider | Current block / historical block headers | Historical code and `ownerOf(93)` | Token #93 Transfer logs |
|---|---|---|---|
| PublicNode public endpoint | Passed | Rejected with JSON-RPC -32602 | Rejected with JSON-RPC -32602 |
| Official public Robinhood endpoint | Passed | Rejected with JSON-RPC -32000 | Succeeded, zero matches in the tested range |

A separate PublicNode historical-code request returned: “Archive requests require a personal token.” The official endpoint reported missing historical metadata. PublicNode's own Robinhood page provides an archive-access option. [PublicNode Robinhood](https://robinhood.publicnode.com/)

The application's unchanged `checkV2ExecutionReadiness({environment: {}})` diagnostic also remained `PAID_HISTORY_UNAVAILABLE`, with zero verified providers: official historical-state RPC -32000 and PublicNode archive HTTP 403 on that run. This invocation explicitly tested the public fallback pair, not Netlify's masked production secrets. Preliminary Python transport requests were rejected even for latest-state reads and were not treated as evidence of archive capability.

## Implication and remaining work

The owner correctly remembered PublicNode. The configured public relay and automation endpoints are insufficient for the paid lane's historical-state verification. The dedicated archive settings are already supported in code and deliberately separate from the free worker's public relay override.

A working authenticated archive pair must pass historical code, ownership, event-log and common-block agreement checks before new paid-mint funding. The explicit settings are `ROBINHOOD_ARCHIVE_RPC_URL` and `ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL`, using two distinct HTTPS hosts. Existing masked general RPC secrets may be evaluated by a diagnostic running inside Netlify; this audit did not retrieve or prove those values.

Source inspection found archive readiness in the scheduled worker's output, but invoking that worker can execute financial work. It was not invoked as a diagnostic. No standalone production endpoint was found that safely runs this exact archive probe without mission/session side effects. No production diagnostic was deployed during this read-only audit.

No safety gate was weakened, secret unmasked, paid budget requested, real Punk burned or refund broadcast.
