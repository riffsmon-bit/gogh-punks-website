# Optional paid Training Credits — independent security review

Date: 22 September 2026. Scope: local additive implementation in
`/private/tmp/gogh-paid-training`; no deployment, external mutation, wallet
signature, payment, or production enablement is covered by this review.

Status: design and implementation independently reviewed. No open P0/P1 finding
was identified in the disabled implementation reviewed here. The contract,
backend, and UI authors addressed the concrete findings below. This document is
not an approval to deploy contracts, unpause purchases, or enable payments.

## Required boundaries

The fixed price is 500000000000000 wei per credit. The fixed treasury is
`0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6`. Purchased credits must remain
separate from the existing sacrifice credit ledger. Buying a credit does not
learn or equip a skill and grants no economic permission. The release starts
UNDEPLOYED, and the contract starts with purchasing paused.

No P0 design issue was identified. The following P1 release risks were raised
during review and are now handled in the supported implementation:

1. **Canonical loadout adoption.** Before activation, the extension preserves
   legacy equipment views. After activation, every capability consumer must use
   extension equipment exclusively. Current legacy consumers include
   `original-punk-profile.mjs`, `training-state.mjs`,
   `broker-v2-forge-skill.mjs`, and `v2-mcp-research.mjs`; persistent watch uses
   the latter. An extension read failure must fail closed. Do not OR masks or
   fall back to legacy. Existing legacy equip/unequip actions must not claim to
   modify the effective activated loadout.
2. **No duplicate spending through the legacy flow.** The extension can reject
   paid learning when legacy learning already exists. The immutable legacy
   contract cannot recognize the reverse case. Supported legacy training UI/API
   must prevent a second credit spend for a skill already learned in the paid
   extension. Do not advertise cross-ledger duplicate prevention as an invariant
   of both immutable contracts: a knowledgeable holder can call the legacy
   contract directly. Never merge the two credit balances into one spendable
   balance, import old credits, or count one old credit twice.
3. **Release must establish usable paid value.** An address, an environment
   switch, or a passing contract test alone is insufficient. Payment remains
   unavailable until runtime/immutable pins, reviewed usable skill definitions,
   canonical reader adoption, and deployment review are established. All
   unverified states must hide/disable purchase and avoid transaction preparation.

Implementation evidence: `paid-canonical.mjs` selects the extension exclusively
after activation; all four named readers and the legacy training coordinator now
use that boundary. Its reads accept any verified current owner, independent of
the purchase allowlist, and combine snapshots at a common canonical anchor.
`guardLegacyPaidAction` prevents duplicate paid learning, obsolete legacy
equipment actions, and unlock spending when canonical capacity is already seven.
The corresponding old UI controls are hidden or disabled. The paid panel restores
the existing equipped-research action after activation.

`validatePaidRelease` requires exact reviewed deployment pins and explicit
canonical-reader/payment authorization for a live release. The committed server
and browser artifacts match and remain UNDEPLOYED, with both authorization
booleans false. No environment variable can enable this artifact.

## Ownership and transaction review

`ownerOf` plus a per-token review nonce/state hash does not detect a transfer away
and back to the same address when no progression mutation occurred. The new
contract does not grant an ownership epoch. Reuse the existing inclusive Transfer
log scan, canonical anchor recheck, and owner-origination continuity immediately
before a wallet attempt. Explicitly retain the residual gap between that check
and on-chain inclusion; do not claim on-chain round-trip invalidation. Backend
continuity checks and the wallet's inclusive Transfer scan/canonical closing-head
recheck implement this boundary. A contract test explicitly demonstrates the
remaining same-owner round-trip limitation rather than asserting a false epoch.

Reviews must bind chain, owner, token, extension, exact value, exact calldata,
nonce, state hash, short deadline, and fee bounds. Pending wallet nonce must not
already differ. A marker must be persisted before the wallet request. Lost
results, an unknown hash, request timeout, expiry, or a reverted receipt must not
automatically trigger another submission. Recovery verifies the original exact
transaction and canonical receipt through two providers. L2 inclusion is not
finality. An unknown attempt can be closed only after both providers establish a
common finalized block beyond the deadline, unchanged contract review nonce, and
unchanged latest/pending wallet nonce. A release pause permits original receipt
recovery while denying new payment reviews.

## Contract findings verified in source

- Payment is exact, creates one credit, and forwards the exact amount only to
  the immutable treasury; failure rolls back credit, nonce, and all state.
- The treasury callback cannot reenter any holder mutation. Post-callback checks
  revalidate owner, runtime, legacy state, registry controls, and remaining usable
  credit capacity; a treasury callback cannot leave a credit immediately unusable
  by disabling its sole available skill during payment.
- The review state binds relevant legacy mutations, incoming legacy credits,
  allocation, slots, canonical activation, paid credits, and paid mutation nonce.
- Activation rejects copied equipment outside the pinned safe read-only set;
  after activation, effective capabilities cannot introduce financial bits.
- Paid unlock requires the existing rarity allocation, respects a total cap of
  seven despite later legacy changes, and never consumes legacy credit.
- Registry pause/disable/deprecation continues to remove effective capabilities.
- Purchase pause must not prevent recovery or ordinary management of credits
  and equipment already held.
- BUY rejects a token-specific or owner-wide approval to the immutable legacy
  training source, both before and after the treasury callback. Backend and UI
  expose the same typed approval check and require revocation before purchase.
  The supported selected-sacrifice flow reads unspent purchased credits through
  both providers during preparation and again before its wallet-request claim.
  It fails closed if credits remain or the extension cannot be verified.

The purchase cap counts only currently available unlearned approved skills and
remaining slots after the existing rarity allocation. This prevents repeated
sales of credits beyond current uses. It is not a promise that governance will
keep every skill available forever. The UI discloses the absence of a refund
function, the fixed treasury, the exact credit price, and the separate fee bound.

## Remaining deployment gates and residual limits

- The contract has not been deployed or exercised with a live owner wallet in
  this work. Verify deployed runtime and immutable pins, the exact skill allowlist,
  treasury, guardian, initial purchase pause, and reviewed registry state before
  enabling any live release. The default artifact remains disabled.
- Every paid skill must also exist with matching key/manifest/instruction pins
  in the holder training release. Current artifacts contain the same Rarity Eye
  package. `assertPaidSkillCoverage` now enforces these pins in both deployed
  runtime configuration and canonical-reader configuration, so a paid catalog
  cannot grow independently of usable holder tools.
- The original NFT has no ownership epoch. An away-and-back transfer after the
  last off-chain check can revive an otherwise unchanged review until its short
  deadline. The extension creates no delegated execution authority.
- An owner who bypasses the supported UI/API can still waste a legacy credit by
  directly learning an already-paid skill or unlocking a legacy slot when the
  combined capacity is full. Neither behavior imports a credit, produces a second
  capability, or permits spending someone else's credit.
- The immutable legacy burn contract cannot observe this new ledger. A holder
  can deliberately approve and call it after a purchase, stranding remaining
  token-bound credits. The approval guard and supported sacrifice checks close
  the supported-flow interaction; they are not universal on-chain burn prevention.
- Browser attempt persistence is local. Receipt recovery requires the original
  review and transaction hash; provider outage, state uncertainty, and lost wallet
  results retain the attempt rather than permit automatic resubmission.

## Evidence and limits

Design source: `paid-training-implementation.md`. New contract, backend coordinator,
canonical reader integration, API boundary, browser artifact, wallet adapter, paid
panel, and legacy panel were read independently. Existing immutable progression,
registry, continuity, and receipt implementations were also inspected.

Independent local checks performed by the reviewer:

- Final targeted reviewer run:
  `node --test tests/paid-training.test.mjs tests/forge-paid-wallet.test.mjs tests/forge-paid-panel.test.mjs`:
  43 passed, zero failed (including closing-head reorg, finalized unused recovery,
  paid skill release coverage, canonical loadout selection, and restored research
  access after activation). This replaces the earlier 30-test reviewer run.
- After the late sacrifice-approval addition, a targeted reviewer run selecting
  `burn|sacrifice` across the same three files passed all four added checks: blocked
  and malformed approval states, actionable UI guidance, blocked purchase, and
  source-credit protection with extension failure handling.
- A separate smoke script verified exact browser/server artifact equality,
  zero session/database/RPC dependency calls from UNDEPLOYED GET/POST (throwing
  traps), all six backend/browser calldata encoders, and the disabled purchase gate.
- A separate composition script gave the legacy reader mask 1 and extension
  reader mask 8. Before activation it returned exact legacy state; after activation
  and during PAUSED it returned mask 8, never 9. It preserved separate credit
  balances and rejected an extension RPC error without legacy fallback.

Tests supplement source review; they do not establish deployed state, wallet
acceptance, or permission to charge a user. Final build/full-suite and rendered
browser evidence are owned by the integrating agent and implementation authors.

Focused receipt/API review verified exact transaction hash, sender, target, chain,
transaction type, calldata, value, nonce, gas and fee identity; receipt/transaction
block binding; pinned runtime; the exact applied token/nonce/operation event;
canonical receipt and anchor checks; and agreement between independent providers.
The API verifies session/Punk identity and POST origin and returns sanitized
messages on release/RPC failure. Additional malformed-response checks for receipt
gas fields, log ordering, and explicit returned block numbers were suggested as
P2 defensive improvements, implemented by the backend author, and re-reviewed;
those suggestions are closed.

Author-run evidence independently inspected: the final Chrome 150 result at
`/private/tmp/gogh-paid-browser-evidence-Biph01/result.json` is PASS, with 24
screenshots at desktop/mobile widths, zero exceptions and zero external requests.
It includes the blocked sacrifice approval state and all six paid operations.
The API/provider were synthetic; this is rendered application acceptance, not a
live payment or wallet test. See `paid-training-browser-acceptance.md`.

Contract author reported the complete Foundry suite at 342/342 across 31 suites
before the final isolated approval guard; the final paid-contract suite then
passed 36/36, including all four added approval cases and 256 transfer-fuzz runs.
No failures or skips were reported. These are attributed author results; the
reviewer independently inspected the contract and the explicit residual and
callback tests, but did not repeat the complete Foundry compilation.
