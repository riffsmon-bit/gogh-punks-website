# Optional paid Training Credits — implementation contract

Owner decision: 22 September 2026. One credit costs **0.0005 ETH**
(`500000000000000` wei). Treasury:
`0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.

This is additive to the existing sacrifice route. No deployed contract is
replaced, no credit is imported, and no production transaction is authorized by
this document. The release artifact starts UNDEPLOYED; purchasing starts paused.

## Shared boundary

New contract: `GoghPaidSkillTraining`. Immutable collection, registry, legacy
`GoghReviewedSkillProgression`, treasury, and reviewed skill-key allowlist.
Constant price: 500000000000000 wei. Allowed capabilities: read-only mask 205
(CONTRACT_READ, MARKET_READ, RARITY_READ, ART_CLASSIFY, SOCIAL_READ). Only
zero-prerequisite, risk-tier-zero definitions may be learned through this release.

Operations in this order: BUY=0, ACTIVATE=1, LEARN=2, UNLOCK=3, EQUIP=4,
UNEQUIP=5. `applyReview((uint256 tokenId,uint8 operation,bytes32 skillKey,
uint8 slot,uint256 nonce,bytes32 stateHash,uint64 deadline))` is the only holder
mutation route. BUY has exact price value; other operations require zero value.
Nonce and state hash are checked on chain, deadline is at most 60 seconds ahead.
Current `ownerOf` is checked for every mutation. No server signer is introduced.

Views: `collection`, `registry`, `legacyProgression`, `treasury`, `creditPriceWei`,
`purchasesPaused`, `activated(tokenId)`, `purchasedCredits(tokenId)`,
`reviewNonce(tokenId)`, `reviewStateHash(tokenId)`, `learnedLevel(tokenId,key)`,
`unlockedSlots(tokenId)`, `equipped(tokenId,slot)`,
`effectiveCapabilities(tokenId)`, `allowedSkill(key)`.
Event: `PaidTrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,
uint8 operation)` (the enum has uint8 ABI encoding).

BUY creates exactly one credit atomically and forwards the exact payment to the
fixed treasury; failed transfer reverts everything. Protect external calls from
reentrancy. No arbitrary treasury change, administrative credit issuance or
withdrawal authority. A purchase is not a skill, an equipped skill, or execution
permission. A successful purchase has no refund function in this initial
implementation; disclose that before purchase. Contract deployment and release
review must confirm this policy before any payment is enabled.

Burn credits remain in the old ledger and purchased credits in the new ledger.
Never add balances together as a spendable amount. Purchased learning recognizes
legacy learning and rejects duplicates. A paid prerequisite cannot satisfy an
immutable old contract's prerequisite; this release excludes dependent skills.

ACTIVATE explicitly adopts one canonical loadout. Before activation, all equipment
views delegate to legacy. Activation copies the bounded legacy loadout; after it,
only extension equipment grants capabilities. Never OR the two masks, and never
fall back to legacy after an extension read error. Legacy slot allocation plus
paid extra slots is capped at seven. Paid slot unlock requires the legacy rarity
allocation to have been claimed. Credits, skills and equipment follow tokenId;
authority follows current owner. This grants no automation authority or epoch.

## Backend / browser contract

Dedicated `/api/v2/punks/:tokenId/forge/paid-training`, never loosen the existing
zero-value burn/training journal. GET returns release status and, only for a
verified release/session/owner, anchored state. POST `prepare` takes exactly
`{operation:'prepare',action:{operation,skillKey,slot}}`; `verify` takes
`{operation:'verify',review}`; `recover` takes
`{operation:'recover',review,transactionHash}`; `abandon` takes
`{operation:'abandon',review}`. Server reconstructs calldata from
validated typed fields, pins chain/code/treasury/price, checks ownership, simulates,
checks pending nonce, bounds fees, and verifies receipts. It never sends.

Review schema `GOGH_PAID_TRAINING_REVIEW_V1`: chainId, collection, registry,
legacyProgression, extension, extensionCodeHash, treasury, priceWei, owner,
tokenId, action, guard {nonce,stateHash,deadline}, anchor {number,hash,timestamp},
transaction {from,to,data,value,chainId,nonce,gas,maxFeePerGas,maxPriorityFeePerGas}.
All quantities inside transaction are hex strings; all chain quantities elsewhere
are decimal strings. `action.operation` is lower-case name. `action.skillKey` is
zero bytes32 except learn/equip; `action.slot` is zero except equip/unequip.

The client persists a wallet-attempt marker before eth_sendTransaction, validates
the exact server review, requires matching wallet/chain, and never automatically
resends. Lost results use original hash recovery. A failed/unknown receipt is not
permission to send again. Expiry means the original exact review cannot execute;
prepare a new review only after explicitly abandoning/reconciling the old one.
Abandonment requires two distinct provider clients to agree on a canonical
finalized block beyond the deadline, an unused review nonce at finalized and
latest state, and unchanged latest/pending wallet nonce. Browser time alone
cannot clear an unknown attempt.

Purchasing is blocked while the Punk has a token-specific or owner-wide approval
to the legacy burn source. The supported sacrifice path checks for unspent paid
credits through both providers at preparation and again before the wallet claim.
Neither check changes the immutable old contract: direct custom burns can still
strand remaining purchased credits.

An UNDEPLOYED release exposes price/help only, never a purchase button or RPC call.
Live registration, safe capability activation, deployment code hashes, canonical
reader adoption throughout APIs, owner-reviewed contract deployment, and wallet
acceptance remain release gates. No production enablement by environment flag alone.

The initial artifact matches the actual holder release: Rarity Eye only. The
constructor allowlist is immutable. If the intended launch catalog includes the
other six reviewed read-only skills, register and verify those definitions first,
then finalize the constructor list and matching holder package pins before
deployment. Do not sell credits against an unregistered or unusable catalog.

## Scope ownership

- Contract agent: new contract and new Foundry tests only; no deployed Solidity edits.
- UI agent: `site/forge-paid-*`, existing Forge mount/HTML additions, browser tests.
- Root: dedicated backend modules/API, release artifact, integration and docs.
- Reviewer: independent read-only review and regression findings.

Minimum checks: under/overpayment, wrong owner/chain, replay, expiry, pause,
reentrancy, failed treasury, exact credit issuance, duplicate learning, transfer,
canonical equipment, slot cap, rejected financial skill, simulated payment,
receipt identity/finality, lost result/recovery and mobile/disconnected states.
