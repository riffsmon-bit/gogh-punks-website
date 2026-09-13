# Versioned real research skills

Status: implementation and controlled adapter tests passed; public registration and server release selection remain separate review gates. These packages are not automatically READY. No production NFT, balance, registration or wallet authorization changed.

| Package | Existing protocol bit | Actual behavior | Required service | Public activation |
| --- | --- | --- | --- | --- |
| Contract Detective v1 | CONTRACT_READ = 1 | Existing contract runtime/interface inspection | Fixed chain client | Existing package unchanged; registration remains administrator-reviewed |
| Rarity Eye v1 | RARITY_READ = 8 | Existing bounded metadata/trait comparison | Fixed chain client | Existing accepted package unchanged |
| Market Scout v2 | MARKET_READ = 4 | Exact item/payment identity and integer prices from bounded OpenSea listings | Existing OpenSea API key | Explicit v2 selection and registry hashes required; v1 default preserved |
| Link Sniper v1 | LINK_REVIEW = 16 | Existing fixed-source Robinhood contract/link inspection, mint-window and price observation | Existing fixed/configured read-only RPC | New reviewed package; no public registration |
| Mint Hunter v1 | FREE_MINT = 2 | Shared-opportunity policy inspection, fixed SeaDrop call simulation and ASSIST owner-review recommendation | Server-owned current strategy/opportunity/authority/usage service and fixed client | New reviewed package; no public registration or wallet transaction |

`loadResearchSkillCatalog({ selection: [{ slug, version }] })` accepts only explicitly reviewed identities. Omitting `selection` retains the original three v1 packages. Both versions can be loaded for inspection, but equipping two versions of Market Scout denies an ambiguous call instead of silently choosing a reader. The implementation selected for a call is bound to the exact equipped key and matching manifest/instruction hashes.

New packages pin their adapter and directly used existing safety modules. No accepted v1 package, Rarity Eye manifest, underlying reviewed mint/simulation module or capability bit changed. No external package was installed. Dependency changes require updating and reviewing the new package's hash; they cannot silently inherit approval.

## Server integration

The parent owns production MCP and route wiring. `createResearchSkillRuntime` now accepts `mintContextReader({ tokenId, owner, opportunityId })`, returning:

```
{
  intent, opportunity, authority,
  usage: { dailyMints, totalMints, opportunityMints },
  strategyHash, strategyVersion
}
```

The reader must resolve the currently confirmed owner-bound strategy and one shared opportunity, verify current owner/canonical Punk Wallet, and count both completed and pending work. `authority` includes `chainId`, canonical `collection`, `tokenId`, `owner`, `punkWallet`, `activated`, decimal `nativeBalanceWei`, `blockNumber`, `blockHash` and millisecond `blockTime`. The adapter rejects mismatched identities, unverified usage, stale authority, paid or unscreened opportunities, or a strategy-hash mismatch. This service is server-owned; none of these fields are accepted as tool arguments.

Mint tools accept only `opportunityId`. Link Sniper accepts only `url`; it cannot select the RPC endpoint, resolver, recipient or calldata. Existing metadata/market tools retain their arguments. A missing mint context service removes all Mint Hunter tools. A missing OpenSea API key removes the market tool.

Fresh learned/equipped/current-owner/registry gates run before and after every tool. The production bridge must continue enforcing canonical Transfer-log continuity for away-and-back transfers; owner equality alone does not prove continuity.

## Safety and limits

Mint Hunter imports and executes the existing zero-price, quantity-one, fixed SeaDrop owner-assisted simulator. Runtime pins, public mint price, supply, wallet limit and exact call are checked. It then re-reads the strategy, budget and usage and checks canonical chain state. Research has a 12-second response budget; underlying read-only requests still rely on the configured client's transport timeout.

The call check does not provide a full effect trace. Results explicitly state `effectTraceAvailable: false` and `postconditionPendingReceipt: true`. `prepare_mint` produces an owner-review recommendation with `transaction: null`, not a signing artifact, execution reservation or autonomous authorization. The dedicated wallet flow must separately refresh policy/simulation and reserve durable idempotency. No calldata reaches AI through these tools.

Link Sniper keeps unresolved websites, X and unsupported OpenSea links in NEEDS_REVIEW. Runtime observations are not a security clearance or wallet eligibility. Market Scout v2 continues to discard signatures/order payloads, excludes unsupported orders, and never claims a verified collection floor. Floor Hunter, WETH bids and paid-mint capability bits are not introduced by this change.

The [registration proposal](real-skill-registration-proposal.json) encodes exact register-only arguments. It has no sender/destination/nonce/fee envelope, READY transition or broadcast capability. Administrator review, actual registry state and separately attested TESTING-to-READY status remain required.

## Validation

134 focused tests passed, including 29 new package/adapter tests. Tests exercise actual pinned link/market readers and the existing fixed SeaDrop simulator using recorded public runtime bytes plus controlled provider responses. The recorded adapter fixture was fetched using `eth_getCode` and matches the already reviewed runtime hash; it does not add a new trust pin.

Coverage includes unchanged v1 selection, v2 dispatch, ambiguous versions, absent credentials/context, tampered dependency/implementation/registry hashes, unequip, unlearned, old owner, transfer during provider work, arbitrary endpoint/identity/calldata input rejection, exact large-integer prices, wrong simulator chain, canonical-anchor changes, stale simulation heads, repricing, code changes, call reverts, pending usage limits, insufficient reserve, strategy changes during simulation and registration calldata round trips.

Command:

```
node --test tests/skill-forge-real-package-adapters.test.mjs tests/skill-forge-research-runtime.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/v2-hardening-market-reader.test.mjs tests/v2-fixed-source-link-resolver.test.mjs tests/owner-assisted-seadrop-mint.test.mjs tests/v2-swarm-policy.test.mjs
```

A separate copied-chain registry→credit→learn→equip→tool→transfer journey is the next acceptance gate. This file does not claim that an RPC response fixture proves a public learned/equipped skill or that package code passing tests registers it on mainnet.
