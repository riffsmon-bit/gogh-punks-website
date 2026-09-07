import assert from "node:assert/strict";
import test from "node:test";

import { decodeFunctionData } from "viem";

import {
  buildPunkAgentUserOperation,
  PUNK_AGENT_ACCOUNT_ABI,
  PUNK_AGENT_USER_OPERATION_SCHEMA,
  readPunkAgentEntryPointNonce,
  signPunkAgentUserOperation,
  submitPunkAgentUserOperation,
} from "../broker/src/agent-account/punk-agent-user-operation.mjs";
import { ENTRY_POINT_V08 } from
  "../broker/src/agent-account/punk-agent-account-setup.mjs";

const ACCOUNT = "0x0000000000000000000000000000000000000001";
const OWNER = "0x0000000000000000000000000000000000000002";
const SESSION = "0x0000000000000000000000000000000000000003";
const ADAPTER = "0x0000000000000000000000000000000000000004";
const VENUE = "0x0000000000000000000000000000000000000005";
const COLLECTION = "0x0000000000000000000000000000000000000006";
const OPPORTUNITY = `0x${"11".repeat(32)}`;
const USER_OP_HASH = `0x${"22".repeat(32)}`;
const SIGNATURE = `0x${"33".repeat(64)}1b`;

function intent() {
  return {
    account: ACCOUNT,
    chainId: "4663",
    expectedOwner: OWNER,
    nonce: "0",
    policyVersion: "1",
    opportunityType: 2,
    assetStandard: 0,
    adapter: ADAPTER,
    venue: VENUE,
    collection: COLLECTION,
    tokenId: "88",
    assetAmount: "1",
    currency: "0x0000000000000000000000000000000000000000",
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: 0,
    createdAt: "1800000000",
    expiresAt: "1800000300",
    opportunityId: OPPORTUNITY,
    reasoningHash: `0x${"44".repeat(32)}`,
    adapterCodeHash: `0x${"55".repeat(32)}`,
  };
}

function input() {
  return {
    account: ACCOUNT,
    sessionKey: SESSION,
    entryPoint: ENTRY_POINT_V08,
    entryPointNonce: "7",
    intent: intent(),
    adapterData: "0x",
    signature: "0x",
    gas: {
      verificationGasLimit: "100000",
      callGasLimit: "150000",
      preVerificationGas: "50000",
      maxPriorityFeePerGas: "500000000",
      maxFeePerGas: "1000000000",
    },
  };
}

test("builds one exact free-mint Punk Agent UserOperation", () => {
  const operation = buildPunkAgentUserOperation(input());
  assert.equal(operation.schema, PUNK_AGENT_USER_OPERATION_SCHEMA);
  assert.equal(operation.account, ACCOUNT);
  assert.equal(operation.sessionKey, SESSION);
  assert.equal(operation.packed.sender, ACCOUNT);
  assert.equal(operation.packed.nonce, 7n);
  assert.equal(operation.packed.initCode, "0x");
  assert.equal(operation.packed.paymasterAndData, "0x");
  assert.equal(operation.packed.signature, "0x");
  assert.equal(operation.maximumGasCostWei, 300000000000000n);
  assert.equal(operation.rpc.nonce, "0x7");
  assert.equal(operation.rpc.callGasLimit, "0x249f0");
  assert.equal(operation.rpc.verificationGasLimit, "0x186a0");
  assert.equal(operation.rpc.preVerificationGas, "0xc350");
  assert.equal(operation.rpc.maxFeePerGas, "0x3b9aca00");
  assert.equal(Object.hasOwn(operation.rpc, "factory"), false);
  assert.equal(Object.hasOwn(operation.rpc, "paymaster"), false);

  const decoded = decodeFunctionData({
    abi: PUNK_AGENT_ACCOUNT_ABI,
    data: operation.packed.callData,
  });
  assert.equal(decoded.functionName, "executeSessionAcquisition");
  assert.equal(decoded.args[0].account.toLowerCase(), ACCOUNT);
  assert.equal(decoded.args[0].opportunityType, 2);
  assert.equal(decoded.args[0].expectedPrice, 0n);
  assert.equal(decoded.args[0].assetAmount, 1n);
  assert.equal(decoded.args[1], "0x");
});

test("rejects paid, approval-bearing, and wrong-entry-point operations", () => {
  const paid = input();
  paid.intent.expectedPrice = "1";
  paid.intent.maxPrice = "1";
  assert.throws(() => buildPunkAgentUserOperation(paid), { code: "UNSAFE_INTENT" });

  const opaque = input();
  opaque.adapterData = "0x01";
  assert.throws(() => buildPunkAgentUserOperation(opaque), { code: "UNSAFE_ADAPTER_DATA" });

  const wrongEntryPoint = input();
  wrongEntryPoint.entryPoint = OWNER;
  assert.throws(() => buildPunkAgentUserOperation(wrongEntryPoint), { code: "WRONG_ENTRY_POINT" });
});

test("reads nonce, hashes on EntryPoint, and signs only with the approved session key", async () => {
  const calls = [];
  const client = {
    async readContract(request) {
      calls.push(request);
      return request.functionName === "getNonce" ? 9n : USER_OP_HASH;
    },
  };
  assert.equal(await readPunkAgentEntryPointNonce({ client, account: ACCOUNT }), 9n);
  const operation = buildPunkAgentUserOperation(input());
  let signedMessage = null;
  const signed = await signPunkAgentUserOperation({
    client,
    signer: {
      address: SESSION,
      async signMessage(message) { signedMessage = message; return SIGNATURE; },
    },
    operation,
  });
  assert.deepEqual(signedMessage, { message: { raw: USER_OP_HASH } });
  assert.equal(signed.userOpHash, USER_OP_HASH);
  assert.equal(signed.packed.signature, SIGNATURE);
  assert.equal(signed.rpc.signature, SIGNATURE);
  assert.deepEqual(calls.map(({ functionName }) => functionName), ["getNonce", "getUserOpHash"]);

  await assert.rejects(
    signPunkAgentUserOperation({
      client,
      signer: { address: OWNER, async signMessage() { return SIGNATURE; } },
      operation,
    }),
    { code: "WRONG_SESSION_SIGNER" },
  );
});

test("submits only a signed, freshly screened and simulated UserOperation", async () => {
  const operation = {
    ...buildPunkAgentUserOperation({ ...input(), signature: SIGNATURE }),
    userOpHash: USER_OP_HASH,
  };
  const requests = [];
  const bundler = {
    async request(request) { requests.push(request); return USER_OP_HASH; },
  };
  await assert.rejects(
    submitPunkAgentUserOperation({ bundler, operation, authorization: {} }),
    { code: "SUBMISSION_NOT_AUTHORIZED" },
  );
  const result = await submitPunkAgentUserOperation({
    bundler,
    operation,
    authorization: {
      ownerSessionActive: true,
      screeningPassed: true,
      simulationPassed: true,
      userOpHash: USER_OP_HASH,
      opportunityId: OPPORTUNITY,
    },
  });
  assert.deepEqual(result, { userOpHash: USER_OP_HASH, submitted: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "eth_sendUserOperation");
  assert.equal(requests[0].params[1], ENTRY_POINT_V08);
  assert.equal(requests[0].params[0].signature, SIGNATURE);

  const mismatch = { request: async () => `0x${"99".repeat(32)}` };
  await assert.rejects(
    submitPunkAgentUserOperation({
      bundler: mismatch,
      operation,
      authorization: {
        ownerSessionActive: true,
        screeningPassed: true,
        simulationPassed: true,
        userOpHash: USER_OP_HASH,
        opportunityId: OPPORTUNITY,
      },
    }),
    { code: "BUNDLER_HASH_MISMATCH" },
  );
});
