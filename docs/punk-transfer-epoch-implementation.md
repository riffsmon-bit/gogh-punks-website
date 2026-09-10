# Punk session wrapper and ownership epochs

Implementation checkpoint: September 10, 2026. Branch `feat/punk-transfer-epoch`,
worktree `/private/tmp/gogh-skill-forge`. This is a working local implementation
and rehearsal, not a production deployment or an independent security audit.

## What is built

The opt-in wrapper holds the original Gogh Punk and issues a transferable ERC-721
receipt with the same token ID. Its immutable epoch registry advances a counter
on every receipt mint, transfer, self-transfer and redemption. A new agent account
stores the counter when its owner authorizes a session. Both UserOperation
validation and execution require the counter still to match. A transfer during
the mint's external calls reverts the entire mint.

| Component | Responsibility |
| --- | --- |
| `GoghPunkSessionWrapper` | Original-Punk escrow, receipt transfers, owner-only redemption, effective owner resolution |
| `GoghOwnershipEpochRegistry` | Immutable wrapper-only epoch writer; guardian can pause execution but cannot move assets or reset epochs |
| `GoghEpochAgentAccount` | Existing free-mint policy checks plus epoch, custody, emergency-generation and equipped-skill checks |
| `GoghEpochAccountRegistry` | New deterministic ERC-6551 accounts bound to the original collection and token ID |
| `GoghEpochSkillProgression` | Original-token credits, levels, rarity slots and equipment; wrapped owner can manage them |
| Epoch ownership reader | Verifies code hashes, immutable links, escrow and receipt ownership at a single block |
| Worker epoch guard | Checks a verified authorization receipt and `SessionEpochBound` against current on-chain state before signing and submission |
| Local rehearsal | Real disposable contract transactions, skill gate, mock EntryPoint, transfer/replay and recovery controls |

The original collection and all existing accounts retain their current code.
The new account's address differs because ERC-6551 includes the implementation
and salt in address derivation. Original Punk Wallet addresses are not replaced.
This follows [ERC-6551's immutable account binding and registry design](https://eips.ethereum.org/EIPS/eip-6551).
Receipt updates use [OpenZeppelin ERC-721's `_update` extension point](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721),
including updates invoked by approved operators and safe transfers.

## Corrected collection audit

The original source is present at
`/Users/brandonduke/Projects/gogh-punks/src/GoghPunksOnchain.sol`.
The existing [burn audit](v2-skill-forge-burn-audit.md) already records successful
owner simulation of `burn(93)` and rejection of a nonowner. A previous chat reply
incorrectly described that burn support as still unknown.

There **is** a configurable collection transfer validator, inherited from
`lib/seadrop/src/ERC721ContractMetadata.sol`. Its ERC-721 interface declares
`validateTransfer(...) external view`, so the compiled call cannot mutate an
epoch registry. The metadata getter's `isViewFunction=false` label does not
change Solidity's actual static-call semantics. It is not an automatically
notified mutable ownership registry. No validator setting is changed here.

### Real collection fork: operator registration is required

At block **59110516**, hash
`0x41d44162516f85c23657cf81dd1e1f5efd6c540e44392461d6f143d943563381`,
the collection used validator `0xA000027A9B2802E1ddf7000061001e5c005A0000`,
security level **3**, and operator list **0**. Its runtime hash was
`0xc7dfe8ae4da5613f6406eab346f0808ee2322316f44d186136c830a71491366c`.
The original collection runtime matched the earlier audit's hash:
`0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93`.

The unregistered wrapper's deposit reverted with `UnauthorizedTransfer`
(`0x1de5204e`), even after NFT approval. The reproducible fork test then rehearsed
these **local-only collection-owner actions**:

1. Copy list 0 using `createListCopy`; preserve its operators, authorizers and blacklist.
2. Add only the newly deployed wrapper with `addAccountToWhitelist`.
3. Assign the copied list to the original collection with `applyListToCollection`.

Security level 3 stayed unchanged. The shared default list and SignedZone
authorizer stayed unchanged; the wrapper was **not** made an authorizer.
An unrelated operator and unauthorized list assignment remained rejected.
Wrap, safe receipt transfer, transfer back and redemption then passed, ending at
epoch 4 with original ownership restored and supply still **4,295**.

The collection-owner address observed was
`0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. Fork impersonation does not mean this
process has its key or permission to sign production configuration. The copied
list ID and wrapper address printed by the test are disposable, not deployment targets.
Copying a shared list also stops inheriting future edits to it; a maintenance and
review process is required for the collection-specific copy.

The registry interface and policy implementation were inspected in the
[Sourcify-published verified Ethereum source](https://sourcify.dev/server/v2/contract/1/0xA000027A9B2802E1ddf7000061001e5c005A0000?fields=sources,abi).
Matching-source verification for the Robinhood deployment remains a production
review item; the fork exercises its actual pinned runtime, not an imported mock.
[OpenSea's creator-fee documentation](https://docs.opensea.io/docs/creator-fee-enforcement)
explains the authorizer/validator relationship. This build never disables that
validator or grants the wrapper arbitrary collection-wide transfer functions.

## Authority and recovery

While wrapped, canonical `ownerOf(originalId)` is the wrapper. Receipt ownership
controls the new account and progression. When unwrapped, the epoch advances and
autonomy stops. The new account resolves the original holder for owner-directed
withdrawals, even while unwrapped. Rewrapping advances the epoch again and needs
a new session. Skills, credits, slots, account address and history persist.

Existing immutable wallets resolve the wrapper itself while wrapped. This build
deliberately adds no general forwarding function to that shared escrow. Access
to those old wallets requires redemption first. Before real enrollment, revoke
legacy sessions and withdraw/migrate assets needed during wrapped operation.
Otherwise old wallet assets remain inaccessible until unwrapping. An old legacy
session could still revive after returning to its original owner; the new epoch
account does not upgrade that legacy contract. The existing worker history guard
remains necessary for the legacy lane.

The registry has no custody, approval, arbitrary call or withdrawal functions.
The wrapper **does** custody original NFTs; receipt holders can redeem only their
own Punk. No administrator can take it. Emergency pause affects session execution,
not transfers, redemption or owner withdrawals. Resume increments a security
generation, so old sessions cannot resume automatically.

## Forge and worker integration

`createProgressionReader` accepts a reviewed `epochAuthority` configuration with
wrapper/epoch code hashes. It verifies that progression uses that wrapper and
returns the receipt owner plus epoch. AI and MCP continue using the same skill
gate; a result is withheld if the epoch changes during a tool call, including a
round trip back to the same owner. Tool eligibility never grants spending authority.

The worker accepts the separate `GOGH_PUNK_EPOCH_ACCOUNT_DEPLOYMENT_V1` manifest
schema. It verifies wrapper, epoch and progression deployment records, account
bindings, the session's canonical authorization receipt and its epoch event.
The original collection's Transfer-log scanner remains unchanged for legacy
manifests. New epoch accounts do not depend on that scanner's 40,000-block limit.
Existing production manifests do not opt in to this model.

`deployments/robinhood-epoch-proposal.json` is explicitly UNDEPLOYED with all
activation gates false. Runtime bytecode hashes must include the actual immutable
constructor values; do not hash an unlinked compiler template and call it verified.
Epoch manifests additionally require operator-registration, wrapped-owner UI/auth
integration and legacy-enrollment-review gates. Deployed code alone cannot unlock
owner setup while any of those is missing. These gates do not exist in or alter
the legacy manifest schema.
Setup requires up to four account transactions (approve, wrap, create, authorize),
in addition to whatever learning/equipping the owner has selected.

## Run the reviewable local flow

From the feature worktree:

```sh
forge test --offline --match-contract 'GoghEpochAccountTest|GoghPunkAgentAccountTest|GoghSkillForgeTest|GoghRaritySkillProgressionTest' --fuzz-runs 1024
node --test tests/epoch-ownership.test.mjs tests/skill-forge-capability-resolver.test.mjs tests/punk-agent-ownership-continuity.test.mjs
node scripts/test-epoch-local.mjs --local-only
node scripts/test-epoch-wrapper-fork.mjs --fork-read-only
node scripts/test-epoch-entrypoint.mjs --read-only-infrastructure
node scripts/dev/epoch/server.mjs --local-only
```

The server prints its loopback URL. It starts its own disposable Anvil process,
simulates chain 4663 using mock code at the canonical addresses, and never loads
wallet keys, `.env`, or remote RPC arguments. No MetaMask connection is used.
Closing that process discards its test chain. The existing local Forge preview
and real Punk #93 are not reset. HTTP actions reject foreign origins/Host values,
accept only fixed fixture actions and serialize writes.

In the rehearsal: wrap → create → learn → equip → authorize. Then save a signed
operation, transfer to Bob and back, and try the saved operation: it must fail.
Authorize a fresh session and mint. Unequip and try again: it must fail. Unwrap,
rewrap and observe that skills remain while the old session remains inactive.

The local source burns disposable fixtures to create test credits. It is not a
reviewed production burn source. Local skill READY labels refer only to these
fixtures, not approval of a new production catalog. The EntryPoint fixture checks
signature validation and execution through separate calls; it does not reproduce
all live bundler rules, gas accounting or inclusion behavior.

### Actual EntryPoint / private-relay rehearsal

The separate `test-epoch-entrypoint.mjs` reads the canonical EntryPoint runtime
and its SenderCreator runtime from Public Node at one pinned block. It installs
them only in a new, disposable Anvil world. Original Punks, credits and mint
contracts in this test are fixtures; it does not modify the other fork or the UI session.

The latest test passed at source block **59116046**, hash
`0xb1d59b5b8e45eb33ba2baab85f03c6e8acd164d42d173b45a3bf21feeaaca52c`.
EntryPoint runtime hash:
`0xa4b1c865a4a45b99ebaaf4bd06e0036ad489eb521786f59765e4e6a3c0524b03`.
SenderCreator: `0x449ED7C3e6Fee6a97311d4b55475DF59C44AdD33`, runtime hash
`0xc69a1b3a000d570bc86eb096ee63a9014a17951ad616d720882ec61432b00fcf`.

It uses the actual runtime reader, actual authorization receipt/epoch guard and
existing `createPunkAgentDirectRelay` with strictly local client injection.
Both `handleOps` UserOperations emitted successful canonical receipt events and
the expected NFTs were owned by the new account. Native funds plus EntryPoint
deposit plus charged gas reconciled exactly. The observed **local simulated** gas
charge for two operations was 3,385,493,533,550 wei; this is **not a live fee quote**.
Stale round-trip sessions, old generations, duplicate operations and unequipped
minting were rejected. EntryPoint v0.8's `validAfter` boundary is exclusive; the
test mines beyond it instead of weakening the signed time window.

This proves compatibility with the tested private-relay route and EntryPoint
runtime, not a third-party public bundler's mempool rules, production adapters,
production training, relay availability, or current live configuration.

## Verification results

- Foundry: **67 passed**, zero failed/skipped, including 26 new epoch-account
  cases and fuzz runs of 1,024. Legacy account/Forge/rarity regression suites pass.
  The legacy round-trip-gap characterization deliberately remains present;
  passing that test does **not** mean legacy deployed accounts have been repaired.
- JavaScript account + Forge regression suites: **248 passed**, zero failed/skipped,
  including the additional enrollment-gate regression.
- Disposable lifecycle: **54 confirmed local transactions**, two fixture mints.
- Real-collection fork and actual EntryPoint/private-relay rehearsals: **passed**,
  zero production transactions.
- Browser rehearsal: desktop 1440 px and mobile 390 px, no horizontal overflow
  or browser exceptions; stale replay and foreign-origin POST rejected.
- Changed Solidity formatting and high-severity lint: passed. Runtime sizes:
  account 17,512 bytes; wrapper 6,571; progression 5,621; factory 1,661; epochs 782.
  All are below the EVM deployed-code size limit. No main-site bundle changes
  are required for the separate local rehearsal; production UI enrollment is
  not advertised as wired or live.

## Production review and canary boundary

Before real enrollment, complete the following concrete work:

1. Independently audit escrow/receipt/account/registry and the effective owner
   changes, including the collection's operator/validator configuration and
   any authorized conduit. Verify deployed source/code against the local source.
2. Retain the passing actual EntryPoint/private-relay rehearsal above. Confirm the
   production relay selection and fund only an explicitly approved canary. If a
   public bundler is selected, separately test its validation/storage rules:
   the account reads external wrapper/progression storage. Quote live fees fresh.
3. Add an owner-reviewed production enrollment flow, wallet inventory and legacy
   session revocation/migration receipts. Reconcile pending operations before
   wrapping. Never infer migration authority from holding a skill.
4. Connect wrapped ownership to the production roster, owner authentication,
   private chat and indexing. A receipt is a separate marketplace asset; an
   existing original-Punk listing cannot continue to sell an escrowed token.
5. Choose and audit a real training source. Existing Forge burn-safety and
   1,111 supply-floor work stays separate. This implementation does not enable burns.
6. Generate deployment transactions with exact constructor values, guardian,
   source pins, the collection-specific operator-list change and fee quote.
   Obtain approval for that deployment and a specific
   enrollment canary. Verify source/receipts and rehearse redemption before
   enabling any automatic mission. Public activation remains a separate decision.

Remaining limitations: raw `transferFrom` to the escrow can bypass ERC-721 receipt
callbacks and strand a mistakenly sent NFT; no unsafe admin rescue is added.
Arbitrary contracts can accept assets they cannot return; nesting checks cover
recognizable token-bound accounts, not all malicious contracts. External RPC
responses still require trust and canonical/reorg checks. A future immutable
implementation change requires an explicit new account, never a silent upgrade.
Original Punk burning after redemption can strand its accounts, so production
burn eligibility must inspect every account and unresolved mission.
The receipt currently delegates the original token URI, not marketplace creator-fee
enforcement. Review its royalty/marketplace policy before any public receipt trading.

These limits are reasons for the controlled canary boundary, not evidence that
the local transfer-epoch fix failed. The new wrapper's epoch is written atomically
by every normal receipt transfer path and cannot be reset by a holder or guardian.
