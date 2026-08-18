# Art Broker Architecture

## System boundary

```text
Canonical Gogh Punk
        │ ownerOf(tokenId)
        ▼
Deterministic Punk Account
        │
        ├── current owner ── ordinary CALL / emergency recovery
        │
        └── typed NFT intent
                ▼
         Broker Policy Module
                ▼
       Registered immutable adapter
                ▼
        Approved mint / marketplace
                ▼
       NFT receipt postcondition
```

The LLM and all analyzers sit outside this authority diagram. They produce data, not calldata authority.

## On-chain components

- `GoghPunkAccountRegistry`: fixed canonical identity, deterministic calculation, owner-gated activation, implementation version 1.
- `GoghPunkAccountV1`: live owner authority, asset receivers, owner calls, EIP-1271, typed broker calls, sequential nonces, and acquisition postconditions.
- `BrokerPolicyModule`: mode, feature gates, budgets per currency, account-wide acquisition frequency, owner-generation-bound permissions, transaction and venue limits, reserve, allowlists/denylists, selector policy, expiration, slippage, pauses, and usage buckets.
- `ArtAgentRegistry`: global agent version eligibility plus explicit current-owner authorization and expiration.
- `ArtAdapterRegistry`: adapter/venue identity, code-hash pinning, version metadata, and global kill switch.

No protocol component has a Punk Account withdrawal function.

## Off-chain services

- Discovery sources normalize on-chain transfers and future marketplace/launchpad feeds.
- Art, creator, market, and contract-risk analyzers keep separate evidence and scores. Contract, token ownership samples, identity, and metadata calls are pinned to the same confirmed block/hash; explorer ABI evidence is advisory only.
- Recommendation engine applies persona taste without hiding risk in one number.
- Typed intent builder rejects target addresses and arbitrary calldata supplied by an AI.
- Reorg-aware indexer processes confirmed logs with chain-qualified idempotency keys and materializes verified Seaport settlements as non-actionable Scout evidence.
- A separately locked, disabled-by-default collection-analysis worker records versioned signal snapshots and updates only read-model evidence. On-chain JSON metadata is bounded and sanitized; remote metadata stays unfetched. Market scores use canonical source-block timestamps and completed-sale activity only. Every update forces execution eligibility off.
- Netlify APIs expose public read models only in this repository.
- Notification adapters resolve the live owner at delivery time, use owner-private settings, and receive no account key.
- Reputation and leaderboard modules use published, versioned art-first formulas and never combine unlike currencies.

## Data authority

- `ownerOf`: current authority.
- Punk Account and policy contracts: execution authority and limits.
- Confirmed logs: acquisition and policy provenance.
- Database: restartable read model; never the authority for ownership or spending.
- AI output: untrusted recommendation evidence.

## Scout evidence classes

- `ANALYZED`: deterministic contract or confirmed-chain evidence was evaluated.
- `HEURISTIC`: a visibly approximate signal derived from untrusted metadata tags; it is displayed with `~`.
- `OBSERVED_ACTIVITY`: a visibly approximate signal derived from completed canonical sales; it is displayed with `~`.
- `UNAVAILABLE`: the required evidence is absent, so the UI displays `—` rather than zero.

Sampled owners are never presented as total holders. Completed sales are never
presented as current listings or executable liquidity. Volumes remain separated
by currency.

## Product stages

1. Public galleries and portfolio read model.
2. Art Mandate and Taste Profile configuration.
3. Scout recommendations only.
4. Audited owner-approved typed acquisitions.
5. One tightly bounded canary.
6. Autonomous canary only after a separate authorization.

Selling, bidding, lending, rentals, commissions, cross-chain execution, and autonomous liquidation are extension points only. They are not enabled in V1.
