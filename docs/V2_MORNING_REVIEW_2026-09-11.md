# V2 and Forge morning review — September 11

The combined V2/Forge preview is working. The #93 mint-session fix is included.
The contract review package is prepared, but live Forge training is **not ready for
production**: its burn-backed credit source and parts of the durable transaction
service are unfinished. No public deployment or transaction was performed.

## Open these first

1. [V2 with the new Forge — visual preview](https://deploy-preview-47.preview.goghpunks.xyz/broker/v2/?preview=1&tab=forge).
   This uses clearly labelled simulated broker data. The Forge does not fabricate
   learned skills, credits or ownership evidence.
2. [V2 owner connection and research](https://deploy-preview-47.preview.goghpunks.xyz/broker/v2/?tab=forge).
   This is the PR review environment; owner sign-in and the configured research
   allowlist are still required for live diagnostics.
3. [Reviewed local Forge training — Test #44](http://127.0.0.1:64342/control-center?testPunk=44).
   The restored disposable chain has one practice credit, no learned skill and one
   starting slot. Learn Contract Detective, equip it, and try the inspection tool.
   The browser verification left this practice credit unspent. No MetaMask is needed.
4. [Draft PR #47](https://github.com/riffsmon-bit/gogh-punks-website/pull/47).

The local preview needs this computer and its server running. Restarting creates a
fresh disposable practice chain:

```sh
node scripts/dev/skill-forge/run-reviewed-control-center.mjs
```

## Changes in the candidate

The integrated app commit is `ae9dd3b`. It combines live source `0daf269`, the #93
fix and the latest original-NFT Forge source `22ba691` while retaining gas funding,
chat review reuse and collection/history behavior.

- #93's older-session mint no longer consumes its newer session's one-mint limit.
  Pending totals are also session-scoped; daily and per-opportunity protections
  continue to count across sessions. Activity shows why scouting candidates fail.
- The newer Forge and verified loadout display are mounted in V2. Original-NFT
  ownership changes refresh the roster automatically and clear seller-private
  reviews, including pending gas confirmations. Learning and equipping remain
  distinct, and research results do not grant economic authority.
- The preview previously passed the app gate but failed a live RPC canary read.
  Preview builds now retain the application gate without depending on that external
  read. Production retains its live research acceptance check.

Production is still on its existing release. **The #93 fix has not yet been
released to the live worker**, so this review does not claim that #93 has minted.

## Are all contracts deployed?

No. Fifteen recorded broker contracts are deployed, and every recorded runtime hash
matched on two public Robinhood RPC endpoints at canonical block **60,238,392**.
The existing collection runtime also matched. The audit covers the V1/V2/V3 wallet
and registry generations, policy modules, adapter/agent registries, mint adapters
and Punk Agent Account implementation/registry. It does not redeploy these accounts.

| Forge component | Current state | Deployment preparation |
| --- | --- | --- |
| `GoghSkillRegistry` | Undeployed; compiled and tested | Exact eight-call unsigned package and fee review, rehearsed on a disposable fork. Ends globally disabled with three TESTING skills. |
| `GoghReviewedSkillProgression` | Undeployed; compiled and tested; 8,080 runtime bytes | Source/build hashes and constructor plan prepared. Final calldata is withheld until a real registry and approved production training source exist. |
| Production burn-to-credit source | Unimplemented and unreviewed | Requirements documented; no mock source or zero-address substitute is presented as deployable production code. |
| `GoghSkillProgression`, `GoghRaritySkillProgression` | Tested base implementations | Inherited into the reviewed progression; separate deployments are not part of this plan. |
| `GoghForgeSupplyPolicy` | Tested internal library | No separate deployment. A future source must actually call it around sacrifice to enforce the 1,111 floor. |
| Wrapper/epoch proposal contracts | Superseded for this release | Excluded from deployment: ownership follows the original NFT. |

The production Forge manifest still has null registry/progression/training-source
addresses and both production authorization flags false. Local fork addresses and
receipt hashes are explicitly labelled as local and have not been copied into it.

## Prepared deployment package

- [Live contract audit](review/2026-09-11/contract-audit.json): all 15 recorded runtime
  hashes, both RPC observations and canonical anchor. Historic deployment receipts
  and explorer verification were not repeated by this current-code audit.
- [Forge build review](review/2026-09-11/forge-build-review.json): exact compiler
  settings, source hashes, artifact hashes, constructor input types and dependency
  plan. Runtime templates containing immutables are labelled separately from actual
  deployed runtime hashes.
- [Registry transaction and fee review](review/2026-09-11/registry-review.json): the
  selected administrator, pinned source/package bytes, eight exact unsigned calls,
  sequential nonces, predicted CREATE address, fee caps and successful local receipts.
  The fee ceiling is `feeReview.proposedMaximumTotalWei` in this file. This packet
  expires ten minutes after its anchor; refresh it for the actual signing window.
- [Browser evidence](review/2026-09-11/browser-check.json): hosted and local preview
  results, with no wallet actions, failed assets or browser exceptions.

To reproduce the read-only preparation from this branch:

```sh
npm ci
npm run contracts:check
node scripts/audit-v2-contract-deployments.mjs --live-readonly
node scripts/prepare-forge-build-review.mjs --review-only
node scripts/review-forge-selected-administrator.mjs --fork-readonly
```

The registry package is a concrete next deployment stage, not a complete training
launch. Its eight steps create the registry, disable it, then register and stage
Contract Detective, Rarity Eye and Market Scout as TESTING. All transaction values
are zero; fees still apply. No step grants a wallet permission or creates a credit.

The selected administrator remains `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.
Its existing MetaMask delegation was reproduced on the fork, but outstanding
off-chain signed permissions cannot be enumerated from an address inspection.
The existing [administrator review](v2-forge-administrator-review.md) explains what
was and was not established. This is not an independent audit or signing approval.

## Checks completed

| Check | Result |
| --- | --- |
| Full JavaScript suite | 1,600 passed; zero failed/skipped |
| Full contract check | 234 Solidity tests passed; formatting, build, high-severity lint, ABI and EIP-170 checks passed |
| Application deployment gate | Passed, including 127 deployment tests |
| Full V2 ownership browser integration | Passed desktop/mobile, purchase/sale refresh, stale gas/private-review clearing, profile failure recovery and delayed responses |
| Disposable contract profile integration | Passed learning/equipping, inherited loadout, seller rejection and zero buyer setup transactions |
| Hosted preview | Netlify published successfully; browser rendered the Forge at 1440px and 390px with no overflow or exceptions |
| Reviewed training preview | Browser rendered fresh Test #44 at both sizes; zero wallet actions |
| Registry rehearsal | Eight capped local transactions verified; zero public transactions |

Screenshots: [hosted desktop](review/2026-09-11/hosted-forge-desktop.png),
[hosted mobile](review/2026-09-11/hosted-forge-mobile.png),
[training desktop](review/2026-09-11/reviewed-training-desktop.png),
[training mobile](review/2026-09-11/reviewed-training-mobile.png).

## What still stands between this review and a full live Forge

The release target remains **Wednesday, September 16**. The unresolved items are
implementation and acceptance work, not merely a deployment switch:

1. Production training source and asset recovery. Burning an original Punk can
   strand assets in its persistent immutable accounts, including assets arriving
   later. A warning or an incomplete empty-wallet scan does not solve this. Funded
   #93 remains excluded from sacrifice.
2. Durable training finality, replaced/unknown nonce recovery and reservation
   release; native PostgreSQL concurrency/restart/role acceptance; production
   review/confirm/recovery endpoint and wallet integration.
3. Accepted registry packages and enforcement of equipped capabilities. The three
   research packages remain TESTING; no production READY skill is claimed.
4. Administrator permission-risk review, refreshed fees, deployment authorization
   and post-deployment receipt/code verification.
5. Controlled production acceptance of V2: release the #93 worker fix, verify real
   session usage and confirmed results, and complete the owner wallet journey.

The [September 16 release checklist](V2_RELEASE_TARGET_2026-09-16.md) tracks the
milestones. This morning package makes the current candidate and remaining work
reviewable; it does not label unfinished production training as complete.
