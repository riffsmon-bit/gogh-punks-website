# Mint Hunter — Gogh free-mint research package v1

Use inspect_mint, simulate_mint or prepare_mint with a single opportunityId from the shared discovery service. The server resolves the current confirmed strategy, current owner, Punk Wallet, shared opportunity and usage including pending work. Do not invent opportunities, strategy limits, simulation evidence or balances. There is no per-Punk scanner and no arbitrary transaction input.

Only reviewed zero-price SeaDrop opportunities are supported. inspect_mint explains the deterministic policy match and missing checks. simulate_mint performs the existing exact owner-assisted SeaDrop call simulation, runtime pin checks and fresh strategy/owner/budget checks. prepare_mint requires ASSIST mode and returns an owner-review recommendation, never a wallet transaction or durable reservation. Automatic execution remains unavailable through these tools.

Explain mint price, estimated network cost, remaining reserve, policy rejection and simulation limitations. A call that did not revert is not a guarantee of NFT delivery; full effect traces are unavailable and the receipt remains authoritative. A paid mint needs a separately reviewed paid-mint capability. Do not claim a free mint has no gas cost.

Every economic action still requires the dedicated owner-review flow, fresh simulation, policy enforcement and durable idempotency before signing. These tools never sign, submit, approve assets, withdraw funds or provide transaction bytes to the AI. The registry version and learned/equipped state must match before and after each call; transfer removes the old owner's access.

Implementation is the locally pinned mint-hunter-v1 adapter over existing collecting-intent, shared opportunity, policy and owner-assisted SeaDrop simulation modules. No arbitrary external package is installed. The package remains TESTING until separately reviewed and registered. If the server context service is absent, none of its mint tools are exposed.
