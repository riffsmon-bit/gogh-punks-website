# Connected Forge deployment and test checkpoint — September 12

**Live wallet interaction:** use the [owner-wallet test page instructions](V2_FORGE_OWNER_WALLET_TEST.md)
to send the two setup transactions from the selected wallet. The page is available
at http://127.0.0.1:64345/ and preserves deployment requests across restarts.

Burn-to-training is required for the September 16 launch. The contract stack is
built and connected in the test app. Production deployment is still pending the
owner’s wallet transactions; neither production manifest contains live Forge
addresses yet.

## Contracts and deployment behavior

| Contract | Purpose | Runtime bytes |
| --- | --- | --- |
| `GoghSkillRegistry` | Versioned skills, guardian control and emergency pause | 3175 |
| `GoghReviewedSkillProgression` | Original-NFT credits, rarity slots, learning and loadouts | 8,080 |
| `GoghReviewedBurnSource` | Exact individual-NFT approval, reviewed burn and one atomic recipient credit | 4,550 |
| `GoghForgeDeployment` | Creates and connects the three contracts in one transaction | 267 |

The deployment constructor checks the chain, original collection runtime, guardian
and rarity pins. It creates the registry paused with every capability disabled,
creates the source and progression, binds the source once, and nominates the
selected guardian. The guardian then accepts registry ownership in a separate
transaction. The deployment record exposes only three address getters and has no
call, withdrawal, upgrade or administrative entry point. Deployment and registry
acceptance neither approve nor burn a Punk, issue credits, nor activate skills.

The initializer plus constructor arguments is below the EIP-3860 limit; each
contract is below the EIP-170 runtime limit. The collection and accounts already
in production retain their existing code.

## Prepared owner transactions

The selected registry administrator remains
`0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. The prepared packet contains:

1. **DEPLOY_PAUSED_FORGE:** zero-value contract creation for the complete stack.
2. **ACCEPT_REGISTRY_OWNERSHIP:** zero-value `acceptOwnership()` at the predicted
   registry, from that same administrator at the next wallet nonce.

Both public RPC endpoints simulated the creation successfully on September 12.
The recorded estimate was 3,854,390 gas, with a proposed creation limit of
5,781,585 gas and a 100,000-gas reservation for acceptance. At the recorded maximum
fee of 184,436,000 wei/gas, the two-transaction ceiling was
**0.00108477601106 ETH**. This is a historical quote. Acceptance must be simulated
after the actual creation; it was not publicly simulated against an undeployed
address. Fee limits, nonces, code and simulation must be refreshed before signing.

The public preflight observed the same existing EIP-7702 delegate on both RPCs;
this does not constitute an independent audit of the wallet delegate. No
delegation authorization list is included in either prepared transaction.

```sh
npm run contracts:check
node scripts/prepare-forge-deployment.mjs --live-readonly > /private/tmp/gogh-forge-deployment-review.json
```

The preparation command only reads/simulates. It reads the selected administrator
from the existing selection record, verifies the frozen source/build hashes,
compares both RPCs, checks funds/nonces and vacant predicted addresses, and
produces a ten-minute review. It has no key loader, signer or sender. An expired
unsigned review must be refreshed before requesting the wallet. An already-requested
deployment can be recovered even if its exact receipt arrives after that review
expires. Registry acceptance receives its own fresh review. A lost response must be
recovered by its original nonce/hash; do not blindly deploy again.

After the owner signs both exact transactions, verify their actual hashes:

```sh
node scripts/verify-forge-deployment.mjs --live-readonly \
  --plan=/private/tmp/gogh-forge-deployment-review.json \
  --transactions=DEPLOY_HASH,ACCEPT_HASH
```

Replace the two hash placeholders with the full transaction hashes. The verifier
requires matching finalized evidence from PublicNode and Robinhood, exact
transactions and fee bounds, canonical blocks, the complete runtime bytecode
including every immutable reference, both-way source/progression bindings,
guardian ownership, frozen rarity pins, an empty registry and the pause state.
It produces reviewed file contents for `robinhood-skill-forge.json`
(`READ_ONLY_CANARY`) and `robinhood-forge-training.json` (`PAUSED`). It does not
write or activate them. No local/fork address may be adopted as a public deployment.

The [recorded deployment review](review/2026-09-12/atomic-forge/public-deployment-review.json)
contains the full unsigned bytes and predicted addresses. It must be regenerated
after expiry or any owner nonce change.

## Application wiring and testing

A fresh instance is available at http://127.0.0.1:64344/burn-practice. This is a
separate disposable chain; the existing port 64343 session stays intact.

New burn-practice instances now deploy the atomic stack and call the actual
`GoghReviewedBurnSource` through the production unsigned preparation and receipt
library. The typed confirmation and separate learning/equipping UI exercise those
contracts. Test-only registry activation and mock wallet inspection remain confined
to each newly owned Anvil. The existing practice process on port 64343 was not
restarted; its Test #44 retains two slots, no learned skill and zero credits.

The local stack test covers deployment receipt/code corruption, manifest rejection
of local evidence, source/recipient transfer checks, approval, burn, one credit,
learning, equipping, unequipping and the actual loadout reader. The browser checks
cover 1440-, 390- and 375-pixel layouts, both Punk images/IDs, cancellation, typed
confirmation, a missing receipt, reload without resend and separate learning.

```sh
node scripts/test-reviewed-burn-local.mjs --local-only
node scripts/test-burn-practice-local.mjs --local-only
node scripts/test-burn-practice-browser.mjs --local-only
node scripts/test-forge-stack-fork.mjs --fork-readonly
```

The final command creates its own loopback Anvil fork, then tests COPIES of original
Punks #93 and #94. Its public client only reads. Its local transactions do not
burn the actual NFTs or establish public deployment receipts. The production
collection has no synchronous ownership-epoch hook; recipient round trips remain
a mandatory client Transfer-history check, not an on-chain epoch guarantee.

Verification completed: 1,755 JavaScript tests, 267 Solidity tests (1,024 fuzz
runs where applicable), 127 deployment checks, the local stack and browser
journeys, and the actual-collection fork all passed. The final syntax check passed
after adding the fork harness.

## Remaining launch work

Production burn execution remains closed until source wallet inventory/recovery,
mission/session shutdown, durable approval and burn intents, shared token/nonce
holds, finalized receipt recovery and source lifecycle cleanup are connected and
accepted. The existing training intent service still requires its restricted
production database roles and rollout. Skills require their reviewed registry
configuration before activation. Approval has no on-chain expiry, so an unknown
approval cannot be released merely when a review timer expires.

The [live owner guide](LIVE_OWNER_TEST_GUIDE_2026-09-16.md) makes burn-to-training a
required launch case. Its production cases remain unexecuted. Contract/local
success does not mark the complete launch accepted.
