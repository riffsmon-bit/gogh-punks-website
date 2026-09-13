# Fixed-source Robinhood link inspection

Implemented against `7d4f4a1` on September 13, 2026. This completes one real
inspection path behind the existing normalized-link resolver map. It does not
create another discovery pipeline or stored opportunity schema.

## Supported interface

`createRobinhoodLinkInspector({ fetchImpl, now, timeoutMs, environment })` returns
an async `inspect(url)` function. Its production wrapper is
`inspectRobinhoodArtBrokerLink(url)`. Dependencies are server-only test/config
inputs; the HTTP body still accepts exactly `tokenId` and `url`. The production
inspect endpoint uses this wrapper by default and preserves its existing
injectable handler interface, authentication, origin and owner checks.

Only `ROBINHOOD_CONTRACT` gets a resolver. OpenSea, X and project-website links
retain `NO_TRUSTED_RESOLVER`. Testnet/private/malformed links are rejected by the
unchanged strict scanner before any RPC call.

Contract inspection reuses `skill-forge/research-tools.mjs:inspectContract` for
code hash/size, ERC-721/ERC-1155 responses and limited proxy observations. Mint
inspection supports the existing reviewed SeaDrop collection runtime hashes,
and verifies the fixed SeaDrop runtime hash before reading its public drop.
It reads collection `getMintStats(address(0))` for collection totals, ignoring
the zero address's wallet-specific count, plus the fixed fee-recipient state.
Unsupported collection runtimes retain real contract evidence with mint state
`UNSUPPORTED`; missing or reverted mint data is `UNKNOWN`, never zero price.

Resolver evidence includes `status`, `reason`, `source`, `chainId`, `contract`,
`observedAt`, `anchor`, the existing `contractInspection` result, `mint`, and
explicit execution limitations. `anchor` contains decimal `blockNumber`,
`blockTimestamp`, hex `blockHash`, and `canonicalRechecked: true`.
`mint` exposes `status`, `standard`, `mintContract`, `priceWei`, `startTime`,
`endTime`, `walletLimit`, `totalMinted`, `maxSupply`, `feeRecipientAllowed`,
`publicWindow`, and `reason`. Amounts/counts/times are decimal strings or null.

No path returns security/simulation `PASSED`. Results are `NEEDS_REVIEW`, or
`BLOCKED` for an address without contract code. `simulationStatus` remains
`UNAVAILABLE`; `transactionPrepared`, `externalCalldataAccepted` and
`executionAuthorized` are false, and `walletAuthority` is `NONE`. The unchanged
outer inspector also fixes `executable` and `externalTransactionAccepted` false.

## Network and evidence boundary

- RPC selection uses server-owned `ROBINHOOD_ARCHIVE_RPC_URL` when configured,
  otherwise fixed `https://rpc.mainnet.chain.robinhood.com`. Configuration must
  pass strict credential-free HTTPS/DNS syntax. No user field selects an RPC.
  Source URLs, provider paths/keys and upstream error messages are never emitted.
- Only five fixed read methods are available internally: `eth_chainId`,
  `eth_getBlockByNumber`, `eth_getCode`, `eth_getStorageAt` and `eth_call`.
  Calls contain locally encoded view selectors. There is no signer or send path.
  Redirects and CCIP reads are disabled; no submitted link is fetched.
- Each inspection has at most 20 RPC reads, an eight-second total deadline,
  256 KiB per response and 1 MiB aggregate response bytes. Code/call result hex
  has an additional 64 KiB limit. Streaming readers cancel on deadline and exit;
  the outer deadline also handles an injected fetch ignoring abort.
- Contract and mint reads share one latest block. The chain must be 4663 and
  the anchor timestamp must be no more than 120 seconds old or 30 seconds ahead.
  Chain ID and the exact block number/hash/timestamp are reread before evidence
  returns. Wrong chain, stale/changed anchor, malformed or excessive transport
  data discard all observations with `INSPECTION_UNAVAILABLE` and null anchor.

This is one-source, latest-block evidence, not finalized multi-provider proof.
Interfaces may lie, nonstandard proxies and implementation behavior remain
unreviewed, and public-window/supply data cannot establish a selected wallet's
eligibility. Paid mint execution is not enabled. Future project/OpenSea/X
resolvers require their own reviewed source and identity boundaries.

## Validation and live acceptance

Passed 18 tests with `node --test --test-concurrency=1
tests/v2-fixed-source-link-resolver.test.mjs tests/skill-forge-research-tools.test.mjs`.
Coverage includes the real contract reader/ABI, existing runtime pins, price
zero versus unavailable, mint windows/sold-out/fee observations, no-code,
wrong/changed/stale anchors, malformed and excessive optional probes, total
deadline/stream cleanup, server-only source selection, secret suppression,
OffchainLookup rejection, and production default dependency wiring.

The existing six inspect-endpoint compatibility tests also passed using
`--test-name-pattern='inspect endpoint' tests/v2-swarm-discovery-links.test.mjs`.
No PostgreSQL/browser/contract suite or package installation was run here.
Compressed fixtures contain only public SeaDrop/Peppies runtime bytes; their
hashes are asserted against existing source constants, without adding trust pins.

Initial live read-only acceptance used the default factory and fixed public RPC:

| Collection | Observation | Anchor |
| --- | --- | --- |
| Peppies `0xb73f1d1aee57410d537d87b656e98b9d3df5b213` | At 2026-09-13T19:02:48.573Z: ERC-721 observed, reviewed 45-byte runtime, SeaDrop window OPEN, price 100000000000000 wei, wallet limit 50, total minted 1599, max supply 2222, fixed fee recipient allowed. | Block 62189723, hash `0xc30064145c88a7dd87574ee1184d45e4bbd27729e3d9a23b7a9328e6e851fb32` |
| Gogh `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6` | At 2026-09-13T19:02:51.490Z: ERC-721 observed, 18470-byte runtime; mint state explicitly UNSUPPORTED, price/supply null. | Block 62189765, hash `0xe81abc79b90927a01162498447f01f11ed829ec541326979c782abfe266e62e5` |

Both anchors were canonically rechecked on chain 4663; both outer statuses were
NEEDS_REVIEW with simulation UNAVAILABLE and all execution flags false. These
are historical inspection observations, not current availability promises.
No wallet request, signing, burn, funding, refund, activation or transaction was
performed. The lead owns frontend presentation and integrated validation.

Final wrapper acceptance at 2026-09-13T19:09:25–26Z is recorded verbatim in
[`fixed-source-link-live.json`](fixed-source-link-live.json). Peppies repeated
the observed state at block 62193686; Gogh repeated its explicit unsupported
mint result at block 62193691. That run used the exported production wrapper
after adding explicit CCIP-read disabling and contains no provider secrets.

Final local SHA-256 hashes for review:

| File | SHA-256 |
| --- | --- |
| `broker/src/v4/discovery/robinhood-link-resolver.mjs` | `e252a62a7e0f1b558268b923d22683cac697134be48ac30fd45e068422ead719` |
| `netlify/functions/broker-v2-inspect-url.mjs` | `e6cc3a5b7e1e0e83f62eceedd8fbacbc780ff13ce29bf97b36de1d7acc880e27` |
| `tests/v2-fixed-source-link-resolver.test.mjs` | `2eb83942aaf7687d8186e565d0910a8c85b2fa2b440de5a08e79151dc17977b0` |
| `tests/fixtures/fixed-source-link-runtimes.json` | `6b50d3d479b80feccff44be231a1597e6a950905c6b8379db8fa3dc54bfc7f61` |
| `docs/v2-swarm/fixed-source-link-live.json` | `fbeba6437903ac962669b34f394c493fca068db937eefbae2e7e407a134207ce` |
