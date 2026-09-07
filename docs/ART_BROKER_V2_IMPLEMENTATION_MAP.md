# Gogh Punks Art Broker V2 implementation map

Status: repository audit and implementation boundary. Public product name is **Art Broker V2**.
Next-generation modules use descriptive capability names rather than adding another public product
version.

## Product boundary

V2 is a shared intelligence and protocol service around each Punk's canonical token-bound wallet.
It is not a renamed hosted-agent pool. The owner supplies money and rules, AI supplies
interpretation and subjective classification, deterministic protocol code supplies authority, and
the Punk Wallet supplies custody.

No V2 build step may deploy a contract, enable a production feature flag, authorize an executor,
apply a production migration, expose a secret, or broadcast a transaction. Those are separate
production actions.

## Audited canonical Punk Wallet

- Chain: Robinhood Chain (`4663`).
- Controlling collection: `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`.
- Current reusable generation: `GoghPunkAccountV3` through
  `GoghPunkAccountRegistryV3`.
- Identity is the complete `(chain, collection, tokenId, implementation, salt)` tuple. The registry
  resolves the counterfactual account deterministically and activates it idempotently.
- `owner()` reads the controlling Punk's live `ownerOf`. Indexed ownership is an acceleration hint,
  never mutation authority.
- The old owner loses account authority as soon as canonical ownership changes. The new owner gains
  the owner-only recovery path. Existing agent authorization also binds the authorizing owner and
  expires after at most 30 days.
- The owner-only `execute` and `executeBatch` recovery paths do not depend on a worker, AI provider,
  database, or global broker availability. Persistent standard approvals and nesting the controlling
  Punk inside its own account are blocked.
- The account can hold native value, ERC-20, ERC-721, and ERC-1155 assets. Existing native and NFT
  withdrawal builders bind the destination to the current live owner.

### Material no-deployment limitation

The deployed V3 autonomous policy admits only quantity-one, zero-price SeaDrop mints through one
immutable reviewed adapter. It cannot express V2's broader paid, supply, social, taste, gas-price,
or multi-adapter rules on chain. Those additional rules may narrow an already-supported call
off-chain, but they cannot broaden the deployed contract's authority.

A contract account also cannot originate an EVM transaction or pay transaction gas by itself. The
deployed V3 autonomous entry point expects an externally funded authorized EOA to submit and pay
gas; it has no narrowly typed reimbursement path from the Punk Wallet. Therefore the deployed V3
path remains fail-closed for fully self-funded autonomy.

The repository now contains an undeployed Punk Agent Account resolution built around Robinhood's canonical
ERC-4337 v0.8 EntryPoint. The Punk Agent Account remains ERC-6551 ownership-bound, but replaces the hosted EOA authority
with an owner-approved, expiring mission session key. The account validates the entire packed
UserOperation, admits only one registered mint adapter and venue, requires a quantity-one zero-price
ERC-721 intent, enforces daily and mission caps, caps maximum UserOperation gas, preserves an owner
defined native reserve, and can supply a missing EntryPoint prefund from the Punk Wallet's ETH.
Ownership transfer and owner revocation invalidate the session. Paymasters, paid mints, arbitrary
session calldata, token approvals, sales, and transfers are outside the session authority.

This source and its two-approval artifact do not make AUTONOMOUS production-capable by themselves.
The Punk Agent Account implementation and facade must be separately deployed and verified, the existing reviewed
adapter must be confirmed active, a secure session signer and bundler path must be provisioned, and
receipt reconciliation must be completed before the UI lock can be removed. ASK and ASSIST remain
the only production-capable modes until those gates pass.

The application-side lifecycle is now implemented behind those gates: authenticated setup and
receipt endpoints, exact owner-transaction reconciliation, direct account gas funding, on-chain
recall, a single-instance scheduled worker, durable UserOperation reservation and reconciliation,
live ERC-721 ownership verification, Collection materialization, and Activity heartbeats. The
checked-in deployment manifest remains `UNDEPLOYED`, the migration remains unapplied, and the
worker remains disabled, so this implementation does not silently claim live authority.

Owner-taught skills now persist server-side only after a signed-in current-owner check and a fresh
Punk Wallet authority read. They remain declarative `READ_ONLY` playbook entries with
`policyEffect: NONE`; they can guide conversation, scouting, ranking, and explanations but cannot
broaden a strategy or authorize a transaction. ERC-8004 registration is intentionally deferred
while the EIP remains a draft and no verified Robinhood registry deployment is configured.

## V1 deprecation inventory

### KEEP

- Canonical collection ownership reads and bounded owner-Punk discovery.
- V3 Punk Wallet resolution, activation evidence, live runtime checks, balances, and holdings.
- Owner-only native, ERC-20 where supported, ERC-721, and ERC-1155 recovery paths.
- Confirmed acquisition provenance, V1 activity, metadata, and collection history.
- Reorg-aware chain indexing, dual-provider reads, adapter/runtime verification, and simulation
  primitives that remain valid outside the hosted-worker lifecycle.
- Legacy funding, usage, refund, and hosted-lane reconciliation evidence.

### KEEP TEMPORARILY

- V1 retirement state and transaction guards.
- Read-only V2/V3 enrollment, heartbeat, priority-session, and hosted-lane records required to
  render historical activity or complete reconciliation.
- Legacy endpoint response fields still consumed by post-V1 wallet, asset, and history screens.
- Old public product copy only until each route is replaced by the V2 control center.

### REPLACED BY V2

- Six signer lanes, sticky assignment, rotation, rarity head starts, and the priority worker.
- Per-Punk always-on worker semantics and hosted-agent status as the product identity.
- PREPAY + SEND, hosted EOA funding, project gas subsidies, and per-lane health.
- Repeated per-Punk discovery and analysis.
- Form-first Art Mandates and provider-specific AI calls.
- V1/V3 worker queues as the source of current product activity.

### SAFE TO REMOVE LATER

- Scheduled lane wrapper functions and `GLOBAL_V3_WORKER_BINDING` checks after historical reads no
  longer import them and legacy reconciliation is final.
- Hosted signer secret parsing, lane assignment, funding UI, and priority-session mutation code.
- V1 manual-run and worker-recovery controls after the V2 routes no longer render them.
- Retired automation deployment builders and canary tooling after their immutable artifacts are
  archived and a separate removal review proves no runtime import remains.

Removal is a later, separately reviewed change. V2 implementation does not destructively delete V1
data or recovery code.

## Current application architecture

- Static semantic HTML, CSS, and browser-native ES modules under `site/`; no component framework.
- Reown AppKit is the sole browser wallet session.
- Netlify functions provide bounded JSON APIs and use same-origin checks plus SIWE-style signed
  challenges for owner mutations.
- Netlify DB holds indexed/operational data. Supabase holds sensitive additive accounting and
  execution ledgers behind RLS/service-role boundaries.
- `broker/src` contains pure domain, discovery, screening, recommendation, and indexing code that is
  testable without network access.
- Existing CSS and control-center scripts are large monoliths. V2 will use small route-specific
  modules and shared design tokens instead of adding more V1 conditionals.

## V2 implementation map

1. **Foundation** — versioned collecting intent, normalized opportunity, deterministic matcher,
   execution capability boundary, additive schemas, and this deprecation inventory.
2. **Design system** — original premium arcade-roster tokens and primitives; responsive structure,
   keyboard/focus states, and reduced motion from the start.
3. **Control center** — owned-Punk roster, selected broker hero, live wallet/collection/history,
   direct funding, and preserved withdrawals.
4. **AI platform** — one provider interface with OpenAI, Anthropic, xAI, Bankr, model registry,
   capability/cost routing, health, quotas, caching, and sanitized usage telemetry.
5. **Conversation** — persisted bounded messages, structured strategy drafts, deterministic
   validation, and a signed human-readable activation step for economic changes.
6. **Link scanner** — strict URL normalization, SSRF-safe source-specific resolution, independent
   contract/chain identification, known-adapter reconstruction, screening, and simulation.
7. **Shared discovery** — ingest once, canonicalize, deduplicate, analyze once, then serve many
   Punks.
8. **Matching** — deterministic eligibility and transparent match reasons; AI classification never
   grants authority.
9. **Execution** — durable attempt identity from selection through receipt reconciliation. ASK and
   ASSIST remain distinct from AUTONOMOUS. Unsupported on-chain authority is rejected.
10. **Punk Agent Account** — undeployed ERC-6551 + ERC-4337 account, mission-session limits,
    Punk-funded EntryPoint prefund, and a deterministic maximum-two-approval owner artifact.
11. **Canary** — ASK first, ASSIST second, then a separately authorized Punk Agent Account deployment and one-Punk
    autonomous canary only after signer, bundler, receipt, pause, and monitoring gates pass.

## Versioned domain records

- `PunkCollectingIntentV1`: owner-facing operating mode, economic limits, reserve, discovery and
  safety requirements, explicit allow/deny lists, taste preferences, expiry, and source evidence.
- `NormalizedOpportunityV2`: one chain/mint-stage identity with sources, contracts, adapter,
  price/supply, social evidence, screening, simulation, analysis, and immutable code hashes.
- `V2ExecutionAttemptV1`: deterministic identity over Punk account, opportunity, strategy version,
  account nonce, and execution mode, with a monotonic reservation/submission/receipt state machine.
- `AIModelRegistryV1`: server-owned provider/model capability and routing metadata. UI choices refer
  to registry aliases, not hardcoded vendor model IDs.

## Production authorization boundary

The build may prepare real migrations, provider adapters, APIs, simulations, and transaction
envelopes. It may not apply migrations, use production AI credentials, register or authorize an
executor, unpause deployed modules, submit an owner transaction, or enable scheduled execution.
Each remains visible as a named readiness blocker rather than a fake success state.
