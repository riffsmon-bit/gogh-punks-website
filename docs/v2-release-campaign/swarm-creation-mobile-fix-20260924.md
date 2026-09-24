# Swarm creation and selected-Punk gas repair — 2026-09-24

Starting production commit: `d5920eb2e36923bfb006cf991fff9143ee6184e7`.

## Reproduced defects and fixes

- Roster hydration invalidated unrelated Swarm Wallet reads/creation reviews, discarded their results, and could hide a submitted transaction's recovery controls. Wallet identity and batch-selection invalidation are now separate; pending journals remain visible for their owner.
- The Swarm client depended on the extension's contract-read RPC. A fixed, public, read-only Robinhood transport now serves contract/state reads. Wallet identity, network and pending nonces remain checked through the connected wallet. Both reader and wallet must agree on chain. No accounts, signatures or send methods are allowed on the public transport; no secret or session cookie is sent.
- A real-chain creation simulation reproduced `max fee per gas less than block base fee` (41,472,000 quoted versus 42,012,000 base). Preparation now explicitly includes a 20% gas-price margin in the exact transaction and displayed maximum fee. This is a legacy gas price, not a refundable EIP-1559 margin. Confirmation cannot raise it; the existing 0.001 ETH maximum fee gate remains. Fee changes produce an actionable error.
- Previously generic errors now include safe check codes and recovery instructions. Confirmation explains missing consent and expired reviews. Reads remain bounded and do not automatically retry.
- The gas panel accepted cached data which the activation guide rejected. Selected-Punk gas now requires matching owner/token/chain/runtime owner and fresh data. Switching Punks clears the previous funded display and requests only the selected Punk's status. Mobile wallet restoration clears stale gas immediately. Late responses cannot update another selection.

The screenshot's exact extension-side failed check was not recoverable from its generic error. The independent reader and diagnostic codes address that blind spot; the roster race, fee simulation failure and gas-state defects were reproduced separately.

## Validation before preview

- `npm run site:deploy-check`: passed; 698 tests, domain typecheck, wallet build, site/secret scan, syntax and broker checks.
- Focused client/public-reader tests after fee fix: 35 passed.
- Panel regressions: 24 passed. Mobile/activation/sign-in focused validation: 44 passed.
- Local Swarm Wallet browser fixture: creation, deposit, two-Punk funding, withdrawal, roster changes during creation and useful read errors passed at 1440/375/320 widths; 12 screenshots, no overflow or browser errors. Evidence: `/private/tmp/gogh-swarm-wallet-browser-Bbiine/result.json`.
- Full-page local holder browser: passed, 30 screenshots and 33 served-file comparisons; no exceptions, console/network errors or blocked requests. Evidence: `/private/tmp/gogh-preview-browser-evidence-UJHMa2/result.json`.
- Initial full run: 3,831 passed, 2 failure counts from one nested Forge browser navigation timeout, 2 existing optional skips. The Forge test passed in isolation (4/4) after concurrent browser/build load ended. A complete run with concurrency limited to two is being recorded before production release.
- Production read-only dry run verified the deployed factory and uncreated owner vault, prepared and simulated creation, and reached a locally intercepted send call. The fake provider returned rejection; zero real wallet prompts or broadcasts. The verified quote's maximum fee was 0.000067215573144 ETH; this is historical test evidence, not a currently valid owner quote.
- Independent code/security reviews found no release-blocking issue. Owner-only sends, durable recovery, fee caps, duplicate prevention and transfer checks remain enforced.

## Boundaries

No contract, database, provider secret or worker configuration changes. No assets moved; no missions started, recalled or authorized. The public wallet confirmation still requires holder testing. Batch NFT transfers through OpenSea are a separate compatibility audit; no helper contract is included in this release.

Preview and production deployment evidence will be attached to the release PR after verification. Do not infer deployment from these local results.
