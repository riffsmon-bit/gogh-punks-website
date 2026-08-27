# Reown AppKit and mobile Art Broker setup

## Production architecture

The site has one authoritative wallet session: Reown AppKit with the Ethers v6
adapter. AppKit owns connection, reconnect, provider, account, and network state.
Every browser module reads the resulting EIP-1193 provider from
`window.__GOGH_WALLET_PROVIDER__` and the frozen presentation snapshot from
`window.__GOGH_WALLET_SNAPSHOT__`. Browser modules do not initialize a second
WalletConnect, Coinbase, injected-wallet, wagmi, or viem session.

The project ID is runtime configuration. It is never compiled into tracked
source:

```text
NEXT_PUBLIC_REOWN_PROJECT_ID=<32-character Reown project ID>
```

`/api/broker/wallet-config` returns only the public project identifier and the
current request origin with `Cache-Control: no-store`. Missing or malformed
configuration leaves connection unavailable instead of falling back to an
unreviewed wallet stack.

The AppKit bundle is produced during `npm run site:check` and is deliberately
ignored by Git. A first-time visitor does not download it, initialize a wallet,
or make an RPC request until **Connect wallet** is selected. A one-bit local
marker lets a known prior session restore during browser idle time without
opening a wallet prompt. The document, setup copy, and Punk cards are never
parser-blocked by the SDK.

AppKit's public custom network uses only Robinhood's official public RPC.
`ROBINHOOD_SECONDARY_RPC_URL` (including an Alchemy URL, when configured) is a
server/CLI-only archive input. It is never returned to browser JavaScript.
Routine 15-second activity refreshes read the worker database only; a full
dual-provider chain check happens when a Punk is selected, an owner requests a
live refresh/action, or the worker evaluates a candidate.

The operator can test the live RPC pair explicitly—without starting a worker—by
running `npm run broker:rpc:check`. This command reads `.env` only when called,
checks chain 4663 and one 12-confirmation common block, prints only provider
origins (never credential-bearing URL paths), and has no signing or submission
method.

## Reown Dashboard setup

In the [Reown Dashboard](https://dashboard.reown.com), configure the project
used by `NEXT_PUBLIC_REOWN_PROJECT_ID` and add only exact origins that are
actually used:

- `https://goghpunks.xyz`
- `https://www.goghpunks.xyz` only while that hostname serves the site
- the exact production Netlify hostname
- each exact deploy-preview URL used for wallet QA
- `http://localhost:8888` and `http://127.0.0.1:8888` for Netlify Dev

Do not add wildcard origins. Reown allowlist changes may take roughly fifteen
minutes to propagate. The AppKit metadata URL is the current origin, so an
origin that is not explicitly admitted will fail rather than impersonate the
production site.

Robinhood Chain is configured from the repository's reviewed production
values:

| Field | Value |
| --- | --- |
| Chain ID | `4663` |
| CAIP network | `eip155:4663` |
| Name | Robinhood Chain |
| Native currency | ETH, 18 decimals |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |

## Setup journey

The primary Broker journey has five decisions:

1. Choose a live wallet-owned Punk from image cards.
2. Review that Punk's NFT wallet and custody explanation.
3. Choose a hard daily limit from 1–10 and an authorization period from 1–30
   days, including bounded custom values.
4. Review the zero-price-only summary and complete the confirmation-backed
   activation sequence.
5. Reuse ready hosted gas or fund one of the existing supported amounts, then
   launch the selected agent.

Confirmed active Punks skip activation. Ready hosted gas skips funding. Safe
wizard state—Punk ID, current step, cap, and duration—is kept in local storage
so a WalletConnect mobile round trip or reload can resume. Signatures, private
keys, transaction artifacts, and authorization evidence are never persisted.

The success screen opens the selected Punk in the existing live Agent Console
or Portfolio. The complete pre-existing controls remain available under the
advanced workspace rather than competing with first-time setup.

Returning collectors also receive a compact **Your Active Agents** panel. It
lists every activated wallet-owned Punk with its image and Punk wallet. Choosing
an agent reuses the existing selected-Punk live checker to load its current
authorization, daily usage, expiry, and latest worker activity; it does not
start another background chain polling system.

## Mobile and error handling

The layout is explicitly checked at 375, 390, and 430 CSS pixels. Primary
actions are at least 54 px high, the step action area is sticky, and both the
wizard and mobile navigation include iOS safe-area padding. Wallet connection
state renders independently of NFT discovery as:

```text
Connected · 0x1234…7890 · Robinhood Chain
```

User cancellation, connection rejection, session expiry, QR timeout, stale
provider state, RPC failure, wrong network, and a rejected network switch are
translated into plain-language UI. Blockchain-sensitive steps use waiting,
submitted/confirming, confirmed, and failed states; selection alone may update
optimistically.

## Measured change

Measurements are deterministic gzip byte counts from the pre-change Git `HEAD`
and this implementation on 2026-08-26. They are asset measurements, not a claim
about a user's cellular latency:

| Asset | Before | After |
| --- | ---: | ---: |
| Broker HTML, gzip | 7,221 B | 9,167 B |
| Wallet controller, gzip | 2,890 B | 5,246 B |
| Setup wizard, gzip | — | 4,617 B |
| Lazy Reown AppKit bundle, gzip | — | 1,191,950 B |

The AppKit row is an on-demand transfer: first-visit bytes before Connect are
**0 B**. It is fetched after Connect, or during idle restoration for a browser
that previously held a Reown session.

The wizard module imported in 10.712 ms in the local Node 24 smoke measurement.
AppKit is intentionally an asynchronous bundle and is cached as a static asset;
real MetaMask, QR, and iPhone deep-link timing must still be recorded during the
production-domain device matrix because no automated test can approve a real
third-party wallet session.

## Verification

Run:

```sh
npm run site:check
```

The checked surface includes environment-only configuration, reconnect and
disconnect, mobile resume, session expiry, wrong-chain handling, rejected
switches, authoritative provider replacement, state-aware resume, already
active and gas-ready routing, bounded persistence, mobile CSS, CSP, and the
existing activation/portfolio safety suites.

Mobile screenshots:

- [375 px](screenshots/art-broker-wizard-375.png)
- [390 px](screenshots/art-broker-wizard-390.png)
- [430 px](screenshots/art-broker-wizard-430.png)

The screenshots exercise responsive rendering without a wallet. A final manual
acceptance pass must use the production domain on mobile Safari and cover an
injected MetaMask connection, WalletConnect deep-link return, desktop QR,
reconnect, rejected switch, expired session, activation rejection, activation
confirmation, funded-gas skip, and successful Agent Console transition.

## Primary SDK references

- [Reown AppKit JavaScript installation](https://docs.reown.com/appkit/javascript/core/installation)
- [Reown AppKit JavaScript actions](https://docs.reown.com/appkit/javascript/core/actions)
- [Reown custom networks](https://docs.reown.com/appkit/next/core/custom-networks)
- [Reown content security policy](https://docs.reown.com/advanced/security/content-security-policy)
- [Reown domain allowlist FAQ](https://docs.reown.com/appkit/faq)
