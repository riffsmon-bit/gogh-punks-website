# Wallet, ownership and V1 retirement audit

Audited September 13, 2026 at swarm baseline `eec456222bc8028df1f91b3191ce0ff8874c467e`. Specialist B inspected source, deployment manifests and existing proof tests, then added offline cross-boundary tests. No live RPC, wallet interaction, secret read, deployment, refund or burn was performed. Manifest status is release evidence, not a fresh independent observation of chain state.

## Result

The current implementation already separates permanent Punk identity from current-owner authority. V3 owner withdrawals and the bounded Agent Account session exist; these should not be rebuilt. Two material gaps remain before general production expansion: recovery controls do not cover Agent Account custody, and the deployed original-NFT session contract does not permanently invalidate authorization on an away-and-back ownership transfer. The worker mitigates the latter with canonical transfer-history checks, so unavailable history correctly blocks execution.

The V1 cutoff blocks new hosted funding, enrollment and execution while preserving V3 recovery controls and historical records. The retirement state does not prove historical user liabilities have been refunded.

## Subsystem map and current behavior

| Surface | Owning source | Evidence and behavior |
|---|---|---|
| Original Punk identity | `broker/src/config.mjs`; account registry contracts | Chain 4663 and collection `0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`. Token-qualified registry addresses persist across ownership transfer. |
| Canonical product Punk Wallet | `netlify/functions/_shared/v2-ownership.mjs`; `contracts/src/GoghPunkAccountV3.sol`; `GoghPunkAccountV1.sol`; `GoghPunkAccountRegistryV3.sol` | V2 authority resolves **V3**. Owner, registry address and creation status are read at one numbered block; code/balance use that block. Expected owner mismatch rejects. V3 inherits owner execution/recovery from V1; the runtime is a separate account from V1/V2 and Agent. |
| Autonomous Agent Account | `contracts/src/GoghPunkAgentAccount.sol`; `GoghPunkAgentAccountRegistry.sol`; `broker/src/agent-account/punk-agent-account-runtime.mjs` | Separate registry/version 4 account and separate ETH, NFT and EntryPoint custody. Current `ownerOf` controls owner methods. Runtime reader checks implementation/registry code pins, collection identity, EntryPoint and adapter bindings. |
| Deployed Agent release | `deployments/robinhood-punk-agent-account.json` | DEPLOYED manifest: implementation `0xfdb26c2ec70956227728414ff4ab7a5eda64d13b`, registry `0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844`, deployment block 56907291. Automatic submission still requires an independently owner-authorized session and production runtime gates. |
| V3 funding and native recovery | `broker-v2-fund.mjs`; `site/punk-wallet-funds.js`; `broker-nft-withdrawal-status.mjs` | Funding information uses V3, not a hosted project balance. Browser verifies current owner, selected chain, account code hash, exact simulation and gas. Native withdrawal builds owner-only `execute` with destination fixed to current owner, then repeats preflight before wallet submission. |
| Agent gas funding | `site/punk-agent-gas-funding.js` | Supports owner → Agent or V3 → Agent. Fixed Agent registry re-resolves destination; owner is rechecked; V3 source honors reserve. This does not expose Agent withdrawal. |
| NFT recovery | `site/nft-withdrawal.js`; `broker-nft-withdrawal-status.mjs`; `broker-nft-withdrawal-assets.mjs` | ERC721/ERC1155 V3 recovery verifies current NFT custody, runtime and exact transaction. Fixed owner destination; arbitrary fields/controlling-Punk withdrawal are rejected. Selected token and state are checked again before sending. |
| Fungible tokens | `site/wrapped-native.js`; account `execute` | Canonical WETH wrapping/unwrapping in V3 exists. Unwrap returns ETH to the Punk Wallet; native withdrawal is a separate action. No general ERC20 withdrawal UI was located. Owner-only on-chain account `execute` can perform supported token transfers; this is not an AI or session permission. |
| Collection display | `broker-v2-collection.mjs`; `broker/src/v4/directed-paid-history.mjs` | V3 and Agent custody can both be displayed, with live holdings verification. Agent-custody items explicitly lack a withdrawal control URL; see W-01. |
| Recall / transfer worker state | `broker-v2-agent-account-recall.mjs`; `broker-punk-agent-worker.mjs`; `punk-agent-worker.mjs` | Recall prepares owner `revokeAutonomousSession`, checks exact confirmed transaction, then persists REVOKED and pauses strategy. Detected transfer/session mismatch pauses the worker session. Signed operations retain reconciliation state rather than disappearing. |
| Worker transfer continuity | `punk-agent-ownership-continuity.mjs` | Checks authorization receipt/config event, current owner/session, canonical Transfer logs including both boundaries, bounded advancing tail, freshness and reorgs. Runs before signing and again before submission. Original-NFT history is capped at 40,000 blocks and paged at 2,000. Failed provider reads never establish continuity. |
| Skills / progression | `GoghSkillProgression.sol`; `GoghRaritySkillProgression.sol`; `GoghReviewedSkillProgression.sol`; `broker/src/v4/skill-forge/` | Credits, learned skills, slots and equipment are keyed by tokenId under an immutable collection. Current original owner authorizes mutations; transfers do not clear skills. Capabilities do not themselves authorize spending. |
| Epoch research | `contracts/src/epoch/`; `deployments/robinhood-epoch-proposal.json` | Proposal is UNDEPLOYED, explicitly superseded and unauthorized. It cannot be presented as deployed transfer-epoch protection or substituted for original-NFT ownership. |

## Findings and proposed coordinated work

### W-01 — P1 product/recovery gap: Agent assets lack owner-facing withdrawal controls

`broker-v2-withdraw.mjs` returns V3 recovery; the NFT gate pins V3 implementation and registry. `broker-v2-collection.mjs` and `directed-paid-history.mjs` set Agent-custody `withdrawControlUrl` to null. Agent gas funding is available, and the free/paid mint recipients can be Agent accounts, so users can fund or receive assets there without equivalent recovery in the Control Center.

The on-chain recovery authority exists: `GoghPunkAgentAccount.execute`/`executeBatch` are `onlyTokenOwner`; `withdrawEntryPointDeposit` sends to the current owner. This is a UI/integration gap, not evidence that those assets are permanently inaccessible.

Proposed follow-up ownership: B owns a new runtime-pinned Agent recovery preparation module and narrowly scoped server recovery gate; M owns its UI; P tests the whole path. Candidate files are new `broker/src/agent-account/punk-agent-recovery.mjs`, new `netlify/functions/broker-v2-agent-account-recovery.mjs`, new `site/punk-agent-recovery.js`, and coordinated links in `broker-v2-collection.mjs` / `broker-v2.js`. Shared review schema must distinguish `V3`, `AGENT`, `ENTRY_POINT`, source account, owner destination, tokenId, snapshot, action and exact transaction. No arbitrary calldata or server signing should be exposed. Existing V3 gates must remain available.

Required proof: native/ERC721/ERC1155/EntryPoint preparation, stale owner rejection, new owner recovery, wrong registry/runtime/chain rejection, exact fixed destination, failed simulation, no duplicate wallet request after ambiguous send, and no dependence on AI/discovery/worker availability. Existing deployed contracts should be reused; no deployment is required merely to add this surface.

### W-02 — P1 security limitation: original-NFT round trips do not invalidate the deployed session on chain

`GoghPunkAgentAccount.isAutonomousSessionActive` compares current owner to `authorizingOwner`. An Alice → Bob transfer deactivates the old session; Bob cannot inherit Alice's session and must explicitly authorize a new one. But Alice → Bob → Alice can restore the old session without changing generation. `contracts/test/GoghPunkAgentAccount.t.sol:testKnownGapRoundTripTransferCanReviveOldSession` explicitly characterizes acceptance of an old signature after a round trip.

Canonical worker history checks mitigate submission through the managed worker; tests cover transfers during discovery, estimation, reservation and the last history tail. They do not turn the original collection into an epoch-tracking contract, and they cannot revoke an already released signature on chain. RPC history access remains a production dependency. Do not describe transfer protection as permanent cryptographic invalidation or broaden execution on that assumption.

Proposed follow-up: J/L review signer exposure and any already-signed-operation recovery path; keep history failure closed and sessions bounded. Contract-level redesign requires an agreed original-NFT-compatible authority mechanism and owner authorization. Do not deploy the superseded wrapper proposal or mutate ownership semantics to close this finding.

### W-03 — P2 compatibility gap: general V1/V2 account recovery and arbitrary ERC20 access are not represented in the V2 UI

The retained legacy account management endpoint uses the original deployment's fixed canary binding; the general NFT/native recovery gate resolves V3. V2 collection verification enumerates V3 plus Agent accounts, not every older V1/V2 registry account. Those original contracts still expose current-owner execution, and historical rows remain; that establishes contract access, not a complete user-facing inventory or withdrawal experience for every version.

Proposed files, coordinated with W-01: a shared registry/version-aware wallet inventory resolver, additive response fields in `broker-v2-withdraw.mjs` and `broker-v2-collection.mjs`, plus owner review UI. Keep legacy asset records and receipt provenance. Do not silently move assets or label unknown balances zero. For arbitrary ERC20 recovery, define a reviewed token-transfer interface and simulation constraints first; do not add unrestricted spender approvals.

### W-04 — P2 onboarding dependency: owner → Agent funding unnecessarily requires activated V3 recovery

`prepareAgentGasFunding` calls `readPunkWalletFundsState` for both `PUNK` and `OWNER` sources. Consequently an owner cannot use that UI to fund an otherwise valid Agent Account until V3 is activated and its recovery gate succeeds. This is a flow dependency, not a permission bypass.

Proposed change file: `site/punk-agent-gas-funding.js`, coordinated with B/M after shared wallet identity contracts are approved. Owner funding should consume a separately verified owner/Agent binding; V3 balance/reserve checks remain mandatory only for V3-funded transfers. Do not remove Agent registry/runtime/owner/simulation checks.

### W-05 — P2 operational evidence gap: V1 retirement does not certify repayment

`broker-migration-state.mjs` sets cutoff at September 5, 2026 22:00 UTC. It blocks new execution/registration regardless of old fixture clocks passed into retired entrypoints; hosted funding is always retired. `v1-retirement-finalizer.mjs` uses transactional serialization, releases reserved paid jobs and waits for unresolved operational receipts before marking V1_RETIRED. Supabase migration `20260904030000_reschedule_v1_retirement_to_september_5.sql` cancels unsent jobs/sessions, preserves attempts needing receipt reconciliation and does not broadcast or certify refunds.

No production ledgers were queried during this audit. Settled user liabilities, final retirement count and completed refund status remain unverified here. O should audit the additive accounting/reconciliation evidence read-only and document any remaining liabilities separately. No historical tables should be deleted and no refund should be broadcast by this swarm.

## Evidence added and verification

New `tests/v2-swarm-wallet.test.mjs` executes real modules with injected offline providers. Six tests cover:

1. Server V2 authority → V3 recovery gate → browser native review; same wallet identity after transfer, old owner rejected, new owner fixed destination.
2. Native review invalidated when ownership changes before submission, even after the connected wallet switches to the new owner.
3. The equivalent NFT review transfer race.
4. Fresh new-owner ERC721 review encodes the inherited wallet as source and new owner as destination, with one mock submission.
5. V1 retirement with zero unresolved receipts preserves independent current-owner withdrawal.
6. V1 retirement with pending receipt reconciliation also preserves withdrawal while execution/funding/enrollment stay blocked.

Executed offline command:

```sh
node --test --test-concurrency=1 tests/v2-swarm-wallet.test.mjs tests/punk-agent-ownership-continuity.test.mjs tests/punk-wallet-funds.test.mjs tests/nft-withdrawal.test.mjs tests/v1-retired-entrypoints.test.mjs
```

Result: **83 passed, zero failed/skipped**, including six new tests. Runtime approximately 5.7 seconds. Mock `eth_sendTransaction` is local test bookkeeping; no external transaction was sent.

Existing contract evidence inspected, not rerun by this agent: `GoghPunkAgentAccount.t.sol` transfer/new-owner/recall/EntryPoint tests and the explicit round-trip gap; `GoghSkillForge.t.sol` direct/safe/operator transfer lifecycle tests; `GoghReviewedSkillProgression.t.sol` original transfer preserving progression and requiring a fresh owner review; `GoghRaritySkillProgression.t.sol` allocation persistence tests. Lead should run the contract suite serially during final integration.

## Integration boundary

Only this audit and `tests/v2-swarm-wallet.test.mjs` changed. No deployed manifest, contract, production flag, migration, runtime module, API, existing test, site asset or shared domain model changed. The tests honor current interfaces and do not depend on architecture A's forthcoming additive types. Findings requiring other files are proposals for lead assignment, not silently implemented changes.
