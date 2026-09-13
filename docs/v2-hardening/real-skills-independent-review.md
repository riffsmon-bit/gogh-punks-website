# Independent versioned real-skills review

## STATUS

**APPROVED for integration and a controlled, reversible code deployment.**
No open P0/P1/P2 findings remain. Two P2 integration findings were corrected and
independently verified. This review does not authorize public skill registration,
READY transitions, release additions, burns, signing or transaction submission.

Reviewed the skill changes introduced by `bf22022` and composed proof `96fbe7b`
at capabilities candidate `f2826b2`. Subsequent integration through `a251508`
changed none of the reviewed package, skill runtime, or composed-harness files. Market
execution and market UI changes are outside this review.

The endpoint/context increment is `8961449c060ed257d63f8735fdf02db1cb328a7a`
in the separate MCP checkout, based on `5699b09`. Its production scope is exactly
`art-broker-mcp.mjs`, `v2-mcp-research.mjs`, the new
`v2-mint-research-context.mjs`, and the pool wiring in `broker-v2-mcp.mjs`.
Final history follow-up: `47f5556bf70cabab5585f818a9c5ad7149bb159c`.
Parent-owned MCP packaging correction: `f403246`. Final context source SHA-256:
`61f5bbeacf1297d8a4160fc6b5d273ec97d19841ca9d007638fb604c86a65ba2`.

## FILES CHANGED

- `docs/v2-hardening/real-skills-independent-review.md`.
- `tests/real-skills-independent-review.test.mjs`.

## FILES INTENTIONALLY NOT CHANGED

No application seam, adapter, package, contract, deployment manifest, existing
test, browser state, credential, or public service was modified by this reviewer.
Unrelated untracked marketplace files were not staged or changed. No commit made.

## SUMMARY

The new Link Sniper v1 and Mint Hunter v1 manifests pin their exact adapter and
enumerated safety dependencies. Market Scout v2 pins its versioned reader. The
loader accepts only a fixed slug/version table, checks implementation identity,
and verifies source bytes. It returns unapproved `TESTING` packages. Registry
READY alone cannot promote an unapproved local package.

Calls require matching manifest/instruction hashes, chain identity, learned and
equipped state, available/READY registry definitions, and effective capability
masks. Exact version selection occurs from the equipped keys. Two equipped
versions are rejected as ambiguous. A version swap during the real Market v2
reader withholds its result even though both versions expose the same tool name.

The tool gate resolves state before and after provider work. Changed owner,
instruction package, effective tool, or authority epoch prevents result delivery.
For original collections, caller integration must also provide canonical transfer
continuity; owner equality alone cannot detect an away-and-back transfer.

Link Sniper delegates to the existing fixed-source Robinhood inspector. Caller
URLs identify contracts; they cannot select an RPC, resolver, recipient, or
transaction. Unsupported website/OpenSea/social sources stay unresolved. The
RPC transport allows only fixed read methods, rejects redirects, and bounds
requests, bytes, and deadline. Output explicitly disclaims mint eligibility,
security clearance, simulation, and transaction authority.

Mint Hunter resolves one shared opportunity and a current owner-bound confirmed
strategy from a server-owned context reader. It rejects paid/unscreened
opportunities, identity/hash mismatches, stale authority, unavailable usage, and
policy failures. Simulation uses the existing fixed zero-price, quantity-one
SeaDrop call through the selected Punk wallet, validates code/chain/canonical
anchors, and rereads strategy, balances, and usage. `prepare_mint` requires
ASSIST and returns a recommendation with `transaction: null`, `executable:
false`, separate owner confirmation and reservation requirements, and explicit
effect-trace/receipt limitations.

Market Scout v2 keeps exact decimal-string prices, binds collection/token/payment
identity, discards signatures/order payloads, and states when pagination or
provider coverage is partial/unavailable. It returns observations, never a
verified floor or executable purchase quote. No provider can supply a new tool.

## INTERFACES

`loadResearchSkillCatalog({selection})` keeps the three existing v1 defaults.
New versions require explicit server selection. `createResearchSkillRuntime`
accepts `mintContextReader({tokenId, owner, opportunityId})`; this service must
return confirmed strategy/hash/version, current canonical wallet/owner authority,
one shared opportunity, and usage including pending work. Missing context or
market credentials remove the corresponding tools.

The MCP bridge binds a selected token to the authenticated session and the live
canonical owner. Exact keys and both accepted hashes in the server's current
`OWNER_CANARY` release select local packages. Unknown versions have no v1
fallback. Fixed `skill_inspect_mint_link`, `skill_inspect_mint`,
`skill_simulate_mint`, and `skill_prepare_mint` aliases enter the equipment gate;
the original diagnostic names retain their previous semantics. Caller objects
cannot supply owner, usage, opportunity content, endpoint, calldata, version, or
capability controls. Unselected discovery remains the baseline catalog.

The new mint context reads the canonical Agent at one fresh block and verifies
registry/implementation pins, exact proxy bytes, ownership and balance. It uses
the latest ACTIVE/PAUSED strategy across owners, preventing fallback to an older
ACTIVE row. Current owner, confirmation, strategy hash, Agent wallet, lifetime,
screened shared opportunity and canonical history must agree. The bridge checks
training state and transfer continuity again after the actual adapter completes.
Strategy history uses raw fixed-topic `eth_getLogs`, contiguous inclusive
2,000-block pages, at most four concurrent workers, 512 pages, and an eight-second
deadline within the 30-second authority lifetime. It verifies original and final
block headers before and after the scan. Missing, malformed, oversized, partial,
out-of-range or reorged responses cannot become an approved empty history.

Application accounting reads all relevant confirmed acquisitions and unresolved
attempts, exact quantities, session/operation disagreement, and the fixed
selected-paid journal. Completed copies deduplicate by transaction/collection
using the largest per-source quantity. Lifetime and per-collection counting is
deliberately conservative; pending work counts today. Unknown legacy/V4/orphan
activity, invalid/future/imprecise counts, missing access, filtering RLS, or
selected-paid access to raw signed transactions makes usage unavailable.
Selected-paid reads use the existing restricted request-role pool and explicit
columns. The native PostgreSQL check proves hidden rows cannot become zero use.

These are read-only observations across separate stores, not an atomic execution
reservation. Mint Hunter repeats context and policy after simulation; later
execution still requires its own durable reservation and owner authorization.

## TESTS

Independently executed offline:

```sh
node --test tests/skill-forge-real-package-adapters.test.mjs \
  tests/skill-forge-research-runtime.test.mjs \
  tests/skill-forge-capability-resolver.test.mjs \
  tests/v2-hardening-market-reader.test.mjs \
  tests/v2-fixed-source-link-resolver.test.mjs \
  tests/owner-assisted-seadrop-mint.test.mjs tests/v2-swarm-policy.test.mjs
node --test tests/real-skills-independent-review.test.mjs
```

Results: **134/134** existing tests passed. The original eight independent
adversarial/evidence tests also passed, with no failures, skips, or cancellations.
The independent tests
use the actual Market v2 reader through the actual skill gate to reject an
equipped-version swap, a changed same-owner authority epoch, and a revoked mask
during provider work. They also verify local approval cannot be inherited from
registry READY, version/key/endpoint/transaction argument injection stops before
network work, transport errors stay sanitized, registration proposal bytes
reproduce the pinned packages, and the composed evidence matches its harness.

Independently executed in the committed MCP checkout:

```sh
node --test tests/v2-mint-research-history.test.mjs \
  tests/v2-swarm-mcp.test.mjs tests/v2-mcp-versioned-skills.test.mjs \
  tests/v2-mint-research-context.test.mjs tests/skill-forge-real-package-adapters.test.mjs \
  tests/skill-forge-research-runtime.test.mjs tests/skill-forge-capability-resolver.test.mjs \
  tests/owner-assisted-seadrop-mint.test.mjs
node tests/mint-research-context-postgres.integration.mjs --disposable-only \
  --postgres-bin=/private/tmp/gogh-postgres-native/bin
```

Results at `8961449`: **123/123** Node tests and **28/28** native PostgreSQL
assertions passed. At final `47f5556`, the complete focused command passed
**153/153** tests and the native PostgreSQL harness passed **28/28** again.
The new 30 history cases include complete multi-page success, a transfer in each
page and the final anchor, malformed/missing/oversized pages, bounded concurrency
and work, provider failure sanitization, origin/tip reorg, wrong chain, deadline,
freshness, and a real viem transport regression proving malformed raw logs cannot
be filtered into an approved empty page.

The native harness created and removed a private loopback
cluster, loaded the actual queried table DDL, used real read-only roles, and
verified permissions, selected-paid receipt/status semantics, transaction
deduplication, exact asset quantities, pending reservations, UserOperation/session
agreement and filtering RLS. It never loaded environment credentials.

A ninth independent test copies the MCP function's actual `included_files` into
a temporary root and invokes the real catalog loader for all six reviewed
versions, then checks the restricted database certificate's pinned fingerprint.
At `a251508` it reproduced the packaging issue below: **8 pass, 1 fail** with
`ENOENT` on a dynamically verified raw dependency source. An esbuild success
alone does not establish those filesystem reads. After the parent-owned
`netlify.toml` fix `f403246`, the full independent suite passes **9/9**, including actual
loading and pin verification of all six versions and the exact public CA
fingerprint. The temporary root is removed.

All provider responses and authority state used by this reviewer were local
fixtures. No public provider/RPC request, credential access, local fork, or chain
transaction was needed or performed.

## RESULTS

No P0/P1/P2 finding remains. The parent found and the author closed one P2
availability issue in the initial MCP context: a single historical
Transfer request can exceed the configured provider's 2,000-block range limit,
making otherwise valid older strategies unavailable. This fails closed and does
not grant wallet authority. `47f5556` adds bounded pagination with complete
coverage, transfer detection in every page, and common-anchor checks. The author
also found that viem's event-aware strict `getLogs` filters malformed/unmatched
logs; the final helper reads and validates raw pages. Independent source review
and all 30 history regressions confirm these corrections.

The independent packaging regression found and closed a second P2 availability issue:
`netlify.toml`'s `broker-v2-mcp` entry includes skill manifests and
`skill-forge/*.mjs`, but omits eight raw dependency source paths read by the new
Link/Mint hash verifier and the public Supabase CA read by the selected-paid
request runtime. Compiling their static imports does not preserve those raw
files at their expected runtime paths. A release selecting these packages can
therefore fail before discovery or during restricted database setup. This also
fails closed. Root added the raw discovery/v4/config sources and public CA to
this function's include list. Independent inspection and the packaged-root
regression confirm the correction without changing any manifest hash, TLS pin,
or adapter behavior. Other Forge functions still use the unchanged v1 default
selection and do not receive new public packages from this increment.

The stored registration proposal exactly reproduces the current package loader
and register-call encoder. It carries no sender/destination/nonce/fee envelope,
READY transition, production authorization, or broadcast operation. Those are
separate administrator and release decisions.

The composed evidence's `harnessSha256` matches the checked-in script exactly.
Its historical `sourceCommit` is distinct from the later evidence commit; the
Mint Hunter implementation hash at that source commit matches the current pin.
The reviewer inspected the script and evidence without executing the credential-
requiring/public-read harness. The evidence describes a copied chain, local
registration/training/transfer, real read-only OpenSea observations, and in-memory
strategy/usage records. It explicitly discloses a locally changed free drop,
locally funded Agent balance, unreviewed burn-source inventory in this particular
harness, no full effect trace, no mint submission, and no production DB access.
These results support adapter integration on the copied stack, not public
activation, safe source burning, or production DB integration.

## SECURITY

Relevant implementation evidence:

- `broker/src/v4/skill-forge/research-runtime.mjs`: fixed selections, adapter and
  dependency pin verification, exact equipped-version dispatch, fixed arguments.
- `broker/src/v4/skill-forge/capability-resolver.mjs`: fixed capability-to-tool
  mapping, fresh learned/equipped/READY/hash gate, and post-call context check.
- `broker/src/v4/skill-forge/link-sniper-v1.mjs` and
  `broker/src/v4/discovery/robinhood-link-resolver.mjs`: fixed read source and
  methods, bounded observations, no executable transaction output.
- `broker/src/v4/skill-forge/mint-hunter-v1.mjs`: trusted context binding,
  policy/usage checks, exact existing simulator, canonical recheck, recommendation
  without wallet authority.
- `broker/src/v4/skill-forge/market-reader-v2.mjs`: exact amounts/identity,
  sanitized failures, bounded fixed-host reads, honest coverage, no order payload.
- `broker/src/v4/mcp/art-broker-mcp.mjs` and
  `netlify/functions/_shared/v2-mcp-research.mjs`: authenticated selection, fixed
  aliases/arguments, exact release keys and hashes, existing before/after training
  owner continuity, sanitized dependency errors, no added signing or write tool.
- `netlify/functions/_shared/v2-mint-research-context.mjs`: anchored canonical
  Agent authority, confirmed current-owner strategy, fixed database scope,
  visibility checks, conservative usage, and restricted selected-paid columns.

The Mint Hunter response deadline does not cancel an arbitrary injected context
reader or RPC client. Its underlying read-only work depends on the configured
service/transport deadlines, as the implementation documentation states. No
late operation may sign or submit; neither ability is supplied to this adapter.

## DEPENDENCIES

No new package dependency. Existing viem, fixed runtime pins, server-owned RPC
configuration, optional OpenSea credential, and a reviewed context service are
required. New package hashes do not authorize public registration or promotion.
Original accepted v1 packages and capability-bit meanings are preserved.
The MCP client uses the configured Forge archive primary at existing pair index
1. Selected-paid #93 accounting also requires the existing restricted Forge
request database configuration. The 1,000-review cap fails closed above its bound;
larger history needs separately reviewed pagination or aggregation.

## BLOCKERS

No remaining code-review blocker for the reviewed commits. No adapter
interface change was required. Public registration,
review/READY transitions, and new server release entries remain separate gates;
none is performed or authorized by this code review.

## INTEGRATION NOTES

This review owns only the two new files listed above. The integration owner owns
production seams and any required fixes. A successful copied-chain journey does
not waive public registration, server release selection, current-owner checks,
transfer continuity, or separate economic authorization.

Integrate both MCP commits (`8961449`, then `47f5556`) together with packaging
`f403246` and the two review files. Parent owns the combined repository build,
full validation and deployment. The Node suites overlap; their counts are
reported separately rather than added into a misleading unique-test total.
No public service was contacted and no transaction or credential operation was
performed during this independent review.
