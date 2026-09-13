# Independent V2 security review

Initial candidate reviewed September 13, 2026 at `d7a3c8c` on `v2/swarm-security-review`: baseline `eec4562`, shared identity contracts, AI boundary `145ed2b`, MCP `040d759`/`bfce53a`, and Agent recovery `792afd0`/`d7a3c8c` (cherry-picks of `a5d1301`/`86ef901`). Final integrated frontend/discovery changes are **not yet reviewed**. No deployment or autonomous activation is approved by this report.

**Initial result: BLOCKED by Q-01.** Existing implementation tests all pass, but an independent adverse test demonstrates submission of a different amount from the review displayed in the confirming tab. Passing the implementation's own tests is insufficient evidence to accept this candidate.

## Findings

### Q-01 — P1 blocker: another tab can replace the transaction behind an existing confirmation

Source: `site/punk-agent-recovery.js:251`–`260`, especially the fresh `read()` at line 252. Related shared-journal mutations are at lines 241–249. Proof: `tests/v2-swarm-security-review.test.mjs:77`.

Reproduction uses two ordinary same-owner, same-Punk controllers with shared storage and working exclusive Web Locks. Tab A prepares and displays a native withdrawal of 100 wei. Tab B cancels that review and prepares 900 wei. Tab A still displays 100 because its render callback has not received B's state. Calling A's confirmation rereads B's review from shared storage, successfully repeats server/browser checks, and requests the mock wallet transaction for **900 wei**. The independent test decodes the actual requested calldata and fails with `Tab A displayed 100 but submitted 900 wei`.

This does not bypass on-chain current-owner authority or permit arbitrary calldata. It breaks the owner's explicit review/confirmation boundary without any storage attack, compromised RPC, malformed transaction, secret, or real wallet interaction. Locks prevent simultaneous writes; they do not identify which review the user approved. All four recovery actions share this path.

Required scope: B must require `submit({ expectedReview })`, validate the immutable review actually rendered to the user, and compare the full normalized review with the durable PREPARED record while holding the lock **before** fresh preparation, wallet reads or submission. A missing or changed approval snapshot must fail closed. M must supply that exact rendered snapshot at the explicit confirmation event, including reviews restored after reload; taking a new `getState()` snapshot at click time would preserve the bug. The proof already supplies this proposed argument, which the current implementation ignores. Parent and frontend owner were notified immediately.

### Q-02 — P2 display-integrity limitation: terminal browser records are not verified receipt evidence

Source: `site/punk-agent-recovery.js:163`–`175` and `:240`. Proof: the terminal-journal characterization in `tests/v2-swarm-security-review.test.mjs`.

A stored object with a valid typed review but `status: "CONFIRMED"`, `transactionHash: null`, and `receipt: null` passes `getState()` without a chain read. `receipt` has no validation, and `prepare()` trusts terminal status to allow replacing the record. The same shape does not arise from the module's normal successful transitions; this proof deliberately edits local test storage to establish the trust boundary.

This is not evidence of an external exploit or of arbitrary wallet authority: same-origin script execution or intentional local storage modification already crosses the browser integrity boundary, and new submissions still need owner wallet approval and live checks. Do not represent a restored journal label as independently verified chain evidence. Recommended bounded scope: reject impossible status/hash/receipt combinations, preserve unresolved evidence on corruption, and distinguish restored local status from freshly reconciled transaction status. A local checksum or stricter schema cannot make malicious same-origin writes trustworthy. Browser storage deletion/loss remains the documented external limitation.

### Q-03 — P2 semantic limitation: an NFT transfer event does not prove resulting custody

Source: `site/punk-agent-recovery.js:220`–`237`. Proof: the event-confirmed NFT characterization in `tests/v2-swarm-security-review.test.mjs`.

The recovery controller correctly requires an exact canonical confirmed transaction and the matching ERC721 Transfer / ERC1155 TransferSingle event. It does not read post-transaction ownership or balance before assigning `CONFIRMED`. The mock proof supplies that exact event and leaves the asset's `ownerOf` response at the Agent account; recovery still returns `CONFIRMED`, and reconciliation performs no asset state read. An arbitrary nonstandard or malicious asset can emit an event without changing custody. This is a limit on what the evidence establishes, not evidence that a standard NFT transfer has failed or that wallet authorization was bypassed.

Recommended scope: UI success should say the transaction and transfer event were confirmed and direct users to refresh verified collection holdings; it must not claim independently proven resulting custody solely from this status. B/M can add bounded live holdings evidence if useful, but historical post-state RPC should not become an unconditional dependency for ordinary owner recovery during the already documented archive-provider outage. Live custody later changing is also not proof that the original transfer failed.

## Independently inspected boundaries

- Recovery API requires the V2 owner session and same-origin/review-preview guard, accepts exactly one typed intent, and derives owner from the session. The core rechecks the original NFT owner and separately registered Agent account; V3 custody is not confused with Agent or EntryPoint custody. Core viem encoding and the browser's separate fixed encoder agree on only NATIVE, ENTRY_POINT, ERC721 and ERC1155 owner-destination calls. Added destination, operation, approval or calldata fields are rejected.
- Core preparation pins one fresh numbered block, checks canonical closure, immutable registry/implementation/runtime footer, owner, confirmed/pending nonce equality, gas/fee bounds, balances/reserve, asset interface/custody and exact call simulation. Browser repeats chain/owner/runtime/nonce/balance/session/asset/simulation checks. This establishes constrained owner recovery, not an AI or skill execution grant. The review boundary flaw is Q-01, despite these checks being present.
- Durable WALLET_REQUESTED is written and read back before `eth_sendTransaction`; Web Locks are required. Unknown wallet responses and read outages retain unresolved state. Corrected pasted hashes work after an unrelated/missing/unavailable candidate: candidate identity is now checked before binding, and a verified hash is saved before receipt reads. Existing wrong-hash and outage tests were rerun successfully. Exact nonce/gas/price matching deliberately excludes wallet fee edits and replacements; no replacement support is inferred.
- Recovery still uses deployed `onlyTokenOwner` methods. The original-NFT away-and-back session issue in W-02 remains real and unchanged. Recovery does not establish ownership epochs, revoke already released signatures, or justify weakening managed-worker canonical transfer-history continuity. No execution/worker source changed in this candidate.
- AI transport now checks HTTP status before untrusted error bodies, bounds actual stream bytes and application completion time, cancels failed reads, and drops raw transport causes. Explicit incomplete output remains terminal before chat/draft acceptance; missing completion markers remain documented compatibility behavior, not proof of completion. Draft normalization continues to reject chain/Punk/owner/wallet identity changes and supplies no economic authorization. Inspected public V2/MCP failure paths do not expose raw transport causes. This is not a claim that every internal error anywhere in the repository has been redacted.
- MCP selected research discovery and invocation use server-owned released packages, fresh current-owner progression and the same native runtime gate. Invocation rechecks capability state, training nonce/state hash and canonical ownership continuity before returning results. Caller-controlled capability, package, owner, contract and calldata fields are rejected. `UNAVAILABLE` uses null skill values, not fabricated empty equipment. Baseline owner diagnostics remain available independently of equipment.
- MCP source trust comes from server release pins, exact manifest/instruction hashes, loader implementation hashes and fixed native handlers; model/provider text does not add tools or signing. Market/rarity responses remain bounded read evidence. MCP generic dependency errors are replaced by fixed public messages, and history/cached simulation labels explicitly avoid claiming live holdings or fresh execution evidence.

## Validation and integration status

All verification was read-only or local mocked I/O. No secret/key read, real wallet request, RPC call, production transaction, burn/refund/sweep, deployment, migration apply, install, browser or heavy integration suite occurred. Public runtime bytes were reused from B's documented offline fixtures and checked against pinned hashes; the independent test uses its own controller/provider/journal setup rather than B's test helpers.

Executed:

```sh
node --test --test-concurrency=1 tests/punk-agent-recovery.test.mjs tests/punk-agent-recovery-api.test.mjs tests/v2-swarm-ai.test.mjs tests/v2-swarm-mcp.test.mjs
```

Result: **111 passed, zero failed/skipped**. These include corrected-hash recovery and AI/MCP adverse checks. Separately:

```sh
node --test --test-concurrency=1 tests/v2-swarm-security-review.test.mjs
```

Result on initial candidate: **two characterization tests passed; Q-01 security assertion failed as expected**. The failing proof must become green through a source/UI fix, not a weaker assertion. Parent owns final integration and heavy gates; final frontend/discovery review remains outstanding.

Only this report and its independent proof test are owned/changed by Q. Production modules, API handlers, browser implementation, contracts, deployments, migrations, existing tests and the untracked `node_modules` symlink are intentionally untouched. Dependencies are the existing viem installation, B's public offline runtime fixtures and the agreed recovery API. No new runtime dependency is introduced.
