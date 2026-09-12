# Production broker release and Forge follow-up

PR #47 was merged as `78c01ca6a2bc7c8e86994333bfaf9ca69a18a584`.
Netlify production deployment `6aa5aade39f94100087a8215` published at
`2026-09-12T19:43:02.949Z` on https://goghpunks.xyz/broker/v2/?tab=talk.
The service reports 80 functions deployed and both training-intent migrations
applied. This did not release production training or burning.

The [hosted build checks](build-checks.json) used injected credentials and passed
contract inspection (18,470 bytes), rarity sampling (3 tokens), and market reads
(5 listings). Earlier local requests made with masked environment API values are
not evidence of a bad production OpenSea credential.

The [production browser record](browser-checks.json) uses the actual production
host with no preview fixture. All seven tab selections were exercised at 1440px
and 375px while disconnected. No browser errors, failed resources, wallet calls,
site mutations or public transactions occurred. Disconnected panels remain gated;
this is not connected-wallet acceptance. Served files independently matched:

| File | SHA-256 |
| --- | --- |
| `/broker-v2.js` | `f237ba579e793a88f0adc9d705bf340ab347738509973222271ca248cab9ac17` |
| `/forge-deployment-status.js` | `1e1157c5410e06685b7a92da422b2e393b2bf67ff383190b14ba0193a00bab05` |
| `/broker/v2/index.html` | `b23b5305faed3f323cbf8817a1ecd8304c28396e99df91d89c2a40a6d6ff1e33` |

Unauthenticated profile reads returned 401 `V2_SESSION_REQUIRED`; the training
route returned 503 `FORGE_TRAINING_NOT_RELEASED`.

The follow-up uses [finalized deployment evidence](../live-owner/finalized-deployment.json)
to install read-only manifests. Header/receipt reads retain their original two
providers. Separate BlockReq and dRPC clients read contract state at that exact
finalized hash, with bounded retries for explicit throttling. Local integration
checks reject state-provider block/hash/time changes, wrong chains, unavailable
state and reorgs. No fallback changes the finalized block or drops a provider.

The [live owner browser check](../live-owner/finalized-read-ui/pair-browser-checks.json)
reads #93's actual profile and the selected #1753 → #93 pair. It verifies both
completed setup steps, finalized deployment status, 0 credits and 1 slot, and that
failed preflights clear prior results. No wallet request or public transaction was
made. The accepted setup journal is retained, and the #44 practice servers were
not reset.

Remaining burn launch requirements are production approval/burn intents and
receipt recovery, restricted database credentials, source asset/operational
inventory, and reviewed registry activation/skills. The real #1753 burn, #93
credit gain and subsequent learning/equipping still require owner-wallet tests.
Use the [live test guide](../../../LIVE_OWNER_TEST_GUIDE_2026-09-16.md) to record each
case as PASS, FAIL, BLOCKED or NOT RELEASED.
