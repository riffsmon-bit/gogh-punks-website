# Legacy GTD Operations

The public GTD page is retired. These notes preserve the operating and recovery details for the existing serverless capture, export, and Discord-role repair functions. This service is separate from the Art Broker and has no Punk Account authority.

## Capture invariants

The retained flow admits at most 200 unique wallet/Discord pairs:

1. A member signs in through Discord OAuth using only `identify`.
2. The backend confirms server membership and completed membership screening.
3. The member connects a wallet on Robinhood Chain ID `4663`.
4. The backend creates a short-lived, single-use EIP-4361 message bound to Discord user, wallet, origin, chain, nonce, request ID, and expiry.
5. The member signs the message. It is not a transaction and grants no approval or payment.
6. The backend verifies the signature against Robinhood Chain and does not store it.
7. A Postgres transaction takes a project advisory lock, rechecks the cap, and inserts only below 200 rows.
8. The service grants the Discord `GTD` role while preserving the `Visitor` role; the repair job retries temporary role-sync failures.

Database constraints enforce one wallet per Discord account and one Discord account per wallet. Request 201 fails even under concurrent final-slot requests. Existing moderation restrictions are never removed.

## Environment

Configure these through Netlify's secret manager, never client-side or in source control:

- `SITE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_GTD_ROLE_ID`
- `DISCORD_VISITOR_ROLE_ID`
- `CHAIN_ID=4663`
- `RPC_URL`
- `GTD_CAPTURE_CAP=200`
- `GTD_MIN_DISCORD_ACCOUNT_AGE_HOURS=24`
- `ADMIN_EXPORT_TOKEN` with at least 32 random characters

Validate without printing values:

```sh
npm run env:check
```

The Discord OAuth redirect must exactly match:

```text
https://YOUR-SITE-DOMAIN/api/auth/discord/callback
```

The bot needs `Manage Roles`; its managed role must sit above `GTD` and `Visitor`.

## Protected exports

Both routes require `Authorization: Bearer YOUR_ADMIN_EXPORT_TOKEN`:

- `/api/admin/gtd-export.csv` — headerless OpenSea rows in `wallet,3,0` form.
- `/api/admin/gtd-captures.csv` — administrative Discord-binding and sync-state audit data.

Never place the export token in a URL, browser script, screenshot, repository, or support transcript.

## Failure behavior

- Missing database, RPC, Discord, role hierarchy, or signature validation: no role is granted.
- Discord outage after capture: the wallet record remains and role synchronization is retried.
- Invalid, expired, or replayed signature: rejected.
- Wallet or Discord already linked elsewhere: rejected without disclosing the other account.
- Cap reached: rejected after the transaction-locked count is rechecked.
