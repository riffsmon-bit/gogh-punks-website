# Marketplace execution source and security audit

Reviewed September 13, 2026. This change adds a controlled marketplace implementation; it does not enable live buying, publish an offer, send a refund, move a holder's funds, register a module, or change a deployed wallet.

## Established facts

The deployed `GoghPunkAgentAccount.isValidSignature` always returns zero. Its owner `execute` and `executeBatch` reject `approve`, `setApprovalForAll`, increaseAllowance and decreaseAllowance. Its current autonomous session remains quantity-one **free mint** only. Consequently WETH offers cannot safely be created by pretending the existing Agent supports signatures/approvals. We retain these protections.

Seaport supports direct native-ETH fulfillment with an explicit NFT recipient. Official cross-chain addresses name Seaport 1.6 as `0x0000000000000068F116a894984e2DB1123eB395`. The protocol order contains signed assets, amounts, recipients, validity period, counter, conduit, and order type. We restrict purchase preparation to fixed full-open quantity-one ERC721 native listings. [ProjectOpenSea deployment list](https://github.com/ProjectOpenSea/seaport#deployments), [official Seaport interface](https://docs.opensea.io/docs/seaport-interface).

OpenSea documents Robinhood support and an authenticated item-offer POST API. That does not prove this custom zone is accepted by its orderbook. No order POST was performed and no live orderbook compatibility is claimed. [OpenSea Robinhood description](https://learn.opensea.io/learn/blockchain/what-is-robinhood-chain), [item-offer endpoint](https://docs.opensea.io/reference/post_offer), [supported-chain endpoint](https://docs.opensea.io/reference/get_chains).

Seaport's signature validation can be cached by `validate`. Therefore a current-owner condition only inside ERC1271 is insufficient. Our bid escrow is also the order's restricted zone; its `authorizeOrder` and `validateOrder` enforce current ownership before and after each actual settlement. A real-Seaport test explicitly cached the signature, transferred the copied Punk, and verified fulfillment still failed. The official zone interface defines those before/after hooks. [Zone interface](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ZoneInterface.sol), [Seaport order documentation](https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md).

## Live read-only pin proof

At Robinhood block **62214119**, hash `0x840e288402f345f39d39fb5303dac00d41350e701447a090f96a3dc6653edbb5`:

| Contract | Address | Observed runtime hash |
|---|---|---|
| Seaport 1.6 | `0x0000000000000068f116a894984e2db1123eb395` | `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00` |
| Existing project WETH | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | `0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353` |

`eth_chainId` returned 4663. `Seaport.information()` returned version `1.6` and conduit controller `0x00000000F9490004C11Cef243f5400493c00Ad63`. The existing project's WETH returned symbol `WETH`; the controlled fork also proved deposit/transfer/finite approval and actual Seaport WETH settlement. WETH's address is based on the existing project configuration plus these chain observations, not an invented claim that the OpenSea docs name it.

The new code also pins the existing Agent implementation and registry hashes already recorded in `deployments/robinhood-punk-agent-account.json`. No deployment manifest is changed. The two **new** contracts have no production addresses or deployed status.

## Native purchases and bounded sweeps

A selected list is not a verified collection floor. The request contains up to five explicit listing hashes and exact prices/limits. Server-owned OpenSea records supply the original signed orders. Wrong chain/protocol, unknown/dynamic price, mixed/WETH payment, partial/restricted order, criteria/bundle/quantity, invalid or missing counter/signature, substituted asset, duplicate listing/asset, near-expiry, cancelled/filled orders, changed seller ownership, unscreened runtime, disabled skill/policy, insufficient reserve or excessive fees stop review.

The existing owner-only Agent `executeBatch` pays each Seaport fulfillment from its balance. The final new stateless guard checks exact owner, account state, receipt assets, reserve, runtime and deadline, reverting the entire purchase on mismatch. The guard closes a race that a preflight-only reserve check cannot close if an existing session spends between review and wallet execution. It is a call target, not a wallet module or delegatecall. No approval is needed. The owner's wallet pays the network fee separately.

Production transaction construction is blocked until this guard is independently reviewed, deployed and pinned. Durable intent/journal integration and current shared skill/policy requirements are mandatory before an owner-wallet send button is exposed.

## WETH bids

The new `GoghPunkMarketplaceBid` accepts exactly one owner-funded ETH price and wraps it to WETH. It can build one exact ERC721 bid or one collection-wide ERC721 criteria bid with quantity one. It does not pull from a Punk Wallet. The order is built internally with one WETH offer, one NFT consideration paid to the canonical Agent wallet, the contract itself as zone, no external conduit, exact expiry/counter/salt, and no user-supplied calldata/order parameters.

WETH approval equals only the actual escrow WETH balance. The contract never sets an unlimited allowance. Only known exact active digests pass ERC1271; the restricted zone additionally checks current owner and post-delivery ownership on every fulfillment. Seaport cannot substitute the NFT recipient, offer amount, collection, fees or a partial order without breaking the hash/zone checks. The escrow records settlement once and makes cancellation and settlement idempotent. It always returns unused WETH to the original funder; the current Punk owner cannot take a predecessor's refund. Recovery works after the Punk transfers or burns. Settlement/cancellation is on chain; the receipt reader does not invent completion.

**Public-release blocker:** the original Punk collection has no ownership epoch. If the original owner transfers a Punk away and later receives it back, the current-owner check becomes true again. The controlled fork reproduces that fact. This contract is not a solution for transfer-history-safe public autonomous bidding. The public review branch stays blocked, regardless of environment flags. A reviewed epoch or equivalent continuity design is required before activation.

Other explicit limits: no public OpenSea posting/publishing integration is installed; OpenSea acceptance of the custom zone remains unverified; no seller fees/royalties in the controlled bid order; no multi-quantity/partial bids, ERC1155, criteria Merkle subsets, arbitrary ERC20s, changing/dutch prices or general Agent signing. Unsolicited assets sent to this narrow escrow have no generic rescue path and should never be sent there.

## Validation and reproducibility

The dedicated test script reads public contracts only through a method allowlist and creates its own loopback Anvil node on an unused random port. It deploys the two candidate contracts and a test ERC721 on that owned node. Seller test keys are generated in memory. It copies canonical #93's ownership/account state but impersonates only the local copy. The script cleans up its own child/server/cache; existing practice nodes are untouched.

```sh
forge build --offline contracts/src/GoghPunkMarketplaceBid.sol contracts/src/GoghPunkMarketplaceGuard.sol contracts/test/mocks/MarketplaceTestNFT.sol --out /private/tmp/gogh-market-execution-build --cache-path /private/tmp/gogh-market-execution-cache
node --test tests/marketplace-review.test.mjs
forge test --offline --match-contract GoghMarketplaceGuardTest --fuzz-runs 1024
node scripts/test-marketplace-disposable.mjs --disposable-only --archive-keychain --artifacts=/private/tmp/gogh-market-execution-build --output=/private/tmp/gogh-marketplace-disposable-evidence.json
```

`--archive-keychain` reads the already configured project RPC secret in memory; it is never emitted. The proof records only public runtime pins, fork anchor, local contract addresses/receipt hashes, tests and explicit limitations. **All reported transactions and the test burn are disposable copies. Public transactions and posted orders both remain zero.**

The script covers atomic purchases, price/policy/screen failure, intervening reserve/state changes, replay, a cancelled sweep item, real WETH transfer and NFT receipt, collection criteria resolution, seller substitution, partial fill, cached-signature transfer rejection, cancellation exactly once after transfer/burn, exact transaction receipt matching/finality, and the away-and-back limitation. Local impersonation, test ERC721 code and one-node finality mean this is controlled proof, not a mainnet end-to-end marketplace trading claim.

Final focused result: **25 JavaScript tests passed**; **12 guard contract tests passed**, including 1,024 reserve fuzz cases. The final owned-fork run passed in **23.926 seconds**, with **30 local transactions**, 9 recorded journey outcomes, **0 public transactions**, and **0 posted public offers**. See [machine-readable disposable evidence](disposable-evidence.json). This is specialist evidence, pending the root's independent security review and integration gate.

## Independent-review repairs

The independent reviewer found three receipt-boundary defects: successful no-op cancellation could not reconcile; mined gas price could mask an unreviewed fee cap; returned transaction hash/block identity was not cross-checked. These are repaired using explicit legacy-only transaction envelopes, complete fee/type/hash/block/status checks, and code-pinned historical bid state with exact immutable order binding. A no-op cancellation now records prior cancellation or settlement with **zero refund attributed to the current transaction**. Missing or unknown receipt status also fails closed. Contract semantics were not changed.

The repaired actual-fork journey passed in **26.005 seconds**, with **31 local transactions**, 11 recorded outcomes, **0 public transactions** and **0 posted public offers**. It includes successful cancel-after-fill and repeat-cancel receipt recovery, rejected transaction hash/block/type/fee substitutions, and rejected unknown receipt status. [Repair evidence](disposable-repair-evidence.json) supplements the initial proof above.
