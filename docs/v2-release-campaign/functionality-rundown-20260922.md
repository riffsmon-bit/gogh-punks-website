# Holder functionality — 22 September 2026

Historical maintenance-release record. Superseded by the
[public holder rundown](public-holder-rundown-20260922.md), including the deployed
options interface, AI shutdown and current release boundaries.

**Full public V2: NOT READY.** The maintenance release is LIVE. Optional ETH
training is implemented locally and is not deployed or accepting payments.

Production: <https://goghpunks.xyz/broker/v2/>. Published commit
`109b57fde726fdc2b2f461a85a4cef38e3888c11`, Netlify deployment
`6ab27c0df8b88a0008b98e73`, published 13:02:59 UTC. The paid feature branch
`feat/paid-skill-training` starts from that exact commit. Vercel remains paused.

## Available functionality and limits

| Feature | Current scope | Verification / limitation |
|---|---|---|
| Wallet connection, signed session, Punk roster and selection | Ordinary holders | Deployed ownerOf-backed paths and regression coverage. Fresh production browser smoke was signed out, not a fresh wallet-connected acceptance. |
| Punk balances, reserves and funding destination | Ordinary holders | Deployed. Funding needs the holder's wallet confirmation. No funding was sent during this work. |
| NFT collection | Ordinary holders | On-chain custody checks for discovered candidates. Source failures can leave discovery incomplete; a missing card is not proof of missing custody. |
| Native ETH and NFT withdrawal | Current holder, existing Control Center | Deployed owner-confirmed flow. No withdrawal executed this session. General ERC20 withdrawal UI remains incomplete. |
| Chat, strategy drafts and activity | Ordinary holders | Deployed, with reviewed strategy confirmation. Chat does not itself authorize spending. |
| AI providers | Existing configured providers | Previous real probes exist for Groq, Gemini, OpenAI, Claude and Grok. No new inference/uptime claim from this release. Bankr intentionally disabled. |
| Link inspection | Ordinary holders | Live contract/mint-state resolution for supported Robinhood explorer links. Recognized OpenSea/X/project URLs may need review; arbitrary mint pages are not guaranteed execution-ready. |
| Directed free-mint mission | Bounded account/session setup | Implemented with owner-authorized limits, adapter and simulation gates. Successful setup is not evidence that every collection can mint; worker configuration and eligible opportunities still govern execution. |
| Directed paid mint | Owner canary, Punk #93 / pinned Peppies World target | Historical delivery of NFT #1599 is recorded. This is not general paid minting. No new mint performed in this release. |
| Burn for a Training Credit | Selected owner / source #1753 / recipient #93 | Existing deployed contracts and guarded wallet flow preserved. Fresh source history/assets/obligations and owner confirmation are mandatory. General holder burn is not released; no fresh live burn claim is made. |
| Rarity Eye learning, slots and loadout | Existing owner canary | Registered and available in the recent pinned chain read. Requires a credit, learning and equipment. Current release does not make all catalog cards learnable. |
| Other reviewed read-only skills | Administrator staging | Contract Detective, Market Scout, Floor Hunter read data, Art Curator, Collection Researcher and Social Scout packages/adapters are reviewed. Six additional versions still need on-chain registration/status/activation and holder release acceptance. A manifest alone is not LIVE. |
| Persistent watching | Deployed, default OFF | Bounded shared research worker and controls; database migration applied. No autonomous spending authority. |
| Public ETH purchases / floor sweeps | Disabled | Marketplace source, screening, policy, pending spend, protection deployment, restricted storage and wallet canary remain release gates. Floor data does not equal purchasing capability. |
| Public WETH bids | Disabled | Ownership-away-and-back authorization revival must be solved at the contract/authority level before public enablement. Local offer tests are not a public release. |
| Broad paid / marketplace autonomy | Disabled | Requires separate reviewed skills, scoped account authorization and staged live canaries. |

## New optional paid Training Credit route

- One purchased credit: **0.0005 ETH**, plus network fees.
- Fixed treasury: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`.
- Existing burn contract, burn credit balances and history remain intact.
- Purchased credits have their own on-chain ledger. They are never added to the
  burn balance as a single spendable amount.
- Setup adopts one active loadout; learned skills and equipment follow token ID
  across transfer, while every mutation checks the current owner.
- Purchase, one-time paid-training setup, learn and equip are separate explicit
  wallet actions. A purchase alone does not grant a skill or spending permission.
- Exact payment, short review expiry, on-chain nonce, code/chain pins, simulation,
  fee ceiling, original-transaction recovery and two-provider finalized receipts
  are enforced. Browser errors never automatically repeat a payment.
- Successful purchases have no refund function in this implementation. The
  purchase review discloses this; final release approval must accept that policy.
- Buying is blocked if no useful learning/slot capacity remains. A Punk approved
  for sacrifice must have that approval revoked first. The supported burn review
  blocks unspent purchased credits, including when the new extension is paused.
- Initial usable purchase catalog is limited to the actual holder tool release
  (currently Rarity Eye). Wider registration is a separate release gate.

**Status: LOCAL IMPLEMENTATION, PAYMENTS OFF.** New contract deployment, runtime
pinning, owner-reviewed activation and a small real wallet test are outstanding.
The new contract starts paused. No new contract or payment has been broadcast.

## Validation completed locally

- Full JavaScript suite: **3,358 passed, zero failed, two skipped** (3,360 total).
  The two existing optional marketplace PostgreSQL journal cases remain skipped.
- Full contract gate: **346 passed, zero failed, zero skipped**, including 1,024
  fuzz runs where configured; formatting, offline compilation, high-severity
  lint and ABI/size checks passed.
- Website deployment gate: type checking, wallet bundle build, site/source checks
  and **140 selected tests passed**.
- Paid route: **27 backend/local-chain tests passed**, including actual deployment,
  purchase, treasury forwarding, learning, equipment, transfer and receipt
  recovery on a private local chain. No public funds were used.
- Rendered browser acceptance: **24 desktop/mobile screenshots**, no page
  exceptions or external requests. Wallet/API responses were synthetic; this is
  not evidence of a successful live purchase.
- Seven affected functions packaged locally with Netlify's bundler 14.5.4.
  The isolated new function loaded using only its packaged dependencies:
  UNDEPLOYED GET returned 200 and purchase POST returned 503, with zero external
  requests. No cloud deployment was used for this check.
- Independent security review found no open P0/P1 issue in this disabled local
  implementation. It explicitly retains the ownership-epoch and direct legacy
  contract limitations below.

See [implementation](paid-training-implementation.md),
[security review](paid-training-security-review.md) and
[browser acceptance](paid-training-browser-acceptance.md) for scope and evidence.
The [validation record](paid-training-validation-20260922.json) preserves command
results, local evidence locations and exact source hashes.

## Known boundaries

The original NFT does not expose a durable ownership epoch. Inclusive transfer-log
checks reject observed ownership round trips before sending, but cannot turn a
previously signed original-NFT transaction into an epoch-bound permission. The
paid extension grants no session, bid, trading or autonomous wallet authority.

Immutable old contracts cannot observe the new paid ledger. Supported UI/API
paths prevent duplicate learning, obsolete loadout edits and excess slot spending;
direct custom calls to old contracts can still waste credits. Direct custom burns
can also bypass the application's paid-credit inventory check. These limits must
remain disclosed and are not a reason to enable marketplace permissions.

## What the owner can do now

1. Open the production URL, connect and select a Punk.
2. Check wallet balance, collection, activity, chat and strategy.
3. Use supported link inspection. Read each result's coverage before acting.
4. Use funding/withdrawal controls only after reviewing the destination and wallet
   transaction. They were not exercised with real funds in this campaign.
5. Treat Forge and paid mint as the explicitly scoped owner tests they are.
   Public sweeps, bids, broad autonomy and the new paid credits are not available.

The maintenance release is delivered. A date for the entire public feature set
is not defensible while the WETH authority issue and general burn inventory gates
remain. Paid training is a smaller separate release, awaiting the above contract
and wallet gates; passing local tests does not remove them.
