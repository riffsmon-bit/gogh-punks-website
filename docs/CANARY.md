# Canary Plan

Gogh Punk #1797 is selected for preparation only and is not active. The point-in-time owner
observation and explicit false authorization gates are recorded in
`ops/canary-selection.json`. That file cannot authorize deployment, account activation,
configuration, minting, or autonomous execution. Exactly one Punk may enter each live test stage,
and live ownership must still be reverified through two genuinely independent RPC providers.

## Preconditions

- Independent audit findings resolved.
- Robinhood deployment and verification manifest complete.
- Guardian multisig tested; deployer has no runtime role.
- One marketplace or mint venue independently verified.
- One adapter audited and code-hash pinned.
- Same-owner transfer-round-trip authorization issue resolved or autonomy excluded.
- Production indexer catches up and passes reorg drills.
- Global approval and autonomous feature flags remain off.
- Current owner explicitly selects one token ID and acknowledges account-transfer semantics.
- Wallet and marketplace transaction builders reject the Punk Account itself as the controlling Punk's transfer recipient.

## Foundation canary

1. Record canonical tuple, current owner, deployment block, and expected account address.
2. Independently calculate the address from two clients.
3. Current owner activates the account.
4. Verify proxy bytecode, footer binding, implementation, owner, and registry event.
5. Deposit only a pre-agreed dust amount.
6. Set a minimum reserve covering the majority of that balance.
7. Configure `SCOUT`; authorize no transaction agent.
8. Run discovery and inspect explanations, evidence timestamps, and `UNKNOWN` handling.
9. Verify gallery, portfolio, decision log, and notification read paths.
10. Pause and unpause Scout without affecting owner recovery.
11. Withdraw the test balance through the owner path and verify no guardian path exists.

### Owner-direct Punk Account activation

Account activation has a separate read-only preparation gate. It requires the authoritative core
manifest to be `DEPLOYED`, all five core contracts to be `VERIFIED`, and the manifest's exact
source-verification adoption to validate cryptographically. The current `NOT_DEPLOYED` template
fails closed before making an RPC request.

Set `ROBINHOOD_RPC_URL` and `ROBINHOOD_SECONDARY_RPC_URL` in the environment only. The URLs must use
HTTPS and distinct registrable provider domains; neither command accepts an RPC URL, private key,
signer, or wallet from its CLI. After the owner has explicitly selected the one canary Punk, build
the non-authorizing wallet-review artifact:

```sh
npm run broker:canary:account-activation-review -- \
  --token-id <CONFIRMED_PUNK_TOKEN_ID> \
  --expected-owner 0x... \
  --confirmations 20 \
  > ops/punk-account-activation-review.json
```

The shell redirect is the only file write in this example; the tool itself prints JSON to stdout
only. Two read clients must agree at a confirmed pin and a fresh common block on the current
no-code owner, deterministic address from the Gogh facade and canonical ERC-6551 singleton, local
CREATE2 derivation, uncreated account, all core runtime hashes and immutable bindings, foundation
feature flags, and exact read-only simulation result. The artifact commits the exact 173-byte
account proxy runtime/footer and one transaction: current owner to
`GoghPunkAccountRegistry.createAccount(tokenId)`, value `0`, with fixed calldata. Its status is
always `ENCODING_ONLY_OWNER_REVIEW`; it does not approve, authorize, sign, submit, deploy, or write
to the chain. Distinct provider domains reduce correlated RPC risk but do not prove provider
independence; the operator must confirm the two services are genuinely independent.

The current Punk owner must separately open a wallet, compare chain, sender, destination, zero
value, and full calldata byte-for-byte with the artifact, and choose whether to submit. No repository
command submits it. After that separately approved transaction has mined, pass only its hash and the
preserved review artifact to the read-only receipt attestor:

```sh
npm run broker:canary:account-activation-receipt -- \
  --review ops/punk-account-activation-review.json \
  --transaction-hash 0x... \
  --confirmations 20 \
  > ops/punk-account-activation-receipt.json
```

The receipt attestor never signs, sends, writes, deploys, or authorizes another transaction. It
requires the exact owner-direct zero-value transaction, successful confirmed receipt, exactly the
canonical `ERC6551AccountCreated` and `GoghPunkAccountActivated` events, exact proxy runtime,
footer, module addresses, zero account state/nonce, and the same live no-code Punk owner at the
receipt block and a fresh common block. It does not attest current Art Agent authorization; that
remains unverified until the later clean-preconfiguration and configuration-history gates run.

## Owner-approved acquisition canary

### Controlled one-shot contract deployment simulation

The repository includes a deployment-preparation script for the controlled
one-shot test-art collection and its exact zero-cost mint adapter. It requires an
explicit deployed core Gogh account-registry address, controlling Punk token ID,
independently calculated activated Punk Account, independently confirmed current
owner, and canary art token ID. Before preparing either deployment it checks
chain 4663, registry configuration, registry-derived account identity, activated
account code, account footer, and exact live owner equality.

Run only the non-broadcast simulation first:

```sh
GOGH_CANARY_ACCOUNT_REGISTRY=0x... \
GOGH_CANARY_PUNK_TOKEN_ID="<CONFIRMED_PUNK_TOKEN_ID>" \
GOGH_CANARY_EXPECTED_ACCOUNT=0x... \
GOGH_CANARY_EXPECTED_OWNER=0x... \
GOGH_CANARY_ART_TOKEN_ID=9001 \
forge script contracts/script/DeployOneShotCanary.s.sol:DeployOneShotCanary \
  --rpc-url "$ROBINHOOD_RPC_URL" -vvv
```

This command deliberately omits `--broadcast`. A simulation does not create
live contracts or populate `deployments/robinhood-canary.json`. Never add
`--broadcast`, provide a production signer, or submit either deployment without
a new, explicit deployment authorization after reviewing the simulation,
constructor inputs, predicted costs, current owner, compiled bytecode hashes,
and core deployment manifest. The script does not register the adapter,
configure policy, enable approval/autonomous flags, authorize an agent, sign an
intent, or mint. Those remain separate, later owner/governance actions.

The Solidity script's getter checks are not contract-provenance evidence. A
contract can self-report the expected registry getters, and a no-broadcast
simulation is only a point-in-time observation. **Live broadcast is a hard fail
until a separate read-only provenance gate** has checked the authoritative core
manifest is `DEPLOYED`, reproduced its hash from the reviewed clean release,
and used two distinct HTTPS RPC providers at one confirmed block to agree on the
core registry address/runtime hash, activated Punk Account runtime hash and
footer, canonical ERC-6551 registry runtime hash, controlling Punk, exact current
owner, and all four constructor inputs. The common block number, hash, timestamp,
confirmation depth, provider observations, and expected code hashes must be
recorded in `deployments/robinhood-canary.json` without secrets.

`currentOwnerAtPreparation` is an observation, not continuing consent. The script
re-reads it after both creations during local simulation, but Foundry does not
rerun that assertion after transactions are mined. A separately authorized live
workflow must re-read the exact expected owner at each confirmed deployment
receipt and again before registration, policy configuration, proposal review,
and execution. Any owner change halts the canary until the new owner explicitly
starts a fresh review; the Punk Account address remains unchanged by design.

Because a separately authorized live deployment would use two sequential
transactions, every receipt and runtime hash must be recorded and independently
verified; failure of the second transaction would not erase an already-mined
first deployment. The canary manifest remains `NOT_DEPLOYED` until both verified
records are complete.

### Post-deployment manifest evidence (read only)

After a separately authorized, non-dry-run two-contract broadcast has mined, generate the immutable
deployment and clean-preconfiguration evidence proposal with:

```sh
npm run broker:canary:deployment-manifest-proposal -- \
  --artifact broadcast/DeployOneShotCanary.s.sol/4663/run-latest.json \
  --git-commit <FULL_RELEASE_COMMIT> \
  --punk-token-id <CONFIRMED_PUNK_TOKEN_ID> \
  --expected-account 0x... \
  --expected-owner 0x... \
  --canary-art-token-id 9001 \
  --confirmations 20 \
  > /absolute/path/canary-pending-proposal.json
```

The command requires a completely clean release worktree, an offline rebuild, a `DEPLOYED` and
`VERIFIED` core manifest, and two distinct HTTPS RPC providers. It accepts exactly two consecutive
`CREATE` transactions (art, then adapter), verifies their live receipts, block inclusion, initcode,
runtime, immutable getters, owner observations, and at least 20 confirmations, and pins one common
historical block. At that same block it requires the selected account's state, acquisition nonce,
policy, permissions, mint controls, and usage to be fresh; the adapter to be unregistered; the art
to be unminted; no agent authorization/revocation history for that account; and no policy-account or
feature-flag mutation anywhere since the core policy deployment.

The generator prints JSON to stdout only. It never writes either manifest, signs, sends, deploys,
registers, configures, or mints. Until authoritative Blockscout source verification is separately
bound to both canary addresses, it deliberately emits
`CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING` and keeps both contract
`verificationStatus` values `NOT_SUBMITTED`. Do not replace
`deployments/robinhood-canary.json` with that pending proposal. Once adopted after all independent
review gates, the deployment/preconfiguration manifest is historical evidence and must not be
mutated to describe later configuration; configuration receipts and live post-state belong in
separate artifacts.

`verificationStatus: "VERIFIED"` is not sufficient by itself and must never be hand-edited. A
usable core or canary manifest also contains a non-null, validated
`sourceVerificationAdoption`. That immutable object binds the SHA-256 of the exact pending manifest
proposal, the pending manifest and its original note, and the normalized Blockscout verification
evidence, Robinhood chain `4663`, the fixed credential-free Blockscout origin, a strict observation
time, and the canonical contract-name order. Templates and pending proposals keep this field `null`;
every configuration, live-attestation, foundation-preflight, and owner-execution consumer rejects
that state even if someone flips the individual contract status strings to `VERIFIED`. Consumers
also reconstruct the pending manifest and verify its canonical SHA-256, so changing any other
security field after extraction fails closed.

### Blockscout source-verification adoption (read only)

At the exact clean release commit, preserve the pending proposal and run the fixed-origin gate:

```sh
npm run broker:manifest:source-verification -- \
  --kind canary \
  --proposal /absolute/path/canary-pending-proposal.json \
  > /absolute/path/canary-blockscout-verified-wrapper.json
```

Review and preserve the complete immutable wrapper. Then use the separate revalidating extractor;
do not use `jq` or manually edit status fields:

```sh
npm run broker:manifest:extract-verified -- \
  --verified-proposal /absolute/path/canary-blockscout-verified-wrapper.json \
  > /absolute/path/robinhood-canary.reviewed.json
```

Both commands are stdout-only and have no signing, sending, deployment, configuration, or wallet
path. Shell redirection is an explicit operator write. A separate reviewed action is still required
to install an extracted manifest. See [SOURCE_VERIFICATION_GATE.md](SOURCE_VERIFICATION_GATE.md) for
the exact Blockscout endpoints, compiler/source/bytecode checks, failure rules, core command, and
immutable evidence model.

### Review-only owner-direct configuration bundle

After both the core and one-shot canary manifests are genuinely `DEPLOYED`, complete, verified,
and bound to the same reviewed release commit, generate the post-deployment configuration review:

```sh
npm run broker:canary:config-bundle -- \
  --core-manifest deployments/robinhood.json \
  --canary-manifest deployments/robinhood-canary.json \
  > ops/owner-direct-canary-config-bundle.json
```

The command reads only those two explicit fixtures and writes one deterministic review JSON artifact
and hash to stdout. It has no RPC, wallet, private-key, signing, sending, deployment, broadcast,
database, or file-writing path. Every encoded call says `transactionAuthorized: false`. The current
`NOT_DEPLOYED` templates fail closed.

The bundle carries each complete normalized source-verification adoption and its canonical SHA-256.
The 13-transaction receipt index is bound transitively through the exact bundle hash. The later live
attestation and owner-execution artifact carry and revalidate both adoption objects and hashes against
the fixed authoritative manifests; a copied hash or a self-consistent but different adoption does not
pass.

The validator rejects unknown fields, incomplete receipts, unverified contracts, zero or conflicting
security-role addresses, a nonzero account salt, mismatched constructor bindings, insufficient
confirmations, reused RPC origins, stale canonical pins, and any previously registered/configured or
minted canary state. Deployment provenance uses `provenanceGate.status: "VERIFIED"`, two distinct
credential-free HTTPS origins, and this exact observation schema:

```text
provider, origin, chainId, headBlockNumber, confirmedBlockNumber,
confirmedBlockHash, confirmedBlockTimestamp, observedAt, evidenceHash
```

Block numbers are safe JSON integers; observation, common-block, owner-observation, and verification
timestamps are strict ISO-8601 UTC strings. This is the same canary-manifest schema consumed by the
owner-direct execution-artifact gate.

Configuration is deliberately not atomic because the protocol guardian and current Punk owner are
separate authorities. The safe review sequence is:

1. Owner pauses the exact Punk Account and configures a zero-spend `DISABLED` policy.
2. Guardian registers the exact one-shot `MINT` adapter with the reviewed venue, adapter/venue runtime
   hashes, version hash, and metadata hash.
3. Owner stages one exact adapter, mint venue, collection, native zero-payment currency policy,
   `mint(address,uint256)` selector, one acquisition/day, 120-second intent age, and
   `ownerApprovedMints=true`; both autonomous mint controls remain false.
4. Guardian enables only `approvalPurchases`; autonomous purchases/mints, unknown execution, and all
   selling flags remain false.
5. Owner switches to `APPROVAL_REQUIRED` while the account remains paused, then unpauses it last.

These 11 owner policy-module calls must take the verified clean policy from version `0` to exactly
version `11`, with permission generation `1` and acquisition nonce `0`. All 13 calls must confirm
exactly once and in order. Fresh dual-RPC receipt/event reconciliation—not a copied counter—proves
those final values before the later intent can be reviewed.

Account activation is explicitly separate. A `DEPLOYED` one-shot canary already requires its exact
deterministic account to be activated and runtime-hash attested before the canary contracts can exist;
the artifact includes `createAccount(tokenId)` only as a non-authorized reference call and never puts
it in the post-deployment sequence. No Art Agent registration or authorization call is included.

The ordinary teardown is canary-scoped where possible: guardian disables `approvalPurchases` first,
owner pauses and returns the account to `DISABLED`, guardian deactivates the exact adapter, and owner
revokes/denies all exact permissions and mint controls. Two protocol-wide `setGloballyPaused(true)`
calls are listed in a separate optional emergency-containment section with an explicit all-accounts
and all-adapters blast-radius warning; they are not ordinary per-canary teardown calls.

The core and canary manifests are immutable deployment/clean-preconfiguration evidence. Do not edit
their feature or configuration booleans after the 13 configuration transactions. Instead, preserve
the exact configuration bundle and make a separate transaction-index file whose 13 entries copy each
`id` and `order` from `review.configurationPlan.orderedCalls` and add its confirmed transaction hash:

```json
{
  "transactions": [
    {
      "id": "CONFIG_OWNER_01_PAUSE_ACCOUNT_BEFORE_STAGING",
      "order": 1,
      "hash": "0x..."
    }
  ]
}
```

The real file must contain all 13 entries. Build the non-authorizing receipt index from the immutable
manifests, exact bundle, and those hashes:

`ops/canary-configuration-transactions.example.json` contains the exact IDs/order and deliberately
fake demonstration hashes. Copy it to an untracked working file and replace every hash with the
matching confirmed transaction hash; never use the demonstration values as evidence.

```sh
npm run broker:canary:configuration-receipt-evidence -- \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --transactions ops/canary-configuration-transactions.json \
  > ops/canary-configuration-receipt-evidence.json
```

This builder only indexes hashes. The live attestor independently dual-fetches every transaction,
receipt, canonical block, and event; proves their strict order and exact target-level effects; scans
for extra mutations before, during, and after configuration; and checks the full latest state. A
fresh live attestor pass is required before an execution artifact can be reviewed.

In the bundle, `from` means the logical EVM caller expected by the target protocol contract. For a
guardian Safe, the top-level receipt may instead have the Safe as `to` and a relayer/signer as
`from`. The attestor proves the exact target-emitted broker event and rejects extra broker mutations,
but it cannot prove that an otherwise valid Safe transaction or batch contains no unrelated
Safe-side action. Safe signers must inspect the complete Safe transaction/batch before approval.

The separate approval evidence scaffold is a legacy, fail-closed structural checklist only; it is
not an input to the exact receipt-attested owner-direct path:

```sh
cp ops/canary-approval.example.json ops/canary-approval.json
npm run broker:canary:approval-checklist
```

Do not mutate `deployments/robinhood.json` to make this legacy checklist pass. The untracked evidence
file describes one Punk, two independent account derivations, two independent
RPC observations at one confirmed block, exact adapter/venue/collection/selector permissions and
code hashes, an exact ERC-721 or ERC-1155 single NFT, zero payment/slippage, a typed intent expiring
within 120 seconds, and simulation evidence no older than 120 seconds with no approval changes or
unexpected calls. The scaffold validates the evidence bundle's schema and recomputes the typed
intent digest, but it does not authenticate self-authored evidence. It performs no RPC call,
simulation, signature, submission, deployment, or transaction authorization, and it can never
declare a transaction ready. A separate live read-only attestation and successful simulation are
required. The immutable config bundle + 13-receipt evidence + live dual-RPC attestor described above
are the authoritative canary path; this checklist cannot replace any of them.

Build the exact short-lived owner-review proposal only after all 13 configuration receipts are
confirmed and indexed. The proposal builder is local and encoding-only, but its expiry is limited to
120 seconds, so generate it immediately before the live preflight. Copy every address and code hash
from the installed manifests/configuration evidence; copy the nonzero opportunity and reasoning
hashes from the preserved Scout decision rather than inventing them:

```sh
npm run broker:canary:free-mint-proposal -- \
  --chain-id 4663 \
  --punk-collection 0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6 \
  --punk-token-id <CONFIRMED_PUNK_TOKEN_ID> \
  --punk-account 0x... \
  --expected-owner 0x... \
  --owner-review \
  --opportunity-type FREE_MINT \
  --asset-standard ERC721 \
  --adapter 0x... \
  --venue 0x... \
  --collection 0x... \
  --mint-selector 0x40c10f19 \
  --token-id 9001 \
  --asset-amount 1 \
  --currency 0x0000000000000000000000000000000000000000 \
  --expected-price 0 \
  --max-price 0 \
  --max-slippage-bps 0 \
  --expires-at <CURRENT_UNIX_TIME_PLUS_AT_MOST_120_SECONDS> \
  --nonce 0 \
  --policy-version 11 \
  --opportunity-id 0x... \
  --reasoning-hash 0x... \
  --adapter-code-hash 0x... \
  > ops/owner-review-free-mint.json
```

`0x40c10f19` is the reviewed one-shot canary selector for `mint(address,uint256)`. If any installed
manifest/configuration field differs, stop instead of adapting the command ad hoc. The live gate
below independently rebuilds and verifies the proposal; a locally generated proposal is never an
approval or authorization.

After a fresh owner-review proposal exists and the authoritative manifest is genuinely deployed and
verified, run the separate live read-only gate:

```sh
npm run broker:canary:approval-live-preflight -- \
  --proposal ops/owner-review-free-mint.json \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --configuration-evidence ops/canary-configuration-receipt-evidence.json \
  --confirmations 20 \
  > ops/owner-direct-live-attestation.json
```

This command requires `ROBINHOOD_RPC_URL` and `ROBINHOOD_SECONDARY_RPC_URL` from distinct HTTPS
providers. It reads the exact proposal, config bundle, receipt index, and both immutable authoritative
manifests. It pins both providers to one confirmed block, dual-fetches and reconciles all 13
configuration receipts/events and the full mutation interval, validates current ownership, policy,
permissions, adapter commitments and infrastructure code hashes, then repeats all execution-critical
state at a latest common block and performs the owner-direct call as a read-only simulation. The
simulated caller is the current EOA Punk owner; adapter data and owner signature are both empty, and
no agent relayer is used. Smart-contract/Safe Punk owners require a separate wallet-internal or
ERC-1271-reviewed path. The gate rejects a proposal with less than 30 seconds remaining after the
latest simulation.

A `READ_ONLY_PASS` is evidence only. It does not approve, sign, submit, deploy, enable a feature, or
authorize a transaction. The owner must separately review the exact current transaction in their
wallet, and this repository intentionally provides no automatic submission step. With the current
`NOT_DEPLOYED` manifest, the command fails closed before live execution evidence can pass.

After preserving the genuine JSON `READ_ONLY_PASS` output, an encoding-only helper can derive the
one exact owner-direct wallet-review transaction:

```sh
npm run broker:canary:owner-execution-artifact -- \
  --proposal ops/owner-review-free-mint.json \
  --attestation ops/owner-direct-live-attestation.json \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --configuration-evidence ops/canary-configuration-receipt-evidence.json \
  > ops/owner-direct-free-mint-execution.json
```

The helper reads those four exact files plus the fixed authoritative
`deployments/robinhood.json` and `deployments/robinhood-canary.json` paths. Both manifests must be
`DEPLOYED`; the canary provenance gate must be `VERIFIED` using the credential-free dual-RPC
observation schema documented by the canary configuration workflow, and both manifests must carry
their valid immutable source-verification adoptions. It recomputes the proposal and manifest SHA-256
hashes, both adoption SHA-256 hashes, the config-bundle review Keccak hash, both receipt-evidence SHA-256 hashes,
the complete EIP-712 intent digest, and every one-shot canary binding. It also requires the attestor's
full latest-state/EOA evidence, final-clock evidence, and at least 30 seconds of intent life to remain.
It then encodes `executeApprovedAcquisition(intent,0x,0x)`, decodes it again, compares every field,
and prints only a non-authorizing JSON review artifact to standard output.

The review includes the controlling Punk, Punk Account, current owner, adapter, collection, output
token ID, mint selector, zero price/value, live nonce, policy version, expiry, confirmed block, code
hashes, calldata, and calldata hash. The helper has no RPC client, wallet, private key, signer,
submission, deployment, or file-write path and accepts no destination, value, or calldata argument.
Any owner, nonce, policy, code, target, manifest, block-evidence, or expiry change requires a fresh
proposal and live preflight. Its status is always
`ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED`; it never means approved or ready to submit. The
current `NOT_DEPLOYED` manifests deliberately block this command.

### Read-only post-mint receipt evidence

Only after the owner has separately reviewed and submitted that exact wallet transaction, copy the
confirmed transaction hash into an untracked file with no other fields. The tracked
`ops/canary-execution-transaction.example.json` shows the exact shape; its demonstration hash is not
evidence and must never be reused.

```json
{
  "transactionHash": "0x..."
}
```

First bind the hash to the exact preserved owner-execution artifact. This builder has no RPC,
wallet, signer, send, deploy, or file-write path and prints only a non-authorizing receipt index:

```sh
npm run broker:canary:execution-receipt-evidence -- \
  --execution-artifact ops/owner-direct-free-mint-execution.json \
  --transaction ops/canary-execution-transaction.json \
  > ops/canary-execution-receipt-evidence.json
```

Then run the dual-RPC read-only mint receipt and state attestor:

```sh
npm run broker:canary:mint-receipt-attestation -- \
  --proposal ops/owner-review-free-mint.json \
  --live-attestation ops/owner-direct-live-attestation.json \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --configuration-evidence ops/canary-configuration-receipt-evidence.json \
  --execution-artifact ops/owner-direct-free-mint-execution.json \
  --execution-receipt-evidence ops/canary-execution-receipt-evidence.json \
  --confirmations 20 \
  > ops/canary-mint-receipt-attestation.json
```

The attestor requires two HTTPS RPC origins on distinct registrable provider domains and binds all
upstream artifact hashes. Both providers must agree on the exact transaction sender, destination,
zero value, full calldata, receipt, containing block and parent, and the four ordered policy/mint/
account events. It verifies the one-shot NFT was unminted at the parent block and is owned by the
Punk Account afterward; exact policy usage and acquisition nonce; current Punk ownership; balances
and NFT approvals; adapter commitments; runtime bytecode hashes; empty EIP-1967 proxy slots; and no
unexpected controlling-Punk transfer or scanned account/protocol event through the confirmed pin. It
scans later transactions in the mint block as well as later blocks. That interval claim is limited to
the explicitly scanned events: direct native or token receipts may not emit a Punk Account event.
The one-shot NFT owner/balance/approval state and Punk Account native balance are checked directly;
other asset receipts still require portfolio/indexer reconciliation.

The confirmed pin must be fresh at both the beginning and end of the run. The run fails closed if it
takes more than 120 seconds, the clock moves backward, the two RPCs disagree, or the pin is more than
five minutes old at completion. `READ_ONLY_MINT_RECEIPT_PASS` is evidence only: it never approves,
signs, submits, deploys, tears down, or enables anything. Preserve it immutably, then perform the
separately reviewed teardown sequence; do not treat a successful mint as permission to leave the
one-shot acquisition surface enabled.

### Post-mint teardown receipt and final-state attestation

The repository never submits teardown calls. After separate owner/guardian review, execute only the
11 calls in `review.teardownPlan.orderedCalls`, in order. For every mined call, copy its exact `id`,
`order`, and confirmed transaction hash into an untracked
`ops/canary-teardown-transactions.json`. Start from the tracked
`ops/canary-teardown-transactions.example.json`, but replace every deliberately fake demonstration
hash; the example is never evidence. Do not add calldata, addresses, or alternate calls to this
index—the immutable config bundle is the only teardown-plan authority.

Build the non-authorizing receipt index from the entire preserved mint provenance chain:

```sh
npm run broker:canary:teardown-receipt-evidence -- \
  --proposal-artifact ops/owner-review-free-mint.json \
  --live-attestation ops/owner-direct-live-attestation.json \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --configuration-evidence ops/canary-configuration-receipt-evidence.json \
  --execution-artifact ops/owner-direct-free-mint-execution.json \
  --execution-evidence ops/canary-execution-receipt-evidence.json \
  --mint-attestation ops/canary-mint-receipt-attestation.json \
  --transactions ops/canary-teardown-transactions.json \
  > ops/canary-teardown-receipt-evidence.json
```

This builder validates the full semantic mint attestation against the exact proposal, live
attestation, fixed manifests, config bundle/receipt evidence, and execution artifact/receipt
evidence. It binds all 14 upstream mint hashes, exact calldata bytes and hash, mint receipt block,
parent, transaction index, four event summaries, runtime/proxy evidence, and source-verification
adoptions. It then accepts exactly 11 distinct teardown hashes in the immutable plan order. It has no
RPC, wallet, key, signer, transaction submission, deployment, authorization, or file-writing path;
shell redirection is the explicit operator write.

Run the final dual-RPC read-only attestor immediately after all 11 teardown transactions confirm:

```sh
npm run broker:canary:teardown-final-attestation -- \
  --proposal ops/owner-review-free-mint.json \
  --live-attestation ops/owner-direct-live-attestation.json \
  --config-bundle ops/owner-direct-canary-config-bundle.json \
  --configuration-evidence ops/canary-configuration-receipt-evidence.json \
  --execution-artifact ops/owner-direct-free-mint-execution.json \
  --execution-receipt-evidence ops/canary-execution-receipt-evidence.json \
  --mint-attestation ops/canary-mint-receipt-attestation.json \
  --teardown-receipt-evidence ops/canary-teardown-receipt-evidence.json \
  --confirmations 20 \
  > ops/canary-final-teardown-attestation.json
```

Both credential-free transport origins must be HTTPS and use distinct registrable provider domains.
The attestor dual-fetches every transaction and receipt, proves inclusion at the exact block index,
requires strict post-mint order and exactly one target protocol event per call, pins the target
runtime at each receipt block, scans the full relevant mutation interval, and rechecks every receipt
block before returning. A direct guardian EOA must be the outer sender. If the guardian is a Safe or
other contract, the outer call may target that guardian and the target-emitted authorization event is
verified; every signer must still inspect the complete Safe transaction or batch because unrelated
Safe-side actions are outside this proof.

At both a confirmed pin and a fresh latest block, the attestor requires the live Punk owner and
canonical account/footer/wiring to remain exact; all manifest runtime hashes and EIP-1967 slots to
remain non-proxy; policy version `20`, permission generation `1`, mode `DISABLED`, and account pause;
approval/autonomous/unknown/selling flags off; the one-shot adapter inactive; every exact mint
control and permission revoked or denied; native currency disallowed; venue maximum zero; acquisition
nonce `1` and account state `2`; and the one-shot NFT still owned by the Punk Account with no token or
adapter operator approval. Protocol-wide pauses must remain false—the ordinary teardown does not
activate emergency global pauses. Selected-account agent history, global agent mutations, controlling
Punk transfers, and Punk Account-emitted protocol activity are rejected over their documented scan
intervals.

`READ_ONLY_FINAL_TEARDOWN_PASS` is evidence only. The run must finish within six hours of the mint,
use 12–128 confirmations, and end on a latest common block no more than five minutes old. It cannot
authorize, sign, submit, deploy, revoke, pause, or otherwise change chain state. The account-event
claim does not prove absence of direct ERC-20/ERC-721/ERC-1155 receipts or forced native-currency
transfers; reconcile portfolio/indexer state separately. The artifact labels canonical artifact
hashes as SHA-256 and the config-bundle review as Keccak-256. Its final unkeyed SHA-256 detects
accidental edits only—it does not authenticate who ran the attestor. With either authoritative
manifest still `NOT_DEPLOYED`, missing genuine receipt evidence, or any RPC/state discrepancy, the
workflow fails closed and produces no valid pass.

1. Owner pauses the exact account and configures a `DISABLED` zero-spend policy.
2. Guardian registers only the reviewed adapter while global approval purchases remain disabled.
3. Owner stages one venue, one collection, native zero-payment currency, one selector, one
   acquisition/day, short intent age, and owner-approved mint controls; autonomous controls stay off.
4. Guardian enables global approval purchases only after a separate reviewed governance action.
5. Owner switches to `APPROVAL_REQUIRED` and unpauses the account last.
6. Scout produces one exact typed proposal.
7. Owner verifies account, collection, token, venue, selector, price, max price, gas, expiry, reserve,
   and risk evidence.
8. Simulate against the current block.
9. Execute exactly one inexpensive acquisition.
10. Confirm the NFT balance increase, acquisition event, policy usage, journal, portfolio, and
    allowance state.
11. Disable approval purchases first, pause and disable the account, then remove
    venue/collection/selector permissions and mint controls.

## Transfer authority test

Before risking live gallery assets, run the Alice-to-Bob scenario on a current Robinhood fork and a dedicated test collection. Canonical Gogh Punks secondary transfers are now unlocked; do not use a valuable Punk or retained gallery assets for the first authority test.

When canonical transfers are live and the owner explicitly accepts the test:

1. Empty or intentionally retain only test assets according to written expectations.
2. Cancel pending nonces, revoke every agent, and pause policy.
3. Transfer the canary Punk.
4. Verify Alice cannot call owner execution, approve a proposal, configure policy, withdraw, or authorize an agent.
5. Verify Bob can call owner execution and must create a fresh policy/authorization.
6. Transfer back only if separately approved; test the transfer-epoch design before enabling autonomy.

## Autonomous canary

Autonomous canary requires a new explicit authorization after every previous stage passes. It uses one Punk, dust balance, strict majority reserve, one venue, one collection, one selector, one authorized agent, one acquisition/day, short agent lifetime, short intent expiry, and global pause monitoring. Autonomous minting, unknown collections, and selling remain off.

Stop immediately on any ownership mismatch, unexpected approval, policy mismatch, RPC disagreement, indexer divergence, adapter code-hash change, unexplained transaction, or monitoring outage.

### Preflight gate (required before live canary)

Run this check before enabling any live canary flow:

```sh
npm run broker:canary:preflight
```

The command automatically loads an untracked repository-root `.env` when present. Start from
`ops/canary-live.env.example`, but place provider credentials only in the untracked copy or a
secret manager.

Required environment:

- `BROKER_CANARY_STAGE=FOUNDATION`
- `ROBINHOOD_RPC_URL`
- `ROBINHOOD_SECONDARY_RPC_URL` from a genuinely independent provider
- `BROKER_CONFIRMATIONS` (default `20`)
- `BROKER_CANARY_TOKEN_ID`
- `BROKER_CANARY_EXPECTED_OWNER`
- `BROKER_CANARY_EXPECTED_ACCOUNT`, calculated independently before the run

`deployments/robinhood.json` is authoritative. It must say `DEPLOYED` and contain complete,
verified records for all five contracts, including deployment transactions/blocks, constructor
arguments, bytecode hashes, deployer, guardian, and git commit. Environment address values are
optional mirrors; when present, they must match the manifest exactly. An environment variable
cannot override a `NOT_DEPLOYED` manifest.

The preflight pins every read to one confirmed block agreed by both RPC providers. It validates:

- deployment receipts and manifest runtime-code hashes;
- canonical chain, collection, and ERC-6551 registry bindings;
- implementation, policy, agent-registry, and adapter-registry wiring;
- guardian ownership and absence of a pending ownership transfer;
- fail-closed foundation feature flags and global pause state;
- the selected Punk's current owner on both providers;
- the counterfactual account from both the Gogh facade and canonical ERC-6551 registry;
- an activated account's footer, live owner, canonical identity, and module bindings.

This gate supports the `FOUNDATION` stage only. Approval and autonomous live stages remain blocked
until their separate audited gates exist. Preflight is read-only and never activates or funds an
account.

For the quickest recurring validation during live setup, run the canary drill:

```sh
npm run broker:canary:drill
```

This performs:

1. `npm run broker:canary:preflight`
2. local autonomous canary rehearsal (`forge test --offline --match-contract AutonomousCanaryTest -vv`)

You can run only the local rehearsal during pre-deployment with:

```sh
npm run broker:canary:drill:local
```

Never use `--skip-preflight` for a live action. A local-only pass proves the mock rehearsal, not a
deployment, owner, account, adapter, or transaction.

## Next production move (staged)

Punk #1797 remains preparation-only. The next live path is the owner-direct, zero-cost, one-shot
mint documented above—not a secondary purchase, autonomous agent run, or Punk transfer. Do not
begin while either authoritative manifest is `NOT_DEPLOYED`.

1. Establish a separate deployer, reviewed guardian Safe, and two genuinely independent HTTPS RPC
   providers.
2. Create a clean release commit, simulate, deploy, source-verify, and adopt the five-contract core
   manifest with every transaction feature still off.
3. Reverify #1797's live owner and activate only its deterministic account through the exact
   owner-reviewed activation artifact and receipt attestation.
4. Deploy and source-verify only the bound one-shot art contract and zero-cost adapter, then preserve
   the immutable clean-preconfiguration evidence.
5. Review and execute the exact 13-call approval-only configuration sequence; autonomous, unknown,
   and selling features remain off.
6. Build a fresh `FREE_MINT` proposal and live attestation, then have the current owner review and
   submit exactly one `executeApprovedAcquisition(intent,0x,0x)` transaction.
7. Disable global approval immediately after the mint transaction is mined, execute the exact
   11-call teardown, and preserve both receipt attestations. A failed mint still triggers teardown.

The transfer-authority and local autonomous rehearsals below remain separate tests. Neither is part
of the first live owner-direct canary.

### Short-lived website handoff

The owner-direct execution artifact is valid for at most 120 seconds and must retain at least 30
seconds at submission, so it must never be committed as a static website asset. After the exact
artifact builder succeeds, an operator may publish the exact public artifact, its reviewed hash,
and decoded bindings to the short-lived Netlify Database gate:

```sh
node --env-file=.env scripts/publish-canary-execution-review.mjs \
  --artifact /absolute/path/to/owner-direct-execution.json
```

`SITE_URL` and a dedicated, server-only `CANARY_EXECUTION_REVIEW_TOKEN` of at least 32 characters
must be present in the untracked environment. The token never belongs in browser JavaScript, a URL,
the artifact, stdout, or the database. The endpoint rejects activation unless the authoritative core
and canary manifests in the deployed release are both `DEPLOYED`, source-verified, and exactly bound
to the artifact's manifest hashes. The database temporarily stores the public zero-value calldata
and evidence so the owner does not need to locate a local file. The strict artifact schema requires
an empty owner signature and contains no key, password, bearer token, mnemonic, or RPC credential.

On `/punk/1797`, the browser automatically loads that artifact only while the reviewed hash is
active. It recomputes its canonical SHA-256, checks every fixed zero-value intent and canonical ABI
word, and requires the exact active server hash/bindings. Immediately before the one explicit wallet
click, it refetches the
uncached gate and rechecks chain 4663, selected account, canonical `ownerOf(1797)`, account `owner()`,
nonce, policy module/version, latest chain time, contract-code presence, and the exact transaction by
`eth_call`. It constructs a new transaction from only the reviewed `from`, `to`, zero `value`, and
canonical `data`; no arbitrary calldata field exists.

The database record is a UI readiness gate, not on-chain authorization or an emergency stop. The
contracts' live checks remain authoritative. Disable the policy/adapter/approval on-chain for an
emergency stop, and never treat a returned transaction hash as a successful mint before receipt and
independent attestation.

### Local autonomous rehearsal

Run the local-only canary before any fork or live test:

```sh
npm run broker:canary
```

The rehearsal uses an ephemeral Foundry EVM, mock art, and a mock marketplace. It broadcasts
nothing and loads no production key. One Punk Account receives `0.01 ETH`; `0.0096 ETH` is
reserved; one allowlisted secondary acquisition may spend `0.0004 ETH`; and the absolute
transaction, daily, and weekly maximum is `0.0005 ETH`. The test permits one collection, one
venue, one adapter, one selector, one native currency, one short-lived agent, and one acquisition
per day. Autonomous minting, unknown collections, and selling remain disabled.

The same rehearsal proves that an excessive price and a reserve violation move no funds, a second
acquisition is rejected, revocation stops the agent, and a global policy pause does not block the
owner's emergency recovery path. Passing this rehearsal does not authorize a Robinhood deployment
or a live autonomous canary.
