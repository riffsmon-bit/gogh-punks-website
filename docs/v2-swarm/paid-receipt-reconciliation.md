# First production paid mint and receipt reconciliation

Punk #93's selected paid mission delivered **Peppies World #1599** to its Agent Account. The owner confirmed generation 2 at 16:57:35 UTC on September 13, 2026; the worker delivered the NFT 42 seconds later. The existing production journal now records `COMPLETED` with two-provider delivery evidence. See [complete evidence](paid-mint-delivery-1599.json).

The earlier expired attempt is a separate `STOPPED` journal entry with no worker transaction. Its remaining refund was 0.000183954 ETH at the verified chain snapshot. No diagnostic or rollout step broadcast a refund, burn, replacement mint or wallet withdrawal.

## Reconciliation incident

The worker submitted transaction `0x64b9704b7ea60ad5fa5cdd0e6816ee017f99e334b720edb2951adaf2d0406a03`, which succeeded at block 62116306. Subsequent scheduled checks reported `PAID_RECEIPT_MISMATCH` and retained the durable `SUBMITTED` reservation. Independent read-only checks verified mint and delivery events, receipt-block NFT ownership and current NFT ownership. The saved signed transaction also passed the complete local reconciliation path; its proposed database update was intercepted, with no production writes.

PR [#63](https://github.com/riffsmon-bit/gogh-punks-website/pull/63) added the first failed receipt comparison's fixed label and provider index to scheduled-worker diagnostics. All sixteen comparisons, comparison order, error code, confirmation threshold, provider agreement, saved signed bytes and retry behavior remain unchanged. Logs exclude raw RPC responses, credentials, transaction values and arbitrary error properties; HTTP responses expose no new diagnostic fields.

Production `a0445825969e8c404eb5b8bcb728e9a37f2c41de` published at 17:17:47 UTC. Its first scheduled check at 17:18:08 UTC returned `PAID_COMPLETED`, `submitted: false`. A read-only journal query at 17:20:28 UTC confirmed the same hash, NFT #1599 and verified recipient. The following scheduled run returned `IDLE`, `PAID_NO_MISSION`, `READY`.

The original failing predicate was **not captured**: unchanged receipt verification passed after the diagnostic deployment. A fresh runtime or recovered provider response may explain recovery, but neither cause is proven. Keep the diagnostics to identify a recurrence; do not describe this as a loosened receipt check or a confirmed provider-specific fix.

## Review and validation

- Implementation agent: `/root/security_review`; independent reviewer: `/root/free_rpc_research`; lead reviewed the diff and integrated it after validation.
- Isolated release: `/private/tmp/gogh-paid-receipt-release`, branch `fix/paid-receipt-diagnostics`, based on production `3b53472`.
- 1,942 JavaScript tests passed, including 41 new receipt/logger regressions; all 140 deployment checks and Netlify preview checks passed.
- The broader integration candidate subsequently passed all 2,198 JavaScript tests and 140 deployment checks, including its scoped compiler and site/secret checks. These broader changes remain undeployed.
- Contract sources and compiled bytecode are unchanged. Previously validated artifacts were reused; the existing immutable-reference AST identifier reproducibility limitation still applies to fresh all-contract builds.
- No contracts, migrations, provider settings, spending authority, financial transactions or production database statuses were manually changed by this release. The already-authorized scheduled worker performed the original mint and subsequent ordinary receipt reconciliation.

In production, open the selected Punk's paid-mint panel and choose **Recheck paid mint** to display the saved verified delivery. A new budget is unnecessary to view this result. Refund withdrawal remains a separate owner-reviewed action.
