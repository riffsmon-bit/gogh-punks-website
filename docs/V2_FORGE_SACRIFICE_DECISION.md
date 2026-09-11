# Credit-source decision: permanent retirement or literal burn

The tested learning/equipping flow can be completed independently of this choice.
The choice affects how a real original Punk earns a training credit.

## Constraint in the deployed accounts

`GoghPunkAccountV1.owner()` returns zero when the original collection's `ownerOf`
reverts; V2/V3 inherit this ownership path. `GoghPunkAgentAccount.owner()` behaves
the same way. Burning that original token removes the account's owner-based asset
recovery caller. Account addresses persist and may receive assets later.

No off-chain empty-wallet check can change that immutable owner function or prevent
arbitrary future deposits. A warning, signature or empty native balance does not
implement post-burn recovery. This is why a production credit source cannot safely
be produced by replacing a mock burn call with the collection's real burn call.

## Concrete alternative for approval: permanent retirement with recovery

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

## If literal burns are retained

Keep production sacrifice/credit issuance disabled while a different account recovery
architecture is designed and accepted. Continue shipping the research interface and
training/recovery coordinator, but do not claim the full credit economy is live.

No real Punk, asset, approval or production setting was changed for this proposal.
