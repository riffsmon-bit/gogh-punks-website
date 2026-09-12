# First public Forge setup and selected burn source

The owner selected **burn Punk #1753 → credit Punk #93** on September 12.
The pair is stored in `ops/forge-burn-test-selection.json`. This selection is not
a completed burn review or a burn transaction.

**Latest setup:** registry acceptance also succeeded. Both original receipts are
verified and saved in [accepted setup progress](accepted-setup-progress.json).
The owner now controls the registry; it remains paused. The full stack passed
[two-provider finalized verification](finalized-deployment.json) at block
`61353065`, hash `0xa00c32abe3e9faed08c912c2a56c3279da9fdf2b3d1652271ebc2ee26a040fea`.
The read manifest adopts those verified addresses as `READ_ONLY_CANARY`; the
training manifest is `PAUSED`, with no allowed owners or enabled skills.

For historical context, revision 15 recorded
`FORGE_DEPLOYMENT_FINALITY_PENDING`. After finality advanced, revision 16 instead
reported `FORGE_ARCHIVE_STATE_UNAVAILABLE`: both public endpoints could return
finalized block headers but could not serve the corresponding contract state.

## Actual public transaction

The first owner-wallet request deployed the paused Forge on Robinhood Chain:

- Transaction: `0x3aad374cdff38b2523d929a67941ef890993809e4a50d2e5a4067490324fb2e7`
- Successful inclusion: block `61291939`, hash
  `0x739736245a3c0a5a22c33c7f950a59e5f7063702218e6fabac2a17f8ded87993`.
- Deployment: `0xF03A7331ACc83Bdba0e257221Daf8f4ee35d955B`.
- Registry: `0xc2A1Bd47fbc0FE33E53c85f130be53591c898E83`.
- Progression: `0x08ADa19EDf9c387dc07A181069a1848C66cA2dA4`.
- Burn source: `0x7e4d6DB6c96C7B09c78F49760D9EEdb5dd4e1533`.

The local journal initially retained `WALLET_REQUESTED` without its hash even
though deployment had succeeded. The deployment event located the original hash;
the existing recovery endpoint verified the exact transaction and canonical
receipt through both RPCs and durably restored it. Nothing was resent. The
registry-acceptance preflight verified all deployed runtimes and bindings against
the compiled build, with the registry paused and administration pending the owner.

[Deployment progress](deployment-progress.json) preserves the original plan and
the unsigned acceptance review. At capture, acceptance was still `READY` and no
finalized evidence or production manifest candidates existed. Resume from the
existing journal at **http://127.0.0.1:64345/**. Do not redeploy or remove the
journal. Refresh the acceptance review if it expires before the wallet request.

The subsequent acceptance transaction is
`0xf6b336551c7600337dfefce865b4a96886cdc349da05dd2381a993e9df197d2d`,
successfully included at block `61337498`, hash
`0xc7b77085a3cfd940f0a028aa0caa86a0ad198c004e5797ce4756673304682fa3`.
Its exact zero-value call to registry `0xc2A1Bd47fbc0FE33E53c85f130be53591c898E83`
used owner nonce `1948`. The ownership-transfer event located the original hash;
the recovery endpoint verified the saved review and receipt through both RPCs.
No acceptance transaction was resent.

The original providers could verify the old transactions and finalized headers
but could not serve finalized contract state. The verifier now supports a separate
pair of state providers. BlockReq and dRPC returned the original collection and
all four expected runtimes, immutable bindings, accepted administration and paused
registry state at the exact finalized hash. Both original providers still verify
transaction identity, receipts, review anchors and canonical headers. State reads
serialize and retry explicit rate-limit errors with bounded backoff; they never
substitute latest state or omit a failed provider. Provider identities are saved
with the verification. No public transaction was sent by these checks.

## Punk #1753 observations

[Both RPCs](punk-1753-chain-read.json) agreed at current block `61294328`, hash
`0x236adf1b0d2ccd80b1898d002849dfc061f57db5c268582c0f7b455ed5ed0aa1`:

- Current owner: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.
- Collection supply: `4295`; token-specific approval: zero address.
- V1, V2, V3 and Agent registries matched their recorded runtime hashes.
- All four deterministic wallet addresses were undeployed, with exactly zero
  native ETH, WETH and EntryPoint deposits. Counterfactual addresses can still
  receive assets; this does not establish a complete asset inventory.

| Wallet | Address |
| --- | --- |
| V1 | `0x0533A1172567E0E28a443f32DB78fA990371F6bE` |
| V2 | `0xA50EE88b8F1bFa8a08A7ECFe743930A5cf4dEc96` |
| V3 | `0xC735bbAaF79295a27cb66AC84bDc926a125602E2` |
| Agent | `0x56dF53299941890500D44aBA31dCB376b92E1b65` |

[Discovery results](punk-1753-discovery.json) record HTTP 401 from the NFT index
for all four wallets. These diagnostic responses do not establish that the hosted
OpenSea credential is invalid: Netlify's environment APIs currently return masked
values, including single-variable reads. Hosted checks must use the actual
injected credential. NFT and other-token coverage remains incomplete. A read-only
transaction against production Supabase found no #1753 records in the listed
legacy jobs, priority sessions, gas balances/deposits/usage/refunds, reconciliation,
activity, diagnostics and Punk-state tables. These queries do not cover the
separate current broker database or prove absence of external obligations.

## Selected pair baseline

[The pair preflight](pair-1753-to-93.json) verified both owners, pinned wallet
registries/implementations and the deployed paused Forge through both RPCs at one
canonical current block. #93 has zero Forge credits and zero learned skills. Its
Agent session is active, its V3 wallet holds `700000000000000` wei, and its Agent
wallet holds `250925000000000` wei plus `101718909000000` wei in EntryPoint gas.
These are recipient balances, not source assets to withdraw. No recipient
session, mission, wallet balance or NFT was changed by this read.

The live setup page now offers **Check selected Punks live**. Every click checks
the selected pair again; it does not prepare or request a transaction. It reports
unverified source inventory and operational obligations, pending registry
acceptance, the paused Forge and unfinished production burn integration. A failed
read clears the previous displayed results. Snapshot evidence is not a reusable
burn authorization, and current reads do not replace finalized deployment proof.

Validation: 1,775 JavaScript tests passed, including six new selection/provider
guards; syntax checks passed for 637 modules. Independent wallet reads run
concurrently and the browser request times out after 35 seconds. The
[browser check](pair-browser-checks.json) exercised the real live preflight at
1440 and 375 pixels, verified the source wallet cards and recipient baseline,
then injected a failed response and verified that previous results cleared.
It made zero wallet requests and zero public transactions. Screenshots are
[desktop](pair-live-1440.png) and [phone](pair-live-375.png).

Before a burn, finish live asset and mission/session recovery checks, refresh and
verify both owners, complete production burn integration, and present the exact
source/recipient and wallet-access-loss review. Both ownership and all current
checks must be refreshed. The public collection still contains #1753; no burn or
training transaction was requested in this session. The #44 practice servers
remain intact on their disposable chains.

## September 12 preflight reliability fix

The owner saw a `BURN_PAIR_STALE_HEAD` failure before a later retry returned a
valid blocked report. The old path made 182 separate HTTP requests and waited for
the wallet section before starting Forge verification. Dedicated diagnostic
clients now batch up to 20 JSON-RPC reads per HTTP request; independent wallet
and Forge checks overlap. Concurrent page requests share only the in-progress
read. Completed results and errors are never cached for the next click.

[Four consecutive live samples](preflight-reliability/live-reads.json) performed
the same 182 logical reads in 24 HTTP requests and finished in 7.3–8.7 seconds,
with snapshots 7.6–8.8 seconds old at completion. These measurements do not promise
fixed latency: an earlier repeated API check returned `LIVE_READ_UNAVAILABLE`,
and its cause was not reproduced. The final diagnostic transport retries a
transient RPC failure once, retaining the provider, method and exact block.
Persistent failures and individual contract-read errors remain errors. The
30-second snapshot limit and 35-second browser timeout remain in place.

Validation: 40 focused tests passed, including out-of-order batched responses,
exact block/provider preservation, retry exhaustion, per-read failures and
concurrent-click behavior. The disposable-chain owner browser regression passed
both actual local transactions and lost-response/restart recovery. The updated
[live browser check](preflight-reliability/pair-browser-checks.json) passed at
1440 and 375 pixels, verified the real #1753/#93 baseline, and confirmed that a
failed read clears prior results. It made no wallet requests or public
transactions. The public deployment journal was preserved and registry
acceptance remains pending. Inventory, operational review and production burn
integration remain required; this diagnostic fix does not enable burns.

## Acceptance hash recovery fix

The next live failure exposed a persistence gap: recovery tried both RPC lookups
before saving a returned hash. An outage left the journal at `WALLET_REQUESTED`,
and the generic recheck message incorrectly suggested only finality was pending.

Recovery now commits `reportedTransactionHash` before any lookup. This field is
an unverified hint; it does not establish submission, inclusion or authority.
Both providers must verify the original transaction against the saved review
before it becomes `transactionHash`. A wrong unverified hint can be corrected;
an already verified hash cannot change, and no path reopens the wallet request.
Recheck can also report a hash retained in browser storage if its original HTTP
delivery failed. Browser keys bind the specific review, not just the setup plan.

The page distinguishes a missing hash, unavailable RPC reads, a failed check,
pending inclusion and pending finality. Failed refreshes clear deployment evidence
and manifest candidates while preserving recovery data. Historical-read failures
are displayed instead of being silently described as pending finality.

All 48 focused tests passed. The expanded
[disposable browser test](../owner-wallet/browser-checks.json) completed both
local transactions while injecting a lost wallet response, a lost HTTP hash
report, an RPC lookup failure, two server restarts and an outage after successful
verification. It recovered without further wallet submissions and retained no
verified deployment evidence during the injected outage. The
[phone capture](../owner-wallet/recovery-pending-375.png) shows the saved hash and
unavailable verification. No public transaction was sent by these tests.

## Deployment simulation and regression

The owner requested simulation followed by deployment and live fine-tuning. The
complete regression passed: **1,789 JavaScript tests**, **267 contract tests**
(1,024 fuzz runs), and **127 website deployment tests**, plus build, formatting,
syntax, site/assets/secret checks, high-severity lint and ABI/contract-size checks.
Native PostgreSQL role, contention and crash/restart recovery tests also passed
on a new private cluster. The original-Punk burn integration passed on a fresh
disposable chain.

[The selected-pair fork](../atomic-forge/selected-pair-fork.json) copied the already
deployed Forge and the real original collection at block `61347964`. On that
private copy only, it approved #1753, burned it, awarded exactly one credit to #93,
then learned, equipped and unequipped a fixture research skill and verified the
actual profile reader. Closing public reads confirmed both original NFTs still
belonged to the owner. This exercises contract behavior, not production inventory,
mission cleanup or durable burn service readiness.

Reproduce the selected-pair simulation with:

```sh
node scripts/test-forge-stack-fork.mjs --fork-deployed-selection
```
