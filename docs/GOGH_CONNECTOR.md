# Gogh Punks Agent Connector

Status: local simulation build. Production paid execution is disabled.

## Architecture

```text
AI or compatible client
  -> scoped Gogh Connector tool
  -> server-side wallet session and Punk scope
  -> live Punk ownership recheck for privileged actions
  -> existing OpenSea resolver / V3 worker / policy ledger
  -> exact adapter, price, budget, recipient and simulation checks
  -> existing Punk Wallet
```

The connector chooses a high-level intent. It never accepts arbitrary target, value, calldata,
approval, transfer recipient, private key, or owner-wallet spending instructions.

## Local run

```sh
npm run broker:connector:local
```

Open:

- `http://127.0.0.1:8888/dev/connector`
- `http://127.0.0.1:8888/broker/punk/93?demo=1`

The development console issues a clearly local, one-hour simulated session. It calls the same
scope, rate-limit, idempotency, intent-expiry, schedule, and audit logic as the connector core.
It does not call a wallet, an RPC signer, Netlify, or a blockchain write method.

## Tools

| Tool | Scope | Behavior |
| --- | --- | --- |
| `list_my_punks` | `punk:read` | Indexed list; privileged actions still recheck ownership live. |
| `get_punk_status` | `punk:read` | Wallet, policy, usage, balances and recent agent state. |
| `get_punk_wallet` | `punk:read` | Deterministic Punk Wallet identity. |
| `get_punk_portfolio` | `punk:read` | On-demand portfolio summary. |
| `get_agent_status` | `agent:read` | Heartbeat, activity and UTC schedule. |
| `set_scouting_schedule` | `agent:scout` | Exact UTC start/end, maximum 31 days. |
| `send_agent_scouting` | `agent:scout` | Queues only the existing bounded worker and only inside the schedule. |
| `inspect_opensea_mint` | `mint:inspect` | Read-only drop resolution. |
| `prepare_directed_mint` | `mint:directed` | Quantity-one, five-minute server-side intent. |
| `execute_directed_mint` | `mint:directed` | Retrieves and revalidates the stored intent; local build simulates only. |
| `pause_agent` / `resume_agent` | `agent:pause` | Bounded agent control, never a general wallet call. |

## Authentication

The core implements a one-use challenge and opaque short-lived bearer session. The signed message
binds the wallet, chain 4663, canonical Gogh collection, exact allowed Punk IDs, exact scopes,
nonce, issue time, and expiration. Session storage contains a SHA-256 token hash, not the raw
signature or token. Every privileged action must also recheck current `ownerOf` state.

For production, persist challenges and hashed sessions in Netlify DB, use the repository's viem
message verification (including smart-wallet verification), set an HttpOnly administration UI
session where applicable, and retain bearer tokens only in the external client. Do not put them in
URLs or browser local storage.

## OpenSea

The server-only client uses the official Drops endpoints:

- `GET /api/v2/drops/{slug}`
- `POST /api/v2/drops/{slug}/mint`

`OPENSEA_API_KEY` is a server secret and is never returned to a client. OpenSea's proposed target,
calldata and value remain untrusted. Before a future production job is created, existing trusted
code must validate the exact supported runtime and adapter, decode the selector and all arguments,
bind quantity one and the Punk Wallet recipient, reread current price and eligibility, apply daily
mint/spend and per-mint limits, simulate, and reject unexpected approvals, transfers, contract
creation, or native spending.

## Mint intent lifecycle

1. Inspect a clean OpenSea collection/drop URL.
2. Resolve authoritative drop information on demand.
3. Prepare a server-side quantity-one intent with a five-minute expiry.
4. Return review fields and the opaque intent ID—never raw execution authority.
5. Execute by intent ID only.
6. Recheck owner, authorization, chain, stage, eligibility, price, limits and simulation.
7. In this branch return `SIMULATION COMPLETE`; no transaction is broadcast.

Retries use an `Idempotency-Key`. A repeated key returns the original promise/result rather than
creating a second job or intent. Requests are rate-limited per authenticated wallet and tool.

## Time windows

Schedules are stored as exact UTC instants. The UI accepts device-local date/time for convenience,
converts it to UTC, and shows the converted interval. A scheduled or connector scout request outside
the enabled interval stops before job creation. The on-chain mint cap, spend cap, authorization
expiry, pause state, and ownership checks still apply inside the interval.

## Lazy data and Alchemy usage

- Wallet connection does not call Alchemy.
- Punk cards use indexed ownership and cached metadata.
- A selected Punk loads essential status in parallel.
- Portfolio inventory loads only when Assets opens.
- OpenSea is called only for inspect/prepare.
- RPC is called only for requested live state, ownership, policy or simulation.
- A Pro Alchemy endpoint can be the server-side primary RPC, but credentials must never enter site
  JavaScript. Use a separate provider for independent safety attestations.

## Audit and threat model

Audit events record timestamp, abbreviated/authenticated wallet identity, Punk, command, source,
intent, result/rejection, and a transaction hash only when one eventually exists. They never record
keys, bearer tokens, API keys, or raw signatures.

The connector cannot:

- spend from the human holder wallet;
- call arbitrary contracts or accept arbitrary calldata;
- create token/NFT approvals;
- list, sell, swap, bridge, lend, or transfer to an AI-selected recipient;
- override Punk limits or survive an ownership change without reauthorization.

## Production activation checklist

1. Add the DB migration/repository for challenges, hashed sessions, intents, schedules,
   idempotency records and audit events.
2. Wire Reown wallet signing to the production challenge endpoint.
3. Configure `OPENSEA_API_KEY` and a server-only on-demand RPC URL.
4. Bind connector dependencies to the existing owner-Punks index, V3 state/worker and paid ledger.
5. Add transaction decoding for each explicitly supported OpenSea runtime.
6. Run fork simulations and adversarial concurrency/reorg tests.
7. Keep `GOGH_CONNECTOR_EXECUTION_MODE=simulate` until a separate security review and explicit
   production authorization.
