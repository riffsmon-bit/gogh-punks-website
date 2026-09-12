# Production and PR #47 parity, September 11

Production already has autonomous minting and the owner reports Punk #93's active
0/1 mission. This work fixes the existing broker. Undeployed Forge backing
contracts are a separate concern; they do not imply that the agent contracts or
production autonomous worker need to be built or deployed for the first time.

At 2026-09-12 02:14 UTC (September 11 in Detroit), production served application
assets from `0daf269`, deployed as `6aa16a462e74d5c77dfe58c6`. GitHub main was
`bff04fb`; it was not the complete production source. PR #47 served `e411c04`
(application code `c0a6b3c`). Production chat-action and gas-funding assets matched
the preview byte for byte. Agent deployment manifest, account-status handler and
session handlers matched between the deployed production source and PR HEAD
before this fix.

The PR hostname nevertheless selected a different browser path: an ephemeral
review chat parser, browser strategy state, and the retired Punk Pipeline panel.
This could draft a mission without signing in or reading the existing mission.
The background account-status GET then returned `V2_SESSION_REQUIRED`. A connected
wallet on production has a different host-only session cookie from the preview.
Additionally, clicking readiness during a background read returned cached state
without performing the requested sign-in.

The fix makes normal PR Talk use the same authenticated chat handler as production,
with exact approved-origin checks, server-loaded owner rules and pending draft
persistence. It hides the retired Pipeline and browser-review status in normal
Talk, preserves them in the explicit visual fixture, restores the current Punk's
welcome after owner changes, and renders the confirmed mission/limits before old
browser review state. The readiness button explicitly offers sign-in, shows wallet
progress, awaits a fresh check, and ignores stale responses. Login messages name
the actual approved host; completion rejects a challenge from another host. A
login signature alone never grants mint authority.

## Environment baseline before the September 11 late-evening fix

Read-only Netlify function-context comparison found these configured in production
and absent in deploy-preview:

- `SITE_URL`
- `PUNK_AGENT_WORKER_ENABLED`
- `PUNK_AGENT_SESSION_PRIVATE_KEY`
- `PUNK_AGENT_SESSION_ADDRESS`
- `PUNK_AGENT_BUNDLER_MODE`
- `PUNK_AGENT_DIRECT_RELAY_RPC_URL`
- `BACKGROUND_RPC_ALLOWED_TASKS`

`RPC_URL` and `GOGH_V2_REVIEW_AI_ENABLED` were present and equal in both contexts.
At this earlier checkpoint, secret values were neither printed nor recorded and no
credentials or worker settings had been copied to previews. The account-status endpoint can show the existing mission
after owner sign-in, but setup/execution readiness must still report these missing
services accurately. Preview database contents and the owner's authenticated live
status require direct acceptance; no production session cookie was reused.

Netlify does not automatically schedule workers on PR deploys. Do not equate
opening the preview with running the changed #93 worker code. The current
production worker can continue its existing authorized mission, but it does not
thereby prove the PR's session-count fix. A controlled rollout/invocation of the
accepted worker revision and a canonical receipt are still required for that fix.

## Validation

Regression tests exercise an explicit login racing a late background 401,
concurrent checks, owner changes, service failures, missing cookies, approved SIWE
hosts and rejected cross-host completions. Chat persistence runs through the same
handler for production and both supported PR host forms. The full Chrome fixture
exercises PR-host branches, transports an HttpOnly login cookie, restores an active
mission, hides the old Pipeline, checks real infrastructure blockers, and retains
chat gas amounts/sources and the Forge ownership/loadout/recovery checks. It uses
simulated wallet responses and local services, not the owner's public wallet.

Read-only baseline evidence: `review/2026-09-11/completion/autonomy-parity-baseline.json`.

Validation result: 1,686 JavaScript tests passed; 37 focused auth/chat tests passed;
127 deployment tests passed; full Chrome owner/sign-in/chat/gas/Forge fixture
passed without browser exceptions or public wallet transactions. See
`review/2026-09-11/completion/autonomy-parity-checks.json`.

## Preview setup and one-mission execution prepared at 03:16 UTC September 12

The missing signer/relay configuration was applied only to Netlify's branch context
`fix/punk-93-mint-stall`. Existing production values and secret metadata were
preserved and checked after the update. The existing session signer was loaded
from the project's Keychain entry directly into the function-only secret setting;
no private value was printed or written to a file. The branch allows only the
PUNK_AGENT_WORKER background task. This does not configure every PR preview.
Sanitized evidence: `review/2026-09-11/completion/preview-autonomy-configuration.json`.

Netlify does not run scheduled functions on PR previews. The preview therefore
provides **RUN ONE MISSION CHECK** after owner sign-in and a ready active session.
Each click invokes the existing worker for exactly the selected owner, Punk and
session. A check can submit a mint within that already signed mission. It does not
create a mission or change limits. Pending operations reconcile before another
attempt; the existing worker lease, on-chain owner/session checks, simulation,
gas controls and receipt rules remain authoritative. Production retains scheduling.
See [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/)
and [branch environment contexts](https://docs.netlify.com/build/environment-variables/overview/).

The endpoint rejects production/cross-origin requests, missing login, wrong current
owner, another Punk's session, revoked/expired sessions and unexpected body fields.
Its SQL scopes both mission selection and pending receipt reconciliation. The UI
prevents double clicks and shows failures without declaring an unknown transaction
unsent. Missing infrastructure now produces specific setup messages.

Updated validation: **1,717 JavaScript tests and 127 deployment tests passed**.
The full Chrome harness passed its manual-check, auth, chat, gas, owner transition,
directed-target and Forge cases with zero browser exceptions or public wallet
writes. Database-backed tests exercise actual scoped SQL with two active Punks and
pending operations. Local mocks do not prove a public mint. No worker was invoked
against a public chain in this preparation. The intended owner's live sign-in,
readiness, mission and canonical receipt remain the final acceptance steps.
