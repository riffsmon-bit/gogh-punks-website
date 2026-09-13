# Independent marketplace practice review

**Verdict: PASS_FOR_CONTROLLED_TESTING.** This sign-off covers the local interactive marketplace rehearsal only. It does not authorize public purchases, WETH order posting, refunds, wallet changes, or production execution.

Reviewed on September 13, 2026, independently of the practice implementation. Baseline: `a251508`, followed by the orchestrator's narrow corrections described below. Final reviewed source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `scripts/dev/marketplace/practice-server.mjs` | `068e3d55980d9f7f1f319418d2608e468313f6605e38521537030ced72963b75` |
| `scripts/dev/marketplace/practice.js` | `3993eb382af2b8e400b3794126a94399b9e1a3144d265f18a8db30c5fa192b88` |

## Scope and evidence

Inspected the actual practice HTTP server, browser module, HTML/CSS, launcher interfaces, browser test, guide, and existing browser evidence. The previously reviewed marketplace preparation/reconciliation and contracts remain separate dependencies; this reviewer did not rebuild contracts or claim a new on-chain audit.

Added `tests/marketplace-practice-independent.test.mjs` with **13 independent passing tests**. Eleven run the real HTTP state machine with isolated Node-only preparation/reconciliation adapters and an offline chain fixture. The actual filesystem journal, claim ordering, bounded transaction search, seller receipt/event verification, schema handling, and server transitions execute unchanged. The journal directory suffix is isolated per test process to avoid collisions with parallel tests. Two tests execute the actual browser rendering module against a minimal DOM fixture.

This separation is intentional: the new tests demonstrate response-loss and UI behavior, not fresh EVM execution, protocol simulation, ownership continuity, or production deployment. They read no credentials, contact no public RPC, use no browser wallet, and do not touch existing local practice nodes.

Validation command:

```sh
node --test tests/marketplace-review.test.mjs \
  tests/marketplace-independent-security.test.mjs \
  tests/marketplace-practice.test.mjs \
  tests/marketplace-practice-independent.test.mjs
```

Result: **106 tests passed, zero failed, zero skipped**. This includes 13 new independent practice tests and 15 author practice tests. No additional native compile was run; the orchestrator separately reported the full contract gate passing.

## Findings closed during review

| Priority | Finding and reproduction | Repair and independent retest |
| --- | --- | --- |
| P2 | After a confirmed offer passed its funded deadline, the fresh escrow row said `BID_EXPIRED`, but the prominent result and current review still said `BID_ACTIVE`. | The fresh expiry now overrides the historical creation result. Expired offers remain cancellable; preparing cancellation does not broadcast a refund. The UI distinguishes the short review expiry from the funded offer deadline and explains that expiry alone does not return WETH. HTTP and rendering regressions pass. |
| P2 | A previously completed result remained authoritative after a later receipt check lost canonical evidence. Its stale terminal state allowed preparation to replace the current review. | Verification clears the old result and persists a nonterminal state while retaining the original hash and claim. Receipt failure remains `RECONCILIATION_REQUIRED`; an unknown hash retains `WALLET_REQUESTED`. Replacement preparation is blocked until verification succeeds. The adverse receipt and no-resend regressions pass. |
| P2 | A reverted seller attempt retained an enabled fill button, although the consumed seller claim correctly prevented another send. The UI did not explain the failed attempt. | The row explains the reverted seller attempt and disables another fill attempt. Cancellation remains available; later terminal cancellation/fill labels take precedence over old attempt state. HTTP and actual rendering regressions pass. |

No P0 or P1 issue was found in the bounded practice surface. No unresolved P2 finding remains in this review scope.

## Security assessment

- The launcher creates a separate Anvil process and a random loopback destination. The practice checks the owned-node assertion before actions and reads. Losing that assertion blocks confirmation before the sender is called. It cannot be replaced through HTTP input.
- Host must exactly match the bound local address. Mutation requests require the exact Origin, a random per-process nonce, exact JSON content type, a bounded body, and an exact allowed operation/input schema. Cross-origin, missing/wrong nonce, alternate RPC endpoints, and arbitrary transaction fields are rejected. These guards are covered by the author HTTP tests rerun in the combined suite.
- Browser callers cannot select a signer, RPC URL, contract, recipient, transaction hash, nonce, or calldata. All fixture actions use server-owned fixed dependencies. The CSP restricts resources and connections to the same local origin and blocks framing; rendered content uses text nodes.
- Owner and seller claims reach the on-disk journal before sender invocation. Independent tests inspect those files inside the injected sender. Both owner and seller response-loss cases recover the exact original transaction without another send. Pre-broadcast uncertainty remains claimed; an unrecoverable consumed nonce blocks replacement.
- Recovery is bounded to 128 blocks after the local claim. A canonical receipt failure does not preserve a successful authoritative result. Expiry, changed signer nonce, and stale review identifiers do not create a send.
- Sender retry safety does not depend on a disabled button. The server owns the claim and refuses a second send even if the browser repeats a request.
- Review expiry is checked immediately before claiming. The existing reviewed guard/escrow remains responsible for actual on-chain owner, nonce/state, price, reserve, deadline, and delivery enforcement. The offline practice tests do not substitute for those contract checks.

The journal provides browser-reload recovery while this one process and its owned fork remain alive. It is a session-local temporary file, removed when the practice closes. There is no claim of recovery across server restart, host failure, or a new launcher process. The guide states this limit correctly.

## UX and mobile assessment

The reviewer inspected the supplied 320-pixel screenshot (`offers-narrow.png`) and the browser evidence/guide. The layout remains readable without horizontal overflow, with large controls and clear copied-funds language. The author's browser evidence covers 320, 375, 430, 768, and 1440-pixel widths, initial load failure, actual copied-chain actions, real review expiry, and reload. This review does not relabel those author screenshots as a separate independent browser run.

The two additional rendering regressions verify the repaired expiry and seller-revert controls. The user can distinguish reviewing, confirming, rechecking, and cancelling. Copy makes clear that this is a copied Punk and copied funds, that selected listings are not a proven collection floor, and that an expired offer requires cancellation to return unused WETH.

Before handing out a repaired practice URL, launch a fresh owned session using this reviewed source and rerun the browser rehearsal. An already-running Node process can retain the old imported server code even when its served static assets change. The final fresh-session check belongs to the integrator; this reviewer did not mutate or stop the session at port 64843 or the separate Forge session at port 62764.

## Production boundary and integration notes

Public native purchases still require reviewed deployment/pins, real owner/skill/policy authorization, simulation, and the durable production journal. Public WETH offers remain blocked by the original collection's away-and-back ownership continuity limitation and unverified marketplace acceptance of restricted escrow orders. Local fixed skill/policy fixtures do not prove those integrations.

Integrate only the new independent test/report together with the reviewed source corrections and a fresh-session browser check. No database, contract, production feature flag, wallet module, public service configuration, or existing user session was changed by this reviewer.
