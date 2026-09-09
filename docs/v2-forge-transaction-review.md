# Training transaction review — local-only checkpoint

This extends the shared Control Center training prototype. It does **not** deploy production progression, enable burns, install wallet modules, or request the owner's real wallet signature.

## Prepared transaction boundary

The loopback `/api/local-training/prepare` route checks current ownership and pinned progression state, accepts only learn/unlock/equip/unequip on fixed test Punks, simulates, estimates gas and prepares an immutable zero-value transaction. The review binds token, owner, contract, exact calldata, credit cost, gas limit/price and expiry. Preparing/canceling does not broadcast.

`/api/local-training/confirm` accepts only the opaque prepared intent ID, never replacement transaction fields. It rechecks chain, owner, credits/loadout and simulation before asking the configured local signer to send. The shared browser independently validates fixed ABI encoding, destination, value and gas bounds before displaying confirmation.

The EIP-1193 adapter uses only `eth_chainId`, `eth_accounts` and an explicit `eth_sendTransaction`. It never auto-connects or adds/switches a chain. Only chain 31337 is accepted. The test harness supplies its own disposable Anvil provider; the real browser MetaMask extension is **not connected by this release**.

## Retry and receipt semantics

- A known transaction hash is reconciled, never submitted twice.
- Concurrent reviews for the same Punk cannot send while another request is unresolved.
- Rejected, invalidated/expired, awaiting-wallet, submitted, reverted, confirmed and submission-unknown outcomes are distinct.
- A missing hash after a transport/signer failure is ambiguous; it blocks new submissions for that Punk. Retrying the same intent cannot erase this blocker.
- Confirmation requires a successful receipt on its canonical block, the exact transaction sender/destination/calldata/value, reviewed fee bounds, and the matching progression event. Wrong event, wrong transaction or reorg evidence never awards displayed training.
- The UI has a receipt-recheck action for pending/uncertain requests and does not display a successful learn/equip before confirmation. Follow-up snapshot failures leave state unavailable rather than fabricated.
- Receipt recheck uses a separate status route that never calls a wallet. If the original confirmation never reached the server, it reports NOT_SUBMITTED instead of secretly broadcasting on a status check.
- The legacy standalone local practice route now shares the same transaction coordinator, rather than bypassing pending/retry protections.

## Durable local recovery checkpoint — September 9, 2026

The local harness now supplies a disk-backed SQLite journal to the coordinator. It persists the prepared review, a claim **before** any wallet request, and the returned transaction hash before receipt reconciliation. WAL with FULL synchronization, compare-and-swap revisions and a per-Punk unresolved-request uniqueness constraint prevent stale coordinators from creating a second submission. Status-only reads do not take a new revision from an in-flight wallet writer.

The journal is bound to the same test deployment: chain, genesis, collection, registry, progression, owner and contract code hashes. New files are created with mode 0600 and contain no private keys. Payload checksums detect corruption; they are not protection against an administrator who can rewrite both data and checksum. Storage failures fail closed. A crash after a pre-wallet claim without a known hash requires recovery; it never becomes permission to send again.

Browser reload obtains verified current state and queries the journal with the current local nonce. Unresolved work locks new training controls and exposes receipt recheck, which cannot call a wallet. Tests reopen the coordinator against the **same live disposable Anvil deployment** and also reopen a journal written by an exited child process. Restarting the entire preview command still creates a **new** disposable chain and journal; it is not a production persistence service.

Local snapshots now bind reviews to the latest parent-token Transfer event. A transfer away and back to the same owner invalidates the old review without erasing learned skills, credits or equipment. This covers local training reviews only; it does not claim to implement production automation transfer handling.

The adapter uses [Node 24's built-in SQLite API](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html), which emits an experimental-feature warning in the tested Node 24.14.1 runtime. It is deliberately not bundled into the production Netlify endpoint.

## Explicit limitations before production

Production still requires a reviewed durable database adapter (including concurrent workers, nonces and recovery), deployment configuration, ownership-epoch indexing and chain finality/reorg reconciliation. The browser wallet-attempt set is only an additional in-memory guard; the local coordinator journal is the durable authority in this harness. Do not use this local coordinator against real assets.

Review expiry is checked before invoking the wallet. The existing progression ABI has no on-chain deadline or state-version argument; a signature approved much later in a wallet cannot be canceled by an off-chain expiry. Production design must explicitly address this limitation and owner transfer/ownership-epoch behavior, not claim the UI enforces on-chain expiry.

No production burn source exists. Burn safety, all-generation wallet assets, recovery, approved supply floor, production registry acceptance and economic-session integration remain separate gates. Existing live V2 mint permissions are unchanged.

## Test evidence

Unit and disposable-chain integration tests cover exact ABI, gas/value tampering, owner/chain/state/expiry changes, duplicates, concurrent review attempts, delayed/missing receipts, ambiguity, rejection, wrong event/calldata/fee and receipt reorg checks. EIP-1193 tests verify no send for wrong account/chain/state and no automatic retry. Real HTTP tests prove prepare is non-mutating and duplicate confirm produces one SkillLearned event.

Shared-component Chrome tests also pass learn/equip/unequip, explicit gas/expiry review, cancellation, gated live PublicNode research and desktop/mobile rendering. No production skill is promoted to READY by these tests.

Previous checkpoint results: 81 targeted JavaScript tests passed, including 20 transaction/wallet-boundary cases; 29 contract tests passed with 1,024-run fuzz cases; 15 V2 endpoint/chat/collection regressions and both shared-component browser flows passed.

Durable-recovery checkpoint: all 121 Skill Forge JavaScript tests passed, including 31 transaction/wallet/journal cases. All 14 selected V2 Forge/chat/collection regressions and 29 contract tests passed, with 1,024 runs per fuzz case. The shared training browser test passed pending receipt → coordinator restart → page reload → same-hash confirmation, followed by learn/equip/research/unequip and selection changes at 1440/390/375px. The V2 research-only browser regression and standalone Forge browser suite also passed. Changed modules passed syntax and whitespace checks. No production deployment or main-branch change was made.

The refreshed local scenario is available on this Mac at `http://127.0.0.1:64341/control-center`. Restarting reset only disposable practice credits/history. Test #44 again has one mock-earned credit for the learn → equip → research flow.
