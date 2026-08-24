import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  confirmedIntentWindow,
  runAutomatedSeaDropWorker,
  selectActiveZeroPriceSeaDropCollections,
  selectCanonicalCloneCollections,
} from "../scripts/run-automated-seadrop-worker.mjs";

test("worker anchors its 120-second intent at the confirmed evidence horizon", () => {
  assert.deepEqual(confirmedIntentWindow(1_000), { createdAt: 970, expiresAt: 1_090 });
  assert.equal(1_090 - 970, 120);
  assert.throws(() => confirmedIntentWindow(30), /invalid confirmed intent time window/);
  assert.throws(() => confirmedIntentWindow(1_000, 31), /invalid confirmed intent time window/);
});

test("worker prefilter retains only the exact reviewed 45-byte clone runtime", () => {
  const canonical = "0x363d3d373d3d3d363d7309a26fc8fcef18192e267d7a6da9dfb4be81dd6a5af43d82803e903d91602b57fd5bf3";
  assert.deepEqual(
    selectCanonicalCloneCollections(["exact", "wrong", "empty"], [
      canonical, `${canonical.slice(0, -2)}00`, "0x",
    ]),
    ["exact"],
  );
  assert.throws(
    () => selectCanonicalCloneCollections(["exact"], []),
    /invalid canonical clone evidence/,
  );
});

test("worker prefilter selects only currently active native zero-price public drops", () => {
  const collections = ["free", "paid", "closed", "failed"];
  const now = 1_000n;
  const drop = (overrides = {}) => ({
    mintPrice: 0n, startTime: 900n, endTime: 1_100n,
    maxTotalMintableByWallet: 1, feeBps: 0, restrictFeeRecipients: false,
    ...overrides,
  });
  const results = [
    { status: "success", result: drop() },
    { status: "success", result: drop({ mintPrice: 1n }) },
    { status: "success", result: drop({ endTime: 999n }) },
    { status: "failure", error: new Error("rpc") },
  ];
  assert.deepEqual(
    selectActiveZeroPriceSeaDropCollections(collections, results, now), ["free"],
  );
  assert.throws(
    () => selectActiveZeroPriceSeaDropCollections(collections, results.slice(1), now),
    /invalid SeaDrop prefilter evidence/,
  );
});

test("hosted worker is disabled by default and requires the exact published signer", async () => {
  assert.deepEqual(await runAutomatedSeaDropWorker({}), { status: "DISABLED", submitted: 0 });
  await assert.rejects(
    runAutomatedSeaDropWorker({
      BROKER_AUTOMATION_V2_ENABLED: "true",
      BROKER_AUTOMATION_V2_AGENT_PRIVATE_KEY:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    }),
    /signer address mismatch/,
  );
});

test("worker source fixes the account entry point, zero value, one action, and stop-on-failure", async () => {
  const source = await readFile(new URL("../scripts/run-automated-seadrop-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /maxMintsPerRun: 1/);
  assert.match(source, /minAgentReserveWei/);
  assert.match(source, /stopOnFailure: true/);
  assert.match(source, /value: 0n/);
  assert.match(source, /attestAutomatedSeaDropCandidateLive/);
  assert.match(source, /buildAutomatedSeaDropExecutionBatch/);
  assert.match(source, /readOnly === true/);
  assert.match(source, /liveScreenRejections/);
  assert.match(source, /executionSimulationsPassed/);
  assert.match(source, /executionSimulationRejections/);
  assert.match(source, /LATEST_ACCOUNT_SIMULATION_FAILED/);
  assert.match(source, /1_000_000n/);
  assert.match(source, /selectActiveZeroPriceSeaDropCollections/);
  assert.match(source, /selectCanonicalCloneCollections/);
  assert.match(source, /activeZeroPriceSeaDropCollections\(secondary, collections\)/);
  assert.match(source, /offset \+= 64/);
  assert.doesNotMatch(source, /client\.multicall/);
  assert.doesNotMatch(source, /analyzedCandidates|mandateThresholdRejections/);
  assert.doesNotMatch(source, /approve\(|setApprovalForAll|execute\(address,uint256,bytes/);
});
