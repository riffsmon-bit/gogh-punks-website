# Gogh Punks utility — X Space talk track

## The short version

Gogh Punks is building toward a Robinhood-native network of programmable digital art curators. The long-term idea is that every Gogh Punk can control a deterministic Punk Account, develop an owner-defined collecting personality, discover art, build a persistent gallery, and eventually acquire approved NFTs under strict on-chain rules.

The owner remains in control. The AI does not receive the owner's private key, cannot send arbitrary transactions, and cannot override the Punk's on-chain policy.

## Current collection facts

- Canonical collection: `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6`
- Network: Robinhood Chain, chain ID `4663`
- Mint status: sold out on-chain
- Contract maximum supply: `5,016`
- Historical mint count: `5,016`
- Permanently burned from the owner's recent unlock mints: `721`
- Current circulating supply: `4,295`
- Secondary transfers: unlocked

The historical mint count does not decrease when NFTs are burned. That is why the historical count is 5,016 while the current circulating supply is 4,295.

## The core utility

### 1. Every Punk becomes a persistent digital curator

The Punk is more than a profile image. Its token identity can resolve to one deterministic Punk Account using:

`Robinhood chain ID + Gogh Punks contract + token ID`

That means the same canonical Punk always resolves to the same account. The account can hold native currency, ERC-20 tokens, ERC-721 NFTs, and ERC-1155 editions.

### 2. Control follows live NFT ownership

The Punk Account checks the collection contract's live `ownerOf(tokenId)` result. If Alice owns a Punk, Alice controls its account. If Alice transfers the Punk to Bob, Alice immediately loses authority and Bob gains it without a backend sync, manual migration, or custody transfer.

The account and its public history can remain associated with the Punk. This creates the possibility of a Punk carrying a gallery, provenance, collecting identity, and curator reputation from one owner to the next.

### 3. The owner writes an Art Mandate

Each owner can define what their Punk should look for and what it must avoid. The mandate combines creative preferences with hard safety rules.

Creative settings can include:

- pixel art, generative art, 1/1 work, photography, animation, or conceptual art
- established or emerging artists
- small editions or larger collections
- curator personas such as The Pixel Maxi, The Generative Curator, The Emerging Artist Hunter, or The Museum Curator

Hard policy settings can include:

- maximum price per acquisition
- daily and weekly budgets
- minimum account reserve
- acquisition-count limits
- approved collections, mint contracts, marketplaces, currencies, and functions
- quote expiration and maximum slippage
- agent expiration, revocation, and emergency pause

Personality can influence which art gets recommended. It can never override the security policy.

### 4. Scout Mode delivers value before any spending

Scout Mode is the first production target. The agent watches Robinhood NFT activity, discovers new collections and artists, analyzes opportunities, and builds a ranked recommendation feed. No money moves in Scout Mode.

The local foundation now recognizes verified Robinhood Seaport settlement events
as historical research signals. A completed sale is labeled “not a live
listing,” its executable price is forced to zero, and it can never create a buy
proposal by itself. This read-only feed is staged—not yet a production service.

The staged analyzer can then inspect a collection at one confirmed Robinhood
block, compare bytecode and proxy signals, and read verified ABI surface. It
shows contract risk and evidence coverage as separate numbers. If important
probes are missing, the label stays UNKNOWN instead of pretending confidence.

That same confirmed snapshot can read the collection name, sample ownership of
recently observed tokens, and decode bounded on-chain JSON metadata. Art tags
derived from self-described metadata are visibly approximate—not a claim that
an AI objectively judged the artwork. Historical sales use their actual source
block time, volumes stay separated by currency, and completed sales never become
a fake floor or liquidity score.

Each recommendation presents separate signals instead of one mysterious score:

- Art Score
- Taste Match
- Creator Score
- Market Score
- Liquidity Score
- Contract Risk
- Agent Confidence
- a plain-language explanation

Unknown collections may be discovered and discussed, but they are not automatically eligible for autonomous execution.

### 5. Approval mode makes the owner the final signer

In Approval Required mode, the agent can prepare a typed acquisition proposal, but the owner must approve it. Before signing, the owner sees the exact collection, token, seller or mint contract, venue, function, price, gas estimate, expiration, policy impact, remaining budget, reserve after purchase, and risk assessment.

The AI cannot invent arbitrary calldata. A proposal must pass through a deterministic transaction builder, an explicitly registered venue adapter, and the Broker Policy Module before the Punk Account can execute it.

### 6. Autonomous mode is a later, tightly bounded option

Autonomy is not the default and is not currently deployed. If introduced after audits and canary testing, it will begin with one Punk, a tiny balance, one approved venue, one approved collection, strict spending limits, a large minimum reserve, short-lived quotes, a revocable agent, and a global emergency pause.

Every autonomous acquisition must pass on-chain checks. A compromised AI or agent signer should be able to do no more than the narrow mandate permits. Autonomous selling, unknown-contract execution, and unrestricted minting remain disabled.

### 7. Every acquisition adds provenance

The Punk's Curator Journal can record:

- the acquired NFT, artist, collection, and token ID
- acquisition price, date, venue, and transaction hash
- whether it was owner-approved or policy-authorized
- the policy and agent versions used
- recommendation scores and the human-readable reason

This turns the gallery into a verifiable collecting history rather than a simple wallet inventory.

### 8. Galleries and reputation make curation visible

Each Punk can have a public gallery showing its collected art, artists, acquisitions, curator notes, and activity. Reputation can focus on art-first measurements such as artist diversity, collection cohesion, early discoveries, taste match, recommendation accuracy, and the number of unique artists supported.

The goal is for a Punk to become interesting because it develops a recognizable eye and a meaningful gallery—not because it promises financial returns.

## The security story

The trust boundary is:

`AI recommendation -> typed intent -> deterministic adapter -> on-chain policy -> Punk Account -> blockchain`

It is deliberately not:

`AI -> private key -> arbitrary transaction`

Core protections include:

- the current Punk owner is always the ultimate authority
- the previous owner loses account control immediately after transfer
- the AI never receives the owner's key
- the agent never receives unrestricted `execute` authority
- no team or protocol-admin withdrawal path exists
- unknown contracts cannot be autonomously called
- budgets cannot be bypassed by splitting transactions
- minimum reserves, expirations, nonces, and replay protection are enforced
- owners can pause, revoke, withdraw, and remove permissions even if the AI service is offline
- a protocol guardian may pause a compromised module but cannot seize Punk assets

## Honest feature status

### Live now

- Canonical Gogh Punks collection on Robinhood Chain
- On-chain ownership and transferable ERC-721s
- Fully on-chain art and metadata architecture
- Secondary transfers unlocked
- Sold out on-chain with the maximum supply matching the historical mint count
- Current circulating supply of 4,295 after 721 permanent burns

### Built or staged locally for validation

- deterministic Punk Account and registry foundation
- owner-transfer-aware authority model
- Art Mandate and Broker Policy architecture
- limited Art Agent registry and revocation model
- typed marketplace and mint adapters
- indexer, portfolio, gallery, discovery, recommendation, and journal foundations
- verified Seaport completed-sale indexing as non-actionable Scout research
- confirmed-block contract evidence and verified-ABI surface analysis
- Scout, approval, and canary deployment flows
- adversarial, unit, and property-test foundations

### Not deployed or enabled

- Art Broker production contracts
- autonomous purchases
- autonomous minting
- autonomous selling
- unknown-contract execution
- cross-chain autonomous activity

Do not describe these disabled features as live. The next responsible steps are independent security review, verified Robinhood venue adapters, production indexing, a separated agent signer and guardian, and a single controlled Punk canary.

## 90-second read-aloud version

“Gogh Punks is a fully on-chain art collection native to Robinhood Chain, but our bigger vision is to turn every Punk into its own digital curator.

Each Punk will be able to resolve to a deterministic smart-account wallet. The account follows the Punk's live ownership, so when the Punk changes hands, the old owner immediately loses control and the new owner gains it. The Punk can keep its gallery, its collecting history, its personality, and its reputation.

Owners will create an Art Mandate: the styles and artists their Punk loves, plus hard limits like maximum price, daily budget, minimum reserve, approved collections, and approved marketplaces. In Scout Mode, the agent discovers Robinhood-native art and produces transparent recommendations with separate art, taste, creator, market, liquidity, and risk scores. No money moves.

Later, owners can approve exact acquisition proposals. Carefully audited autonomous mode may follow for a single canary Punk under tiny, contract-enforced limits. The AI never gets the owner's key, never gets arbitrary wallet control, and cannot bypass policy. The smart contracts—not the AI—are the final authority.

Every acquisition can become part of a public curator journal and persistent gallery. The goal is not to build a trading bot. It is to let every Gogh Punk develop an eye, support artists, build provenance, and become a recognizable digital curator.”

## Useful Q&A

**Is the autonomous broker live?**
No. The foundations are staged for testing. Production autonomy is off pending security review and a one-Punk canary.

**Does the AI control my wallet?**
No. It never receives the owner's private key or unrestricted execution authority. Contracts enforce the permitted targets, methods, prices, budgets, reserves, and timing.

**What happens when a Punk is sold?**
Control of its deterministic account follows the collection contract's live owner. The gallery and assets may remain with the Punk Account, so buyers must understand what is included before any future gallery-based sale experience is marketed.

**Is this a profit bot?**
No. It is an art-curation system. Market signals can inform recommendations, but the product does not promise appreciation or returns.

**What is useful before autonomous purchases?**
Scout Mode, discovery, transparent analysis, watchlists, Taste Profiles, Art Mandates, public galleries, journals, and curator reputation all provide value without granting an agent spending authority.

**Why use on-chain policy?**
Because an AI remembering a budget is not security. A contract-enforced budget can revert a prohibited transaction even if the AI, backend, frontend, database, or agent signer is compromised.

## Claims to avoid

- “The AI can buy anything it wants.”
- “Autonomous trading is live.”
- “The system guarantees safe collections.”
- “The gallery guarantees the Punk's future value.”
- “The agent guarantees profit.”
- “The system is audited,” until an independent audit is complete.

Prefer: “lower risk,” “higher risk,” “estimated value,” “staged,” “planned,” and “subject to audit and canary validation.”
