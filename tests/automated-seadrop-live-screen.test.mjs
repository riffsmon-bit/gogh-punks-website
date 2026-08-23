import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATED_LIVE_SCREEN_SCHEMA,
  OPEN_SEA_FEE_RECIPIENT,
  attestAutomatedSeaDropCandidateLive,
} from "../broker/src/discovery/automated-seadrop-live-screen.mjs";
import {
  COLLECTION_RUNTIME_CODE_HASH,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
} from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";

const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function fixture() {
  const now = Math.floor(Date.now() / 1_000);
  const candidate = {
    collection: A("5"), opportunityId: H("5"), reasoningHash: H("6"),
    contractRiskScore: 20, tasteMatch: 80, metadataSanitized: true, analysisComplete: true,
  };
  const scope = {
    account: A("1"), agent: A("2"), expectedOwner: A("3"), policyModule: A("4"),
    adapter: A("7"), adapterCodeHash: H("7"), nonce: "0", policyVersion: "11",
    createdAt: String(now - 1), expiresAt: String(now + 119),
  };
  const calls = [];
  function client(role, url) {
    return {
      transport: Object.freeze({ url }),
      async getBlockNumber() { calls.push([role, "head"]); return 1_000n; },
      async getBlock({ blockNumber }) {
        calls.push([role, "block", blockNumber]);
        return { number: blockNumber, hash: H("a"), timestamp: BigInt(now - 2) };
      },
      async getCodeEvidence({ address }) {
        calls.push([role, "code", address]);
        return address.toLowerCase() === SEA_DROP
          ? { codeHash: SEA_DROP_CODE_HASH, length: 18_470 }
          : { codeHash: COLLECTION_RUNTIME_CODE_HASH, length: 45 };
      },
      async readContract({ functionName, args }) {
        calls.push([role, functionName, args]);
        if (functionName === "deniedCollections") return false;
        if (functionName === "getPublicDrop") {
          return {
            mintPrice: 0n, startTime: BigInt(now - 60), endTime: BigInt(now + 60),
            maxTotalMintableByWallet: 3, feeBps: 0, restrictFeeRecipients: true,
          };
        }
        if (functionName === "getMintStats") return [1n, 41n, 100n];
        if (functionName === "getFeeRecipientIsAllowed") {
          assert.equal(args[1].toLowerCase(), OPEN_SEA_FEE_RECIPIENT);
          return true;
        }
        throw new Error("unexpected read");
      },
      async simulateContract(request) {
        calls.push([role, "simulate", request]);
        assert.equal(request.account.toLowerCase(), scope.agent);
        assert.equal(request.address.toLowerCase(), scope.account);
        assert.equal(request.args[0].collection.toLowerCase(), candidate.collection);
        assert.equal(request.args[0].tokenId, 42n);
        assert.equal(request.args[0].expectedPrice, 0n);
        return { result: "0x" };
      },
      async estimateContractGas(request) {
        calls.push([role, "estimate", request]);
        return 400_000n;
      },
    };
  }
  const primaryUrl = "https://official.robinhood.example/rpc";
  const secondaryUrl = "https://independent.example/v2/key";
  const primary = client("primary", primaryUrl);
  const secondary = client("secondary", secondaryUrl);
  return {
    candidate, scope, calls, endpoints: { primaryUrl, secondaryUrl },
    options: { confirmations: 20, maximumEvidenceAgeSeconds: 30 },
    clients: { primary, secondary },
  };
}

test("collects exact fresh dual-RPC evidence and simulates the full account entry point", async () => {
  const f = fixture();
  const result = await attestAutomatedSeaDropCandidateLive(
    f.candidate, f.scope, f.endpoints, f.options, f.clients,
  );
  assert.equal(result.schema, AUTOMATED_LIVE_SCREEN_SCHEMA);
  assert.equal(result.pinnedBlock.number, "980");
  assert.equal(result.screen.target.nextTokenId, "42");
  assert.equal(result.screen.target.walletRemaining, "2");
  assert.equal(result.providers.exactTransportUrlsBound, true);
  assert.equal(result.providers.providerIndependenceVerified, false);
  assert.equal(result.safety.exactFullAccountSimulation, true);
  assert.equal(result.safety.submissionPerformed, false);
  assert.equal(f.calls.filter((entry) => entry[1] === "simulate").length, 2);
  assert.equal(f.calls.filter((entry) => entry[1] === "estimate").length, 2);
  assert.equal(f.calls.filter((entry) => entry[0] === "primary" && entry[1] === "block").length, 2);
  assert.equal(f.calls.filter((entry) => entry[0] === "secondary" && entry[1] === "block").length, 2);
  assert.match(result.evidenceHash, /^0x[0-9a-f]{64}$/);
});

test("fails closed on provider, code, state, simulation, and closing-reorg drift", async () => {
  const cases = [
    (f) => { f.endpoints.secondaryUrl = "https://other.robinhood.example/rpc";
      f.clients.secondary.transport = Object.freeze({ url: f.endpoints.secondaryUrl }); },
    (f) => { f.clients.secondary.getCodeEvidence = async () => (
      { codeHash: H("f"), length: 45 }
    ); },
    (f) => { f.clients.secondary.readContract = async ({ functionName }) => (
      functionName === "deniedCollections" ? true : (() => { throw new Error("stop"); })()
    ); },
    (f) => { f.clients.secondary.simulateContract = async () => { throw new Error("revert"); }; },
    (f) => {
      let reads = 0;
      f.clients.secondary.getBlock = async ({ blockNumber }) => {
        reads += 1;
        return { number: blockNumber, hash: reads === 1 ? H("a") : H("b"),
          timestamp: BigInt(Math.floor(Date.now() / 1_000) - 2) };
      };
    },
  ];
  for (const mutate of cases) {
    const f = fixture();
    mutate(f);
    await assert.rejects(attestAutomatedSeaDropCandidateLive(
      f.candidate, f.scope, f.endpoints, f.options, f.clients,
    ));
  }
});

test("rejects exposed transport request APIs and hostile input objects", async () => {
  const exposed = fixture();
  exposed.clients.primary.transport = Object.freeze({
    url: exposed.endpoints.primaryUrl, request() {},
  });
  await assert.rejects(attestAutomatedSeaDropCandidateLive(
    exposed.candidate, exposed.scope, exposed.endpoints, exposed.options, exposed.clients,
  ), { code: "INVALID_CLIENT" });

  const hostile = fixture();
  let invoked = 0;
  Object.defineProperty(hostile.scope, "nonce", {
    enumerable: true, get() { invoked += 1; return "0"; },
  });
  await assert.rejects(attestAutomatedSeaDropCandidateLive(
    hostile.candidate, hostile.scope, hostile.endpoints, hostile.options, hostile.clients,
  ), { code: "INVALID_JSON" });
  assert.equal(invoked, 0);
});
