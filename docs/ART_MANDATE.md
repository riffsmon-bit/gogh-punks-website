# Art Mandate

An Art Mandate combines the Punk's collecting identity with owner-controlled execution boundaries.

## Layers

### Artistic preferences

Taste dimensions include pixel art, generative art, 1/1, photography, illustration, animation, abstract, surrealism, PFP, conceptual art, on-chain art, AI-assisted art, editions, physical-linked art, emerging artists, historical NFTs, and experimental NFTs.

These fields affect discovery ranking and explanations only. They cannot expand execution authority.

### Risk settings

Risk preferences select how aggressively Scout ranks uncertain opportunities. Contract-deny rules, adapter registration, unknown-collection restrictions, mint restrictions, selector restrictions, and emergency pauses remain hard controls regardless of persona.

### Economic settings

- maximum transaction;
- daily and weekly spend by currency;
- maximum mint price;
- maximum secondary purchase price;
- maximum acquisitions per day;
- minimum native reserve;
- maximum slippage;
- maximum intent age;
- venue/currency-specific maximums.

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

## Persona examples

The code includes The Pixel Maxi, Emerging Artist Hunter, Generative Curator, 1/1 Collector, Degen Gallerist, Conservative Collector, Chain Archaeologist, Contrarian, and Museum Curator. A persona is a weight profile, not a security role.

## Persistence and transfer

Public taste, persona, gallery, journal, and reputation may persist with the Punk. A policy configured by a previous owner becomes ineffective immediately because the policy stores `configuredBy` and compares it to live `owner()`. A new owner must explicitly configure policy and authorization.

Email, phone, Telegram, Discord targets, device data, and 2FA preferences are stored separately in an encrypted owner-wallet record. They never attach to the transferable Punk.
