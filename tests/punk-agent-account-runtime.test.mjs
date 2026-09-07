import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics, keccak256 } from "viem";

import undeployed from "../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import {
  createPunkAgentBundler,
  createPunkAgentSessionSigner,
  PUNK_AGENT_RUNTIME_ABI,
  readPunkAgentAccountRuntime,
  readPunkAgentBundlerReadiness,
  verifyPunkAgentMintReceipt,
} from "../broker/src/agent-account/punk-agent-account-runtime.mjs";
import {
  normalizePunkAgentAccountDeployment,
  punkAgentAccountReadiness,
} from "../broker/src/agent-account/punk-agent-account-manifest.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333";
const REGISTRY = "0x4444444444444444444444444444444444444444";
const SESSION = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c";
const COLLECTION = "0x5555555555555555555555555555555555555555";
const OPPORTUNITY = `0x${"66".repeat(32)}`;
const USER_OP = `0x${"77".repeat(32)}`;
const TRANSACTION = `0x${"88".repeat(32)}`;
const CODE = "0x6001600055";

function deployed() {
  return { ...structuredClone(undeployed), status: "DEPLOYED",
    contracts: {
      GoghPunkAgentAccount: { address: IMPLEMENTATION,
        deploymentTransaction: `0x${"11".repeat(32)}`, deploymentBlock: 10,
        runtimeBytecodeHash: keccak256(CODE), verificationStatus: "VERIFIED" },
      GoghPunkAgentAccountRegistry: { address: REGISTRY,
        deploymentTransaction: `0x${"22".repeat(32)}`, deploymentBlock: 11,
        runtimeBytecodeHash: keccak256(CODE), verificationStatus: "VERIFIED" },
    }, configuration: { sourceVerified: true, adapterRegistrationConfirmed: true,
      bundlerConfigured: true, sessionSignerConfigured: true,
      receiptReconciliationEnabled: true, workerEnabled: true },
    authorization: { deploymentAuthorized: true, automaticSubmissionEnabled: true },
  };
}

test("undeployed Punk Agent Account manifest is valid and locked", () => {
  const manifest = normalizePunkAgentAccountDeployment(undeployed);
  const readiness = punkAgentAccountReadiness(manifest);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.ownerSetupReady, false);
  assert.ok(readiness.blockers.includes("CONTRACTS_NOT_DEPLOYED"));
  assert.throws(() => normalizePunkAgentAccountDeployment({ ...undeployed,
    authorization: { ...undeployed.authorization, automaticSubmissionEnabled: true } }),
  { code: "INVALID_MANIFEST" });
});

test("runtime binds deployed code, owner, session key, adapter, venue, and EntryPoint", async () => {
  const manifest = deployed();
  const queue = [ACCOUNT, OWNER, manifest.entryPoint,
    manifest.reusedContracts.ArtAdapterRegistry, 9n, 4n, 123n, {
      sessionKey: SESSION, authorizingOwner: OWNER,
      adapter: manifest.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter,
      venue: manifest.reusedContracts.SeaDrop, adapterCodeHash: `0x${"44".repeat(32)}`,
      targetCollection: "0x0000000000000000000000000000000000000000",
      validAfter: 100n, validUntil: 200n, maxMintsPerDay: 2,
      remainingMints: 3, mintsToday: 1, day: 1, generation: 4,
      maxGasCostWei: 1000n, minimumNativeReserveWei: 10n,
    }, true];
  let codeCalls = 0;
  const client = {
    async getChainId() { return 4663; },
    async getCode() { codeCalls += 1; return CODE; },
    async getBalance() { return 500n; },
    async readContract() { return queue.shift(); },
  };
  const runtime = await readPunkAgentAccountRuntime({ client, deployment: manifest,
    tokenId: "93", expectedOwner: OWNER, expectedSessionKey: SESSION });
  assert.equal(runtime.account, ACCOUNT);
  assert.equal(runtime.sessionActive, true);
  assert.equal(runtime.session.generation, 4n);
  assert.equal(runtime.acquisitionNonce, 9n);
  assert.equal(runtime.sessionGeneration, 4n);
  assert.equal(runtime.entryPointDeposit, 123n);
  assert.equal(runtime.nativeBalance, 500n);
  assert.equal(codeCalls, 7);
  assert.equal(queue.length, 0);
});

test("server signer stays environment-only and bundler is pinned to chain and EntryPoint", async () => {
  const signer = createPunkAgentSessionSigner({
    PUNK_AGENT_SESSION_PRIVATE_KEY:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    PUNK_AGENT_SESSION_ADDRESS: SESSION,
  });
  assert.equal(signer.address, SESSION);
  assert.throws(() => createPunkAgentSessionSigner({}), {
    code: "SESSION_SIGNER_NOT_CONFIGURED",
  });

  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return { ok: true, async json() { return { jsonrpc: "2.0", id: body.id,
      result: body.method === "eth_chainId" ? "0x1237" : [undeployed.entryPoint] }; } };
  };
  const bundler = createPunkAgentBundler({ url: "https://bundler.example/v1/key",
    fetchImpl });
  const ready = await readPunkAgentBundlerReadiness({ bundler });
  assert.equal(ready.ready, true);
  assert.deepEqual(requests.map(({ method }) => method).sort(),
    ["eth_chainId", "eth_supportedEntryPoints"]);
});

test("confirmed UserOperation requires the exact acquisition event and live NFT owner", async () => {
  const event = PUNK_AGENT_RUNTIME_ABI.find((item) => item.type === "event"
    && item.name === "SessionAcquisitionExecuted");
  const topics = encodeEventTopics({ abi: [event], eventName: event.name,
    args: { generation: 4n, opportunityId: OPPORTUNITY, collection: COLLECTION } });
  const data = encodeAbiParameters([
    { type: "uint256" }, { type: "uint256" }, { type: "uint32" }, { type: "uint256" },
  ], [42n, 9n, 2, 10n]);
  const receipt = { userOpHash: USER_OP, sender: ACCOUNT, success: true,
    actualGasCost: "100", actualGasUsed: "200", logs: [{ address: ACCOUNT, topics, data }],
    receipt: { status: "success", transactionHash: TRANSACTION,
      blockNumber: 123n, blockHash: `0x${"99".repeat(32)}`, logs: [] } };
  const result = await verifyPunkAgentMintReceipt({
    client: { async readContract() { return ACCOUNT; } }, receipt, userOpHash: USER_OP,
    account: ACCOUNT, opportunityId: OPPORTUNITY, collection: COLLECTION, tokenId: "42",
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.tokenId, "42");
  assert.equal(result.transactionHash, TRANSACTION);
  assert.equal(result.blockNumber, "123");
  await assert.rejects(verifyPunkAgentMintReceipt({
    client: { async readContract() { return OWNER; } }, receipt, userOpHash: USER_OP,
    account: ACCOUNT, opportunityId: OPPORTUNITY, collection: COLLECTION, tokenId: "42",
  }), { code: "NFT_POSTCONDITION_FAILED" });
});
