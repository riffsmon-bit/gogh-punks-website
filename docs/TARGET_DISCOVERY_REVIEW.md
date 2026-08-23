# Reviewed target discovery

Autonomous discovery is intentionally broader than autonomous execution. Scout may observe many
zero-price mint contracts, but an observation does not become an executable target until its exact
collection, venue, adapter, code, configuration, metadata, ownership, limits, and simulation have
all passed review.

## 2026-08-23 Robinhood scan

A read-only scan at Robinhood block `43,712,014` (`2026-08-23T04:19:16.000Z`) found 24 active
SeaDrop-compatible clones that reported a native mint price of zero and remaining supply and wallet
allowance for Punk #1797. Every candidate shared the observed EIP-1167 clone runtime hash
`0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4`.

That evidence is necessary but not sufficient. The set included contracts named `DO NOT MINT!!`,
`Do not buy collection`, `WRONG`, `TEST DROP`, and several generic test collections. Four
representative candidates with less obviously hostile names—Crystal Cats, Pixel Blue Cats,
Sunrise, and Meow—returned an empty `tokenURI` for an already-minted token. The clone source or
shared implementation does not establish the collection creator's identity, artwork quality,
metadata durability, off-chain behavior, or social provenance.

## Decision

No candidate from this scan is approved for an autonomous queue. No adapter should be deployed or
registered from this evidence, and no holder or guardian permission should be requested for it.
The result is still useful Scout data: it demonstrates that price and bytecode checks alone would
admit spam, tests, and opaque collections.

A future target may move to `REVIEWED_READY` only after all of the following are independently
recorded:

- exact collection and SeaDrop runtime/proxy implementation hashes;
- verified source and immutable/configuration bindings;
- zero native price, quantity one, no token approvals, no arbitrary calldata, and no paid path;
- active phase, remaining supply, remaining Punk Account allowance, and fresh simulation;
- nonempty, retrievable artwork metadata with a documented permanence model;
- creator/project provenance and a risk review that does not rely on the collection's own claims;
- a target-specific adapter deployed for exactly one collection and Punk Account;
- guardian registry commitments plus holder permissions, a daily cap, short authorization, gas
  reserve, stop-on-failure, and containment plan.

Discovery snapshots expire. Every execution attempt must repeat fresh dual-RPC state, code, owner,
policy, price, allowance, supply, gas, and simulation checks immediately before submission.
