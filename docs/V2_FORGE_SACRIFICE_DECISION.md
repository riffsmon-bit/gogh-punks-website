# Credit-source decision: owner-approved literal burn

**September 12 implementation:** the [reviewed source checkpoint](v2-forge-reviewed-burn-source-checkpoint.md)
adds the contract candidate, unsigned individual-approval/burn reviews, Transfer-history
checks and receipt verification. Production deployment and wallet/lifecycle integration
remain pending; this does not enable a live burn.

**Local continuation:** the [burn-to-training practice checkpoint](v2-forge-burn-practice-checkpoint.md)
provides an isolated Test #7 → Test #44 review and confirmed local transactions.
It is a disposable fixture; the production gaps below remain.

**Latest owner direction, September 11, 2026:** an owner chooses one of their other
Punks to burn permanently to increase a selected Punk's skill. The user approves the
specific burn and checks the sacrificed Punk's wallets before confirmation. This
supersedes the earlier product decision to leave literal burns disabled indefinitely
while pursuing recovery. The recovery-vault alternative was not selected.

The requested flow is prepared below; it is not enabled in production. No real
burn, credit issuance, contract deployment or wallet transaction was performed.

**Deferred beyond the September 16 release.** The owner confirmed that training and
burns can follow reliable V2 minting and Forge research/loadouts. This proposal is
retained for that later work; it is not a pending approval blocking V2 minting.

The tested learning/equipping flow can be completed independently. This decision
defines the later original-Punk credit source and irreversible confirmation.

## Required owner flow

1. Select the source Punk to burn and a different, currently owned recipient Punk.
   Display both token IDs and images throughout review. Select the recipient skill
   and display its current and resulting level and exact credit cost before signing.
2. Show the source's V1/V2/V3 Punk Wallets and Agent Account, including undeployed
   deterministic addresses. Display native ETH, WETH/ERC20s, NFTs, EntryPoint gas
   deposits, inventory freshness and any unknown holdings. Zero ETH is not an empty
   wallet. Provide existing withdrawal/recovery actions before confirmation.
3. Stop source missions, revoke remaining sessions, resolve pending transactions
   and marketplace offers, withdraw known assets, then refresh owner and balance
   checks. Explain that unindexed assets and future deposits may still be lost;
   never promise that an inventory proves all possible balances are empty.
4. Require the owner to type `BURN <source ID>` and acknowledge permanent NFT loss
   and loss of access to its token-bound accounts. This review is separate from
   ordinary mint/gas/skill confirmations. A chat instruction cannot submit a burn.
5. The eventual transaction must enforce current ownership of both Punks, distinct
   IDs, source existence, the existing 1,111 supply floor and exactly-once crediting.
   Burn and credit issuance must succeed atomically; an already burned/nonexistent
   ID cannot mint a credit. A skill upgrade must be tied to the reviewed recipient
   and skill through the existing reviewed training boundary.
6. Confirm the canonical burn and credit/upgrade receipt before changing displayed
   skill state. Clear source missions and owner selections, retain its public
   burned history, and keep the receiving Punk active. Handle failed or reorganized
   receipts without optimistic credits.

The standalone burn-warning component now names both Punks, explains account access
loss, and links to per-wallet review callbacks. Public mounting, source contract,
owner-signed burn execution and receipt integration are still unfinished.

## Constraint in the deployed accounts

`GoghPunkAccountV1.owner()` returns zero when the original collection's `ownerOf`
reverts; V2/V3 inherit this ownership path. `GoghPunkAgentAccount.owner()` behaves
the same way. Burning that original token removes the account's owner-based asset
recovery caller. Account addresses persist and may receive assets later.

No off-chain empty-wallet check changes that immutable owner function or prevents
future deposits. The accepted literal-burn design must disclose this loss of access;
it must not claim that the wallet contract is destroyed or assets migrate to the
training Punk. A warning/signature does not implement post-burn recovery.

The [ERC-6551 specification](https://eips.ethereum.org/EIPS/eip-6551) binds account
identity permanently to its parent NFT. The actual loss-of-owner behavior above
comes from this repository's account implementations.

## Deferred alternative: permanent retirement with recovery

1. The current owner selects a sacrifice and a distinct, still-active training Punk.
2. Both must be owned by that caller at the same transaction boundary. The sacrifice
   moves into an immutable retirement vault and is permanently marked consumed.
3. No transferable receipt or wrapper token is issued. There is no NFT withdrawal,
   approval, administrator escape or upgrade path that can return the sacrifice to
   circulation. The training Punk remains its original NFT with ordinary transfers.
4. Exactly one credit is issued atomically to the selected training Punk. A sacrifice
   can never be credited twice. Its old economic sessions are invalidated by the
   ownership change; permanent skill state stays on the selected original token.
5. A fixed recovery beneficiary retains access to the retired Punk's canonical
   accounts through the vault's owner authority. Recovery must be narrowly bound
   to those accounts, preserve the NFT lock and never grant access to another Punk.
6. The Forge checks `collection.totalSupply() - retiredCount > 1111` before accepting
   another sacrifice and verifies the resulting available supply afterwards.

This is **retirement, not an ERC721 burn**. The original collection's `totalSupply`
does not decrease for vault deposits; the interface and marketplace documentation
must distinguish minted/existing supply from available supply. Direct burns through
the original collection remain outside the Forge's control.

The alternative is a proposal, not implemented or authorized. It requires a new
reviewed source/progression credit boundary, recovery/reentrancy tests, pinned
account runtimes, and an explicit rule for who remains the recovery beneficiary.
The current burn-only `awardTrainingCredit` must not silently accept a vault-held
token. No manifest or transaction authority changes merely from this document.

## Current implementation state

Prepare the owner-reviewed literal-burn flow described above. The account-loss
consequence is accepted as a product direction; a recovery vault is not required
by the latest instruction. Production sacrifice/credit issuance remains disabled
because the source and transaction integration are unfinished. Do not claim the
credit economy is live or turn a warning checkbox into a burn implementation.

No real Punk, asset, approval or production setting was changed for this proposal.
