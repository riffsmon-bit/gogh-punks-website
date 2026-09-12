# Gogh skill source audit

Audit date: 2026-09-08 America/Detroit (live probes continued into September 9 UTC).
Branch: `feat/gogh-skill-forge`, based on core V2 commit `bff04fb7461b1171b770abdb55f094f6680d6b67`.

This is an evidence checkpoint, **not a completed Skill Forge release**. No external skill was installed in an agent, no signing credential was supplied to a third party, and no production configuration was changed. Source clones are inspection-only, outside the application. Production skills must not fetch repository HEAD at runtime.

## Results, without inflating readiness

- Seven public repositories cloned and source-inspected; exact revisions below.
- Fourteen candidate packages/workflow surfaces evaluated below. Three whole-runtime integrations rejected; their public documentation can still inform independent implementations.
- Two hosted external tool surfaces were initially probed: Emblem anonymous tool discovery worked; OpenSea initialization worked but unauthenticated data access was blocked. Subsequent owner-provided Keychain access enabled live OpenSea reads, documented below. Tool discovery is **not** successful end-to-end skill acceptance.
- Zero externally implemented skills vendored, installed, or approved for production.
- Three Gogh-native tool paths implemented: contract evidence, inline NFT metadata/sample ranking, and a restricted market read adapter. All three now have narrow live Robinhood evidence (see the September 9 authenticated follow-up below); this is not complete production acceptance.
- **Zero READY production skills.** Additive on-chain equipment and shared research-tool gating are locally tested; live V2 registration, executor integration and production review remain outstanding. Do not show the candidate list as learnable production skills.

## Pinned sources

| ID | Repository / maintainer | Inspected commit | Last commit timestamp | License at this revision |
|---|---|---|---|---|
| B | [BankrBot/skills](https://github.com/BankrBot/skills/tree/abcab502b450327b154f6fbbdbbf4451807f2ce8) / BankrBot and contributors | `abcab502b450327b154f6fbbdbbf4451807f2ce8` | 2026-09-08T12:48:16-04:00 | No root LICENSE found; individual packages vary. Do not assume permission to vendor. |
| O | [ProjectOpenSea/opensea-skill](https://github.com/ProjectOpenSea/opensea-skill/tree/70c513e73b8bf429affbd680ac6f2ae043c396b5) / OpenSea | `70c513e73b8bf429affbd680ac6f2ae043c396b5` | 2026-09-01T19:07:57Z | MIT declared in package.json/README; no root LICENSE file found. Resolve attribution text before copying source. Version 2.21.1. |
| E | [EmblemCompany/Agent-skills](https://github.com/EmblemCompany/Agent-skills/tree/9a68a35c4d61a8b6fe673fa98c39e4b9dd9d2cd3) / EmblemAI | `9a68a35c4d61a8b6fe673fa98c39e4b9dd9d2cd3` | 2026-05-15T08:53:45Z | MIT, LICENSE present. MCP bridge 1.1.0. |
| C | [blockscout/mcp-server](https://github.com/blockscout/mcp-server/tree/095ef2c03f1aa3325da0baa41c8bf29aa1bbb6e6) / Blockscout | `095ef2c03f1aa3325da0baa41c8bf29aa1bbb6e6` | 2026-09-07T21:17:33-06:00 | Custom `LicenseRef-Blockscout`, effective 2026-05-15. Requires licensing review; not assumed MIT. |
| R | [OpenRarity/open-rarity](https://github.com/OpenRarity/open-rarity/tree/f2bc4d8b6e6eea1dd0a7f57017aa3d87d01fcc43) / OpenRarity contributors | `f2bc4d8b6e6eea1dd0a7f57017aa3d87d01fcc43` | 2023-09-26T09:01:16+02:00 | Apache-2.0. Library 0.7.5; old commit is not evidence of current maintenance. |
| T | [trailofbits/skills](https://github.com/trailofbits/skills/tree/d3323cefbcf645678b8dc481de204b02ad3d02dc) / Trail of Bits | `d3323cefbcf645678b8dc481de204b02ad3d02dc` | 2026-09-02T13:44:09-04:00 | CC-BY-SA-4.0 root license. Attribution/share-alike review before adaptation. |
| G | [orange-genie/genie-plugin](https://github.com/orange-genie/genie-plugin/tree/b5decf1d4952d6109cec047323b0eed3a8e7602d) / orange-genie | `b5decf1d4952d6109cec047323b0eed3a8e7602d` | 2026-09-07T21:56:37-07:00 | No LICENSE found. No code vendoring approved. |

Every candidate below inherits the exact revision, source URL prefix and license from its source ID. “Tested” distinguishes source inspection, protocol discovery, fixture tests and actual data retrieval. NONE is usable as-is in a production Punk.

## Candidate inventory

### 1. B / bankr (wallet and agent runtime)

Source path: `bankr/SKILL.md`; purpose: wallet/portfolio research, NFTs, natural-language automation and signing. Format: SKILL.md, references and CLI/API instructions. Dependencies: `@bankr/cli`, Bankr Wallet/Agent APIs and Bankr key. Supports documented Ethereum, Base, Polygon, Solana, Unichain, World Chain, Arbitrum, BNB and Robinhood; actual Robinhood data behavior not tested. MCP not required. Wallet provisioned by Bankr. Read and transaction capable, including arbitrary signing/submission.

Tested: source inspection only; no Bankr account created, key used, terms accepted or jobs submitted. Security: broad agent prompts can mix research with financial actions; foreign custody does not inherit canonical Punk ownership. **REJECTED as a whole-runtime integration.** Potential independent research workflows only, not Mint Hunter execution.

### 2. B / bankr-token-scam-analysis

Source path: `bankr-token-scam-analysis/SKILL.md`. Purpose: EVM token forensics, deployer/admin/holder review and evidence-based reports. Format: instruction workflow, not a standalone verified-contract analyzer. Dependencies: platform research APIs/explorer/source access; Bankr environment assumed. MCP optional; no wallet signing intrinsically needed for the research. EVM approach portable, Robinhood data coverage untested. Read-only intended output, but surrounding Bankr runtime can transact.

Tested: inspected workflow; no upstream forensic execution. Security: an LLM verdict must not replace deterministic screening, and ERC20 assumptions do not automatically cover ERC721s. **UNDER_REVIEW / adapt methodology only after license clearance.** Proposed Gogh: Contract Detective; no spend authority.

### 3. B / neynar

Source path: `neynar/SKILL.md`, with `scripts/neynar.sh` referenced by the package. Purpose: Farcaster profile/feed/search plus posting. Dependencies: curl/jq, Neynar API key; signer UUID for writes. MCP not required. Chain-independent social research, not a Robinhood NFT source by itself. Wallet not needed for read endpoints; social signer required for posting.

Tested: package/interface inspection only; no authenticated request. Security: source mixes read tools and social write tools, and source content can contain prompt injection. **UNDER_REVIEW / adapt read allowlist only.** Proposed Gogh: Social Scout. Posting is excluded.

### 4. B / zerion

Source path: `zerion/SKILL.md`. Purpose: portfolio/NFT positions, pricing, gas and transactions. Dependencies: Zerion API/key or x402 USDC payments; CLI/MCP alternatives documented. Documented multichain coverage does not prove Robinhood support; must query supported chains with the chosen API plan. Research is read-only; x402 creates a payment boundary and execution handoffs are separate.

Tested: source inspection only, no paid calls or credentials provisioned. Security: never infer complete burn-safe inventory from an indexer's current NFT/token response. **BLOCKED pending chain coverage and credential/license verification.** Proposed Gogh: Portfolio Curator research, not a burn attestor.

### 5. O / opensea-api

Source paths: `opensea-api/SKILL.md`, `scripts/opensea-get.sh`, `scripts/collections/opensea-collection.sh`, `scripts/listings/opensea-listings-collection.sh`. Purpose: collection/NFT metadata, listings, offers, events, drops. CLI/SDK, shell and MCP routes exist. Dependencies: OpenSea API key; shell route curl; MCP optional. Wallet is NOT needed for public marketplace data. The wider package also includes wallet-scoped and mint/deployment operations—do not import everything.

Robinhood support is [officially documented](https://opensea.io/blog/articles/robinhood-chain-is-live-on-opensea), and the [SDK changelog](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/CHANGELOG.md) documents the `robinhood` API enum. Actual collection-contract matching must still pass at runtime.

Tested: inspected the actual GET/listing scripts; live MCP initialize HTTP 200; no-key tool discovery returned only `get_instant_api_key`; REST instant-key creation HTTP 429. No live listing was retrieved. New Gogh adapter fixture tests verify GET-only fixed host, chain/contract validation, decimal preservation, rejection of malformed identity and removal of transaction data. **BLOCKED for production on live data acceptance.** Proposed Gogh: Market Scout, Collection Researcher, Listing Watcher. Floor Hunter additionally needs reference-floor methodology and stale/liquidity controls.

### 6. O / opensea-marketplace and wallet

Source paths: `opensea-marketplace/SKILL.md`, `opensea-wallet/SKILL.md`; routing and purpose inspected in upstream README. Purpose: Seaport orders, offers, fulfillment, sweeps and wallet providers. Dependencies: OpenSea key plus signer/provider credentials; SDK/CLI/MCP alternatives. NFT trading chains must be validated per venue, asset, currency and deployed Seaport version. Transaction capable, not read-only.

Tested: routing/source inventory only; no trades, approvals, signing or wallet auth attempted. Security: broad signer setup, ERC20 allowances, recipients, expiry, order validity, royalties, stale floor and replay all need independent constraints. **REJECTED for initial production runtime.** Proposed later Gogh: Bidder/NFT Trader, individually reviewed; no current capability granted.

### 7. E / emblem-market-research

Source path: `skills/emblem-market-research/SKILL.md`, version 1.1.0. Purpose: token intelligence from CoinGecko, Birdeye, CoinGlass, Nansen. Format SKILL.md; tools via Emblem CLI/MCP. Dependencies: Emblem auth, hosted APIs; MCP optional. Read-only intent, no wallet signing intrinsically needed. Seven-chain wallet platform coverage is not proof of Robinhood support. Upstream explicitly disclaims several missing tools including social sentiment and chart technical analysis.

Tested: source inspection and shared MCP discovery, not authenticated research. Security: never expose full wallet tool surface for a research skill; external news/results are untrusted evidence. **UNDER_REVIEW / adapt selected documented reads only.** Proposed Gogh: Market Scout/token research supplement; not a replacement for NFT listing data.

### 8. E / emblem-portfolio-tracker

Source path: `skills/emblem-portfolio-tracker/SKILL.md`, version 1.1.0. Purpose: balances and conditional-trade positions. Dependencies: Emblem CLI/auth, hosted balance/Nansen APIs; MCP optional. Listed chains: Solana, Ethereum, Base, BSC, Polygon, Hedera, Bitcoin. Robinhood not listed in this package. Wallet-bound platform calls exist. Research intent is read-only.

Tested: source inspection; no portfolio call. Upstream explicitly says transaction history and historical portfolio snapshots are unsupported. Security: balance calls are not complete asset ownership proofs. **BLOCKED on Robinhood data compatibility.** Proposed Gogh: Portfolio Curator, with canonical Punk addresses retained.

### 9. E / MCP bridge

Source: `mcp-bridge/index.js`, `package.json`, bridge 1.1.0. Actual executable JavaScript bridges to `https://emblemvault.ai/api/mcp`; dependency `@modelcontextprotocol/sdk` (range ^1.29.0). Anonymous initialization/listing; calls require a vault key (read/write) or short-lived read-only bearer. `EMBLEMAI_TRANSACTIONS=enabled` enables transaction surface upstream. Tool-name glob filter covers list and call; absent filter permits all upstream tool names.

Tested: HTTP 200 anonymous `tools/list`; returned real catalog including `openseaGetBestListings`, `openseaGetCollectionStats`, NFT offers, balances and research. No authenticated tool call. Robinhood coverage not demonstrated. **UNDER_REVIEW / replace globs and dynamic discovery with exact reviewed read allowlist.** Never pass Punk private/session keys. Remote catalog remains mutable even if local bridge is pinned.

### 10. C / Blockscout contract MCP

Source paths: `blockscout_mcp_server/tools/contract/{read_contract,get_contract_abi,inspect_contract_code}.py` and tests. Purpose: code/ABI inspection, read calls, portfolio/NFT/chain data. Dependencies: Python, Web3.py, MCP/FastMCP, Blockscout PRO API/key and supported RPC. Read-only intended blockchain use; generic REST tool is broader and should not be exposed. MCP required for this server, not for independent JSON-RPC analysis.

Tested: implementation inspection, not upstream test execution. Robinhood explorer API attempt returned HTTP 403; hosted PRO support not verified. **BLOCKED on licensing and source/API access.** Proposed Gogh: enhanced Contract Detective. Independent PublicNode RPC evidence tooling is implemented instead; it does NOT claim Blockscout verified-source analysis.

### 11. R / OpenRarity reference engine

Source paths: `open_rarity/scoring/scorer.py`, `handlers/information_content_scoring_handler.py`, `scoring/utils.py`, tests. Real Python algorithm, not an agent instruction. Dependencies: Python >=3.10,<3.13, numpy, pydantic, requests. Pure scoring needs no API, MCP or wallet; resolver paths use external metadata APIs. Chain-independent given validated collection metadata. Read-only.

Tested: source algorithm inspected; upstream suite not run (available Python is 3.14, outside declared range). Numeric/date traits are rejected by the upstream scorer; Gogh has a numeric `Archetype Edition`. **UNDER_REVIEW / not used as-is.** Proposed Gogh: Rarity Eye. Current native sample calculator is explicitly a different inverse-frequency model, not advertised as OpenRarity, with opt-in categorical numeric handling. Full collection coverage remains unproven.

### 12. T / secure-workflow-guide

Source path: `plugins/building-secure-contracts/skills/secure-workflow-guide/SKILL.md`. Purpose: real Slither tooling plus secure-development workflow. Dependencies: source/compiler access, Slither and associated analysis tools; no API/MCP/wallet inherently required. Solidity/EVM applicable; Robinhood deployment requires verified source/artifact matching. Read-only analysis, not spend capability.

Tested: inspected workflow; no Slither run claimed. Security: compiling/analyzing untrusted repositories should run isolated without secrets/network signing. Automated findings are not a guarantee of safety. **UNDER_REVIEW**, with license review before derived instruction distribution. Proposed Gogh: developer-side Contract Detective enhancement, not automatic wallet authority.

### 13. G / rarity

Source path: `plugins/genie/skills/rarity/SKILL.md`, `capabilities.json`. A downloadable instruction wrapper exists, but calls `~/Genie/bots/rarity-genie/rarity.py`, which is not present in this repository. References daily metering and an OpenSea user key. MCP not demonstrated. Wallet unnecessary for stated read-only ranking. Chain compatibility depends on missing implementation.

Tested: source/path inspection, no opaque script execution. **REJECTED as a runtime dependency**: required engine is missing and licensing unestablished. Proposed Gogh: inspiration for truthful revealed-state and reproducible-rank UX only; not counted as an adapted implementation.

### 14. G / inscription and Skill Flow surfaces

Source paths: `plugins/genie/tools/chain.py`, `chain.sh`, `skills/inscribe/SKILL.md`. Public HTTP client code reads a hosted chain feed and POSTs inscriptions/claims. Dependencies: shell/Python, hosted Railway API, local identity/memory conventions. Public [product](https://app.orangegenie.bot/), [docs](https://app.orangegenie.bot/docs), and [workshop](https://app.orangegenie.bot/build/) inspected. Public plugin is downloadable and commit-pinnable; this is NOT proof arbitrary Skill Flows are exportable or executable via a stable API.

API: concrete feed/inscription routes exist in source. MCP: none established for the reviewed workflow. Flow invoke/export schema, deterministic portability and portable wallet execution: **not verified**. Product materials reference Wildflower and trading surfaces; no tested Robinhood adapter. No API writes, claims, inscriptions or plugin hooks executed. **UNDER_REVIEW / inspiration only**, with no production dependency. Generic inscription writes are not NFT skill-state storage or Punk custody.

## Five priority skills: acceptance ledger

| Gogh candidate | Status | Demonstrated | Still needed before READY | Wallet capability |
|---|---|---|---|---|
| Contract Detective | TESTING | Live Robinhood bytecode/hash, interface and EIP-1967 evidence; hashed package and local owner/equipment-gated real implementation | Broader proxy/source findings and deployed integration acceptance | NONE |
| Market Scout | TESTING | Restricted REST adapter passes fixtures; authenticated live read returned five Gogh listings; local owner/equipment gate tested | Freshness/order-validity acceptance and deployed integration; no purchase capability | NONE |
| Rarity Eye | TESTING | Live inline metadata for #93/#94/#95; sample ranks; local owner/equipment gate; separate complete frozen OpenSea rarity dataset | Full-collection native scoring/revealed-state decisions and deployed integration; OpenSea ranks do not validate the native sample algorithm | NONE |
| Link Sniper | ADAPTING | Existing V2 normalizer and trusted-resolver boundary identified | Approved live link→contract→chain→mechanism→price→screen→simulation end-to-end proof | No execution by itself |
| Mint Hunter | ADAPTING | Existing V2 screened zero-price SeaDrop builder/simulator identified | Exercise real test mint through full gated pipeline; prove equipment/policy/expiry/receipt behavior | Only existing bounded free-mint executor after authorization |

No future paid-mint, purchase, bidder or trading skill is activated. Source instructions teach HOW; reviewed tools supply DATA/ACTIONS; Gogh supplies PERMISSION; canonical Punk accounts retain CUSTODY.

## Live evidence recorded

- Contract probe: block `58176557`, hash `0x57e28564937cdd7a6f8669cb488d0a8964b0639654d99a6806e0884abd7ff999`; Gogh bytecode hash `0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93`; 18,470 bytes; ERC721 response true; standard EIP-1967 implementation/beacon slots zero. This does not rule out all proxies/vulnerabilities.
- Metadata/rank probe: block `58177526`, hash `0xb2702e18e1ad9fcca65fcf53a60f1dbb57cfeee9237db88264f58216ab032fc7`. Metadata SHA-256 `b0418987f384183b4d7e1f0ad54349520fe61b475252121574c2c0aabc1bd2e2`. Numeric values treated explicitly as categorical. All three tokens tie at score 13 in this tiny sample—NOT collection-wide rarity.
- OpenSea initialization 200, no-key tool list only `get_instant_api_key`; instant-key REST 429. No secret stored or logged. Public [authentication/agent-skill documentation](https://docs.opensea.io/reference/agent-skill) is documentation, not successful API access evidence.
- Emblem anonymous MCP tool listing 200. Tool discovery is not authenticated data retrieval or execution acceptance.

## Promotion and update policy

### Authenticated OpenSea follow-up — 2026-09-09 UTC

The owner saved an OpenSea API key through a hidden Terminal password prompt into macOS Keychain. It was read directly into process memory, never placed in source, shell history, logs or the browser. No Netlify setting was changed.

At `2026-09-09T03:34:19.020Z`, the unchanged `createMarketReader().getListings()` path successfully validated the Gogh collection's Robinhood contract and retrieved five current listings from OpenSea. First returned order: `0x32a8897d12ac24ef1d3784ac575586c8b034897a28aeb2ca792c4b07ba190ef7`; quoted value `799999900000000` wei (ETH with 18 decimals). This is historical data evidence, not a current price recommendation or execution proof. The adapter discarded protocol/signing data and returned `walletAuthority: NONE`, `executable: false`.

Authenticated Get NFT also returned OpenRarity strategy `1.0` and rank `1295` for Punk #93. Collection-wide capture is tracked separately in [snapshot status](v2-rarity-snapshot-status.md). A single successful rank read is not a finalized collection snapshot.

The earlier unauthenticated probes above remain historical evidence. Authentication is no longer the Market Scout blocker. This follow-up does not install an external skill, create a new registry approval, or enable Floor Snipe purchases. Production READY count remains zero.

Each manifest must pin upstream commit and file hashes, local executable/instruction hashes, dependencies, adapter versions, approved tools, capability mapping, chain, risk tier and acceptance evidence. Registration is controlled review, never an AI action. Only READY, active, nondeprecated versions may be learned for production. Capability resolver also checks equipment and current owner authorization on each economically significant boundary. Remote API responses remain untrusted even when package source is pinned.

An external update creates a new candidate/version. Existing learned versions do not silently mutate. Security disable preserves learned history but immediately denies execution. This audit does not claim those registry/executor integration controls have already been deployed.

## Local artifact fingerprints and tests

September 9 packaging follow-up: `broker/skills/{contract-detective,rarity-eye,market-scout}/v1` contains Gogh-authored instructions and manifests bound to the real tools below. No external code was vendored; upstream licenses were not assumed to permit copying. `research-runtime.mjs` verifies implementation SHA-256, supplies provider-neutral context through the shared capability gate, and rejects undeclared arguments. A missing API key removes the market tool. Default packages are unapproved TESTING and expose no tools even if a disposable registry fixture is READY. Test-only approval exercises actual read implementations against controlled RPC/API fixtures, including old-owner, unequipped and disabled-skill denial. This is not deployed end-to-end acceptance or a production promotion. Exact package hashes are recorded in the [handoff](v2-skill-forge-handoff.md).

These are audit fingerprints, **not registry approval or learned-skill hashes**. A production package must additionally bind its manifest, instructions, dependency lock and runtime adapters. Tool prototype version: `0.1.0`.

| Artifact | SHA-256 |
|---|---|
| `broker/src/v4/skill-forge/research-tools.mjs` | `53322cbbcfa71c34e210548e9e10db99ab0da63dc39516ad1a144024b3c39c98` |
| `broker/src/v4/skill-forge/market-reader.mjs` | `28baf5dc5190efd2ef32ee9e6d11237da566376ae5b556cfc57ca5fdbc5130e9` |
| `broker/src/v4/skill-forge/burn-eligibility.mjs` | `9a980263875d62028d141f88089f0619bbb3e518973b5b5de32f08493d854e76` |
| `broker/src/v4/skill-forge/burn-warning-view.mjs` | `60d413e3b1f3d282fc8f4819f66b276485730e2ff00cebfc2a121c8be305c8ee` |

At the original source-audit checkpoint, `node --test tests/skill-forge-*.test.mjs`: **39 passed**. View tests use a lightweight DOM stub; they do not establish mobile layout or live browser integration. Existing `owner-assisted-seadrop-mint` and `art-broker-v2-skills` regression files: **7 passed**. Subsequent progression contracts, resolver and local integration tests are documented in the [implementation checkpoint](v2-skill-forge-progress.md); they do not promote these candidate skills to production READY.

Reproduce the narrow live contract/metadata checks with:

```sh
node scripts/audit-skill-forge-readonly.mjs --live-readonly
```

This reads PublicNode only and prints public evidence. It cannot sign, submit, burn, purchase, fund, or create third-party wallets. If any sampled NFT later burns or metadata becomes unsupported, the probe fails rather than fabricating empty metadata.
