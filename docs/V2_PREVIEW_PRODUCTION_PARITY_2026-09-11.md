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

## Environment difference still open

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
Secret values were neither printed nor recorded. No credentials or worker settings
were copied to previews. The account-status endpoint can show the existing mission
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
