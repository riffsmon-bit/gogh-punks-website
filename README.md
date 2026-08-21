# Gogh Punks

Official website and staged Art Broker foundation for Gogh Punks, a fully on-chain pixel-art collection on Robinhood Chain. The collection is sold out with `maxSupply()` matching the 5,016 historical mints, and 4,295 tokens circulate after 721 permanent burns.

- Collection: `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6`
- Chain ID: `4663`
- [OpenSea](https://opensea.io/collection/gogh-punks-255843210)
- [Discord](https://discord.gg/NgRzPNra6s)
- [Explorer](https://robinhoodchain.blockscout.com/address/0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6)

## Autonomous digital curators

Gogh Punks are evolving into autonomous digital art curators native to Robinhood. The staged architecture is designed so each Punk can control its own deterministic smart-account wallet, build a persistent NFT gallery, develop a collecting personality, discover new artists and collections, and eventually acquire approved NFTs under strict owner-defined rules. A local, read-only proof can evaluate one mint independently for multiple supplied Punk identities and Art Mandates, producing only `IGNORE`, `WATCH`, `RECOMMEND`, or `PROPOSE`. Supplied account/owner evidence remains unverified until a separate confirmed-chain attestation. This proof does not persist, sign, submit, or execute anything.

The Punk owner remains ultimately in control. The AI does not hold the owner's wallet key, cannot call unrestricted account execution, and cannot bypass on-chain policy.

Current status: the public read-only Scout UI, historical mint/sale discovery feed, recommendation views, Punk Gallery, and wallet ownership display are implemented. The hosted Scout status is scoped to at most one configured Punk; the presence of historical opportunity rows is labeled data availability, not proof that the worker is running or that every Punk is being evaluated. Account, policy, agent, and adapter contracts remain undeployed. Confirmed zero-address ERC-721 and ERC-1155 transfer events are non-actionable mint signals; verified Seaport settlements are explicitly historical research. Disabled-by-default workers can enrich collections with confirmed-block contract evidence and sanitized OpenSea display metadata. An observed mint does not prove that a phase is open or reveal its price. Source block time—not index time—drives activity windows; liquidity remains unavailable without live listing/bid evidence, and contract risk remains `UNKNOWN` when evidence coverage is insufficient. **No Art Broker contract is deployed and every transaction/autonomous feature is disabled.**

## Architecture

```text
AI / analyzers (untrusted)
          ↓
typed recommendation and intent
          ↓
registered deterministic adapter
          ↓
on-chain Broker Policy
          ↓
Punk Account
          ↓
verified NFT receipt
```

The live canonical Punk owner is resolved from `ownerOf(tokenId)`. Protocol administrators have no account withdrawal path.

## Repository

- `site/`: public collection, Art Broker, Discover, and Punk Gallery pages.
- `netlify/functions/`: public read APIs and retained GTD/Discord serverless functions.
- `netlify/database/migrations/`: GTD and Art Broker read-model schemas.
- `contracts/src/`: ERC-6551 account facade/account, policy, agent, and adapter registries.
- `contracts/test/`: unit, adversarial, and fuzz/property tests.
- `broker/src/`: opportunity model, discovery, scoring, typed intent builder, and reorg-aware indexer.
- `deployments/robinhood.json`: not-deployed manifest template.
- `docs/`: architecture, security, operations, and canary documentation.

## Validation

Requires Node.js 24 and Foundry.

```sh
npm install
npm run check
```

To run only the local autonomous canary rehearsal:

```sh
npm run broker:canary
```

Run preflight validation before live canary execution:

```sh
npm run broker:canary:preflight
```

Run both checks in one command:

```sh
npm run broker:canary:drill
```

Run rehearsal only (skip preflight) with:

```sh
npm run broker:canary:drill:local
```

The normal preflight loads an untracked `.env`, requires the authoritative deployment manifest and
two independent Robinhood RPC providers, and never signs or broadcasts. Skipping preflight is for
the local mock rehearsal only; it must never precede a live action.

`npm run site:check` is the Netlify-safe frontend/backend validation path. `npm run contracts:check` adds Solidity formatting, build/size, tests, fuzzing, and ABI trust-boundary checks.

## Netlify configuration

Copy `.env.example` to `.env` for local Netlify development. Never commit `.env`.

Set these values in **Netlify → Project configuration → Environment variables**:

- `SITE_URL`: the final HTTPS origin, with no path or trailing slash required.
- `DISCORD_CLIENT_ID`: Discord application ID.
- `DISCORD_CLIENT_SECRET`: secret from Discord Developer Portal. Never expose it client-side.
- `DISCORD_BOT_TOKEN`: bot token. Never paste it into chat, logs, or source control.
- `DISCORD_GUILD_ID`: `1535718970471219232` for the Gogh Punks server.
- `DISCORD_GTD_ROLE_ID`: ID of the bot-managed `GTD` role.
- `DISCORD_VISITOR_ROLE_ID`: ID of the existing `Visitor` role.
- `DISCORD_SALES_CHANNEL_ID`: dedicated read-only sales channel (`1538732801036263514`).
- `CHAIN_ID`: must remain `4663`.
- `RPC_URL`: an HTTPS Robinhood Chain RPC endpoint. Treat provider keys as secrets.
- `GTD_CAPTURE_CAP`: must remain `200`; the service fails closed if changed.
- `GTD_MIN_DISCORD_ACCOUNT_AGE_HOURS`: defaults to `24`.
- `ADMIN_EXPORT_TOKEN`: a random value of at least 32 characters used only for protected CSV exports.

The Art Broker's optional OpenSea artwork enrichment also uses
`OPENSEA_API_KEY` and must be explicitly enabled with
`BROKER_METADATA_ENABLED=true`. The key is read only by the scheduled server
function; it is never included in browser JavaScript or API responses. Keep the
default `false` value in development and any environment without a configured
key.

Generate the export token locally, then put it directly into Netlify:

```sh
openssl rand -base64 48
```

Do not send that output to anyone. Validate the configured environment without printing values:

```sh
npm run env:check
```

Netlify Database is declared through `@netlify/database`. On deployment, Netlify provisions managed Postgres and applies the migration under `netlify/database/migrations/`. The database stores public wallet addresses, Discord IDs/names, timestamps, role-sync state, and redacted audit events. It does not store OAuth access tokens, wallet signatures, private keys, seed phrases, or session cookies.

## Discord manual setup

In **Discord Developer Portal → Applications → Gogh Punks → OAuth2**, add this exact redirect URL:

```text
https://YOUR-SITE-DOMAIN/api/auth/discord/callback
```

The bot needs `Manage Roles`, and its managed bot role must be above both `GTD` and `Visitor`. The site requests only the user OAuth scope `identify`; it does not ask users to authorize guild joining or wallet transactions.

The Discord configuration project contains the desired `GTD` role. Review with:

```sh
cd /Users/brandonduke/Projects/Gogh-Punks-Discord
npm run discord:plan
```

Deploy that Discord plan only after explicit review. Copy the resulting role IDs with Discord Developer Mode and add them to Netlify.

## Local development and deployment

The repository publishes `site/`, bundles functions from `netlify/functions/`, and automatically applies database migrations. Use Netlify CLI for the full local database/function environment:

```sh
npx netlify dev
```

Copy `.env.example` to an untracked local environment and use provider/secret-manager values. Never commit private keys, seed phrases, Discord secrets, database credentials, API secrets, or an Art Agent signing key.

The hourly `gtd-role-recheck` function runs only on published production deploys. Deploy previews do not execute scheduled functions automatically.

The `discord-sales` production function runs once per minute. It waits for eight
Robinhood confirmations, then requires both an OpenSea Seaport fulfillment and
the exact seller-to-buyer Gogh Punks ERC-721 transfer in the same successful
transaction. Validated native-token sales are deduplicated in Postgres before
being posted to Discord; gifts, mints, burns, bundles, and unknown marketplace
calls fail closed. The first run starts at the confirmed chain head and never
floods the channel with historical sales.

## Deployment safety

The deployment script is simulation-only unless a human explicitly adds Foundry's `--broadcast` flag. Production deployment requires an independent audit, verified marketplace adapters, separated multisig/agent roles, a completed address manifest, and explicit authorization.

See [architecture](docs/ART_BROKER_ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [curator reputation](docs/CURATOR_REPUTATION.md), [notifications](docs/NOTIFICATIONS.md), [gas estimates](docs/GAS_ESTIMATES.md), [deployment](docs/DEPLOYMENT.md), and [canary plan](docs/CANARY.md).

## Legacy GTD functions

The retired GTD page is no longer linked or published. Its existing serverless capture/export functions and migration remain in the repository for controlled historical operations; they are separate from Art Broker authority and store no wallet private keys or signatures.

Operational details for the retained Discord/SIWE service are preserved in [Legacy GTD operations](docs/LEGACY_GTD.md).
