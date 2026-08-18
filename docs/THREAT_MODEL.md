# Threat Model

## Assets and invariants

Protected assets are Punk Account ETH, tokens, NFTs, control rights, policies, galleries, provenance, and owner-private notification data.

Non-negotiable invariants:

1. Live canonical Punk owner controls the account.
2. A different previous owner loses authority immediately.
3. Team and guardian cannot withdraw Punk assets.
4. Agent cannot call general execution or bypass policy.
5. Unknown autonomous execution starts off.
6. Selling and autonomous minting start off.
7. Owner recovery works while broker services are paused.

## Adversarial scenarios

| Compromise | Potential attack | Hard protection / maximum impact | Remaining exposure and mitigation |
| --- | --- | --- | --- |
| AI service | Invent address, price, or calldata | AI cannot supply calldata/target; typed schema, registered adapter, policy | Biased recommendations; show evidence, diversify models, rate-limit |
| Agent signer | Submit every allowed opportunity | General execute unavailable; transaction/day/week/count/reserve/expiry bounds | Can spend full allowed budget; use tiny limits, short expiry, revoke/monitor |
| Multi-currency splitting | Bypass acquisition frequency with several currencies | Spend is isolated per currency, but daily acquisition count is account-wide | Approved currencies still have independent budgets; review each unit and limit |
| Backend | Alter database or hide ownership | Database is not authority; contracts read `ownerOf` | Read UI can lie; wallet must show exact contracts and simulate |
| Frontend | Replace displayed transaction | Owner wallet sees exact EIP-712 fields/calldata; on-chain policy | User may approve malicious direct wallet action; CSP, signed releases, wallet decoding |
| Database | Change scores/proposals | Intent binds price, token, owner, nonce, policy, adapter and reasoning hash | Public journal availability; rebuild from confirmed logs |
| RPC | Return false ownership or stale state | Contract execution uses consensus state; compare providers for UI | Can mislead Scout or delay submission; redundant RPCs |
| Indexer | Miss/reorder logs | Confirmations, block hashes, rewind, idempotency | Temporarily stale gallery; show indexed block |
| Indexer crash between writes | Persist evidence but skip its checkpoint, or advance a checkpoint without evidence | Raw logs, Scout projections, and monotonic checkpoint commit in one database transaction | Database outage delays Scout freshness; restart the bounded idempotent worker |
| Historical backfill | Make an old sale look recent by using index insertion time | Every projected sale stores and uses its canonical source-block timestamp | Bad RPC timestamp can mislead Scout; verify block hash/time and compare providers before production |
| Marketplace API/activity feed | Fake listing/floor or completed sale shown as active | API never authorizes execution; verified Seaport events are explicitly historical and non-actionable | Manipulated recommendation; label estimates and require a separately validated live order |
| Block explorer / verified ABI feed | False verification status, truncated ABI, malicious response | Fixed Robinhood origin, response-size/ABI bounds, confirmed bytecode remains separate, analysis only | Scout evidence can be incomplete or misleading; retain evidence coverage and `UNKNOWN` |
| Marketplace contract | Take payment or deliver wrong asset | Approved venue/selector, bounded spend, NFT balance postcondition | Malicious allowlisted NFT can lie; audit venue and collection |
| Adapter | Build hostile call | Registered code hash, exact venue, selector, price/allowance, receipt check, kill switch | Registered adapter is privileged within bounds; independent audit |
| NFT contract | Reentrancy, lying ownership, transfer restrictions | Reentrancy guard, allowlists, risk analyzer, postcondition | Malicious collection can fake standard behavior; no autonomous unknowns |
| NFT metadata | Prompt injection, oversized payload, unsafe URL, or keyword stuffing | Bounded on-chain JSON only, sanitized fields, no remote fetch, no instruction authority, heuristic label | Self-described art tags can bias Scout; show low confidence and add isolated media analysis later |
| Holder sample | Present a few sampled token owners as total holders | UI and API label bounded sample size, unique sampled owners, and concentration caveat | Sample may be unrepresentative; exact holder claims require full transfer indexing/reconciliation |
| Price feed | Inflate floor/value | Valuations never authorize spend and are labeled estimates | Curatorial ranking manipulation; multiple sources/outlier controls |
| Punk transfer mid-flow | Old owner/agent executes | Live owner checked at execution; expected owner and policy owner bound | Same-owner round trip lacks native epoch; blocker before autonomy |
| Controlling Punk self-transfer | Owner uses unsafe `transferFrom` to its own Punk Account and creates an ownership cycle | Safe receiver rejects canonical Punks; account-routed self-transfer is blocked; cycle resolution fails closed | ERC-721 cannot block an externally initiated unsafe transfer; UI/marketplaces must reject the destination and owners must never use it |
| Inherited permissions | New owner accidentally revives prior allowlists | New-owner policy configuration advances permission generation; unpause/partial edits cannot adopt stale policy | Same-owner round-trip limitation remains as documented |
| Proposal replay | Repeat signed acquisition | Sequential nonce, policy version, expiry, chain/account/owner binding | Owner must cancel nonce if signature leaked before expiry |
| Guardian | Register malicious components | Cannot configure Punk or withdraw; owner allowlists still required | Governance can enlarge eligible surface; multisig/timelock/monitoring |
| Deployer | Retain hidden authority | Constructors give guardian registry control; account has no admin | Verify bytecode/constructor args and role handoff |
| Notification provider | Leak private target | Private settings encrypted and owner-scoped, not Punk-scoped | Endpoint metadata exposure; minimize retention and rotate keys |

## Reentrancy

Owner execution and acquisition execution share one account-level guard. NFT receiver hooks may update account state but cannot enter either execution function while a purchase is active. Exact allowance revocation is within the guarded transaction.

## Governance

Guardian powers are deliberately asymmetric: additive registration and global feature changes are governance-sensitive; disabling is emergency-sensitive. Production should use a multisig, delay additive changes, permit immediate pauses, publish every action, and monitor code hashes.

## Explicit non-claims

Passing tests is not an audit. `LOWER_RISK` is not `SAFE`. The implementation is not deployed, autonomous spending is not enabled, and no meaningful assets should enter an unaudited canary account.
