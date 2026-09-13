# MCP roster and Market Scout v2 hardening

Status: **READY_FOR_REVIEW**, not a production skill promotion. Worktree `/private/tmp/gogh-hardening-market-mcp`, branch `v2/hardening-market-mcp-20260913`, based on integration `5551264`. This task addresses H-08 and the versioned implementation portion of H-10 / M-01 / M-02. It changes no contracts, database tables, environment variables, ownership semantics, transaction authority or deployed skill registrations.

## MCP roster

The earlier `get_my_punks` implementation serially fetched full authority profiles for at most 256 indexed rows. It silently omitted nonindexed ownership and skipped individual read failures. Each profile included unrelated wallet activation/code/balance reads.

The replacement reuses the unchanged DOM-free `site/broker-v2-ownership.js` verifier. A bounded index query supplies hints; `balanceOf` and batched `ownerOf` at one block establish ownership. If the hints do not reconcile with the live balance, the verifier scans the bounded original collection range, including token 0 through lowercase `maxSupply()` (5016). It must reconcile exactly. Index failure does not block a live scan.

For verified IDs, the reader checks the fixed V3 registry's deployed runtime hash once, then batches only `account(tokenId)` at that same block. The chain and canonical block hash are rechecked before returning. It reads no per-Punk profile, account balance, skill state or activation state. Roster observations do not authorize an action; action tools retain their independent fresh-owner gates.

Existing output fields remain `punks: [{tokenId, punkWallet, ownershipBlock}]` and `indexIsAuthority: false`. The parent approved the additive `coverage` object: `COMPLETE_AT_BLOCK`, block number/hash, verified count and `ORIGINAL_GOGH_COLLECTION` scope. No partial scan becomes an empty or complete roster. Failure produces a fixed retryable unavailable error.

Bounds: at most four concurrent scan or registry batches, 200 IDs per batch, 5017 index hints, 500ms hints deadline, 1.8s per RPC read and 12s overall. The runtime still uses the existing `RPC_URL` configuration. This change does not switch the production RPC provider. Already-started read-only index work can complete after the hints deadline; it cannot mutate state or alter the returned result. RPC work is aborted on completion/deadline where the transport supports cancellation, and no later reads are scheduled after the overall deadline.

## Versioned Market Scout

New files are `broker/src/v4/skill-forge/market-reader-v2.mjs` and `broker/skills/market-scout/v2/`. Existing v1 packages, the Rarity Eye implementation, capability resolver and shared research runtime remain unchanged. The new manifest pins the new implementation digest, including the fixed supported chain/payment addresses. Its instructions explicitly label it TESTING. It is not automatically loaded, registered, accepted or exposed in production.

The parent approved the initial supported scope: a single fixed-price ERC721 on Robinhood, quantity and remaining quantity exactly one, paid in native ETH or Robinhood WETH. Supported Seaport addresses are fixed. ERC1155s, criteria orders, bundles, variable prices, unknown protocols and other currencies are excluded with explicit reasons. Broader quantity/payment semantics require a later reviewed version.

For each supported observation, the adapter validates both the API asset and Seaport offered asset, exact NFT token ID, current reported status, start/end times, remaining quantity, payment asset type/address, fixed 18 decimals, fee-bearing consideration sum and exact reported price. Decimal strings are required for uint256 amounts and IDs; even a seemingly safe numeric JSON price is rejected because coercion cannot recover lost precision. OpenSea's integer `remaining_quantity=1` is explicitly accepted because it is exact. Native ETH's zero address and Robinhood WETH's address are distinct identities. All consideration items use one supported payment asset. Unit, original total and remaining total are identical only because supported quantity is one.

The output contains observation data, exact string amounts, expiry, explicit unknown on-chain validity and coverage. It strips signatures, raw order components, salt, conduit instructions, calldata and wallet actions. It never constructs a transaction. Expiry is checked again at delivery so an item expiring while another page loads is removed. UTC clock regression withholds all listings. Server time is clearly distinguished from verified chain time.

HTTP is fixed-host HTTPS GET with redirects rejected; neither callers nor returned cursors can choose a destination. Each request reads at most 2MB, with a 4s call deadline and 8s overall deadline. At most three pages of 20 items can be inspected, with at most 20 results returned. Pagination is encoded, bounded, deduplicated and detects repeated cursors. Provider errors produce fixed unavailable codes with no body, URL or secret leakage. Earlier supported observations remain explicitly PARTIAL if a later page fails.

Every response remains a bounded sample. Even exhausted provider pagination does not establish a collection floor, current fulfillability, complete inventory or transaction permission. Inactive/unsupported listings are counted, not silently turned into zero-price evidence. Ownership, approvals, signatures, cancellations, current counter and zone fulfillability remain unverified. Market Scout v2 is useful read-only research; it is not a Floor Hunter execution adapter.

## Evidence

[Live read-only evidence](market-mcp-live-readonly.json) records the final source implementation:

- Complete live owner scan with **zero index hints**: **140 Punks**, **35 RPC requests**, peak concurrency **4**, **1743ms**. Existing authenticated Validation Cloud endpoint was obtained from Keychain in memory; only its provider label is recorded. Owner/account addresses are public chain data. The database was an empty-hint fixture, so this does not prove production database/session endpoint acceptance.
- A preceding public mainnet endpoint scan returned explicit unavailability after 6104ms and 14 requests. This is a provider reliability limit, not a passed production-route test. The final helper preserves the existing production RPC configuration and fails closed under that condition.
- Canonical Gogh collection: **5 supported live listings**, **177ms**, **2 authenticated OpenSea GET requests**.
- Peppies World: **5 supported live listings**, **144ms**, **2 authenticated OpenSea GET requests**.
- Both market samples preserved exact prices and had no excluded listings in the recorded sample. This establishes bounded data availability at the recorded time, not a provider SLA.
- No wallet prompts, signing, public transaction broadcasts, production database writes, refunds or NFT burns occurred.

Targeted validation: **99/99 tests passed**, no skips/failures, 5476ms. This includes 14 new MCP roster tests, 53 new v2 market tests and 32 existing MCP/market regression tests. Tests exercise nonindexed holdings, 450 owned IDs, stale index hints, four-way concurrency, broken account resolution, changed chain/block, registry hash mismatch, balance mismatch, index/RPC timeouts, immutable v1 hashes, unsafe numeric prices, currency/NFT mismatches, expired/missing times, remaining fill, malformed/unsupported order types, bounded pagination, partial errors, response/body timeouts, secret stripping and learned/equipped capability gating. The v2 equipped test uses an explicitly disposable accepted-package fixture; it does not change production acceptance.

Timeout regression tests use deterministic timers, avoiding false failures from a busy parallel test runner. Scoped V2 domain typecheck, syntax checks, function bundling (179120 bytes with packages external) and `git diff --check` passed. No contract or database changes were made, so no new contract build/migration was run. Full integrated release tests and independent security review remain the parent's gate.

## Primary source review

The adapter is a native implementation against the official [OpenSea collection endpoint](https://docs.opensea.io/reference/get_collection), [listing endpoint and OpenAPI models](https://docs.opensea.io/reference/list_listings_collection_all), [Seaport models](https://docs.opensea.io/docs/seaport-models), and [Seaport enums](https://docs.opensea.io/docs/seaport-enums), read September 13, 2026. No third-party skill package was downloaded or installed. OpenSea source descriptions are data/interface references; the new Gogh package grants no external signing authority.

## Remaining integration gates

1. Parent diff/security review and integrated validation for the MCP endpoint replacement.
2. Real authenticated production MCP route acceptance with the configured RPC and database; the live helper proof used an empty index fixture plus real chain reads.
3. Market Scout v2 is TESTING until its new package, manifest/instruction hashes, runtime adapter selection and registry release are separately reviewed. Do not silently change the already-pinned v1 runtime to v2.
4. No live skill promotion, general secondary execution, WETH bid or floor sweep is included. Unsupported ERC1155 and multi-item quantities remain explicit.
