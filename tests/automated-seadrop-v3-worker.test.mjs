import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  confirmedIntentWindow,
  runAutomatedSeaDropV3Worker,
  selectActiveZeroPriceSeaDropCollections,
  selectReviewedStudioCollections,
} from "../scripts/run-automated-seadrop-v3-worker.mjs";
import { autonomyV3Status } from "../netlify/functions/broker-autonomy-v3-status.mjs";

test("V3 worker remains disabled by default and uses the confirmed intent horizon", async () => {
  assert.deepEqual(await runAutomatedSeaDropV3Worker({}), {
    status: "DISABLED", submitted: 0,
  });
  assert.deepEqual(confirmedIntentWindow(1_000), { createdAt: 970, expiresAt: 1_090 });
});

test("V3 prefilter keeps exact reviewed clone bytecode and rejects drift", () => {
  const clone = "0x363d3d373d3d3d363d7309a26fc8fcef18192e267d7a6da9dfb4be81dd6a5af43d82803e903d91602b57fd5bf3";
  assert.deepEqual(selectReviewedStudioCollections(
    ["clone", "drift", "empty"],
    [clone, `${clone.slice(0, -2)}00`, "0x"],
  ), ["clone"]);
  assert.throws(
    () => selectReviewedStudioCollections(["clone"], []),
    /invalid reviewed Studio runtime evidence/,
  );
});

test("V3 prefilter retains only active zero-price public drops", () => {
  const collections = ["free", "paid", "closed"];
  const drop = (overrides = {}) => ({
    mintPrice: 0n,
    startTime: 900n,
    endTime: 1_100n,
    maxTotalMintableByWallet: 1,
    feeBps: 0,
    restrictFeeRecipients: false,
    ...overrides,
  });
  assert.deepEqual(selectActiveZeroPriceSeaDropCollections(collections, [
    { status: "success", result: drop() },
    { status: "success", result: drop({ mintPrice: 1n }) },
    { status: "success", result: drop({ endTime: 999n }) },
  ], 1_000n), ["free"]);
});

test("V3 worker source binds both runtime families and no paid or approval path", async () => {
  const source = await readFile(
    new URL("../scripts/run-automated-seadrop-v3-worker.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /CLONE_COLLECTION_RUNTIME_CODE_HASH/);
  assert.match(source, /STUDIO_COLLECTION_RUNTIME_CODE_HASH/);
  assert.match(source, /length === 45/);
  assert.match(source, /length === 19_658/);
  assert.match(source, /maxMintsPerRun: 1/);
  assert.match(source, /value: 0n/);
  assert.match(source, /buildAutomatedSeaDropV3ExecutionBatch/);
  assert.doesNotMatch(source, /approve\(|setApprovalForAll|execute\(address,uint256,bytes/);
});

test("the authoritative NOT_DEPLOYED V3 manifest keeps the public capability closed", () => {
  assert.deepEqual(autonomyV3Status(), {
    status: "PREPARING_V3",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "AUTOMATION_V3_NOT_DEPLOYED",
    bindings: null,
  });
});
