import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { attestAutomatedScatterV3CandidateLive } from
  "../broker/src/discovery/automated-scatter-v3-live-screen.mjs";

const target = {
  collection: "0x1111111111111111111111111111111111111111",
  adapter: "0x2222222222222222222222222222222222222222",
  adapterCodeHash: `0x${"11".repeat(32)}`,
  publicInviteKey: `0x${"00".repeat(32)}`,
};
const scope = {
  account: "0x3333333333333333333333333333333333333333",
  agent: "0x4444444444444444444444444444444444444444",
  expectedOwner: "0x5555555555555555555555555555555555555555",
  nonce: "1",
  policyVersion: "2",
  createdAt: "1000",
  expiresAt: "1120",
  opportunityId: `0x${"22".repeat(32)}`,
  reasoningHash: `0x${"33".repeat(32)}`,
};

function inertClient() {
  return Object.freeze({
    transport: Object.freeze({ url: "https://one.example/" }),
    getBlockNumber: async () => 1_000n,
    getBlock: async () => ({ number: 980n, hash: `0x${"44".repeat(32)}`, timestamp: 1_000n }),
    getCode: async () => "0x6000",
    readContract: async () => { throw new Error("not reached"); },
    call: async () => { throw new Error("not reached"); },
    estimateGas: async () => { throw new Error("not reached"); },
  });
}

test("Scatter live screening rejects one provider before any chain read", async () => {
  let reads = 0;
  const client = Object.freeze({
    ...inertClient(),
    getBlockNumber: async () => { reads += 1; return 1_000n; },
  });
  const secondary = Object.freeze({
    ...inertClient(),
    transport: Object.freeze({ url: "https://one.example/rpc" }),
  });
  await assert.rejects(
    () => attestAutomatedScatterV3CandidateLive(
      target,
      scope,
      { primaryUrl: "https://one.example", secondaryUrl: "https://one.example/rpc" },
      { confirmations: 20, maximumEvidenceAgeSeconds: 30 },
      { primary: client, secondary },
    ),
    { code: "SAME_PROVIDER" },
  );
  assert.equal(reads, 0);
});

test("Scatter worker rebuilds calls without trusting API transaction data", async () => {
  const source = await readFile(
    new URL("../broker/src/discovery/automated-scatter-v3-live-screen.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildAutomatedScatterV3Execution/);
  assert.match(source, /fullAccountSimulationOnBothProviders: true/);
  assert.match(source, /closingReorgCheck: true/);
  assert.doesNotMatch(source, /mintTransaction|erc20s|screenScatterMintApiResponse/);
});
