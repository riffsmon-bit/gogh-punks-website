import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData, keccak256 } from "viem";

import { prepareOwnerPaidAutomationV3 } from
  "../netlify/functions/broker-autonomy-v3-owner-run.mjs";
import {
  OwnerPaidFreeMintError,
  preflightOwnerPaidFreeMint,
  submitOwnerPaidFreeMint,
  validateOwnerPaidFreeMintExecution,
} from "../site/owner-paid-free-mint.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}`;
const COLLECTION = "0x3333333333333333333333333333333333333333";
const ADAPTER = "0x4444444444444444444444444444444444444444";
const VENUE = "0x5555555555555555555555555555555555555555";
const INTENT_COMPONENTS = [
  { name: "account", type: "address" }, { name: "chainId", type: "uint256" },
  { name: "expectedOwner", type: "address" }, { name: "nonce", type: "uint256" },
  { name: "policyVersion", type: "uint64" }, { name: "opportunityType", type: "uint8" },
  { name: "assetStandard", type: "uint8" }, { name: "adapter", type: "address" },
  { name: "venue", type: "address" }, { name: "collection", type: "address" },
  { name: "tokenId", type: "uint256" }, { name: "assetAmount", type: "uint256" },
  { name: "currency", type: "address" }, { name: "expectedPrice", type: "uint256" },
  { name: "maxPrice", type: "uint256" }, { name: "maxSlippageBps", type: "uint16" },
  { name: "createdAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
  { name: "opportunityId", type: "bytes32" }, { name: "reasoningHash", type: "bytes32" },
  { name: "adapterCodeHash", type: "bytes32" },
];
const ABI = [{
  type: "function", name: "executeApprovedAcquisition", stateMutability: "nonpayable",
  inputs: [
    { name: "intent", type: "tuple", components: INTENT_COMPONENTS },
    { name: "adapterData", type: "bytes" }, { name: "ownerSignature", type: "bytes" },
  ], outputs: [{ name: "result", type: "bytes" }],
}];

function execution(overrides = {}) {
  const expiresAt = Math.floor(Date.now() / 1_000) + 90;
  const intent = {
    account: ACCOUNT, chainId: 4663n, expectedOwner: OWNER, nonce: 0n, policyVersion: 1n,
    opportunityType: 2, assetStandard: 0, adapter: ADAPTER, venue: VENUE,
    collection: COLLECTION, tokenId: 77n, assetAmount: 1n,
    currency: "0x0000000000000000000000000000000000000000", expectedPrice: 0n,
    maxPrice: 0n, maxSlippageBps: 0, createdAt: BigInt(expiresAt - 90),
    expiresAt: BigInt(expiresAt), opportunityId: HASH, reasoningHash: HASH,
    adapterCodeHash: HASH,
  };
  const data = encodeFunctionData({ abi: ABI, functionName: "executeApprovedAcquisition",
    args: [intent, "0x", "0x"] });
  return {
    schema: "GOGH_OWNER_PAID_SEADROP_V3_EXECUTION_V1",
    version: 1,
    chainId: 4663,
    executionHash: HASH,
    expiresAt,
    punk: { tokenId: "93", expectedOwner: OWNER, account: ACCOUNT },
    collection: COLLECTION,
    expectedTokenId: "77",
    transaction: {
      from: OWNER,
      to: ACCOUNT,
      value: "0",
      data,
      dataKeccak256: keccak256(data),
    },
    safety: {
      currentOwnerOnly: true,
      exactAccountEntryPointOnly: true,
      ownerSignatureBytesEmpty: true,
      adapterDataEmpty: true,
      mintPriceWei: "0",
      quantity: "1",
      recipient: ACCOUNT,
      approvalsAllowed: false,
      arbitraryCalldataAllowed: false,
      submissionPerformed: false,
    },
    ...overrides,
  };
}

test("owner-paid free mint validates, simulates, and submits one exact owner transaction", async () => {
  const calls = [];
  const provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [OWNER];
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return HASH;
      throw new Error(`unexpected ${method}`);
    },
  };
  const transaction = await preflightOwnerPaidFreeMint(provider, execution(), {
    tokenId: "93", owner: OWNER, account: ACCOUNT,
  });
  assert.equal(transaction.value, "0x0");
  assert.equal(await submitOwnerPaidFreeMint(provider, transaction), HASH);
  assert.deepEqual(calls.map(({ method }) => method), [
    "eth_chainId", "eth_accounts", "eth_call", "eth_estimateGas", "eth_sendTransaction",
  ]);
});

test("owner-paid free mint rejects selector or owner drift before wallet submission", () => {
  assert.throws(() => validateOwnerPaidFreeMintExecution({
    ...execution(), transaction: { ...execution().transaction, data: "0xdeadbeef00" },
  }, { tokenId: "93", owner: OWNER, account: ACCOUNT }), OwnerPaidFreeMintError);
  assert.throws(() => validateOwnerPaidFreeMintExecution(execution(), {
    tokenId: "93", owner: "0x3333333333333333333333333333333333333333", account: ACCOUNT,
  }), OwnerPaidFreeMintError);
});

test("owner-paid free mint rejects calldata field drift even when safety labels remain unchanged", () => {
  const original = execution();
  const mutateWord = (data, index, word) => {
    const start = 10 + index * 64;
    return `${data.slice(0, start)}${word.padStart(64, "0")}${data.slice(start + 64)}`;
  };
  for (const [index, word] of [
    [9, "66".repeat(20)],
    [11, "2"],
    [13, "1"],
    [23, "1"],
  ]) {
    const data = mutateWord(original.transaction.data, index, word);
    const forged = { ...original, transaction: { ...original.transaction, data,
      dataKeccak256: keccak256(data) } };
    assert.throws(() => validateOwnerPaidFreeMintExecution(forged, {
      tokenId: "93", owner: OWNER, account: ACCOUNT,
    }), OwnerPaidFreeMintError);
  }
});

test("owner-paid endpoint prepares only an active exact Punk and never submits server-side", async () => {
  let workerOptions;
  const environment = { CONTEXT: "deploy-preview" };
  const ready = await prepareOwnerPaidAutomationV3({ tokenId: "93" }, {
    environment,
    readPunk: async () => ({ tokenId: "93", created: true, active: true }),
    runWorker: async (receivedEnvironment, options) => {
      assert.equal(receivedEnvironment, environment);
      workerOptions = options;
      return { status: "OWNER_TRANSACTION_READY", collection: ACCOUNT,
        execution: execution() };
    },
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(workerOptions, {
    requestedTokenId: "93", ownerPaidPlan: true, readOnly: true,
  });

  await assert.rejects(() => prepareOwnerPaidAutomationV3({ tokenId: "94" }, {
    readPunk: async () => ({ tokenId: "94", created: false, active: false }),
  }), (error) => error.code === "PUNK_AUTOMATION_INACTIVE");
});
