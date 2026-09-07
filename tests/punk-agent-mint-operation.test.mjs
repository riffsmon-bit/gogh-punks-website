import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPunkAgentMintIntent,
  estimateSignedPunkAgentUserOperation,
  prepareSignedPunkAgentMint,
  submitPreparedPunkAgentMint,
} from "../broker/src/agent-account/punk-agent-mint-operation.mjs";
import { ENTRY_POINT_V08 } from
  "../broker/src/agent-account/punk-agent-account-setup.mjs";

const ACCOUNT = "0x0000000000000000000000000000000000000001";
const OWNER = "0x0000000000000000000000000000000000000002";
const SESSION = "0x0000000000000000000000000000000000000003";
const ADAPTER = "0x0000000000000000000000000000000000000004";
const VENUE = "0x0000000000000000000000000000000000000005";
const COLLECTION = "0x0000000000000000000000000000000000000006";
const NOW = new Date("2026-09-07T12:00:00.000Z");
const HASH = `0x${"11".repeat(32)}`;
const SIGNATURE = `0x${"22".repeat(64)}1b`;

function runtime() {
  return { deployment: { entryPoint: ENTRY_POINT_V08 }, account: ACCOUNT,
    accountCreated: true, owner: OWNER, acquisitionNonce: 7n, sessionActive: true,
    session: { sessionKey: SESSION, adapter: ADAPTER, venue: VENUE,
      adapterCodeHash: `0x${"33".repeat(32)}`,
      targetCollection: "0x0000000000000000000000000000000000000000",
      validUntil: BigInt(Math.floor(NOW.getTime() / 1_000) + 600), generation: 2n } };
}

function opportunity(overrides = {}) {
  return { schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: "seadrop:test:public", chainId: 4663,
    collectionContract: COLLECTION, mintContract: VENUE, adapter: ADAPTER,
    mintStage: "PUBLIC", mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: "0", estimatedGasCostWei: "100", supply: 100, walletLimit: 1,
    startTime: "2026-09-07T11:00:00.000Z", endTime: "2026-09-07T13:00:00.000Z",
    website: null, socialUrls: { x: null, discord: null, farcaster: null },
    sourceUrls: ["https://robinhoodchain.blockscout.com/address/0x0000000000000000000000000000000000000006"],
    artStyles: ["PIXEL_ART"], imageReference: null, collectionName: "Test",
    contractCodeHash: `0x${"44".repeat(32)}`,
    adapterCodeHash: `0x${"33".repeat(32)}`, screeningStatus: "PASSED",
    simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 10,
    expectedNftReceiver: ACCOUNT, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: "2026-09-07T11:00:00.000Z", updatedAt: NOW.toISOString(), ...overrides };
}

const gas = { verificationGasLimit: "100000", callGasLimit: "150000",
  preVerificationGas: "50000", maxPriorityFeePerGas: "1", maxFeePerGas: "2" };

test("builds a session-bound, short-lived free-mint intent", () => {
  const intent = buildPunkAgentMintIntent({ runtime: runtime(), opportunity: opportunity(),
    strategyHash: HASH, tokenId: "42", simulationInputHash: "simulation", now: NOW });
  assert.equal(intent.account, ACCOUNT);
  assert.equal(intent.expectedOwner, OWNER);
  assert.equal(intent.nonce, "7");
  assert.equal(intent.policyVersion, "2");
  assert.equal(intent.tokenId, "42");
  assert.equal(intent.expectedPrice, "0");
  assert.match(intent.opportunityId, /^0x[0-9a-f]{64}$/);
  assert.throws(() => buildPunkAgentMintIntent({ runtime: runtime(),
    opportunity: opportunity({ priceWei: "1" }), strategyHash: HASH, tokenId: "42",
    simulationInputHash: "simulation", now: NOW }), { code: "AUTONOMOUS_CANDIDATE_REJECTED" });
  assert.throws(() => buildPunkAgentMintIntent({ runtime: runtime(),
    opportunity: opportunity({ simulationStatus: "PENDING" }), strategyHash: HASH,
    tokenId: "42", simulationInputHash: "simulation", now: NOW }),
  { code: "AUTONOMOUS_CANDIDATE_REJECTED" });
});

test("signs exact gas fields and requires the signed envelope to cover bundler estimates", async () => {
  const prepared = await prepareSignedPunkAgentMint({ client: { async readContract() {
    return HASH;
  } }, signer: { address: SESSION, async signMessage() { return SIGNATURE; } },
  runtime: runtime(), opportunity: opportunity(), strategyHash: HASH, tokenId: "42",
  simulationInputHash: "simulation", gas, entryPointNonce: "8", now: NOW });
  assert.equal(prepared.operation.userOpHash, HASH);
  assert.equal(prepared.operation.rpc.signature, SIGNATURE);
  const estimate = await estimateSignedPunkAgentUserOperation({ operation: prepared.operation,
    bundler: { async request() { return { preVerificationGas: "40000",
      verificationGasLimit: "90000", callGasLimit: "140000" }; } } });
  assert.equal(estimate.callGasLimit, 140000n);
  await assert.rejects(estimateSignedPunkAgentUserOperation({ operation: prepared.operation,
    bundler: { async request() { return { preVerificationGas: "40000",
      verificationGasLimit: "90000", callGasLimit: "150001" }; } } }),
  { code: "USER_OPERATION_GAS_ENVELOPE_TOO_LOW" });
});

test("submission requires fresh evidence and returns the canonical UserOperation hash", async () => {
  const prepared = await prepareSignedPunkAgentMint({ client: { async readContract() {
    return HASH;
  } }, signer: { address: SESSION, async signMessage() { return SIGNATURE; } },
  runtime: runtime(), opportunity: opportunity(), strategyHash: HASH, tokenId: "42",
  simulationInputHash: "simulation", gas, entryPointNonce: "8", now: NOW });
  const methods = [];
  const bundler = { async request({ method }) { methods.push(method);
    return method === "eth_estimateUserOperationGas" ? { preVerificationGas: "40000",
      verificationGasLimit: "90000", callGasLimit: "140000" } : HASH; } };
  const result = await submitPreparedPunkAgentMint({ bundler, prepared,
    screeningInputHash: "screen", simulationInputHash: "simulation",
    checkedAt: NOW.toISOString(), now: NOW });
  assert.equal(result.userOpHash, HASH);
  assert.deepEqual(methods, ["eth_estimateUserOperationGas", "eth_sendUserOperation"]);
  await assert.rejects(submitPreparedPunkAgentMint({ bundler, prepared,
    screeningInputHash: "screen", simulationInputHash: "simulation",
    checkedAt: "2026-09-07T11:00:00.000Z", now: NOW }),
  { code: "STALE_EXECUTION_EVIDENCE" });
});
