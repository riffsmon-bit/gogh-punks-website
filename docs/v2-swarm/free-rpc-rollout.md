# Free archive RPC rollout

September 13, 2026. The owner authorized free provider signup and the archive RPC integration. Dedicated Netlify Production Functions settings are live. PR #62 was merged and production commit `3b534724094aad9a775e60fe147db196272d0539` was published at 16:47:48 UTC. Existing scheduled-worker logs confirm `paidReadiness: READY`.

| Setting | Provider | Scope |
|---|---|---|
| `ROBINHOOD_ARCHIVE_RPC_URL` | Validation Cloud Robinhood mainnet | Production / Functions / protected secret |
| `ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL` | Blockmachine Robinhood public archive | Production / Functions / protected secret |

The Validation Cloud account is on its $0 Free plan, with no card or paid upgrade. Its endpoint is also saved in macOS Keychain under `Gogh Punks Validation Cloud Robinhood archive RPC`. Credentials and authenticated URL paths are excluded from repository files and logs. The existing general RPC and transaction relay settings were preserved.

Validation Cloud documents 50 million free compute units per month. Blockmachine documents a free public endpoint limited to 300 requests per minute per IP. These are two distinct provider hosts; this does not prove their underlying infrastructure is disjoint. Sources: [Validation Cloud billing](https://docs.validationcloud.io/v1/about/billing), [Blockmachine Robinhood RPC](https://blockmachine.io/robinhood-rpc).

## Compatibility and evidence

The old request covered 20,001 inclusive blocks in one call. Validation Cloud's live response limits `eth_getLogs` to 2,000 blocks. The helper now reads eleven contiguous pages, preserving the complete window, collection and token filters, strict decoding, both-provider comparison, and failure on any missing or malformed page. The worker checks authorization and current block hashes before and after the history scan. A failed read cannot become empty history or a successful mint.

At 16:33:26 UTC, the exact runtime client configuration passed the full history readiness check in 2,912 ms. Both providers also matched the existing positive control at block 61,509,639: nonempty transfer, block hash, successful receipt, pinned original-collection code, and historical owner of #93. See [validation evidence](free-rpc-validation.json). This proves the tested reads, not continuity of a particular mission or permission to execute it.

An earlier BlockReq/Blockmachine pair passed a recent-window check but failed the older positive control. That pair was rejected and never configured; [candidate evidence](free-rpc-candidate.json) records this distinction.

The dedicated variables were created and their secret flag, Production context and Functions-only scope read back successfully at 16:34:27 UTC. See [configuration receipt](free-rpc-netlify-configuration.json). No production transaction, refund, burn, database migration or authority change was submitted by this rollout.

## Release validation checkpoint

- 67 targeted paid-history, recovery and execution tests passed after the 2,000-block adjustment.
- Independent security review found no runtime blocker. Missing-page and ownership-transfer checks remain mandatory; persisted signed bytes and nonce are preserved during history outages.
- The minimal release was validated in `fix/paid-mint-archive-pages`, based on production commit `eec456222bc8028df1f91b3191ce0ff8874c467e`. The broader swarm changes are not included in this release.
- The final minimal release passed all 1,901 JavaScript tests. The extended disposable PostgreSQL/Anvil proof also passed at public fork block 62,103,499, including later-page transfer rejection and outage recovery. Its history starts at the first retained local block because concurrent historical reads at Anvil’s exact remote fork anchor were reproduced to hang; production history coverage is unchanged.
- A fresh all-contract local compilation changed numeric AST identifiers in Forge artifact `immutableReferences`, producing a different deployment-plan build hash despite identical creation/runtime bytecode, metadata and immutable offsets. Final JavaScript validation used the four existing validated build artifacts. Contract sources, manifests and hash checks were preserved. This artifact reproducibility limitation is separate from the RPC change.
- Production deployment checks passed, including 140 tests, the wallet bundle, site secret scan, 693-module syntax validation and broker checks. Netlify preview and production builds both succeeded.
- Production page and script checks passed; the paid API still requires authentication. Existing scheduled-worker logs at 16:49:06 UTC report `IDLE`, `PAID_NO_MISSION`, `paidReadiness: READY`, and `submitted: false`. No worker was manually invoked. See [production acceptance](free-rpc-production-acceptance.json).
- The first subsequent owner-confirmed paid mint succeeded: #93 received Peppies World #1599 in 42 seconds. The ordinary worker later recorded verified completion after the diagnostic release; see [receipt reconciliation](paid-receipt-reconciliation.md). Floor sweeps and WETH bids remain outside the deployed capability set. The broader swarm changes remain on their integration branch.

The Mac's storage blocker was also relieved under the owner's cleanup authorization: cached images in two inactive July/August Codex session logs were removed, and their remaining text was preserved in verified compressed archives. Source files, practice sessions, wallet journals and user assets were retained. Approximately 10 GB of free space became available.
