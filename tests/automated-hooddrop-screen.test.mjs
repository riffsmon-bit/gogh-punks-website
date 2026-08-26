import assert from "node:assert/strict";
import test from "node:test";

import {
  HOOD_DROP_CONTROLLER,
  HOOD_DROP_CONTROLLER_CODE_HASH,
  screenHoodDropFreeMintCandidate,
} from "../broker/src/discovery/automated-hooddrop-screen.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;
const ZERO_HASH = `0x${"00".repeat(32)}`;

function candidate() {
  return {
    chainId: 4663,
    controller: HOOD_DROP_CONTROLLER,
    controllerCodeHash: HOOD_DROP_CONTROLLER_CODE_HASH,
    collection: COLLECTION,
    collectionRuntimeCodeHash: HASH,
    account: ACCOUNT,
    roundId: "7",
    stageId: "3",
    tokenId: "42",
  };
}

function state() {
  return {
    checkedAt: "2026-08-25T12:00:01.000Z",
    blockNumber: "45000000",
    blockHash: BLOCK_HASH,
    blockTimestamp: "1787659200",
    currentRoundId: "7",
    round: { maxTokenSupplyForRound: "90", exists: true, active: true, paused: false },
    stage: {
      startTime: "1787650000",
      endTime: "1787660000",
      maxPerWallet: "2",
      mintPriceWei: "0",
      merkleRoot: ZERO_HASH,
      allowlist: false,
      exists: true,
    },
    mintedByWallet: "0",
    mintStats: { minterMinted: "0", currentTotalSupply: "41", maxSupply: "100" },
  };
}

test("screens one exact public zero-price HoodDrop V2 mint", () => {
  const result = screenHoodDropFreeMintCandidate(candidate(), state());
  assert.equal(result.schema, "GOGH_AUTOMATED_HOODDROP_FREE_MINT_SCREEN_V1");
  assert.equal(result.collection, COLLECTION);
  assert.equal(result.account, ACCOUNT);
  assert.equal(result.roundId, "7");
  assert.equal(result.stageId, "3");
  assert.equal(result.tokenId, "42");
  assert.equal(result.quantity, 1);
  assert.equal(result.valueWei, "0");
  assert.equal(result.publicStage, true);
  assert.deepEqual(result.allowlistProof, []);
  assert.equal(result.approvalsRequired, false);
  assert.match(result.calldata, /^0x[0-9a-f]+$/);
  assert.equal(result.mandatoryNextGate,
    "DUAL_RPC_CURRENT_HEAD_RECHECK_AND_FULL_PUNK_ACCOUNT_SIMULATION");
});

test("rejects paid, private, paused, expired, and exhausted HoodDrop state", () => {
  const paid = state();
  paid.stage.mintPriceWei = "1";
  assert.throws(() => screenHoodDropFreeMintCandidate(candidate(), paid), { code: "STAGE_NOT_FREE" });

  const privateStage = state();
  privateStage.stage.allowlist = true;
  assert.throws(() => screenHoodDropFreeMintCandidate(candidate(), privateStage), { code: "STAGE_NOT_PUBLIC" });

  const paused = state();
  paused.round.paused = true;
  assert.throws(() => screenHoodDropFreeMintCandidate(candidate(), paused), { code: "ROUND_PAUSED" });

  const expired = state();
  expired.stage.endTime = expired.blockTimestamp;
  assert.throws(() => screenHoodDropFreeMintCandidate(candidate(), expired), { code: "STAGE_NOT_ACTIVE" });

  const exhausted = state();
  exhausted.mintedByWallet = "2";
  assert.throws(() => screenHoodDropFreeMintCandidate(candidate(), exhausted), { code: "WALLET_LIMIT_REACHED" });
});

test("rejects wrong controller, runtime, token identity, and hostile JSON", () => {
  const wrongController = candidate();
  wrongController.controller = "0x3333333333333333333333333333333333333333";
  assert.throws(
    () => screenHoodDropFreeMintCandidate(wrongController, state()),
    { code: "WRONG_CONTROLLER" },
  );

  const wrongRuntime = candidate();
  wrongRuntime.controllerCodeHash = HASH;
  assert.throws(
    () => screenHoodDropFreeMintCandidate(wrongRuntime, state()),
    { code: "CONTROLLER_CODE_MISMATCH" },
  );

  const wrongToken = candidate();
  wrongToken.tokenId = "43";
  assert.throws(
    () => screenHoodDropFreeMintCandidate(wrongToken, state()),
    { code: "WRONG_TOKEN_ID" },
  );

  let invoked = 0;
  const hostile = candidate();
  Object.defineProperty(hostile, "collection", {
    enumerable: true,
    get() { invoked += 1; return COLLECTION; },
  });
  assert.throws(() => screenHoodDropFreeMintCandidate(hostile, state()), { code: "INVALID_JSON" });
  assert.equal(invoked, 0);
});
