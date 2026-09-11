# Full V2 review candidate — September 11

**Start with [the complete broker in Talk](https://deploy-preview-47.preview.goghpunks.xyz/broker/v2/?tab=talk).**
This is the existing owner-connected V2 flow, including natural-language mint rules,
gas funding inside chat, saved mission review, account/session authorization,
collection and activity. The Forge is another tab in this same application.

The `127.0.0.1:64342/control-center?testPunk=44` link is a **Forge-only practice
fixture**, not the full broker. The owner confirmed learning, equipping and
unequipping there. Its running chain/journal has been preserved: #44 has spent its
practice credit, still knows Contract Detective, and currently has it unequipped.

The hosted `?preview=1` mode is a visual fixture. Its local demo chat API is not
provided by Netlify. Use the owner-connected link above for the hosted chat flow.
Browser integration tests below use the full application with explicitly disposable
RPC/auth fixtures; they do not constitute live mint/funding acceptance.

## Production chat was retained

On September 11 the live deployment was still `6aa16a462e74d5c77dfe58c6`, published
September 9 with source `0daf269`. HTTP reads of production's `broker-v2.js`,
`punk-chat-actions.js`, `punk-agent-gas-funding.js` and broker HTML matched that
source byte-for-byte. PR #47 retains its chat parser, shared gas component and
mission review reuse. The Forge merge adds ownership-continuity checks.

The full-page test now explicitly exercises:

1. Chat: one free autonomous mint, one per day/mission, maximum 0.0005 ETH gas per
   mint and a 0.001 ETH reserve, using the actual production chat resolver.
2. Empty agent gas preserves that exact mission and opens funding inside Talk.
3. “Move 0.0005 ETH from my Punk Wallet to agent gas” fills the source and amount.
   “Add 0.001 ETH from my connected wallet for gas” switches both fields correctly.
4. Review Saved Mission restores the same mint/gas/reserve limits without activating
   a mission or requesting a wallet transaction.
5. Desktop/mobile rendering, original-NFT purchase/sale refresh, and clearing stale
   seller chat, gas confirmation and Forge responses.

## Training implementation added behind the release gate

- Owner-authenticated review, one-shot claim, unsent cancellation and transaction-hash
  recovery at `/api/v2/punks/:tokenId/forge/training`.
- Pinned collection/registry/reviewed-progression/source code, original ownership
  and full bounded Transfer-log continuity, immutable skill version hashes, READY
  status, rarity proof, credit/slot checks, simulation, nonce and fee preflight.
- The existing Forge tab now contains the production wallet review/recovery panel.
  It independently rebuilds calldata and verifies wallet chain, owner, runtime,
  transfer history, state, nonce, balance and simulation. Its persistent attempted
  marker precedes the committed server claim. No wallet connection or send on load.
- PostgreSQL holds, audit events and expiring worker leases survive worker/database
  restart. A request role cannot write settlement evidence or alter audit history.
  Separate restricted request/worker database credentials are mandatory.
- The scheduled worker uses both pinned providers' **RPC-reported finalized blocks**.
  It never substitutes a number of L2 confirmations or claims independent L1 proof.
- Success/revert settlement releases the reservation. A consumed nonce can close
  missing-hash recovery after expiry without inventing a successful training result.
  If the nonce remains unused, both providers must verify the reviewed contract
  runtime and a finalized timestamp past its on-chain deadline before release.
  A delayed expired transaction may still consume gas; a new review separately
  checks that the wallet has no pending transaction and verifies its current nonce.
- Pausing training preserves settlement work and deployment identity. Changing an
  owner allowlist or fee ceiling does not strand old jobs. A change to contract
  addresses/runtime pins is a new deployment: settle outstanding work before cutover.
- Equipped research runs through `/api/v2/punks/:tokenId/forge/skill`, with the
  canonical capability gate before and after the read. It requires the exact
  accepted package, original owner and equipped loadout; learning alone does not
  enable the tool. Contract/market reads use the fixed collection, and rarity
  accepts only a three-Punk sample including the selected Punk. It cannot sign or
  spend. Unequipping clears the displayed result when state is refreshed.

The file `deployments/robinhood-forge-training.json` is still **UNDEPLOYED**, with
null deployment addresses, no accepted owners/skills and both production authority
flags false. Environment variables or browser parameters cannot enable it.
The generated browser release file comes from the same validated artifact.

## Acceptance evidence

Evidence from this continuation is under `docs/review/2026-09-11/completion/`.

- Native PostgreSQL 16.15: 66 SQL assertions, separate concurrent connections,
  committed claim/lease persistence after immediate shutdown, uncommitted rollback,
  RLS/browser denial, restricted request/worker roles and settlement after restart.
- Disposable Anvil + SQL: reviewed learn, original NFT transfer, buyer equip,
  receipt/settlement recovery, rejected-prompt expiry, stale calldata reverting and
  fresh reviewed calldata accepted with the unused nonce. Two reviewed fixture
  transactions and one fixture transfer; zero public-chain transactions.
- Full broker browser: chat/mint/gas/mission review and ownership changes on desktop
  and mobile. Separate enabled-panel fixture exercises exact wallet review, pending
  recovery, component remount and wallet rejection without another send. Its two
  wallet calls are simulated EIP-1193 calls, not chain transactions.
- Equipped research: unreleased/authentication/owner/package/tool gates, bounded
  sample inputs, post-call loadout/ownership changes and private error handling.
  Browser coverage checks learning alone, explicit equipped use and clearing the
  result after unequipping; it does not promote the testing packages to READY.
- JavaScript and deploy-gate results are recorded in `checks.json`. The prior full
  Solidity check remains applicable: this continuation changes no Solidity source.

Reproduce the additional checks from this worktree:

```sh
node scripts/test-forge-training-store-native.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin
node scripts/test-forge-training-store-local-chain.mjs --disposable-only
node scripts/test-original-punk-transfer-browser.mjs --local-only
npm test
npm run site:deploy-check
```

The native test owns a new temporary cluster; it does not open the production
database. PostgreSQL 16.15 was built in a private temporary prefix from the official
source archive after verifying SHA-256
`c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed`.
No global database service was installed.

## Still required for live release

1. Resolve [the sacrifice/recovery contract decision](V2_FORGE_SACRIFICE_DECISION.md).
   Literal burn removes the immutable Punk accounts' owner; a permanently retired
   original token with asset recovery has different supply semantics. The proposal
   has not been accepted and no production credit source has been substituted.
2. Implement/review the selected source, deploy the reviewed progression/registry,
   accept skill registrations, attest exact runtimes and obtain a fresh fee review.
3. Apply the staged database migrations and provision restricted production roles
   and credentials using [the provisioning review](V2_FORGE_DATABASE_ROLLOUT.md).
   Local role tests do not establish production configuration.
4. Complete real owner-wallet acceptance, including the equipped research-tool route,
   and explicitly scope deployment/enablement. The live Forge research endpoint
   remains diagnostic; this change does not promote research skills to READY.
5. Release the #93 fix to the live worker and verify current-session usage and actual
   canonical receipts. The branch fix is present; production has not been updated.

This is a tested review candidate, **not a completed live Forge deployment**.
