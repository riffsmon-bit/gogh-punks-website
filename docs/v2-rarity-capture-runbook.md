# Read-only OpenSea rarity capture

This job reads OpenSea and Robinhood Chain. It never signs, submits transactions, edits Netlify, awards slots, or enables burns. Run from the isolated Skill Forge worktree, with existing dependencies installed.

## Secret handling

The owner enters the key directly in macOS Terminal using `security add-generic-password` with `-w` as the final argument (hidden prompt). Service: `Gogh Punks OpenSea API Key`; account: `gogh-punks`. The collector reads this existing Keychain item into memory. No key is passed as a command-line argument, written to a dotenv file, emitted in diagnostics, embedded in outputs, or sent to a browser. HTTP redirects are rejected and API destinations are fixed to OpenSea. No signing keys are accessed.

## Capture

```sh
node scripts/dev/skill-forge/capture-rarity-snapshot.mjs
```

The collector verifies collection/chain identity and OpenSea's calculation fingerprint, pins a Robinhood block, checks totalSupply and scans ownerOf over the collection's known minted range (1–5016). If the count is incomplete, including due to a future mint beyond that range, it fails closed rather than claiming completeness.

OpenSea bulk collection and owner NFT responses were tested and omitted individual rarity. Single-NFT capture was too slow to reliably fit between provider recalculations. The documented [batch-by-identifiers endpoint](https://docs.opensea.io/reference/get_nfts_batch) returns detailed NFTs including rarity and was tested against #93/#94. The collector now retrieves 30 exact token IDs per batch: the live API explicitly rejected 50 with a 30-item maximum. This endpoint uses HTTP POST for a **read-only query**, not a marketplace write, approval, signature or transaction. Silent omissions, duplicates and substituted NFTs reject the entire batch. Single-NFT and batch probes returned the same rank for #93.

Requests run sequentially, no faster than one every 550 ms, below the observed 120/minute token-bucket refill. Other applications can consume the account's shared quota. Any 401/403/429 stops the job with a partial checkpoint; it does not rotate keys or bypass throttling. Transient network/server failures have at most two retries with 5/10-second backoff. OpenSea's [rate-limit guidance](https://docs.opensea.io/reference/api-keys) requires waiting for Retry-After before a subsequent retry. A stopped capture may be rerun at an appropriate lower rate after the wait.

Every batch, the public-data-only checkpoint is saved to `artifacts/skill-forge/rarity/capture-checkpoint.json` (ignored by git). Same-method/same-calculation/same-token-set resumptions reuse records; changed source calculations are not merged. Previous incompatible captures are archived as `partial-<hash>.json`. No partial checkpoint is a frozen allocation. Do not run two collectors concurrently against this checkpoint.

At completion the job requires all 4,295 baseline token ranks (or the strictly validated future baseline), no duplicate/missing token IDs, matching strategy/version, valid ranks and approved slot arithmetic. It rereads the collection fingerprint, verifies the pinned block remains canonical, and at a final pinned block checks supply plus existence of every captured token, detecting a burn/new-mint replacement even when total supply is unchanged.

## Verify and preserve

Only a successful capture creates `gogh-opensea-rarity-<sha256>.json`. Existing snapshot filenames cannot be overwritten. The digest covers UTF-8 `JSON.stringify(payload)` (without pretty-print whitespace), not the outer envelope or the formatted file bytes.

```sh
node scripts/dev/skill-forge/verify-rarity-snapshot.mjs artifacts/skill-forge/rarity/gogh-opensea-rarity-<sha256>.json
```

The offline check verifies integrity, identity, approved policy, records and allocation arithmetic. A self-contained hash is not a digital signature or an independent proof of what OpenSea returned. Provider reads cover a bounded capture window, not atomic historical OpenSea state. Preserve collection fingerprints, retrieval timestamps and chain block references for review. Do not claim arbitrary API-response text is on-chain metadata.

The resulting file is a frozen **data artifact**, not on-chain authority. A reviewed additive slot migration/root and separately authorized deployment are still required. No future burn changes the frozen denominator. All tokens retain the seven-slot training cap; rarity determines starting capacity only. One sacrifice remains one credit, regardless of the sacrificed token's rarity.
