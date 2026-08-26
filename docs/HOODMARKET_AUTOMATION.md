# HoodMarket legacy HoodDrop V2 automation boundary

Status: **reviewed local adapter and screening code only**. HoodMarket is not yet part of the
deployed hosted worker. Nothing in this document authorizes deployment, registration, permissioning,
or a mint.

## Reviewed route

HoodMarket's published legacy HoodDrop V2 controller on Robinhood Chain is
`0x26B10b0c7C0f794375593f00222Fd960faC22F16`. The current reviewed runtime hash is
`0x722dc2f13ebf38431d43e12e0b1994060ec3ab14ecf45af5617d5d1ca2ca4fce`.

The local `AutomatedHoodDropFreeMintAdapter` supports only one constructor-bound collection, round,
and stage. It reconstructs exactly:

`mint(collection, roundId, stageId, 1, [])`

with zero value. Both the adapter and the offline screener require:

- Robinhood Chain ID 4663 and the exact published controller runtime;
- an exact, nonzero target collection runtime hash;
- the current active, unpaused round and one existing active public stage;
- mint price exactly zero, no allowlist, and an empty Merkle root/proof;
- quantity one, ERC-721 output, no approvals, and no arbitrary calldata;
- remaining wallet, round, and collection supply; and
- the exact next token ID.

HoodMarket's collection factory accepts caller-supplied creation code. Factory provenance therefore
does not make an arbitrary collection safe. Every target still requires its own source/runtime review
and its own adapter deployment.

## Required production steps per target

1. Discover the round and stage from controller events and confirmed on-chain state. Do not scrape or
   rely on HoodMarket's private website endpoints.
2. Review the exact collection source, runtime, proxy status, supply behavior, and HoodDrop bindings.
3. Deploy the target-specific adapter and source-verify it.
4. Have the Guardian Safe register that exact adapter commitment.
5. Let each Punk owner grant only the exact adapter/controller/collection/selector permissions and a
   bounded daily cap and authorization window.
6. Extend the hosted worker with dual-RPC fresh-state reads and a full Punk Account simulation.
7. Run a single canary, attest its receipt and NFT ownership, then revoke/contain before wider use.

Until those steps pass, the site must describe HoodMarket as **prepared, not live**.

HoodMarket also publishes a newer HoodDrop V3 ERC-1967 proxy. This V2 adapter intentionally does not
accept that proxy, its upgradeable implementation, or its recipient-aware calldata. V3 requires a
separate proxy/implementation/upgrade-authority review and a separate adapter; it must never be
silently treated as V2-compatible.
