# Broker contracts and live test availability — September 12, 2026

The production broker is https://goghpunks.xyz/broker/v2/?tab=talk. Open
**EXAMPLE PROMPTS** above the composer for mission templates and wallet/research
shortcuts. Selecting an example fills the composer only; the owner still sends
the message and reviews any resulting mission or transaction.

## What can be tested

| Feature | Contract and integration status | Test path |
| --- | --- | --- |
| Autonomous free mint | Agent Account and free-mint infrastructure deployed; live readiness still applies to each Punk and candidate. | Free pixel/experimental mint examples → review limits → fund gas if needed → approve the mission. |
| Directed free mint | Exact-contract targeting is connected to the deployed free-mint flow. A supported, open collection must pass screening and simulation. An OpenSea link must resolve unambiguously through discovery. | Exact-contract or collection-link examples → replace the placeholder → confirm the exact target. |
| ETH funding, withdrawal, WETH wrap/unwrap | Existing wallet controls prepare and simulate exact owner-approved transactions. | Fund and Collection controls. WETH wrapping creates no offer. |
| Read-only playbook skills | Chat returns an owner/Punk-bound skill draft; a separate confirmation saves the read-only routine. | Teach a scouting routine → review its capabilities → confirm. This is separate from Forge credits. |
| Burn-to-training | Registry, reviewed progression and reviewed burn source are deployed and ownership is accepted. Registry remains paused with zero registered skills. Production burn/recovery integration is unfinished. | **Not live.** Source #1753 remains intact; recipient #93 has zero training credits. |
| Permanent learning, slots and loadouts | Contracts deployed; skill registration and production training release remain unfinished. | **Not live.** Forge profiles and authorized research remain separate read-only paths. |
| Floor purchases/sweeps | Chat recognizes the request and blocks it. Listing review, marketplace purchase execution and receipt tracking are not implemented. No deployed broker sweep integration was found. | **Not live.** The menu shows an example and this status. |
| WETH collection bids | Chat recognizes the request and blocks it. Offer review, signing/publishing, finite allowance review, cancellation and settlement are not implemented. No deployed broker bid integration was found. | **Not live.** Wrapping WETH is a separate available control. |
| Paid mint | Chat blocks paid requests; paid review/execution is not wired into V2. | **Not live.** It must not silently create a free-mint mission. |

## Fresh deployment evidence

Two public RPC providers agreed at block **61487566** on the recorded runtime
hashes of 15 broker, policy, adapter, wallet and Agent Account contracts. This
includes legacy contracts; a matching code hash does not mean a legacy service is
enabled. [Full broker read](review/2026-09-12/prompt-library/broker-contracts.json).

At block **61488140**, both providers agreed on all three Forge runtime hashes,
the accepted registry owner, an empty pending-owner address, `globallyDisabled =
true`, `skillCount = 0`, remaining supply **4295**, #93 credits **0**, and current
ownership of both #1753 and #93. [Full Forge read](review/2026-09-12/prompt-library/forge-contracts.json).

| Forge component | Address |
| --- | --- |
| Registry | `0xc2a1bd47fbc0fe33e53c85f130be53591c898e83` |
| Reviewed progression | `0x08ada19edf9c387dc07a181069a1848c66ca2da4` |
| Reviewed burn source | `0x7e4d6db6c96c7b09c78f49760d9eedb5dd4e1533` |

These were reads, with no public transactions. They verify deployed code and
observed state, not full transaction readiness. Earlier disposable-fork tests
exercised #1753 → #93 approval, burn, credit, learn, equip and unequip on copies of
the deployed contracts and NFTs; they did not burn the real #1753.

## Work before the remaining live tests

1. **Burn and training:** complete the source wallet inventory and operational
   review; connect production burn transactions to durable receipt/recovery
   handling; finish restricted request/worker database credentials; register the
   reviewed skills and complete the production release/configuration. Then run
   the owner-reviewed #1753 → #93 flow and verify the burn and credit receipts.
2. **Sweeps:** implement exact listing selection, quantity and fee-inclusive price
   limits, recipient validation, review/simulation, execution and partial-fill or
   failure recovery. Verify the required venue/adapter contracts before release.
3. **Bids:** implement exact WETH offer terms, allowance and signature review,
   expiration, publishing, cancellation, fill receipts and settlement recovery.
   Verify the required venue contracts and owner/account signing path before release.

Use the [full owner test guide](LIVE_OWNER_TEST_GUIDE_2026-09-16.md) to record
wallet, mission, transaction and recovery results. Unreleased actions remain open
launch work; prompt availability does not count as a successful transaction test.
