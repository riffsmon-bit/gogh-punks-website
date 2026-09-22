# Public holder release — independent security review

Reviewed on 2026-09-22 by the holder-forge agent, independently of the paid-mint and ERC20 authors. This is a review of the proposed source changes, not proof that production routes, configuration, migrations or wallet flows have been deployed successfully.

## Release decision and exact scope

- **Owner-confirmed atomic paid mint:** acceptable for the release gate after the restricted journal migration, route/flag integration and preview validation. One supported SeaDrop Studio NFT is minted through the selected Punk's activated Agent Account. The connected owner supplies the exact price and gas and confirms each transaction. This does **not** release unattended paid missions, reusable spending authority, a paid worker, arbitrary mint adapters, sweeps or bids.
- **General ERC20 withdrawal:** acceptable for the release gate for deployed, pinned V3 and Agent accounts, with exact token transfer to the current owner and wallet confirmation. V1/V2 recovery remains separate. This does not promise support for every token's behavior.
- **Public sacrifice inspection:** acceptable as a bounded, authenticated, read-only check. It must remain visibly incomplete where history or obligations are unknown. It must not expose approval/burn buttons.
- **General public burn:** **BLOCKED**. Four local contract tests demonstrate an asset-stranding race at the deployed immutable contract boundary. A setting, historical scan or successful copied-chain burn does not resolve it.

There are **0 unresolved P0 and 0 unresolved P1 source findings** in the proposed enabled scopes after the fixes below. Integrated preview/production acceptance is still the release lead's responsibility. This is not an assertion of zero P0/P1 across all dormant or previously deployed Gogh functionality.

## Findings and disposition

| Finding | Severity | Resolution reviewed |
| --- | --- | --- |
| ERC20 recovery selected public RPCs ahead of the configured archive pair, although exact receipt verification needs historical balances. | P1 | Endpoint now uses `createForgeRpcClients`: configured archive precedence, distinct provider hosts, bounded requests, zero transport retries and disabled CCIP reads. Historical failure retains recovery instead of declaring success. |
| An owner could prepare withdrawals for different Punks while the first wallet transaction was not yet visible to RPCs. | P1 | Owner-scoped Web Lock and a durable owner-wide unresolved withdrawal marker now complement each Punk's recovery record. Another Punk links to the original request and cannot submit. |
| A supplied paid-mint recovery hash was persisted before proving that it matched the reviewed transaction; reported hashes could subsequently be rewritten. | P1 | Exact transaction and canonical receipt checks occur before first binding; an existing reported hash must match. SQL makes the original non-null hash immutable. Unrelated-hash regression verifies that the saved request remains recoverable. |
| Public paid reviews held only an `(owner, Punk)` reservation, permitting the same owner's different Punks to compete for the same nonce. | P1 | The partial unique unresolved-review index is owner-wide. `pendingPunk()` provides recovery navigation. The disposable PostgreSQL test covers the cross-Punk conflict. |
| Count-only pending-mint inspection accepted SQL NULL and could return zero rather than reject unknown identity. | P1 for a future burn consumer | Explicit NULL/range validation now rejects it. Cross-owner count access exposes no review payload and is restricted to `forge_request`. Public burn remains disabled independently. |
| Holder inspection supplied an object to a string-body request seam and linked to nonexistent `tab=withdraw`. | P1 UI integration | JSON serialization plus Content-Type added; wallet destination is the existing Collection tab. Targeted DOM tests pass. |
| Holder/public-paid POST handlers initially used the production-only origin helper, preventing trusted preview testing. | P1 preview integration | Both now use existing `requireV2OwnerOrigin`, with passing production, exact trusted preview and cross-origin rejection tests. No broader origin policy was introduced. |

## Paid mint authority and data integrity

Inspected `directed-paid-public.mjs`, its store/runtime/API, browser wallet/panel code, the release artifact, and `20260922060000_public_directed_paid_reviews.sql`. Author commit: `474ad87`.

The server and browser reconstruct the exact call. The account, registry, implementation, collection runtime and SeaDrop runtime are pinned; chain must be 4663. Both providers check current collection `ownerOf`, account ownership, account binding/state, mint availability and price. The one-NFT price is bounded to 0.001 ETH and fees are bounded independently. No client-supplied calldata, approval, delegatecall or generic signing request is accepted. A closing state check follows simulation. The current owner calls the existing account directly and supplies the price in that same transaction; the backend does not broadcast or spend the Punk's reserve.

The journal claims a request before opening the wallet. Unknown outcomes retain the original request. Confirmed recovery requires the exact sender, destination, nonce, value and calldata, canonical finalized receipt, exactly one matching mint Transfer and historical NFT delivery to the Agent Account. Wrong recipient, duplicate delivery, malformed gas data or unavailable history cannot become success. Original-sender receipt recovery remains possible after a Punk transfer.

SQL forces RLS, uses transaction-local owner context, denies public access, limits the request role's writable columns, hashes the immutable JSON review, validates required fields with `IS TRUE` to reject SQL NULL, enforces state transitions/revisions and reserves one unresolved mint per owner. Worker roles receive no journal access. The count-only `SECURITY DEFINER` obligation helper has a fixed search path, no public execute grant, validates the token ID and deliberately sees unresolved rows belonging to earlier owners without exposing their data. Installation requires an already-reviewed administrative role; it does not create a new privileged role.

The application's 60-second review deadline is a pre-submission freshness limit, not an on-chain deadline in the existing account's `execute` method. An already-opened wallet request must never be treated as safely expired or resent. Owner transfer blocks the previous owner's new call while ownership differs. This explicit EOA-signed, exact transaction is not the delegated WETH offer whose authorization can revive after an ownership round trip; public delegated offers remain outside this approval.

## ERC20 authority and recovery

Inspected `erc20-withdrawal.mjs`, `broker-v2-erc20-withdraw.mjs`, browser wallet/panel code, test fixtures and actual account contract tests. Author commit: `ce43b98`.

The only transaction is `account.execute(token, 0, transfer(currentOwner, exactUnits), CALL)`. The selected token contract and exact amount are displayed. Decimal conversion uses integers, not floating point. Account derivation, exact proxy footer, deployment hashes, current ownership, chain, balances, nonce and fee cap are checked independently. There are no new persistent approvals, sessions, signing keys, withdrawal operators or database permissions.

Simulation measures source and destination balances before and after the transfer and checks the actual transfer call. Unsupported return values, visible fees/rebases and unexpected deltas fail closed. The local contract test attacks both actual account implementations with a token callback attempting an ETH drain and verifies the callback fails. Extra wallet transaction fields cannot introduce delegated authority.

The browser saves recovery before sending and retains unknown requests. Exact final recovery checks both providers, transaction identity, token/account code, the expected Transfer and historical balance deltas. A mismatch becomes `REQUIRES_ATTENTION`; it is not automatically retried. Archive availability is therefore necessary for production confirmation.

Limitations are explicit in the holder UI: an arbitrary malicious or upgradeable token may change after simulation; pinning a proxy's bytecode does not pin its implementation. Existing accounts have neither an on-chain review deadline nor a transfer postcondition added by this change. Other transfers in the same block can conservatively prevent exact historical-delta verification. This review does not claim token honesty or universal cross-feature owner-nonce locking. None of those limitations grants the backend authority to move assets.

## Why public burn remains blocked

`GoghHolderBurnBoundary.t.sol` demonstrates that a source-wallet ETH deposit made after review does not change the deployed burn's accepted state hash. The burn can succeed and leave `ownerOf`-based account control at zero, stranding the deposit. Source wallets can also receive assets before counterfactual deployment, so registry deployment is not a safe start for a complete transfer-history inventory. The old burn path requires the caller to own both NFTs, preventing a wrapper from transparently adding checks. Its old progression source is immutable, preventing a replacement issuer from granting those old credits.

The new public inspection derives all four wallet addresses, checks both owners and current bounded chain evidence, and separately reports unused legacy-burn and purchased credits. It intentionally reports unknown NFT/token history and unresolved obligations as unknown. `canBurn` is forced false. The staged holder coordinator, wallet mutation UI and journal SQL are preserved for engineering review but **are not imported by the public runtime, mounted publicly or automatically migrated**.

A defensible general release requires reviewed protected burn/grant contracts and a compatible progression route, potentially integrated with the still-undeployed optional paid extension. Native/WETH/deposit/known-asset/credit checks must run atomically at the burn boundary. An inventory witness alone cannot prove absence of previously unknown/nonstandard assets arriving while a transaction is pending. A separately reviewed recovery architecture or a rigorously bounded supported-asset guarantee is still necessary. The deployed immutable accounts cannot simply acquire a new fallback owner after their Punk is burned. The owner would need to review and deploy the new boundary before any real general-holder sacrifice; each actual burn still requires the holder's wallet confirmation.

## Evidence and limits

- Independently executed initial proposed ERC20 JS/DOM suite: **53 passed, 0 failed** (`/private/tmp/gogh-independent-erc20-review.log`). Author subsequently added the reported fixes and additional tests; the final authored report records **67 passed** plus **5 offline contract tests**. This is fixture/private-chain evidence, not a live token withdrawal.
- Independently executed initial proposed public paid JS suite: **14 passed, 0 failed** (`/private/tmp/gogh-independent-public-paid-review.log`). Reviewed the author's final focused log: **17 passed, 0 failed** (`/private/tmp/gogh-public-paid-final-unit.log`), including origin and recovery fixes. Reviewed native PostgreSQL proof: **37 assertions passed**, disposable loopback database only and zero production writes (`/private/tmp/gogh-public-paid-native.log`). Reviewed Chrome mock-wallet result at 1440/375/320 pixels: one send, successful original recovery after reload, zero exceptions (`/private/tmp/gogh-public-paid-screens-3Xola8/result.json`). Reviewed **4 passing offline actual-Agent-account contract tests** with mock SeaDrop/NFT (`/private/tmp/gogh-public-paid-contract.log`). These authored final runs were not independently repeated solely for this review.
- Holder integration/origin change: **10 targeted tests passed, 0 failed**. Earlier holder implementation: **74 targeted JS tests** and **4 offline contract boundary tests** passed. The latter prove a blocker, not a safe live burn.
- The public-paid read-only evidence dated 2026-09-22 reports Punk #93's Agent Account activated, Punk #94's account unactivated, and the known Peppies World public drop **ENDED**. It records **zero public transactions**. A supported contract runtime is not evidence of an active mint window or live mint delivery.
- Local mock-wallet/browser and DOM tests do not substitute for the integrated preview, actual production configuration, real-device wallet approval or a holder-confirmed small transaction. No real burn, token transfer, paid mint, production data mutation or deployment was performed by this reviewer.

## Final integration gates

1. Integrate the reviewed source commits, including the final preview-origin fixes and regression evidence.
2. Apply only the reviewed public-paid journal migration with the restricted roles verified; do not apply dormant holder-burn journal SQL.
3. Bundle the new endpoints, mount the panels, keep their labels faithful to manual mint/read-only sacrifice, and enable only the intended public paid flag after dependency checks.
4. Run the lead's single integrated validation and preview smoke test, including disconnected state, wallet/Punk switch, 320/375-pixel layouts and original transaction recovery.
5. Verify configured archive reads and current supported mint availability without broadcasting. Complete any real transaction only through the holder's clear wallet confirmation.
6. Keep general burn, unrestricted paid autonomy, sweeps and WETH offers outside this release approval.
