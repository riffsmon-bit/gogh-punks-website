# Art Mandate

An Art Mandate combines the Punk's collecting identity with owner-controlled execution boundaries.

## Layers

### Artistic preferences

Taste dimensions include pixel art, generative art, 1/1, photography, illustration, animation, abstract, surrealism, PFP, conceptual art, on-chain art, AI-assisted art, editions, physical-linked art, emerging artists, historical NFTs, and experimental NFTs.

These fields affect discovery ranking and explanations only. They cannot expand execution authority.

### Risk settings

Risk preferences select how aggressively Scout ranks uncertain opportunities. Contract-deny rules, adapter registration, unknown-collection restrictions, mint restrictions, selector restrictions, and emergency pauses remain hard controls regardless of persona.

### Economic settings

- inspect mint activity;
- permit or decline free mints;
- permit or decline paid mints;
- maximum transaction;
- daily and weekly spend by currency;
- maximum mint price;
- maximum secondary purchase price;
- maximum acquisitions per day;
- minimum native reserve;
- maximum slippage;
- maximum intent age;
- venue/currency-specific maximums.

These settings are versioned per chain-qualified Punk identity, not globally per
wallet or collection. Two Punks owned by the same wallet may have completely
different mint ceilings, budgets, reserves, styles, and risk tolerance.

Scout uses the fail-closed `ArtMandate` model in `broker/src/mandate.mjs`. If no
current-owner mandate exists, the Punk may inspect public mint signals but does
not express a desire to spend. A mint-interest result is advisory and can be
`IGNORE`, `WATCH`, `RESEARCH`, `OWNER_APPROVAL_REQUIRED`, or
`AUTONOMOUS_POLICY_ELIGIBLE`. The last label is never sufficient to move funds:
the live owner, registered adapter, agent authorization, feature flags, budget,
reserve, and every on-chain permission must independently pass.

### Permissions

- adapters;
- marketplaces;
- mint contracts;
- NFT collections;
- currencies;
- allowed and denied selectors.

Every permission change increments the on-chain policy version and invalidates pending intents carrying the old version.

## Operating modes

- `DISABLED`: owner-only account.
- `SCOUT`: discovery and recommendations; no broker transaction.
- `APPROVAL_REQUIRED`: exact typed intent must be submitted or signed by the current owner.
- `AUTONOMOUS`: a current, globally approved, owner-authorized agent can execute only typed intents that pass policy.

Fresh accounts are effectively disabled until their owner configures a policy. The product default is Scout; production purchase flags remain off.

## How a Punk decides about a mint

The Punk first inspects confirmed evidence, then compares the opportunity with
its own Taste Profile and mandate. It considers price status, free-versus-paid
permission, maximum mint price, Taste Match threshold, contract-risk ceiling,
allowlists and blocklists. An observed mint transfer with an unknown live phase,
unknown price, or unknown contract risk remains `RESEARCH`, even when the Punk
likes the artwork. Personality can change ranking but never relax security.

## Persona examples

The code includes The Pixel Maxi, Emerging Artist Hunter, Generative Curator, 1/1 Collector, Degen Gallerist, Conservative Collector, Chain Archaeologist, Contrarian, and Museum Curator. A persona is a weight profile, not a security role.

## Persistence and transfer

Public taste, persona, gallery, journal, and reputation may persist with the Punk. A policy configured by a previous owner becomes ineffective immediately because the policy stores `configuredBy` and compares it to live `owner()`. A new owner must explicitly configure policy and authorization.

Email, phone, Telegram, Discord targets, device data, and 2FA preferences are stored separately in an encrypted owner-wallet record. They never attach to the transferable Punk.
