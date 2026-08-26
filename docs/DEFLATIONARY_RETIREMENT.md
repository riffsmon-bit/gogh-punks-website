# Deflationary Punk retirement model

Status: **offline design and tested decision model only**. Nothing in this document authorizes or
submits a burn, changes the live collection, or gives an agent permission to burn a Gogh Punk.

## Goal and hard limit

The proposed program stops offering retirement through this workflow when the collection reports a
circulating supply of **1,420**. The existing verified Gogh Punks contract exposes a holder-authorized
`burn(uint256)` function, so participation can remain voluntary and owner-controlled.

The 1,420 number cannot be guaranteed as a permanent global floor: a holder can call the collection's
existing burn function directly, outside this application. The site can enforce the floor only for
retirements it prepares.

At the 2026-08-25 planning snapshot, the canonical collection reported a circulating supply of 4,295.
Reaching 1,420 from that snapshot would therefore require 2,875 voluntary retirements. The live value
must be re-read before every retirement; this observation is not a fixed deployment constant.

## Draft rarity lifetimes

Rarity must come from a published, reproducible snapshot of the canonical on-chain metadata—not from
the browser, an owner, or the agent. The draft lifetime schedule counts confirmed autonomous mints:

| Tier | Confirmed mints before retirement review |
| --- | ---: |
| Common | 100 |
| Uncommon | 200 |
| Rare | 400 |
| Epic | 800 |
| Legendary | 1,600 |
| Mythic | 3,200 |

The current UI may display OpenSea's current OpenRarity rank as a preview and maps the collection's
5,016 maximum-supply rank bands as follows: Mythic 1–51, Legendary 52–251, Epic 252–753, Rare
754–1,756, Uncommon 1,757–3,010, and Common 3,011–5,016. This marketplace rank is display evidence
only. It cannot start the retirement counter. An enforceable tier requires the complete collection
rank assignment to be frozen, reviewed, and published as an immutable snapshot with a canonical hash.

These values are a starting model, not deployed policy. A final rarity snapshot must publish tier
definitions, tier populations, per-token assignments, and a content hash/Merkle root before the values
can be considered stable.

The collection planner uses deterministic survivor weights of 1, 2, 4, 8, 16, and 32 from Common
through Mythic. It apportions exactly 1,420 survivor slots across the verified tier populations, capped
by the number of Punks in each tier. This preserves a larger share of rarer Punks while setting an exact
retirement quota for each tier. Mint lifetime determines when an individual Punk becomes eligible;
the tier quota and current supply determine whether the site may prepare that retirement.

This is not a forced confiscation. When a Punk reaches its lifetime, automation stops and it cannot
start another minting round through Art Broker. The current holder chooses whether to evacuate its
assets and retire it. If the holder does nothing, the Punk remains owned but inactive.

## Safe retirement sequence

Reaching the mint lifetime does **not** burn the Punk. It changes the state to retirement review:

1. Pause the Punk and revoke every agent authorization.
2. Disable its acquisition policy and target permissions.
3. Enumerate all known ERC-721, ERC-1155, ERC-20, and native balances.
4. Let the current Punk holder withdraw each known asset to that same holder wallet.
5. Repeat live balance and ownership checks and wait through a visible cooldown.
6. Require a new, explicit owner confirmation that burning is irreversible and unknown/directly sent
   assets may be stranded in the token-bound account.
7. Simulate one exact `burn(tokenId)` call from the current owner, then let the owner submit it.

The agent, worker, guardian, and website backend may never submit the final burn. There is no safe way
to prove that an ERC-6551 account contains no unknown token sent directly to it, because arbitrary
tokens need not be enumerable. The owner inventory acknowledgment is therefore mandatory even when
every indexed balance is zero.

## Implementation boundary

`broker/src/retirement/deflationary-model.mjs` implements the fail-closed decision states and draft
tier schedule. The next production phase requires a reviewed rarity snapshot generator, a dual-RPC
retirement attestor, a withdrawal manifest covering known assets, a cooldown record, an exact browser
burn encoder, adversarial tests, and a separate deployment/release authorization. Until all of those
exist, the live site must not expose a burn button.
