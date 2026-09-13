# Forge completion follow-up

September 13, 2026. This follow-up preserves the accepted contracts, immutable v1 skill packages, deployment manifests and current owner semantics. No production transaction was broadcast.

## Current live state

The read-only observation in `forge-completion-live.json` verified all four deployed runtime pins at block 62215286. The registry was unpaused with only Rarity Eye's research bit enabled. Rarity Eye v1 was registered READY, available and matched both accepted package hashes. Punk #93 had zero credits and had not learned it. Original #1753 was still owned by the selected owner.

Contract Detective v1 and Market Scout v1 were not registered. The separate selected-burn release authorizes only owner `0xc7f…7aa6`, source #1753 and recipient #93; the generic training release's `productionBurnAuthorized: false` does not describe that separate narrow release. This work preserves those files and does not execute their transactions.

## Fixed live dependencies

Both training and selected-burn recovery previously ignored the configured archive credentials and recreated obsolete public clients. They now share server-only validated archive plus distinct secondary clients. Existing exact owner/state/receipt/finality checks remain unchanged. Malformed configuration does not silently fall back; credential-bearing URLs are not returned or logged. The primary remains client index 1, which is the existing coordinator and history-reader contract.

The first interactive attempt exposed a further source-check blocker: Validation Cloud's live RPC returned `Exceeded max range limit for eth_getLogs: 2000`, while the old source checker asked for 50,000 blocks. The scanner now requests at most 2,000 blocks and six concurrent reads. Its total scan is capped and any read failure, malformed result or transfer blocks clearance.

`forge-source-history-extension.json` is a separate hash-pinned extension of the unchanged September 12 history proof. It contains 1,244 actual empty queries, covering all four selected wallets and Transfer, TransferSingle, TransferBatch and ConsecutiveTransfer through block 62221907. The known positive control returned its original transaction. Both independent chain providers confirmed the extension anchor. Current source checks validate that canonical anchor and inspect subsequent history, balances, account derivation/runtime, nonces and application records. The source history is scoped to standard transfer events. Nonstandard tokens, off-chain obligations and later deposits remain owner-review limitations.

To reproduce the read-only extension audit:

```sh
node scripts/refresh-selected-burn-history.mjs --read-only
```

It uses the existing archive Keychain item, prints no credential and sends no public transaction. Its output is a proposed evidence replacement, not an automatic trusted checkpoint: a reviewer must inspect the artifact and deliberately update its pinned digest before it can pass the source checker. This prevents silently accepting rewritten empty-history assertions. Very old checkpoints must be refreshed rather than creating unbounded serverless scans.

## Interactive copied-chain practice

```sh
node scripts/test-forge-composed-journey.mjs --disposable-only --postgres-bin=/private/tmp/gogh-postgres-native/bin --archive-keychain --interactive
```

The command prints a new loopback URL. Open that URL; no MetaMask connection is needed. It creates and owns a new fork, new native PostgreSQL cluster, separate journals and a constrained fixed-action web server. It does not use or reset the owner's previous practice nodes. The fork keeps chain ID 4663 only to exercise the exact deployed contract bindings; never add its copied network to a real wallet. All public source access is behind a read-method allowlist. All transactions target the newly owned node.

The page explains and reviews each copied action, then supports approval, copy #1753 sacrifice for copy #93, exactly one credit, learning Rarity Eye, equipping, actual metadata comparison and unequipping. Loading, errors, expiry, confirmation, refresh and server-held transaction recovery are shown without normal-user JSON. It requires `BURN COPY 1753` for the copied sacrifice. Training requires a separate `CONFIRM COPY` action. Slot unlocking is displayed only when its rarity allocation and another credit allow it; a single sacrifice cannot pay for both learning and an additional slot.

The source eligibility path performs the real copied wallet and standard history checks. Application obligations are explicitly an empty disposable fixture, not a production clearance. Two receipt clients share the same new node, so this practice is not independent public-provider finality proof. Reloading the page retains the active process's journals; stopping the process discards the entire disposable session. Claimed or unknown sends remain reserved and are never automatically replaced.

## Skill release visibility

The library now distinguishes the exact released owner's training package from laboratory-only cards. Verified learned/equipped status takes precedence, and unavailable equipped packages show PAUSED. A View training & loadout control goes to the existing durable panel. Display labels confer no skill or wallet authority; each operation still uses fresh registry/owner/credit/loadout checks.

## Next registration review

`contract-detective-registration-review.json` contains the exact immutable v1 register and TESTING calls, prepared by:

```sh
node scripts/prepare-contract-detective-review.mjs --prepare-only
```

It deliberately has no current nonce/fee/expiry and no broadcaster. READY attestation, capability-mask expansion and the training release allowlist change are omitted until independent review and a copied learned/equipped tool proof pass. Market Scout v2 and other new packages are a separate specialist's versioned work; this follow-up does not substitute the accepted v1 adapter silently.

## Validation

- 43 focused Node tests passed, including configured RPC pairing, source extension tamper rejection, bounded scan coverage, selected burn API/wallet and actual local Control Center dependencies.
- Actual browser practice passed approval → sacrifice → credit → reload → learn → equip → research → unequip. The server denied the unequipped tool. Desktop1440 and mobile375/320 had no overflow; cross-origin/no-nonce requests and generic RPC paths were rejected. See `forge-interactive-evidence.json`.
- The original composed burn/training/slot/transfer/expiry journey also passed again: 16 copied-chain transactions, zero public transactions; see the refreshed `forge-journey-evidence.json`.
- A cold Anvil read originally hit a stale proxy keep-alive connection. The owned read-only fork proxy now closes each response connection; receipt verification and public client retry policy were not weakened.
