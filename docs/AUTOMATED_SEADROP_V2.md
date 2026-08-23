# Continuous zero-price SeaDrop automation (V2)

Status: **four inert contracts deployed and dual-RPC checked; manifest adoption, guardian
configuration, worker release, account setup, and automatic submission remain disabled**.

The existing V1 Punk Accounts remain unchanged. V2 creates a separate deterministic wallet for
each Punk and a separate policy module. Assets already held by a V1 account do not move
automatically and V1 permissions do not carry into V2.

## Owner experience

The intended production setup is three clearly labeled, one-time owner actions:

1. Activate the Punk's V2 automation wallet.
2. Call `configureAutomatedSeaDropPolicy(account, cap)` once. Supported hard UTC daily caps are
   `1`, `3`, `5`, or `10`.
3. Authorize the published hosted agent in `ArtAgentRegistry` for 7, 14, or at most 30 days.

After those actions, an eligible mint does not require another owner-wallet popup. The agent pays
transaction gas and the NFT is minted directly into the V2 Punk Account. A Punk transfer
immediately invalidates the old owner's agent authorization. Expiration, the daily cap, insufficient
agent gas, account pause, protocol pause, adapter disable, and policy disable all stop execution.

`disableAutomatedSeaDropPolicy(account)` is a single owner transaction that pauses the account,
sets mode to `DISABLED`, zeros the policy, invalidates every prior permission generation, disables
the adapter and SeaDrop venue, denies the mint selector, and clears mint controls. Revoking the
agent in `ArtAgentRegistry` remains an additional defense-in-depth action.

## Exact on-chain envelope

The reusable adapter accepts only all of the following at execution time:

- Robinhood Chain `4663`;
- SeaDrop `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5` with runtime hash
  `0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c`;
- the canonical OpenSea clone implementation
  `0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A` with runtime hash
  `0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519`;
- an exact 45-byte EIP-1167 collection clone runtime with hash
  `0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4`;
- an active public drop whose `mintPrice` is exactly zero;
- remaining per-wallet capacity and remaining collection supply;
- the exact next sequential token ID;
- quantity one, ERC-721, native currency, zero expected price, zero maximum price, zero slippage,
  empty adapter data, and the adapter's current runtime hash;
- only `mintPublic(collection, OpenSeaFeeRecipient, address(0), 1)`.

It returns transaction value zero, payment zero, allowance spender zero, and allowance amount zero.
Paid mints, token approvals, caller-supplied calldata, alternate venues, alternate recipients,
alternate implementations, arbitrary collections, selling, and quantity above one have no route.

An explicit collection denial still overrides the automated collection path.

## Automated screening and planning

Human target review is not required for this V2 route. It is replaced by a fail-closed automated
evidence chain:

1. `npm run broker:autonomy:v2-discover` scans the last 100,000 confirmed blocks of the canonical
   SeaDrop `PublicDropUpdated` event on the credential-free official RPC. It emits discovery hints
   only; it cannot authorize or submit a mint. A persistent worker must backfill from the SeaDrop
   deployment block and then advance its cursor without gaps.
2. Candidate analysis must be complete and metadata must be sanitized.
3. Two RPC origins on different registrable provider domains must agree byte-for-byte on a fresh
   block, collection runtime, SeaDrop runtime, public-drop parameters, wallet mint count, supply,
   explicit-denial state, next token ID, and exact account simulation.
4. The owner-defined maximum contract-risk score and minimum Taste Match are applied.
5. The planner rechecks live owner, V2 account, agent authorization, policy version, nonce, hard
   daily cap, zero-spend policy, permissions, agent gas reserve, and gas budget.
6. The execution batch rebuilds the plan and ABI-decodes its own calldata for equality. It emits
   only `executeAutonomousAcquisition(intent, 0x)` calls with transaction value zero.
7. A production worker must refresh and resimulate each single action at latest, submit one nonce,
   wait for and attest its receipt, then rebuild before considering the next action.

The screen, plan, and execution batch artifacts do not sign, submit, authorize, or write chain
state. An unkeyed SHA-256 evidence hash detects accidental changes but is not an authorization
signature.

The pure screen accepts already-collected RPC observations. Its provider origins and agreement are
therefore supplied evidence, not proof that those observations came from the declared transports.
The genuine live collector is now available as:

```sh
npm run broker:autonomy:v2-screen-live -- \
  --candidate /absolute/path/analyzed-candidate.json \
  --scope /absolute/path/selected-punk-scope.json \
  --confirmations 20 > /absolute/path/live-screen-evidence.json
```

It reads `ROBINHOOD_RPC_URL` and `ROBINHOOD_SECONDARY_RPC_URL`, binds each actual client transport
URL, rejects shared registrable provider domains, pins a common confirmed block, reads exact code
and drop state twice, simulates the full `executeAutonomousAcquisition(intent, 0x)` entry point from
the agent twice, estimates gas twice, and closes with a block/reorg and real-clock check. The facade
exposes only read methods and an inert frozen transport descriptor. The result still does not sign
or submit. Programmatic dependency-injected results are local test evidence; only this default CLI
path counts as genuine transport-bound evidence.

## Deployment evidence workflow

The V2 deployment is a separate immutable release from V1. After the four deployment receipts have
at least 20 confirmations, build the source-verification-pending proposal from the exact Foundry
broadcast artifact and full clean release commit:

```sh
npm run broker:autonomy:v2-deployment-manifest-proposal -- \
  --artifact broadcast/DeployAutomatedSeaDropV2.s.sol/4663/run-latest.json \
  --git-commit FULL_40_CHARACTER_RELEASE_COMMIT \
  --confirmations 20 > /absolute/path/automation-v2-pending-proposal.json
```

The generator rebuilds offline, rejects dirty compiler inputs, binds both configured RPC
transports, proves all four creation transactions and receipt inclusion, masks only compiler-declared
32-byte immutable ranges, and dual-reads every critical constructor/module getter at one common
confirmed block. It leaves registration, protocol features, global agent approval, the worker, and
automatic submission false.

After all four contracts are available through Blockscout and exact Sourcify full-match evidence,
adopt and extract the immutable verified proposal:

```sh
npm run broker:manifest:source-verification -- \
  --kind automation \
  --proposal /absolute/path/automation-v2-pending-proposal.json \
  > /absolute/path/automation-v2-verified-wrapper.json

npm run broker:manifest:extract-verified -- \
  --proposal /absolute/path/automation-v2-verified-wrapper.json \
  > /absolute/path/robinhood-automation-v2.verified.json
```

Installing the verified deployment snapshot still does not unlock the site. Guardian configuration,
published agent custody, live worker evidence, and a separately reviewed capability transition are
required afterward.

## Release gates

Do not expose the setup or start buttons until all of these are complete:

- clean release commit and reproducible offline build;
- no-broadcast simulation with exact deployer, guardian, chain, nonce, gas, and predicted addresses;
- separately authorized deployment of the adapter, V2 policy, V2 implementation, and V2 registry;
- confirmed receipts, exact runtime/constructor/module binding, and Blockscout full source
  verification for all four contracts;
- guardian registration of the exact adapter and the V2-only autonomous feature profile;
- published global agent identity, runtime/version commitment, expiry, monitoring, and emergency
  disable procedure;
- encrypted signer custody that cannot expose a raw key to the browser, logs, database, or repo;
- two-provider fresh-state worker and receipt-attestation tests;
- one-Punk capped live canary followed by immediate disable/revocation and final-state attestation;
- independent security review of the frozen release.

The authoritative V2 template is `deployments/robinhood-automation-v2.json`. It remains
`NOT_DEPLOYED`, every authorization boolean is false, and the site remains locked until these gates
are installed and revalidated.
