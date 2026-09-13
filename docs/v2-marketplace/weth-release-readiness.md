# WETH release readiness and ETH purchase-guard proposal

Reviewed September 13, 2026, against merged PR69 (`1063614`). Scope: existing marketplace contracts/interfaces, previous copied-chain and independent-review evidence, original-Punk transfer semantics, and current official OpenSea/Seaport documentation. This increment changes only new review, proposal and regression files.

**Public WETH verdict: NOT_READY.** The existing copied offer lifecycle works, but strict invalidation after a Punk transfer is not enforced by this escrow. OpenSea acceptance of its custom restricted-zone orders is also unverified. Neither a free RPC service nor a deployment flag resolves these conditions. Public WETH creation must remain blocked.

**ETH purchase guard: exact offline proposal prepared for review.** No deployment, public transaction, order publication, refund or wallet request was made. Live deployment nonce, gas, fee ceiling and receipt remain pending. The proposal does not enable marketplace purchases or change existing Agent permissions.

## Existing implementation and remaining gates

| Surface | Verified implementation | Public gate |
| --- | --- | --- |
| Exact ETH purchase / up to five selected listings | Existing normalizer, policy/screen callbacks, simulation, owner `executeBatch`, atomic reserve/state/NFT postcondition guard and receipt reconciliation | Deploy and independently pin the reviewed guard; complete authenticated journal/UI and real skill/policy integration. Selected listings are not a verified collection floor. |
| Exact WETH offer | Candidate owner-funded escrow wraps the exact price, fixes the canonical Agent recipient, permits one exact order, and checks pre/post settlement | Transfer-continuity guarantee and OpenSea orderbook acceptance unresolved; no public deployment proposed. |
| Collection WETH offer | Existing copied Seaport test resolves one ERC721 token under collection-wide criteria | Same blockers; not a trait/Merkle-subset offer or unrestricted collection support. |
| Cancellation/recovery | Original funder can recover unspent escrow WETH after transfer/burn; terminal cancellation is idempotent | Controlled evidence only. This review submits no cancellation or refund. |

The earlier [source audit](source-and-security-audit.md), [independent security review](independent-security-review.md), [repaired copied-chain proof](disposable-repair-evidence.json), [practice review](practice-independent-review.md), and [browser evidence](practice-final-browser-evidence.json) were inspected. Their reported real-Seaport and browser runs are retained as prior evidence, not relabelled as new independent runs.

## Exact transfer counterexample

The candidate in `contracts/src/GoghPunkMarketplaceBid.sol` authenticates current `ownerOf(punkId)`, registry/recipient identity and runtime, bid status, nonce-derived identity, Seaport counter, funding and expiry. The original NFT does not update the escrow when it transfers. A transfer from Alice to Bob and back to Alice can restore every input used by these checks while the original bid remains active.

`contracts/test/GoghWethReleaseReadiness.t.sol` executes the **actual candidate escrow** with explicitly local NFT, registry, WETH and protocol fixtures. Two small owner contracts call transfers as their current owner; no operator approval is reused across transfers. One test transaction performs:

1. Alice funds the original offer. Its exact digest passes ERC1271.
2. Alice transfers #93 to Bob. The same digest fails and the protocol's zone authorization reverts.
3. Bob returns #93 to Alice. The complete bid tuple, internally generated order, digest mapping, funder nonce, Seaport counter, current owner, registry recipient, all checked runtime hashes, WETH balance/allowance, block number and timestamp match the pre-transfer snapshot.
4. The original digest passes again. Both zone callbacks permit settlement; the original funding pays the seller exactly once and the NFT reaches the fixed recipient.

The same result holds for exact-item and collection bids, including a deadline only **one second** after creation. A self-transfer also leaves the old offer usable. A separate positive control explicitly cancels while Bob owns the Punk: cancellation stays terminal after return and a repeated local cancellation pays no second refund.

These five tests characterize the blocker; passing them does **not** make the design transfer-safe. The dependency model is not the full original collection, deployed account or Seaport. It makes the missing contract signal precise, including the lack of an interleaving watcher transaction. The existing real-Seaport copied-chain proof separately demonstrates the original collection's away-and-back revival and rejection while another owner holds it. Neither proof is a public orderbook test.

## Why the current interfaces cannot supply strict invalidation

This conclusion is scoped to the current original-NFT/account semantics and the candidate's permitted interfaces, not a claim that every conceivable alternative protocol is impossible.

| Suggested signal | Limitation |
| --- | --- |
| Current `ownerOf`, canonical account, balance, runtime | These values can all be restored after a round trip. Current ownership correctly rejects Bob while he holds the Punk, but does not prove uninterrupted ownership by Alice. |
| Agent `state()` / bid nonce / Seaport counter | They change only when the relevant contract executes its own transition. A direct original-NFT transfer does not automatically advance them. |
| Transfer-log watcher / archive read / automatic cancellation job | Useful before preparation and submission, but asynchronous. It cannot write a cancellation between calls inside another transaction. Successful preflight is not an atomic transfer hook. |
| Very short deadline | Bounds duration, not ownership continuity. The one-second regression still fills before expiry. |
| ERC1271 alone | Seaport can cache validation; later fulfillment need not call the signature validator again. The restricted-zone checks remain necessary. |
| Existing collection transfer validator | The ERC721 interface invoked by the inherited transfer hook is `external view`. It cannot store an epoch through that static call. Changing its configuration to restrict transfers would be a separate ownership/marketplace semantics change. |
| Token-specific NFT approval as a sentinel | A transfer clears an approval, so it could supply a different consent mechanism. It is absent here, would add NFT approval/setup authority, and later reapproval to the same sentinel can restore the old condition. It is not an irreversible epoch and has not been designed or authorized in this release. |
| Internal ERC721A ownership timestamp | It is not exposed through the audited original contract's callable ownership interface. A timestamp also cannot distinguish multiple transfers sharing a block timestamp. No unexposed storage read is assumed. |

The original source was re-read at `gogh-punks/src/GoghPunksOnchain.sol`, its inherited `ERC721ContractMetadata.sol` and `interfaces/ITransferValidator.sol` in the adjacent original-collection repository. `STATICCALL` forbids state writes throughout its subcalls. [EIP-214](https://eips.ethereum.org/EIPS/eip-214). The [existing original-NFT audit](../punk-original-nft-inheritance.md) records the code pin and unavailable public ownership-history methods.

The [wrapper/epoch document](../punk-transfer-epoch-implementation.md) is explicitly **SUPERSEDED AS THE PRODUCT PATH**. Escrowing the original and selling a wrapper receipt would change the required ownership key and marketplace asset. It is not revived by this review. No mutable transfer hook, validator restriction, wrapper enrollment, arbitrary account module or relaxed signing permission is introduced.

An alternative continuity/consent design needs a separate concrete review and explicit approval of any changed permissions or ownership behavior. Until then, the supported public transaction construction remains disabled; there is no watcher-based override.

## Current official OpenSea / Seaport findings

Sources were opened directly on September 13, 2026; no order or offer-building API POST was made.

| Official source | What it establishes | What it does not establish |
| --- | --- | --- |
| [OpenSea Robinhood Chain overview](https://learn.opensea.io/learn/blockchain/what-is-robinhood-chain) | OpenSea supports Robinhood NFT marketplace activity, including offers. | Acceptance of this particular escrow/zone or WETH order shape. |
| [Create an item offer](https://docs.opensea.io/reference/post_offer) | Authenticated order submission requires chain/protocol, order parameters, protocol address and signature. | That a known ERC1271 digest with this custom zone can be indexed and fulfilled through OpenSea. A documented POST endpoint is not an acceptance result. |
| [Build a criteria offer](https://docs.opensea.io/reference/build_offer_v2) | OpenSea supplies consideration, zone and zone-hash data for its criteria-offer path; criteria handling varies by collection. | That replacing those fields with our internally fixed zone/zero root is supported. |
| [Seaport zone interface](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ZoneInterface.sol) | Authorization occurs before transfers; validation occurs after transfers. | Public orderbook acceptance. These are protocol hooks. |
| [Seaport documentation](https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md) | Restricted zones constrain fulfillment, counters/cancellation invalidate orders, and cached validation can skip later ERC1271 calls. | An NFT-transfer epoch or a promise that every Seaport-valid order appears on OpenSea. |
| [Creator-fee enforcement](https://docs.opensea.io/docs/creator-fee-enforcement) | OpenSea's documented enforcement path uses its SignedZone, restricted orders and SIP-7 fulfillment data for configured collections. | Compatibility with this escrow's self-zone and one-NFT/no-fee consideration. |

**Additional compatibility limit:** the current candidate cannot be advertised for collections requiring that SignedZone enforcement path. Simply substituting SignedZone would remove this escrow's required ownership/post-delivery zone callbacks. Supporting such collections needs a separately reviewed integration; this review does not bypass creator-fee enforcement. For other collections, custom-zone acceptance remains unknown rather than proven unsupported.

Clearing the orderbook gate requires an authoritative compatibility answer or a separately authorized, tightly bounded end-to-end order acceptance/fulfillment test after the ownership blocker is resolved. No support message or public test order was sent here.

## Exact ETH guard proposal

Run the offline generator against the reviewed build output:

```sh
node scripts/prepare-marketplace-guard-deployment.mjs \
  --artifacts /private/tmp/gogh-capabilities-integration/contracts/out \
  --output docs/v2-marketplace/eth-guard-deployment-proposal.json
```

The script reads only the local source/artifact and writes a deterministic review. It has no RPC client, signer, credential reader or broadcast path. The [proposal artifact](eth-guard-deployment-proposal.json) contains the complete initcode and one exact constructor argument; it rejects unreviewed source, bytecode, ABI, compiler/settings, links or immutable locations.

| Review field | Exact value |
| --- | --- |
| Contract | `GoghPunkMarketplaceGuard` |
| Chain | Robinhood, `4663` / `0x1237` |
| Proposed fee payer | `0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6` |
| Constructor registry | `0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844` |
| Expected registry runtime hash | `0x5a1001edb812b6ec2e233cbba6db4b7c680d0832453927696cf1ef623fff8e22` |
| ETH value | `0` (network deployment fee is separate and not quoted yet) |
| Compiler | `0.8.34+commit.80d5c536`, optimizer 500, via IR, Cancun, metadata hash disabled |
| Creation bytecode | 1,671 bytes plus 32-byte registry constructor argument |
| Exact initcode hash | `0xba334881343f01d3cf48d0ea2de649fb872bb686ece9b8b2c8e469a95041117d` |
| Expected constructor-populated runtime hash | `0xf5a63f3ae0c40cb8c9f85b44aeab36d24b6a8f23da0b7df84fb70df4d813f9e7` |
| Public deployment / receipt / fresh fee quote | Absent; explicitly pending |

The expected runtime is derived from the exact compiled template and the two immutable bindings. Its hash matches the prior actual copied-chain constructor result. It is **not** evidence of a public deployment. The zero-immutable template hash is separately labelled and must never be used as a deployed contract pin. The known fee payer receives no admin, custody or spending role from this constructor.

Before a wallet confirmation, re-read the canonical chain/registry pin, simulate the exact creation, obtain a fresh pending nonce/gas/maximum fee and review expiry, and present that bounded transaction. After any separately authorized deployment, verify the exact receipt, finality, runtime and both immutable getters before adding a reviewed production pin. Deployment alone does not satisfy the owner, skill, listing, policy, reserve, simulation or durable-journal gates.

## Validation and integration

- **127 JavaScript tests passed, zero failed/skipped:** 21 new proposal tests and the existing 106 marketplace review, independent-security and practice tests.
- **26 Solidity tests passed, zero failed/skipped:** five new transfer-counterexample tests, nine existing escrow tests and twelve guard tests, including 1,024 reserve fuzz runs.
- The proposal reproduced from the existing capabilities build artifact. No shared artifact was modified; the dedicated test build used approximately 4.6 MB in its own temporary output.
- Existing original collection, Agent, bid, guard, frontend, Netlify, database, release manifests and skills were not edited. Existing practice processes were not changed.
- This is a bounded release-readiness review. It does not replace the orchestrator's full integration/security gate or claim a product-wide final-ready verdict.

```sh
node --test tests/marketplace-guard-deployment-proposal.test.mjs \
  tests/marketplace-review.test.mjs tests/marketplace-independent-security.test.mjs \
  tests/marketplace-practice.test.mjs tests/marketplace-practice-independent.test.mjs

forge test --offline \
  --match-contract 'GoghMarketplaceGuardTest|GoghMarketplaceIndependentTest|GoghWethReleaseReadinessTest' \
  --out /private/tmp/gogh-weth-readiness-out \
  --cache-path /private/tmp/gogh-weth-readiness-cache --fuzz-runs 1024
```

No new exposed P0 defect was found in this scoped increment. The two public WETH release blockers remain unresolved; their continued fail-closed gate is mandatory. Owner authorization is still required for a reviewed public deployment, any offer publication/financial test, or any alternative permission/ownership design. This artifact grants none of those authorizations.
