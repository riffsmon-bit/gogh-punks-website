# Reviewed autonomous free-mint queue

The continuous-execution design begins with a bounded queue of independently reviewed targets. It
is not a generic OpenSea transaction bot. Every target must use the target-specific
`OpenSeaSeaDropFreeMintAdapter`, which permanently binds one collection, one Punk Account,
SeaDrop, quantity one, native value zero, no token approvals, and no opaque adapter data.

The holder approves this bounded setup, not every mint. Once the exact policy, target permissions,
and short-lived agent authorization are active, an encrypted execution worker can submit queued
mints without another holder-wallet popup. It cannot add a new collection to that queue by itself.
The repository currently includes the read-only planner and fail-closed evidence boundaries; a
production worker remains disabled until its separate execution and containment gates are wired.
See
[`TARGET_DISCOVERY_REVIEW.md`](./TARGET_DISCOVERY_REVIEW.md) for the latest fail-closed target scan.

## Holder workflow

1. Connect the current Gogh Punk holder wallet at `/broker/`.
2. Choose a live-owned Punk and activate its deterministic Punk Account once.
3. Select that Punk in Art Mandate, choose autonomous free mints, and set a daily maximum from 1
   through 10. Saving is a free message signature; it records requested preferences.
4. Fund the encrypted agent wallet with enough native ETH for transaction gas. The Punk Account
   does not pay agent transaction gas and the mint itself must have value zero.
5. A reviewer selects a currently active SeaDrop collection, verifies its exact clone runtime,
   public-drop settings, supply, wallet allowance, fee recipient, source/risk evidence, and code
   hashes, then deploys one adapter bound to that collection and Punk Account.
6. The guardian registers the adapter and enables only the required global autonomous mint flags.
   The Punk holder configures an exact `AUTONOMOUS` policy with a hard daily cap and only the
   reviewed adapter, venue, collection, selector, and native zero-value route.
7. The guardian authorizes the encrypted agent briefly. Immediately before each action, the worker
   rechecks the holder, account, agent, nonce, policy version, code hashes, adapter commitments,
   permissions, free price, remaining wallet/supply allowance, gas estimate, and simulation.
8. The worker stops at the first failure, the daily cap, the run cap, or the gas/reserve ceiling.
   It then pauses the account, disables execution, revokes the agent and target permissions, and
   records confirmed receipts.
9. The Punk gallery and Curator Journal display confirmed acquisitions and containment evidence.

## Queue planner

The read-only planner accepts two immutable JSON artifacts:

```sh
npm run broker:autonomy:plan -- \
  --queue ops/reviewed-free-mint-queue.json \
  --live-state ops/reviewed-free-mint-live-state.json \
  > ops/reviewed-free-mint-run-plan.json
```

The queue is limited to ten targets and a 24-hour lifetime. A plan is emitted only when:

- the Punk, current holder, Punk Account, and agent match exactly;
- on-chain mode is `AUTONOMOUS`, the account is unpaused, the agent is authorized, and the exact
  free-mint flags are enabled while paid, unknown-contract, and selling routes remain disabled;
- target addresses, runtime hashes, adapter version/metadata commitments, permissions, selector,
  price, allowance, supply, and simulation match the review;
- the UTC daily count, per-run count, maximum gas per mint, maximum gas cost per run, and minimum
  agent reserve all remain within the queue limits;
- live evidence and the confirmed chain block are no more than 30 seconds old; and
- each intent expires within 120 seconds.

The plan never signs or submits. Its mandatory next gate is a fresh dual-RPC resimulation, encrypted
agent execution, receipt validation, and containment. Runtime queue/state/plan JSON files are
ignored by git and must never contain wallet passwords, private keys, mnemonics, or RPC credentials.

## Current Punk #1797 status

Punk #1797 completed one autonomous zero-value SeaDrop acquisition and was contained afterward.
The original target allowed only one mint per wallet, so that target is exhausted for #1797. A
continuous run requires additional independently reviewed collections and their own bound adapters;
the previous adapter must not be generalized or reused for a different collection.
