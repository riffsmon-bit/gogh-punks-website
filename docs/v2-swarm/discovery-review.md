# Shared discovery and link review

Reviewed September 13, 2026 on `v2/swarm-discovery`, based on `f00b2b5` and the
shared V2 contracts. Production scope is Robinhood mainnet, chain 4663. This
change does not introduce another scanner, opportunity schema, or execution lane.

## Implemented boundaries

`broker/src/v4/link-scanner.mjs` now rejects all IPv4 and IPv6 literals, including
numeric IPv4 aliases, mapped IPv6, loopback, link-local, private and CGNAT
addresses. Public IP literals are also unsupported, matching the conservative
DNS-name policy in the existing social candidate normalizer. Local domain
suffixes and unqualified hostnames are rejected. DNS labels are validated after
WHATWG normalization; one terminal DNS root dot is removed before classification.

Raw whitespace/control characters, backslashes, incomplete authorities,
credentials (including empty userinfo), explicit ports (including 443), encoded
authority delimiters, fragments and malformed percent escapes are rejected.
Recognized platforms reject parser-repaired/repeated path separators, malformed
identities and unsupported query data. Supported OpenSea collection/drop and X
post links retain canonical identities. X handles must be syntactically valid;
the optional numeric `s` share parameter is discarded.

The existing `ROBINHOOD_CONTRACT` shape remains unchanged and now identifies only
the two already-supported mainnet explorer hosts. Every link to the recognized
testnet explorer fails with `UNSUPPORTED_CHAIN`, before any resolver runs. An
unsupported path on a recognized explorer does not fall through into a project
website resolver. Lookalike domains remain ordinary, unresolved website links.
No chain field, new resolver kind or stored opportunity field was added.

Link inspection remains advisory: missing resolvers return `NEEDS_REVIEW`, and
inspection always returns `executable: false` and
`externalTransactionAccepted: false`, even if injected trusted evidence claims
otherwise. No fetcher, wallet request, external calldata path or resolver was
added. Existing API handlers and MCP callers keep the same successful return shape.

The lead approved a follow-up endpoint-local HTTP error mapping in the production
and review inspect handlers. `ArtBrokerLinkError` instances with the four known
input-error codes now return HTTP 400 with their public code/message. Ordinary
errors, errors merely claiming a matching code, and `INVALID_RESOLVER_RESULT`
still use the existing safe 503 response. Global `v2Failure` is unchanged.
Production exposes a named handler with injectable server dependencies for
offline tests; its Netlify default wrapper supplies no overrides. Origin,
session and current-owner checks still precede link inspection.

The lead explicitly extended file ownership to
`broker/src/v4/postgres-opportunity-repository.mjs` after the audit reproduced
dedupe identity drift. Its conflict update now preserves the existing row's
`opportunity_id` and `first_seen_at` in the normalized JSON and returns the
persisted normalized record. Previously the row retained its original ID while
the JSON could contain the incoming source's different ID and creation time.

The lead also approved monotonically ordered opportunity updates: an incoming
`updated_at` older than the stored observation cannot overwrite the normalized
payload, screening/simulation status, risk, expiry or update time. Such an
observation may add a distinct source, but it cannot overwrite an existing
source's URL/evidence. Source discovery time still preserves the earliest
reported time through `LEAST`. Equal update timestamps retain last-writer
behavior. There is no schema migration or new evidence clock.

## Existing shared pipeline verified

- `readCurrentRobinhoodSeaDropObservations` scans the shared confirmed SeaDrop
  source, pins contract reads to one confirmed block, and returns event
  transaction/block provenance plus the inspection block hash.
- `seaDropObservationToOpportunity` uses the existing strict
  `GOGH_NORMALIZED_OPPORTUNITY_V2` normalizer and shared dedupe key. The key binds
  chain, collection, mint contract, stage and adapter. It excludes Punk identity,
  receiver, source label and display metadata. Discovery candidates have a null
  receiver and `UNAVAILABLE` simulation; screening does not grant eligibility.
- `SharedV2DiscoveryEngine` keeps one candidate per dedupe key, distinct source
  identities, original ID/creation time, and one in-flight analysis per
  opportunity/input hash. No per-Punk scanner was created.
- The PostgreSQL repository keeps source provenance under the persisted
  opportunity ID in the same transaction as opportunity ingestion. Its existing
  analysis cache and all schema/role definitions were left unchanged.

## Remaining limits and proposed follow-ups

1. **Normalization is not DNS-rebinding protection.** An accepted domain can
   resolve to a private address or redirect to one. No DNS resolution, peer-IP
   validation or redirect following occurs here. Before adding a generic fetch
   resolver, its owner must define an allowlisted source boundary or implement
   destination validation for every resolution/connection and redirect, block
   nonpublic addresses, bind the validated address to the connection while
   preserving TLS hostname checks, and bound redirects, duration and streamed
   response bytes. URL acceptance alone must never authorize a fetch or wallet
   request. Current production inspect callers provide no generic resolver.
2. **Opportunity URL policy is still weaker.** The unchanged `publicHttps` helper
   in `opportunity.mjs` accepts some IP/local forms rejected by this scanner.
   Opportunity metadata/source URLs are not safe-fetch capabilities. A future
   coordinated normalizer change should align syntactic URL rules without
   treating them as network safety or altering the stored schema. No shared
   normalizer was edited in this branch.
3. **Ingestion clocks are not authenticated chain freshness.** The store's
   ordering compares opportunity `updatedAt`. The ingestor sets that from its
   ingestion clock; a stale observation given a new ingestion time can still
   look newer. `screenSeaDropDiscoveryObservation` does not independently bound
   `checkedAt` age or authenticate block canonicality. The source reader uses a
   configured Robinhood RPC but does not assert its chain ID. A coordinated
   source/screening change should bind network identity and canonical pinned
   blocks and define maximum evidence age; execution must retain independent
   fresh simulation/code/owner checks meanwhile.
4. **Source evidence has no independent last-observed clock.** Guarding source
   conflict writes by the current opportunity time conservatively avoids known
   older overwrites. It cannot order equal timestamps or express independent
   source freshness. Earliest `discovered_at` is not a last-verified timestamp.
   The in-memory engine also retains its existing last-ingested update behavior;
   it was not rewritten to match the production store's new ordering rule.
5. **Historical rows were not repaired globally.** A subsequent conflict ingest
   repairs that row's normalized ID/creation time from its persisted columns.
   Existing corrupted JSON rows that are never ingested again need a separately
   reviewed data audit/repair. No migration, operational query or production
   write was performed here.

## Validation and integration

Added `tests/v2-swarm-discovery-links.test.mjs` with fourteen focused tests. URL
matrices cover the reproduced IPv6/CGNAT cases, numeric aliases, local suffixes,
authority/path ambiguity, mainnet/testnet separation, canonical output and the
advisory execution boundary. One integration test uses the real shared chain
reader with mocked RPC/database sources, the real SeaDrop converter, link
normalizer, shared engine and analysis cache. Unreviewed fixture bytecode remains
blocked; duplicate observations share one opportunity and source identity, while
another mint stage gets another key.

One coordinated in-memory PGlite instance executes the real repository SQL
against opportunity/source table definitions extracted directly from
`20260906010000_create_art_broker_v2.sql`. It checks both returned and persisted
identity/time, newest normalized and indexed state, source foreign-key identity,
older conflicting evidence, additional older provenance and equal-time
compatibility. This is an actual PostgreSQL query test, not a SQL-string mock;
it does not claim native multi-connection concurrency or production validation.

Passed: `node --test --test-concurrency=1 tests/v2-swarm-discovery-links.test.mjs
tests/art-broker-v2-pipeline.test.mjs tests/art-broker-v2-discovery-ingestor.test.mjs`
— 31 tests, zero failures, approximately 6.7 seconds. No package installation,
full build, browser, native PostgreSQL server, contract execution or network
request was needed. The shared `node_modules` symlink remains untracked.

The endpoint follow-up passed seven focused checks with
`node --test --test-concurrency=1 --test-name-pattern='inspect endpoint|review link inspection'
tests/v2-swarm-discovery-links.test.mjs tests/art-broker-v2-review-functions.test.mjs`.
These cover all four input error codes in both real handlers, safe 503 handling,
origin/session/owner rejection ordering and unchanged advisory success. The
preview's existing wrong-origin 404 and production's 403 are preserved. This
follow-up did not rerun PGlite or contact any service.

Only the link scanner, approved opportunity repository, two approved inspect
handlers, new test and this review document belong to these commits.
Shared-schema/AI/MCP/contracts/migrations/UI,
source readers, security/policy modules, dependencies and deployment settings
remain unchanged. The lead owns integrated full validation. No production
burn/refund/sweep, activation, wallet transaction or deployment was attempted.
