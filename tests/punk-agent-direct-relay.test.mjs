import assert from "node:assert/strict";
import test from "node:test";

import { createPunkAgentDirectRelay } from
  "../broker/src/agent-account/punk-agent-direct-relay.mjs";
import { ENTRY_POINT_V08 } from
  "../broker/src/agent-account/punk-agent-account-setup.mjs";

const SIGNER = "0x0000000000000000000000000000000000000003";
const SENDER = "0x0000000000000000000000000000000000000004";
const USER_OP_HASH = `0x${"11".repeat(32)}`;
const TRANSACTION_HASH = `0x${"22".repeat(32)}`;
const BLOCK_HASH = `0x${"33".repeat(32)}`;
const SIGNATURE = `0x${"44".repeat(64)}1b`;

function operation(overrides = {}) {
  return { sender: SENDER, nonce: "0x1", callData: "0x1234",
    callGasLimit: "0x249f0", verificationGasLimit: "0x186a0",
    preVerificationGas: "0xc350", maxFeePerGas: "0x2",
    maxPriorityFeePerGas: "0x1", signature: SIGNATURE, ...overrides };
}

function fixture({ estimateGas = 300_000n, balance = 1_000_000_000_000_000n } = {}) {
  const calls = [];
  const event = { transactionHash: TRANSACTION_HASH, blockNumber: 100n, args: {
    userOpHash: USER_OP_HASH, sender: SENDER,
    paymaster: "0x0000000000000000000000000000000000000000",
    nonce: 1n, success: true, actualGasCost: 10n, actualGasUsed: 20n,
  } };
  const receipt = { transactionHash: TRANSACTION_HASH, blockNumber: 100n,
    blockHash: BLOCK_HASH, status: "success", logs: [] };
  const publicClient = {
    async getChainId() { return 4663; },
    async getCode() { return "0x6000"; },
    async getBalance() { return balance; },
    async getGasPrice() { return 1n; },
    async estimateGas(input) { calls.push({ method: "estimateGas", input }); return estimateGas; },
    async readContract(input) { calls.push({ method: "readContract", input }); return USER_OP_HASH; },
    async getBlockNumber() { return 100n; },
    async getLogs() { return [event]; },
    async getTransactionReceipt() { return receipt; },
  };
  const walletClient = { async sendTransaction(input) {
    calls.push({ method: "sendTransaction", input }); return TRANSACTION_HASH;
  } };
  const relay = createPunkAgentDirectRelay({ url: "https://robinhood-rpc.publicnode.com",
    expectedAddress: SIGNER, account: { address: SIGNER }, publicClient, walletClient });
  return { relay, calls };
}

test("private relay supports only the canonical EntryPoint flow", async () => {
  const { relay, calls } = fixture();
  assert.equal(await relay.request({ method: "eth_chainId" }), "0x1237");
  assert.deepEqual(await relay.request({ method: "eth_supportedEntryPoints" }),
    [ENTRY_POINT_V08]);
  assert.deepEqual(await relay.fundingState(), { signerAddress: SIGNER,
    balanceWei: "1000000000000000", minimumBalanceWei: "200000000000000" });
  const estimate = await relay.request({ method: "eth_estimateUserOperationGas",
    params: [operation(), ENTRY_POINT_V08] });
  assert.deepEqual(estimate, { preVerificationGas: "0xc350",
    verificationGasLimit: "0x186a0", callGasLimit: "0x249f0" });
  assert.equal(await relay.request({ method: "eth_sendUserOperation",
    params: [operation(), ENTRY_POINT_V08] }), USER_OP_HASH);
  assert.equal(calls.find(({ method }) => method === "sendTransaction").input.gas, 360_000n);
  const receipt = await relay.request({ method: "eth_getUserOperationReceipt",
    params: [USER_OP_HASH] });
  assert.equal(receipt.userOpHash, USER_OP_HASH);
  assert.equal(receipt.sender, SENDER);
  assert.equal(receipt.success, true);
  await assert.rejects(relay.request({ method: "eth_sendRawTransaction", params: [] }),
    { code: "DIRECT_RELAY_METHOD_FORBIDDEN" });
});

test("private relay rejects wrong EntryPoints, unexpected fields, excess gas, and no float", async () => {
  const { relay } = fixture();
  await assert.rejects(relay.request({ method: "eth_estimateUserOperationGas",
    params: [operation(), "0x0000000000000000000000000000000000000005"] }),
  { code: "DIRECT_RELAY_ENTRY_POINT_MISMATCH" });
  await assert.rejects(relay.request({ method: "eth_estimateUserOperationGas",
    params: [{ ...operation(), paymaster: SIGNER }, ENTRY_POINT_V08] }),
  { code: "INVALID_DIRECT_RELAY_REQUEST" });
  const oversized = fixture({ estimateGas: 400_000n }).relay;
  await assert.rejects(oversized.request({ method: "eth_estimateUserOperationGas",
    params: [operation({ callGasLimit: "0x186a0" }), ENTRY_POINT_V08] }),
  { code: "DIRECT_RELAY_GAS_ENVELOPE_TOO_LOW" });
  await assert.rejects(fixture({ balance: 0n }).relay.fundingState(),
    { code: "DIRECT_RELAY_UNFUNDED" });
});

test("private relay binds its signer to the configured public address", () => {
  assert.throws(() => createPunkAgentDirectRelay({
    url: "https://robinhood-rpc.publicnode.com",
    expectedAddress: "0x0000000000000000000000000000000000000005",
    account: { address: SIGNER }, publicClient: {}, walletClient: {},
  }), { code: "DIRECT_RELAY_SIGNER_MISMATCH" });
});
