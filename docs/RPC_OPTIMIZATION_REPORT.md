# Gogh Punks RPC optimization report

Date: 2026-08-29
Incident reported: approximately 111,111,448 Alchemy Compute Units between August 27 and 29.

## Finding

The repository had several independent multipliers. The exact percentage attributable to each
source cannot be recovered from source code alone; an Alchemy method/export breakdown is required
for that. The following causes are confirmed from executable production paths and are ranked by
their maximum request multiplier, not by an invented percentage.

1. `broker-owner-punks` can reconcile a wallet by scanning all 5,017 collection token IDs in 26
   RPC multicalls. The browser requested that reconciliation after every non-empty indexed roster,
   even though it had already verified the indexed candidate IDs in bounded browser multicalls.
2. The scheduled V3 worker proved eleven global values against each of two RPC providers before it
   knew whether an executable mint candidate existed. It also searched up to 80,000 recent blocks
   for SeaDrop updates on every five-minute run.
3. The scheduled chain-wide NFT stream queried unfiltered ERC-721 and ERC-1155 transfer topics. It
   ran every two minutes when enabled and is substantially broader than the Punk ownership index.
4. Initial V3 status navigation used a unique timestamp query, defeating any shared response reuse.
5. Eight recurring Netlify jobs could perform background network work. Deploy previews inherited
   schedules unless each job independently knew it was a preview.
6. The Discord sales feed scans confirmed block/log ranges every minute. It remains required when
   configured, but is now covered by the same preview and emergency stops.

## Production RPC map

| Source | Principal methods | Trigger and prior frequency | Cache/batch state | Disposition |
| --- | --- | --- | --- | --- |
| `broker-owner-punks` | `eth_call` (`balanceOf`, `ownerOf`) | Wallet load; up to 26 multicalls / 5,017 `ownerOf` executions during reconciliation | Indexed candidates existed, but browser still started reconciliation | Non-empty indexed rosters no longer start a full scan; privileged actions still use live `ownerOf` |
| `broker-indexer` | `eth_blockNumber`, `eth_getLogs`, block headers | Every 2 minutes when enabled | Persistent stream checkpoints and bounded ranges | Kept for core indexed streams; disabled in previews/emergency |
| `broker-mint-indexer` | chain-wide `eth_getLogs`, block headers | Every 2 minutes when both indexer and NFT stream were enabled | Checkpointed but market-wide | Now requires separate `BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER=true`; false by default |
| V3 worker discovery | `eth_blockNumber`, `eth_getLogs` | Every 5 minutes; up to 16 log requests over 80,000 blocks | No discovery checkpoint | Persistent checkpoint; warm runs scan only unseen blocks plus a 64-block reorg overlap |
| V3 global gate | batched `eth_call` against two providers | 22 value reads per worker cycle before candidate discovery | Transport batching only | Deferred until a live zero-price candidate exists |
| V3 account/execution gate | `eth_call`, balance, code, simulation, receipt | Only while evaluating/executing a candidate | Dual-provider and policy bounded | Retained; these are safety-critical decision reads |
| V3 public status | live global/account reads | Initial selected-agent load; unique timestamp URL | No reusable URL | Stable URL plus 15-second edge reuse; browser remains `no-store` |
| Discord sales | block, logs, receipts | Every minute when configured | DB checkpoint and advisory lock | Retained, but disabled in previews/emergency |
| Broker Scout/analyzer/metadata | logs/RPC, Blockscout/OpenSea | 5/5/10-minute schedules when enabled | DB-backed | Disabled in previews/emergency |
| Withdrawal, activation, paid/directed mint | ownership, runtime, balance, estimate/simulation/receipt | Explicit user action | Request-scoped | Retained unchanged; never served solely from an index |

CLI release attestations and deployment scripts also use RPC, but they are manually invoked,
bounded workflows rather than unattended production traffic.

## Changes

- Added one background policy shared by every scheduled RPC-capable Art Broker job. Deploy previews
  and branch deploys now skip background work unless `ENABLE_PREVIEW_BACKGROUND_RPC=true`.
- Added the emergency `PAUSE_BACKGROUND_RPC=true` kill switch. It leaves indexed pages and explicit
  user operations available.
- Made chain-wide NFT transfer indexing an additional explicit opt-in.
- Stopped routine 5,017-token ownership reconciliation for a non-empty indexed roster. First-time
  empty indexes retain the bounded completion path; activation, minting, and withdrawals still
  verify live ownership.
- Added a persistent SeaDrop update/checkpoint model and a 64-block reorg overlap. The worker no
  longer re-reads the last 80,000 blocks every cycle.
- Moved V3 dual-provider global checks after off-chain/indexed discovery and zero-price prefiltering.
  No candidate means no global or per-Punk chain reads.
- Removed the V3 status timestamp cache buster and added 15-second edge reuse for the public,
  wallet-independent status response. Mutations do not trust this advisory response.
- Reduced V3 provider retries from three to one; a failure cannot multiply a background cycle into
  repeated CU consumption.

## Deterministic before/after request model

These figures are derived from the call graph and regression fixtures, not from an Alchemy billing
export:

| Scenario | Before | After |
| --- | --- | --- |
| 100 repeat loads of a populated owner roster | Up to 2,600 server multicalls containing 501,700 `ownerOf` executions | Zero automatic full-roster server reconciliations; bounded verification of indexed candidates remains |
| Warm V3 discovery with no active indexed drop | 1 head + up to 16 log queries + 22 global provider reads, before other checks | 1 head + normally 1 incremental log query; 0 global/account/simulation reads |
| No-candidate V3 request count | At least 39 RPC requests at the method level | Normally 2, a roughly 95% reduction for this path |
| Chain-wide NFT scheduled stream | Market-wide transfer scans every two minutes when configured | 0 unless separately and explicitly enabled |
| Deploy-preview scheduled RPC | Same schedule definitions could invoke production logic | 0 by default |

The first incremental SeaDrop bootstrap is capped at four 5,000-block queries. Later runs advance
from the saved checkpoint and generally need one query. Candidate execution remains intentionally
more expensive because ownership, authorization, runtime, price, recipient, policy, and simulation
must be proven live.

## Security preserved

No live validation was removed from a privileged action. Activation, configuration, directed or
autonomous execution, paid spending, and withdrawals continue to fail closed on current ownership,
authorization, runtime, recipient, value/price, policy limits, and simulation. Indexed state is for
fast display, scheduling, and deciding whether there is anything worth checking on-chain.

## Operations

Apply `20260829010000_create_seadrop_discovery_checkpoint.sql` before enabling the updated V3
scheduled worker. Recommended settings:

```text
ENABLE_PREVIEW_BACKGROUND_RPC=false
BROKER_ENABLE_CHAIN_WIDE_NFT_INDEXER=false
PAUSE_BACKGROUND_RPC=false
BACKGROUND_RPC_ALLOWED_TASKS=AUTOMATION_V3_WORKER
```

If provider usage spikes, set `PAUSE_BACKGROUND_RPC=true` immediately. Do not enable the
chain-wide NFT stream until it has a reviewed narrow start block and an explicit cost budget.
The task allowlist permits the optimized V3 worker while keeping the Discord scanner and all
other scheduled RPC consumers off; an explicitly empty allowlist disables every scheduled task.

## Remaining measurement work

After the optimized production worker has run for 24 hours, export Alchemy usage grouped by JSON-RPC
method and compare it with the prior incident window. That is required for honest CU percentages,
p50/p95 provider latency, rate-limit rate, and a final per-source cost allocation. Source-level
request tagging can then be added at the centralized transport boundary if billing still cannot
distinguish the remaining safety-critical calls.
