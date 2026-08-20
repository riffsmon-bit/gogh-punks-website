# Robinhood NFT Discovery

## V1 sources

- Confirmed ERC-721 and ERC-1155 transfer logs from a chain-ID-verified Robinhood RPC, including zero-address mint signals for new collection research.
- Canonical Gogh Punk transfer stream.
- Verified Seaport `OrderFulfilled` activity from
  `0x0000000000000068f116a894984e2db1123eb395`.
- Owner/system allowlisted feeds through an isolated loader interface.
- A server-only OpenSea v2 display-enrichment adapter for exact Robinhood
  collection/token identities. It is disabled by default, bounded, cached, and
  never authoritative for ownership, pricing, risk, policy, or execution.

No single marketplace API is authoritative.

## Display metadata enrichment

The optional OpenSea worker reads exact
`chainId + collectionAddress + tokenId` candidates from canonical Punk rows,
recorded Punk Account acquisitions, and canonical Scout opportunities—in that
priority order. This ensures an NFT acquired or minted by a Punk can receive
name, image, description, traits, and marketplace attribution in the Gallery
without allowing provider metadata to alter the acquisition record.

The API key remains server-side. Provider redirects are refused, responses are
bounded to 1 MB, identity fields must exactly match the requested NFT, text and
traits are length-limited, and display images are accepted only from OpenSea's
HTTPS `i.seadn.io` image host. Raw provider payloads and credentials are never
stored. Available, missing, and failed results have bounded refresh windows so
the worker cannot repeatedly hammer one token or hold stale metadata forever.

OpenSea enrichment is presentation data. On-chain logs and live `ownerOf`
remain the authority for asset identity, acquisition provenance, and owner
control. A metadata image or collection name can never create an executable
opportunity.

## Normalized opportunity

Every record carries a chain-qualified collection/token identity, source, opportunity type, creator, price/currency, supply/holder fields, venue, discovery time, metadata, separate scores, confidence, risk label, and recommendation. Numeric on-chain amounts remain integer strings off-chain to avoid floating-point loss.

New or unknown collections are `scoutable: true` and `autonomousExecutionEligible: false`.

Confirmed zero-address ERC-721 `Transfer` and ERC-1155 `TransferSingle` events
are projected as `MINT` and `EDITION` research signals. Their observed recipient,
token ID, quantity, block, transaction, and log index are retained. They are
always stored with `mintPriceStatus: UNKNOWN`, `actionableMint: false`, zero
executable price, `riskLabel: UNKNOWN`, and autonomous execution disabled. Zero
in the executable price columns means “no price observed,” never “free mint.”
Ordinary transfers, burns, malformed events, zero-quantity editions, and
`TransferBatch` are not projected as V1 mint opportunities.

Completed Seaport sales are normalized only as historical collection-research
signals. They carry `historicalSaleSignal: true` and `actionableListing: false`;
the Scout must never present a completed sale as an executable listing. Bundles,
mixed-currency consideration, malformed events, and events from any other
emitter fail closed.

Confirmed single-NFT Seaport settlements are materialized into
`broker_opportunities` with `expected_price = 0`, `maximum_price = 0`, and
`autonomous_execution_eligible = false`. The observed historical amount and
currency remain labeled inside metadata. This prevents a completed sale from
being mistaken for a live quote anywhere downstream.

Each projection stores the canonical source-block timestamp separately from
`indexedAt`. Activity windows use only the block timestamp, so an historical
backfill cannot appear as new 24-hour activity merely because it was indexed
today.

## Discovery pipeline

```text
confirmed source data
      → normalize and deduplicate
      → contract evidence
      → art / creator / market analysis
      → persona Taste Match
      → multi-score recommendation
      → decision log
```

Source failures are isolated and reported without discarding successful sources. Findings include their source and observation time.

## Collection contract evidence

The staged `npm run broker:analyze` worker is disabled unless
`BROKER_ANALYZER_ENABLED=true` is supplied explicitly. For each canonical Scout
collection it:

- pins bytecode, EIP-1967 storage, and ERC-165 probes to one confirmed Robinhood block and hash;
- hashes runtime bytecode and scans executable opcodes without interpreting PUSH data as code;
- reads Blockscout's verified ABI and records exposed write-function categories;
- treats ABI names as callable-surface evidence, never proof of access-control correctness;
- preserves transfer-log/Seaport standard evidence and flags conflicting interface results;
- publishes contract-risk score and evidence-coverage percentage separately;
- retains the public risk label `UNKNOWN` below the required evidence threshold;
- updates no executable quote, proposal, adapter, permission, or agent state.

The same confirmed block/hash also qualifies read-only `name`, `symbol`,
`ownerOf`, and token metadata probes. At most 32 recently observed ERC-721 token
IDs are sampled. The result reports sample size, resolved owners, unique sampled
owners, and maximum sampled concentration; it never calls that number the
collection's holder count.

Only bounded on-chain `data:application/json` metadata is decoded. The worker
stores a SHA-256 content hash and sanitized name/description/attribute/media
shape, never the raw data URI. Remote HTTPS/IPFS metadata is recorded as
unfetched and insecure HTTP metadata is blocked. Deterministic keyword signals
may create a low-confidence `HEURISTIC` art score, visibly prefixed with `~` in
the UI. This is self-described metadata evidence, not media judgment or
objective artistic value.

## Observed market activity

The first market score uses only canonical completed Seaport sales:

- 24-hour, 7-day, and 30-day sale counts based on source block time;
- unique buyers, sellers, and participants observed over 30 days;
- currency-separated 30-day volumes;
- latest observed sale recency;
- a bounded current-owner sample reported alongside the score for context.

Formula `observed-seaport-activity-v1` weights 30-day activity frequency 60%,
latest-sale recency 20%, and participant diversity 20%. Confidence is capped at
65 because this is a partial historical source. Fewer than three 30-day sales
receive no participant-diversity contribution. Live listings, bids, floor,
holder count, wash-trading classification, and executable liquidity are absent;
the liquidity score therefore remains `UNAVAILABLE`, not zero.

The database worker uses a separate chain-scoped advisory lock, bounded batches,
sanitized retry records, and block-qualified snapshots. Reorg recovery clears
affected analysis snapshots and hides affected opportunities before they can be
read by the public Scout API.

## New collection signals

Future adapters may add contract-creation traces, marketplace registration, rapid holder growth, creator-linked deployment, and verified launchpad data. The current transfer source detects initial ERC-721/individual ERC-1155 mint activity; contract-creation detection still requires trace/archive infrastructure and is not claimed.

The staged RPC contract inspector verifies chain ID, hashes runtime bytecode, disassembles opcodes without mistaking PUSH data for executable instructions, probes ERC-721/ERC-1155 interfaces, and reads the standard EIP-1967 implementation/admin/beacon slots. Privilege, source-verification, metadata, transfer, and royalty claims that cannot be proven by those probes remain `UNVERIFIED` and require verified-source/ABI adapters.

## Indexer properties

- confirmed head lag;
- bounded RPC batches and a separately bounded total block window per worker run;
- an explicit verified start block for every stream so a fresh worker does not scan from genesis;
- per-stream idempotency key `stream:chainId:transactionHash:logIndex`, so overlapping canonical and market-wide streams cannot suppress each other;
- persistent block hash checkpoints;
- configurable reorg rewind;
- idempotent raw logs, Scout projections, and the monotonic checkpoint committed
  in one database transaction, so a crash cannot advance provenance past
  materialized evidence;
- atomic raw-log plus read-only Scout projection for verified Seaport settlements and confirmed individual mint-transfer signals;
- explicit source block/hash/transaction/log provenance on projected opportunities;
- canonical source-block timestamps kept separate from worker insertion time;
- canonical-state filtering that immediately hides projections invalidated by a reorg;
- database projections that can be rebuilt.

Each enabled stream requires
`BROKER_INDEX_FROM_BLOCK_<STREAM_NAME>`, with `BROKER_INDEX_FROM_BLOCK` available
only as an explicit fallback. The verified full-history lower bounds are block
`31277277` for canonical Gogh Punk transfers and block `605917` for Seaport
activity. A later, reviewed activation block may be chosen to avoid an
unnecessary historical scan. Reorg rewinds are clamped to the selected stream
boundary.

A detected canonical-hash mismatch performs a chain-wide rewind of raw logs, derived acquisitions, adapter snapshots, and stream checkpoints from the affected block. The manual `npm run broker:index` worker processes streams sequentially under a chain-scoped Postgres advisory lock so concurrent jobs cannot race that recovery transaction. `BROKER_INDEX_MAX_BLOCKS_PER_RUN` limits forward progress independently of the RPC batch size and the result reports `processedThrough` plus `caughtUp`. The default streams are only canonical Gogh Punk transfers and verified Seaport activity; broad `nft_transfers` indexing is opt-in. The reviewed Scout production template starts that stream at block `41380000`, materializes only individual zero-address mint signals, and retains a bounded scan window. This recent boundary is not a claim of complete chain history. The worker refuses to run unless explicitly enabled, given every required start block, and connected to chain ID 4663.

Production schedules core collection/Seaport catch-up separately from the
opt-in market-wide mint-transfer scan. Both still use the same chain advisory
lock and reorg rules, so the separation prevents stream starvation without
allowing concurrent canonical-state mutations.

Reorg recovery also cancels any still-pending proposal derived from an affected
opportunity and marks the opportunity non-canonical, non-scoutable, and
non-executable. Provenance remains available for audit; public Scout APIs return
canonical rows only.

Current collection intelligence is stored in `broker_collections`; versioned,
block-qualified evidence is retained in `broker_collection_signal_snapshots`.
Reorg recovery invalidates current analysis and deletes affected snapshots
before the public feed can reuse them.

Native transfers require traces or periodic balance snapshots because they do not emit a universal event. That capability remains staged until an archive/trace provider is selected.

## Data caveats

RPC, marketplace, social, price, and holder data can be stale, incomplete, censored, or manipulated. Discovery creates research candidates; it never establishes safety, authenticity, or expected profit.
