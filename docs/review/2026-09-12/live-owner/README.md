# First public Forge setup and selected burn source

The owner selected **Punk #1753 as the proposed burn source** on September 12.
The different recipient Punk is still pending. This selection is not a completed
burn review or a burn transaction.

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

Finalized historical reads during this session were unavailable: PublicNode
required an archive token and the other public endpoint reported missing
historical metadata. Current anchored reads succeeded. Finalized verification
remains required; current reads do not substitute for it.

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
for all four wallets. NFT and other-token coverage remains incomplete. A read-only
transaction against production Supabase found no #1753 records in the listed
legacy jobs, priority sessions, gas balances/deposits/usage/refunds, reconciliation,
activity, diagnostics and Punk-state tables. These queries do not cover the
separate current broker database or prove absence of external obligations.

Before a burn, finish live asset and mission/session recovery checks, select and
verify the recipient, complete production burn integration, and present the exact
source/recipient and wallet-access-loss review. Both ownership and all current
checks must be refreshed. The public collection still contains #1753; no burn or
training transaction was requested in this session. The #44 practice servers
remain intact on their disposable chains.
