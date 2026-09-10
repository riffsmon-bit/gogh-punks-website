# Original NFT ownership is agent ownership

Product decision, September 10, 2026: **sell the actual Gogh Punk NFT and its agent
goes with it**. No wrapper, receipt, buyer claim, transfer wizard, re-equipping,
or new account is required on a sale. This supersedes the proposed wrapper path.
The original collection remains `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6` on
Robinhood Chain 4663. No NFT contract or production configuration was changed.

## State and custody

The existing account implementations resolve the original NFT's `ownerOf(tokenId)`.
A sale changes the owner returned by both accounts without moving their balances
or changing their addresses. Assets stay in their accounts; the buyer gains
account control. This is the [ERC-6551 token-bound account pattern](https://eips.ethereum.org/EIPS/eip-6551).

| State | Result of original NFT transfer |
| --- | --- |
| Canonical Punk Wallet and Agent Account | Same addresses; current NFT holder controls both |
| Assets and EntryPoint deposits remaining in those accounts | Stay in place, controlled by the buyer |
| Learned skills, levels, rarity allocation, slots, equipment, training credits | Stay indexed by collection + token ID, not copied between owners |
| Public collection/activity provenance | Stays with the token; do not reset because the buyer has no profile row |
| Seller's private chat, notes, preferences | Do not transfer |
| Seller's economic strategy/session | Not automatically authorized for the buyer |

The buyer only approves a **new future mission** if they want automation. That is
permission to spend, not a claim/enrollment step to receive the existing agent.
Permanent Forge progression remains undeployed/locked in production; this work
does not fabricate live learned skills or activate the skill economy.

## Verified against the existing deployed contracts

`node scripts/test-original-punk-transfer-fork.mjs --fork-read-only` pins and
checks the original runtime and both account implementations/registries, then
forks the chain locally. At block **59402225**, hash
`0x98b9e2a50a77092d021a220aa90acab9cb91a33681d7835ad5b84ef358a47dd8`:

- Original runtime hash: `0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93`.
- Punk #93 Agent Account: `0xcAdcFD37e715bC031cF0cEC7fA2335091c878C83`.
- Punk #93 canonical Punk Wallet: `0x06D5e0Df2Eb9512777403bF017031618F4713e19`.
- Both account owners changed automatically after a direct original-NFT transfer
  and after a transfer by an already-approved original-collection operator.
- Both account addresses, native balances, and the agent's EntryPoint deposit
  stayed unchanged. Buyer setup transactions: **zero**.
- Local transfers: **three**. Public transactions, wrapper deployments and
  collection-validator/list changes: **zero**. The real Punk #93 never moved.

This exercises deployed runtime and the original collection's actual transfer
validator. It is not an OpenSea order-signing, matching, or settlement test. The
operator was impersonated on the disposable fork only. No real owner key was read.
The local source directory is not treated as a byte-for-byte verified copy of the
NFT deployment. Read-only probes for `explicitOwnershipOf` and `ownershipOf`
reverted at block 59397289; no public ownership-timestamp API was assumed.

## Transfer authorization safety: remaining limitation

For a **different current owner**, the existing account immediately rejects the
seller's session. However, an immutable legacy account can consider an old session
active again if the NFT goes away and returns to its original authorizing owner
before expiry. `ownerOf` alone is not a transfer nonce.

The existing worker continuity guard remains mandatory. It checks canonical
Transfer history starting at the authorization receipt, including its block, and
rechecks before signing and submission. A transfer, self-transfer, round trip,
unknown history, or reorg fails closed. History is currently bounded to 40,000
blocks; exceeding it stops the mission and is **not** proof of continuous ownership.

This is a worker-side safeguard, not synchronous on-chain epoch revocation. It
cannot invalidate an already-signed operation against the legacy contract if a
round trip occurs after the final check. Removing the wrapper does not erase that
limitation. A stronger original-NFT-compatible session design requires a separate
security review; do not claim the wrapper's stronger guarantee for this path.
This checkpoint does not expand session authority or weaken any existing guard.

## Frontend changes

The normal V2 Control Center now uses only its original-NFT roster, not the
experimental receipt profile section. `broker-v2-owner-refresh.js` reconciles
live owner-verified IDs every 30 seconds while visible and on focus/visibility
return, throttled to at most one read per 15 seconds. This involves read calls,
not signing, wrapping, onboarding or permission requests.

An unchanged roster does not reset chat, selection or drafts. A sale removes the
Punk from the seller's current controls and invalidates its open unsigned reviews.
New purchases appear even when the wallet stays connected. Owner/chain changes
discard late responses, including a wallet A → B → A change. An unavailable
ownership read hides controls and retries; it is not displayed as a verified zero
balance. Empty selections are broadcast to dependent controls. The existing
on-chain roster verifier can repair stale index candidates with a bounded scan.

The authenticated roster query keeps token-specific broker progression but joins
strategy only when `configured_by` and `intent.expectedOwner` match the buyer.
It no longer exposes a seller strategy through the token's old profile pointer.
Chat/profile/MCP remain owner-scoped; transaction routes independently verify
current on-chain ownership rather than trusting the displayed roster.

## Reproducible checks

```sh
forge test --offline --match-contract 'GoghOriginalPunkInheritanceTest|GoghPunkAgentAccountTest|GoghEpochAccountTest' --fuzz-runs 1024
node --test tests/art-broker-v2-owner-refresh.test.mjs tests/art-broker-v2-chat-authority.test.mjs tests/punk-agent-ownership-continuity.test.mjs
node scripts/test-original-punk-transfer-browser.mjs --local-only
node scripts/test-original-punk-transfer-fork.mjs --fork-read-only
```

The original-NFT contract fixture deploys no wrapper or receipt and proves native
ETH, NFTs, ERC20s, EntryPoint deposits, credits, learned level, rarity slots and
loadout persist across direct, safe and approved-operator transfers. Buyer control
is asserted before any buyer transaction. Seller and marketplace-operator account
access are rejected. Fixture burns also demonstrate why funded Punks must not be
burned: the parent loses its live owner and assets can become stranded.

The isolated full-page Chrome test exercises same-wallet purchases/sales, closed
stale reviews, buyer selection, loss of the final Punk, automatic recovery, and
desktop/mobile layout, with no wallet signing or public transaction.

Results for this checkpoint:

- Full JavaScript suite: **1,389 passed**, zero failures/skips. After the final
  empty-selection notification change, **66 targeted regressions** and the full
  isolated browser scenario were rerun and passed.
- Full Solidity suite: **219 passed** across 21 suites, zero failures/skips;
  fuzz cases ran 1,024 times. Formatting, compilation and ABI/EIP-170 checks passed.
- Site checks, 539-module JavaScript syntax check, and broker checks passed.
- Real-runtime original-NFT fork: passed with zero public transactions.
- Chrome desktop 1440px / mobile 390px: no horizontal overflow, no browser
  exceptions, zero wallet signing/writing requests. Screenshots were inspected.

No wallet bundle source changed. The prior clean-install wallet bundle remains
in use for site checks; this checkpoint does not repair the pre-existing broken
shared `node_modules` installation or claim a new clean-install bundle build.

No production deployment, real wrapping, burn, paid trading, main-branch push,
skill installation, key access or change to #93's mission is included.
