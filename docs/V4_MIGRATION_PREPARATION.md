# Gogh Art Broker V4 migration preparation

Status: preparation only. Production V3 remains live until the owner separately authorizes the
migration pause. No refund, wallet sweep, credit migration, or V4 autonomous execution is
authorized by this document or its companion tooling.

## Confirmed V3 architecture map

### Control and execution path

1. Current Gogh Punk ownership is resolved from the canonical collection on chain.
2. `GoghPunkAccountRegistryV3` resolves or creates the Punk's ERC-6551 account.
3. `GoghPunkAccountV3` derives its owner from the current owner of the controlling Punk. The owner
   alone can use the general `execute` and `executeBatch` recovery paths.
4. V3 owner activation configures `BrokerPolicyModuleV3`, authorizes one hosted EOA through
   `ArtAgentRegistry`, and enrolls the Punk in `broker_automation_v3_enrollments`.
5. Five scheduled regular-lane functions and the minute-scheduled priority worker invoke the same
   V3 discovery/screening/execution implementation with different hosted signers.
6. An autonomous acquisition is constrained to a typed intent, an approved adapter/runtime hash,
   live ownership, a policy nonce/version, time and price limits, and post-execution NFT ownership.

The existing Punk Account is therefore already the durable Punk wallet. V4 can retain its
transfer-aware ownership and asset-recovery properties while retiring the hosted EOA authorization
and scheduling model.

### Hosted funding path

`Punk owner -> native ETH transfer -> assigned hosted lane EOA -> dual-RPC receipt check ->
gogh_broker_punk_agent_gas_deposits -> gas account credit -> priority session -> priority worker ->
receipt-backed usage charge`

The hosted deposit API never sends the user's transaction itself; the browser asks the connected
owner wallet to send directly to the fixed lane EOA and then confirms the transaction. User credits
and project gas are economically distinct but native ETH in each EOA is fungible, so database rows
must be reconciled against complete wallet history before any balance is classified as project
owned.

### Data ownership

| Record | Store | Authority |
| --- | --- | --- |
| Punk ownership | Robinhood Chain | Canonical collection `ownerOf` |
| Punk wallet address and account version | Netlify DB plus on-chain registry | On-chain registry/code |
| Hosted lane enrollment/worker history | Netlify DB | Operational projection |
| Opportunities, acquisitions and activity | Netlify DB | Confirmed logs plus derived projections |
| User hosted deposits | Supabase | Confirmed transaction evidence |
| Priority sessions/attempts/usage/refunds | Supabase | Additive accounting ledger |
| Hosted EOA balance and transaction receipts | Robinhood Chain | On-chain evidence |

### Transaction idempotency boundary

Priority V3 reserves a durable `gogh_broker_punk_priority_attempts` row before submission, records
the transaction hash on the same attempt, and makes gas usage unique by transaction hash. Regular
V3 relies on the Punk Account acquisition nonce and the on-chain typed intent but does not have the
same pre-submission database reservation for every regular execution. V4 must use one durable
execution identity from eligibility selection through transaction reconciliation for every path.

### Status propagation

Worker and lane state flows through the V3 status endpoint into the Punk Control Center. Punk
ownership, Punk Wallet activation, agent authorization, worker health, queue state, and external
provider health are separate facts in source, although portions of the current UI still describe
activation in hosted-agent terms. The migration pause must be rendered as a system state and must
not mutate or reinterpret Punk authorization.

## Prepared migration state

The code preparation uses an explicit `BROKER_V4_MIGRATION_STATE=PAUSED_MIGRATION` gate. When it is
eventually deployed and enabled, the gate will:

- stop scheduled V3 and V2 network execution before discovery or submission;
- reject manual hosted execution and new hosted-deposit confirmation;
- keep hosted-balance reads, Punk ownership, Punk Wallet funding/withdrawal, history, sessions,
  jobs, and authorization records intact; and
- expose `SYSTEM_PAUSED_FOR_V4_MIGRATION` instead of a Punk repair state.

Setting the variable is a later production action. Preparation and tests do not set it.

## V4 target boundary

`shared discovery -> normalized durable opportunity -> security/simulation gate -> eligible funded
Punk query -> durable execution attempt -> narrow Punk policy authorization -> Punk Wallet mint`

The stateless executor must never gain the owner's unrestricted `execute` authority. The intended
policy surface is limited by adapter, target, calldata/value, price, gas, daily/remaining counts,
minimum reserve, expiry, risk state and the Punk Account nonce. Discovery is performed once per
opportunity rather than once per Punk.

## Accounting gates

The reconciliation output is incomplete unless all of the following are true:

- every database deposit is independently confirmed on chain;
- all hosted EOA history is available from an indexed provider or equivalent archival evidence;
- current Punk ownership and canonical Punk Wallet destinations are resolved at a pinned block;
- gas, mint value, refunds, other outflows and current wallet balances reconcile;
- ambiguous inflows are not classified as project funds; and
- `FINAL_SWEEP_READY` remains false until user liabilities and ambiguous balances are zero.

Prepared refund/migration manifests are dry-run artifacts. A later owner choice and a separate
broadcast authorization are required for every real movement of funds.
