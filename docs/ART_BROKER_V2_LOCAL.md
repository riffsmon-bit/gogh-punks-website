# Art Broker V2 local build

This iteration is intentionally local-only. It adds consumer-facing control-center and safety
primitives without installing database migrations, changing production secrets, deploying
contracts, broadcasting transactions, or enabling paid production execution.

## Run the demo

```sh
npm run broker:v2:demo
```

Open `http://127.0.0.1:8888/broker/punk/93?demo=1`. The demo server binds only to the local
loopback interface, sends `no-store`, serves repository files, and has no RPC proxy or signing
path. Tabs can be opened directly with `&tab=overview`, `agent`, `mint`, `assets`, or `activity`.

Generate the local screenshot set with:

```sh
npm run broker:v2:screenshots
```

The capture script talks only to a local Chrome debugging endpoint and the loopback demo.

Latest local Chrome capture timings (2026-08-27) were 119ms desktop load, 196ms at 375px,
118ms at 390px, and 146ms at 430px. The in-memory directed resolver and simulation each
completed below the browser timer's 1ms reporting resolution; fixture inventory rendered in 1ms.
All measured document widths exactly matched their viewports. This route is new, so there is no
honest same-route pre-V2 baseline; these are current measurements rather than a fabricated
before/after claim. Network-backed production timing was intentionally not measured in this
local-only iteration.

## Wallet lifecycle

Reown AppKit remains the sole wallet session. The connected-wallet button opens AppKit's account
view, where supported wallets can manage the session. A dedicated Disconnect Wallet action calls
AppKit disconnect and clears only wallet-scoped state: selected Punk, resumable setup, activated
hints, Control Center preferences, owned-Punk state, portfolio state, and temporary ownership
state. Immutable application metadata caches are retained. A disconnected wallet cannot keep
rendering privileged Punk controls.

## Punk Control Center

The local route is `/broker/punk/:tokenId`. Initial rendering is intentionally small: Punk
identity, Punk wallet, and agent summary. Detailed assets are fetched only after the Assets tab
opens. The tabs are Overview, Agent, Mint, Assets, and Activity and collapse into touch-friendly
horizontal navigation at 375, 390, and 430 pixels.

The live read path reuses the reviewed owner-Punk, V3 status, activity, and withdrawal-inventory
endpoints. Every privileged control remains locked unless live ownership and the activated Punk
wallet are known. The local paid-mint and directed-mint demonstrations cannot submit a transaction.

## Paid mint safety model

Paid mints default off. The pure policy evaluator uses integer wei and intersects all limits:

- live owner must still equal the configuring owner;
- authorization must be active and unexpired;
- paid mode must be explicitly enabled;
- recipient must be the exact Punk wallet;
- runtime and sale must be supported and active;
- price must equal transaction value, fit the per-mint maximum, fit remaining UTC-day spend, and
  remain under the daily mint count.

Simulation evidence must contain exactly one NFT receipt to the reviewed Punk wallet. Any approval,
outgoing NFT/token, contract creation, unexpected native spend, or failed simulation is rejected.
Inputs are descriptor-snapshotted once and accessors/symbol fields are rejected.

The in-memory ledger demonstrates serialized, idempotent reservations. The PostgreSQL repository
and unapplied local migration use a Punk/day advisory transaction lock, unique job IDs, unique
transaction hashes, and RESERVED/CONFIRMED/REORGED states so concurrent workers cannot each spend
the same remaining allowance.

## Directed OpenSea mint review

Only clean HTTPS OpenSea collection/drop links are parsed. URL parameters never supply contract,
recipient, price, runtime, stage, currency, or eligibility evidence. An injected authoritative
resolver must provide those values from supported runtime/chain reads. Before simulation the flow
requires a newer exact revalidation, unchanged candidate/price, verified eligibility, and a fresh
current-owner read. A URL paste alone never authorizes spending.

## Punk wallet assets

The local UI separates native value, recognized tokens, NFTs, and other/unknown assets. The pure
builders support only deterministic native deposits and standard ERC-20 transfer, ERC-721
safeTransferFrom, and ERC-1155 safeTransferFrom calls. Deposits bind the destination to the Punk
wallet. Withdrawals bind the destination to the current Punk owner. There is no arbitrary target,
destination, approval, or calldata option.

## Agent activity

The heartbeat schema supports IDLE, QUEUED, SCANNING, CANDIDATE_FOUND, VERIFYING_CONTRACT,
CHECKING_PRICE, CHECKING_ELIGIBILITY, CHECKING_LIMITS, SIMULATING, READY, SUBMITTING, CONFIRMING,
MINTED, SKIPPED, PAUSED, and ERROR. It stores sanitized scan/job timing and human-readable reasons,
not credentials. The unapplied migration provides restart-resistant per-Punk heartbeat and event
rows with unique transaction hashes.

## Local-only boundaries

- Arbitrary calldata and arbitrary approvals remain blocked.
- Autonomous selling, listing, swapping, bridging, lending, and offer acceptance remain blocked.
- The connected owner's main wallet is never an autonomous spending source.
- Paid production minting is not enabled and no paid production transaction was broadcast.
- Database migrations are present for review but were not applied.
- A production OpenSea resolver, supported paid adapter deployment, production authorization, and
  real simulation provider remain separate future release gates.
