# Public holder Forge inspection — 22 September 2026

Status: **IMPLEMENTED / TESTED / PUBLIC INSPECTION CANDIDATE. GENERAL BURN BLOCKED.**

This release adds a useful, owner-authenticated read-only inspection for any two owned Punks. It does not approve, burn, spend, write a journal, or start a history backfill. The existing narrowly selected canary remains unchanged.

## Public integration

Import `createHolderBurnInspectionPanel` from `site/forge-holder-inspection-panel.js`, include `site/forge-holder-panel.css`, and provide `{root,getSelection,getOwnedPunks,ensureSession,request}`. `getSelection()` returns `{owner,tokenId,chainId,preview,revision?}`. `request(url,{method,headers,body})` returns parsed JSON; the panel supplies a serialized JSON body and content type. Refresh on every owner/Punk/chain/session transition. The panel has no provider/signing argument and imports no wallet submission code.

`POST /api/v2/punks/:target/forge/holder-burn` accepts only `{operation:'check',sourceTokenId}`. Both owners are verified on chain; all four V1/V2/V3/Agent wallet addresses and implementation/registry pins are verified through two configured providers at one canonical block. Native/WETH/gas deposits, active Agent session, pending account nonce, **unused legacy burn credits and separately purchased credits** are inspected. A missing deployed paid-ledger read is UNKNOWN. Pausing paid purchases does not remove that ledger from source checks.

NFT/token inventory and unresolved obligations are explicitly UNKNOWN. The UI never labels the source safe, and never shows approval/burn controls even if a response claims `canBurn:true`. No full-history scan or automatic polling runs. Requests use existing 6-second RPC transports, zero retries, batches of 20, and the public endpoint permits six requests per IP per minute.

The restored staged coordinator, wallet panel and journal remain developer test candidates. Mutation composition is isolated in `holder-burn-staged-runtime.mjs` and is not imported by the public handler. The SQL is stored under **`netlify/database/review/holder-burn-journal.sql`**, outside automatic migrations. No schema, role grant, contract or secret changed in production.

## Proven release blocker

`contracts/test/GoghHolderBurnBoundary.t.sol` passed four disposable-chain tests:

1. The deployed contract design's burn state hash stays unchanged when ETH arrives in a source wallet **after review, before execution**. Burning still succeeds and the owner-derived wallet subsequently has no owner; withdrawal fails.
2. An undeployed counterfactual wallet can already have assets. A wallet/registry creation block cannot establish a safe inventory start.
3. A normal guard wrapper cannot call the old burn source on behalf of the holder: `msg.sender` must own both original NFTs.
4. A new protected issuer cannot grant credits through the old immutable progression's fixed `trainingSource`.

These are release-blocker reproductions, not successful safety tests for public burning. Evidence: `/private/tmp/gogh-holder-contract-boundary.log`. No public RPC or transaction was used for them.

Deposits **after** an already confirmed burn are a separate permanent-access warning. The demonstrated defect concerns assets arriving while the holder is still confirming the burn, and cannot be cured by another off-chain check or user checkbox. Original deployed wallets derive authority from `ownerOf(source)` and have no post-burn recovery authority. Their bytecode and the original collection cannot be changed through a website release.

## Concrete protected release proposal and unavoidable gates

- Add an independently reviewed protected burn/grant entry point to the **still-undeployed** paid-training extension (or a separately reviewed compatible progression). Reuse its reviewed owner/nonce/state/deadline boundary; keep old credits/learning/loadout visibility without double counting. Do not modify the deployed old source or silently change credit provenance.
- Bind the reviewed inventory witness and four deterministic account identities to the transaction. At execution, reject nonzero native, WETH, EntryPoint deposits, unused old/purchased credits, changed runtime/account state, and all supported witnessed ERC20/721/1155 holdings. Native and witnessed-asset deposits during wallet confirmation must revert atomically; award one credit only after supply decreases exactly once. Source and recipient remain current-owner checked.
- That protection still **cannot discover a brand-new token/collection that was absent from the inventory witness**, nor arbitrary nonstandard token storage. A comprehensive indexed history alone cannot remove this pending-transaction gap. Before broad sacrifice, either establish a reviewed recoverability architecture for every supported source account or explicitly constrain/review a narrower asset guarantee; do not label an unchecked arbitrary wallet safe. Existing immutable source accounts do not provide the recovery architecture.
- Complete bounded inventory must begin at genesis unless independently verifiable complete coverage proves an earlier segment. Existing owned-Punk and gallery indexes are not that proof (`inventoryComplete:false`). Shared indexed checkpoints are preferable to per-holder genesis scans; they need canonical range coverage, positive controls, recipient/address binding, bounded candidate custody checks and measured cost. No bootstrap scan was started.
- Complete the eight obligation categories using `holder-obligation-descriptors.mjs`, including public paid review holds across **all prior owners**, selected paid vault mission/refund chain state, pending UserOperations and future bid escrow. Missing function/table/reader means UNKNOWN. Apply reviewed restricted journal/reader grants only after native database proof. No historical audit rows may be deleted to make eligibility pass.
- Register usable skills and review the new deployment/calldata, then deploy through the owner's wallet. Verify deployed hashes on both providers, perform disposable/fork and owner-wallet acceptance, and only then update the immutable public release artifact. General-holder training/skill authorization must be broadened alongside the protected burn boundary.

**Owner action now:** none can make the current immutable burn contract meet these public safety requirements. Additional source/progression or extension implementation, independent review, complete inventory/obligation evidence, and new owner-confirmed deployment are required before public burns. The selected canary is not a substitute.

## Current local validation

- Holder + selected-burn + paid-credit regressions: **74 passed, 0 failed** (`/private/tmp/gogh-holder-final-tests.log`).
- Four Solidity boundary reproductions: **4 passed, 0 failed**.
- Holder journal SQL executes against PGlite/PostgreSQL WASM with immutable review, exact-once claim, source/owner holds, recovery and RLS checks. Not a native production role/durability claim.
- Public panel DOM tests verify arbitrary source selection, zero mutation controls, truthful unknown inventory and stale-owner response suppression. Desktop/mobile browser screenshots remain parent integration work.

## Preserved staged implementation history

The following original staged audit remains for provenance; public integration above supersedes its integration seam and migration path. Its prepared/claim endpoints are **not** exposed by the current public handler.

# General-holder Forge implementation

Status: **IMPLEMENTED / UNIT TESTED / NOT RELEASED**. The existing selected-owner #1753 → #93 canary is unchanged. This increment does not send a transaction, change the training release, register a skill or apply a database migration.

## Implemented boundary

- Owner comes from the signed V2 session. Recipient comes from the selected Punk route; source comes from an owned-Punk selector. Both are independently checked on-chain. Same source/recipient is rejected.
- V1, V2, V3 and Agent wallet addresses are derived with each pinned registry's `account(sourceTokenId)`. Registry and implementation hashes, collection hash, owners, native balance, WETH, Agent gas deposit, active session and pending nonce are checked at one shared canonical anchor through two providers.
- Incoming standard ERC20/721/1155 and ERC2309 receipts discover candidate assets. The scanner persists contiguous, canonical ranges from genesis and resumes after a timeout. Receipt block hashes and the range anchor are independently checked. If two providers agree a stored anchor was replaced, an audit preserves the former snapshot and a new generation starts at genesis. No copied #1753 empty-history baseline is applied to another Punk.
- Candidate assets are checked for **current** balances or custody on both providers. A previous transfer does not permanently disqualify an asset that has since been withdrawn. Unknown holdings, provider disagreement and nonstandard/malformed transfer logs block eligibility. An ERC721 `ownerOf` revert remains unknown; it is not treated as proof of an empty wallet.
- Eight operational categories must be explicitly clear: automation, missions, transactions, purchases, bids, training, refunds and legacy obligations. A missing category, table, query or invalid count remains unknown.
- The immutable review holds exact owner/source/recipient/calldata/fees/deadline and source evidence. The database reserves its one wallet claim before returning the wallet payload. A lost response cannot release the reservation. Recovery verifies the original transaction and canonical receipt on two providers, including reverted receipts, with twelve additional blocks.
- The frontend reconstructs approval/burn calldata and checks the exact pair, destination, chain, fee and wallet identity before opening the wallet. Typed `BURN <source>` and separate nonstandard/off-chain review are required for burning. It saves the intent and returned hash locally and restores an unfinished review even if the source has burned or transferred.

## Integration seams

`createHolderBurnPanel({root,getSelection,getOwnedPunks,ensureSession,request,getProvider,onConfirmed,release,storage})` returns `refresh()` and `destroy()`. Call `refresh()` on **every** owner/Punk/chain/session transition, including A→B→A. `getSelection()` returns `{owner,tokenId,chainId,preview,revision?}`. `request(url,{method,body})` returns parsed JSON; body is an object to serialize in the parent HTTP adapter. No application script is required for a holder.

Mount with `site/forge-holder-panel.css`. Successful confirmed burn calls `onConfirmed(receipt)` so the parent reloads profile, credit, roster, activity and skill learning. Learning/equipping remain in the existing durable training UI; this panel does not broaden its release allowlist.

`createHolderBurnRuntimeFactory({releaseReader,journalPool,checkObligations,positiveControl,clientsFactory})` composes the backend. Release pins contain the existing collection/registry/progression/trainingSource addresses and runtime hashes, chain 4663, fee ceiling, status (`TESTING`, `LIVE`, `PAUSED`) and explicit `productionBurnAuthorized`. Only `LIVE` with that authorization can prepare/claim. Recovery remains available while paused. The default exported runtime remains unavailable until the parent supplies verified dependencies; deploying this file cannot activate it by itself.

`createHolderObligationReader({descriptors,pools})` accepts **code-owned** descriptors `{name,pool,sql,parameters(source),remediation}`. SQL is fixed `SELECT ... AS count`; neither SQL nor table names come from a request. `source` includes `selection`, derived `wallets`, canonical `anchor` and `excludeIntentId` for excluding only the exact active burn review during recheck. Validate active/final states against the actual production schema before supplying each descriptor. Do not substitute the old fixed-source legacy function.

API: `/api/v2/punks/:targetTokenId/forge/holder-burn`. GET requires one `sourceTokenId`; POST accepts exact fields for `check`, `prepare`, `claim`, `cancel`, `recover`. The response contains a structured check or immutable journal record, never a signing key or credential URL.

## Additive database change

`20260914020000_stage_holder_burn.sql` adds the burn review/audit journal, shared source history and immutable history-reset audit. It includes required JSON fields/types (including explicit JSON-null rejection), immutable review/transition/expiry guards, owner/source holds, revision compare-and-swap, original-hash protection, RLS and no public grants. It is **not applied**. A restricted production role, native SQL/race/restart proof, policies and review are required before wiring. The runtime additionally rejects superuser/bypass-RLS and ownership of any of the four tables, checks all four RLS flags, audit write denial, delete denial and synchronous commit.

## Validation

41 targeted tests passed: 31 new holder tests plus 10 unchanged selected-owner/review-store regressions. Tests cover arbitrary identity, fresh ownership, ERC20/721/1155 discovery, withdrawn assets, unknown/malformed/zero-owner holdings, source-history gaps/reorg/provider failures and reset recovery, pending obligations, source funding after review, expiry/nonce changes, concurrent claim, restart/recovery, paused-release recovery, calldata mutation, unexpected authority, lost claim acknowledgement, failed local storage and wallet/selection changes. The real existing reviewed-burn service is exercised for preparation, claim recheck and approval receipt recovery.

An actual PostgreSQL WASM (PGlite) run applies the migration and tests owner/source holds, compare-and-swap claims, immutable reviews and audit, original-hash binding, terminal-state protection, expired reviews, missing/null JSON fields, history continuity and audited resets, PostgreSQL JSONB key reordering, and denial of public-role access. Four lightweight DOM panel scenarios cover incomplete inventory, explicit approval, stale owner/Punk callbacks and recovery after the burned source leaves the roster. These are not native PostgreSQL durability or real-device browser claims.

Not yet run for this increment: native PostgreSQL role/durability/restart suite; disposable-chain burn→credit journey for the new handler; responsive browser panel journey; independent security review; deployed endpoint/pool composition; general-holder live wallet transaction. Existing copied-chain/canary proofs do not substitute for these checks.

## Release blockers and limits

1. **P1: first-use history performance.** At approximately 62 million blocks, the conservative 8,000-block request budget would require thousands of requests per new source. Durable progress is correct, but this is not acceptable general-holder UX. A complete anchored indexed-inventory/bootstrap path with positive-control and custody checks, or a verified archive scan/index worker, must replace first-use synchronous backfill before general LIVE release. No arbitrary history checkpoint or browser-supplied completion proof is accepted.
2. Production obligation descriptors and restricted journal permissions need inspection/wiring. New pending purchase/bid systems must add authoritative checks before either feature releases.
3. General-holder training release/skill registration is parent-owned and still must be broadened and verified separately.
4. Nonstandard assets and off-chain obligations remain outside the standard event proof; the owner explicitly reviews them. This acknowledgement never turns a failed standard inventory into an empty one.
5. **Inventory is not an atomic on-chain burn guard.** The deployed reviewed-burn state hash binds owners/progression/supply, not source wallet balances. The fresh claim check catches known deposits before that check. Deposits while a wallet request is awaiting confirmation or later can become inaccessible. The warning must remain explicit; independent security review must accept the release boundary or require a reviewed on-chain guard before broader release.
6. The new frontend has not yet been browser-reviewed. It must not be labelled LIVE solely because its panel renders.

## Actual provider performance probes

Read-only checks on 14 September 2026 UTC confirmed:

- Validation Cloud authenticated archive: genesis queries reject with an explicit 2,000-block maximum. 1,000 recipient topics succeed and recover the known #93 NFT receipt; 1,024 and larger topic arrays are rejected. No credential URL was recorded.
- Unfiltered 2,000-block global standard-event windows returned 34,953–54,438 events and 22.2–34.5 MB in sampled mature ranges. A naive whole-chain download would be hundreds of GB; none was started.
- Blockmachine, the actual production secondary, allows at most 10,000 blocks per query. A filtered 10,000-block window with 1,000 recipient topics recovered the known #93 receipt in 988 ms with a 639-byte result. A full genesis query still rejects.
- The existing ERC6551 predictor derived all 20,068 wallet addresses for IDs 0–5016 across four versions in about 3.6 seconds, with independently read #94 registry samples matching. A single query containing all 20,068 recipients is rejected by Validation Cloud.

A shared complete index is feasible only with an explicit throughput/budget plan. With 21 recipient groups and two recipient-topic positions, a Blockmachine bootstrap at roughly 62.5 million blocks needs about 262,500 filtered requests. Validation Cloud's smaller range would require about 1.3 million. No mass scan, new account, paid plan or external message was initiated.

Validation Cloud documents a 50-million-CU monthly Robinhood free tier in its [Robinhood announcement](https://www.validationcloud.io/post/validation-cloud-now-supports-robinhood-chain-mainnet). Its [Arbitrum eth_getLogs reference](https://docs.validationcloud.io/v1/arbitrum/execution-api/eth_getlogs) lists 80 CU per request; applying that rate to Robinhood is only an estimate until the account's exact method metering is verified.

The deployed reviewed-burn contract has no durable ownership epoch, but source and recipient transfers have different effects. Transferring the source clears its ERC721 token-specific approval. `applyBurnReview` requires the source's exact burn-source approval and rejects operator-wide approval, so source A→B→A alone cannot revive a burn: the current owner would need to approve the source again explicitly. A recipient round trip can restore the reviewed owner/state hash during the short review window; execution still requires the sender to own both Punks, the exact source approval, and an explicit current-owner wallet transaction, with the credit assigned to the current recipient. This is not the long-lived WETH offer invariant. A broader release must assess those exact preconditions and must not advertise permanent ownership-epoch invalidation or atomic asset-inventory protection.
