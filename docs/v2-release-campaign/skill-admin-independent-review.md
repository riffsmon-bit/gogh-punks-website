# Independent skill-administration journal review

Status: **SCOPED REVIEW PASSED — READY FOR INTEGRATION.** Implementation reviewed and tested at skills commit `40e340b` (following `d7e0e4f`). This is not a claim of production deployment or a live wallet transaction.

This review covers the new skill-administration coordinator, cancellation review, PostgreSQL store and migrations, dedicated API/runtime, and administrator panel. It does not approve a general holder burn, purchase, bid, wallet delegation change, or unrestricted registry automation.

## Review findings addressed

- Exact-call wallet speed-ups must retain the initially observed transaction hash while settling against the canonical recovery hash. Binding every successful receipt only to the original hash would leave a real confirmed step permanently open. The recovery implementation now distinguishes exact original calldata from a different same-nonce replacement and binds terminal receipts to the canonical recovery hash.
- The cancellation review's displayed `originalNonce` must be present and exactly equal to the transaction nonce. The migration now enforces that binding as well as the original parent nonce.
- Missing JSON keys and JSON nulls must not satisfy SQL guards implicitly. The migration validates the required original review envelope, immutable identities, transaction shape, cancellation envelope and terminal proof structure.

## Authority and recovery boundary

The service prepares only approved registry steps. The browser independently reconstructs supported registry calldata and checks administrator, chain, registry, fees and expiry. The journal commits a compare-and-swap claim before a wallet request can open. Every actual transaction still requires the administrator wallet.

A reserved original request cannot be discarded merely because a browser lost its response or a user rejected a prompt. Recovery requires the same administrator, Robinhood chain and reserved account nonce through two providers. A canonical original receipt records the registry outcome; a different confirmed same-nonce transaction records replacement and releases the original hold. A pasted unrelated or unavailable transaction cannot rewrite the original transaction hash. Twelve confirmations and repeated canonical block checks are required by the coordinator.

Cancellation is a separately reviewed, same-nonce, zero-ETH self transaction with empty calldata and a bounded network fee. It is offered only for an empty account or the specifically pinned reviewed MetaMask delegation. The original registry action can win the race; the UI must report the verified outcome rather than promise cancellation.

The pinned MetaMask source at commit `bfbdf9795a976833ed2fa000baf42fbb83958b03` has an empty payable `receive()` function. This is a narrow empty-call review, not a comprehensive audit of every delegated wallet permission. [Pinned upstream source](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/src/EIP7702/EIP7702DeleGatorCore.sol#L155).

Independent read-only observations through Validation Cloud and Blockmachine agreed at block **62,488,593**, hash `0xf9f4acee5c6a7ba895c423ddd9a1b02d5599dc3b1642c3e1fa99e59f175733fd`. The selected administrator's delegation matched `0x63c0c19a282a1b52b07dd5a65b58948a07dae32b`; its implementation hash matched `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0`. Provider durations were 255 ms and 499 ms. No transaction was sent, no secret value was logged, and these observations do not prove the absence of existing off-chain wallet permissions.

## Native PostgreSQL proof

Run the independently owned proof after integrating the recovery schema and implementation:

```sh
node scripts/test-forge-skill-admin-native.mjs --disposable-only --postgres-bin=/absolute/path/to/postgres/bin
```

The script creates one private loopback PostgreSQL cluster, applies the exact two skill-administration migrations, grants login only inside that cluster, and removes its own cluster afterward. It accepts no database URL, RPC URL, production credentials or signer. An optional absolute `--repository=` selects the local implementation checkout under review.

It tests distinct native connections, concurrent preparation/claim/settlement, immutable reviews and original hashes, null/missing envelope rejection, cancellation parent locking, role limitations, database-clock expiry, canonical proof structure, audit immutability, a committed claim surviving an immediate PostgreSQL crash, and rollback of an uncommitted recovery candidate. Chain receipts in the database proof are synthetic; chain verification remains a separate coordinator responsibility.

Final result: **PASS on native PostgreSQL 16.15**. Twelve concurrent contenders were used for original preparation, original claim, cancellation claim, replacement settlement and original settlement. All groups produced only one successful claim/settlement. Forty-one malformed original envelopes were rejected, in addition to invalid cancellation and terminal-proof cases. A cancellation blocked behind a concurrently settled parent rejected after the parent committed. Both committed original/cancellation claims survived an immediate server crash; an uncommitted recovery hash disappeared. Original hashes remained immutable across a verified exact-call speed-up. The owned cluster was stopped and removed after the proof.

Exact tested migration SHA-256:

| Migration | SHA-256 |
| --- | --- |
| `20260914030000_forge_skill_admin_reviews.sql` | `a69194e6aafb639ef193190474acd7164264cc3f5d635d2a8f1cb57c64d74e5b` |
| `20260914033000_forge_skill_admin_nonce_recovery.sql` | `c7198919cb55ad034bdd54bd28ac5a4417ca8d2bad1ac761d3950d01f1b00568` |

An independent focused JavaScript rerun also passed **45 tests, zero failures/skips**, covering the coordinator, cancellation review, API and administrator panel. The browser tests use the project's lightweight DOM fixture, not a real wallet extension or responsive browser session.

```sh
node --test tests/skill-admin-coordinator.test.mjs tests/skill-admin-cancellation.test.mjs tests/forge-skill-admin-api.test.mjs tests/forge-skill-admin-ui.test.mjs
```

No additional P0/P1 defect was identified in this reviewed administrator flow after the two recovery findings were fixed. This scoped result does not establish zero release blockers in other V2 subsystems.

## Holder burn remains separately blocked

The new general holder flow still lacks a production-ready complete-history bootstrap and verified operational-obligation wiring. Its deployed reviewed-burn contract does not bind wallet inventories atomically, so a deposit while wallet confirmation is pending can become inaccessible. Its lack of a durable ownership epoch has a narrower boundary: a source transfer clears the required token-specific approval, so a source round trip needs a new explicit approval before burning; a recipient round trip can restore the review state but still requires current ownership of both Punks and a current-owner wallet transaction. These exact preconditions and limits are explicit in [the holder Forge release record](holder-forge.md). This administrator review does not waive them.

## Final gate still outstanding

- Parent integration diff, bundle and served-route review.
- Actual production restricted-role provisioning and runtime verification.
- Preview/production served-file checks and administrator wallet confirmation for any registry mutation.

No production database or blockchain state was changed by this review.

## Account-code follow-up — `c8f4d16`

Independently reviewed the helper and receipt-coordinator change. Only Viem's explicit no-code result (`undefined`) and exact `0x` now establish an empty account. Null, false, empty strings, zero, objects, malformed hex and unknown delegation code fail closed. A delegated implementation must also return nonempty even-length hex before hashing. Normalized account code is included in self-cancellation receipt proof, so the two providers must agree. Original registry receipt shapes remain unchanged; neither migration changed.

The affected cancellation/coordinator test suites passed independently after the change. The prior native PostgreSQL proof remains applicable because the database schema/store were unchanged. This closes the malformed-provider-data finding without expanding wallet authority.
