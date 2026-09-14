# Independent purchase wallet review

Scope: read-only review of the new owner-assisted marketplace browser codec and send helper in the integration worktree on September 13, 2026. The reviewer implemented the separate planned research packages and did not edit these wallet feature files. This is not a public marketplace release approval.

## Findings and corrections

The first codec accepted a changed `selection.items[].orderHash` while transaction bytes and the saved data commitment stayed unchanged. A local, no-network probe reproduced that acceptance. The implementation now retains the server-observed order counter and recomputes the Seaport `OrderComponents` struct hash from decoded parameters plus that counter. Changing the displayed order hash or counter is rejected. This also binds the seller, fee recipients, salt and conduit parameters to the exact selected order, rather than merely checking NFT identity and total price.

The first send helper did not independently honor blockers or availability in the claimed response. It could accept an inconsistent response containing a wallet transaction plus RELEASE_BLOCKED or nonempty blockers. The implementation now requires the coordinator's winning-claim state, RECOVERY_REQUIRED with no blockers, before accepting that transaction.

The send helper now requires an explicit trusted browser purchase release with OWNER_ASSIST status, chain 4663 and the exact purchase guard address/code hash. There is no default public release. Zero guard/wallet addresses and purchasing the controlling Gogh collection are rejected. A server-provided guard address alone cannot enable a send through this helper.

## Independent verification

Nineteen no-network assertions passed against the corrected source codec and browser helper:

- A correctly encoded native-ETH single-NFT purchase and final guard call passed.
- Changed order hash, counter, expected account state, reserve or collection runtime hash were rejected.
- Zero guard, zero wallet and the controlling collection were rejected.
- Blocked or inconsistent claim responses were rejected.
- Missing trusted release, changed guard address/code hash, changed connected owner and failed durable attempt persistence all prevented a wallet send.
- The controlled successful path recorded `attempt → claim → one mocked wallet send → hash` in that order.

The probes were subsequently converted into the committed [wallet boundary test suite](../../tests/marketplace-wallet-boundary.test.mjs), which passed **45 repeatable tests** against the integration source and generated browser bundle. Run it after integrating the wallet implementation:

```
node --test tests/marketplace-wallet-boundary.test.mjs
```

These tests use independent fixture order-type declarations and verify both source and browser codecs. Calldata mutations update the outer byte commitment, forcing the codec to reject changed economic meaning instead of merely detecting a stale hash. The fixtures exercise one-, two- and five-item batches with prices above JavaScript's exact-number range.

Additional scenarios cover altered claim identity/hash/revision/order/counter, attempt-storage failure, a lost claim response after reservation, wallet rejection, an interrupted wallet request with unknown outcome, an invalid returned transaction hash and failed hash persistence after a successful mocked send. None automatically retry the wallet transaction. Chain/account changes before and after the claim, failed network reads, selection changes during parallel wallet reads and expiry during the claimed response all prevent submission.

The concurrent test deliberately holds responses until two submissions reach the claim boundary; an in-memory atomic-winner fixture admits one wallet request and rejects the other. This proves browser behavior given an atomic claim, not the production database's atomicity. Durable SQL, real wallet behavior, receipt reconciliation and production recovery retain their separate acceptance tests. All transactions and callbacks in this suite are in-memory fixtures; it sends zero public requests or transactions.

The guard's `expectedAccountState = prior state + 1` matches the actual `executeBatch` implementation, which increments once before invoking the batch. The codec preserves zero outer transaction value, exact per-order native value, canonical calldata round trips, the Punk Wallet NFT recipient, no criteria/conduit/extra-data expansion, exact gas-fee multiplication, the final reserve/owner/collection guard and its 60-second deadline.

An independent esbuild run with `write:false` and the repository's browser targets produced bytes identical to the generated `site/marketplace-wallet-codec.js`. No files in the integration worktree were changed by this review. The probes made zero public RPC requests and zero transactions; the successful send used an in-memory mock provider.

Reviewed SHA-256 digests:

| File | SHA-256 |
| --- | --- |
| `client/marketplace-wallet-codec.js` | `6635d4a82dd97338bca4efaa67586995f1a674bc085b04b538449b48aa4df737` |
| `site/marketplace-wallet.js` | `ff2fbdd7adaff36f5468526a4545f57154538f29eaf532ff94fe2cb42b0320f2` |
| `site/marketplace-wallet-codec.js` | `aee72b693dfd0039a0aa7b10dc78948ac4e23b03277b211138cf620fc5a1e584` |
| `broker/src/v4/marketplace/contracts.mjs` | `634717df2fa2d941907f241607c8ddbccb8c9d95d1b9f9b04ff2fa47be0c4a5e` |

## Remaining boundaries

The browser guard pin must come from a separately reviewed release, not request data. The backend must still verify the canonical wallet, dependency and guard runtime hashes, collection screen, current owner and transfer continuity, exact order status/counter, policy, current budget/usage, simulation and an atomic durable claim. This review does not attest the database coordinator, receipt reconciliation, public guard deployment or complete marketplace UI. It does not authorize a public purchase, deployment, WETH bid, burn, refund or release change.

The browser checks consistency with a trusted server review; it is not an independent chain indexer or security clearance. Persistent attempt/hash handling and claim atomicity retain their separate integration tests. Production release remains blocked until those existing gates are satisfied.
