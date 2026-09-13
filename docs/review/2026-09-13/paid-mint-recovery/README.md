# Paid mint expiry and archive recovery

Punk #93's first live paid budget was confirmed, but the worker did not sign or submit a mint. The worker reread the authorization's historical mission state before checking its deadline. PublicNode rejected archive requests, so each worker invocation failed ahead of expiry handling. The UI continued to describe the confirmed budget as waiting for execution after its deadline.

## Live observations before this fix

Read-only observations at 2026-09-13T13:34:50Z:

- Authorization: `0x88eade00ec23896859174e28f66a36b49bac25a9dda6606840ab62a4cafc87e3`, block 61960018, confirmed by both providers.
- Mission deadline: 2026-09-13T12:41:08Z. Generation 1 still has the contract's ACTIVE enum, which does not automatically change when time expires.
- No execution row or worker transaction was recorded.
- Both providers reported 183954000000000 wei in #93's vault: 100000000000000 wei mint price and 83954000000000 wei unused worker fee.
- Forge was enabled. The #1753 approval review was PREPARED, without a reported transaction hash, and expired at 2026-09-13T12:41:21Z. No burn or training credit was confirmed.

## Change

- Stop confirmed, unsigned missions from fresh agreed state before historical receipt reads. Existing signed transactions retain their original reservation and bytes.
- Verify historical contract storage, pinned code, canonical anchors and ownership event logs on two distinct hosts before preparing or claiming a new budget. The production readiness probe covers 20,000 blocks.
- Use the existing private `ROBINHOOD_RPC_URL` and `ROBINHOOD_SECONDARY_RPC_URL` for archive reads, independently of the public automation override. Optional `ROBINHOOD_ARCHIVE_RPC_URL` and `ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL` can supply dedicated archive endpoints. These belong in Netlify Functions / Production. No credential is returned or logged.
- Preserve cancellation, refund and expired unsigned-job recovery when archives are unavailable. Record sanitized per-provider readiness in scheduled-worker logs while the paid queue is empty.
- Show expired mint/Forge reviews and disable their wallet control when the timer expires without erasing filled fields. Distinguish funding, pending signed execution, delivery and expiry.

No contract, signer, ownership selection, spending cap, deadline, shared signer lease key, or public transaction was changed by this work.

## Verification

- Native PostgreSQL plus Anvil fork of the actual deployed factory passed: one budget confirmation, worker mint/delivery, lost response recovery with identical bytes, ownership round trip rejection, changed runtime rejection, cancellation/refund, archive failure before prepare/claim, signed-reservation preservation, and expired unsigned-job recovery during an archive outage.
- The disposable fork's readiness history starts at its fork anchor; the production 20,000-block wrapper is tested separately. Local simulation does not prove live archive-provider availability.
- Mock-wallet browser tests passed at 1440, 375 and 320 pixels, including expiry without reload, preserved burn confirmation fields, rejection and response-loss recovery, and zero public transactions.
- Deployment checks: 140 passed. Full JavaScript suite is recorded in the release PR after completion.

Live funding remains in escrow until the owner cancels and withdraws it in two wallet transactions. A new paid mission requires a fresh reviewed budget and passing live archive checks. Forge approval alone does not burn #1753 or create a training credit.
