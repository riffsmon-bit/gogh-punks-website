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

## Explicit limitations before production

The review store and wallet-attempt ledger are in memory and reset when the disposable process restarts. Browser pending-review navigation state also is not a durable production journal. Production requires persisted intents/nonces, recovery on reload/restart, chain finality/reorg reconciliation and reviewed deployment configuration. Do not use this local coordinator against real assets.

Review expiry is checked before invoking the wallet. The existing progression ABI has no on-chain deadline or state-version argument; a signature approved much later in a wallet cannot be canceled by an off-chain expiry. Production design must explicitly address this limitation and owner transfer/ownership-epoch behavior, not claim the UI enforces on-chain expiry.

No production burn source exists. Burn safety, all-generation wallet assets, recovery, approved supply floor, production registry acceptance and economic-session integration remain separate gates. Existing live V2 mint permissions are unchanged.

## Test evidence

Unit and disposable-chain integration tests cover exact ABI, gas/value tampering, owner/chain/state/expiry changes, duplicates, concurrent review attempts, delayed/missing receipts, ambiguity, rejection, wrong event/calldata/fee and receipt reorg checks. EIP-1193 tests verify no send for wrong account/chain/state and no automatic retry. Real HTTP tests prove prepare is non-mutating and duplicate confirm produces one SkillLearned event.

Shared-component Chrome tests also pass learn/equip/unequip, explicit gas/expiry review, cancellation, gated live PublicNode research and desktop/mobile rendering. No production skill is promoted to READY by these tests.

Checkpoint results: 81 targeted JavaScript tests passed, including 20 transaction/wallet-boundary cases; 29 contract tests passed with 1,024-run fuzz cases; 15 V2 endpoint/chat/collection regressions and both shared-component browser flows passed. Changed modules passed syntax checks. No production deployment or main-branch change was made.

The refreshed local scenario is available on this Mac at `http://127.0.0.1:64341/control-center`. Restarting reset only disposable practice credits/history. Test #44 again has one mock-earned credit for the learn → equip → research flow.
