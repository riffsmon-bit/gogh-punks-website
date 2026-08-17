# Gogh Punks Website

Official public website and GTD wallet capture for Gogh Punks, a collection of 10,000 fully on-chain pixel portraits on Robinhood Chain.

## Official links

- [OpenSea](https://opensea.io/collection/gogh-punks-255843210)
- [Discord](https://discord.gg/NgRzPNra6s)
- Contract: `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6`

## GTD capture

The `/verify/` flow admits exactly 200 unique wallet/Discord pairs:

1. The member signs in through official Discord OAuth with the `identify` scope.
2. The backend confirms that the user is already in the configured Gogh Punks server and has completed membership screening.
3. The member connects a wallet on Robinhood Chain (chain ID `4663`).
4. The backend creates a short-lived, single-use EIP-4361 message tied to that Discord user, wallet, domain, chain, nonce, request ID, and expiry.
5. The member signs the message. This is not a transaction and requests no approval or payment.
6. The signature is verified against Robinhood Chain. The signature itself is never stored.
7. A Postgres transaction takes a project advisory lock, rechecks the current count, and inserts only when fewer than 200 rows exist.
8. The backend grants the Discord `GTD` role and keeps the member's `Visitor` role. An hourly job repairs temporary role-sync failures.

Database uniqueness constraints enforce one wallet per Discord account and one Discord account per wallet. Request 201 is rejected even if several final-slot requests arrive simultaneously. Existing moderation restrictions are never removed by GTD capture.

Every captured row exports as:

```text
wallet,3,0
```

That is a custom mint limit of 3 and a price of 0 ETH.

## Local validation

Requires Node.js 24.

```sh
npm install
npm run check
```

`npm run check` validates the public site, preview assets, secret scan, 200-wallet policy, wallet/Discord uniqueness rules, opaque sessions, SIWE message binding, and the atomic-cap implementation.

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

## Development and deployment

The repository publishes `site/`, bundles functions from `netlify/functions/`, and automatically applies database migrations. Use Netlify CLI for the full local database/function environment:

```sh
npx netlify dev
```

The hourly `gtd-role-recheck` function runs only on published production deploys. Deploy previews do not execute scheduled functions automatically.

The `discord-sales` production function runs once per minute. It waits for eight
Robinhood confirmations, then requires both an OpenSea Seaport fulfillment and
the exact seller-to-buyer Gogh Punks ERC-721 transfer in the same successful
transaction. Validated native-token sales are deduplicated in Postgres before
being posted to Discord; gifts, mints, burns, bundles, and unknown marketplace
calls fail closed. The first run starts at the confirmed chain head and never
floods the channel with historical sales.

## Protected exports

Both routes require this request header:

```text
Authorization: Bearer YOUR_ADMIN_EXPORT_TOKEN
```

- `/api/admin/gtd-export.csv` — headerless OpenSea file (`wallet,3,0`).
- `/api/admin/gtd-captures.csv` — administrative audit export with Discord binding and sync state.

Never put the export token in a browser URL, public script, screenshot, or repository.

## Failure behavior

- Missing database, RPC, Discord, role hierarchy, or signature validation: no GTD role is granted.
- A Discord outage after a successful database capture: the wallet remains secured and role sync is queued.
- Invalid, expired, or replayed signature: rejected.
- Wallet or Discord already linked elsewhere: rejected without revealing the other account.
- Cap reached: rejected after the count is rechecked inside the locked transaction.
