# V2 Forge frontend canary

This release adds `?tab=forge` to the existing Control Center. It is a **read-only research bench**, not production training or the completed Skill Forge. The selected live Punk and current wallet identity are reused. Connect Research Lab uses the normal SIWE login, not an economic transaction. Chat supports “Open the Forge” and “Show my loadout.”

## Scope and safety

- `GOGH_FORGE_TEST_OWNER` is a server-side canary allowlist containing one current owner address. Absent/invalid values disable tests. No public production burns.
- Authenticated GET reports credits, learned/equipped skills and slot count as **null/unverified**, never fabricated zeroes. Seven sockets are explicitly a design preview.
- Authenticated same-origin POST accepts exactly three diagnostic actions. Current ownership is checked both before and after provider work. No supplied URL, contract, signer, transaction, module, learning, credit or burn action is accepted.
- Contract Detective inspects the fixed Gogh collection. Rarity Eye ranks exactly three explicit IDs, including the selected Punk. Market Scout retrieves at most five current Gogh listings from the fixed OpenSea reader, stripping execution payloads.
- These tests do not run under an equipped skill or confer one. All packages remain TESTING/ADAPTING/roadmap; zero production READY or learnable skills. Existing mint sessions are unchanged.
- Switching owner/Punk clears results and invalidates late responses. Failures display no fabricated evidence. Private conversation data is not loaded.

## Source provenance

Research implementations and their original unit tests were carried unchanged from reviewed local Forge commit `ca86da0` (`broker/src/v4/skill-forge/research-tools.mjs`, `market-reader.mjs`). The prior Forge source audit remains in the dedicated Forge branch. These are Gogh-native read adapters, not dynamically installed third-party runtimes. Icons come from `feat/gogh-skill-forge` commit `0f099c0`; display assets grant no capabilities. Original imagegen prompts are documented in that commit's `docs/skill-forge-icon-art-v1.md`.

## Verification

- 87 targeted tests passed covering Forge auth/action boundaries, research, chat, collection verification and agent execution safeguards.
- `node scripts/dev/test-forge-control-center.mjs` passed against local V2 at port 64340 and a separate headless Chrome at port 9227: tab routing, 13 icons, three guarded test buttons, late-response rejection, safe failures, and 1440/390/375px layouts.
- Live local Contract Detective and three-Punk Rarity Eye reads succeeded. Local OpenSea probing cannot verify the production secret: Netlify masks its value.
- The hosted build runs `scripts/forge-live-read-check.mjs` when a canary owner is configured, testing all three implementations using the actual protected build environment. It logs only public counts/status and fails safely on missing or rejected data. This is not proof of the owner's browser sign-in; that final UI step remains owner-operated.

## Other fixes included in this working release

Receipt discovery can fall back to the configured chain-checked read RPC when PublicNode rejects historical logs. Transaction submission still uses PublicNode. Strict canonical receipt and NFT-ownership verification is unchanged.

Collection merges canonical wallet discovery, broker acquisitions and Agent Account index hints, then checks actual ERC721 owner/ERC1155 balance. Missing artwork cannot hide verified ownership. This remains bounded, incomplete inventory and **must not be used to approve burns**.

## Still required for real training

Reviewed production registry/progression and training-source deployment; all-wallet burn eligibility and recovery review; guarded 1,111 supply-floor integration; explicit typed burn confirmation; current-owner transactions for credits/learn/equip; complete skill-gated tool/execution wiring; transfer/epoch invalidation; controlled, separately approved first burn. No real Punk was burned by this integration.
