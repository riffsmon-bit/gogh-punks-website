# Punk Wallet, Withdrawal, Directed Mint, and Discovery Boundaries

## Punk Wallet inventory

The Control Center Assets tab reads a bounded indexed inventory for the selected V3 Punk Wallet.
It combines:

- confirmed Art Broker mint receipts that still pass a live owner check;
- OpenSea's indexed Robinhood account inventory for manually received ERC-721 and ERC-1155 assets;
- cached on-chain/OpenSea display metadata, collection names, artwork, and advisory collection floors.

Marketplace metadata is for display and selection only. A stale marketplace record cannot make an
asset withdrawable. The withdrawal preflight rechecks the current Gogh Punk owner, exact V3 wallet
runtime, live NFT owner or ERC-1155 balance, and a full fixed-destination transfer simulation.

## Withdrawal flow

1. Open `/broker/punk/{tokenId}#assets`.
2. Choose an NFT card. Contract, token ID, standard, Punk Wallet, and current owner are filled in.
3. For ERC-1155, choose a quantity no greater than the live balance.
4. Confirm the fixed destination: the wallet that currently owns the controlling Gogh Punk.
5. The browser repeats the live preflight immediately before requesting one MetaMask transaction.
6. The UI waits for a successful receipt, refreshes the Punk inventory, and links the transaction.

Withdrawals remain one asset at a time. The current account interface has no narrowly typed bulk
NFT method, so this update does not introduce arbitrary batching or general account execution.

## Directed OpenSea mint review

The Mint tab accepts only a clean OpenSea collection/drop URL. Inspection retrieves drop details;
preparation retrieves a quantity-one proposal and decodes it against the exact supported SeaDrop
method. The server stores a five-minute, wallet-bound, Punk-bound, single-use intent containing a
hash of the complete review. Revalidation rereads ownership, recipient, chain, price, and calldata.

This preview does **not** broadcast a directed mint. `executionReady` remains false because a future
production executor must additionally prove the current supported runtime, policy and allowance,
simulate the complete Punk Wallet call, and validate expected asset/native-balance effects. Paid
execution remains off. OpenSea proposal data is never accepted as execution authority by itself.

## Social-aware free-mint discovery

Discovery and execution are separate stages:

1. The existing worker discovers active, zero-price candidates with reviewed runtime families.
2. A server-only OpenSea metadata source gathers a project name, SeaDN image, HTTP(S) website, and
   normalized X profile from fixed OpenSea API endpoints.
3. Candidates are ranked off-chain.
4. Only the top bounded set enters the existing dual-provider live checks and transaction simulation.

Initial auditable score:

| Signal | Points |
| --- | ---: |
| Website present | 15 |
| X profile present | 15 |
| Both present | 10 |
| Independently proven public-metadata cross-reference | 15 |
| Complete name/image metadata | 10 |
| Known supported platform | 10 |

The OpenSea source does not claim that a website and X profile cross-link merely because both links
exist. Cross-reference points stay off until a separate SSRF-safe verifier proves that relationship.

Free price and supported runtime are mandatory before ranking. A score can change priority only; it
cannot bypass runtime, price, ownership, authorization, daily cap, simulation, or recipient checks.

`AGENT_MAX_CANDIDATES_TO_VALIDATE` defaults to `3` and is hard-bounded. Website URLs are never fetched
by the worker, which avoids SSRF and prevents social enrichment from increasing chain RPC fanout.

## Activity transparency

Worker history stores a bounded public discovery summary: candidate counts, how many exposed a
website/X profile, how many reached live validation, and up to three sanitized advisory candidate
cards. It contains no keys, calldata, signatures, access tokens, or execution permission. The Punk
Control Center explains explicitly that social signals affect discovery priority, not contract safety.
