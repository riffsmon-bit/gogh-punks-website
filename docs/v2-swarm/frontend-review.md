# Control Center and Forge frontend review

September 13, 2026. Specialist M/N, branch `v2/swarm-frontend`.

## Result

The existing arcade roster, Talk, Strategy, Fund, Collection, Activity, Forge and Settings presentation is preserved. Fund now mounts a separate owner recovery panel for the Agent Account. It supports exact native ETH, EntryPoint deposit, ERC-721 and ERC-1155 recovery through the reviewed controller. It provides no destination editor, signer, arbitrary transaction or calldata input.

The hero's `profile.collectionCount` is labeled **Acquisition history · records**, with unknown shown until the authenticated profile loads. It no longer serves as a current NFT count. Collection retains the current-holdings API's custody and ownership status. Verified Agent-held NFTs open an in-memory recovery draft; V3-held assets keep their existing management route. V3 ETH/WETH labels and separate exact Agent ETH/EntryPoint balances avoid mixing custody or hiding small Agent balances through rounding. Failed or unloaded Agent balances remain **NOT VERIFIED**.

Paid and selected-burn panels preserve typed recovery hashes through busy/error rerenders. The paid panel retains the chat price limit and explains the historical-chain prerequisite. A failed status read cannot trigger automatic preparation of a new budget. The burn phrase and acknowledgement persist only for the same owner/Punk/full review, and reset when that review or selection changes. Existing expiry, attempt journal and submission boundaries remain in their owning modules.

## Integration contract

- Mount: `createAgentRecoveryPanel({ root, getSelection, ensureSession, getProvider? })` from `/punk-agent-recovery-panel.js`.
- Selection: `{ tokenId: decimalString, owner: address, chainId: 4663, preview: false }`; host ownership discovery remains in `broker-v2.js`.
- Public route: `/broker/v2/?tab=fund&tokenId=<Punk>#agent-recovery`. The requested Punk is selected only from the verified owned roster. The section title repeats the actual selected Punk.
- Gallery action: `openAsset({ standard, collection, tokenId })` prepopulates supported NFTs only. It neither prepares a transaction nor opens a wallet. Existing pending recovery must be finished or cancelled before selecting a new asset.
- Host lifecycle: call `selectionChanged()` when wallet/Punk/network changes. `destroy()` invalidates pending callbacks and clears the presentation timer.
- Controller dependency: `/punk-agent-recovery.js`, `createAgentRecoveryController({ provider, owner, tokenId, isCurrent, onChange })` with `getState`, `prepare(intent)`, `cancelReview`, `refresh`, `recover(hash)` and **required `submit({ expectedReview })`**.
- `expectedReview` is a recursively frozen deep copy of the exact displayed full review, captured on the explicit confirmation click before authentication awaits. The controller must compare it to the PREPARED journal under its Web Lock and reject missing/drifted reviews. Parent and B agreed this signature following Q's cross-tab review finding; the older zero-argument submit implementation must not be integrated with this panel.
- API remains B's `POST /api/v2/agent-account/recovery`, with the documented exact typed intent. The panel does not call a second API or introduce new server schemas.
- Parent owns coordinated `withdrawControlUrl` values in the collection/history endpoints. Use the route above for Agent custody. No API files were edited here.

## State and safety behavior

Mounting, selection changes and the expiry timer do not sign in, prepare, reconcile or request wallet transactions. Review is an explicit button and may request the existing sign-in. Confirmation requires the review acknowledgement and more than five seconds remaining. Confirmation alone calls `submit({ expectedReview })`; refresh and hash recovery only invoke their controller methods.

An expired PREPARED review stays visible and requires explicit cancellation followed by fresh preparation. An unresolved wallet result keeps the pending controls and draft hash; the UI never infers submission or completion from pasted text. Journal states and verified receipts come only from the controller. The panel does not implement competing storage or locks, bypass missing Web Locks, clear journals, resend transactions, or confirm a pending receipt. Twelve confirmations are described explicitly. A failed confirmation clears acknowledgement and blocks confirmation until a fresh review where applicable.

The new controls use native labels/selects/buttons, a polite status region, a named section, visible keyboard focus, wrapping addresses and 44px actions. Draft input DOM nodes remain mounted during checks and expiry updates. Layout uses two columns at desktop/tablet widths and one below 720px; reduced-motion behavior inherits the existing page rules. The selected-burn and paid panels retain their existing presentation and explicit actions.

## Validation

`node --test tests/v2-swarm-frontend.test.mjs tests/art-broker-v2-ui.test.mjs tests/art-broker-v2-chat-routing.test.mjs tests/skill-forge-burn-warning-view.test.mjs` passed **35/35** tests, including the recovery-access and failed-status-preparation refinements.

The 13 new DOM-fixture tests cover mount/timer silence, exact values, separate confirmation, expiry cancellation, stale displayed-review binding, ambiguous wallet results, hash preservation, NFT draft prefills, numeric boundaries, paid/burn recheck failures, burn acknowledgement resets and truthful count/custody wiring. Fixtures replace controller/API/wallet dependencies; no network, wallet provider or blockchain is contacted. They validate frontend state handling, not the cryptographic/controller checks covered by B and Q.

`node --check` on changed JavaScript and `git diff --check` pass. Heavy Chrome, site build and full integrated validation are reserved for the parent because disk space is constrained. No responsive screenshot or live wallet success is claimed by this report.

## Ownership and remaining dependencies

Changed paths: `site/broker-v2.js`, `site/broker-v2.css`, new `site/punk-agent-recovery-panel.js`, `site/directed-paid-panel.js`, `site/forge-selected-burn-panel.js`, `site/broker/v2/test-guide/index.html`, new `tests/v2-swarm-frontend.test.mjs` and this report. Parent explicitly approved the paid and burn panel additions to the original ownership boundary.

Intentionally untouched: Agent core/controller/API, contracts, ABIs, registry releases, schemas, migrations, worker, deployment configuration, package files, shared `node_modules`, main workspace and operational scripts. No transaction, burn, refund, sweep or deployment was sent.

Required integration work is B's mandatory displayed-review binding, parent endpoint links and integrated browser validation. The production archive RPC prerequisite remains externally blocked according to the latest supplied production evidence. Passing local frontend tests does not establish live paid mint availability.
