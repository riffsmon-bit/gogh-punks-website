import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runAutomatedSeaDropWorker } from "../scripts/run-automated-seadrop-worker.mjs";

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
  assert.doesNotMatch(source, /approve\(|setApprovalForAll|execute\(address,uint256,bytes/);
});
