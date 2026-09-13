# Launch acceptance and owner test sequence

This is the swarm's review matrix, not authorization to execute a production transaction. The production broker is `https://goghpunks.xyz/broker/v2/`; its existing guide is `/broker/v2/test-guide/`. Local swarm changes must pass integration review before they are represented as deployed.

| Product surface | Evidence required for acceptance | Current constraint / assigned owner |
|---|---|---|
| Select a Punk and read its wallets | Current original `ownerOf`, canonical V3 and separate Agent addresses, honest balances and custody | B audits authority; M preserves distinct wallet labels |
| Fund and recover assets | Typed owner review, fresh owner/runtime checks, exact destination, simulation, verified receipt; ambiguous requests never resend | B adds Agent recovery; existing V3 recovery retained; no swarm broadcasts |
| Skills follow the Punk | Credits/learned/equipped state persists across transfer; old owner rejected, new owner requires fresh authority | C/P contract and integration proofs |
| Transfer stops managed automation | Canonical history detects transfer including away-and-back; unavailable history blocks execution | Existing contract lacks permanent round-trip invalidation; J/L review managed-worker safeguards |
| Chat and strategy | Five existing provider adapters, bounded response/timeout/fallback, complete structured intent, explicit owner review | E hardens provider boundary; configuration is not live provider acceptance |
| MCP research | Authenticated selected token, fresh equipped capability gate, no arbitrary signer/calldata, safe errors | F; owner reads remain separate from learned research tools |
| Shared discovery and link analysis | One shared ingest, provenance/deduplication, correct chain, safe link boundary, no website transaction acceptance | G/I; missing source data remains unknown |
| Marketplace research | Read-only collection/listing evidence, currency/decimals, age/coverage and source attribution | H; floor sweeps and WETH bids remain unavailable for execution |
| Free mission | Owner-bounded session, eligible candidate, exact simulation, durable receipt accounting, recall | L/P; no unrestricted automation activation |
| Directed paid mint | Both independent archive providers pass before a new budget; one owner confirmation; exact delivery; durable retries | External archive authentication/access is still blocking new production budgets |
| Paid cancellation/recovery | Cancellation confirmed before a separate reviewed withdrawal; unused amount reconciled | Earlier #93 cancellation confirmed; swarm must not broadcast its refund |
| Burn-to-training | Fresh source inventory/obligation review, explicit named pair, exact approval/burn, credit, learn, equip receipts | Existing selected #1753 → #93 canary; no real burn by this swarm |
| Control Center and Forge | Desktop/tablet/mobile roster, readable wallet/status/actions, keyboard/loading/error/empty states | M/N then independent R review; no architecture redesign |
| Persistence | Additive migrations only, least-privilege grants/RLS, uniqueness/CAS, preserved V1 history | O reviews local SQL; no production migration apply |

The eventual owner walkthrough should start with reads and chat, then small chosen funding/recovery amounts, a bounded supported free mission and recall. Directed paid minting follows only after archive readiness passes. Burning and any other financial operation remain separate deliberate owner actions. A prepared review or confirmed budget is never recorded as a completed acquisition.

For each live result, retain the Punk ID, action, displayed state, time, exact transaction hash and independently verified receipt/custody result. Do not include private keys, provider credentials, signed raw transaction bytes or private model prompts in the public evidence.
