# Skill Forge — selected administrator and bounded fee review

September 10, 2026 · additive preparation on `feat/punk-transfer-epoch`.

## Owner decision

The owner selected `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6` as the prospective Skill Registry administrator, **subject to security review**. [Decision record](../ops/forge-registry-admin-selection.json).

This resolves the administrator-identity question from the [registry-canary checkpoint](v2-forge-registry-canary-checkpoint.md). It does not approve transaction fees, deployment, configuration, wallet-delegation changes, production training or burns. The record is conversational provenance, not a cryptographic wallet signature. The production Forge manifest remains UNDEPLOYED and unchanged.

## What the wallet review established

The account currently delegates to `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`. MetaMask's v1.3.0 deployment document identifies that address as its EIP7702StatelessDeleGator implementation. The reviewed tag is pinned to commit `bfbdf9795a976833ed2fa000baf42fbb83958b03`, not mutable main. [Published deployment list](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/documents/Deployments.md).

The narrow local reproduction test:

1. Read and pin the real account's delegation indicator and target runtime on Robinhood, chain 4663.
2. Fetch the exact pinned upstream deployment record and require its SHA-256 `4cfa1d6e066b2f642e5bb66dc9711e637aa349899e16fb74492137fc84f8f0f1`.
3. Verify its CREATE2 factory, salt, constructor bytes, zero value and derived target address.
4. Start an independent disposable Anvil fork. Clear only that fork's copy of the target code/nonce and replay the published constructor through the pinned deterministic factory. No public state is altered.
5. Require the reconstructed Robinhood runtime hash to match the observed `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0` exactly.
6. Rehearse all eight registry calls using the selected administrator's disposable fork identity, with explicit gas/fee caps and zero ETH value. The registry ends globally disabled with three TESTING definitions.
7. Simulate an outside caller attempting the wallet's `execute` entry point and require the specific `NotEntryPointOrSelf` rejection. Recheck the public account nonce, code and canonical anchor afterwards.

The source's signature validation checks recovery against the delegating account's address. [Stateless signature implementation](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/src/EIP7702/EIP7702StatelessDeleGator.sol).

This is **published-bytecode reproduction**, not an independent Solidity rebuild or comprehensive wallet audit. The reproduced constructor and its source mapping are published by MetaMask; no third-party dependency was installed into Gogh or into a real wallet.

## Security boundary still requiring review

The wallet is not just an empty-code EOA. Its implementation also trusts an EntryPoint and DelegationManager for specific execution paths. The observed getters returned the published manager `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` and EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. This checkpoint did not independently reproduce/audit their deployed code or every caveat enforcer. [Privileged entry points and access checks](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/src/EIP7702/EIP7702DeleGatorCore.sol).

Existing signed delegations can be off-chain and are not exhaustively enumerable through an address/code inspection. An already-issued broad valid permission may have implications for future registry administration. A rejected arbitrary outside caller does **not** prove that only the human owner can ever exercise the wallet's authority. Do not infer that there are no outstanding permissions. The source also documents batch-construction risks; this canary uses separate direct registry transactions, not a wallet execution batch. [MetaMask security guidelines](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/documents/Security.md).

Consequently `securityReviewComplete` remains false. The owner choice is retained; it is not silently replaced with another wallet. Production use still needs the scoped dependency/permission-risk review and explicit deployment authorization. No code delegation, permission or key was revoked, added, changed or read from private storage.

## Full eight-transaction fee proposal

The earlier creation-only quote was not a complete budget. The new tool measures sequential registry gas on the fork, queries Robinhood's Nitro parent-data gas component for each exact calldata payload, and uses the real public creation estimate as a floor for the first step. It proposes 50% gas headroom and twice the larger opening/closing observed gas price; the priority-fee ceiling is zero. All calculations are integer gas/wei.

Arbitrum's documented estimator includes parent-chain posting cost in the gas limit; it must not be charged a second time on top of a full native estimate. The composition here adds the separately observed parent component only to the local EVM estimate and then takes the maximum against the full public creation estimate. [Arbitrum gas-estimation model](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas).

The final recorded review observed public blocks **59,502,320–59,502,365**. It proposed a total ceiling of **0.000550926242944 ETH** for these eight transactions, with maximum fee per gas **257,656,000 wei**:

| Transaction | Proposed gas ceiling |
|---|---:|
| Create registry | 1,163,228 |
| Disable all capabilities | 104,474 |
| Register Contract Detective v1 | 253,418 |
| Stage Contract Detective TESTING | 53,862 |
| Register Rarity Eye v1 | 227,768 |
| Stage Rarity Eye TESTING | 53,862 |
| Register Market Scout v1 | 227,750 |
| Stage Market Scout TESTING | 53,862 |

All eight capped local transactions succeeded and their limits were checked. The public parent-data component returned zero in this observation; the tool supports that explicit result but does not assume it will remain zero. Anvil does not reproduce every ArbOS behavior. Each actual public step must be freshly estimated against the preceding confirmed state before signing; if it cannot fit the approved ceiling, stop for a new review. The proposal expires after ten minutes and is **historical evidence, not a current price guarantee or spending approval**. No retries or replacements are included.

## Tools and checks

```sh
node --test tests/skill-forge-registry-canary.test.mjs tests/skill-forge-administrator-review.test.mjs
node scripts/review-forge-selected-administrator.mjs --fork-readonly
```

The second command returns the unsigned registry proposal, fee review and reproduction evidence. It starts its own loopback Anvil; it does not use the existing practice chains or any real signer. Upstream inputs are fetched only from the pinned commit and must match the reviewed hash.

For future public receipt checking, require both the exact proposal and its fee review:

```sh
node scripts/verify-forge-registry-canary.mjs --live-readonly --proposal=review.json --transactions=HASH1,HASH2,HASH3,HASH4,HASH5,HASH6,HASH7,HASH8 --fee-review=review.json
```

Replace the placeholders with actual public receipt hashes. With no fee-review file, the tool explicitly returns `feeLimitsVerified=false`. Fee verification requires EIP-1559, no authorization list, zero value, bounded gas and max-fee fields, zero priority fee and a fee review bound to the selected administrator and the exact proposal. This supplements rather than replaces canonical receipt, nonce, target, calldata and registry-state checks. It never authorizes deployment or adopts a production manifest.

A freshness bug was also corrected: the live preflight now reads the wall clock **after** its block RPC returns, so a block mined during the request is not incorrectly classified as coming from the future. Old/stale heads and explicitly supplied test clocks remain checked.

Verification: **1,480 full-suite JavaScript tests passed**, zero failed/skipped. All **37 targeted selection/canary/fee tests** passed, including authority escalation, malformed selection/getters, altered gas/fee bounds, changed totals, proposal mismatches and the head-timing regression. Syntax checks passed for 560 modules; site/assets/secret scan, Art Broker and ABI/size checks passed. No Solidity source, browser flow, live V2 agent session or production setting changed. No new wallet-SDK/Netlify build or production deployment was run.

[Machine-readable evidence](v2-forge-administrator-evidence.json) is a self-reported reproducible checkpoint, not an independent security certification. Previous checkpoint hashes remain historical to their corresponding commits. Both existing local practice servers and their user state were preserved.
