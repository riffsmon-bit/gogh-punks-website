# Burn-to-training practice checkpoint

This continuation prepares the owner-reviewed literal-burn flow on a new disposable
Anvil chain. Open **http://127.0.0.1:64343/burn-practice** on this Mac while the
preview is running. The working checkout is `/private/tmp/gogh-punk93-mint-stall`.

The fixed rehearsal burns **Test Punk #7** and awards **Test Punk #44** one credit.
Both NFTs and their artwork appear in the review. A successful burn does not learn
or equip a skill: Contract Detective level 0 → 1 costs the credit in a separate
review through the existing reviewed training control. Equipping is another action.

## Review and transaction behavior

- Review names both Punks and explains permanent NFT loss, surviving wallet
  addresses, loss of owner access, and remaining or later-deposited assets becoming
  inaccessible. Assets do not migrate to the recipient.
- Four fresh mock wallet contracts demonstrate the V1/V2/V3/Agent review positions.
  Their addresses, owners and exact native balances are read from this local chain.
  They are not the production wallet implementations. Token inventory, EntryPoint
  deposits, offers and missions are not inspected by this fixture.
- Preparation and cancellation send nothing. Confirmation requires exact `BURN 7`
  text and acknowledgment of wallet-access loss. The server accepts the stored
  review ID; it does not accept replacement transaction fields or arbitrary Punks.
- The fixture source enforces both current owners, distinct IDs, both ownership
  epochs, the recipient's training state, a 60-second deadline and the existing
  1,111 supply floor. Burning and awarding the credit are atomic. Actual fixture
  supply starts at 1,119; the successful review leaves 1,118.
- Setup creates a token-specific approval for disposable #7 only. There is no
  operator-wide approval and no connection to MetaMask or an owner's account.
- A single attempted marker precedes the local send. Concurrent confirmations and
  receipt rechecks never resend. Canonical receipt/transaction fields, exact burn
  and credit events, recipient ownership, supply and credit consumption are checked
  before training becomes available. Missing or reorganized evidence remains
  unresolved. A lost submission hash blocks another burn in that practice process.

The browser can reload and recover the same in-memory burn review while this
server remains alive. Restarting this command creates a new chain and discards
its burn reviews and training journal; it is not durable production recovery.

## Existing practice session

The earlier #44 practice URL on port 64342 was not listening when this continuation
started. It was not restarted or reset, and its journal files were not opened or
modified. The preexisting Anvil process on port 8549 was left running. This work
does not establish the current state of that earlier session.

## Validation

The disposable-chain integration passed preparation/cancellation without writes,
explicit confirmation, expiry, source and recipient transfer round trips, native
dust blocking, supply floor, approval failure without burn/credit, duplicate
submission protection, delayed receipt recovery, one credit, separate learning and
equipping, and post-burn wallet access loss. A one-wei later deposit remained in
the mock wallet, while the former owner's withdrawal simulation reverted.

Browser checks passed at 1440, 390 and 375 pixels, including images, both Punk IDs,
typed source, acknowledgment, cancellation, receipt recovery after reload, separate
learning confirmation and learned-but-unequipped state. No browser exceptions or
real-wallet requests occurred. Screenshots and machine-readable browser evidence
are in [the review folder](review/2026-09-11/burn-practice/).

The selected existing Forge regression suite passed all 109 tests. Twelve new
receipt tests reject changed calldata, destination, value, fee, source/recipient,
missing/duplicate events and reorg evidence; they also cover reverted transactions,
lost hashes and receipt disappearance without another send. The fixture Solidity
compiled and passed formatting checks. The deployment gate also passed, including
the wallet bundle build, site validation, JavaScript syntax, broker validation and
all 127 deployment tests.

Reproduce from the working checkout:

```sh
forge build --offline
node scripts/test-burn-practice-local.mjs --local-only
node scripts/test-burn-practice-browser.mjs --local-only
node --test tests/skill-forge-burn-practice.test.mjs
node scripts/dev/skill-forge/run-burn-practice.mjs --local-only
```

No public-chain transaction, production deployment, production approval or real
Punk burn was performed. Production source/approval integration, complete wallet
review, lifecycle handling and production receipt recovery remain work for the
later training release. The production training manifest is unchanged and disabled.
