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
  assert.match(source, /DISCOVERY_COLLECTION_LIMIT = 128/);
  assert.match(source, /DISCOVERY_BATCH_SIZE = 8/);
  assert.match(source, /DISCOVERY_RUNTIME_BATCH_SIZE = 4/);
  assert.match(source, /DISCOVERY_BATCH_DELAY_MS = 250/);
  assert.match(source, /activeZeroPriceSeaDropCollections\(secondary, primary, collections\)/);
  assert.match(source, /SeaDrop discovery incomplete/);
  assert.doesNotMatch(source, /approve\(|setApprovalForAll|execute\(address,uint256,bytes/);
});

test("the verified V3 deployment remains closed until Guardian and worker configuration", () => {
  assert.deepEqual(autonomyV3Status(), {
    status: "DEPLOYED_CONFIGURATION_PENDING",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "AUTOMATION_V3_GUARDIAN_AND_WORKER_PENDING",
    bindings: {
      chainId: 4663,
      adapter: "0xd4316dfbcfa3f51f1a9de77aaa5d9e6edf848777",
      adapterRuntimeCodeHash:
        "0x8e99aa5602225a4aadcccc2ee4e0e5c42477ed40b5d927ee964e81d204b8b56b",
      policyModule: "0x555a0533b2575f765fe7a8c7bcf604120e76e1cd",
      policyModuleRuntimeCodeHash:
        "0x6b6e2ca26fb3c02bb620b05a21799b17f4d93a1c4d8b2af5ee83724c0b3cd88d",
      accountImplementation: "0xb24199845ca42966e755b2dad7c8a9a490afeb13",
      accountImplementationRuntimeCodeHash:
        "0x63b26b5f3bce8b3adb52d1c1d9c9067c9c24cc63e5c961a6d9e399dbf4396520",
      accountRegistry: "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52",
      accountRegistryRuntimeCodeHash:
        "0x6aa5390e63f46d3712dad94040d41b8051d8d6c273c7bfb28ac7308bae63c645",
    },
  });
});
